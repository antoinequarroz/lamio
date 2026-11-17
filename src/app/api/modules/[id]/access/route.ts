import { NextResponse } from "next/server";
import { listModules } from "@/modules/registry";
import { currentUser } from "@/server/auth";
import { getUser, setModuleAccess } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";

/** An admin lets a member open a tool with their account, or takes that back. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (me.role !== "admin") return fail("Réservé aux administrateurs", 403);
  const { id } = await params;
  if (!listModules().some((m) => m.id === id && m.sso)) return fail("Module introuvable", 404);
  const data = await body(req);
  const user = typeof data.userId === "string" ? getUser(data.userId) : null;
  if (!user || typeof data.allowed !== "boolean") return fail("Demande invalide");
  setModuleAccess(id, user.id, data.allowed);
  publish({ type: "refresh" }, "all");
  return NextResponse.json({ ok: true });
}
