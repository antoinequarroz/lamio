import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, getMessage, listReplies } from "@/server/db";
import { fail, unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** A thread: the message that started it, and its replies. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const parent = getMessage(Number((await params).id));
  if (!parent || parent.parentId !== null || !accessTo(parent.conversationId, me.id)) return fail("Fil introuvable", 404);
  return NextResponse.json({ parent, replies: listReplies(parent.id) });
}
