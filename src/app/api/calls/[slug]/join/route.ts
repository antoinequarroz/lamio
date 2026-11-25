import { NextResponse } from "next/server";
import { AlfredError, callPass, validSlug } from "@/server/alfred";
import { currentUser } from "@/server/auth";
import { mayJoinCall } from "@/server/db";
import { fail, unauthorized } from "@/server/http";

/** Joining a call: Alfred gives this person an entry without waiting room, under their Lamio name. */
export async function POST(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { slug } = await params;
  if (!validSlug(slug) || !mayJoinCall(slug, me.id)) return fail("Appel introuvable", 404);
  try {
    return NextResponse.json(await callPass(slug, me.name));
  } catch (err) {
    if (err instanceof AlfredError) return fail(err.message, err.status);
    throw err;
  }
}
