"use client";

import { Archive, ArchiveRestore, ChevronLeft, Columns3, Hash, List, Settings2, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Project, Task, TaskStatus } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import { CheckButton, DueChip, QuickAdd, STATUSES } from "./task-bits";
import { Avatar, Button, Field, inputClass, Modal } from "./ui";

type View = "list" | "board";
const VIEW_KEY = "projets-vue";

/** Changes to make to a task, as the API takes them. */
type Patch = Partial<Pick<Task, "title" | "description" | "status" | "dueDate" | "assigneeId" | "position">>;

export function ProjectView({ id }: { id: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const { listen, me, conversations, reload } = useApp();
  const [data, setData] = useState<{ project: Project; tasks: Task[] } | null>(null);
  const [missing, setMissing] = useState(false);
  const [view, setView] = useState<View>("list");
  const [openTask, setOpenTask] = useState<string | null>(params.get("t"));
  const [settings, setSettings] = useState(false);

  const load = useCallback(() => {
    api<{ project: Project; tasks: Task[] }>(`/api/projects/${id}`).then(setData, () => setMissing(true));
  }, [id]);

  useEffect(() => {
    load();
    return listen((event) => {
      if (event.type === "resync" || (event.type === "project" && event.projectId === id)) load();
    });
  }, [id, load, listen]);

  // The view chosen last time, on this device.
  useEffect(() => {
    try {
      if (localStorage.getItem(VIEW_KEY) === "board") setView("board");
    } catch {}
  }, []);
  const chooseView = (next: View) => {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {}
  };

  if (missing) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
        <p className="font-display text-[24px] leading-none">Ce projet n&apos;existe plus</p>
        <Link href="/p" className="text-[13px] font-medium text-accent hover:underline">
          Retour aux projets
        </Link>
      </div>
    );
  }
  if (!data) return <div className="flex-1" />;

  const { project, tasks } = data;
  const channel = conversations.find((c) => c.id === project.conversationId);
  const editing = tasks.find((t) => t.id === openTask);

  /** Shown at once, then sent; the server's answer (or its refusal) puts things right. */
  const patchTask = async (task: Task, patch: Patch) => {
    setData((d) => d && { ...d, tasks: d.tasks.map((t) => (t.id === task.id ? { ...t, ...patch } : t)) });
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", json: patch });
    } catch (err) {
      toast.error((err as Error).message);
      load();
    }
  };

  const addTask = async (title: string, status: TaskStatus) => {
    try {
      // A new task is mine until someone else takes it: it shows up in "Mes tâches".
      const { task } = await api<{ task: Task }>(`/api/projects/${id}/tasks`, { method: "POST", json: { title, status, assigneeId: me.id } });
      setData((d) => d && (d.tasks.some((t) => t.id === task.id) ? d : { ...d, tasks: [...d.tasks, task] }));
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const toggle = (task: Task) => patchTask(task, { status: task.status === "done" ? "todo" : "done" });

  /** Drops a task in a column: before `beforeId`, or at the end. */
  const move = (taskId: string, status: TaskStatus, beforeId?: string) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || taskId === beforeId) return;
    const column = tasks.filter((t) => t.status === status && t.id !== taskId);
    const index = beforeId ? column.findIndex((t) => t.id === beforeId) : -1;
    const next = index >= 0 ? column[index] : undefined;
    const previous = index >= 0 ? column[index - 1] : column[column.length - 1];
    const position = next ? ((previous?.position ?? next.position - 2) + next.position) / 2 : (previous?.position ?? 0) + 1;
    if (task.status === status && task.position === position) return;
    void patchTask(task, { status, position });
  };

  const openChannel = async () => {
    try {
      const { id: channelId } = await api<{ id: string }>(`/api/projects/${id}/channel`, { method: "POST" });
      await reload();
      router.push(`/c/${channelId}`);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const sorted = [...tasks].sort((a, b) => a.position - b.position);
  const props = { tasks: sorted, onOpen: setOpenTask, onToggle: toggle, onAdd: addTask };

  return (
    <>
      <header className="border-b border-line px-7 py-5 max-md:px-4 max-md:py-4">
        <Link href="/p" className="mb-2 inline-flex items-center gap-0.5 text-[12.5px] text-ink-3 hover:text-ink">
          <ChevronLeft className="size-3.5" />
          Projets
        </Link>
        <div className="flex flex-wrap items-end gap-x-3 gap-y-3">
          <div className="min-w-0 flex-1 basis-[280px]">
            <h1 className="font-display text-[28px] leading-none [overflow-wrap:anywhere]">
              {project.name}
              {project.archived && <span className="ml-2 rounded-full bg-ink/[0.07] px-2 py-0.5 align-middle font-sans text-[11px] font-medium text-ink-3">Archivé</span>}
            </h1>
            {project.description && <p className="mt-1.5 text-[13px] text-ink-3 [overflow-wrap:anywhere]">{project.description}</p>}
          </div>
          <div className="flex max-w-full flex-wrap items-center gap-2">
            {channel ? (
              <Link href={`/c/${channel.id}`} className="press flex h-9 items-center gap-1 rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium shadow-card hover:bg-surface-2">
                <Hash className="size-3.5 text-ink-3" />
                <span className="max-w-[140px] truncate max-md:max-w-[96px]">{channel.name}</span>
              </Link>
            ) : (
              <Button onClick={openChannel}>
                <Hash className="size-3.5 text-ink-3" />
                Créer le canal
              </Button>
            )}
            <div className="flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5" role="group" aria-label="Affichage">
              {(
                [
                  { id: "list", label: "Liste", Icon: List },
                  { id: "board", label: "Tableau", Icon: Columns3 },
                ] as const
              ).map(({ id: v, label, Icon }) => (
                <button key={v} onClick={() => chooseView(v)} aria-pressed={view === v} className={cn("flex h-7 items-center gap-1.5 rounded-md px-2.5 text-[12.5px] font-medium", view === v ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}>
                  <Icon className="size-3.5" />
                  {label}
                </button>
              ))}
            </div>
            <button onClick={() => setSettings(true)} aria-label="Réglages du projet" title="Réglages du projet" className="press flex size-9 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink">
              <Settings2 className="size-4" />
            </button>
          </div>
        </div>
      </header>

      {view === "list" ? <ListView {...props} /> : <BoardView {...props} onMove={move} />}

      {editing && <TaskDialog task={editing} onClose={() => setOpenTask(null)} onSave={(patch) => patchTask(editing, patch)} />}
      {settings && <ProjectDialog project={project} onClose={() => setSettings(false)} />}
    </>
  );
}

type ViewProps = { tasks: Task[]; onOpen: (id: string) => void; onToggle: (task: Task) => void; onAdd: (title: string, status: TaskStatus) => void };

function Assignee({ id }: { id: string | null }) {
  const user = useApp().userById(id ?? undefined);
  return user ? (
    <span title={user.name}>
      <Avatar id={user.id} name={user.name} size="xs" />
    </span>
  ) : null;
}

function ListView({ tasks, onOpen, onToggle, onAdd }: ViewProps) {
  return (
    <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
      <div className="mx-auto flex max-w-[860px] flex-col gap-6">
        {STATUSES.map((s) => {
          const list = tasks.filter((t) => t.status === s.id);
          return (
            <section key={s.id} aria-label={s.label}>
              <h2 className="mb-1.5 flex items-center gap-2 px-1 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
                {s.label}
                <span className="tabular rounded-full bg-ink/[0.07] px-1.5 text-[10.5px] leading-[17px] text-ink-2">{list.length}</span>
              </h2>
              <div className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                <ul>
                  {list.map((t) => (
                    <li key={t.id} onClick={() => onOpen(t.id)} className="flex cursor-pointer items-center gap-3 border-b border-line px-3.5 py-2.5 hover:bg-surface-2">
                      <CheckButton done={t.status === "done"} onToggle={() => onToggle(t)} title={t.title} />
                      <button className={cn("min-w-0 flex-1 truncate text-left text-[14px]", t.status === "done" && "text-ink-3 line-through")}>{t.title}</button>
                      <DueChip due={t.dueDate} done={t.status === "done"} />
                      <Assignee id={t.assigneeId} />
                    </li>
                  ))}
                </ul>
                {s.id !== "done" ? <div className="px-1 py-0.5">{<QuickAdd onAdd={(title) => onAdd(title, s.id)} />}</div> : !list.length && <p className="px-3.5 py-2.5 text-[13px] text-ink-3">Rien de terminé pour l&apos;instant.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function BoardView({ tasks, onOpen, onToggle, onAdd, onMove }: ViewProps & { onMove: (taskId: string, status: TaskStatus, beforeId?: string) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  /** Where the card would land: a column, and the card it would go before. */
  const [target, setTarget] = useState<{ status: TaskStatus; before?: string } | null>(null);

  const drop = (status: TaskStatus, before?: string) => {
    if (dragging) onMove(dragging, status, before);
    setDragging(null);
    setTarget(null);
  };

  return (
    <div className="scroll-thin flex min-h-0 flex-1 gap-3 overflow-x-auto p-7 max-md:snap-x max-md:snap-mandatory max-md:p-4">
      {STATUSES.map((s) => {
        const list = tasks.filter((t) => t.status === s.id);
        const over = target?.status === s.id;
        return (
          <section
            key={s.id}
            aria-label={s.label}
            onDragOver={(e) => {
              if (!dragging) return;
              e.preventDefault();
              if (!over || target?.before) setTarget({ status: s.id });
            }}
            onDrop={(e) => {
              e.preventDefault();
              drop(s.id);
            }}
            className={cn("flex max-h-full min-w-[260px] flex-1 basis-0 flex-col rounded-xl border bg-surface-2/70 max-md:min-w-[82%] max-md:snap-center", over ? "border-accent/50" : "border-line")}
          >
            <h2 className="flex items-center gap-2 px-3.5 pt-3 pb-2 text-[11px] font-medium tracking-wide text-ink-3 uppercase">
              {s.label}
              <span className="tabular rounded-full bg-ink/[0.07] px-1.5 text-[10.5px] leading-[17px] text-ink-2">{list.length}</span>
            </h2>
            <ul className="scroll-thin flex min-h-6 flex-1 flex-col gap-2 overflow-y-auto px-2 pb-1">
              {list.map((t) => (
                <li
                  key={t.id}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.effectAllowed = "move";
                    e.dataTransfer.setData("text/plain", t.id);
                    setDragging(t.id);
                  }}
                  onDragEnd={() => {
                    setDragging(null);
                    setTarget(null);
                  }}
                  onDragOver={(e) => {
                    if (!dragging) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (target?.status !== s.id || target.before !== t.id) setTarget({ status: s.id, before: t.id });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    drop(s.id, t.id);
                  }}
                  onClick={() => onOpen(t.id)}
                  className={cn("cursor-pointer rounded-lg border border-line bg-surface p-3 shadow-card hover:border-line-strong", dragging === t.id && "opacity-40", over && target?.before === t.id && dragging !== t.id && "shadow-[0_-2px_0_var(--accent)]")}
                >
                  <div className="flex items-start gap-2.5">
                    <span className="mt-px">
                      <CheckButton done={t.status === "done"} onToggle={() => onToggle(t)} title={t.title} />
                    </span>
                    <button className={cn("min-w-0 flex-1 text-left text-[13.5px] leading-snug [overflow-wrap:anywhere]", t.status === "done" && "text-ink-3 line-through")}>{t.title}</button>
                  </div>
                  {(t.dueDate || t.assigneeId) && (
                    <div className="mt-2 flex items-center pl-7">
                      <DueChip due={t.dueDate} done={t.status === "done"} />
                      <span className="ml-auto">
                        <Assignee id={t.assigneeId} />
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
            <div className="px-1 pb-1">
              <QuickAdd onAdd={(title) => onAdd(title, s.id)} />
            </div>
          </section>
        );
      })}
    </div>
  );
}

function TaskDialog({ task, onClose, onSave }: { task: Task; onClose: () => void; onSave: (patch: Patch) => Promise<void> }) {
  const { users } = useApp();
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description);
  const [status, setStatus] = useState(task.status);
  const [dueDate, setDueDate] = useState(task.dueDate ?? "");
  const [assigneeId, setAssigneeId] = useState(task.assigneeId ?? "");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    void onSave({ title: title.trim(), description: description.trim(), status, dueDate: dueDate || null, assigneeId: assigneeId || null });
    onClose();
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer la tâche « ${task.title} » ?`)) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: "DELETE" });
      onClose();
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  return (
    <Modal title="Tâche" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Titre">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Description">
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} rows={4} placeholder="Détails, liens, étapes…" className={cn(inputClass, "h-auto resize-y py-2 leading-snug")} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Statut">
            <select value={status} onChange={(e) => setStatus(e.target.value as TaskStatus)} className={inputClass}>
              {STATUSES.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Échéance">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={inputClass} />
          </Field>
        </div>
        <Field label="Attribuée à">
          <select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={inputClass}>
            <option value="">Personne</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
        <div className="mt-2 flex items-center gap-2">
          <Button type="button" variant="danger" onClick={remove}>
            <Trash2 className="size-4" />
            Supprimer
          </Button>
          <Button type="button" variant="ghost" className="ml-auto" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={!title.trim()}>
            Enregistrer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function ProjectDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const router = useRouter();
  const { me, reload } = useApp();
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [busy, setBusy] = useState(false);
  const url = `/api/projects/${project.id}`;
  const changed = name.trim() !== project.name || description.trim() !== project.description;
  const mayDelete = me.role === "admin" || project.createdBy === me.id;

  const run = async (action: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await action();
      await reload();
      if (done) toast(done);
      return true;
    } catch (err) {
      toast.error((err as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => api(url, { method: "PATCH", json: { name, description } }), "Projet mis à jour")) onClose();
  };

  const archive = async () => {
    if (await run(() => api(url, { method: "PATCH", json: { archived: !project.archived } }), project.archived ? "Projet rouvert" : "Projet archivé")) onClose();
  };

  const remove = async () => {
    if (!window.confirm(`Supprimer « ${project.name} » et toutes ses tâches ? Son canal reste dans la messagerie.`)) return;
    if (await run(() => api(url, { method: "DELETE" }))) router.push("/p");
  };

  return (
    <Modal title="Réglages du projet" onClose={onClose}>
      <form onSubmit={save} className="flex flex-col gap-3">
        <Field label="Nom">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} className={inputClass} />
        </Field>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="De quoi s'agit-il ?" className={inputClass} />
        </Field>
        <Button variant="primary" className="self-start" disabled={busy || !name.trim() || !changed}>
          Enregistrer
        </Button>
      </form>
      <div className="mt-4 flex flex-wrap gap-2 border-t border-line pt-4">
        <Button onClick={archive} disabled={busy}>
          {project.archived ? <ArchiveRestore className="size-4" /> : <Archive className="size-4" />}
          {project.archived ? "Rouvrir le projet" : "Archiver"}
        </Button>
        {mayDelete && (
          <Button variant="danger" onClick={remove} disabled={busy}>
            <Trash2 className="size-4" />
            Supprimer
          </Button>
        )}
      </div>
    </Modal>
  );
}
