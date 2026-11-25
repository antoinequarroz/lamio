import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { replySubject } from "./compose";
import { imapClient } from "./connect";
import { cancelSend, deliver, prepare, queueSend, saveDraft, type Draft } from "./send";
import * as store from "./store";
import { syncMailbox } from "./sync";

const original =
  "From: =?utf-8?Q?L=C3=A9a_Martin?= <lea@agence.ch>\r\nTo: Antoine <antoine@exemple.ch>\r\nCc: Paul <paul@agence.ch>\r\nSubject: Devis\r\nMessage-ID: <devis-2@agence.ch>\r\nReferences: <devis-1@agence.ch>\r\nDate: Tue, 24 Nov 2026 09:00:00 +0100\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nVoici le devis.\r\n";

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;
const sent: { envelope: { from: string; to: string[] }; raw: string }[] = [];
const imap = () => {
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  return c;
};
const deps = {
  imap,
  smtp: () => ({ sendMail: async (m: { envelope: { from: string; to: string[] }; raw: Buffer }) => (sent.push({ envelope: m.envelope, raw: m.raw.toString() }), {}) }) as never,
};
const resync = async () => {
  const c = imap();
  await c.connect();
  await syncMailbox(c, userId, { full: true });
  await c.logout();
};
const base: Draft = { to: [{ name: "Léa Martin", address: "lea@agence.ch" }], cc: [], bcc: [], subject: "", html: "", mode: "new" };

beforeEach(async () => {
  sent.length = 0;
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "send-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "antoine@exemple.ch", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  store.setSignature(userId, "Antoine Quarroz\nPostmelo");
  server = hoodiecrow({
    plugins: ["SPECIAL-USE", "UIDPLUS"],
    storage: { INBOX: { messages: [{ raw: original, flags: ["\\Seen"] }] }, "": { separator: "/", folders: { Sent: { "special-use": "\\Sent" }, Drafts: { "special-use": "\\Drafts" } } } },
  });
  await new Promise<void>((r) => server.listen(0, r));
  await resync();
});

afterEach(() => new Promise<void>((r) => server.close(r)));

describe("écrire un mail", () => {
  it("répond dans la conversation : objet, citation, signature, en-têtes, copie dans Envoyés, original marqué répondu", async () => {
    const draft: Draft = { ...base, cc: [{ name: "", address: "paul@agence.ch" }], bcc: [{ name: "", address: "moi@exemple.ch" }], subject: replySubject("Devis"), html: "<p>Merci <b>Léa</b> !</p><script>x()</script>", mode: "replyAll", ref: { folder: "INBOX", uid: 1 } };
    const out = await prepare(userId, "Antoine", draft, [{ name: "plan.txt", type: "text/plain", data: Buffer.from("plan") }], deps);
    await deliver(userId, draft, out, deps);

    expect(sent).toHaveLength(1);
    expect(sent[0].envelope).toEqual({ from: "antoine@exemple.ch", to: ["lea@agence.ch", "paul@agence.ch", "moi@exemple.ch"] });
    const raw = sent[0].raw;
    expect(raw).toMatch(/^Subject: Re: Devis/m);
    expect(raw).toMatch(/^In-Reply-To: <devis-2@agence\.ch>/m);
    expect(raw).toMatch(/^References: <devis-1@agence\.ch> <devis-2@agence\.ch>/m);
    expect(raw).not.toMatch(/^Bcc:/m);
    expect(raw).not.toContain("<script>");
    expect(raw).toContain('filename=plan.txt');

    await resync();
    const copy = store.listMailMessages(userId, "Sent").messages;
    expect(copy).toHaveLength(1);
    expect(copy[0]).toMatchObject({ subject: "Re: Devis", seen: true });
    expect(store.listMailMessages(userId, "INBOX").messages[0].answered).toBe(true);

    // The text version: what was written, the signature, then the quote.
    const text = (await import("./body")).openMail;
    const mine = await text(userId, "Sent", copy[0].uid, deps.imap);
    expect(mine!.text).toContain("Merci Léa !");
    expect(mine!.text).toContain("-- \nAntoine Quarroz\nPostmelo");
    expect(mine!.text).toMatch(/Léa Martin <lea@agence\.ch> a écrit :\nVoici le devis\./);
  });

  it("transfère avec l'en-tête du mail d'origine", async () => {
    const draft: Draft = { ...base, subject: replySubject("Devis", true), html: "<p>Pour info</p>", mode: "forward", ref: { folder: "INBOX", uid: 1 } };
    const out = await prepare(userId, "Antoine", draft, [], deps);
    expect(out.inReplyTo).toBeUndefined();
    expect(out.subject).toBe("Fwd: Devis");
    expect(out.tail).toContain("Message transféré");
    expect(out.tail).toContain("Voici le devis.");
  });

  it("enregistre un brouillon dans Brouillons, le remplace, puis l'enlève une fois envoyé", async () => {
    const draft: Draft = { ...base, subject: "Idée", html: "<p>Première version</p>" };
    const first = await saveDraft(userId, draft, await prepare(userId, "Antoine", draft, [], deps), deps);
    expect(first.folder).toBe("Drafts");
    expect(first.uid).toBeGreaterThan(0);
    const second = await saveDraft(userId, { ...draft, draft: { folder: "Drafts", uid: first.uid! } }, await prepare(userId, "Antoine", { ...draft, html: "<p>Deuxième</p>" }, [], deps), deps);
    await resync();
    expect(store.listMailMessages(userId, "Drafts").messages.map((m) => m.uid)).toEqual([second.uid]);

    const final: Draft = { ...draft, mode: "draft", draft: { folder: "Drafts", uid: second.uid! } };
    await deliver(userId, final, await prepare(userId, "Antoine", final, [], deps), deps);
    await resync();
    expect(store.listMailMessages(userId, "Drafts").messages).toHaveLength(0);
    expect(store.listMailMessages(userId, "Sent").messages).toHaveLength(1);
  });

  it("« Annuler » : le mail ne part pas", async () => {
    const out = await prepare(userId, "Antoine", { ...base, subject: "Oups", html: "x" }, [], deps);
    const id = queueSend(userId, { ...base }, out, 200, deps);
    expect(cancelSend("quelqu-un-d-autre", id)).toBe(false);
    expect(cancelSend(userId, id)).toBe(true);
    await new Promise((r) => setTimeout(r, 400));
    expect(sent).toHaveLength(0);
    expect(cancelSend(userId, id)).toBe(false);
  });

  it("part de l'adresse choisie, avec sa signature ; une adresse inconnue retombe sur la boîte", async () => {
    store.setIdentities(userId, [{ address: "Contact@Postmelo.ch", name: "Postmelo", signature: "L'équipe Postmelo" }]);
    expect(store.mailAccountInfo(userId)!.identities.map((i) => [i.address, i.primary])).toEqual([["antoine@exemple.ch", true], ["contact@postmelo.ch", false]]);
    const out = await prepare(userId, "Antoine", { ...base, subject: "Salut", html: "<p>x</p>", from: "contact@postmelo.ch" }, [], deps);
    expect(out.from).toEqual({ name: "Postmelo", address: "contact@postmelo.ch" });
    expect(out.tail).toContain("L'équipe Postmelo");
    expect(out.tail).not.toContain("Antoine Quarroz");
    await deliver(userId, base, out, deps);
    expect(sent[0].envelope.from).toBe("contact@postmelo.ch");
    const other = await prepare(userId, "Antoine", { ...base, from: "pirate@ailleurs.ch" }, [], deps);
    expect(other.from).toEqual({ name: "Antoine", address: "antoine@exemple.ch" });
    expect(other.tail).toContain("Antoine Quarroz");
  });

  it("propose les adresses déjà vues", async () => {
    expect(store.mailContacts(userId, "agence")).toEqual(expect.arrayContaining([{ name: "Léa Martin", address: "lea@agence.ch" }, { name: "Paul", address: "paul@agence.ch" }]));
    expect(store.mailContacts(userId, "léa")[0].address).toBe("lea@agence.ch");
  });

  it("garde Re: et Fwd: une seule fois", () => {
    expect(replySubject("RE: Devis")).toBe("RE: Devis");
    expect(replySubject("Devis")).toBe("Re: Devis");
    expect(replySubject("TR: Devis", true)).toBe("TR: Devis");
  });
});
