import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import type { User } from "@/lib/types";
import { addSession, removeSession, sessionUser } from "./db";

export const SESSION_COOKIE = "app_session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 30;

export const secureCookies = () => process.env.NODE_ENV === "production" && process.env.INSECURE_COOKIE !== "true";

const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");

/** Opens a session for this person and puts its cookie on the response. */
export function startSession<T extends NextResponse>(res: T, userId: string, idToken: string | null = null) {
  const token = crypto.randomBytes(32).toString("base64url");
  addSession(sha256(token), userId, new Date(Date.now() + SESSION_MAX_AGE * 1000).toISOString(), idToken);
  res.cookies.set(SESSION_COOKIE, token, { httpOnly: true, sameSite: "lax", secure: secureCookies(), path: "/", maxAge: SESSION_MAX_AGE });
  return res;
}

/** Closes the session of this browser. Returns the ID token of the Compte Postmelo sign-in, if any. */
export async function endSession(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  jar.delete(SESSION_COOKIE);
  return token ? removeSession(sha256(token)) : null;
}

/** The signed-in person, or null. Every page and every API route starts here. */
export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sessionUser(sha256(token)) : null;
}
