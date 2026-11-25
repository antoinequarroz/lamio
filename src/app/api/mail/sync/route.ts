import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { syncNow } from "@/server/mail/service";
import { mailAccount, mailAccountInfo, setMailStatus } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** "Synchroniser": a full pass now. Answers once the mailbox is up to date. */
export async function POST() {
  const me = await currentUser();
  if (!me) return unauthorized();
  const account = mailAccount(me.id);
  if (!account) return fail("Aucune boîte mail branchée", 404);
  // Asked by hand: one more try even after a refused password.
  if (account.status === "auth") setMailStatus(me.id, "pending");
  await syncNow(me.id, { full: true });
  return NextResponse.json({ account: mailAccountInfo(me.id) });
}
