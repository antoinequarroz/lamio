import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { mailError } from "@/server/mail/connect";
import { parseDraft } from "@/server/mail/draft-input";
import { deleteDraft, prepare, saveDraft } from "@/server/mail/send";

export const dynamic = "force-dynamic";

/** Saves the mail being written into the mailbox's Drafts, in place of its previous version. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Brouillon invalide");
  const parsed = await parseDraft(form, { requireRecipient: false });
  if ("error" in parsed) return fail(parsed.error);
  try {
    const out = await prepare(me.id, me.name, parsed.draft, parsed.files);
    return NextResponse.json(await saveDraft(me.id, parsed.draft, out));
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}

/** Throws a draft away (?folder=&uid=). */
export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const params = new URL(req.url).searchParams;
  const folder = params.get("folder") ?? "";
  const uid = Number(params.get("uid"));
  if (!folder || !Number.isInteger(uid) || uid <= 0) return fail("Brouillon invalide");
  try {
    await deleteDraft(me.id, folder, uid);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}
