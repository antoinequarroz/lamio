import "server-only";
import { db } from "@/server/db";
import type { MailAccountInfo, MailAttachment, MailIdentity, MailAddress, MailCategory, MailFolder, MailNotify, MailStatus, MailSummary } from "@/lib/types";
import type { MailKind, Unsubscribe } from "./sort";

const now = () => new Date().toISOString();

// ---- Account

export type MailAccountInput = { email: string; username: string; imapHost: string; imapPort: number; smtpHost: string; smtpPort: number };

type AccountRow = {
  user_id: string;
  email: string;
  username: string;
  imap_host: string;
  imap_port: number;
  smtp_host: string;
  smtp_port: number;
  secret: string;
  status: MailStatus;
  last_error: string | null;
  synced_at: string | null;
  signature: string | null;
  notify: string | null;
};

const toInfo = (r: AccountRow): MailAccountInfo => ({
  email: r.email,
  username: r.username,
  imapHost: r.imap_host,
  imapPort: r.imap_port,
  smtpHost: r.smtp_host,
  smtpPort: r.smtp_port,
  status: r.status,
  lastError: r.last_error,
  syncedAt: r.synced_at,
  signature: r.signature ?? "",
  notify: r.notify === "known" || r.notify === "off" || r.notify === "important" ? r.notify : "all",
  // Known by the mail service only: the routes fill it in.
  live: false,
  identities: [{ address: r.email, name: "", signature: r.signature ?? "", primary: true }, ...extraIdentities(r.user_id).filter((i) => i.address.toLowerCase() !== r.email.toLowerCase())],
});

type IdentityRow = { address: string; name: string; signature: string };

const extraIdentities = (userId: string): MailIdentity[] =>
  (db().prepare("select address, name, signature from mail_identities where user_id = ? order by position, created_at").all(userId) as IdentityRow[]).map((r) => ({ ...r, primary: false }));

/** Replaces the other addresses I send from (the mailbox's own stays, with its signature). */
export function setIdentities(userId: string, list: { address: string; name: string; signature: string }[]) {
  const now = new Date().toISOString();
  db().transaction(() => {
    db().prepare("delete from mail_identities where user_id = ?").run(userId);
    const insert = db().prepare("insert or ignore into mail_identities (user_id, address, name, signature, position, created_at) values (?, ?, ?, ?, ?, ?)");
    list.forEach((i, n) => insert.run(userId, i.address.toLowerCase(), i.name, i.signature, n, now));
  })();
}

/** The identity to send from: the one with this address, else the mailbox's own. */
export function identityFor(userId: string, address: string | null | undefined): MailIdentity | null {
  const ids = mailAccountInfo(userId)?.identities ?? [];
  const a = (address ?? "").toLowerCase();
  return ids.find((i) => a && i.address.toLowerCase() === a) ?? ids[0] ?? null;
}

const accountRow = (userId: string) => db().prepare("select * from mail_accounts where user_id = ?").get(userId) as AccountRow | undefined;

/** What the person may see of their account: everything but the password. */
export function mailAccountInfo(userId: string): MailAccountInfo | null {
  const r = accountRow(userId);
  return r ? toInfo(r) : null;
}

/** For the server only: the settings with the encrypted password. */
export function mailAccount(userId: string): (MailAccountInput & { secret: string; status: MailStatus }) | null {
  const r = accountRow(userId);
  return r ? { ...toInfo(r), secret: r.secret } : null;
}

export const mailAccountUsers = () => (db().prepare("select user_id from mail_accounts").all() as { user_id: string }[]).map((r) => r.user_id);

/**
 * Saves the mailbox settings. When it is another mailbox (address, login or server changed),
 * the local copy of the previous one is dropped.
 */
export function saveMailAccount(userId: string, input: MailAccountInput, secret: string) {
  db().transaction(() => {
    const old = accountRow(userId);
    const sameBox = old && old.email === input.email && old.username === input.username && old.imap_host === input.imapHost && old.imap_port === input.imapPort;
    if (!sameBox) db().prepare("delete from mail_folders where user_id = ?").run(userId);
    db()
      .prepare(
        `insert into mail_accounts (user_id, email, username, imap_host, imap_port, smtp_host, smtp_port, secret, status, last_error, synced_at, created_at)
         values (@userId, @email, @username, @imapHost, @imapPort, @smtpHost, @smtpPort, @secret, 'pending', null, null, @now)
         on conflict (user_id) do update set email = @email, username = @username, imap_host = @imapHost, imap_port = @imapPort,
           smtp_host = @smtpHost, smtp_port = @smtpPort, secret = @secret, status = 'pending', last_error = null,
           synced_at = case when @keep then synced_at else null end`,
      )
      .run({ userId, ...input, secret, now: now(), keep: sameBox ? 1 : 0 });
  })();
}

/** Unplugs the mailbox: the settings, the password and the whole local copy go. */
export function deleteMailAccount(userId: string) {
  db().transaction(() => {
    db().prepare("delete from mail_folders where user_id = ?").run(userId);
    db().prepare("delete from mail_accounts where user_id = ?").run(userId);
  })();
}

export function setMailStatus(userId: string, status: MailStatus, error: string | null = null) {
  const synced = status === "ok" ? now() : null;
  db().prepare("update mail_accounts set status = ?, last_error = ?, synced_at = coalesce(?, synced_at) where user_id = ?").run(status, error, synced, userId);
}

// ---- Folders

type FolderRow = { path: string; name: string; delimiter: string; special_use: string | null; uid_validity: string | null; uid_next: number | null; highest_modseq: string | null; total: number; unread: number };

// The usual order of a mail app: the special folders first, then the others by name.
const SPECIAL_ORDER = ["\\Inbox", "\\Flagged", "\\Drafts", "\\Sent", "\\Archive", "\\Junk", "\\Trash"];

export function listFolders(userId: string): MailFolder[] {
  const rows = db().prepare("select * from mail_folders where user_id = ?").all(userId) as FolderRow[];
  const rank = (f: FolderRow) => {
    const i = f.special_use ? SPECIAL_ORDER.indexOf(f.special_use) : -1;
    return i === -1 ? SPECIAL_ORDER.length : i;
  };
  return rows
    .sort((a, b) => rank(a) - rank(b) || a.path.localeCompare(b.path, "fr", { sensitivity: "base" }))
    .map((r) => ({ path: r.path, name: r.name, delimiter: r.delimiter, specialUse: r.special_use, total: r.total, unread: r.unread }));
}

export type FolderSyncState = { uidValidity: string | null; uidNext: number | null; highestModseq: string | null; total: number; unread: number };

export function folderState(userId: string, path: string): FolderSyncState | null {
  const r = db().prepare("select * from mail_folders where user_id = ? and path = ?").get(userId, path) as FolderRow | undefined;
  return r ? { uidValidity: r.uid_validity, uidNext: r.uid_next, highestModseq: r.highest_modseq, total: r.total, unread: r.unread } : null;
}

/** The folders as the server lists them: new ones are added, gone ones removed with their messages. */
export function setFolderList(userId: string, folders: { path: string; name: string; delimiter: string; specialUse: string | null }[]) {
  db().transaction(() => {
    const upsert = db().prepare(
      `insert into mail_folders (user_id, path, name, delimiter, special_use) values (?, ?, ?, ?, ?)
       on conflict (user_id, path) do update set name = excluded.name, delimiter = excluded.delimiter, special_use = excluded.special_use`,
    );
    for (const f of folders) upsert.run(userId, f.path, f.name, f.delimiter, f.specialUse);
    const keep = new Set(folders.map((f) => f.path));
    const remove = db().prepare("delete from mail_folders where user_id = ? and path = ?");
    for (const { path } of db().prepare("select path from mail_folders where user_id = ?").all(userId) as { path: string }[]) if (!keep.has(path)) remove.run(userId, path);
  })();
}

export function updateFolderState(userId: string, path: string, s: FolderSyncState) {
  db().prepare("update mail_folders set uid_validity = ?, uid_next = ?, highest_modseq = ?, total = ?, unread = ? where user_id = ? and path = ?").run(s.uidValidity, s.uidNext, s.highestModseq, s.total, s.unread, userId, path);
}

/** The server renumbered the folder (UIDVALIDITY changed): its local copy is worthless. */
export const clearFolderMessages = (userId: string, path: string) => db().prepare("delete from mail_messages where user_id = ? and folder = ?").run(userId, path);

// ---- Messages

export type MailRow = {
  uid: number;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  subject: string;
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  date: string;
  seen: boolean;
  flagged: boolean;
  answered: boolean;
  attachments: boolean;
  size: number;
  /** What the headers say it is (sort.ts), "" for an ordinary mail. */
  kind: MailKind;
  unsubscribe: Unsubscribe | null;
};

export type MailFlags = { seen: boolean; flagged: boolean; answered: boolean };

export function uidRange(userId: string, folder: string): { min: number; max: number; count: number } {
  const r = db().prepare("select min(uid) as min, max(uid) as max, count(*) as count from mail_messages where user_id = ? and folder = ?").get(userId, folder) as { min: number | null; max: number | null; count: number };
  return { min: r.min ?? 0, max: r.max ?? 0, count: r.count };
}

export const cachedUids = (userId: string, folder: string) => (db().prepare("select uid from mail_messages where user_id = ? and folder = ?").all(userId, folder) as { uid: number }[]).map((r) => r.uid);

export function insertMessages(userId: string, folder: string, rows: MailRow[]) {
  const insert = db().prepare(
    `insert or replace into mail_messages (user_id, folder, uid, message_id, in_reply_to, refs, subject, from_name, from_address, recipients, date, seen, flagged, answered, attachments, size, thread_id, kind, unsubscribe)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db().transaction(() => {
    // Oldest first, so a reply finds the conversation of the mail it answers.
    for (const m of [...rows].sort((a, b) => a.date.localeCompare(b.date))) {
      const thread = threadOf(userId, { folder, uid: m.uid, messageId: m.messageId, inReplyTo: m.inReplyTo, refs: m.references, subject: m.subject, from: m.from.address, to: [...m.to, ...m.cc].map((x) => x.address), date: m.date });
      insert.run(userId, folder, m.uid, m.messageId, m.inReplyTo, m.references, m.subject, m.from.name, m.from.address, JSON.stringify({ to: m.to, cc: m.cc }), m.date, +m.seen, +m.flagged, +m.answered, +m.attachments, m.size, thread, m.kind, m.unsubscribe ? JSON.stringify(m.unsubscribe) : null);
      adopt(userId, m.messageId, thread);
    }
  })();
}

// ---- Conversations

/** "Re: TR: Fwd: AW: Devis" → "devis": what stays of a subject along a conversation. */
export function baseSubject(subject: string): string {
  let s = subject.trim().toLowerCase();
  for (let prev = ""; prev !== s; ) {
    prev = s;
    s = s.replace(/^(re|tr|fw|fwd|aw|wg|rif|sv|vs|réf|ref)\s*(\[\d+\])?\s*:\s*/i, "").replace(/^\[[^\]]{1,40}\]\s*/, "").trim();
  }
  return s.replace(/\s+/g, " ");
}

const REPLY_PREFIX = /^\s*(re|tr|fw|fwd|aw|wg|rif|sv|vs)\s*(\[\d+\])?\s*:/i;
const SUBJECT_WINDOW_MS = 60 * 86_400_000;

type ThreadInput = { folder: string; uid: number; messageId: string | null; inReplyTo: string | null; refs: string | null; subject: string; from: string; to: string[]; date: string };

/**
 * The conversation of a mail. By its headers first: the conversation of a mail it answers or cites
 * (References, In-Reply-To), else the first of those ids, else its own Message-ID. For a reply
 * without headers (some mail apps drop them): the mail with the same subject, between the same
 * people, in the last 60 days. Alone otherwise.
 */
export function threadOf(userId: string, m: ThreadInput): string {
  const ids = [...(m.refs ?? "").split(/\s+/), m.inReplyTo ?? ""].map((x) => x.trim()).filter(Boolean);
  if (ids.length) {
    const known = db()
      .prepare(`select thread_id from mail_messages where user_id = ? and thread_id is not null and message_id in (${ids.map(() => "?").join(",")}) limit 1`)
      .get(userId, ...ids) as { thread_id: string } | undefined;
    return known?.thread_id ?? ids[0];
  }
  if (REPLY_PREFIX.test(m.subject) && baseSubject(m.subject)) {
    // The other people of the exchange: I am in every mail, I do not make two mails one conversation.
    const me = (mailAccountInfo(userId)?.email ?? "").toLowerCase();
    const people = [m.from, ...m.to].map((a) => a.toLowerCase()).filter((a) => a && a !== me);
    const since = new Date(Date.parse(m.date) - SUBJECT_WINDOW_MS).toISOString();
    const rows = db()
      .prepare("select thread_id, subject, from_address, recipients from mail_messages where user_id = ? and thread_id is not null and date >= ? and date <= ? order by date desc limit 400")
      .all(userId, since, m.date) as { thread_id: string; subject: string; from_address: string; recipients: string }[];
    const base = baseSubject(m.subject);
    for (const r of rows) {
      if (baseSubject(r.subject) !== base) continue;
      const { to = [], cc = [] } = JSON.parse(r.recipients || "{}") as { to?: MailAddress[]; cc?: MailAddress[] };
      const theirs = [r.from_address, ...to.map((x) => x.address), ...cc.map((x) => x.address)].map((a) => (a ?? "").toLowerCase());
      if (people.some((p) => theirs.includes(p))) return r.thread_id;
    }
  }
  return m.messageId ?? `${m.folder}:${m.uid}`;
}

/** Replies that arrived before the mail they answer: they join its conversation now. */
function adopt(userId: string, messageId: string | null, thread: string) {
  if (messageId && messageId !== thread) db().prepare("update mail_messages set thread_id = ? where user_id = ? and thread_id = ?").run(thread, userId, messageId);
}

/** Mails copied before conversations existed get theirs, oldest first. */
export function ensureThreads(userId: string) {
  const rows = db()
    .prepare("select folder, uid, message_id, in_reply_to, refs, subject, from_address, recipients, date from mail_messages where user_id = ? and thread_id is null order by date asc")
    .all(userId) as { folder: string; uid: number; message_id: string | null; in_reply_to: string | null; refs: string | null; subject: string; from_address: string; recipients: string; date: string }[];
  if (!rows.length) return;
  const set = db().prepare("update mail_messages set thread_id = ? where user_id = ? and folder = ? and uid = ?");
  db().transaction(() => {
    for (const r of rows) {
      const { to = [], cc = [] } = JSON.parse(r.recipients || "{}") as { to?: MailAddress[]; cc?: MailAddress[] };
      const thread = threadOf(userId, { folder: r.folder, uid: r.uid, messageId: r.message_id, inReplyTo: r.in_reply_to, refs: r.refs, subject: r.subject, from: r.from_address, to: [...to, ...cc].map((x) => x.address), date: r.date });
      set.run(thread, userId, r.folder, r.uid);
      adopt(userId, r.message_id, thread);
    }
  })();
}

/** Folders a conversation does not reach into, unless one is the folder being looked at. */
function outsideFolders(userId: string, folder: string): string[] {
  return ["\\Trash", "\\Junk"].map((u) => specialFolder(userId, u)).filter((f): f is string => !!f && f !== folder);
}

/** The conversations of a folder, newest first, each shown with its newest mail of the folder. */
export function listMailThreads(userId: string, folder: string, before?: { date: string; uid: number }, limit = MAIL_PAGE, category?: MailCategory): { messages: MailSummary[]; hasMore: boolean } {
  ensureThreads(userId);
  const c = categorized(userId, folder);
  const rows = db()
    .prepare(
      `select * from (
         select m.*, row_number() over (partition by thread_id order by date desc, uid desc) as rn,
                sum(1 - seen) over (partition by thread_id) as thread_unread,
                group_concat(uid) over (partition by thread_id) as thread_uids
         from ${c.sql} m ${category ? "where category = ?" : ""}
       ) where rn = 1 ${before ? "and (date < ? or (date = ? and uid < ?))" : ""}
       order by date desc, uid desc limit ?`,
    )
    .all(...[...c.params, ...(category ? [category] : []), ...(before ? [before.date, before.date, before.uid] : []), limit + 1]) as (MessageRow & { thread_id: string; thread_unread: number; thread_uids: string })[];
  const page = rows.slice(0, limit);
  const me = (mailAccountInfo(userId)?.email ?? "").toLowerCase();
  const outside = outsideFolders(userId, folder);
  const members = page.length
    ? (db()
        .prepare(
          `select thread_id, message_id, from_name, from_address from mail_messages
           where user_id = ? and thread_id in (${page.map(() => "?").join(",")}) ${outside.length ? `and folder not in (${outside.map(() => "?").join(",")})` : ""}
           order by date asc`,
        )
        .all(userId, ...page.map((r) => r.thread_id), ...outside) as { thread_id: string; message_id: string | null; from_name: string; from_address: string }[])
    : [];
  return {
    messages: page.map((r) => {
      const mine = members.filter((x) => x.thread_id === r.thread_id);
      // The same mail can sit in two folders (copied, or a Gmail label): counted once.
      const count = new Set(mine.map((x, i) => x.message_id ?? `#${i}`)).size;
      const participants = [...new Set(mine.map((x) => (x.from_address.toLowerCase() === me ? "moi" : x.from_name || x.from_address)))];
      const uids = r.thread_uids.split(",").map(Number);
      return { ...toSummary(r), thread: { id: r.thread_id, count: Math.max(count, uids.length), unread: r.thread_unread, uids, participants } };
    }),
    hasMore: rows.length > limit,
  };
}

/** Every mail of the conversation of this one, oldest first (not from Trash or Spam unless looking there). */
export function threadMessages(userId: string, folder: string, uid: number): MailSummary[] {
  ensureThreads(userId);
  const head = db().prepare("select thread_id from mail_messages where user_id = ? and folder = ? and uid = ?").get(userId, folder, uid) as { thread_id: string | null } | undefined;
  if (!head?.thread_id) return mailSummaries(userId, folder, [uid]);
  const outside = outsideFolders(userId, folder);
  const rows = db()
    .prepare(`select * from mail_messages where user_id = ? and thread_id = ? ${outside.length ? `and folder not in (${outside.map(() => "?").join(",")})` : ""} order by date asc, uid asc`)
    .all(userId, head.thread_id, ...outside) as MessageRow[];
  // A mail in two folders: the copy of the folder being looked at wins.
  const seen = new Map<string, MessageRow>();
  for (const r of rows) {
    const key = r.message_id ?? `${r.folder}:${r.uid}`;
    const had = seen.get(key);
    if (!had || (r.folder === folder && had.folder !== folder)) seen.set(key, r);
  }
  return [...seen.values()].sort((a, b) => a.date.localeCompare(b.date) || a.uid - b.uid).map(toSummary);
}

export function setPreviews(userId: string, folder: string, previews: Map<number, string>) {
  const update = db().prepare("update mail_messages set preview = ? where user_id = ? and folder = ? and uid = ?");
  db().transaction(() => {
    for (const [uid, preview] of previews) update.run(preview, userId, folder, uid);
  })();
}

/** Applies the flags read on the server. Returns how many messages actually changed. */
export function updateFlags(userId: string, folder: string, flags: Map<number, MailFlags>): number {
  const update = db().prepare("update mail_messages set seen = ?, flagged = ?, answered = ? where user_id = ? and folder = ? and uid = ? and not (seen = ? and flagged = ? and answered = ?)");
  let changed = 0;
  db().transaction(() => {
    for (const [uid, f] of flags) changed += update.run(+f.seen, +f.flagged, +f.answered, userId, folder, uid, +f.seen, +f.flagged, +f.answered).changes;
  })();
  return changed;
}

export function removeMessages(userId: string, folder: string, uids: number[]): number {
  const remove = db().prepare("delete from mail_messages where user_id = ? and folder = ? and uid = ?");
  let n = 0;
  db().transaction(() => {
    for (const uid of uids) n += remove.run(userId, folder, uid).changes;
  })();
  return n;
}

type MessageRow = {
  folder: string;
  uid: number;
  message_id: string | null;
  subject: string;
  from_name: string;
  from_address: string;
  recipients: string;
  date: string;
  preview: string;
  seen: number;
  flagged: number;
  answered: number;
  attachments: number;
  size: number;
  /** Only when listed through categorized(). */
  category?: MailCategory;
  unsubscribe?: string | null;
};

function toSummary(r: MessageRow): MailSummary {
  const { to = [], cc = [] } = JSON.parse(r.recipients || "{}") as { to?: MailAddress[]; cc?: MailAddress[] };
  return {
    folder: r.folder,
    uid: r.uid,
    messageId: r.message_id,
    subject: r.subject,
    from: { name: r.from_name, address: r.from_address },
    to,
    cc,
    date: r.date,
    preview: r.preview,
    seen: !!r.seen,
    flagged: !!r.flagged,
    answered: !!r.answered,
    attachments: !!r.attachments,
    size: r.size,
    ...(r.category && { category: r.category }),
    ...(r.unsubscribe && { unsubscribe: true }),
  };
}

export const MAIL_PAGE = 50;

/** The newest messages of a folder, a page at a time ("before": the date and uid of the last one shown). */
export function listMailMessages(userId: string, folder: string, before?: { date: string; uid: number }, limit = MAIL_PAGE, category?: MailCategory): { messages: MailSummary[]; hasMore: boolean } {
  const c = categorized(userId, folder);
  const where = [category && "category = ?", before && "(date < ? or (date = ? and uid < ?))"].filter(Boolean);
  const rows = db()
    .prepare(`select * from ${c.sql} m ${where.length ? `where ${where.join(" and ")}` : ""} order by date desc, uid desc limit ?`)
    .all(...c.params, ...(category ? [category] : []), ...(before ? [before.date, before.date, before.uid] : []), limit + 1) as MessageRow[];
  return { messages: rows.slice(0, limit).map(toSummary), hasMore: rows.length > limit };
}

/** These mails, newest first: what the live update carries to the app. */
export function mailSummaries(userId: string, folder: string, uids: number[]): MailSummary[] {
  if (!uids.length) return [];
  const c = categorized(userId, folder);
  const rows = db().prepare(`select * from ${c.sql} m where uid in (${uids.map(() => "?").join(",")})`).all(...c.params, ...uids) as MessageRow[];
  return rows
    .map(toSummary)
    .sort((a, b) => b.date.localeCompare(a.date) || b.uid - a.uid);
}

// ---- Opened mails

/** The opened mail, kept. v changes when its shape does: an older one is read again from the server. */
export type MailBody = { v: 2; text: string; html: string | null; remoteImages: boolean; attachmentList: MailAttachment[] };
type Body = MailBody;

export function mailBody(userId: string, folder: string, uid: number): Body | null {
  const r = db().prepare("select body_text from mail_messages where user_id = ? and folder = ? and uid = ?").get(userId, folder, uid) as { body_text: string | null } | undefined;
  if (!r?.body_text) return null;
  try {
    const body = JSON.parse(r.body_text) as Body;
    return body.v === 2 ? body : null;
  } catch {
    return null;
  }
}

export const setMailBody = (userId: string, folder: string, uid: number, body: Body) =>
  db().prepare("update mail_messages set body_text = ? where user_id = ? and folder = ? and uid = ?").run(JSON.stringify(body), userId, folder, uid);

/** Opened here: the unread count drops at once, without waiting for the next sync. */
export const adjustUnread = (userId: string, folder: string, delta: number) =>
  db().prepare("update mail_folders set unread = max(0, unread + ?) where user_id = ? and path = ?").run(delta, userId, folder);

/** The inbox's unread mails, or null without a mailbox: the badge of the Mails tab. */
export function inboxUnread(userId: string): number | null {
  if (!db().prepare("select 1 from mail_accounts where user_id = ?").get(userId)) return null;
  const r = db().prepare("select unread from mail_folders where user_id = ? and special_use = '\\Inbox'").get(userId) as { unread: number } | undefined;
  return r?.unread ?? 0;
}

// ---- Senders whose remote images are always shown

const normal = (address: string) => address.trim().toLowerCase();

export const isTrustedSender = (userId: string, address: string) =>
  !!address && !!db().prepare("select 1 from mail_trusted_senders where user_id = ? and address = ?").get(userId, normal(address));

export function setTrustedSender(userId: string, address: string, trusted: boolean) {
  if (trusted) db().prepare("insert or ignore into mail_trusted_senders (user_id, address, created_at) values (?, ?, ?)").run(userId, normal(address), now());
  else db().prepare("delete from mail_trusted_senders where user_id = ? and address = ?").run(userId, normal(address));
}

export const setMailNotify = (userId: string, notify: MailNotify) => db().prepare("update mail_accounts set notify = ? where user_id = ?").run(notify, userId);

/** Someone I have written to (in my Sent folder), or whose images I trust. */
export function isKnownSender(userId: string, address: string): boolean {
  const a = normal(address);
  if (!a) return false;
  if (isTrustedSender(userId, a)) return true;
  const sent = specialFolder(userId, "\\Sent");
  if (!sent) return false;
  return !!db()
    .prepare(
      `select 1 from mail_messages m, json_each(m.recipients, '$.to') p
       where m.user_id = ? and m.folder = ? and lower(json_extract(p.value, '$.address')) = ? limit 1`,
    )
    .get(userId, sent, a);
}

// ---- Push devices

export function savePushDevice(userId: string, token: string, platform: string) {
  db()
    .prepare("insert into push_devices (token, user_id, platform, created_at, seen_at) values (?, ?, ?, ?, ?) on conflict (token) do update set user_id = excluded.user_id, platform = excluded.platform, seen_at = excluded.seen_at")
    .run(token, userId, platform, now(), now());
}

export const removePushDevice = (token: string, userId?: string) =>
  userId ? db().prepare("delete from push_devices where token = ? and user_id = ?").run(token, userId) : db().prepare("delete from push_devices where token = ?").run(token);

export const pushDevices = (userId: string) => db().prepare("select token, platform from push_devices where user_id = ?").all(userId) as { token: string; platform: string }[];

export const setSignature = (userId: string, signature: string) => db().prepare("update mail_accounts set signature = ? where user_id = ?").run(signature, userId);

// ---- Writing

/** The folder with this role (\\Sent, \\Drafts, \\Trash…), or null when the mailbox has none. */
export function specialFolder(userId: string, use: string): string | null {
  const r = db().prepare("select path from mail_folders where user_id = ? and special_use = ?").get(userId, use) as { path: string } | undefined;
  return r?.path ?? null;
}

/** What a reply needs to stay in its conversation. */
export function threadHeaders(userId: string, folder: string, uid: number): { messageId: string | null; inReplyTo: string | null; references: string[] } | null {
  const r = db().prepare("select message_id, in_reply_to, refs from mail_messages where user_id = ? and folder = ? and uid = ?").get(userId, folder, uid) as
    | { message_id: string | null; in_reply_to: string | null; refs: string | null }
    | undefined;
  if (!r) return null;
  return { messageId: r.message_id, inReplyTo: r.in_reply_to, references: (r.refs ?? "").split(/\s+/).filter(Boolean) };
}

/** The people already seen in the mailbox (senders and recipients), the most frequent first. */
export function mailContacts(userId: string, query: string, limit = 8): MailAddress[] {
  const q = `%${query.trim().toLowerCase().replace(/[%_]/g, "")}%`;
  const rows = db()
    .prepare(
      `with people as (
         select from_name as name, from_address as address from mail_messages where user_id = ?
         union all
         select json_extract(p.value, '$.name'), json_extract(p.value, '$.address')
           from mail_messages m, json_each(m.recipients, '$.to') p where m.user_id = ?
         union all
         select json_extract(p.value, '$.name'), json_extract(p.value, '$.address')
           from mail_messages m, json_each(m.recipients, '$.cc') p where m.user_id = ?
       )
       select lower(address) as address, max(name) as name, count(*) as n from people
       where address like '%@%' and (lower(address) like ? or lower(name) like ?)
       group by lower(address) order by n desc limit ?`,
    )
    .all(userId, userId, userId, q, q, limit) as { address: string; name: string | null }[];
  return rows.map((r) => ({ name: r.name ?? "", address: r.address }));
}

// ---- Sorted inbox (see sort.ts)

export const MAIL_CATEGORIES: MailCategory[] = ["important", "newsletter", "notification"];

/**
 * The mails of a folder with their category, as a subquery to name in FROM; its parameters come
 * first in the statement. A rule for the sender wins, then someone I have written to is Important, then the headers.
 */
function categorized(userId: string, folder: string): { sql: string; params: unknown[] } {
  const sent = specialFolder(userId, "\\Sent") ?? "";
  return {
    sql: `(select x.*, coalesce(r.category,
            case when x.from_address in (
              select lower(json_extract(p.value, '$.address')) from mail_messages s, json_each(s.recipients, '$.to') p where s.user_id = ? and s.folder = ?
            ) then 'important' else nullif(x.kind, '') end, 'important') as category
          from mail_messages x left join mail_sender_rules r on r.user_id = x.user_id and r.address = x.from_address
          where x.user_id = ? and x.folder = ?)`,
    params: [userId, sent, userId, folder],
  };
}

/** Only the inbox is sorted. */
export const isInbox = (userId: string, folder: string) => folder === (specialFolder(userId, "\\Inbox") ?? "INBOX");

/** Unread mails of each tab of the inbox. */
export function categoryUnread(userId: string): Record<MailCategory, number> {
  const inbox = specialFolder(userId, "\\Inbox") ?? "INBOX";
  const c = categorized(userId, inbox);
  const rows = db().prepare(`select category, sum(1 - seen) as unread from ${c.sql} m group by category`).all(...c.params) as { category: MailCategory; unread: number }[];
  const out = { important: 0, newsletter: 0, notification: 0 };
  for (const r of rows) out[r.category] = r.unread ?? 0;
  return out;
}

/** The category of these mails of a folder (to tell which new ones are Important). */
export function categoriesOf(userId: string, folder: string, uids: number[]): Map<number, MailCategory> {
  if (!uids.length) return new Map();
  const c = categorized(userId, folder);
  const rows = db().prepare(`select uid, category from ${c.sql} m where uid in (${uids.map(() => "?").join(",")})`).all(...c.params, ...uids) as { uid: number; category: MailCategory }[];
  return new Map(rows.map((r) => [r.uid, r.category]));
}

export function setSenderRule(userId: string, address: string, category: MailCategory | null) {
  const a = normal(address);
  if (!a) return;
  if (category) db().prepare("insert or replace into mail_sender_rules (user_id, address, category, created_at) values (?, ?, ?, ?)").run(userId, a, category, now());
  else db().prepare("delete from mail_sender_rules where user_id = ? and address = ?").run(userId, a);
}

export const senderRule = (userId: string, address: string) =>
  ((db().prepare("select category from mail_sender_rules where user_id = ? and address = ?").get(userId, normal(address)) as { category: MailCategory } | undefined)?.category ?? null);

/** Inbox mails whose headers were never read for sorting (synced before the sorted inbox). */
export const unsortedUids = (userId: string, folder: string, limit = 500) =>
  (db().prepare("select uid from mail_messages where user_id = ? and folder = ? and kind is null order by uid desc limit ?").all(userId, folder, limit) as { uid: number }[]).map((r) => r.uid);

export function setKinds(userId: string, folder: string, kinds: Map<number, { kind: MailKind; unsubscribe: Unsubscribe | null }>) {
  const update = db().prepare("update mail_messages set kind = ?, unsubscribe = ? where user_id = ? and folder = ? and uid = ?");
  db().transaction(() => {
    for (const [uid, k] of kinds) update.run(k.kind, k.unsubscribe ? JSON.stringify(k.unsubscribe) : null, userId, folder, uid);
  })();
}

export function unsubscribeOf(userId: string, folder: string, uid: number): Unsubscribe | null {
  const r = db().prepare("select unsubscribe from mail_messages where user_id = ? and folder = ? and uid = ?").get(userId, folder, uid) as { unsubscribe: string | null } | undefined;
  try {
    return r?.unsubscribe ? (JSON.parse(r.unsubscribe) as Unsubscribe) : null;
  } catch {
    return null;
  }
}

/** Someone else wrote in the conversation of this mail of mine after it left. */
export function repliedTo(userId: string, messageId: string | null, sentAt: string, me: string): boolean {
  if (!messageId) return false;
  ensureThreads(userId);
  const head = db().prepare("select thread_id from mail_messages where user_id = ? and message_id = ? and thread_id is not null limit 1").get(userId, messageId) as { thread_id: string } | undefined;
  const byRef = db()
    .prepare("select 1 from mail_messages where user_id = ? and lower(from_address) != ? and date > ? and (in_reply_to = ? or instr(coalesce(refs, ''), ?) > 0) limit 1")
    .get(userId, me, sentAt, messageId, messageId);
  if (byRef) return true;
  return !!(head && db().prepare("select 1 from mail_messages where user_id = ? and thread_id = ? and lower(from_address) != ? and date > ? limit 1").get(userId, head.thread_id, me, sentAt));
}
