import fs from "node:fs";
import { Readable } from "node:stream";
import { currentUser } from "@/server/auth";
import { accessTo, getFile } from "@/server/db";
import { filePath, INLINE_TYPES } from "@/server/files";
import { fail, unauthorized } from "@/server/http";

export const dynamic = "force-dynamic";

/** Serves a file to people who can read the conversation it was sent in. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const file = getFile((await params).id);
  const allowed = file && (file.conversationId ? accessTo(file.conversationId, me.id) : file.userId === me.id);
  if (!file || !allowed || !fs.existsSync(filePath(file.id))) return fail("Fichier introuvable", 404);

  const inline = INLINE_TYPES.has(file.mime);
  return new Response(Readable.toWeb(fs.createReadStream(filePath(file.id))) as ReadableStream, {
    headers: {
      "Content-Type": inline ? file.mime : "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}
