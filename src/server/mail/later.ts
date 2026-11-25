import "server-only";
import type { ImapFlow } from "imapflow";
import { db, newId } from "@/server/db";
import { publish } from "@/server/events";
import type { MailLaterInfo } from "@/lib/types";
import { applyAction, createFolder } from "./actions";
import type { Outgoing } from "./compose";
import { imapClient, MailProblem } from "./connect";
import { deliver, type Draft } from "./send";
import { settingsFor, syncNow } from "./service";
import * as store from "./store";

/*
 * What happens later, held by the server so it works with the app closed:
 *  - "send": a mail written now, sent at the chosen time (cancellable until then);
 *  - "snooze": mails moved to the IMAP folder « Reportés » (the webmail and the iPhone see them
 *    there), back in the inbox, unread, at the chosen time;
 *  - "followup": a mail I sent; if nobody answered by then, it is flagged and I am told.
 * A pass every 30 seconds runs what is due (also what fell due while the server was down).
 */

export const SNOOZE_FOLDER = "Reportés";
const TICK_MS = 30_000;

type SendData = { draft: Draft; out: Omit<Outgoing, "files" | "date"> & { files: { name: string; type: string; data: string }[] } };
type SnoozeData = { from: string; mails: { messageId: string | null; uid: number; subject: string }[] };
type FollowData = { folder: string; uid: number; messageId: string | null; subject: string; to: string; sentAt: string };

type Row = { id: string; user_id: string; kind: "send" | "snooze" | "followup"; due_at: string; data: string; created_at: string };

function add(userId: string, kind: Row["kind"], due: Date, data: unknown): string {
  const id = newId();
  db().prepare("insert into mail_later (id, user_id, kind, due_at, data, created_at) values (?, ?, ?, ?, ?, ?)").run(id, userId, kind, due.toISOString(), JSON.stringify(data), new Date().toISOString());
  return id;
}

const remove = (id: string) => db().prepare("delete from mail_later where id = ?").run(id);

/** A time the person picked: in the future (a minute of slack) and within two years. */
export function validDue(value: unknown, now = Date.now()): Date | null {
  if (typeof value !== "string") return null;
  const t = Date.parse(value);
  if (isNaN(t) || t < now - 60_000 || t > now + 730 * 86_400_000) return null;
  return new Date(Math.max(t, now));
}

// ---- Scheduling

export function scheduleSend(userId: string, draft: Draft, out: Outgoing, at: Date): string {
  const { files, date: _date, ...rest } = out;
  void _date;
  return add(userId, "send", at, { draft, out: { ...rest, files: files.map((f) => ({ name: f.name, type: f.type, data: f.data.toString("base64") })) } } satisfies SendData);
}

function defaultClient(userId: string) {
  const s = settingsFor(userId);
  return s ? imapClient(s) : null;
}

type Deps = { connect: (userId: string) => ImapFlow | null; deliver: typeof deliver; sync: (userId: string) => Promise<void> };
const defaults: Deps = { connect: defaultClient, deliver: (...a) => deliver(...a), sync: (userId) => syncNow(userId) };

/** Moves these mails to « Reportés » (created if needed); they come back at `until`. */
export async function snooze(userId: string, folder: string, uids: number[], until: Date, deps: Deps = defaults): Promise<string> {
  const { connect } = deps;
  if (folder === snoozeFolder(userId)) throw new MailProblem("Ces mails sont déjà reportés");
  const mails = store.mailSummaries(userId, folder, uids);
  if (!mails.length) throw new MailProblem("Ce mail n'existe plus");
  let target = snoozeFolder(userId);
  if (!target) {
    target = await createFolder(userId, SNOOZE_FOLDER, null, connect);
    await deps.sync(userId);
    if (!store.listFolders(userId).some((f) => f.path === target)) throw new MailProblem("Le dossier « Reportés » n'a pas pu être créé");
  }
  const moved = await applyAction(userId, folder, mails.map((m) => m.uid), { type: "move", to: target }, connect);
  const newUids = moved.moved?.uids ?? [];
  const id = add(userId, "snooze", until, {
    from: folder,
    mails: mails.map((m, i) => ({ messageId: m.messageId, uid: newUids[i] ?? 0, subject: m.subject })),
  } satisfies SnoozeData);
  publish({ type: "mail", status: "ok", folders: moved.folders }, [userId]);
  void deps.sync(userId).catch(() => {});
  return id;
}

/** Tell me if nobody answered this mail of mine within `days`. */
export function followUp(userId: string, folder: string, uid: number, at: Date): string {
  const [m] = store.mailSummaries(userId, folder, [uid]);
  if (!m) throw new MailProblem("Ce mail n'existe plus");
  const to = [...m.to, ...m.cc].map((a) => a.name || a.address).join(", ");
  return add(userId, "followup", at, { folder, uid, messageId: m.messageId, subject: m.subject, to, sentAt: m.date } satisfies FollowData);
}

export const snoozeFolder = (userId: string) => store.listFolders(userId).find((f) => f.name === SNOOZE_FOLDER || f.path === SNOOZE_FOLDER)?.path ?? null;

/** What is waiting, soonest first: for the "Programmés" panel and the « Reportés » folder. */
export function listLater(userId: string): MailLaterInfo[] {
  const rows = db().prepare("select * from mail_later where user_id = ? order by due_at").all(userId) as Row[];
  return rows.map((r) => {
    const d = JSON.parse(r.data);
    if (r.kind === "send") {
      const s = d as SendData;
      return { id: r.id, kind: r.kind, due: r.due_at, subject: s.out.subject, to: [...s.out.to, ...s.out.cc].map((a) => a.name || a.address).join(", "), messageIds: [], refs: [] };
    }
    if (r.kind === "snooze") {
      const s = d as SnoozeData;
      const folder = snoozeFolder(userId) ?? SNOOZE_FOLDER;
      return { id: r.id, kind: r.kind, due: r.due_at, subject: s.mails[0]?.subject ?? "", to: "", messageIds: s.mails.map((m) => m.messageId).filter((x): x is string => !!x), refs: s.mails.filter((m) => m.uid).map((m) => ({ folder, uid: m.uid })) };
    }
    const f = d as FollowData;
    return { id: r.id, kind: r.kind, due: r.due_at, subject: f.subject, to: f.to, messageIds: f.messageId ? [f.messageId] : [], refs: [{ folder: f.folder, uid: f.uid }] };
  });
}

/** Cancels a send or a follow-up. A snooze is ended at once instead (the mails come back now). */
export async function cancelLater(userId: string, id: string, deps: Deps = defaults): Promise<boolean> {
  const r = db().prepare("select * from mail_later where id = ? and user_id = ?").get(id, userId) as Row | undefined;
  if (!r) return false;
  if (r.kind === "snooze") await run(r, deps);
  else remove(id);
  return true;
}

/** Sends a scheduled mail now. */
export async function runNow(userId: string, id: string, deps: Deps = defaults): Promise<boolean> {
  const r = db().prepare("select * from mail_later where id = ? and user_id = ?").get(id, userId) as Row | undefined;
  if (!r) return false;
  await run(r, deps);
  return true;
}

// ---- Running what is due


async function run(r: Row, deps: Deps) {
  // Taken first: a slow pass never runs it twice.
  if (remove(r.id).changes === 0) return;
  try {
    if (r.kind === "send") await runSend(r, deps);
    else if (r.kind === "snooze") await runSnooze(r, deps);
    else await runFollowUp(r, deps);
  } catch (e) {
    if (r.kind === "send") publish({ type: "mail", status: "ok", folders: [], reminder: { title: "Un envoi programmé n'est pas parti", body: (e as Error).message } }, [r.user_id]);
    // A mailbox out of reach: tried again in five minutes.
    else db().prepare("insert into mail_later (id, user_id, kind, due_at, data, created_at) values (?, ?, ?, ?, ?, ?)").run(r.id, r.user_id, r.kind, new Date(Date.now() + 5 * 60_000).toISOString(), r.data, r.created_at);
  }
}

async function runSend(r: Row, deps: Deps) {
  const { draft, out } = JSON.parse(r.data) as SendData;
  await deps.deliver(r.user_id, draft, { ...out, files: out.files.map((f) => ({ name: f.name, type: f.type, data: Buffer.from(f.data, "base64") })), date: new Date() });
  publish({ type: "mail", status: "ok", folders: [store.specialFolder(r.user_id, "\\Sent") ?? ""], reminder: { title: "Envoi programmé parti", body: out.subject || "(sans objet)" } }, [r.user_id]);
  void deps.sync(r.user_id).catch(() => {});
}

async function runSnooze(r: Row, deps: Deps) {
  const data = JSON.parse(r.data) as SnoozeData;
  const folder = snoozeFolder(r.user_id);
  const inbox = store.specialFolder(r.user_id, "\\Inbox") ?? "INBOX";
  if (!folder) return;
  const client = deps.connect(r.user_id);
  if (!client) throw new MailProblem("Aucune boîte mail branchée");
  client.on("error", () => {});
  try {
    await client.connect();
    const uids: number[] = [];
    {
      const lock = await client.getMailboxLock(folder);
      try {
        for (const m of data.mails) {
          // By Message-ID: the uid may have changed if the folder was rebuilt meanwhile.
          const found = m.messageId ? await client.search({ header: { "message-id": m.messageId } }, { uid: true }) : false;
          const uid = Array.isArray(found) && found.length ? found[0] : m.uid;
          if (uid) uids.push(uid);
        }
        if (uids.length) {
          // Back unread, at the top of the inbox.
          await client.messageFlagsRemove(uids.join(","), ["\\Seen"], { uid: true });
          await client.messageMove(uids.join(","), inbox, { uid: true });
        }
      } finally {
        lock.release();
      }
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
  publish({ type: "mail", status: "ok", folders: [folder, inbox] }, [r.user_id]);
  await deps.sync(r.user_id);
}

async function runFollowUp(r: Row, deps: Deps) {
  const f = JSON.parse(r.data) as FollowData;
  const me = (store.mailAccountInfo(r.user_id)?.email ?? "").toLowerCase();
  if (store.repliedTo(r.user_id, f.messageId, f.sentAt, me)) return;
  // Flagged on the server, so it shows in the webmail and on the iPhone too.
  const [m] = store.mailSummaries(r.user_id, f.folder, [f.uid]);
  if (m) await applyAction(r.user_id, f.folder, [f.uid], { type: "flagged", value: true }, deps.connect).catch(() => {});
  publish(
    { type: "mail", status: "ok", folders: [f.folder], reminder: { title: `Pas de réponse${f.to ? ` de ${f.to}` : ""}`, body: f.subject || "(sans objet)", folder: f.folder, uid: m ? f.uid : undefined } },
    [r.user_id],
  );
}

/** One pass: everything due now. */
export async function runDue(now = new Date(), deps: Deps = defaults) {
  const due = db().prepare("select * from mail_later where due_at <= ? order by due_at").all(now.toISOString()) as Row[];
  for (const r of due) await run(r, deps);
}

const globalForLater = globalThis as unknown as { __mailLater?: ReturnType<typeof setInterval> };

/** Started with the mailboxes (service.ts). */
export function startLater() {
  if (globalForLater.__mailLater) return;
  globalForLater.__mailLater = setInterval(() => void runDue().catch(() => {}), TICK_MS);
  globalForLater.__mailLater.unref?.();
  setTimeout(() => void runDue().catch(() => {}), 5000).unref?.();
}
