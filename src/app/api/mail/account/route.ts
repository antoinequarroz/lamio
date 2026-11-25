import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { testMailSettings } from "@/server/mail/connect";
import { parseMailSettings } from "@/server/mail/input";
import { encryptSecret, mailEnabled } from "@/server/mail/secret";
import { settingsFor, start, stop, syncNow } from "@/server/mail/service";
import { deleteMailAccount, mailAccountInfo, saveMailAccount } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** My mailbox settings (never the password), and whether Mails is on for this server. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json({ enabled: mailEnabled(), account: mailAccountInfo(me.id) });
}

/** Plugs in (or changes) my mailbox: both servers must accept the login before anything is saved. */
export async function PUT(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  if (!mailEnabled()) return fail("Les mails ne sont pas activés sur ce serveur (MAIL_SECRET manquant)", 503);
  const saved = settingsFor(me.id);
  const b = await body(req);
  const settings = parseMailSettings(b, saved && saved.email === String(b.email ?? "").trim().toLowerCase() ? saved.password : null);
  if (typeof settings === "string") return fail(settings);
  const refused = await testMailSettings(settings);
  if (refused) return fail(refused.message, 422);
  const { password, ...input } = settings;
  saveMailAccount(me.id, input, encryptSecret(password, me.id));
  start(me.id);
  // The first sync can take a while on a big mailbox: it runs on, the app hears about it live.
  void syncNow(me.id, { full: true });
  publish({ type: "mail", status: "pending", folders: ["*"] }, [me.id]);
  return NextResponse.json({ account: mailAccountInfo(me.id) });
}

/** Unplugs my mailbox: settings, password and local copy are deleted. The mailbox itself is untouched. */
export async function DELETE() {
  const me = await currentUser();
  if (!me) return unauthorized();
  stop(me.id);
  deleteMailAccount(me.id);
  publish({ type: "mail", status: "pending", folders: ["*"] }, [me.id]);
  return NextResponse.json({ ok: true });
}
