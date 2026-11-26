import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { canManage, createWebhook, listWebhooks } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, MAX_NAME, text, unauthorized } from "@/server/http";
import { hookUrl, publicOrigin } from "@/server/webhook";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** The incoming webhooks of a channel: for whoever manages it (its creator, or an admin). */
export async function GET(_req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!canManage(id, me)) return fail("Canal introuvable", 404);
  return NextResponse.json(listWebhooks(id));
}

/** Creates one. Its address (with the token) is in the answer, and only there. */
export async function POST(req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!canManage(id, me)) return fail("Canal introuvable", 404);
  const name = text((await body(req)).name, MAX_NAME);
  if (!name) return fail("Indique un nom, par exemple Orbi");
  const created = createWebhook({ conversationId: id, name, createdBy: me.id });
  if (!created) return fail("Canal introuvable", 404);
  // Everyone's list of authors gets the new account.
  publish({ type: "refresh" }, "all");
  return NextResponse.json({ ...created.webhook, url: hookUrl(publicOrigin(req), created.token) });
}
