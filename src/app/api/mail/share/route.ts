import fs from "node:fs";
import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { accessTo, addFile, addMessage, audienceOf, newId } from "@/server/db";
import { publish } from "@/server/events";
import { filePath, maxFileBytes } from "@/server/files";
import { body, fail, MAX_FILES_PER_MESSAGE, unauthorized } from "@/server/http";
import { readPart } from "@/server/mail/attachment";
import { openMail } from "@/server/mail/body";
import { mailError } from "@/server/mail/connect";
import { shareText } from "@/server/mail/share";

export const dynamic = "force-dynamic";

/**
 * Shares a mail in a Lamio conversation: { folder, uid, conversationId, comment, parts: ["2", …] }.
 * The message holds my comment, who wrote, the subject and the start of the mail; the chosen
 * attachments are copied into Lamio files, so the people of the conversation can open them.
 */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);
  const folder = typeof data.folder === "string" ? data.folder : "";
  const uid = Number(data.uid);
  const conversationId = typeof data.conversationId === "string" ? data.conversationId : "";
  const comment = typeof data.comment === "string" ? data.comment.slice(0, 2000) : "";
  const parts = Array.isArray(data.parts) ? [...new Set(data.parts.filter((p): p is string => typeof p === "string" && /^[\d.]{1,40}$/.test(p)))].slice(0, MAX_FILES_PER_MESSAGE) : [];
  if (!folder || folder.length > 500 || !Number.isInteger(uid) || uid <= 0) return fail("Mail invalide");
  if (!conversationId || !accessTo(conversationId, me.id)) return fail("Conversation introuvable", 404);

  try {
    const mail = await openMail(me.id, folder, uid);
    if (!mail) return fail("Ce mail n'existe plus (supprimé ou déplacé ailleurs)", 404);
    const fileIds: string[] = [];
    const sharedParts: string[] = [];
    const max = maxFileBytes();
    for (const part of parts) {
      if (!mail.attachmentList.some((a) => a.part === part)) continue;
      const file = await readPart(me.id, folder, uid, part);
      if (!file) continue;
      if (file.data.length > max) return fail(`${file.name} est trop lourd pour Lamio (${Math.round(max / 1024 / 1024)} Mo maximum)`, 413);
      const info = { id: newId(), name: file.name.slice(0, 200), mime: file.type.slice(0, 100), size: file.data.length };
      await fs.promises.writeFile(filePath(info.id), file.data, { mode: 0o600 });
      addFile({ ...info, userId: me.id });
      fileIds.push(info.id);
      sharedParts.push(part);
    }
    const message = addMessage({ conversationId, userId: me.id, body: shareText(mail, comment, sharedParts), fileIds });
    if (!message) return fail("Message vide");
    publish({ type: "message", message }, audienceOf(conversationId));
    return NextResponse.json(message);
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
}
