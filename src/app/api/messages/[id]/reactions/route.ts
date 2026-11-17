import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, audienceOf, getMessage, toggleReaction } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";

/** One emoji (flags, skin tones and joined emoji included), nothing else. */
const isEmoji = (value: unknown): value is string => typeof value === "string" && value.length <= 32 && /^(\p{Extended_Pictographic}|\p{Regional_Indicator})[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}‍️]*$/u.test(value);

/** Adds my reaction to a message, or removes it if it was already there. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const message = getMessage(Number((await params).id));
  if (!message || !accessTo(message.conversationId, me.id)) return fail("Message introuvable", 404);
  const { emoji } = await body(req);
  if (!isEmoji(emoji)) return fail("Réaction invalide");
  const updated = toggleReaction(message.id, me.id, emoji);
  if (!updated) return fail("Trop de réactions différentes sur ce message");
  publish({ type: "message-updated", message: updated }, audienceOf(updated.conversationId));
  return NextResponse.json(updated);
}
