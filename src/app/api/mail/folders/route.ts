import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { createFolder, deleteFolder, renameFolder } from "@/server/mail/actions";
import { mailError } from "@/server/mail/connect";
import { syncNow } from "@/server/mail/service";
import { listFolders } from "@/server/mail/store";

export const dynamic = "force-dynamic";

/** My mail folders, from the local copy, special ones first, with their unread counts. */
export async function GET() {
  const me = await currentUser();
  if (!me) return unauthorized();
  return NextResponse.json({ folders: listFolders(me.id) });
}

type Body = { name?: unknown; parent?: unknown; path?: unknown };

/** Runs a change on the folders, then re-reads the list from the server. */
async function change(run: (userId: string, body: Body) => Promise<string | void>, req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const body = ((await req.json().catch(() => null)) ?? {}) as Body;
  try {
    const path = await run(me.id, body);
    await syncNow(me.id);
    return NextResponse.json({ path: path ?? null, folders: listFolders(me.id) });
  } catch (e) {
    return fail(mailError(e).message, 400);
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");

/** A new folder: { name, parent? }. */
export const POST = (req: Request) => change((id, b) => createFolder(id, str(b.name), str(b.parent) || null), req);
/** Renames a folder: { path, name }. */
export const PATCH = (req: Request) => change((id, b) => renameFolder(id, str(b.path), str(b.name)), req);
/** Deletes a folder and its mails: { path }. */
export const DELETE = (req: Request) => change((id, b) => deleteFolder(id, str(b.path)), req);
