import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { searchMessages } from "@/server/db";
import { unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** Searches the messages of the conversations I can read: GET /api/search?q=… */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
  return NextResponse.json({ hits: q.trim().length >= 2 ? searchMessages(me.id, q) : [] });
}
