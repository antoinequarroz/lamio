import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { applyAction, createFolder, deleteFolder, renameFolder } from "./actions";
import { imapClient, mailError } from "./connect";
import * as store from "./store";
import { syncMailbox } from "./sync";

const mail = (n: number) => ({ raw: `From: a${n}@x.ch\r\nSubject: Mail ${n}\r\nContent-Type: text/plain\r\n\r\nTexte ${n}\r\n`, flags: n === 1 ? ["\\Seen"] : [] });

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;
const connect = () => {
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  return c;
};
const resync = async () => {
  const c = connect();
  await c.connect();
  await syncMailbox(c, userId, { full: true });
  await c.logout();
};
const subjects = (folder: string) => store.listMailMessages(userId, folder).messages.map((m) => m.subject).sort();
const serverFlags = async (folder: string) => {
  const c = connect();
  await c.connect();
  const lock = await c.getMailboxLock(folder);
  const out: Record<string, string[]> = {};
  for await (const m of c.fetch("1:*", { envelope: true, flags: true })) out[m.envelope!.subject!] = [...m.flags!].sort();
  lock.release();
  await c.logout();
  return out;
};

beforeEach(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "actions-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "testuser", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({
    plugins: ["SPECIAL-USE", "UIDPLUS", "MOVE"],
    storage: {
      INBOX: { messages: [mail(1), mail(2), mail(3), mail(4)] },
      "": { separator: "/", folders: { Archives: { "special-use": "\\Archive" }, Corbeille: { "special-use": "\\Trash" }, Spam: { "special-use": "\\Junk" }, Clients: {} } },
    },
  });
  await new Promise<void>((r) => server.listen(0, r));
  await resync();
});

afterEach(() => new Promise<void>((r) => server.close(r)));

describe("ranger ses mails", () => {
  it("marque lu, non lu et signalé sur le serveur, et les compteurs suivent", async () => {
    expect(store.listFolders(userId).find((f) => f.path === "INBOX")!.unread).toBe(3);
    await applyAction(userId, "INBOX", [2, 3], { type: "seen", value: true }, connect);
    expect(store.listFolders(userId).find((f) => f.path === "INBOX")!.unread).toBe(1);
    await applyAction(userId, "INBOX", [1], { type: "seen", value: false }, connect);
    await applyAction(userId, "INBOX", [4], { type: "flagged", value: true }, connect);
    expect(store.listFolders(userId).find((f) => f.path === "INBOX")!.unread).toBe(2);
    expect(await serverFlags("INBOX")).toEqual({ "Mail 1": [], "Mail 2": ["\\Seen"], "Mail 3": ["\\Seen"], "Mail 4": ["\\Flagged"] });
  });

  it("archive, met à la corbeille, en spam, déplace, puis supprime pour de bon", async () => {
    const archived = await applyAction(userId, "INBOX", [1, 2], { type: "archive" }, connect);
    expect(archived.moved?.to).toBe("Archives");
    expect(archived.moved?.uids).toHaveLength(2);
    expect(subjects("INBOX")).toEqual(["Mail 3", "Mail 4"]);
    await applyAction(userId, "INBOX", [3], { type: "trash" }, connect);
    await applyAction(userId, "INBOX", [4], { type: "move", to: "Clients" }, connect);
    await resync();
    expect(subjects("INBOX")).toEqual([]);
    expect(subjects("Archives")).toEqual(["Mail 1", "Mail 2"]);
    expect(subjects("Corbeille")).toEqual(["Mail 3"]);
    expect(subjects("Clients")).toEqual(["Mail 4"]);

    // Back where it was: what "Annuler" does.
    await applyAction(userId, "Archives", archived.moved!.uids, { type: "move", to: "INBOX" }, connect);
    await applyAction(userId, "Corbeille", store.listMailMessages(userId, "Corbeille").messages.map((m) => m.uid), { type: "delete" }, connect);
    await resync();
    expect(subjects("INBOX")).toEqual(["Mail 1", "Mail 2"]);
    expect(subjects("Corbeille")).toEqual([]);
    expect(await serverFlags("Corbeille")).toEqual({});
  });

  it("refuse un dossier qui n'existe plus avec un message clair", async () => {
    const e = await applyAction(userId, "INBOX", [1], { type: "move", to: "Nulle part" }, connect).catch((x) => x);
    expect(mailError(e).message).toBe("Ce dossier n'existe plus");
  });

  it("crée, renomme et supprime un dossier ; les dossiers spéciaux sont protégés", async () => {
    expect(await createFolder(userId, "Projets", null, connect)).toBe("Projets");
    await resync();
    expect(await createFolder(userId, "Lamio", "Projets", connect)).toBe("Projets/Lamio");
    await resync();
    expect(await renameFolder(userId, "Projets/Lamio", "Postmelo", connect)).toBe("Projets/Postmelo");
    await resync();
    expect(store.listFolders(userId).map((f) => f.path)).toContain("Projets/Postmelo");
    await deleteFolder(userId, "Projets/Postmelo", connect);
    await resync();
    expect(store.listFolders(userId).map((f) => f.path)).not.toContain("Projets/Postmelo");
    await expect(deleteFolder(userId, "Corbeille", connect)).rejects.toThrow("ne peut pas être supprimé");
    await expect(createFolder(userId, "a/b", null, connect)).rejects.toThrow("Nom de dossier invalide");
    await expect(createFolder(userId, "clients", null, connect)).rejects.toThrow("déjà");
  });
});
