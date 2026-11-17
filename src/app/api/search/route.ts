import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { searchMessages } from "@/server/db";
import { unauthorized } from "@/server/http";
import { searchTasks } from "@/server/projects";

export const dynamic = "force-dynamic";

/** Searches the messages of the conversations I can read, and the tasks: GET /api/search?q=… */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 200);
  const long = q.trim().length >= 2;
  return NextResponse.json({ hits: long ? searchMessages(me.id, q) : [], tasks: long ? searchTasks(q) : [] });
}
