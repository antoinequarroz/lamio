import fs from "node:fs";
import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { addFile, newId, staleFiles } from "@/server/db";
import { filePath, maxFileBytes, removeFiles } from "@/server/files";
import { fail, unauthorized } from "@/server/http";

/** Receives one file (multipart field "file"). It is attached when the message is sent. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const max = maxFileBytes();
  const tooBig = () => fail(`Fichier trop lourd (${Math.round(max / 1024 / 1024)} Mo maximum)`, 413);
  if (Number(req.headers.get("content-length")) > max + 64 * 1024) return tooBig();

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return fail("Aucun fichier reçu");
  if (file.size > max) return tooBig();

  removeFiles(staleFiles());
  const info = { id: newId(), name: (file.name || "fichier").slice(0, 200), mime: (file.type || "application/octet-stream").slice(0, 100), size: file.size };
  await fs.promises.writeFile(filePath(info.id), Buffer.from(await file.arrayBuffer()), { mode: 0o600 });
  addFile({ ...info, userId: me.id });
  return NextResponse.json(info);
}
