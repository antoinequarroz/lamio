import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { setTrustedSender } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** "Toujours afficher les images de cet expéditeur" (or not anymore): { address, trusted }. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const body = (await req.json().catch(() => null)) as { address?: unknown; trusted?: unknown } | null;
  const address = typeof body?.address === "string" ? body.address.trim() : "";
  if (!address || address.length > 320 || !address.includes("@") || typeof body?.trusted !== "boolean") return fail("Adresse invalide");
  setTrustedSender(me.id, address, body.trusted);
  return NextResponse.json({ ok: true });
}
