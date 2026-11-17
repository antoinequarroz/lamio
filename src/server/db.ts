import "server-only";
import Database from "better-sqlite3";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Conversation, FileInfo, Message, Role, User } from "@/lib/types";

export const dataDir = () => path.resolve(process.env.DATA_DIR ?? "./data");
export const filesDir = () => path.join(dataDir(), "files");

const globalForDb = globalThis as unknown as { __cordeeDb?: { dir: string; conn: Database.Database } };

export function db() {
  const dir = dataDir();
  if (globalForDb.__cordeeDb?.dir === dir) return globalForDb.__cordeeDb.conn;
  fs.mkdirSync(filesDir(), { recursive: true });
  const conn = new Database(path.join(dir, "cordee.db"));
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
      created_by text references users (id) on delete set null,
      created_at text not null
    );
    create unique index if not exists channel_name on conversations (name) where kind = 'channel';
    -- Who is in a direct message. Channels are open to every account for now.
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
      created_at text not null
    );
    create index if not exists messages_conversation on messages (conversation_id, id);
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
  globalForDb.__cordeeDb = { dir, conn };
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

type ConversationRow = { id: string; kind: "channel" | "dm"; name: string; topic: string; dm_key: string | null };

const dmKey = (a: string, b: string) => [a, b].sort().join(":");
const otherOf = (key: string, me: string) => {
  const [a, b] = key.split(":");
  return a === me ? b : a;
};

/** Every channel, plus the direct messages this person is part of. */
export function listConversations(userId: string): Conversation[] {
  const rows = db()
    .prepare(
      `select c.id, c.kind, c.name, c.topic, c.dm_key,
        coalesce((select max(id) from messages m where m.conversation_id = c.id), 0) as last_message_id,
        (select count(*) from messages m where m.conversation_id = c.id and m.user_id != @me
          and m.id > coalesce((select last_message_id from reads r where r.user_id = @me and r.conversation_id = c.id), 0)) as unread
       from conversations c
       where c.kind = 'channel' or exists (select 1 from members where conversation_id = c.id and user_id = @me)
       order by c.kind, c.name collate nocase, c.created_at`,
    )
    .all({ me: userId }) as (ConversationRow & { last_message_id: number; unread: number })[];
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    name: r.name,
    topic: r.topic,
    otherUserId: r.dm_key ? otherOf(r.dm_key, userId) : undefined,
    unread: r.unread,
    lastMessageId: r.last_message_id,
  }));
}

/** Returns the conversation kind if this person may read and write in it. */
export function accessTo(conversationId: string, userId: string): "channel" | "dm" | null {
  const r = db()
    .prepare("select kind from conversations c where c.id = ? and (c.kind = 'channel' or exists (select 1 from members where conversation_id = c.id and user_id = ?))")
    .get(conversationId, userId) as { kind: "channel" | "dm" } | undefined;
  return r?.kind ?? null;
}

/** Who gets the live events of a conversation: everyone for a channel, its members for a direct message. */
export function audienceOf(conversationId: string): "all" | string[] {
  const c = db().prepare("select kind from conversations where id = ?").get(conversationId) as { kind: string } | undefined;
  if (!c || c.kind === "channel") return "all";
  return (db().prepare("select user_id from members where conversation_id = ?").all(conversationId) as { user_id: string }[]).map((r) => r.user_id);
}

/** Creates a channel. Returns null when the name is taken. */
export function createChannel(input: { name: string; topic?: string; createdBy: string }): string | null {
  const id = newId();
  try {
    db().prepare("insert into conversations (id, kind, name, topic, created_by, created_at) values (?, 'channel', ?, ?, ?, ?)").run(id, input.name, input.topic ?? "", input.createdBy, now());
  } catch (e) {
    if ((e as { code?: string }).code === "SQLITE_CONSTRAINT_UNIQUE") return null;
    throw e;
  }
  return id;
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

type MessageRow = { id: number; conversation_id: string; user_id: string; body: string; created_at: string };

function withFiles(rows: MessageRow[]): Message[] {
  if (!rows.length) return [];
  const files = db()
    .prepare(`select id, message_id, name, mime, size from files where message_id in (${rows.map(() => "?").join(",")}) order by created_at`)
    .all(...rows.map((r) => r.id)) as (FileInfo & { message_id: number })[];
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    userId: r.user_id,
    body: r.body,
    createdAt: r.created_at,
    files: files.filter((f) => f.message_id === r.id).map(({ id, name, mime, size }) => ({ id, name, mime, size })),
  }));
}

export const PAGE = 50;

/** One page of messages, oldest first. `before` is the id of the oldest message already shown. */
export function listMessages(conversationId: string, before?: number): { messages: Message[]; hasMore: boolean } {
  const rows = db()
    .prepare("select * from messages where conversation_id = ? and id < ? order by id desc limit ?")
    .all(conversationId, before ?? Number.MAX_SAFE_INTEGER, PAGE + 1) as MessageRow[];
  const hasMore = rows.length > PAGE;
  return { messages: withFiles(rows.slice(0, PAGE).reverse()), hasMore };
}

export function getMessage(id: number): Message | null {
  const r = db().prepare("select * from messages where id = ?").get(id) as MessageRow | undefined;
  return r ? withFiles([r])[0] : null;
}

/** Posts a message and attaches the files its author uploaded just before. Null when there is nothing to post. */
export function addMessage(input: { conversationId: string; userId: string; body: string; fileIds: string[] }): Message | null {
  return db().transaction(() => {
    const mine = db().prepare("select 1 from files where id = ? and user_id = ? and message_id is null");
    if (!input.body && !input.fileIds.some((f) => mine.get(f, input.userId))) return null;
    const { lastInsertRowid } = db().prepare("insert into messages (conversation_id, user_id, body, created_at) values (?, ?, ?, ?)").run(input.conversationId, input.userId, input.body, now());
    const id = Number(lastInsertRowid);
    for (const fileId of input.fileIds) db().prepare("update files set message_id = ? where id = ? and user_id = ? and message_id is null").run(id, fileId, input.userId);
    markRead(input.userId, input.conversationId, id);
    return getMessage(id)!;
  })();
}

/** Deletes a message. Returns the ids of its files, to remove from disk. */
export function deleteMessage(id: number): string[] {
  return db().transaction(() => {
    const ids = (db().prepare("select id from files where message_id = ?").all(id) as { id: string }[]).map((f) => f.id);
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
