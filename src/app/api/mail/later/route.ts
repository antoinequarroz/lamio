import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { mailError } from "@/server/mail/connect";
import { cancelLater, followUp, listLater, runNow, snooze, validDue } from "@/server/mail/later";

export const dynamic = "force-dynamic";

/** What waits on the server: scheduled sends, snoozed mails, follow-ups. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json({ items: listLater(me.id) });
}

/**
 * { action: "snooze", folder, uids, until } · { action: "followup", folder, uid, at }
 * · { action: "now", id } (a scheduled send leaves now, a snoozed mail comes back now).
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);
  const folder = typeof data.folder === "string" && data.folder.length <= 500 ? data.folder : "";
  try {
    if (data.action === "snooze") {
      const until = validDue(data.until);
      const uids = Array.isArray(data.uids) ? data.uids.filter((u): u is number => Number.isInteger(u) && (u as number) > 0).slice(0, 500) : [];
      if (!folder || !uids.length) return fail("Mail invalide");
      if (!until) return fail("Choisis une date à venir");
      return NextResponse.json({ id: await snooze(me.id, folder, uids, until), until: until.toISOString() });
    }
    if (data.action === "followup") {
      const at = validDue(data.at);
      const uid = Number(data.uid);
      if (!folder || !Number.isInteger(uid) || uid <= 0) return fail("Mail invalide");
      if (!at) return fail("Choisis une date à venir");
      const id = followUp(me.id, folder, uid, at);
      publish({ type: "mail", status: "ok", folders: [] }, [me.id]);
      return NextResponse.json({ id, at: at.toISOString() });
    }
    if (data.action === "now") {
      const id = typeof data.id === "string" ? data.id : "";
      return (await runNow(me.id, id)) ? NextResponse.json({ ok: true }) : fail("Déjà fait", 404);
    }
    return fail("Action inconnue");
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}

/** Cancels a scheduled send or a follow-up (?id=…); for a snooze, the mails come back now. */
export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const id = new URL(req.url).searchParams.get("id") ?? "";
  try {
    return (await cancelLater(me.id, id)) ? NextResponse.json({ ok: true }) : fail("Trop tard : c'est déjà fait", 409);
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}
