import "server-only";
import type { ImapFlow } from "imapflow";
import { mailError } from "./connect";
import { syncFolder } from "./sync";

/*
 * The permanent connection to the inbox, for real time.
 *
 * The connection stays open with the inbox selected (read-only) and in IMAP IDLE: the server
 * tells it at once about a new mail (EXISTS), a deleted or moved one (EXPUNGE), a mail read or
 * flagged elsewhere (FETCH FLAGS). Each signal triggers a sync of the inbox on this same open
 * connection, without reconnecting or reselecting: the mail is in Lamio a fraction of a second later.
 *
 * Connection lost (network, server restart, Lamio restart): reconnects with growing delays
 * (1 s to 1 min) and catches up on what happened meanwhile with a full sync of the inbox.
 * Password refused: stops and reports it, never retries on its own.
 */

export const INBOX = "INBOX";
const DEBOUNCE = 100;
const RETRY = [1_000, 2_000, 5_000, 10_000, 30_000, 60_000];

export type LiveEvents = {
  /** The inbox changed; "added" holds the UIDs of the new mails. */
  onChange: (added: number[]) => void;
  /** Connected (true) or lost (false), with the reason when it failed. */
  onState: (live: boolean, error?: { message: string; auth: boolean }) => void;
};

export class InboxWatcher {
  private client: ImapFlow | null = null;
  private stopped = false;
  private failures = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private syncing: Promise<void> | null = null;
  private again = false;
  live = false;

  constructor(
    private readonly userId: string,
    private readonly connect: () => ImapFlow | null,
    private readonly events: LiveEvents,
  ) {}

  start() {
    // Already connected, connecting or waiting to reconnect.
    if (this.client || this.retryTimer) return;
    this.stopped = false;
    void this.open();
  }

  async stop() {
    this.stopped = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    const client = this.client;
    this.client = null;
    this.setLive(false);
    if (client) await client.logout().catch(() => client.close());
  }

  private setLive(live: boolean, error?: { message: string; auth: boolean }) {
    if (this.live === live && !error) return;
    this.live = live;
    this.events.onState(live, error);
  }

  private async open() {
    if (this.stopped) return;
    const client = this.connect();
    if (!client) return;
    this.client = client;
    client.on("error", () => {});
    client.on("close", () => {
      if (this.client !== client) return;
      this.client = null;
      this.setLive(false);
      this.retry();
    });
    // The signals of the IDLE connection.
    const poke = () => this.schedule();
    client.on("exists", poke);
    client.on("expunge", poke);
    client.on("flags", poke);
    client.on("highestModseq", poke);
    try {
      await client.connect();
      // Selected read-only for good: the lock is released right away, the inbox stays open and IDLE starts.
      const lock = await client.getMailboxLock(INBOX, { readOnly: true });
      lock.release();
      if (this.stopped || this.client !== client) return void client.logout().catch(() => client.close());
      this.failures = 0;
      this.setLive(true);
      // Catch up on what happened while disconnected.
      this.schedule(0);
    } catch (e) {
      if (this.client === client) this.client = null;
      client.close();
      const error = mailError(e);
      this.setLive(false, error);
      if (!error.auth) this.retry();
    }
  }

  private retry() {
    if (this.stopped || this.retryTimer) return;
    const delay = RETRY[Math.min(this.failures, RETRY.length - 1)];
    this.failures++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.open();
    }, delay);
    this.retryTimer.unref?.();
  }

  /** Several signals in a row (a burst of mails, a mass "mark as read") give one sync. */
  private schedule(delay = DEBOUNCE) {
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      void this.sync();
    }, delay);
  }

  private async sync() {
    if (this.syncing) {
      this.again = true;
      return;
    }
    this.syncing = (async () => {
      do {
        this.again = false;
        const client = this.client;
        if (!client || !client.usable) return;
        try {
          const { changed, added } = await syncFolder(client, this.userId, INBOX, null);
          if (changed) this.events.onChange(added);
        } catch {
          // The connection broke during the sync: "close" reconnects and catches up.
          if (client.usable) client.close();
          return;
        }
      } while (this.again);
    })().finally(() => (this.syncing = null));
    await this.syncing;
  }
}
