import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, addMessage, audienceOf, listMessages } from "@/server/db";
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

  const message = addMessage({ conversationId: id, userId: me.id, body: text, fileIds });
  if (!message) return fail("Message vide");
  publish({ type: "message", message }, audienceOf(id));
  return NextResponse.json(message);
}
