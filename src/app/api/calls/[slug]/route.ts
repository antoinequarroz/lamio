import { NextResponse } from "next/server";
import { AlfredError, callStatus, validSlug } from "@/server/alfred";
import { currentUser } from "@/server/auth";
import { mayJoinCall } from "@/server/db";
import { fail, unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** Whether a call is still on, and how many people are in it, for its card. */
export async function GET(_req: Request, { params }: { params: Promise<{ slug: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { slug } = await params;
  if (!validSlug(slug) || !mayJoinCall(slug, me.id)) return fail("Appel introuvable", 404);
  try {
    return NextResponse.json(await callStatus(slug));
  } catch (err) {
    if (err instanceof AlfredError) return fail(err.message, err.status);
    throw err;
  }
}
