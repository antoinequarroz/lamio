import "server-only";
import crypto from "node:crypto";
import { addSsoCode, takeSsoCode } from "./db";

/**
 * Single sign-on for the tools of the suite ("Se connecter avec Lamio"), in three steps:
 *
 *  1. The tool sends the browser to /sso/authorize?client=cairn&state=<random>.
 *  2. If the person is signed in here and may open that tool, the browser goes back to the
 *     tool (<its URL>/api/auth/lamio?code=…&state=…) with a code that works once, for a minute.
 *  3. The tool's server trades the code for the person: POST /api/sso/token, with the shared
 *     secret as "Authorization: Bearer". The secret never goes through the browser.
 *
 * The return address is not a parameter: it is always the URL configured for the tool.
 */
const CODE_TTL_MS = 60_000;

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

export function issueCode(client: string, userId: string) {
  const code = crypto.randomBytes(32).toString("base64url");
  addSsoCode(sha256(code), client, userId, new Date(Date.now() + CODE_TTL_MS).toISOString());
  return code;
}

export const redeemCode = (client: string, code: string) => takeSsoCode(sha256(code), client);

/** Compares two secrets without leaking where they differ. */
export const sameSecret = (a: string, b: string) => crypto.timingSafeEqual(crypto.createHash("sha256").update(a).digest(), crypto.createHash("sha256").update(b).digest());

/** What the tool sends back untouched, to recognise its own request. */
export const validState = (state: string | null): state is string => !!state && /^[A-Za-z0-9_-]{16,200}$/.test(state);
