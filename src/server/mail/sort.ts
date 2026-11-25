import type { MailCategory } from "@/lib/types";

/*
 * The sorted inbox: Important, Newsletters, Notifications.
 *
 * What a mail is comes from its headers, read at sync time ("kind"); the final category is
 * decided when listing (see store.ts), so it follows what I do afterwards:
 *   1. a rule I set for the sender ("Toujours dans …") wins;
 *   2. someone I have written to is Important;
 *   3. otherwise the kind from the headers, Important when nothing says otherwise.
 */

export type MailKind = Exclude<MailCategory, "important"> | "";

/** How to leave a mailing list, from List-Unsubscribe (RFC 2369) and List-Unsubscribe-Post (RFC 8058). */
export type Unsubscribe = { http?: string; mailto?: string; oneClick?: boolean };

const NO_REPLY = /^(no[-_.]?reply|do[-_.]?not[-_.]?reply|ne[-_.]?pas[-_.]?repondre|notifications?|notify|alerts?|mailer-daemon|postmaster|bounces?|automated|robot|system)([-_.+].*)?@/i;

export function classifyHeaders(from: string, h: { listUnsubscribe?: string | null; listId?: string | null; precedence?: string | null; autoSubmitted?: string | null }): MailKind {
  if (h.listUnsubscribe || h.listId) return "newsletter";
  const precedence = (h.precedence ?? "").toLowerCase();
  if (precedence === "list") return "newsletter";
  if (/^(bulk|junk|auto_reply)$/.test(precedence)) return "notification";
  if (h.autoSubmitted && !/^no\b/i.test(h.autoSubmitted.trim())) return "notification";
  if (NO_REPLY.test(from)) return "notification";
  return "";
}

/** "<mailto:a@b?subject=x>, <https://…>" → the first web address and the first mail address. */
export function parseUnsubscribe(header: string | null | undefined, post: string | null | undefined): Unsubscribe | null {
  if (!header) return null;
  const out: Unsubscribe = {};
  for (const [, raw] of header.matchAll(/<([^>]+)>/g)) {
    const v = raw.trim();
    if (!out.http && /^https:\/\//i.test(v)) out.http = v;
    else if (!out.mailto && /^mailto:/i.test(v)) out.mailto = v;
  }
  if (out.http && /list-unsubscribe\s*=\s*one-click/i.test(post ?? "")) out.oneClick = true;
  return out.http || out.mailto ? out : null;
}

/** "mailto:a@b.ch?subject=unsubscribe&body=x" → where and what to send. */
export function mailtoParts(mailto: string): { to: string; subject: string; body: string } | null {
  const m = mailto.match(/^mailto:([^?]+)(?:\?(.*))?$/i);
  if (!m) return null;
  const to = decodeURIComponent(m[1]).trim();
  if (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(to)) return null;
  const q = new URLSearchParams(m[2] ?? "");
  return { to, subject: (q.get("subject") || "unsubscribe").slice(0, 200), body: (q.get("body") || "unsubscribe").slice(0, 2000) };
}
