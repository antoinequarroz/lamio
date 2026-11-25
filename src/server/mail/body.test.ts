import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { openMail } from "./body";
import { imapClient } from "./connect";
import { htmlToReadable } from "./preview";
import * as store from "./store";
import { syncMailbox } from "./sync";

const html =
  'From: Bob <bob@exemple.ch>\r\nTo: Antoine <antoine@exemple.ch>\r\nSubject: Newsletter\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary="b"\r\n\r\n--b\r\nContent-Type: text/html; charset=iso-8859-1\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\n<h1>Caf=E9</h1><p>Lire <a href=3D"https://exemple.ch/a">l\'article</a><br>Fin</p><script>alert(1)</script>\r\n--b\r\nContent-Type: application/pdf; name="plan.pdf"\r\nContent-Disposition: attachment; filename="plan.pdf"\r\nContent-Transfer-Encoding: base64\r\n\r\nJVBERi0xLjQK\r\n--b--\r\n';

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;
const connect = () => {
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  return c;
};

beforeEach(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "body-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "testuser", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({ plugins: ["SPECIAL-USE"], storage: { INBOX: { messages: [{ raw: html }] } } });
  await new Promise<void>((r) => server.listen(0, r));
  const c = connect();
  await c.connect();
  await syncMailbox(c, userId);
  await c.logout();
});

afterEach(() => new Promise<void>((r) => server.close(r)));

describe("ouvrir un mail", () => {
  it("lit le texte (HTML mis en texte, sans script), liste les pièces jointes et le marque comme lu sur le serveur", async () => {
    expect(store.listFolders(userId)[0].unread).toBe(1);
    const mail = await openMail(userId, "INBOX", 1, connect);
    expect(mail).toMatchObject({ subject: "Newsletter", seen: true, fromHtml: true, attachmentList: [{ name: "plan.pdf", type: "application/pdf" }] });
    expect(mail!.text).toBe("Café\nLire l'article (https://exemple.ch/a)\nFin");
    expect(store.listFolders(userId)[0].unread).toBe(0);

    const check = connect();
    await check.connect();
    expect(await check.status("INBOX", { unseen: true })).toMatchObject({ unseen: 0 });
    await check.logout();

    // Opened again: from the local copy, without the server.
    expect((await openMail(userId, "INBOX", 1, () => null))?.text).toBe(mail!.text);
  });

  it("un mail disparu entre-temps n'est plus proposé", async () => {
    const c = connect();
    await c.connect();
    const lock = await c.getMailboxLock("INBOX");
    await c.messageDelete({ uid: "1" }, { uid: true });
    lock.release();
    await c.logout();
    expect(await openMail(userId, "INBOX", 1, connect)).toBeNull();
    expect(store.listMailMessages(userId, "INBOX").messages).toHaveLength(0);
  });
});

describe("HTML en texte lisible", () => {
  it("garde les paragraphes et les liens", () => {
    expect(htmlToReadable("<div>Bonjour</div><ul><li>Un</li><li>Deux</li></ul><p>Voir <a href='https://a.ch'>ici</a></p>")).toBe("Bonjour\n• Un\n• Deux\nVoir ici (https://a.ch)");
  });
});
