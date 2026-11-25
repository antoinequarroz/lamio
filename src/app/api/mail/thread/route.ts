import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { threadMessages } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** The whole conversation of a mail, oldest first: ?folder=INBOX&uid=42. */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const params = new URL(req.url).searchParams;
  const folder = params.get("folder") || "INBOX";
  const uid = Number(params.get("uid"));
  if (folder.length > 500 || !Number.isInteger(uid) || uid <= 0) return fail("Mail invalide");
  return NextResponse.json({ messages: threadMessages(me.id, folder, uid) });
}
