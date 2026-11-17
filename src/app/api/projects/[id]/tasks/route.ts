import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { addTask } from "@/server/projects";
import { taskFields } from "@/server/task-fields";

/** Adds a task: { title, description?, status?, dueDate?, assigneeId? }. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  const fields = taskFields(await body(req));
  if (typeof fields === "string") return fail(fields);
  if (!fields.title) return fail("Donne un titre à la tâche");
  const task = addTask({ ...fields, title: fields.title, projectId: id, createdBy: me.id });
  if (!task) return fail("Projet ou personne introuvable", 404);
  publish({ type: "project", projectId: id }, "all");
  return NextResponse.json({ task });
}
