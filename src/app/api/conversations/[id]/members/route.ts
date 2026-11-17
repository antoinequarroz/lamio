import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, addMember, audienceOf, getUser, removeMember } from "@/server/db";
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

/** I leave a private channel. */
export async function DELETE(_req: Request, { params }: Params) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (accessTo(id, me.id) !== "private") return fail("Canal privé introuvable", 404);
  const audience = audienceOf(id);
  removeFiles(removeMember(id, me.id));
  publish({ type: "refresh" }, audience);
  return NextResponse.json({ ok: true });
}
