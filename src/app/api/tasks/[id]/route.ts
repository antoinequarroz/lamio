import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { body, fail, unauthorized } from "@/server/http";
import { deleteTask, getTask, updateTask } from "@/server/projects";
import { taskFields } from "@/server/task-fields";

type Ctx = { params: Promise<{ id: string }> };

/** Changes a task: any of { title, description, status, dueDate, assigneeId, position }. */
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const fields = taskFields(await body(req));
  if (typeof fields === "string") return fail(fields);
  const task = updateTask((await params).id, fields);
  if (!task) return fail("Tâche ou personne introuvable", 404);
  publish({ type: "project", projectId: task.projectId }, "all");
  return NextResponse.json({ task });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const task = getTask((await params).id);
  if (!task) return fail("Tâche introuvable", 404);
  deleteTask(task.id);
  publish({ type: "project", projectId: task.projectId }, "all");
  return NextResponse.json({ ok: true });
}
