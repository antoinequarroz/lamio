import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { tickupConfig, tickupProjects, TickupProblem } from "@/server/tickup";

export const dynamic = "force-dynamic";

/** The TickUp projects a ticket can go to. { ready: false } when TickUp is not plugged in. */
export async function GET() {
  if (!(await currentUser())) return unauthorized();
  if (!tickupConfig()) return NextResponse.json({ ready: false, projects: [] });
  try {
    return NextResponse.json({ ready: true, projects: await tickupProjects() });
  } catch (e) {
    return fail(e instanceof TickupProblem ? e.message : "TickUp ne répond pas pour le moment.", 502);
  }
}
