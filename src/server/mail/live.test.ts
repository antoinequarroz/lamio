import fs from "node:fs";
import net, { type AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { ImapFlow } from "imapflow";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { imapClient } from "./connect";
import { InboxWatcher } from "./live";
import * as store from "./store";

// Real time against a real IMAP server in memory (hoodiecrow, with IDLE).

const mail = (n: number) => `From: Ana <ana@exemple.ch>\r\nTo: antoine@exemple.ch\r\nSubject: Mail ${n}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nTexte ${n}\r\n`;

type Server = { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let server: Server;
let port: number;
let userId: string;
let watcher: InboxWatcher | null;
let proxy: net.Server | null;
const clients: ImapFlow[] = [];
const sockets = new Set<net.Socket>();

const settings = (p: number) => ({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: p, smtpHost: "", smtpPort: 465 });

async function other() {
  const c = imapClient(settings(port), { plain: true });
  c.on("error", () => {});
  await c.connect();
  clients.push(c);
  return c;
}

const until = async (check: () => boolean, ms = 3000) => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > ms) throw new Error("trop tard");
    await new Promise((r) => setTimeout(r, 20));
  }
  return Date.now() - start;
};

function watch(p = port) {
  const events = { changes: [] as number[][], states: [] as boolean[], errors: [] as string[] };
  watcher = new InboxWatcher(
    userId,
    () => {
      const c = imapClient(settings(p), { autoIdle: true, plain: true });
      return c;
    },
    { onChange: (added) => events.changes.push(added), onState: (live, e) => (events.states.push(live), e && events.errors.push(e.message)) },
  );
  watcher.start();
  return events;
}

beforeEach(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "live-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "testuser", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  store.setFolderList(userId, [{ path: "INBOX", name: "Boîte de réception", delimiter: "/", specialUse: "\\Inbox" }]);
  server = hoodiecrow({ plugins: ["IDLE", "ENABLE", "CONDSTORE", "UIDPLUS", "MOVE"], storage: { INBOX: { messages: [{ raw: mail(1) }] }, "": { separator: "/", folders: { Archives: {} } } } });
  await new Promise<void>((r) => server.listen(0, r));
  port = server.address().port;
});

afterEach(async () => {
  await watcher?.stop();
  watcher = null;
  for (const c of clients.splice(0)) await c.logout().catch(() => c.close());
  for (const s of sockets) s.destroy();
  sockets.clear();
  if (proxy) await new Promise<void>((r) => proxy!.close(() => r()));
  proxy = null;
  await new Promise<void>((r) => server.close(r));
});

const inbox = () => store.listMailMessages(userId, "INBOX").messages;

describe("temps réel (IMAP IDLE)", () => {
  it("rattrape la boîte en se connectant, puis un nouveau mail arrive en moins d'une seconde", async () => {
    const events = watch();
    await until(() => watcher!.live && inbox().length === 1);
    expect(events.states).toEqual([true]);

    const ana = await other();
    const sent = Date.now();
    await ana.append("INBOX", mail(2));
    await until(() => inbox().length === 2);
    const delay = Date.now() - sent;
    expect(delay).toBeLessThan(1000);
    expect(inbox()[0].subject).toBe("Mail 2");
    await until(() => events.changes.some((added) => added.includes(2)), 500);
  });

  it("suit en direct un mail lu, signalé, puis déplacé ailleurs", async () => {
    watch();
    await until(() => watcher!.live && inbox().length === 1);
    const phone = await other();
    const lock = await phone.getMailboxLock("INBOX");
    await phone.messageFlagsAdd({ uid: "1" }, ["\\Seen", "\\Flagged"], { uid: true });
    await until(() => inbox()[0]?.seen === true && inbox()[0]?.flagged === true, 1000);
    await until(() => store.listFolders(userId)[0].unread === 0, 500);
    await phone.messageMove({ uid: "1" }, "Archives", { uid: true });
    lock.release();
    await until(() => inbox().length === 0, 1000);
  });

  it("se reconnecte après une coupure et rattrape ce qui est arrivé entre-temps", async () => {
    // A small TCP relay between Lamio and the server, that can cut the line.
    proxy = net.createServer((client) => {
      const upstream = net.connect(port, "127.0.0.1");
      sockets.add(client).add(upstream);
      client.pipe(upstream).pipe(client);
      const end = () => (client.destroy(), upstream.destroy());
      client.on("error", end).on("close", end);
      upstream.on("error", end).on("close", end);
    });
    await new Promise<void>((r) => proxy!.listen(0, "127.0.0.1", r));
    const events = watch((proxy.address() as AddressInfo).port);
    await until(() => watcher!.live && inbox().length === 1);

    for (const s of sockets) s.destroy();
    sockets.clear();
    await until(() => !watcher!.live, 1000);
    // Arrives while Lamio is cut off.
    await (await other()).append("INBOX", mail(2));
    await until(() => watcher!.live && inbox().length === 2, 5000);
    expect(events.states).toEqual([true, false, true]);
  });

  it("mot de passe refusé : le dit et ne réessaie pas", async () => {
    let attempts = 0;
    const events = { errors: [] as { message: string; auth: boolean }[] };
    watcher = new InboxWatcher(
      userId,
      () => {
        attempts++;
        return imapClient({ ...settings(port), password: "faux" }, { autoIdle: true, plain: true });
      },
      { onChange: () => {}, onState: (_live, e) => e && events.errors.push(e) },
    );
    watcher.start();
    await until(() => events.errors.length > 0);
    expect(events.errors[0].auth).toBe(true);
    await new Promise((r) => setTimeout(r, 1500));
    expect(attempts).toBe(1);
  });
});
