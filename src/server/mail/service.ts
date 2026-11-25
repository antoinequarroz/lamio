import "server-only";
import { publish } from "@/server/events";
import { imapClient, mailError, type MailSettings } from "./connect";
import { decryptSecret, mailEnabled } from "./secret";
import * as store from "./store";
import { syncMailbox } from "./sync";

/*
 * Keeps each plugged-in mailbox in sync, in the server process (like the live updates of
 * server/events.ts): a pass every SYNC_EVERY, and right away when asked (plugging in, "Synchroniser").
 *
 * This is the first step: a connection per pass. The permanent IMAP IDLE connection that brings a
 * mail in within a second or two comes next (LAMIO-301) and plugs into syncNow().
 */

export const SYNC_EVERY = 2 * 60_000;

type Runner = { timer: ReturnType<typeof setInterval>; running: Promise<void> | null; again: boolean; full: boolean };

const globalForMail = globalThis as unknown as { __mailRunners?: Map<string, Runner> };
const runners = (globalForMail.__mailRunners ??= new Map());

export function settingsFor(userId: string): MailSettings | null {
  const account = store.mailAccount(userId);
  if (!account) return null;
  const password = decryptSecret(account.secret, userId);
  return password === null ? null : { ...account, password };
}

async function pass(userId: string, full: boolean) {
  const account = store.mailAccount(userId);
  if (!account) return stop(userId);
  // Refused password: trying again and again could get the address blocked. Waits for a new one.
  if (account.status === "auth") return;
  const settings = settingsFor(userId);
  if (!settings) {
    store.setMailStatus(userId, "error", "Le mot de passe enregistré ne peut plus être lu (MAIL_SECRET a changé ?). Rebranche la boîte.");
    return void publish({ type: "mail", status: "error", folders: [] }, [userId]);
  }
  if (account.status !== "ok") {
    store.setMailStatus(userId, "syncing");
    publish({ type: "mail", status: "syncing", folders: [] }, [userId]);
  }
  const client = imapClient(settings);
  client.on("error", () => {});
  try {
    await client.connect();
    const folders = await syncMailbox(client, userId, { full });
    // Unplugged during the pass: nothing to report.
    if (!store.mailAccount(userId)) return;
    store.setMailStatus(userId, "ok");
    if (folders.length || account.status !== "ok") publish({ type: "mail", status: "ok", folders }, [userId]);
  } catch (e) {
    if (!store.mailAccount(userId)) return;
    const { message, auth } = mailError(e);
    store.setMailStatus(userId, auth ? "auth" : "error", message);
    publish({ type: "mail", status: auth ? "auth" : "error", folders: [] }, [userId]);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

/** Runs a pass now, or right after the one in progress. Resolves when the mailbox is up to date. */
export function syncNow(userId: string, options: { full?: boolean } = {}): Promise<void> {
  const r = runners.get(userId) ?? start(userId);
  if (!r) return Promise.resolve();
  if (options.full) r.full = true;
  if (r.running) {
    r.again = true;
    return r.running;
  }
  const loop = async () => {
    do {
      r.again = false;
      const full = r.full;
      r.full = false;
      await pass(userId, full).catch(() => {});
    } while (r.again);
    r.running = null;
  };
  r.running = loop();
  return r.running;
}

/** Starts syncing this person's mailbox (no-op if it already runs, or without MAIL_SECRET). */
export function start(userId: string): Runner | null {
  if (!mailEnabled()) return null;
  const existing = runners.get(userId);
  if (existing) return existing;
  const timer = setInterval(() => void syncNow(userId), SYNC_EVERY);
  timer.unref?.();
  const r: Runner = { timer, running: null, again: false, full: false };
  runners.set(userId, r);
  return r;
}

export function stop(userId: string) {
  const r = runners.get(userId);
  if (!r) return;
  clearInterval(r.timer);
  runners.delete(userId);
}

let started = false;

/** At server start: every plugged-in mailbox, a first pass a few seconds apart. */
export function startAll() {
  if (started || !mailEnabled()) return;
  started = true;
  store.mailAccountUsers().forEach((userId, i) => {
    start(userId);
    setTimeout(() => void syncNow(userId, { full: true }), 2000 + i * 3000).unref?.();
  });
}
