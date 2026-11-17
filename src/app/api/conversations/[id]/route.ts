import { NextResponse } from "next/server";
import { slugify } from "@/lib/utils";
import { currentUser } from "@/server/auth";
import { audienceOf, canManage, updateChannel } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";

/** Renames a channel or changes its description: its creator, or an admin. */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!canManage(id, me)) return fail("Seul le créateur du canal ou un administrateur peut le modifier", 403);
  const data = await body(req);

  const patch: { name?: string; topic?: string } = {};
  if (data.name !== undefined) {
    patch.name = slugify(typeof data.name === "string" ? data.name : "");
    if (!patch.name) return fail("Donne un nom au canal");
  }
  if (data.topic !== undefined) {
    if (typeof data.topic !== "string" || data.topic.trim().length > 200) return fail("Description trop longue");
    patch.topic = data.topic.trim();
  }
  if (!updateChannel(id, patch)) return fail(`Le nom #${patch.name} est déjà pris`, 409);
  publish({ type: "refresh" }, audienceOf(id));
  return NextResponse.json({ ok: true });
}
