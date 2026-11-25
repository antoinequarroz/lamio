import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { body, fail, unauthorized } from "@/server/http";
import { aiReady, draftReply, summarize } from "@/server/mail/ai";
import { mailError, MailProblem } from "@/server/mail/connect";
import { mailAccountInfo } from "@/server/mail/store";

export const dynamic = "force-dynamic";
// Claude may take a little while on a long conversation.
export const maxDuration = 120;

/**
 * The AI help on a mail and its conversation:
 *   { action: "summary", folder, uid, fresh? }         → { summary, actions, mails, at }
 *   { action: "draft", folder, uid, instruction? }     → { text }: a reply in my tone, for the compose window
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (!aiReady()) return fail("L'aide IA n'est pas branchée sur ce serveur (ANTHROPIC_API_KEY)", 503);
  if (!mailAccountInfo(me.id)) return fail("Aucune boîte mail branchée", 404);
  const data = await body(req);
  const folder = typeof data.folder === "string" ? data.folder : "";
  const uid = Number(data.uid);
  if (!folder || folder.length > 500 || !Number.isInteger(uid) || uid <= 0) return fail("Mail invalide");
  try {
    if (data.action === "summary") return NextResponse.json(await summarize(me.id, folder, uid, undefined, data.fresh === true));
    if (data.action === "draft") {
      const instruction = typeof data.instruction === "string" ? data.instruction.slice(0, 2000) : "";
      return NextResponse.json({ text: await draftReply(me.id, folder, uid, instruction) });
    }
    return fail("Action inconnue");
  } catch (e) {
    if (e instanceof MailProblem) return fail(e.message, 502);
    return fail(mailError(e).message, 502);
  }
}
