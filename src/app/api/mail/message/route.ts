import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { fail, unauthorized } from "@/server/http";
import { openMail } from "@/server/mail/body";
import { mailError } from "@/server/mail/connect";

export const dynamic = "force-dynamic";

/** Opens a mail (?folder=INBOX&uid=12): its text, and it becomes read on the server. */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const params = new URL(req.url).searchParams;
  const folder = params.get("folder") ?? "";
  const uid = Number(params.get("uid"));
  if (!folder || folder.length > 500 || !Number.isInteger(uid) || uid <= 0) return fail("Mail invalide");
  try {
    const mail = await openMail(me.id, folder, uid);
    if (!mail) return fail("Ce mail n'existe plus (supprimé ou déplacé ailleurs)", 404);
    // My other devices: the mail is read, the counters drop.
    publish({ type: "mail", status: "ok", folders: [folder] }, [me.id]);
    return NextResponse.json({ mail });
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}
