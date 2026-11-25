import "server-only";
import type { FetchMessageObject, ImapFlow, ListResponse, MessageAddressObject } from "imapflow";
import type { MailAddress } from "@/lib/types";
import { hasAttachments, makePreview, previewPart, type StructureNode } from "./preview";
import * as store from "./store";

/*
 * Brings the local copy of a mailbox up to date with the server, incrementally:
 * - folders: as the server lists them (STATUS tells which ones changed since last time);
 * - new mails: the UIDs above the highest one already known;
 * - flags (read, flagged, answered): only the changed ones with CONDSTORE, else all known ones;
 * - deleted or moved mails: the known UIDs the server no longer has;
 * - UIDVALIDITY changed: the folder was renumbered, its copy is rebuilt.
 *
 * Read-only on the server (EXAMINE, BODY.PEEK): syncing never marks a mail as read.
 */

/** How many mails of a folder the first sync brings in. Older ones come later, on demand. */
export const INITIAL_LIMIT = 1000;
const BATCH = 200;

const STATUS_QUERY = { messages: true, unseen: true, uidNext: true, uidValidity: true, highestModseq: true } as const;

const address = (a?: MessageAddressObject[]): MailAddress[] => (a ?? []).filter((x) => x.address || x.name).map((x) => ({ name: x.name ?? "", address: (x.address ?? "").toLowerCase() }));

const flagsOf = (f?: Set<string>): store.MailFlags => ({ seen: !!f?.has("\\Seen"), flagged: !!f?.has("\\Flagged"), answered: !!f?.has("\\Answered") });

const iso = (d: Date | string | undefined) => {
  const t = d ? new Date(d) : null;
  return t && !isNaN(t.getTime()) ? t.toISOString() : new Date(0).toISOString();
};

function header(raw: Buffer | undefined, name: string): string | null {
  if (!raw) return null;
  const m = raw.toString("utf8").replace(/\r?\n[ \t]+/g, " ").match(new RegExp(`^${name}:\\s*(.*)$`, "im"));
  return m ? m[1].trim().slice(0, 4000) || null : null;
}

function toRow(m: FetchMessageObject): store.MailRow {
  const env = m.envelope ?? {};
  const from = address(env.from)[0] ?? address(env.sender)[0] ?? { name: "", address: "" };
  return {
    uid: m.uid,
    messageId: env.messageId ?? null,
    inReplyTo: env.inReplyTo ?? null,
    references: header(m.headers, "references"),
    subject: (env.subject ?? "").slice(0, 1000),
    from,
    to: address(env.to),
    cc: address(env.cc),
    // The date the server received it: reliable, unlike the sender's Date header.
    date: iso(m.internalDate ?? env.date),
    ...flagsOf(m.flags),
    attachments: hasAttachments(m.bodyStructure as StructureNode | undefined),
    size: m.size ?? 0,
  };
}

const selectable = (f: ListResponse) => !f.flags.has("\\Noselect") && !f.flags.has("\\NonExistent");

/** Reads the excerpts of these mails: one FETCH per distinct body part, not one per mail. */
async function fetchPreviews(client: ImapFlow, userId: string, folder: string, messages: FetchMessageObject[]) {
  type Group = { uids: number[]; info: Map<number, NonNullable<ReturnType<typeof previewPart>>> };
  const groups = new Map<string, Group>();
  for (const m of messages) {
    const p = previewPart(m.bodyStructure as StructureNode | undefined);
    if (!p) continue;
    const g: Group = groups.get(p.part) ?? { uids: [], info: new Map() };
    g.uids.push(m.uid);
    g.info.set(m.uid, p);
    groups.set(p.part, g);
  }
  for (const [part, g] of groups) {
    for (let i = 0; i < g.uids.length; i += BATCH) {
      const previews = new Map<number, string>();
      for await (const m of client.fetch(g.uids.slice(i, i + BATCH), { uid: true, bodyParts: [{ key: part, maxLength: 3000 }] }, { uid: true })) {
        const raw = m.bodyParts?.get(part);
        const info = g.info.get(m.uid);
        if (raw && info) previews.set(m.uid, makePreview(raw, info));
      }
      store.setPreviews(userId, folder, previews);
    }
  }
}

export type FolderSync = { changed: boolean; added: number[] };

/**
 * Syncs one folder: "changed" when something visible changed, "added" the UIDs of the new mails.
 * "unread" comes from STATUS when known; null (the folder is the one open, STATUS is not allowed
 * on it) counts the unread mails with a SEARCH.
 */
export async function syncFolder(client: ImapFlow, userId: string, path: string, unread: number | null): Promise<FolderSync> {
  const lock = await client.getMailboxLock(path, { readOnly: true });
  try {
    const box = client.mailbox;
    if (!box) return { changed: false, added: [] };
    const before = store.folderState(userId, path);
    const uidValidity = box.uidValidity.toString();
    let changed = false;
    let added: number[] = [];

    if (before?.uidValidity && before.uidValidity !== uidValidity) {
      store.clearFolderMessages(userId, path);
      changed = true;
    }
    const known = store.uidRange(userId, path);

    // 1. New mails.
    if (box.exists > 0) {
      const range = known.max > 0 ? `${known.max + 1}:*` : `${Math.max(1, box.exists - INITIAL_LIMIT + 1)}:*`;
      const fresh: FetchMessageObject[] = [];
      for await (const m of client.fetch(range, { uid: true, flags: true, envelope: true, internalDate: true, size: true, bodyStructure: true, headers: ["references"] }, { uid: known.max > 0 })) {
        // "n:*" always returns the newest mail, even when its UID is below n.
        if (m.uid > known.max) fresh.push(m);
      }
      if (fresh.length) {
        store.insertMessages(userId, path, fresh.map(toRow));
        await fetchPreviews(client, userId, path, fresh);
        added = fresh.map((m) => m.uid);
        changed = true;
      }
    }

    // 2. Flags and 3. deletions, on the mails known before this pass.
    if (known.count > 0) {
      const modseq = box.highestModseq;
      const useCondstore = modseq !== undefined && !box.noModseq && before?.highestModseq && before.uidValidity === uidValidity;
      if (!useCondstore || before?.highestModseq !== modseq?.toString()) {
        const flags = new Map<number, store.MailFlags>();
        const options = useCondstore ? { uid: true, changedSince: BigInt(before!.highestModseq!) } : { uid: true };
        for await (const m of client.fetch(`${known.min}:${known.max}`, { uid: true, flags: true }, options)) flags.set(m.uid, flagsOf(m.flags));
        if (store.updateFlags(userId, path, flags) > 0) changed = true;
      }
      const onServer = await client.search({ uid: `${known.min}:${known.max}` }, { uid: true });
      if (Array.isArray(onServer)) {
        const present = new Set(onServer);
        const gone = store.cachedUids(userId, path).filter((uid) => uid <= known.max && !present.has(uid));
        if (gone.length && store.removeMessages(userId, path, gone) > 0) changed = true;
      }
    }

    if (unread === null) {
      const unseen = box.exists > 0 ? await client.search({ seen: false }, { uid: true }) : [];
      unread = Array.isArray(unseen) ? unseen.length : (before?.unread ?? 0);
    }
    const state = { uidValidity, uidNext: box.uidNext, highestModseq: box.highestModseq?.toString() ?? null, total: box.exists, unread };
    if (!before || before.total !== state.total || before.unread !== state.unread) changed = true;
    store.updateFolderState(userId, path, state);
    return { changed, added };
  } finally {
    lock.release();
  }
}

/**
 * Syncs the whole mailbox. Only the folders whose STATUS moved are opened, unless "full".
 * Returns the paths of the folders that changed.
 */
export async function syncMailbox(client: ImapFlow, userId: string, options: { full?: boolean } = {}): Promise<string[]> {
  const listed = (await client.list({ statusQuery: STATUS_QUERY })).filter(selectable);
  const before = new Map(store.listFolders(userId).map((f) => [f.path, f]));
  store.setFolderList(
    userId,
    listed.map((f) => ({ path: f.path, name: f.path.toUpperCase() === "INBOX" ? "Boîte de réception" : f.name, delimiter: f.delimiter, specialUse: f.specialUse ?? (f.path.toUpperCase() === "INBOX" ? "\\Inbox" : null) })),
  );
  const changed: string[] = [];
  if (listed.length !== before.size || listed.some((f) => !before.has(f.path))) changed.push("*");

  for (const f of listed) {
    const s = f.status;
    const prev = store.folderState(userId, f.path);
    const moved =
      !prev?.uidValidity ||
      !s ||
      prev.uidValidity !== s.uidValidity?.toString() ||
      prev.uidNext !== (s.uidNext ?? null) ||
      prev.total !== (s.messages ?? 0) ||
      prev.unread !== (s.unseen ?? 0) ||
      (s.highestModseq !== undefined && prev.highestModseq !== s.highestModseq.toString());
    if (!moved && !options.full) continue;
    try {
      if ((await syncFolder(client, userId, f.path, s?.unseen ?? 0)).changed) changed.push(f.path);
    } catch (e) {
      // A folder deleted meanwhile, or one the server refuses to open: the others still sync.
      if (!client.usable) throw e;
    }
  }
  return changed;
}
