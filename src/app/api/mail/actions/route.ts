import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { fail, unauthorized } from "@/server/http";
import { applyAction, type MailAction } from "@/server/mail/actions";
import { mailError } from "@/server/mail/connect";
import { syncNow } from "@/server/mail/service";

export const dynamic = "force-dynamic";

function parseAction(v: unknown): MailAction | null {
  const a = v as { type?: unknown; value?: unknown; to?: unknown } | null;
  if (!a) return null;
  if ((a.type === "seen" || a.type === "flagged") && typeof a.value === "boolean") return { type: a.type, value: a.value };
  if (a.type === "move" && typeof a.to === "string" && a.to && a.to.length <= 500) return { type: "move", to: a.to };
  if (a.type === "archive" || a.type === "trash" || a.type === "spam" || a.type === "delete") return { type: a.type };
  return null;
}

/** { folder, uids, action }: read / unread, flag, archive, trash, spam, move, delete for good. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const body = (await req.json().catch(() => null)) as { folder?: unknown; uids?: unknown; action?: unknown } | null;
  const folder = typeof body?.folder === "string" ? body.folder : "";
  const uids = Array.isArray(body?.uids) ? body.uids.filter((u): u is number => Number.isInteger(u) && u > 0).slice(0, 1000) : [];
  const action = parseAction(body?.action);
  if (!folder || !uids.length || !action) return fail("Action invalide");
  try {
    const result = await applyAction(me.id, folder, uids, action);
    if (result.folders.length) {
      publish({ type: "mail", status: "ok", folders: result.folders }, [me.id]);
      // The destination folder gets the mails with their new numbers.
      if (result.moved) void syncNow(me.id);
    }
    return NextResponse.json(result);
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}
