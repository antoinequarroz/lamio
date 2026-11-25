import { NextResponse } from "next/server";
import type { MailCategory } from "@/lib/types";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { isInbox, MAIL_CATEGORIES, setSenderRule, specialFolder } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** "Toujours dans …" for a sender: { address, category: "important" | "newsletter" | "notification" | null }. */
export async function PUT(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);
  const address = typeof data.address === "string" ? data.address.trim().toLowerCase() : "";
  const category = data.category === null ? null : MAIL_CATEGORIES.includes(data.category as MailCategory) ? (data.category as MailCategory) : undefined;
  if (!address || address.length > 320 || !address.includes("@")) return fail("Adresse invalide");
  if (category === undefined) return fail("Choix invalide");
  setSenderRule(me.id, address, category);
  // The tabs of my other devices follow.
  const inbox = specialFolder(me.id, "\\Inbox") ?? "INBOX";
  if (isInbox(me.id, inbox)) publish({ type: "mail", status: "ok", folders: [inbox] }, [me.id]);
  return NextResponse.json({ ok: true });
}
