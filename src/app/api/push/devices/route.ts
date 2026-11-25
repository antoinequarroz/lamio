import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { removePushDevice, savePushDevice } from "@/server/mail/store";

export const dynamic = "force-dynamic";

// An APNs device token: hexadecimal, 64 characters today, longer allowed by Apple.
const TOKEN = /^[0-9a-f]{64,200}$/;

async function tokenOf(req: Request) {
  const body = (await req.json().catch(() => null)) as { token?: unknown; platform?: unknown } | null;
  const token = typeof body?.token === "string" ? body.token.toLowerCase() : "";
  return { token: TOKEN.test(token) ? token : null, platform: body?.platform };
}

/** The iPhone app registers itself for push notifications: { token, platform: "ios" }. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { token, platform } = await tokenOf(req);
  if (!token || platform !== "ios") return fail("Appareil invalide");
  savePushDevice(me.id, token, platform);
  return NextResponse.json({ ok: true });
}

/** No more notifications on this device (signed out, or turned off in the app). */
export async function DELETE(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { token } = await tokenOf(req);
  if (!token) return fail("Appareil invalide");
  removePushDevice(token, me.id);
  return NextResponse.json({ ok: true });
}
