import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { unauthorized } from "@/server/http";
import { listFolders } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** My mail folders, from the local copy, special ones first, with their unread counts. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json({ folders: listFolders(me.id) });
}
