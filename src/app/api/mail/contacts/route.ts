import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { unauthorized } from "@/server/http";
import { mailContacts } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** Addresses already seen in the mailbox matching ?q=, for the To / Cc / Cci fields. */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const q = (new URL(req.url).searchParams.get("q") ?? "").slice(0, 100);
  return NextResponse.json({ contacts: q.trim() ? mailContacts(me.id, q) : [] });
}
