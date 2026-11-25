import "server-only";
import type { ImapFlow } from "imapflow";
import type { MailAction } from "@/lib/types";
import { imapClient, MailProblem } from "./connect";
import { settingsFor } from "./service";
import * as store from "./store";

/*
 * Tidying the mailbox from Lamio: everything is done on the real mailbox (IMAP), then on the local
 * copy at once, so the list follows without waiting for a sync. The webmail and the iPhone see the
 * same thing, and what they do comes back the other way through the live connection (live.ts).
 */

export type { MailAction };

export type ActionResult = { folders: string[]; moved?: { to: string; uids: number[] } };

function defaultConnect(userId: string) {
  const settings = settingsFor(userId);
  return settings ? imapClient(settings) : null;
}

async function withClient<T>(userId: string, connect: (userId: string) => ImapFlow | null, run: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = connect(userId);
  if (!client) throw new MailProblem("Aucune boîte mail branchée");
  client.on("error", () => {});
  try {
    await client.connect();
    return await run(client);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

const ROLE: Record<string, { use: string; missing: string }> = {
  archive: { use: "\\Archive", missing: "Cette boîte n'a pas de dossier Archives" },
  trash: { use: "\\Trash", missing: "Cette boîte n'a pas de Corbeille" },
  spam: { use: "\\Junk", missing: "Cette boîte n'a pas de dossier Spam" },
};

/** Where an action sends the mails, or null when they stay in their folder. */
function destination(userId: string, folder: string, action: MailAction): string | null {
  if (action.type === "move") {
    if (!store.listFolders(userId).some((f) => f.path === action.to)) throw new MailProblem("Ce dossier n'existe plus");
    return action.to;
  }
  const role = ROLE[action.type];
  if (!role) return null;
  const to = store.specialFolder(userId, role.use);
  if (!to) throw new MailProblem(role.missing);
  return to;
}

export async function applyAction(userId: string, folder: string, uids: number[], action: MailAction, connect: (userId: string) => ImapFlow | null = defaultConnect): Promise<ActionResult> {
  const mails = store.mailSummaries(userId, folder, uids);
  if (!mails.length) return { folders: [] };
  const range = mails.map((m) => m.uid).join(",");
  const to = destination(userId, folder, action);
  if (to === folder) return { folders: [] };

  return withClient(userId, connect, async (client) => {
    const lock = await client.getMailboxLock(folder);
    try {
      if (action.type === "seen" || action.type === "flagged") {
        const flag = action.type === "seen" ? "\\Seen" : "\\Flagged";
        if (action.value) await client.messageFlagsAdd(range, [flag], { uid: true });
        else await client.messageFlagsRemove(range, [flag], { uid: true });
        const changed = mails.filter((m) => m[action.type] !== action.value);
        store.updateFlags(userId, folder, new Map(mails.map((m) => [m.uid, { seen: m.seen, flagged: m.flagged, answered: m.answered, [action.type]: action.value }])));
        if (action.type === "seen") store.adjustUnread(userId, folder, action.value ? -changed.length : changed.length);
        return { folders: [folder] };
      }
      if (action.type === "delete") {
        await client.messageDelete(range, { uid: true });
        store.removeMessages(userId, folder, mails.map((m) => m.uid));
        store.adjustUnread(userId, folder, -mails.filter((m) => !m.seen).length);
        return { folders: [folder] };
      }
      // A move: archive, trash, spam or another folder.
      const res = await client.messageMove(range, to!, { uid: true });
      store.removeMessages(userId, folder, mails.map((m) => m.uid));
      store.adjustUnread(userId, folder, -mails.filter((m) => !m.seen).length);
      const map = res && typeof res === "object" && "uidMap" in res ? (res.uidMap as Map<number, number> | undefined) : undefined;
      return { folders: [folder, to!], moved: { to: to!, uids: map ? mails.map((m) => map.get(m.uid)).filter((u): u is number => typeof u === "number") : [] } };
    } finally {
      lock.release();
    }
  });
}

// ---- Folders

const PROTECTED = new Set(["\\Inbox", "\\Sent", "\\Drafts", "\\Trash", "\\Junk", "\\Archive", "\\All", "\\Flagged"]);

function cleanName(name: string): string {
  const n = name.trim();
  if (!n || n.length > 100 || /[/\\\u0000-\u001f]/.test(n) || n === "." || n === "..") throw new MailProblem("Nom de dossier invalide");
  return n;
}

function folderOf(userId: string, path: string) {
  const f = store.listFolders(userId).find((x) => x.path === path);
  if (!f) throw new MailProblem("Ce dossier n'existe plus");
  return f;
}

/** A new folder, at the top or inside another one. Returns its path. */
export async function createFolder(userId: string, name: string, parent: string | null, connect = defaultConnect): Promise<string> {
  const n = cleanName(name);
  const delimiter = store.listFolders(userId)[0]?.delimiter || "/";
  const path = parent ? `${folderOf(userId, parent).path}${delimiter}${n}` : n;
  if (store.listFolders(userId).some((f) => f.path.toLowerCase() === path.toLowerCase())) throw new MailProblem("Un dossier porte déjà ce nom");
  await withClient(userId, connect, (c) => c.mailboxCreate(path));
  return path;
}

export async function renameFolder(userId: string, path: string, name: string, connect = defaultConnect): Promise<string> {
  const f = folderOf(userId, path);
  if (f.specialUse && PROTECTED.has(f.specialUse)) throw new MailProblem("Ce dossier ne peut pas être renommé");
  const n = cleanName(name);
  const cut = f.delimiter ? path.lastIndexOf(f.delimiter) : -1;
  const next = cut >= 0 ? `${path.slice(0, cut + 1)}${n}` : n;
  if (next === path) return path;
  await withClient(userId, connect, (c) => c.mailboxRename(path, next));
  return next;
}

/** Deletes a folder and the mails in it (on the server too). Special folders are refused. */
export async function deleteFolder(userId: string, path: string, connect = defaultConnect) {
  const f = folderOf(userId, path);
  if (f.specialUse && PROTECTED.has(f.specialUse)) throw new MailProblem("Ce dossier ne peut pas être supprimé");
  await withClient(userId, connect, (c) => c.mailboxDelete(path));
}
