import "server-only";
import type { ImapFlow, SearchObject } from "imapflow";
import { db } from "@/server/db";
import type { MailSummary } from "@/lib/types";
import { imapClient } from "./connect";
import { settingsFor } from "./service";
import * as store from "./store";
import { cacheMessages } from "./sync";

/*
 * Searching the mails: first the local copy (instant: senders, recipients, subjects, excerpts and
 * the text of the mails already opened), then the server (IMAP SEARCH: the full text of every mail,
 * and the old ones the local copy does not hold). The mails the server finds join the local copy.
 */

export type MailQuery = {
  /** Words, all required. "de:lea" and "à:paul" (or "a:") filter on the sender and the recipients. */
  q: string;
  folder?: string | null;
  unread?: boolean;
  attachments?: boolean;
  /** ISO dates. */
  since?: string | null;
  before?: string | null;
};

type Parsed = { words: string[]; from: string[]; to: string[] };

export function parseQuery(q: string): Parsed {
  const out: Parsed = { words: [], from: [], to: [] };
  for (const raw of q.match(/(?:[^\s"]+:)?"[^"]*"|\S+/g) ?? []) {
    const m = raw.match(/^(de|from|à|a|to):(.+)$/i);
    const value = (m ? m[2] : raw).replace(/^"|"$/g, "").trim().toLowerCase();
    if (!value) continue;
    if (!m) out.words.push(value);
    else if (/^(de|from)$/i.test(m[1])) out.from.push(value);
    else out.to.push(value);
  }
  return out;
}

const like = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** In the local copy: the newest first. */
export function searchLocal(userId: string, query: MailQuery, limit = 50): MailSummary[] {
  const { words, from, to } = parseQuery(query.q);
  const where = ["user_id = ?"];
  const args: unknown[] = [userId];
  for (const w of words) {
    where.push(`(lower(subject) like ? escape '\\' or lower(from_name) like ? escape '\\' or lower(from_address) like ? escape '\\' or lower(recipients) like ? escape '\\' or lower(preview) like ? escape '\\' or lower(coalesce(body_text, '')) like ? escape '\\')`);
    args.push(...Array(6).fill(like(w)));
  }
  for (const f of from) {
    where.push(`(lower(from_name) like ? escape '\\' or lower(from_address) like ? escape '\\')`);
    args.push(like(f), like(f));
  }
  for (const t of to) {
    where.push(`lower(recipients) like ? escape '\\'`);
    args.push(like(t));
  }
  const add = (clause: string, ...values: unknown[]) => {
    where.push(clause);
    args.push(...values);
  };
  if (query.folder) add("folder = ?", query.folder);
  if (query.unread) add("seen = 0");
  if (query.attachments) add("attachments = 1");
  if (query.since) add("date >= ?", query.since);
  if (query.before) add("date < ?", query.before);
  if (where.length === 1) return [];
  const rows = db()
    .prepare(`select folder, uid from mail_messages where ${where.join(" and ")} order by date desc, uid desc limit ?`)
    .all(...args, limit) as { folder: string; uid: number }[];
  return summaries(userId, rows);
}

function summaries(userId: string, rows: { folder: string; uid: number }[]): MailSummary[] {
  const byFolder = new Map<string, number[]>();
  rows.forEach((r) => byFolder.set(r.folder, [...(byFolder.get(r.folder) ?? []), r.uid]));
  return [...byFolder].flatMap(([folder, uids]) => store.mailSummaries(userId, folder, uids)).sort((a, b) => b.date.localeCompare(a.date) || b.uid - a.uid);
}

/**
 * The IMAP SEARCHes for a query: one per word (TEXT can be given once per search), each with the
 * other criteria; a mail must be in all of them.
 */
export function imapCriteria(query: MailQuery): SearchObject[] {
  const { words, from, to } = parseQuery(query.q);
  const base: SearchObject = {};
  if (from.length) base.from = from[0];
  if (to.length) base.to = to[0];
  if (query.unread) base.seen = false;
  if (query.since) base.since = new Date(query.since);
  if (query.before) base.before = new Date(query.before);
  if (words.length) return words.slice(0, 5).map((text) => ({ ...base, text }));
  return Object.keys(base).length ? [base] : [];
}

function defaultConnect(userId: string) {
  const settings = settingsFor(userId);
  return settings ? imapClient(settings) : null;
}

/** The folders searched on the server when the search covers "all folders". */
function serverFolders(userId: string, folder?: string | null): string[] {
  if (folder) return [folder];
  const folders = store.listFolders(userId);
  const skip = new Set(["\\Trash", "\\Junk", "\\Drafts"]);
  return folders.filter((f) => !f.specialUse || !skip.has(f.specialUse)).map((f) => f.path).slice(0, 12);
}

/** On the server: the newest matches of each folder (up to limit), added to the local copy. */
export async function searchServer(userId: string, query: MailQuery, limit = 50, connect: (userId: string) => ImapFlow | null = defaultConnect): Promise<MailSummary[]> {
  const criteria = imapCriteria(query);
  if (!criteria.length) return [];
  const client = connect(userId);
  if (!client) return [];
  client.on("error", () => {});
  const found: { folder: string; uid: number }[] = [];
  try {
    await client.connect();
    for (const folder of serverFolders(userId, query.folder)) {
      let uids: number[] = [];
      const lock = await client.getMailboxLock(folder, { readOnly: true }).catch(() => null);
      if (!lock) continue;
      try {
        let hits: number[] | null = null;
        for (const c of criteria) {
          const r = await client.search(c, { uid: true });
          const set = new Set<number>(Array.isArray(r) ? r : []);
          hits = hits === null ? [...set] : (hits as number[]).filter((u) => set.has(u));
          if (!hits.length) break;
        }
        uids = (hits ?? []).sort((a, b) => b - a).slice(0, limit);
      } catch {
        // A server that refuses the search on a folder: the others are still searched.
      } finally {
        lock.release();
      }
      if (!uids.length) continue;
      await cacheMessages(client, userId, folder, uids).catch(() => {});
      uids.forEach((uid) => found.push({ folder, uid }));
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  let out = summaries(userId, found);
  if (query.attachments) out = out.filter((m) => m.attachments);
  return out.slice(0, limit);
}
