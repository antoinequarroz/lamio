import "server-only";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Conversation, FileInfo, Message, Role, User } from "@/lib/types";

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
  `);
  // Databases created by an earlier version get the columns added since.
  const addColumn = (table: string, column: string, definition: string) => {
    const columns = conn.prepare(`select name from pragma_table_info('${table}')`).all() as { name: string }[];
    if (!columns.some((c) => c.name === column)) conn.exec(`alter table ${table} add column ${column} ${definition}`);
  };
  addColumn("conversations", "private", "integer not null default 0");
  addColumn("messages", "edited_at", "text");
  addColumn("messages", "parent_id", "integer references messages (id) on delete cascade");
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

export const renameUser = (id: string, name: string) => db().prepare("update users set name = ? where id = ?").run(name.trim(), id);

/** Changes the password and logs every device out (the caller opens a new session). */
export function setUserPassword(id: string, salt: string, hash: string) {
  db().transaction(() => {
    db().prepare("update users set salt = ?, password_hash = ? where id = ?").run(salt, hash, id);
    db().prepare("delete from sessions where user_id = ?").run(id);
  })();
}

// ---- Sessions

export function addSession(tokenHash: string, userId: string, expiresAt: string) {
  db().prepare("delete from sessions where expires_at < ?").run(now());
  db().prepare("insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)").run(tokenHash, userId, expiresAt);
}

export function sessionUser(tokenHash: string): User | null {
  const r = db().prepare("select u.* from sessions s join users u on u.id = s.user_id where s.token_hash = ? and s.expires_at > ?").get(tokenHash, now()) as UserRow | undefined;
  return r ? toUser(r) : null;
}

export const removeSession = (tokenHash: string) => db().prepare("delete from sessions where token_hash = ?").run(tokenHash);

// ---- Conversations

type ConversationRow = { id: string; kind: "channel" | "dm"; name: string; topic: string; dm_key: string | null; private: number };

const dmKey = (a: string, b: string) => [a, b].sort().join(":");
const otherOf = (key: string, me: string) => {
  const [a, b] = key.split(":");
  return a === me ? b : a;
};

/** What this person may see: public channels, plus the private channels and direct messages they are in. */
const VISIBLE = "((c.kind = 'channel' and c.private = 0) or exists (select 1 from members where conversation_id = c.id and user_id = @me))";

export const listMembers = (conversationId: string) => (db().prepare("select user_id from members where conversation_id = ?").all(conversationId) as { user_id: string }[]).map((r) => r.user_id);

export function listConversations(userId: string): Conversation[] {
  const rows = db()
    .prepare(
      `select c.id, c.kind, c.name, c.topic, c.dm_key, c.private,
        coalesce((select max(id) from messages m where m.conversation_id = c.id), 0) as last_message_id,
        (select count(*) from messages m where m.conversation_id = c.id and m.user_id != @me
          and m.id > coalesce((select last_message_id from reads r where r.user_id = @me and r.conversation_id = c.id), 0)) as unread
       from conversations c
       where ${VISIBLE}
       order by c.kind, c.name collate nocase, c.created_at`,
    )
    .all({ me: userId }) as (ConversationRow & { last_message_id: number; unread: number })[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    topic: r.topic,
    private: !!r.private,
    memberIds: r.kind === "channel" && r.private ? listMembers(r.id) : undefined,
    otherUserId: r.dm_key ? otherOf(r.dm_key, userId) : undefined,
    unread: r.unread,
    lastMessageId: r.last_message_id,
  }));
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

type MessageRow = { id: number; conversation_id: string; user_id: string; body: string; created_at: string; edited_at: string | null; parent_id: number | null };

/** Adds to each message its files, its reactions and the size of its thread. */
function hydrate(rows: MessageRow[]): Message[] {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const marks = ids.map(() => "?").join(",");
  const files = db().prepare(`select id, message_id, name, mime, size from files where message_id in (${marks}) order by created_at`).all(...ids) as (FileInfo & { message_id: number })[];
  const reactions = db().prepare(`select message_id, emoji, user_id from reactions where message_id in (${marks}) order by created_at`).all(...ids) as { message_id: number; emoji: string; user_id: string }[];
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
export function addMessage(input: { conversationId: string; userId: string; body: string; fileIds: string[]; parentId?: number }): Message | null {
  return db().transaction(() => {
    if (input.parentId !== undefined) {
      const parent = db().prepare("select conversation_id, parent_id from messages where id = ?").get(input.parentId) as { conversation_id: string; parent_id: number | null } | undefined;
      if (!parent || parent.conversation_id !== input.conversationId || parent.parent_id !== null) return null;
    }
    const mine = db().prepare("select 1 from files where id = ? and user_id = ? and message_id is null");
    if (!input.body && !input.fileIds.some((f) => mine.get(f, input.userId))) return null;
    const { lastInsertRowid } = db().prepare("insert into messages (conversation_id, user_id, body, created_at, parent_id) values (?, ?, ?, ?, ?)").run(input.conversationId, input.userId, input.body, now(), input.parentId ?? null);
    const id = Number(lastInsertRowid);
    for (const fileId of input.fileIds) db().prepare("update files set message_id = ? where id = ? and user_id = ? and message_id is null").run(id, fileId, input.userId);
    markRead(input.userId, input.conversationId, id);
    return getMessage(id)!;
  })();
}

export function editMessage(id: number, body: string): Message | null {
  db().prepare("update messages set body = ?, edited_at = ? where id = ?").run(body, now(), id);
  return getMessage(id);
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
