import "server-only";
import type { Project, Task, TaskStatus, TaskWithProject } from "@/lib/types";
import { slugify } from "@/lib/utils";
import { createChannel, db, newId, now } from "./db";

// Module Projets. Every account sees every project: like the public channels, the team is small
// and works in the open. Deleting a project is for its creator or an admin.

type ProjectRow = { id: string; name: string; description: string; conversation_id: string | null; archived: number; created_by: string | null; created_at: string; task_count: number; done_count: number; next_due: string | null };

const toProject = (r: ProjectRow): Project => ({ id: r.id, name: r.name, description: r.description, conversationId: r.conversation_id, archived: !!r.archived, createdBy: r.created_by, createdAt: r.created_at, taskCount: r.task_count, doneCount: r.done_count, nextDue: r.next_due });

const PROJECT = `select p.*,
  (select count(*) from tasks t where t.project_id = p.id) as task_count,
  (select count(*) from tasks t where t.project_id = p.id and t.status = 'done') as done_count,
  (select min(t.due_date) from tasks t where t.project_id = p.id and t.status != 'done') as next_due
  from projects p`;

/** Active projects first, then by name. */
export const listProjects = () => (db().prepare(`${PROJECT} order by p.archived, p.name collate nocase, p.created_at`).all() as ProjectRow[]).map(toProject);

export function getProject(id: string): Project | null {
  const r = db().prepare(`${PROJECT} where p.id = ?`).get(id) as ProjectRow | undefined;
  return r ? toProject(r) : null;
}

/** Creates a project, with its channel in the messaging when asked. */
export function createProject(input: { name: string; description?: string; channel?: boolean; createdBy: string }): Project {
  return db().transaction(() => {
    const id = newId();
    db().prepare("insert into projects (id, name, description, created_by, created_at) values (?, ?, ?, ?, ?)").run(id, input.name, input.description ?? "", input.createdBy, now());
    if (input.channel) openProjectChannel(id, input.createdBy);
    return getProject(id)!;
  })();
}

/**
 * Gives the project its channel: a public one named after it ("refonte-site"), or with a number
 * when the name is taken ("refonte-site-2"). Returns the channel id, or null when the project
 * already has one or no name could be found.
 */
export function openProjectChannel(projectId: string, userId: string): string | null {
  return db().transaction(() => {
    const project = getProject(projectId);
    if (!project || project.conversationId) return null;
    const base = slugify(project.name) || "projet";
    for (let n = 1; n <= 20; n++) {
      const suffix = n === 1 ? "" : `-${n}`;
      const channelId = createChannel({ name: base.slice(0, 40 - suffix.length) + suffix, topic: `Projet ${project.name}`.slice(0, 200), createdBy: userId });
      if (!channelId) continue;
      db().prepare("update projects set conversation_id = ? where id = ?").run(channelId, projectId);
      return channelId;
    }
    return null;
  })();
}

export function updateProject(id: string, patch: { name?: string; description?: string; archived?: boolean }) {
  db()
    .prepare("update projects set name = coalesce(?, name), description = coalesce(?, description), archived = coalesce(?, archived) where id = ?")
    .run(patch.name ?? null, patch.description ?? null, patch.archived === undefined ? null : Number(patch.archived), id);
  return getProject(id);
}

/** Deletes the project and its tasks. Its channel stays in the messaging. */
export const deleteProject = (id: string) => db().prepare("delete from projects where id = ?").run(id).changes > 0;

// ---- Tasks

type TaskRow = { id: string; project_id: string; title: string; description: string; status: TaskStatus; due_date: string | null; assignee_id: string | null; position: number; created_by: string | null; created_at: string; done_at: string | null };

const toTask = (r: TaskRow): Task => ({ id: r.id, projectId: r.project_id, title: r.title, description: r.description, status: r.status, dueDate: r.due_date, assigneeId: r.assignee_id, position: r.position, createdBy: r.created_by, createdAt: r.created_at, doneAt: r.done_at });

export const listTasks = (projectId: string) => (db().prepare("select * from tasks where project_id = ? order by position, created_at").all(projectId) as TaskRow[]).map(toTask);

export function getTask(id: string): Task | null {
  const r = db().prepare("select * from tasks where id = ?").get(id) as TaskRow | undefined;
  return r ? toTask(r) : null;
}

const userExists = (id: string) => !!db().prepare("select 1 from users where id = ?").get(id);

/** Adds a task at the end of its column. Null when the project or the person does not exist. */
export function addTask(input: { projectId: string; title: string; description?: string; status?: TaskStatus; dueDate?: string | null; assigneeId?: string | null; createdBy: string }): Task | null {
  return db().transaction(() => {
    if (!db().prepare("select 1 from projects where id = ?").get(input.projectId)) return null;
    if (input.assigneeId && !userExists(input.assigneeId)) return null;
    const id = newId();
    const status = input.status ?? "todo";
    const { last } = db().prepare("select coalesce(max(position), 0) as last from tasks where project_id = ?").get(input.projectId) as { last: number };
    db()
      .prepare("insert into tasks (id, project_id, title, description, status, due_date, assignee_id, position, created_by, created_at, done_at) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)")
      .run(id, input.projectId, input.title, input.description ?? "", status, input.dueDate ?? null, input.assigneeId ?? null, last + 1, input.createdBy, now(), status === "done" ? now() : null);
    return getTask(id)!;
  })();
}

export type TaskPatch = { title?: string; description?: string; status?: TaskStatus; dueDate?: string | null; assigneeId?: string | null; position?: number };

/** Changes the given fields only. `null` clears a deadline or an assignee. Null when the task or the person does not exist. */
export function updateTask(id: string, patch: TaskPatch): Task | null {
  return db().transaction(() => {
    const task = getTask(id);
    if (!task) return null;
    if (patch.assigneeId && !userExists(patch.assigneeId)) return null;
    const next = { ...task, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) } as Task;
    // The day a task was finished is kept until it is reopened.
    const doneAt = next.status === "done" ? (task.status === "done" ? task.doneAt : now()) : null;
    db().prepare("update tasks set title = ?, description = ?, status = ?, due_date = ?, assignee_id = ?, position = ?, done_at = ? where id = ?").run(next.title, next.description, next.status, next.dueDate, next.assigneeId, next.position, doneAt, id);
    return getTask(id)!;
  })();
}

export const deleteTask = (id: string) => db().prepare("delete from tasks where id = ?").run(id).changes > 0;

const WITH_PROJECT = "select t.*, p.name as project_name from tasks t join projects p on p.id = t.project_id";
const withProject = (r: TaskRow & { project_name: string }): TaskWithProject => ({ ...toTask(r), projectName: r.project_name });

/** What this person still has to do, across the active projects: closest deadline first, tasks without one last. */
export function myTasks(userId: string): TaskWithProject[] {
  return (db().prepare(`${WITH_PROJECT} where t.assignee_id = ? and t.status != 'done' and p.archived = 0 order by t.due_date is null, t.due_date, t.created_at`).all(userId) as (TaskRow & { project_name: string })[]).map(withProject);
}

/** Tasks whose title or description contains these words, the ones still to do first. */
export function searchTasks(query: string, limit = 20): TaskWithProject[] {
  const words = query.trim().split(/\s+/).filter(Boolean).slice(0, 6);
  if (!words.length) return [];
  const like = words.map(() => "(t.title like ? escape '\\' or t.description like ? escape '\\')").join(" and ");
  const args = words.flatMap((w) => {
    const pattern = `%${w.replace(/[\\%_]/g, "\\$&")}%`;
    return [pattern, pattern];
  });
  return (db().prepare(`${WITH_PROJECT} where ${like} order by t.status = 'done', p.archived, t.created_at desc limit ?`).all(...args, limit) as (TaskRow & { project_name: string })[]).map(withProject);
}
