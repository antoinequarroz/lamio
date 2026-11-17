import { NextResponse } from "next/server";
import type { AppState } from "@/lib/types";
import { listModules } from "@/modules/registry";
import { currentUser } from "@/server/auth";
import { listConversations, listUsers, moduleAccess } from "@/server/db";
import { unauthorized } from "@/server/http";
import { listProjects } from "@/server/projects";

export const dynamic = "force-dynamic";

/** Everything the shell needs at once: who I am, the team, my conversations, the modules. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  const access = moduleAccess();
  const modules = listModules().map((m) => {
    if (!m.sso) return m;
    const ids = access[m.id] ?? [];
    return { ...m, allowed: me.role === "admin" || ids.includes(me.id), ...(me.role === "admin" && { allowedIds: ids }) };
  });
  const state: AppState = { me, users: listUsers(), conversations: listConversations(me.id, me.role), modules, projects: listProjects() };
  return NextResponse.json(state);
}
