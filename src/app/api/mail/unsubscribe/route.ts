import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { body, fail, unauthorized } from "@/server/http";
import { mailError } from "@/server/mail/connect";
import { unsubscribe } from "@/server/mail/unsubscribe";

export const dynamic = "force-dynamic";

/** Leaves the mailing list of a mail: { folder, uid } → { done: "web" | "mail" } or { open: url }. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);
  const folder = typeof data.folder === "string" ? data.folder : "";
  const uid = Number(data.uid);
  if (!folder || folder.length > 500 || !Number.isInteger(uid) || uid <= 0) return fail("Mail invalide");
  try {
    return NextResponse.json(await unsubscribe(me.id, folder, uid));
  } catch (e) {
    return fail(mailError(e, "smtp").message, 502);
  }
}
