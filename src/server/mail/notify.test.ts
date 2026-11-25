import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { apnsConfig, apnsToken, sendApns, type ApnsConfig } from "@/server/push/apns";
import { imapClient } from "./connect";
import { mailsToAlert, pushNewMails } from "./notify";
import * as store from "./store";
import { syncMailbox } from "./sync";

const mail = (from: string, subject: string, opts: { to?: string; seen?: boolean } = {}) => ({
  raw: `From: ${from}\r\nTo: ${opts.to ?? "antoine@exemple.ch"}\r\nSubject: ${subject}\r\nContent-Type: text/plain\r\n\r\nTexte de ${subject}\r\n`,
  flags: opts.seen ? ["\\Seen"] : [],
});

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;

beforeEach(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "notify-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "antoine@exemple.ch", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  server = hoodiecrow({
    plugins: ["SPECIAL-USE"],
    storage: {
      INBOX: { messages: [mail("Lea <lea@studio.ch>", "Devis"), mail("Promo <news@shop.ch>", "Soldes"), mail("Paul <paul@x.ch>", "Déjà lu", { seen: true }), mail("antoine@exemple.ch", "Note à moi")] },
      "": { separator: "/", folders: { Sent: { "special-use": "\\Sent", messages: [mail("antoine@exemple.ch", "Re: Devis", { to: "Lea <LEA@studio.ch>", seen: true })] } } },
    },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  await c.connect();
  await syncMailbox(c, userId);
  await c.logout();
});

afterEach(() => new Promise<void>((r) => server.close(r)));

const inbox = () => store.mailSummaries(userId, "INBOX", [1, 2, 3, 4]);

describe("notifier un nouveau mail", () => {
  it("seulement les non lus qui ne viennent pas de moi ; « contacts connus » garde ceux à qui j'ai écrit", () => {
    expect(mailsToAlert(userId, inbox()).map((m) => m.subject).sort()).toEqual(["Devis", "Soldes"]);
    store.setMailNotify(userId, "known");
    expect(store.mailAccountInfo(userId)!.notify).toBe("known");
    expect(mailsToAlert(userId, inbox()).map((m) => m.subject)).toEqual(["Devis"]);
    // An expéditeur whose images I trust counts as known too.
    store.setTrustedSender(userId, "news@shop.ch", true);
    expect(mailsToAlert(userId, inbox())).toHaveLength(2);
    store.setMailNotify(userId, "off");
    expect(mailsToAlert(userId, inbox())).toEqual([]);
  });
});

describe("push iPhone (APNs)", () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();

  it("sans clé Apple, rien n'est configuré ; le jeton est un JWT ES256 vérifiable", () => {
    expect(apnsConfig({})).toBeNull();
    const config = apnsConfig({ APNS_KEY: pem.replace(/\n/g, "\\n"), APNS_KEY_ID: "KEY123", APNS_TEAM_ID: "TEAM42", APNS_TOPIC: "ch.lamio.app", APNS_SANDBOX: "true" })!;
    expect(config.host).toBe("https://api.sandbox.push.apple.com");
    const [head, claims, sig] = apnsToken(config).split(".");
    expect(JSON.parse(Buffer.from(head, "base64url").toString())).toEqual({ alg: "ES256", kid: "KEY123" });
    expect(JSON.parse(Buffer.from(claims, "base64url").toString())).toMatchObject({ iss: "TEAM42" });
    expect(crypto.verify("sha256", Buffer.from(`${head}.${claims}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"))).toBe(true);
  });

  it("envoie à chaque iPhone (expéditeur, objet, pastille) et oublie un appareil qu'Apple refuse", async () => {
    const live = "a".repeat(64);
    const gone = "b".repeat(64);
    const got: { path: string; headers: http2.IncomingHttpHeaders; body: Record<string, unknown> }[] = [];
    const apple = http2.createServer();
    apple.on("stream", (stream, headers) => {
      let body = "";
      stream.on("data", (d) => (body += d));
      stream.on("end", () => {
        got.push({ path: String(headers[":path"]), headers, body: JSON.parse(body) });
        if (String(headers[":path"]).endsWith(gone)) {
          stream.respond({ ":status": 410 });
          stream.end(JSON.stringify({ reason: "Unregistered" }));
        } else {
          stream.respond({ ":status": 200 });
          stream.end();
        }
      });
    });
    await new Promise<void>((r) => apple.listen(0, r));
    const config: ApnsConfig = { key: pem, keyId: "KEY123", teamId: "TEAM42", topic: "ch.lamio.app", host: `http://127.0.0.1:${(apple.address() as AddressInfo).port}` };
    store.savePushDevice(userId, live, "ios");
    store.savePushDevice(userId, gone, "ios");
    try {
      const results = await pushNewMails(userId, mailsToAlert(userId, inbox()), { config, send: sendApns });
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 410, 410]);
    } finally {
      apple.close();
    }
    const first = got.find((g) => g.path === `/3/device/${live}` && g.headers["apns-collapse-id"] === "mail-1")!;
    expect(first.headers).toMatchObject({ "apns-topic": "ch.lamio.app", "apns-push-type": "alert", authorization: expect.stringMatching(/^bearer /) });
    // Badge: the 3 unread mails of the inbox (no unread Lamio message).
    expect(first.body).toEqual({ aps: { alert: { title: "Lea", subtitle: "Devis", body: "Texte de Devis" }, badge: 3, sound: "default", "thread-id": "mail" }, url: "/mail?m=1" });
    expect(store.pushDevices(userId).map((d) => d.token)).toEqual([live]);
  });
});
