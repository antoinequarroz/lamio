import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { aiReady, draftReply, summarize } from "./ai";
import { imapClient } from "./connect";
import * as store from "./store";
import { syncMailbox } from "./sync";

const raw = (from: string, to: string, subject: string, body: string, extra: string[] = []) =>
  [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, ...extra, "Content-Type: text/plain; charset=utf-8", "", body, ""].join("\r\n");

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;
const connect = () => {
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  return c;
};
const asked: { system: string; content: string }[] = [];
let answer: unknown;
const deps = { connect, now: () => new Date("2026-11-25T10:00:00Z"), ask: async (r: { system: string; content: string }) => (asked.push(r), answer) };

beforeEach(async () => {
  asked.length = 0;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ai-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "antoine@exemple.ch", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({
    plugins: ["SPECIAL-USE"],
    storage: {
      INBOX: {
        messages: [
          { raw: raw("Lea <lea@studio.ch>", "antoine@exemple.ch", "Tournage", "Salut Antoine, on se voit jeudi 27 a 14h au studio ? Le devis est de 1250 CHF.\n\n> ancien message cite\n> encore", ["Message-ID: <t1@studio.ch>"]), flags: ["\\Seen"] },
        ],
      },
      "": {
        separator: "/",
        folders: {
          Sent: {
            "special-use": "\\Sent",
            messages: [{ raw: raw("antoine@exemple.ch", "Paul <paul@x.ch>", "Planning", "Hello Paul,\n\nJe te confirme pour mardi, ca joue pour moi.\n\nBelle journee,\nAntoine"), flags: ["\\Seen"] }],
          },
        },
      },
    },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const c = connect();
  await c.connect();
  await syncMailbox(c, userId, { full: true });
  await c.logout();
});

afterEach(() => new Promise<void>((r) => server.close(r)));

describe("aide IA", () => {
  it("n'est branchée qu'avec une clé", () => {
    expect(aiReady({})).toBe(false);
    expect(aiReady({ ANTHROPIC_API_KEY: "sk-ant-x" })).toBe(true);
    expect(aiReady({ ANTHROPIC_API_KEY: "sk-ant-x", MAIL_AI: "off" })).toBe(false);
  });

  it("résume la conversation sans l'historique cité, garde les actions valables, et ne redemande pas", async () => {
    answer = {
      summary: "Léa propose de se voir jeudi à 14h et annonce un devis.",
      actions: [
        { kind: "rdv", title: "Tournage avec Léa", start: "2026-11-27T14:00", end: "2026-11-27T15:00", allDay: false, amount: "", details: "" },
        { kind: "rdv", title: "Date vague", start: "jeudi", end: "", allDay: false, amount: "", details: "" },
        { kind: "montant", title: "Devis tournage", start: "", end: "", allDay: false, amount: "1250 CHF", details: "" },
        { kind: "autre", title: "x" },
      ],
    };
    const uid = store.listMailMessages(userId, "INBOX").messages[0].uid;
    const s = await summarize(userId, "INBOX", uid, deps);
    expect(s.summary).toMatch(/jeudi/);
    expect(s.actions.map((a) => a.title)).toEqual(["Tournage avec Léa", "Devis tournage"]);
    expect(asked[0].content).toContain("jeudi 27 a 14h");
    expect(asked[0].content).not.toContain("ancien message cite");
    expect(asked[0].content).toMatch(/mercredi,? 25 novembre 2026/);
    // Kept: a second look costs nothing; "fresh" asks again.
    await summarize(userId, "INBOX", uid, deps);
    expect(asked).toHaveLength(1);
    await summarize(userId, "INBOX", uid, deps, true);
    expect(asked).toHaveLength(2);
  });

  it("écrit un brouillon dans mon ton, d'après mes mails envoyés et ma consigne", async () => {
    answer = { body: "Salut Léa,\n\nJeudi 14h ça joue.\n\nBelle journée,\nAntoine" };
    const uid = store.listMailMessages(userId, "INBOX").messages[0].uid;
    const text = await draftReply(userId, "INBOX", uid, "accepte le rendez-vous", deps);
    expect(text).toContain("Jeudi 14h");
    expect(asked[0].content).toContain("Je te confirme pour mardi");
    expect(asked[0].content).toContain("Ma consigne : accepte le rendez-vous");
    answer = { body: "" };
    await expect(draftReply(userId, "INBOX", uid, "", deps)).rejects.toThrow(/rien renvoyé/);
  });
});
