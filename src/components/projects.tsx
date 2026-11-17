"use client";

import { Archive, FolderKanban, Hash, Plus } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Project, TaskWithProject } from "@/lib/types";
import { api, cn, dueGroup, slugify, type DueGroup } from "@/lib/utils";
import { CheckButton, DueChip } from "./task-bits";
import { Button, Card, Field, inputClass, Modal, PageHeader } from "./ui";

/** "Projets" and "Mes tâches": the two entrances of the module. */
function Tabs() {
  const pathname = usePathname();
  const tabs = [
    { href: "/p", label: "Projets" },
    { href: "/p/taches", label: "Mes tâches" },
  ];
  return (
    <div className="flex gap-0.5 rounded-lg border border-line bg-surface-2 p-0.5">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} className={cn("flex h-7 items-center rounded-md px-2.5 text-[12.5px] font-medium", pathname === t.href ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}>
          {t.label}
        </Link>
      ))}
    </div>
  );
}

export function ProjectsHome() {
  const { projects, conversations } = useApp();
  const [creating, setCreating] = useState(false);
  const active = projects.filter((p) => !p.archived);
  const archived = projects.filter((p) => p.archived);
  const channelOf = (p: Project) => conversations.find((c) => c.id === p.conversationId);

  const card = (p: Project, i: number) => {
    const channel = channelOf(p);
    const percent = p.taskCount ? Math.round((p.doneCount / p.taskCount) * 100) : 0;
    return (
      <Link key={p.id} href={`/p/${p.id}`}>
        <Card className={cn("rise press flex h-full flex-col gap-3 hover:bg-surface-2", p.archived && "opacity-70")} style={{ animationDelay: `${i * 40}ms` }}>
          <div className="flex items-start gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
              <FolderKanban className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-[15px] font-medium leading-tight">{p.name}</h2>
              <p className="mt-0.5 line-clamp-2 text-[12.5px] text-ink-3">{p.description || "Sans description"}</p>
            </div>
          </div>
          <div className="mt-auto">
            <div className="h-1.5 overflow-hidden rounded-full bg-ink/[0.07]" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={`Avancement de ${p.name}`}>
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
            </div>
            <div className="mt-2 flex items-center gap-3 text-[12px] text-ink-3">
              <span className="tabular">{p.taskCount ? `${p.doneCount} / ${p.taskCount} ${p.taskCount > 1 ? "tâches" : "tâche"}` : "Aucune tâche"}</span>
              <DueChip due={p.nextDue} />
              {channel && (
                <span className="ml-auto flex min-w-0 items-center gap-0.5">
                  <Hash className="size-3.5 shrink-0" />
                  <span className="truncate">{channel.name}</span>
                </span>
              )}
            </div>
          </div>
        </Card>
      </Link>
    );
  };

  return (
    <>
      <PageHeader title="Projets" subtitle="Les projets de l'équipe et leurs tâches.">
        <Tabs />
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4" strokeWidth={2.4} />
          <span className="max-md:hidden">Nouveau projet</span>
        </Button>
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto max-w-[860px]">
          {active.length ? (
            <div className="grid gap-3 sm:grid-cols-2">{active.map(card)}</div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <span className="flex size-12 items-center justify-center rounded-2xl bg-accent-soft text-accent">
                <FolderKanban className="size-6" />
              </span>
              <p className="font-display text-[24px] leading-none">Aucun projet pour l&apos;instant</p>
              <p className="max-w-[360px] text-[13px] text-ink-3">Un projet regroupe des tâches, avec un statut et une échéance, et peut avoir son canal dans la messagerie.</p>
              <Button variant="primary" onClick={() => setCreating(true)}>
                Créer un projet
              </Button>
            </div>
          )}
          {archived.length > 0 && (
            <details className="mt-6">
              <summary className="flex cursor-pointer items-center gap-1.5 text-[12.5px] font-medium text-ink-3 hover:text-ink">
                <Archive className="size-3.5" />
                {archived.length} {archived.length > 1 ? "projets archivés" : "projet archivé"}
              </summary>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">{archived.map(card)}</div>
            </details>
          )}
        </div>
      </div>
      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const { reload } = useApp();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [channel, setChannel] = useState(true);
  const [busy, setBusy] = useState(false);
  const slug = slugify(name);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { project } = await api<{ project: Project }>("/api/projects", { method: "POST", json: { name, description, channel } });
      await reload();
      onClose();
      router.push(`/p/${project.id}`);
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <Modal title="Nouveau projet" onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-3">
        <Field label="Nom">
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="ex. Refonte du site" className={inputClass} />
        </Field>
        <Field label="Description (facultatif)">
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="De quoi s'agit-il ?" className={inputClass} />
        </Field>
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-line bg-surface-2 p-3">
          <input type="checkbox" checked={channel} onChange={(e) => setChannel(e.target.checked)} className="mt-0.5 size-4 accent-[var(--accent)]" />
          <span>
            <span className="flex items-center gap-1.5 text-[13.5px] font-medium">
              <Hash className="size-3.5 text-ink-3" />
              Créer son canal dans la messagerie
            </span>
            <span className="mt-0.5 block text-[12.5px] text-ink-3">{slug ? `Les discussions du projet iront dans #${slug}.` : "Un canal ouvert à l'équipe, pour les discussions du projet."}</span>
          </span>
        </label>
        <div className="mt-2 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={busy || !name.trim()}>
            Créer le projet
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const GROUPS: { id: DueGroup; label: string }[] = [
  { id: "late", label: "En retard" },
  { id: "today", label: "Aujourd'hui" },
  { id: "week", label: "Cette semaine" },
  { id: "later", label: "Plus tard" },
  { id: "none", label: "Sans échéance" },
];

/** Everything assigned to me and not done, across the projects. */
export function MyTasks() {
  const { listen } = useApp();
  const [tasks, setTasks] = useState<TaskWithProject[] | null>(null);

  const load = useCallback(() => {
    api<{ tasks: TaskWithProject[] }>("/api/tasks").then(
      (r) => setTasks(r.tasks),
      (err) => toast.error((err as Error).message),
    );
  }, []);

  useEffect(() => {
    load();
    return listen((event) => {
      if (event.type === "project" || event.type === "resync") load();
    });
  }, [load, listen]);

  const finish = async (task: TaskWithProject) => {
    // Gone from the list at once; the server confirms, and "Annuler" brings it back.
    setTasks((list) => list && list.filter((t) => t.id !== task.id));
    try {
      await api(`/api/tasks/${task.id}`, { method: "PATCH", json: { status: "done" } });
      toast("Tâche terminée", { description: task.title, action: { label: "Annuler", onClick: () => void api(`/api/tasks/${task.id}`, { method: "PATCH", json: { status: task.status } }).catch(() => {}) } });
    } catch (err) {
      toast.error((err as Error).message);
      load();
    }
  };

  return (
    <>
      <PageHeader title="Mes tâches" subtitle="Ce qui t'est attribué, tous projets confondus.">
        <Tabs />
      </PageHeader>
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto flex max-w-[720px] flex-col gap-6">
          {tasks?.length === 0 && (
            <div className="py-16 text-center">
              <p className="font-display text-[24px] leading-none">Rien à faire</p>
              <p className="mt-2 text-[13px] text-ink-3">Les tâches qui te sont attribuées dans les projets apparaissent ici.</p>
            </div>
          )}
          {GROUPS.map((g) => {
            const list = (tasks ?? []).filter((t) => dueGroup(t.dueDate) === g.id);
            if (!list.length) return null;
            return (
              <section key={g.id} aria-label={g.label}>
                <h2 className={cn("mb-1.5 flex items-center gap-2 px-1 text-[11px] font-medium tracking-wide uppercase", g.id === "late" ? "text-danger" : "text-ink-3")}>
                  {g.label}
                  <span className="tabular rounded-full bg-ink/[0.07] px-1.5 text-[10.5px] leading-[17px] text-ink-2">{list.length}</span>
                </h2>
                <ul className="overflow-hidden rounded-xl border border-line bg-surface shadow-card">
                  {list.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-0 hover:bg-surface-2">
                      <CheckButton done={false} onToggle={() => finish(t)} title={t.title} />
                      <Link href={`/p/${t.projectId}?t=${t.id}`} className="min-w-0 flex-1">
                        <span className="block truncate text-[14px]">{t.title}</span>
                        <span className="block truncate text-[12px] text-ink-3">
                          {t.projectName}
                          {t.status === "doing" && " · En cours"}
                        </span>
                      </Link>
                      <DueChip due={t.dueDate} />
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        </div>
      </div>
    </>
  );
}
