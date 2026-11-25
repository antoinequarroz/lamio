import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { categoryUnread, isInbox, listMailMessages, listMailThreads, MAIL_CATEGORIES, MAIL_PAGE } from "@/server/mail/store";
import type { MailCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * The newest mails of a folder, from the local copy (instant).
 * ?folder=INBOX&before=<date ISO>|<uid> for the next page, &limit= up to 200,
 * &threads=1 for one row per conversation, &category=important|newsletter|notification for a tab of
 * the sorted inbox (the inbox's answer also carries the unread mails of each tab).
 */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const params = new URL(req.url).searchParams;
  const folder = params.get("folder") || "INBOX";
  if (folder.length > 500) return fail("Dossier invalide");
  let before: { date: string; uid: number } | undefined;
  const cursor = params.get("before");
  if (cursor) {
    const [date, uid] = cursor.split("|");
    if (!date || isNaN(Date.parse(date)) || !/^\d+$/.test(uid ?? "")) return fail("Curseur invalide");
    before = { date, uid: Number(uid) };
  }
  const limit = Math.min(200, Math.max(1, Number(params.get("limit")) || MAIL_PAGE));
  const inbox = isInbox(me.id, folder);
  const asked = params.get("category") as MailCategory | null;
  const category = inbox && asked && MAIL_CATEGORIES.includes(asked) ? asked : undefined;
  const page = (params.get("threads") === "1" ? listMailThreads : listMailMessages)(me.id, folder, before, limit, category);
  return NextResponse.json(inbox ? { ...page, categories: categoryUnread(me.id) } : page);
}
