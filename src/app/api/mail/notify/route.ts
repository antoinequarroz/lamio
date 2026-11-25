import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { mailAccountInfo, setMailNotify } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** Which new mails notify: { notify: "all" | "important" | "known" | "off" }. */
export async function PUT(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (!mailAccountInfo(me.id)) return fail("Aucune boîte mail branchée", 404);
  const body = (await req.json().catch(() => null)) as { notify?: unknown } | null;
  const notify = body?.notify;
  if (notify !== "all" && notify !== "important" && notify !== "known" && notify !== "off") return fail("Choix invalide");
  setMailNotify(me.id, notify);
  return NextResponse.json({ ok: true });
}
