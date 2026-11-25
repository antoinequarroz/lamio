import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { listMailMessages, MAIL_PAGE } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/**
 * The newest mails of a folder, from the local copy (instant).
 * ?folder=INBOX&before=<date ISO>|<uid> for the next page, &limit= up to 200.
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
  return NextResponse.json(listMailMessages(me.id, folder, before, limit));
}
