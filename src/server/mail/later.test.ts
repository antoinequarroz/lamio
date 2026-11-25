import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { subscribe } from "@/server/events";
import type { ServerEvent } from "@/lib/types";
import { imapClient } from "./connect";
import { cancelLater, followUp, listLater, runDue, scheduleSend, snooze, validDue } from "./later";
import * as store from "./store";
import { syncMailbox } from "./sync";

const raw = (from: string, subject: string, extra: string[] = []) => [`From: ${from}`, "To: antoine@exemple.ch", `Subject: ${subject}`, ...extra, "Content-Type: text/plain", "", `Texte ${subject}`, ""].join("\r\n");

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;
const connect = () => {
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  return c;
};
const sync = async () => {
  const c = connect();
  await c.connect();
  await syncMailbox(c, userId, { full: true });
  await c.logout();
};
const delivered: { subject: string; files: string[] }[] = [];
const deps = {
  connect,
  sync,
  deliver: (async (_u: string, _d: unknown, out: { subject: string; files: { name: string; data: Buffer }[] }) => {
    delivered.push({ subject: out.subject, files: out.files.map((f) => `${f.name}:${f.data.toString()}`) });
  }) as never,
};
const subjects = (folder: string) => store.listMailMessages(userId, folder).messages.map((m) => [m.subject, m.seen]);

beforeEach(async () => {
  delivered.length = 0;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "later-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "antoine@exemple.ch", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({
    plugins: ["SPECIAL-USE", "UIDPLUS", "MOVE"],
    storage: {
      INBOX: {
        messages: [
          { raw: raw("Lea <lea@studio.ch>", "Devis", ["Message-ID: <devis@studio.ch>"]), flags: ["\\Seen"] },
          { raw: raw("Paul <paul@x.ch>", "Re: Planning", ["Message-ID: <r1@x.ch>", "In-Reply-To: <plan@exemple.ch>", "References: <plan@exemple.ch>"]), flags: ["\\Seen"], internaldate: "2026-11-24T10:00:00Z" },
        ],
      },
      "": {
        separator: "/",
        folders: {
          Sent: {
            "special-use": "\\Sent",
            messages: [
              { raw: raw("antoine@exemple.ch", "Planning", ["Message-ID: <plan@exemple.ch>"]).replace("To: antoine@exemple.ch", "To: Paul <paul@x.ch>"), flags: ["\\Seen"], internaldate: "2026-11-23T10:00:00Z" },
              { raw: raw("antoine@exemple.ch", "Facture", ["Message-ID: <fact@exemple.ch>"]).replace("To: antoine@exemple.ch", "To: Client <c@client.ch>"), flags: ["\\Seen"], internaldate: "2026-11-23T11:00:00Z" },
            ],
          },
        },
      },
    },
  });
  await new Promise<void>((r) => server.listen(0, r));
  await sync();
});

afterEach(() => new Promise<void>((r) => server.close(r)));

describe("plus tard", () => {
  it("n'accepte qu'une date à venir, dans les deux ans", () => {
    const now = Date.parse("2026-11-25T10:00:00Z");
    expect(validDue("2026-11-26T08:00:00Z", now)?.toISOString()).toBe("2026-11-26T08:00:00.000Z");
    expect(validDue("2026-11-20T08:00:00Z", now)).toBeNull();
    expect(validDue("2030-01-01T00:00:00Z", now)).toBeNull();
    expect(validDue("demain", now)).toBeNull();
  });

  it("envoie un mail programmé à l'heure, pas avant, avec ses fichiers ; annulable", async () => {
    const out = { from: { name: "", address: "antoine@exemple.ch" }, to: [{ name: "Paul", address: "paul@x.ch" }], cc: [], bcc: [], subject: "Demain matin", html: "<p>Salut</p>", files: [{ name: "a.txt", type: "text/plain", data: Buffer.from("contenu") }] };
    const draft = { to: out.to, cc: [], bcc: [], subject: out.subject, html: out.html, mode: "new" as const };
    const at = new Date(Date.now() + 3600_000);
    scheduleSend(userId, draft, out, at);
    const other = scheduleSend(userId, draft, { ...out, subject: "Annulé" }, at);
    expect(listLater(userId).map((l) => [l.kind, l.subject, l.to])).toEqual([["send", "Demain matin", "Paul"], ["send", "Annulé", "Paul"]]);
    expect(await cancelLater(userId, other, deps)).toBe(true);
    await runDue(new Date(), deps);
    expect(delivered).toEqual([]);
    await runDue(new Date(at.getTime() + 1000), deps);
    expect(delivered).toEqual([{ subject: "Demain matin", files: ["a.txt:contenu"] }]);
    expect(listLater(userId)).toEqual([]);
  });

  it("reporte un mail dans « Reportés » et le ramène non lu dans la boîte de réception", async () => {
    const devis = store.listMailMessages(userId, "INBOX").messages.find((m) => m.subject === "Devis")!;
    const until = new Date(Date.now() + 3600_000);
    await snooze(userId, "INBOX", [devis.uid], until, deps);
    await sync();
    expect(subjects("INBOX").map((s) => s[0])).toEqual(["Re: Planning"]);
    expect(subjects("Reportés")).toEqual([["Devis", true]]);
    expect(listLater(userId)[0]).toMatchObject({ kind: "snooze", messageIds: ["<devis@studio.ch>"] });

    await runDue(new Date(until.getTime() + 1000), deps);
    expect(subjects("Reportés")).toEqual([]);
    expect(subjects("INBOX")).toContainEqual(["Devis", false]);
  });

  it("relance seulement si personne n'a répondu : drapeau sur le mail et rappel", async () => {
    const events: ServerEvent[] = [];
    const stop = subscribe(userId, (e) => events.push(e));
    try {
      const sent = store.listMailMessages(userId, "Sent").messages;
      const at = new Date(Date.now() + 1000);
      followUp(userId, "Sent", sent.find((m) => m.subject === "Planning")!.uid, at);
      followUp(userId, "Sent", sent.find((m) => m.subject === "Facture")!.uid, at);
      await runDue(new Date(at.getTime() + 1000), deps);
      const reminders = events.flatMap((e) => (e.type === "mail" && e.reminder ? [e.reminder] : []));
      expect(reminders).toEqual([{ title: "Pas de réponse de Client", body: "Facture", folder: "Sent", uid: sent.find((m) => m.subject === "Facture")!.uid }]);
      expect(store.listMailMessages(userId, "Sent").messages.filter((m) => m.flagged).map((m) => m.subject)).toEqual(["Facture"]);
    } finally {
      stop();
    }
  });
});
