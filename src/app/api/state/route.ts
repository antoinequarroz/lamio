import { NextResponse } from "next/server";
import type { AppState } from "@/lib/types";
import { listModules } from "@/modules/registry";
import { currentUser } from "@/server/auth";
import { listConversations, listUsers } from "@/server/db";
import { unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** Everything the shell needs at once: who I am, the team, my conversations, the modules. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  const state: AppState = { me, users: listUsers(), conversations: listConversations(me.id), modules: listModules() };
  return NextResponse.json(state);
}
