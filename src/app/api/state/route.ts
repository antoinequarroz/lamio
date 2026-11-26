import { NextResponse } from "next/server";
import type { AppState } from "@/lib/types";
import { listModules } from "@/modules/registry";
import { calendarConfigured, callsConfigured } from "@/server/alfred";
import { currentUser } from "@/server/auth";
import { listBots, listConversations, listUsers, moduleAccess } from "@/server/db";
import { unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** Everything the shell needs at once: who I am, the team, my conversations, the modules. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  const access = moduleAccess();
  const modules = listModules().map((m) => {
    if (!m.sso && !m.embedded) return m;
    const ids = access[m.id] ?? [];
    return { ...m, allowed: me.role === "admin" || ids.includes(me.id), ...(me.role === "admin" && { allowedIds: ids }) };
  });
  const calendar = calendarConfigured() && !!modules.find((m) => m.id === "agenda")?.allowed;
  const state: AppState = { me, users: listUsers(), bots: listBots(), conversations: listConversations(me.id, me.role), modules, calendar, calls: callsConfigured() };
  return NextResponse.json(state);
}
