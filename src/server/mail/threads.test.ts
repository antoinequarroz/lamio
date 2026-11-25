import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { imapClient } from "./connect";
import * as store from "./store";
import { syncMailbox } from "./sync";

type M = { id?: string; from: string; to?: string; subject: string; date: string; replyTo?: string; refs?: string; seen?: boolean };
const mail = (m: M) => ({
  raw: [
    `From: ${m.from}`,
    `To: ${m.to ?? "antoine@exemple.ch"}`,
    `Subject: ${m.subject}`,
    `Date: ${new Date(m.date).toUTCString()}`,
    m.id && `Message-ID: ${m.id}`,
    m.replyTo && `In-Reply-To: ${m.replyTo}`,
    m.refs && `References: ${m.refs}`,
    "Content-Type: text/plain",
    "",
    `Texte de ${m.subject}`,
    "",
  ]
    .filter((l): l is string => typeof l === "string")
    .join("\r\n"),
  flags: m.seen ? ["\\Seen"] : [],
  internaldate: m.date,
});

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;

beforeEach(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "threads-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "antoine@exemple.ch", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({
    plugins: ["SPECIAL-USE"],
    storage: {
      INBOX: {
        messages: [
          mail({ id: "<a@studio.ch>", from: "Lea <lea@studio.ch>", subject: "Devis tournage", date: "2026-11-20T09:00:00Z", seen: true }),
          mail({ id: "<p1@x.ch>", from: "Paul <paul@x.ch>", subject: "Planning", date: "2026-11-21T09:00:00Z", seen: true }),
          mail({ id: "<c@studio.ch>", from: "Lea <lea@studio.ch>", subject: "Re: Devis tournage", date: "2026-11-22T09:00:00Z", replyTo: "<s1@exemple.ch>", refs: "<a@studio.ch> <s1@exemple.ch>" }),
          // A reply whose mail app dropped the headers: matched by subject and people.
          mail({ id: "<p2@x.ch>", from: "Paul <paul@x.ch>", subject: "RE: Planning", date: "2026-11-23T09:00:00Z" }),
          mail({ id: "<z@shop.ch>", from: "Shop <news@shop.ch>", subject: "Re: Planning", date: "2026-11-23T10:00:00Z" }),
        ],
      },
      "": {
        separator: "/",
        folders: {
          Sent: { "special-use": "\\Sent", messages: [mail({ id: "<s1@exemple.ch>", from: "antoine@exemple.ch", to: "Lea <lea@studio.ch>", subject: "Re: Devis tournage", date: "2026-11-21T12:00:00Z", replyTo: "<a@studio.ch>", refs: "<a@studio.ch>", seen: true })] },
          Trash: { "special-use": "\\Trash", messages: [mail({ id: "<t@studio.ch>", from: "Lea <lea@studio.ch>", subject: "Re: Devis tournage", date: "2026-11-21T15:00:00Z", replyTo: "<a@studio.ch>", refs: "<a@studio.ch>", seen: true })] },
        },
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

describe("fils de conversation", () => {
  it("regroupe un échange (avec ma réponse dans Envoyés), sans la corbeille ni un sujet pareil d'un inconnu", () => {
    const { messages } = store.listMailThreads(userId, "INBOX");
    expect(messages.map((m) => [m.subject, m.thread!.count, m.thread!.unread, m.thread!.uids.length])).toEqual([
      ["Re: Planning", 1, 1, 1],
      ["RE: Planning", 2, 1, 2],
      ["Re: Devis tournage", 3, 1, 2],
    ]);
    expect(messages[2].thread!.participants).toEqual(["Lea", "moi"]);
    // Mail by mail is still there.
    expect(store.listMailMessages(userId, "INBOX").messages).toHaveLength(5);

    const devis = store.threadMessages(userId, "INBOX", messages[2].uid);
    expect(devis.map((m) => [m.folder, m.subject])).toEqual([
      ["INBOX", "Devis tournage"],
      ["Sent", "Re: Devis tournage"],
      ["INBOX", "Re: Devis tournage"],
    ]);
    // Looking from the Trash, its mail belongs to the conversation too.
    expect(store.threadMessages(userId, "Trash", 1)).toHaveLength(4);
  });

  it("une réponse arrivée avant le mail qu'elle cite rejoint le fil quand il arrive ; les anciens mails reçoivent leur fil", () => {
    store.insertMessages(userId, "INBOX", [
      { uid: 90, messageId: "<r@y.ch>", inReplyTo: "<o@y.ch>", references: "<o@y.ch>", subject: "Re: Photos", from: { name: "Ana", address: "ana@y.ch" }, to: [], cc: [], date: "2026-11-24T10:00:00Z", seen: false, flagged: false, answered: false, attachments: false, size: 1 },
    ]);
    store.insertMessages(userId, "INBOX", [
      { uid: 91, messageId: "<o@y.ch>", inReplyTo: null, references: null, subject: "Photos", from: { name: "Ana", address: "ana@y.ch" }, to: [], cc: [], date: "2026-11-24T09:00:00Z", seen: true, flagged: false, answered: false, attachments: false, size: 1 },
    ]);
    expect(store.threadMessages(userId, "INBOX", 91).map((m) => m.uid)).toEqual([91, 90]);
    expect(store.baseSubject("TR: Re: [Lamio] AW: Devis  tournage")).toBe("devis tournage");
  });
});
