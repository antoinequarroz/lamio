import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, MAX_DESCRIPTION, MAX_NAME, text, unauthorized } from "@/server/http";
import { deleteProject, getProject, listTasks, updateProject } from "@/server/projects";

export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** A project and its tasks. */
export async function GET(_req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const project = getProject((await params).id);
  if (!project) return fail("Projet introuvable", 404);
  return NextResponse.json({ project, tasks: listTasks(project.id) });
}

/** Renames, describes, archives or restores: { name?, description?, archived? }. */
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  if (!getProject(id)) return fail("Projet introuvable", 404);
  const data = await body(req);
  const name = data.name === undefined ? undefined : text(data.name, MAX_NAME);
  if (name === null) return fail("Donne un nom au projet");
  const description = data.description === undefined ? undefined : data.description === "" ? "" : text(data.description, MAX_DESCRIPTION);
  if (description === null) return fail("Description trop longue");
  const project = updateProject(id, { name, description, archived: typeof data.archived === "boolean" ? data.archived : undefined });
  publish({ type: "project", projectId: id }, "all");
  return NextResponse.json({ project });
}

/** Deletes the project and its tasks: its creator, or an admin. Its channel stays. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  const project = getProject(id);
  if (!project) return fail("Projet introuvable", 404);
  if (me.role !== "admin" && project.createdBy !== me.id) return fail("Seul son créateur ou un administrateur peut supprimer ce projet", 403);
  deleteProject(id);
  publish({ type: "project", projectId: id }, "all");
  return NextResponse.json({ ok: true });
}
