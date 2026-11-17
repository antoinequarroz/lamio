import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, markRead } from "@/server/db";
import { body, fail, unauthorized } from "@/server/http";

/** Remembers how far I have read this conversation. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!accessTo(id, me.id)) return fail("Conversation introuvable", 404);
  const { messageId } = await body(req);
  if (typeof messageId !== "number" || !Number.isInteger(messageId) || messageId < 0) return fail("messageId invalide");
  markRead(me.id, id, messageId);
  return NextResponse.json({ ok: true });
}
