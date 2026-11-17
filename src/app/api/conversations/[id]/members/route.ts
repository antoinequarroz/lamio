import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, addMember, audienceOf, canManage, getUser, removeMember } from "@/server/db";
import { publish } from "@/server/events";
import { removeFiles } from "@/server/files";
import { body, fail, unauthorized } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

/** A member of a private channel brings someone else in. */
export async function POST(req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (accessTo(id, me.id) !== "private") return fail("Canal privé introuvable", 404);
  const { userId } = await body(req);
  const other = typeof userId === "string" ? getUser(userId) : null;
  if (!other) return fail("Personne introuvable", 404);
  addMember(id, other.id);
  publish({ type: "refresh" }, audienceOf(id));
  return NextResponse.json({ ok: true });
}

/**
 * Leaves a private channel, or with ?userId=… removes someone else from it
 * (the channel's creator or an admin only).
 */
export async function DELETE(req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (accessTo(id, me.id) !== "private") return fail("Canal privé introuvable", 404);
  const target = new URL(req.url).searchParams.get("userId") ?? me.id;
  if (target !== me.id && !canManage(id, me)) return fail("Seul le créateur du canal ou un administrateur peut retirer quelqu'un", 403);
  // Captured before the removal, so the person who leaves is told too.
  const audience = audienceOf(id);
  if (!audience.includes(target)) return fail("Cette personne n'est pas dans le canal", 404);
  removeFiles(removeMember(id, target));
  publish({ type: "refresh" }, audience);
  return NextResponse.json({ ok: true });
}
