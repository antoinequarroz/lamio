import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { imapClient } from "./connect";
import { mailsToAlert } from "./notify";
import { classifyHeaders, mailtoParts, parseUnsubscribe } from "./sort";
import * as store from "./store";
import { syncMailbox } from "./sync";
import { unsubscribe } from "./unsubscribe";

describe("ce que disent les en-têtes", () => {
  it("reconnaît les newsletters, les notifications et le reste", () => {
    expect(classifyHeaders("news@shop.ch", { listUnsubscribe: "<https://shop.ch/u>" })).toBe("newsletter");
    expect(classifyHeaders("x@groupe.ch", { listId: "<equipe.groupe.ch>" })).toBe("newsletter");
    expect(classifyHeaders("no-reply@banque.ch", {})).toBe("notification");
    expect(classifyHeaders("noreply+abc@github.com", {})).toBe("notification");
    expect(classifyHeaders("factures@infomaniak.ch", { autoSubmitted: "auto-generated" })).toBe("notification");
    expect(classifyHeaders("x@y.ch", { autoSubmitted: "no" })).toBe("");
    expect(classifyHeaders("x@y.ch", { precedence: "bulk" })).toBe("notification");
    expect(classifyHeaders("lea@studio.ch", {})).toBe("");
  });

  it("lit List-Unsubscribe et l'adresse mailto", () => {
    expect(parseUnsubscribe("<mailto:u@shop.ch?subject=stop>, <https://shop.ch/u?id=1>", "List-Unsubscribe=One-Click")).toEqual({ mailto: "mailto:u@shop.ch?subject=stop", http: "https://shop.ch/u?id=1", oneClick: true });
    expect(parseUnsubscribe("<http://shop.ch/u>", null)).toBeNull();
    expect(parseUnsubscribe(null, null)).toBeNull();
    expect(mailtoParts("mailto:u@shop.ch?subject=stop")).toEqual({ to: "u@shop.ch", subject: "stop", body: "unsubscribe" });
    expect(mailtoParts("mailto:pas-une-adresse")).toBeNull();
  });
});

const raw = (from: string, subject: string, headers: string[] = []) => ({
  raw: [`From: ${from}`, "To: antoine@exemple.ch", `Subject: ${subject}`, ...headers, "Content-Type: text/plain", "", `Texte de ${subject}`, ""].join("\r\n"),
  flags: [],
});

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;

beforeEach(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "sort-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "antoine@exemple.ch", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({
    plugins: ["SPECIAL-USE"],
    storage: {
      INBOX: {
        messages: [
          raw("Lea <lea@studio.ch>", "Devis"),
          raw("Shop <news@shop.ch>", "Soldes", ["List-Unsubscribe: <mailto:u@shop.ch?subject=stop>, <https://shop.ch/u>", "List-Unsubscribe-Post: List-Unsubscribe=One-Click"]),
          raw("Banque <no-reply@banque.ch>", "Votre releve"),
          // A list, but I write to this person: Important.
          raw("Paul <paul@club.ch>", "Sortie samedi", ["List-Id: <club.ch>"]),
        ],
      },
      "": {
        separator: "/",
        folders: { Sent: { "special-use": "\\Sent", messages: [raw("antoine@exemple.ch", "Re: Sortie").raw.replace("To: antoine@exemple.ch", "To: Paul <paul@club.ch>")].map((r) => ({ raw: r, flags: ["\\Seen"] })) } },
      },
    },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  await c.connect();
  await syncMailbox(c, userId, { full: true });
  await c.logout();
});

afterEach(() => new Promise<void>((r) => server.close(r)));

const subjects = (category?: "important" | "newsletter" | "notification") => store.listMailMessages(userId, "INBOX", undefined, 50, category).messages.map((m) => m.subject).sort();

describe("boîte triée", () => {
  it("range chaque mail dans son onglet, et compte les non lus", () => {
    expect(subjects("important")).toEqual(["Devis", "Sortie samedi"]);
    expect(subjects("newsletter")).toEqual(["Soldes"]);
    expect(subjects("notification")).toEqual(["Votre releve"]);
    expect(subjects()).toHaveLength(4);
    expect(store.categoryUnread(userId)).toEqual({ important: 2, newsletter: 1, notification: 1 });
    expect(store.listMailThreads(userId, "INBOX", undefined, 50, "newsletter").messages.map((m) => [m.subject, m.unsubscribe])).toEqual([["Soldes", true]]);
  });

  it("« Toujours dans … » pour un expéditeur l'emporte", () => {
    store.setSenderRule(userId, "News@Shop.ch", "important");
    store.setSenderRule(userId, "lea@studio.ch", "notification");
    expect(subjects("important")).toEqual(["Soldes", "Sortie samedi"]);
    expect(subjects("notification")).toEqual(["Devis", "Votre releve"]);
    store.setSenderRule(userId, "news@shop.ch", null);
    expect(subjects("newsletter")).toEqual(["Soldes"]);
  });

  it("les mails synchronisés avant le tri sont classés à la synchro suivante", async () => {
    users.db().prepare("update mail_messages set kind = null, unsubscribe = null").run();
    expect(subjects("newsletter")).toEqual([]);
    const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
    c.on("error", () => {});
    await c.connect();
    await syncMailbox(c, userId, { full: true });
    await c.logout();
    expect(subjects("newsletter")).toEqual(["Soldes"]);
    expect(store.unsortedUids(userId, "INBOX")).toEqual([]);
  });

  it("notifie seulement Important quand on le demande", () => {
    store.setMailNotify(userId, "important");
    const all = store.listMailMessages(userId, "INBOX").messages;
    expect(mailsToAlert(userId, all).map((m) => m.subject).sort()).toEqual(["Devis", "Sortie samedi"]);
  });

  it("se désabonne en un clic, sinon par mail, sinon ouvre la page", async () => {
    const soldes = store.listMailMessages(userId, "INBOX", undefined, 50, "newsletter").messages[0];
    const posts: { url: string; body: string }[] = [];
    const sent: { to: string; subject: string }[] = [];
    const deps = (status: number) => ({
      fetch: (async (url: URL, init: RequestInit) => {
        posts.push({ url: String(url), body: String(init.body) });
        return new Response(null, { status });
      }) as unknown as typeof fetch,
      smtp: () => ({ sendMail: async (m: { to: string; subject: string }) => (sent.push({ to: m.to, subject: m.subject }), {}) }) as never,
    });
    process.env.MAIL_ALLOW_PRIVATE = "true";
    try {
      expect(await unsubscribe(userId, "INBOX", soldes.uid, deps(200))).toEqual({ done: "web" });
      expect(posts).toEqual([{ url: "https://shop.ch/u", body: "List-Unsubscribe=One-Click" }]);
      // The web address refuses: the mail address takes over.
      expect(await unsubscribe(userId, "INBOX", soldes.uid, deps(500))).toEqual({ done: "mail" });
      expect(sent).toEqual([{ to: "u@shop.ch", subject: "stop" }]);
      // Only a page, no one-click: the app opens it.
      users.db().prepare("update mail_messages set unsubscribe = ? where uid = ?").run(JSON.stringify({ http: "https://shop.ch/page" }), soldes.uid);
      expect(await unsubscribe(userId, "INBOX", soldes.uid, deps(200))).toEqual({ open: "https://shop.ch/page" });
      const devis = store.listMailMessages(userId, "INBOX").messages.find((m) => m.subject === "Devis")!;
      await expect(unsubscribe(userId, "INBOX", devis.uid, deps(200))).rejects.toThrow(/ne propose pas/);
    } finally {
      delete process.env.MAIL_ALLOW_PRIVATE;
    }
  });
});
