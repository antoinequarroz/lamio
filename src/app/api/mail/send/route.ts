import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { mailError } from "@/server/mail/connect";
import { parseDraft } from "@/server/mail/draft-input";
import { scheduleSend, validDue } from "@/server/mail/later";
import { cancelSend, prepare, queueSend, UNDO_MS } from "@/server/mail/send";

export const dynamic = "force-dynamic";

/**
 * Sends a mail (multipart: "mail" JSON and "files"). It leaves in UNDO_MS unless cancelled, or at
 * "at" (ISO time) when the send is scheduled: then it waits on the server (see mail/later.ts).
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const form = await req.formData().catch(() => null);
  if (!form) return fail("Mail invalide");
  const parsed = await parseDraft(form, { requireRecipient: true });
  if ("error" in parsed) return fail(parsed.error);
  const at = form.get("at");
  const due = at ? validDue(String(at)) : null;
  if (at && !due) return fail("Heure d'envoi invalide");
  try {
    const out = await prepare(me.id, me.name, parsed.draft, parsed.files);
    if (due) return NextResponse.json({ scheduled: { id: scheduleSend(me.id, parsed.draft, out, due), due: due.toISOString() } });
    return NextResponse.json({ id: queueSend(me.id, parsed.draft, out), undoMs: UNDO_MS });
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}

/** "Annuler": the mail does not leave (?id=…). 409 when it already has. */
export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  return cancelSend(me.id, id) ? NextResponse.json({ ok: true }) : fail("Trop tard : le mail est déjà parti", 409);
}
