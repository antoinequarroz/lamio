import "server-only";
import { db } from "@/server/db";
import type { MailAccountInfo, MailAttachment, MailAddress, MailFolder, MailStatus, MailSummary } from "@/lib/types";

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
  // Known by the mail service only: the routes fill it in.
  live: false,
});

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
};

export type MailFlags = { seen: boolean; flagged: boolean; answered: boolean };

export function uidRange(userId: string, folder: string): { min: number; max: number; count: number } {
  const r = db().prepare("select min(uid) as min, max(uid) as max, count(*) as count from mail_messages where user_id = ? and folder = ?").get(userId, folder) as { min: number | null; max: number | null; count: number };
  return { min: r.min ?? 0, max: r.max ?? 0, count: r.count };
}

export const cachedUids = (userId: string, folder: string) => (db().prepare("select uid from mail_messages where user_id = ? and folder = ?").all(userId, folder) as { uid: number }[]).map((r) => r.uid);

export function insertMessages(userId: string, folder: string, rows: MailRow[]) {
  const insert = db().prepare(
    `insert or replace into mail_messages (user_id, folder, uid, message_id, in_reply_to, refs, subject, from_name, from_address, recipients, date, seen, flagged, answered, attachments, size)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  db().transaction(() => {
    for (const m of rows) insert.run(userId, folder, m.uid, m.messageId, m.inReplyTo, m.references, m.subject, m.from.name, m.from.address, JSON.stringify({ to: m.to, cc: m.cc }), m.date, +m.seen, +m.flagged, +m.answered, +m.attachments, m.size);
  })();
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
  };
}

export const MAIL_PAGE = 50;

/** The newest messages of a folder, a page at a time ("before": the date and uid of the last one shown). */
export function listMailMessages(userId: string, folder: string, before?: { date: string; uid: number }, limit = MAIL_PAGE): { messages: MailSummary[]; hasMore: boolean } {
  const rows = (
    before
      ? db()
          .prepare("select * from mail_messages where user_id = ? and folder = ? and (date < ? or (date = ? and uid < ?)) order by date desc, uid desc limit ?")
          .all(userId, folder, before.date, before.date, before.uid, limit + 1)
      : db().prepare("select * from mail_messages where user_id = ? and folder = ? order by date desc, uid desc limit ?").all(userId, folder, limit + 1)
  ) as MessageRow[];
  return { messages: rows.slice(0, limit).map(toSummary), hasMore: rows.length > limit };
}

/** These mails, newest first: what the live update carries to the app. */
export function mailSummaries(userId: string, folder: string, uids: number[]): MailSummary[] {
  if (!uids.length) return [];
  const get = db().prepare("select * from mail_messages where user_id = ? and folder = ? and uid = ?");
  return uids
    .map((uid) => get.get(userId, folder, uid) as MessageRow | undefined)
    .filter((r): r is MessageRow => !!r)
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
