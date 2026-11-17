import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, audienceOf, deleteMessage, editMessage, getMessage } from "@/server/db";
import { publish } from "@/server/events";
import { removeFiles } from "@/server/files";
import { body, fail, MAX_MESSAGE, unauthorized } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

/** Edits the text of a message: its author only. */
export async function PATCH(req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const message = getMessage(Number((await params).id));
  if (!message || !accessTo(message.conversationId, me.id)) return fail("Message introuvable", 404);
  if (message.userId !== me.id) return fail("Ce message n'est pas le tien", 403);
  const data = await body(req);
  const text = typeof data.body === "string" ? data.body.trim() : "";
  if (text.length > MAX_MESSAGE) return fail("Message trop long");
  if (!text && !message.files.length) return fail("Message vide");
  if (text === message.body) return NextResponse.json(message);
  const updated = editMessage(message.id, text)!;
  publish({ type: "message-updated", message: updated }, audienceOf(updated.conversationId));
  return NextResponse.json(updated);
}

/** Deletes a message (and the replies of its thread): its author, or an admin. */
export async function DELETE(_req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const message = getMessage(Number((await params).id));
  if (!message || !accessTo(message.conversationId, me.id)) return fail("Message introuvable", 404);
  if (message.userId !== me.id && me.role !== "admin") return fail("Ce message n'est pas le tien", 403);
  const audience = audienceOf(message.conversationId);
  removeFiles(deleteMessage(message.id));
  publish({ type: "message-deleted", conversationId: message.conversationId, id: message.id, parentId: message.parentId }, audience);
  // The message that started the thread now has one reply less.
  const parent = message.parentId ? getMessage(message.parentId) : null;
  if (parent) publish({ type: "message-updated", message: parent }, audience);
  return NextResponse.json({ ok: true });
}
