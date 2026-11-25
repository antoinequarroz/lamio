import { NextResponse } from "next/server";
import { AlfredError, callsConfigured, createCallRoom } from "@/server/alfred";
import { currentUser } from "@/server/auth";
import { accessTo, addMessage, audienceOf, callTitle } from "@/server/db";
import { publish } from "@/server/events";
import { fail, unauthorized } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

/**
 * Starts a video call in a conversation: Alfred creates the room, and a message with the call's
 * card goes to the conversation, so everyone in it can join.
 */
export async function POST(_req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (!callsConfigured()) return fail("Les appels ne sont pas branchés", 404);
  const { id } = await params;
  if (!accessTo(id, me.id)) return fail("Conversation introuvable", 404);
  try {
    const room = await createCallRoom(callTitle(id, me.id));
    const message = addMessage({ conversationId: id, userId: me.id, body: "", fileIds: [], call: room });
    if (!message) return fail("Appel impossible", 500);
    publish({ type: "message", message }, audienceOf(id));
    return NextResponse.json(message);
  } catch (err) {
    if (err instanceof AlfredError) return fail(err.message, err.status);
    throw err;
  }
}
