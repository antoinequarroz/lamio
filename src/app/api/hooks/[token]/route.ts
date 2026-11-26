import { NextResponse } from "next/server";
import { addMessage, audienceOf, webhookByToken } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail } from "@/server/http";
import { webhookText, withinRate } from "@/server/webhook";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ token: string }> };

/**
 * Incoming webhook: another tool of the suite (Orbi's alerts…) posts a message in a channel.
 * The address itself is the secret: no session, no cookie.
 *   POST /api/hooks/<token>   { "text": "…" }   →   200 { ok: true, id }
 */
export async function POST(req: Request, { params }: Params) {
  const { token } = await params;
  const hook = token.startsWith("whk_") ? webhookByToken(token) : null;
  if (!hook) return fail("Webhook introuvable", 404);
  if (!withinRate(hook.id)) return fail("Trop de messages, réessaie dans une minute", 429);
  const text = webhookText(await body(req));
  if (!text) return fail("Message vide");
  const message = addMessage({ conversationId: hook.conversationId, userId: hook.userId, body: text, fileIds: [] });
  if (!message) return fail("Message vide");
  publish({ type: "message", message }, audienceOf(hook.conversationId));
  return NextResponse.json({ ok: true, id: message.id });
}
