import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { ImapFlow } from "imapflow";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { imapClient } from "./connect";
import * as store from "./store";
import { syncMailbox } from "./sync";

// A real IMAP server in memory (hoodiecrow, strict about the RFCs), fresh for every test.

const mail = (n: number, extra = "") =>
  `From: "Ana ${n}" <ana${n}@exemple.ch>\r\nTo: antoine@exemple.ch\r\nSubject: Mail ${n}\r\nMessage-ID: <m${n}@exemple.ch>\r\nDate: Mon, 2 Nov 2026 10:0${n % 10}:00 +0100\r\n${extra}Content-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nBonjour, voici le mail num=C3=A9ro ${n}.\r\n> ancienne citation\r\n`;

const storage = () => ({
  INBOX: {
    messages: [
      { raw: mail(1), flags: ["\\Seen"], internaldate: "2026-11-02T09:01:00Z" },
      { raw: mail(2), internaldate: "2026-11-02T09:02:00Z" },
      {
        raw: 'From: Bob <bob@exemple.ch>\r\nSubject: =?utf-8?Q?Facture_d=C3=A9cembre?=\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b1"\r\n\r\n--b1\r\nContent-Type: text/html; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<p>Votre facture de d=E9cembre&nbsp;est pr=EAte.</p>\r\n--b1\r\nContent-Type: application/pdf; name="facture.pdf"\r\nContent-Disposition: attachment; filename="facture.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--b1--\r\n',
        internaldate: "2026-11-02T09:03:00Z",
      },
    ],
  },
  "": { separator: "/", folders: { "Envoy&AOk-s": { "special-use": "\\Sent" }, Projets: {} } },
});

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;
const clients: ImapFlow[] = [];

async function connect() {
  const client = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  client.on("error", () => {});
  await client.connect();
  clients.push(client);
  return client;
}

async function start(plugins: string[]) {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "mail-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "testuser", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({ plugins, storage: storage() });
  await new Promise<void>((resolve) => server.listen(0, resolve));
}

afterEach(async () => {
  for (const c of clients.splice(0)) await c.logout().catch(() => c.close());
  await new Promise<void>((resolve) => server.close(resolve));
});

const inbox = () => store.listMailMessages(userId, "INBOX").messages;

for (const [label, plugins] of [
  ["avec CONDSTORE", ["SPECIAL-USE", "ENABLE", "CONDSTORE", "UIDPLUS", "MOVE"]],
  ["sans CONDSTORE", ["SPECIAL-USE", "UIDPLUS", "MOVE"]],
] as const) {
  describe(`synchro IMAP ${label}`, () => {
    beforeEach(() => start([...plugins]));

    it("copie les dossiers et les mails, avec l'aperçu, sans rien marquer comme lu", async () => {
      const changed = await syncMailbox(await connect(), userId);
      expect(changed).toContain("INBOX");

      const folders = store.listFolders(userId);
      expect(folders.map((f) => [f.path, f.specialUse])).toEqual([
        ["INBOX", "\\Inbox"],
        ["Envoyés", "\\Sent"],
        ["Projets", null],
      ]);
      expect(folders[0]).toMatchObject({ name: "Boîte de réception", total: 3, unread: 2 });

      const list = inbox();
      expect(list.map((m) => m.subject)).toEqual(["Facture décembre", "Mail 2", "Mail 1"]);
      expect(list[2]).toMatchObject({ seen: true, from: { name: "Ana 1", address: "ana1@exemple.ch" }, preview: "Bonjour, voici le mail numéro 1.", attachments: false });
      expect(list[0]).toMatchObject({ seen: false, attachments: true, preview: "Votre facture de décembre est prête." });

      // EXAMINE + BODY.PEEK: still unread on the server.
      const check = await connect();
      expect(await check.status("INBOX", { unseen: true })).toMatchObject({ unseen: 2 });
    });

    it("suit les nouveaux mails, les drapeaux et les suppressions faits ailleurs", async () => {
      const lamio = await connect();
      await syncMailbox(lamio, userId);

      // Someone else (the webmail, the iPhone) changes the mailbox.
      const other = await connect();
      await other.append("INBOX", mail(4), [], new Date("2026-11-02T09:04:00Z"));
      const lock = await other.getMailboxLock("INBOX");
      await other.messageFlagsAdd({ uid: "2" }, ["\\Seen", "\\Flagged"], { uid: true });
      await other.messageMove({ uid: "1" }, "Projets", { uid: true });
      lock.release();

      const changed = await syncMailbox(lamio, userId);
      expect(changed).toEqual(expect.arrayContaining(["INBOX", "Projets"]));
      expect(inbox().map((m) => [m.subject, m.seen, m.flagged])).toEqual([
        ["Mail 4", false, false],
        ["Facture décembre", false, false],
        ["Mail 2", true, true],
      ]);
      expect(store.listMailMessages(userId, "Projets").messages.map((m) => m.subject)).toEqual(["Mail 1"]);

      // Nothing moved: nothing to report, and no folder is opened.
      expect(await syncMailbox(lamio, userId)).toEqual([]);
    });

    it("suit les dossiers créés et supprimés", async () => {
      const lamio = await connect();
      await syncMailbox(lamio, userId);
      const other = await connect();
      await other.mailboxCreate("Clients");
      await other.mailboxDelete("Projets");
      // The server drops the sessions that had the deleted folder open (RFC 2180): the next pass reconnects.
      expect(await syncMailbox(await connect(), userId)).toContain("*");
      expect(store.listFolders(userId).map((f) => f.path)).toEqual(["INBOX", "Envoyés", "Clients"]);
    });
  });
}

describe("compte mail", () => {
  beforeEach(() => start(["SPECIAL-USE"]));

  it("changer de boîte efface la copie de l'ancienne, débrancher efface tout", async () => {
    await syncMailbox(await connect(), userId);
    expect(inbox()).toHaveLength(3);
    const input = { email: "testuser", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 };
    // Same mailbox, new password: the copy stays.
    store.saveMailAccount(userId, input, "nouveau");
    expect(inbox()).toHaveLength(3);
    store.saveMailAccount(userId, { ...input, email: "autre@exemple.ch", username: "autre@exemple.ch" }, "secret");
    expect(inbox()).toHaveLength(0);
    store.deleteMailAccount(userId);
    expect(store.mailAccountInfo(userId)).toBeNull();
    expect(store.listFolders(userId)).toEqual([]);
  });

  it("supprimer le compte Lamio supprime la boîte et sa copie", async () => {
    await syncMailbox(await connect(), userId);
    users.db().prepare("delete from users where id = ?").run(userId);
    expect(store.mailAccountInfo(userId)).toBeNull();
    expect((users.db().prepare("select count(*) as n from mail_messages").get() as { n: number }).n).toBe(0);
  });
});
