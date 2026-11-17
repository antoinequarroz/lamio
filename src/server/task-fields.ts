import type { TaskStatus } from "@/lib/types";
import { day, MAX_DESCRIPTION, MAX_TASK_TITLE, text } from "./http";
import type { TaskPatch } from "./projects";

const STATUSES: TaskStatus[] = ["todo", "doing", "done"];

/** Reads the fields of a task from a request: only the ones present. Returns the error to show when one is invalid. */
export function taskFields(data: Record<string, unknown>): TaskPatch | string {
  const out: TaskPatch = {};
  if (data.title !== undefined) {
    const title = text(data.title, MAX_TASK_TITLE);
    if (!title) return "Donne un titre à la tâche (200 caractères au plus)";
    out.title = title;
  }
  if (data.description !== undefined) {
    const description = data.description === "" ? "" : text(data.description, MAX_DESCRIPTION);
    if (description === null) return "Description trop longue";
    out.description = description;
  }
  if (data.status !== undefined) {
    if (!STATUSES.includes(data.status as TaskStatus)) return "Statut inconnu";
    out.status = data.status as TaskStatus;
  }
  if (data.dueDate !== undefined) {
    const due = data.dueDate === null || data.dueDate === "" ? null : day(data.dueDate);
    if (due === null && data.dueDate) return "Échéance invalide";
    out.dueDate = due;
  }
  if (data.assigneeId !== undefined) {
    if (data.assigneeId !== null && typeof data.assigneeId !== "string") return "Personne introuvable";
    out.assigneeId = data.assigneeId || null;
  }
  if (data.position !== undefined) {
    if (typeof data.position !== "number" || !Number.isFinite(data.position)) return "Position invalide";
    out.position = data.position;
  }
  return out;
}
