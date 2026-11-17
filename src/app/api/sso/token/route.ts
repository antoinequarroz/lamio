import { NextResponse } from "next/server";
import { ssoClient } from "@/modules/registry";
import { mayOpenModule } from "@/server/db";
import { body, fail } from "@/server/http";
import { redeemCode, sameSecret } from "@/server/sso";

/** Step 3 of the single sign-on: the tool's server trades its code for the person. See src/server/sso.ts. */
export async function POST(req: Request) {
  const data = await body(req);
  const client = typeof data.client === "string" ? ssoClient(data.client) : null;
  const secret = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!client || !sameSecret(secret, client.secret)) return fail("Non autorisé", 401);

  const user = typeof data.code === "string" ? redeemCode(data.client as string, data.code) : null;
  if (!user || !mayOpenModule(client.id, user)) return fail("Code invalide ou expiré", 400);
  return NextResponse.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role } }, { headers: { "Cache-Control": "no-store" } });
}
