import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { unauthorized } from "@/server/http";
import { myTasks } from "@/server/projects";

export const dynamic = "force-dynamic";

/** "Mes tâches": what is assigned to me and not done, across the active projects. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json({ tasks: myTasks(me.id) });
}
