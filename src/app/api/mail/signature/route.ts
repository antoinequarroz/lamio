import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { mailAccountInfo, setSignature } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** The signature added under new mails: { signature } (plain text, 2000 characters at most). */
export async function PUT(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (!mailAccountInfo(me.id)) return fail("Aucune boîte mail branchée", 404);
  const body = (await req.json().catch(() => null)) as { signature?: unknown } | null;
  if (typeof body?.signature !== "string" || body.signature.length > 2000) return fail("Signature invalide");
  setSignature(me.id, body.signature.replace(/\r\n/g, "\n"));
  return NextResponse.json({ ok: true });
}
