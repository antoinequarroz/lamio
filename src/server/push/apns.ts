import "server-only";
import crypto from "node:crypto";
import fs from "node:fs";
import http2 from "node:http2";

/*
 * Push notifications to the iPhone app, through Apple's servers (APNs), signed with a key from the
 * Apple developer account (a .p8 file). Without that key, nothing is sent and nothing breaks:
 * APNS_KEY (the .p8 content) or APNS_KEY_FILE, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC (the app's
 * bundle id), and APNS_SANDBOX=true for an app built from Xcode (not from TestFlight).
 */

export type ApnsConfig = { key: string; keyId: string; teamId: string; topic: string; host: string };

export function apnsConfig(env: Record<string, string | undefined> = process.env): ApnsConfig | null {
  let key = env.APNS_KEY?.replace(/\\n/g, "\n") ?? "";
  if (!key && env.APNS_KEY_FILE) {
    try {
      key = fs.readFileSync(env.APNS_KEY_FILE, "utf8");
    } catch {
      return null;
    }
  }
  if (!key || !env.APNS_KEY_ID || !env.APNS_TEAM_ID || !env.APNS_TOPIC) return null;
  const host = env.APNS_HOST || (env.APNS_SANDBOX === "true" ? "https://api.sandbox.push.apple.com" : "https://api.push.apple.com");
  return { key, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, topic: env.APNS_TOPIC, host };
}

const b64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

// Apple wants a fresh token at most every hour and at least every 20 minutes: one per 40 minutes.
const tokens = new Map<string, { jwt: string; at: number }>();

export function apnsToken(config: ApnsConfig, now = Date.now()): string {
  const cached = tokens.get(config.keyId);
  if (cached && now - cached.at < 40 * 60_000) return cached.jwt;
  const head = b64url(JSON.stringify({ alg: "ES256", kid: config.keyId }));
  const claims = b64url(JSON.stringify({ iss: config.teamId, iat: Math.floor(now / 1000) }));
  const signature = crypto.sign("sha256", Buffer.from(`${head}.${claims}`), { key: config.key, dsaEncoding: "ieee-p1363" });
  const jwt = `${head}.${claims}.${b64url(signature)}`;
  tokens.set(config.keyId, { jwt, at: now });
  return jwt;
}

export type ApnsMessage = { token: string; payload: object; collapseId?: string };
export type ApnsResult = { token: string; status: number; reason?: string };

/** Sends to several devices over one connection. Never throws: each result says what Apple answered. */
export async function sendApns(config: ApnsConfig, messages: ApnsMessage[]): Promise<ApnsResult[]> {
  if (!messages.length) return [];
  const session = http2.connect(config.host);
  session.on("error", () => {});
  try {
    const jwt = apnsToken(config);
    return await Promise.all(
      messages.map(
        (m) =>
          new Promise<ApnsResult>((resolve) => {
            const req = session.request({
              ":method": "POST",
              ":path": `/3/device/${m.token}`,
              authorization: `bearer ${jwt}`,
              "apns-topic": config.topic,
              "apns-push-type": "alert",
              "apns-priority": "10",
              ...(m.collapseId && { "apns-collapse-id": m.collapseId.slice(0, 64) }),
            });
            let status = 0;
            let body = "";
            req.setTimeout(10_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
            req.on("response", (h) => (status = Number(h[":status"]) || 0));
            req.on("data", (d) => (body += d));
            req.on("end", () => {
              let reason: string | undefined;
              try {
                reason = body ? (JSON.parse(body) as { reason?: string }).reason : undefined;
              } catch {}
              resolve({ token: m.token, status, reason });
            });
            req.on("error", (e) => resolve({ token: m.token, status: 0, reason: e.message }));
            req.end(JSON.stringify(m.payload));
          }),
      ),
    );
  } finally {
    session.close();
  }
}

/** Apple says this token will never work again: the app was removed, or it is for another app. */
export const deadToken = (r: ApnsResult) => r.status === 410 || (r.status === 400 && ["BadDeviceToken", "DeviceTokenNotForTopic", "Unregistered"].includes(r.reason ?? ""));
