import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, MAX_DESCRIPTION, MAX_NAME, text, unauthorized } from "@/server/http";
import { createProject } from "@/server/projects";

/** Creates a project: { name, description?, channel? }. With `channel`, its channel is created in the messaging. */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);
  const name = text(data.name, MAX_NAME);
  if (!name) return fail("Donne un nom au projet");
  const description = data.description === undefined || data.description === "" ? "" : text(data.description, MAX_DESCRIPTION);
  if (description === null) return fail("Description trop longue");
  const project = createProject({ name, description, channel: data.channel === true, createdBy: me.id });
  publish({ type: "refresh" }, "all");
  return NextResponse.json({ project });
}
