import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, addMessage, audienceOf, getMessage, listMessages } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, MAX_FILES_PER_MESSAGE, MAX_MESSAGE, unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!accessTo(id, me.id)) return fail("Conversation introuvable", 404);
  const before = Number(new URL(req.url).searchParams.get("before"));
  return NextResponse.json(listMessages(id, Number.isInteger(before) && before > 0 ? before : undefined));
}

export async function POST(req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!accessTo(id, me.id)) return fail("Conversation introuvable", 404);

  const data = await body(req);
  const text = typeof data.body === "string" ? data.body.trim() : "";
  const fileIds = Array.isArray(data.fileIds) ? data.fileIds.filter((f): f is string => typeof f === "string").slice(0, MAX_FILES_PER_MESSAGE) : [];
  if (text.length > MAX_MESSAGE) return fail("Message trop long");
  if (!text && !fileIds.length) return fail("Message vide");

  const parentId = data.parentId === undefined || data.parentId === null ? undefined : Number(data.parentId);
  if (parentId !== undefined && !Number.isInteger(parentId)) return fail("Fil introuvable", 404);

  const message = addMessage({ conversationId: id, userId: me.id, body: text, fileIds, parentId });
  if (!message) return fail(parentId !== undefined && (text || fileIds.length) ? "Fil introuvable" : "Message vide", parentId !== undefined ? 404 : 400);
  const audience = audienceOf(id);
  publish({ type: "message", message }, audience);
  // The message that started the thread shows one reply more.
  const parent = message.parentId ? getMessage(message.parentId) : null;
  if (parent) publish({ type: "message-updated", message: parent }, audience);
  return NextResponse.json(message);
}
