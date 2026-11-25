import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { body, fail, unauthorized } from "@/server/http";
import { openMail } from "@/server/mail/body";
import { mailError } from "@/server/mail/connect";
import { ticketDescription, ticketTitle } from "@/server/mail/share";
import { createTickupIssue, TickupProblem } from "@/server/tickup";

export const dynamic = "force-dynamic";

/** Turns a mail into a TickUp ticket: { folder, uid, project: "LAMIO", title?, note?, priority? }. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);
  const folder = typeof data.folder === "string" ? data.folder : "";
  const uid = Number(data.uid);
  const project = typeof data.project === "string" ? data.project.trim() : "";
  const priority = [0, 1, 2, 3, 4].includes(data.priority as number) ? (data.priority as number) : 0;
  if (!folder || folder.length > 500 || !Number.isInteger(uid) || uid <= 0) return fail("Mail invalide");
  if (!/^[A-Za-z][A-Za-z0-9]{1,5}$/.test(project)) return fail("Choisis un projet");

  let mail;
  try {
    mail = await openMail(me.id, folder, uid);
  } catch (e) {
    return fail(mailError(e).message, 502);
  }
  if (!mail) return fail("Ce mail n'existe plus (supprimé ou déplacé ailleurs)", 404);
  const title = (typeof data.title === "string" && data.title.trim().slice(0, 200)) || ticketTitle(mail.subject);
  const note = typeof data.note === "string" ? data.note.slice(0, 4000) : "";
  try {
    return NextResponse.json(await createTickupIssue({ project, title, description: ticketDescription(mail, note), priority }));
  } catch (e) {
    return fail(e instanceof TickupProblem ? e.message : "TickUp ne répond pas pour le moment.", 502);
  }
}
