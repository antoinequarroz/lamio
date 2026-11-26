import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { canManage, deleteWebhook, getWebhook } from "@/server/db";
import { fail, unauthorized } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

/** Deletes an incoming webhook: its address stops working at once. */
export async function DELETE(_req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const hook = getWebhook((await params).id);
  if (!hook || !canManage(hook.conversationId, me)) return fail("Webhook introuvable", 404);
  deleteWebhook(hook.id);
  return NextResponse.json({ ok: true });
}
