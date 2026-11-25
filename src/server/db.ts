import "server-only";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { mentionedIds } from "@/lib/mentions";
import type { CallInfo, Conversation, FileInfo, Message, Role, SearchHit, User } from "@/lib/types";

export const dataDir = () => path.resolve(process.env.DATA_DIR ?? "./data");
export const filesDir = () => path.join(dataDir(), "files");

const globalForDb = globalThis as unknown as { __appDb?: { dir: string; conn: Database.Database } };

export function db() {
  const dir = dataDir();
  if (globalForDb.__appDb?.dir === dir) return globalForDb.__appDb.conn;
  fs.mkdirSync(filesDir(), { recursive: true });
  const conn = new Database(path.join(dir, "app.db"));
  conn.pragma("journal_mode = WAL");
  conn.pragma("foreign_keys = ON");
  conn.exec(`
    create table if not exists users (
      id text primary key,
      email text not null unique,
      name text not null,
      role text not null default 'member',
      salt text not null,
      password_hash text not null,
      created_at text not null
    );
    -- The cookie holds a random token, the table only its SHA-256.
    create table if not exists sessions (
      token_hash text primary key,
      user_id text not null references users (id) on delete cascade,
      expires_at text not null
    );
    create table if not exists conversations (
      id text primary key,
      kind text not null check (kind in ('channel', 'dm')),
      -- Channels: unique name. Direct messages: empty.
      name text not null default '',
      topic text not null default '',
      -- Direct messages: the two user ids, sorted, so a pair has a single conversation.
      dm_key text unique,
      -- Private channel: only the people in "members" see it.
      private integer not null default 0,
      created_by text references users (id) on delete set null,
      created_at text not null
    );
    create unique index if not exists channel_name on conversations (name) where kind = 'channel';
    -- Who is in a direct message or a private channel. Public channels are open to every account.
    create table if not exists members (
      conversation_id text not null references conversations (id) on delete cascade,
      user_id text not null references users (id) on delete cascade,
      primary key (conversation_id, user_id)
    );
    create table if not exists messages (
      id integer primary key autoincrement,
      conversation_id text not null references conversations (id) on delete cascade,
      user_id text not null references users (id) on delete cascade,
      body text not null default '',
      created_at text not null,
      edited_at text,
      -- A reply in a thread points to the message that started it.
      parent_id integer references messages (id) on delete cascade
    );
    create index if not exists messages_conversation on messages (conversation_id, id);
    -- Who a message mentions, worked out from its text when it is posted or edited.
    create table if not exists mentions (
      message_id integer not null references messages (id) on delete cascade,
      user_id text not null references users (id) on delete cascade,
      primary key (message_id, user_id)
    );
    create index if not exists mentions_user on mentions (user_id, message_id);
    create table if not exists reactions (
      message_id integer not null references messages (id) on delete cascade,
      user_id text not null references users (id) on delete cascade,
      emoji text not null,
      created_at text not null,
      primary key (message_id, user_id, emoji)
    );
    -- A file is uploaded first (message_id null), then attached when the message is sent.
    create table if not exists files (
      id text primary key,
      message_id integer references messages (id) on delete cascade,
      user_id text not null references users (id) on delete cascade,
      name text not null,
      mime text not null,
      size integer not null,
      created_at text not null
    );
    create index if not exists files_message on files (message_id);
    -- How far each person has read each conversation.
    create table if not exists reads (
      user_id text not null references users (id) on delete cascade,
      conversation_id text not null references conversations (id) on delete cascade,
      last_message_id integer not null,
      primary key (user_id, conversation_id)
    );
    -- Single sign-on: a one-time code handed to a tool of the suite, which trades it for the person's identity.
    create table if not exists sso_codes (
      code_hash text primary key,
      client text not null,
      user_id text not null references users (id) on delete cascade,
      expires_at text not null
    );
    -- Members allowed to open a tool with their account. Admins always may.
    create table if not exists module_access (
      module text not null,
      user_id text not null references users (id) on delete cascade,
      primary key (module, user_id)
    );
    -- Mails: the person's own mailbox (Infomaniak or any IMAP/SMTP server), one per account for now.
    -- The password is encrypted with MAIL_SECRET (see server/mail/secret.ts), never stored in clear.
    create table if not exists mail_accounts (
      user_id text primary key references users (id) on delete cascade,
      email text not null,
      username text not null,
      imap_host text not null,
      imap_port integer not null,
      smtp_host text not null,
      smtp_port integer not null,
      secret text not null,
      -- pending, syncing, ok, error (will retry), auth (refused: waits for a new password)
      status text not null default 'pending',
      last_error text,
      synced_at text,
      created_at text not null
    );
    -- A local copy of the folders and message headers, so the list shows at once.
    -- The mailbox on the server stays the reference: this cache can be dropped and rebuilt.
    create table if not exists mail_folders (
      user_id text not null references users (id) on delete cascade,
      path text not null,
      name text not null,
      delimiter text not null default '/',
      special_use text,
      -- IMAP numbers, 64-bit: kept as text.
      uid_validity text,
      uid_next integer,
      highest_modseq text,
      total integer not null default 0,
      unread integer not null default 0,
      primary key (user_id, path)
    );
    create table if not exists mail_messages (
      user_id text not null,
      folder text not null,
      uid integer not null,
      message_id text,
      in_reply_to text,
      refs text,
      subject text not null default '',
      from_name text not null default '',
      from_address text not null default '',
      -- JSON: { to: [{ name, address }], cc: [...] }
      recipients text not null default '{}',
      date text not null,
      preview text not null default '',
      seen integer not null default 0,
      flagged integer not null default 0,
      answered integer not null default 0,
      attachments integer not null default 0,
      size integer not null default 0,
      primary key (user_id, folder, uid),
      foreign key (user_id, folder) references mail_folders (user_id, path) on delete cascade
    );
    create index if not exists mail_messages_date on mail_messages (user_id, folder, date desc);
    -- Senders whose remote images are shown without asking ("Toujours pour cet expéditeur").
    create table if not exists mail_trusted_senders (
      user_id text not null references users (id) on delete cascade,
      address text not null,
      created_at text not null,
      primary key (user_id, address)
    );
    -- Phones (and later Macs) that get a push notification for a new mail, by their APNs token.
    create table if not exists push_devices (
      token text primary key,
      user_id text not null references users (id) on delete cascade,
      platform text not null,
      created_at text not null,
      seen_at text not null
    );
  `);
  // Databases created by an earlier version get the columns added since.
  const addColumn = (table: string, column: string, definition: string) => {
    const columns = conn.prepare(`select name from pragma_table_info('${table}')`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) conn.exec(`alter table ${table} add column ${column} ${definition}`);
  };
  // Kept to close the Compte Postmelo session too when this one is closed.
  addColumn("sessions", "id_token", "text");
  addColumn("conversations", "private", "integer not null default 0");
  addColumn("messages", "edited_at", "text");
  addColumn("messages", "parent_id", "integer references messages (id) on delete cascade");
  // Mails: the text of a mail, kept once it has been opened.
  addColumn("mail_messages", "body_text", "text");
  // Mails: the signature added under each new mail.
  addColumn("mail_accounts", "signature", "text not null default ''");
  // Mails: which new mails notify (all, known = only people I have written to, off).
  addColumn("mail_accounts", "notify", "text not null default 'all'");
  // Mails: the conversation a mail belongs to (see threadOf in mail/store.ts), filled on insert.
  addColumn("mail_messages", "thread_id", "text");
  conn.exec("create index if not exists mail_messages_thread on mail_messages (user_id, thread_id)");
  conn.exec("create index if not exists mail_messages_mid on mail_messages (user_id, message_id)");
  // A video call started in the conversation (its room lives in Alfred): {"slug","title"} as JSON.
  addColumn("messages", "call", "text");
  // Mails, sorted inbox: what the headers say a mail is (null: not read yet), and how to leave its list.
  addColumn("mail_messages", "kind", "text");
  addColumn("mail_messages", "unsubscribe", "text");
  // Mails held by the server for later: a scheduled send, a snooze, a follow-up (mail/later.ts).
  conn.exec(`create table if not exists mail_later (
    id text primary key,
    user_id text not null references users (id) on delete cascade,
    kind text not null,
    due_at text not null,
    data text not null,
    created_at text not null
  )`);
  conn.exec("create index if not exists mail_later_due on mail_later (due_at)");
  // "Toujours dans Important / Newsletters / Notifications" for a sender.
  conn.exec(`create table if not exists mail_sender_rules (
    user_id text not null references users (id) on delete cascade,
    address text not null,
    category text not null,
    created_at text not null,
    primary key (user_id, address)
  )`);
  conn.exec("create index if not exists messages_parent on messages (parent_id) where parent_id is not null");
  globalForDb.__appDb = { dir, conn };
  return conn;
}

export const newId = () => crypto.randomBytes(9).toString("base64url");
const now = () => new Date().toISOString();

// ---- Users

type UserRow = { id: string; email: string; name: string; role: Role; salt: string; password_hash: string; created_at: string };
const toUser = (r: UserRow): User => ({ id: r.id, email: r.email, name: r.name, role: r.role, createdAt: r.created_at });

export const countUsers = () => (db().prepare("select count(*) as n from users").get() as { n: number }).n;

export const listUsers = () => (db().prepare("select * from users order by name collate nocase").all() as UserRow[]).map(toUser);

export function getUser(id: string): User | null {
  const r = db().prepare("select * from users where id = ?").get(id) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export function getCredentials(email: string) {
  const r = db().prepare("select * from users where email = ?").get(email.trim().toLowerCase()) as UserRow | undefined;
  return r ? { user: toUser(r), salt: r.salt, hash: r.password_hash } : null;
}

export function getCredentialsById(id: string) {
  const r = db().prepare("select * from users where id = ?").get(id) as UserRow | undefined;
  return r ? { user: toUser(r), salt: r.salt, hash: r.password_hash } : null;
}

/** Creates an account. Returns null when the email is already taken. */
export function createUser(input: { email: string; name: string; role: Role; salt: string; hash: string }): User | null {
  const id = newId();
  try {
    db().prepare("insert into users (id, email, name, role, salt, password_hash, created_at) values (?, ?, ?, ?, ?, ?, ?)").run(id, input.email.trim().toLowerCase(), input.name.trim(), input.role, input.salt, input.hash, now());
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
    throw e;
  }
  return getUser(id);
}

/**
 * The very first account: becomes admin, and the #général channel is created with it.
 * Returns null if an account already exists (the setup page must only work once).
 */
export function createFirstUser(input: { email: string; name: string; salt: string; hash: string }): User | null {
  return db().transaction(() => {
    if (countUsers() > 0) return null;
    const user = createUser({ ...input, role: "admin" })!;
    createChannel({ name: "general", topic: "Le canal de toute l'équipe", createdBy: user.id });
    return user;
  })();
}

/**
 * The person the Compte Postmelo just vouched for: found by id (accounts taken over from Lamio
 * kept theirs), else by email, else created. The account is the reference for name, email and role.
 * A person created here has no Lamio password: the password form refuses them.
 */
export function userFromAccount(person: { id: string; name: string; email: string; role: Role }): User {
  return db().transaction(() => {
    const email = person.email.trim().toLowerCase();
    const name = person.name.trim() || email;
    const found = (db().prepare("select * from users where id = ?").get(person.id) ?? db().prepare("select * from users where email = ?").get(email)) as UserRow | undefined;
    if (!found) {
      const first = countUsers() === 0;
      db().prepare("insert into users (id, email, name, role, salt, password_hash, created_at) values (?, ?, ?, ?, ?, '', ?)").run(person.id, email, name, person.role, crypto.randomBytes(16).toString("hex"), now());
      if (first) createChannel({ name: "general", topic: "Le canal de toute l'équipe", createdBy: person.id });
      return getUser(person.id)!;
    }
    db().prepare("update users set name = ?, role = ? where id = ?").run(name, person.role, found.id);
    // An email already used by someone else here stays as it was, rather than refusing the sign-in.
    if (found.email !== email && !db().prepare("select 1 from users where email = ?").get(email)) db().prepare("update users set email = ? where id = ?").run(email, found.id);
    return getUser(found.id)!;
  })();
}

export const renameUser = (id: string, name: string) => db().prepare("update users set name = ? where id = ?").run(name.trim(), id);

/** Changes the password and logs every device out (the caller opens a new session). */
export function setUserPassword(id: string, salt: string, hash: string) {
  db().transaction(() => {
    db().prepare("update users set salt = ?, password_hash = ? where id = ?").run(salt, hash, id);
    db().prepare("delete from sessions where user_id = ?").run(id);
  })();
}

// ---- Sessions

export function addSession(tokenHash: string, userId: string, expiresAt: string, idToken: string | null = null) {
  db().prepare("delete from sessions where expires_at < ?").run(now());
  db().prepare("insert into sessions (token_hash, user_id, expires_at, id_token) values (?, ?, ?, ?)").run(tokenHash, userId, expiresAt, idToken);
}

export function sessionUser(tokenHash: string): User | null {
  const r = db().prepare("select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?").get(tokenHash, now()) as UserRow | undefined;
  return r ? toUser(r) : null;
}

/** Closes the session. Returns the ID token it was opened with, when it came from the Compte Postmelo. */
export const removeSession = (tokenHash: string) => (db().prepare("delete from sessions where token_hash = ? returning id_token").get(tokenHash) as { id_token: string | null } | undefined)?.id_token ?? null;

// ---- Single sign-on

export function addSsoCode(codeHash: string, client: string, userId: string, expiresAt: string) {
  db().prepare("delete from sso_codes where expires_at < ?").run(now());
  db().prepare("insert into sso_codes (code_hash, client, user_id, expires_at) values (?, ?, ?, ?)").run(codeHash, client, userId, expiresAt);
}

/** A code works once, for the tool it was issued to, before it expires. */
export function takeSsoCode(codeHash: string, client: string): User | null {
  const r = db().prepare("delete from sso_codes where code_hash = ? returning client, user_id, expires_at").get(codeHash) as { client: string; user_id: string; expires_at: string } | undefined;
  if (!r || r.client !== client || r.expires_at <= now()) return null;
  return getUser(r.user_id);
}

/** Who may open each tool, besides the admins. */
export function moduleAccess(): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const r of db().prepare("select module, user_id from module_access").all() as { module: string; user_id: string }[]) (out[r.module] ??= []).push(r.user_id);
  return out;
}

export function mayOpenModule(module: string, user: { id: string; role: Role }) {
  return user.role === "admin" || !!db().prepare("select 1 from module_access where module = ? and user_id = ?").get(module, user.id);
}

export function setModuleAccess(module: string, userId: string, allowed: boolean) {
  if (allowed) db().prepare("insert or ignore into module_access (module, user_id) select ?, id from users where id = ?").run(module, userId);
  else db().prepare("delete from module_access where module = ? and user_id = ?").run(module, userId);
}

// ---- Conversations

type ConversationRow = { id: string; kind: "channel" | "dm"; name: string; topic: string; dm_key: string | null; private: number; created_by: string | null };

const dmKey = (a: string, b: string) => [a, b].sort().join(":");
const otherOf = (key: string, me: string) => {
  const [a, b] = key.split(":");
  return a === me ? b : a;
};

/** What this person may see: public channels, plus the private channels and direct messages they are in. */
const VISIBLE = "((c.kind = 'channel' and c.private = 0) or exists (select 1 from members where conversation_id = c.id and user_id = @me))";

export const listMembers = (conversationId: string) => (db().prepare("select user_id from members where conversation_id = ?").all(conversationId) as { user_id: string }[]).map((r) => r.user_id);

/** The conversations of this person. `role` decides what they may manage (admins: every channel). */
export function listConversations(userId: string, role: Role = "member"): Conversation[] {
  const READ = "coalesce((select last_message_id from reads r where r.user_id = @me and r.conversation_id = c.id), 0)";
  const rows = db()
    .prepare(
      `select c.id, c.kind, c.name, c.topic, c.dm_key, c.private, c.created_by,
        coalesce((select max(id) from messages m where m.conversation_id = c.id), 0) as last_message_id,
        (select count(*) from messages m where m.conversation_id = c.id and m.user_id != @me and m.id > ${READ}) as unread,
        (select count(*) from mentions x join messages m on m.id = x.message_id
          where x.user_id = @me and m.conversation_id = c.id and m.user_id != @me and m.id > ${READ}) as mentions
       from conversations c
       where ${VISIBLE}
       order by c.kind, c.name collate nocase, c.created_at`,
    )
    .all({ me: userId }) as (ConversationRow & { last_message_id: number; unread: number; mentions: number })[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    topic: r.topic,
    private: !!r.private,
    memberIds: r.kind === "channel" && r.private ? listMembers(r.id) : undefined,
    otherUserId: r.dm_key ? otherOf(r.dm_key, userId) : undefined,
    unread: r.unread,
    mentions: r.mentions,
    lastMessageId: r.last_message_id,
    canManage: r.kind === "channel" && (role === "admin" || r.created_by === userId),
  }));
}

/** May this person rename the channel and remove its members? Its creator, or an admin, and only if they can see it. */
export function canManage(conversationId: string, user: { id: string; role: Role }): boolean {
  const r = db().prepare(`select created_by from conversations c where c.id = @id and c.kind = 'channel' and ${VISIBLE}`).get({ id: conversationId, me: user.id }) as { created_by: string | null } | undefined;
  return !!r && (user.role === "admin" || r.created_by === user.id);
}

/** Renames a channel or changes its description. False when the name is taken. */
export function updateChannel(id: string, patch: { name?: string; topic?: string }): boolean {
  try {
    db().prepare("update conversations set name = coalesce(?, name), topic = coalesce(?, topic) where id = ? and kind = 'channel'").run(patch.name ?? null, patch.topic ?? null, id);
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return false;
    throw e;
  }
  return true;
}

/** The people who can read a conversation, with their names: the ones a message may mention. */
function readersOf(conversationId: string): { id: string; name: string }[] {
  const audience = audienceOf(conversationId);
  const everyone = db().prepare("select id, name from users").all() as { id: string; name: string }[];
  return audience === "all" ? everyone : everyone.filter((u) => audience.includes(u.id));
}

/** Returns what the conversation is if this person may read and write in it. */
export function accessTo(conversationId: string, userId: string): "channel" | "private" | "dm" | null {
  const r = db().prepare(`select kind, private from conversations c where c.id = @id and ${VISIBLE}`).get({ id: conversationId, me: userId }) as { kind: "channel" | "dm"; private: number } | undefined;
  return r ? (r.kind === "channel" && r.private ? "private" : r.kind) : null;
}

/** Who gets the live events of a conversation: everyone for a public channel, otherwise its members. */
export function audienceOf(conversationId: string): "all" | string[] {
  const c = db().prepare("select kind, private from conversations where id = ?").get(conversationId) as { kind: string; private: number } | undefined;
  if (!c || (c.kind === "channel" && !c.private)) return "all";
  return listMembers(conversationId);
}

/** Creates a channel. A private one starts with its creator as only member. Returns null when the name is taken. */
export function createChannel(input: { name: string; topic?: string; private?: boolean; createdBy: string }): string | null {
  const id = newId();
  try {
    db().transaction(() => {
      db().prepare("insert into conversations (id, kind, name, topic, private, created_by, created_at) values (?, 'channel', ?, ?, ?, ?, ?)").run(id, input.name, input.topic ?? "", input.private ? 1 : 0, input.createdBy, now());
      if (input.private) db().prepare("insert into members (conversation_id, user_id) values (?, ?)").run(id, input.createdBy);
    })();
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
    throw e;
  }
  return id;
}

export const addMember = (conversationId: string, userId: string) => db().prepare("insert or ignore into members (conversation_id, user_id) values (?, ?)").run(conversationId, userId).changes > 0;

/**
 * Leaves a private channel. When the last member leaves, nobody could ever open it again:
 * the channel is deleted, and the ids of its files are returned to remove from disk.
 */
export function removeMember(conversationId: string, userId: string): string[] {
  return db().transaction(() => {
    db().prepare("delete from members where conversation_id = ? and user_id = ?").run(conversationId, userId);
    if (listMembers(conversationId).length) return [];
    const ids = (db().prepare("select f.id from files f join messages m on m.id = f.message_id where m.conversation_id = ?").all(conversationId) as { id: string }[]).map((f) => f.id);
    db().prepare("delete from conversations where id = ?").run(conversationId);
    return ids;
  })();
}

/** The direct message between two people (or with yourself), created on first use. */
export function openDm(me: string, other: string): { id: string; created: boolean } {
  const key = dmKey(me, other);
  return db().transaction(() => {
    const existing = db().prepare("select id from conversations where dm_key = ?").get(key) as { id: string } | undefined;
    if (existing) return { id: existing.id, created: false };
    const id = newId();
    db().prepare("insert into conversations (id, kind, dm_key, created_by, created_at) values (?, 'dm', ?, ?, ?)").run(id, key, me, now());
    for (const u of new Set([me, other])) db().prepare("insert into members (conversation_id, user_id) values (?, ?)").run(id, u);
    return { id, created: true };
  })();
}

// ---- Messages

type MessageRow = { id: number; conversation_id: string; user_id: string; body: string; created_at: string; edited_at: string | null; parent_id: number | null; call?: string | null };

function callOf(raw: string | null | undefined): CallInfo | null {
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as CallInfo;
    return typeof c.slug === "string" && typeof c.title === "string" ? { slug: c.slug, title: c.title } : null;
  } catch {
    return null;
  }
}

/** Adds to each message its files, its reactions and the size of its thread. */
function hydrate(rows: MessageRow[]): Message[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const files = db().prepare(`select id, message_id, name, mime, size from files where message_id in (${marks}) order by created_at, rowid`).all(...ids) as (FileInfo & { message_id: number })[];
  const reactions = db().prepare(`select message_id, emoji, user_id from reactions where message_id in (${marks}) order by created_at, rowid`).all(...ids) as { message_id: number; emoji: string; user_id: string }[];
  const mentions = db().prepare(`select message_id, user_id from mentions where message_id in (${marks})`).all(...ids) as { message_id: number; user_id: string }[];
  const threads = db().prepare(`select parent_id, count(*) as n, max(created_at) as last from messages where parent_id in (${marks}) group by parent_id`).all(...ids) as { parent_id: number; n: number; last: string }[];
  return rows.map((r) => {
    const grouped = new Map<string, string[]>();
    for (const x of reactions) if (x.message_id === r.id) grouped.set(x.emoji, [...(grouped.get(x.emoji) ?? []), x.user_id]);
    const thread = threads.find((t) => t.parent_id === r.id);
    return {
      id: r.id,
      conversationId: r.conversation_id,
      userId: r.user_id,
      body: r.body,
      createdAt: r.created_at,
      editedAt: r.edited_at,
      parentId: r.parent_id,
      replyCount: thread?.n ?? 0,
      lastReplyAt: thread?.last ?? null,
      files: files.filter((f) => f.message_id === r.id).map(({ id, name, mime, size }) => ({ id, name, mime, size })),
      reactions: [...grouped].map(([emoji, userIds]) => ({ emoji, userIds })),
      mentionIds: mentions.filter((x) => x.message_id === r.id).map((x) => x.user_id),
      call: callOf(r.call),
    };
  });
}

export const PAGE = 50;

/** One page of a conversation, oldest first, without the replies. `before` is the id of the oldest message already shown. */
export function listMessages(conversationId: string, before?: number): { messages: Message[]; hasMore: boolean } {
  const rows = db()
    .prepare("select * from messages where conversation_id = ? and parent_id is null and id < ? order by id desc limit ?")
    .all(conversationId, before ?? Number.MAX_SAFE_INTEGER, PAGE + 1) as MessageRow[];
  const hasMore = rows.length > PAGE;
  return { messages: hydrate(rows.slice(0, PAGE).reverse()), hasMore };
}

/** The name of a call: "#channel", or both names for a direct message (everyone sees the same room name). */
export function callTitle(conversationId: string, userId: string): string {
  const c = db().prepare("select kind, name, dm_key from conversations where id = ?").get(conversationId) as { kind: string; name: string; dm_key: string | null } | undefined;
  if (!c) return "Appel";
  if (c.kind === "channel") return `#${c.name}`;
  const other = c.dm_key ? getUser(otherOf(c.dm_key, userId)) : null;
  const me = getUser(userId);
  return other && me && other.id !== userId ? `${me.name} · ${other.name}` : "Appel";
}

/** Whether this person can read a conversation where this call was started (and so may join it). */
export function mayJoinCall(slug: string, userId: string): boolean {
  const rows = db().prepare("select conversation_id from messages where call is not null and json_extract(call, '$.slug') = ?").all(slug) as { conversation_id: string }[];
  return rows.some((r) => accessTo(r.conversation_id, userId) !== null);
}

/** The replies of a thread, oldest first. */
export function listReplies(parentId: number): Message[] {
  return hydrate(db().prepare("select * from messages where parent_id = ? order by id limit 1000").all(parentId) as MessageRow[]);
}

export function getMessage(id: number): Message | null {
  const r = db().prepare("select * from messages where id = ?").get(id) as MessageRow | undefined;
  return r ? hydrate([r])[0] : null;
}

/**
 * Posts a message and attaches the files its author uploaded just before.
 * With `parentId` it is a reply in that message's thread (which must be in the same conversation,
 * and not a reply itself). Null when there is nothing to post or the thread does not exist.
 */
export function addMessage(input: { conversationId: string; userId: string; body: string; fileIds: string[]; parentId?: number; call?: CallInfo }): Message | null {
  return db().transaction(() => {
    if (input.parentId !== undefined) {
      const parent = db().prepare("select conversation_id, parent_id from messages where id = ?").get(input.parentId) as { conversation_id: string; parent_id: number | null } | undefined;
      if (!parent || parent.conversation_id !== input.conversationId || parent.parent_id !== null) return null;
    }
    const mine = db().prepare("select 1 from files where id = ? and user_id = ? and message_id is null");
    if (!input.body && !input.call && !input.fileIds.some((f) => mine.get(f, input.userId))) return null;
    const { lastInsertRowid } = db()
      .prepare("insert into messages (conversation_id, user_id, body, created_at, parent_id, call) values (?, ?, ?, ?, ?, ?)")
      .run(input.conversationId, input.userId, input.body, now(), input.parentId ?? null, input.call ? JSON.stringify(input.call) : null);
    const id = Number(lastInsertRowid);
    for (const fileId of input.fileIds) db().prepare("update files set message_id = ? where id = ? and user_id = ? and message_id is null").run(id, fileId, input.userId);
    setMentions(id, input.conversationId, input.body);
    markRead(input.userId, input.conversationId, id);
    return getMessage(id)!;
  })();
}

/** Records who the text mentions, among the people who can read the conversation. */
function setMentions(messageId: number, conversationId: string, body: string) {
  db().prepare("delete from mentions where message_id = ?").run(messageId);
  if (!body.includes("@")) return;
  for (const userId of mentionedIds(body, readersOf(conversationId))) db().prepare("insert into mentions (message_id, user_id) values (?, ?)").run(messageId, userId);
}

export function editMessage(id: number, body: string): Message | null {
  return db().transaction(() => {
    const { changes } = db().prepare("update messages set body = ?, edited_at = ? where id = ?").run(body, now(), id);
    const message = changes ? getMessage(id) : null;
    if (message) setMentions(id, message.conversationId, body);
    return message && getMessage(id);
  })();
}

/** Messages containing these words, newest first, among the conversations this person can read. */
export function searchMessages(userId: string, query: string, limit = 30): SearchHit[] {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const like = words.map(() => "m.body like ? escape '\\'").join(" and ");
  const rows = db()
    .prepare(`select m.id, m.conversation_id, m.parent_id, m.user_id, m.body, m.created_at from messages m join conversations c on c.id = m.conversation_id where ${like} and ${VISIBLE.replaceAll("@me", "?")} order by m.id desc limit ?`)
    .all(...words.map((w) => `%${w.replace(/[\\%_]/g, "\\$&")}%`), userId, limit) as MessageRow[];
  return rows.map((r) => ({ id: r.id, conversationId: r.conversation_id, parentId: r.parent_id, userId: r.user_id, body: r.body.length > 300 ? `${r.body.slice(0, 300)}…` : r.body, createdAt: r.created_at }));
}

export const MAX_REACTIONS = 20;

/** Adds my reaction, or removes it if it was there. Null when the message already has too many different ones. */
export function toggleReaction(messageId: number, userId: string, emoji: string): Message | null {
  return db().transaction(() => {
    const removed = db().prepare("delete from reactions where message_id = ? and user_id = ? and emoji = ?").run(messageId, userId, emoji).changes > 0;
    if (!removed) {
      const kinds = db().prepare("select distinct emoji from reactions where message_id = ?").all(messageId) as { emoji: string }[];
      if (kinds.length >= MAX_REACTIONS && !kinds.some((k) => k.emoji === emoji)) return null;
      db().prepare("insert into reactions (message_id, user_id, emoji, created_at) values (?, ?, ?, ?)").run(messageId, userId, emoji, now());
    }
    return getMessage(messageId);
  })();
}

/** Deletes a message and the replies of its thread. Returns the ids of their files, to remove from disk. */
export function deleteMessage(id: number): string[] {
  return db().transaction(() => {
    const ids = (db().prepare("select id from files where message_id = ? or message_id in (select id from messages where parent_id = ?)").all(id, id) as { id: string }[]).map((f) => f.id);
    db().prepare("delete from messages where id = ?").run(id);
    return ids;
  })();
}

export function markRead(userId: string, conversationId: string, messageId: number) {
  db()
    .prepare(
      `insert into reads (user_id, conversation_id, last_message_id) values (?, ?, ?)
       on conflict (user_id, conversation_id) do update set last_message_id = max(last_message_id, excluded.last_message_id)`,
    )
    .run(userId, conversationId, messageId);
}

// ---- Files

export function addFile(f: FileInfo & { userId: string }) {
  db().prepare("insert into files (id, user_id, name, mime, size, created_at) values (?, ?, ?, ?, ?, ?)").run(f.id, f.userId, f.name, f.mime, f.size, now());
}

/** A file, with what is needed to decide who may open it. */
export function getFile(id: string) {
  return db()
    .prepare("select f.id, f.name, f.mime, f.size, f.user_id as userId, m.conversation_id as conversationId from files f left join messages m on m.id = f.message_id where f.id = ?")
    .get(id) as (FileInfo & { userId: string; conversationId: string | null }) | undefined;
}

/** Files uploaded more than a day ago and never sent: forgotten from the table, returned to remove from disk. */
export function staleFiles(): string[] {
  const limit = new Date(Date.now() - 86_400_000).toISOString();
  const ids = (db().prepare("select id from files where message_id is null and created_at < ?").all(limit) as { id: string }[]).map((r) => r.id);
  if (ids.length) db().prepare("delete from files where message_id is null and created_at < ?").run(limit);
  return ids;
}
