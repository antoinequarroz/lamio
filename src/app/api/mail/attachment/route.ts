import { currentUser } from "@/server/auth";
import { INLINE_TYPES } from "@/server/files";
import { fail, unauthorized } from "@/server/http";
import { readPart } from "@/server/mail/attachment";
import { mailError } from "@/server/mail/connect";

export const dynamic = "force-dynamic";

const PART = /^\d+(\.\d+)*$/;

/**
 * A file of a mail (?folder=INBOX&uid=12&part=2), as a download. With &inline=1, images and PDFs
 * are shown in the browser instead (preview, images inside a mail). Anything else, and SVG or
 * HTML in particular, is always a download: a file sent by a stranger never runs on Lamio's address.
 */
export async function GET(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const params = new URL(req.url).searchParams;
  const folder = params.get("folder") ?? "";
  const uid = Number(params.get("uid"));
  const part = params.get("part") ?? "";
  if (!folder || folder.length > 500 || !Number.isInteger(uid) || uid <= 0 || !PART.test(part) || part.length > 50) return fail("Fichier invalide");
  try {
    const file = await readPart(me.id, folder, uid, part);
    if (!file) return fail("Ce fichier n'existe plus (mail supprimé ou déplacé ailleurs)", 404);
    const pdf = file.type === "application/pdf";
    const inline = params.get("inline") === "1" && (INLINE_TYPES.has(file.type) || pdf);
    return new Response(new Uint8Array(file.data), {
      headers: {
        "Content-Type": inline ? file.type : "application/octet-stream",
        "Content-Length": String(file.data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
        // A mail never changes: the same part is the same file.
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
        // The PDF viewer of the browser does not open in a sandbox; a PDF cannot reach the page anyway.
        "Content-Security-Policy": pdf && inline ? "default-src 'none'" : "default-src 'none'; sandbox",
      },
    });
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}
