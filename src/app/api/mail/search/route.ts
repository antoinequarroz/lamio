import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { mailError } from "@/server/mail/connect";
import { searchLocal, searchServer, type MailQuery } from "@/server/mail/search";
import { mailAccountInfo } from "@/server/mail/store";

export const dynamic = "force-dynamic";

const day = (v: string | null) => (v && !isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

/**
 * Searches the mails: ?q=words de:lea à:paul &folder= &unread=1 &attachments=1 &since= &before=.
 * From the local copy (instant), or with &server=1 on the mailbox too (full text, old mails).
 */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (!mailAccountInfo(me.id)) return NextResponse.json({ messages: [] });
  const p = new URL(req.url).searchParams;
  const query: MailQuery = {
    q: (p.get("q") ?? "").slice(0, 200),
    folder: p.get("folder") || null,
    unread: p.get("unread") === "1",
    attachments: p.get("attachments") === "1",
    since: day(p.get("since")),
    before: day(p.get("before")),
  };
  const limit = Math.min(100, Math.max(1, Number(p.get("limit")) || 50));
  if (p.get("server") !== "1") return NextResponse.json({ messages: searchLocal(me.id, query, limit) });
  try {
    const remote = await searchServer(me.id, query, limit);
    // The two together: what the server found (now in the copy) and what only the copy knows.
    const seen = new Set(remote.map((m) => `${m.folder}|${m.uid}`));
    const local = searchLocal(me.id, query, limit).filter((m) => !seen.has(`${m.folder}|${m.uid}`));
    const messages = [...remote, ...local].sort((a, b) => b.date.localeCompare(a.date) || b.uid - a.uid).slice(0, limit);
    return NextResponse.json({ messages, server: true });
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}
