import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { body, fail, unauthorized } from "@/server/http";
import { testMailSettings } from "@/server/mail/connect";
import { parseMailSettings } from "@/server/mail/input";
import { mailEnabled } from "@/server/mail/secret";
import { settingsFor } from "@/server/mail/service";

/** "Tester la connexion": logs in to both servers with these settings, saves nothing. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (!mailEnabled()) return fail("Les mails ne sont pas activés sur ce serveur (MAIL_SECRET manquant)", 503);
  const saved = settingsFor(me.id);
  const b = await body(req);
  const settings = parseMailSettings(b, saved && saved.email === String(b.email ?? "").trim().toLowerCase() ? saved.password : null);
  if (typeof settings === "string") return fail(settings);
  const refused = await testMailSettings(settings);
  if (refused) return fail(refused.message, 422);
  return NextResponse.json({ ok: true });
}
