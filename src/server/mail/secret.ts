import "server-only";
import crypto from "node:crypto";

/*
 * Mailbox passwords are encrypted at rest with AES-256-GCM. The key comes from MAIL_SECRET
 * (32 characters at least, in the server's .env, never in the database or the backups), and each
 * value is tied to its account: a value copied onto another account does not decrypt.
 *
 * Without MAIL_SECRET, the Mails tab stays off.
 */

const VERSION = "v1";

type Env = Record<string, string | undefined>;

function key(env: Env = process.env): Buffer | null {
  const secret = (env.MAIL_SECRET ?? "").trim();
  if (secret.length < 32) return null;
  return Buffer.from(crypto.hkdfSync("sha256", secret, "lamio", "lamio-mail-password-v1", 32));
}

export const mailEnabled = (env: Env = process.env) => key(env) !== null;

export function encryptSecret(plain: string, owner: string, env: Env = process.env): string {
  const k = key(env);
  if (!k) throw new Error("MAIL_SECRET manquant");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
  cipher.setAAD(Buffer.from(owner));
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(".");
}

/** The password, or null when the value was tampered with, belongs to someone else, or the key changed. */
export function decryptSecret(value: string, owner: string, env: Env = process.env): string | null {
  const k = key(env);
  const [version, iv, tag, data] = value.split(".");
  if (!k || version !== VERSION || !iv || !tag || data === undefined) return null;
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    decipher.setAAD(Buffer.from(owner));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
