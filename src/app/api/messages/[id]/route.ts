import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, audienceOf, deleteMessage, getMessage } from "@/server/db";
import { publish } from "@/server/events";
import { removeFiles } from "@/server/files";
import { fail, unauthorized } from "@/server/http";

/** Deletes a message: its author, or an admin. */
export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const message = getMessage(Number((await params).id));
  if (!message || !accessTo(message.conversationId, me.id)) return fail("Message introuvable", 404);
  if (message.userId !== me.id && me.role !== "admin") return fail("Ce message n'est pas le tien", 403);
  const audience = audienceOf(message.conversationId);
  removeFiles(deleteMessage(message.id));
  publish({ type: "message-deleted", conversationId: message.conversationId, id: message.id }, audience);
  return NextResponse.json({ ok: true });
}
