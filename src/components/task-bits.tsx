"use client";

import { CalendarDays, Check } from "lucide-react";
import type { TaskStatus } from "@/lib/types";
import { cn, dueGroup, dueLabel } from "@/lib/utils";

export const STATUSES: { id: TaskStatus; label: string }[] = [
  { id: "todo", label: "À faire" },
  { id: "doing", label: "En cours" },
  { id: "done", label: "Terminé" },
];

/** The round box that finishes a task, or reopens it. */
export function CheckButton({ done, onToggle, title }: { done: boolean; onToggle: () => void; title: string }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      role="checkbox"
      aria-checked={done}
      aria-label={done ? `Rouvrir « ${title} »` : `Terminer « ${title} »`}
      className={cn("press flex size-[18px] shrink-0 items-center justify-center rounded-full border-[1.5px]", done ? "border-accent bg-accent text-accent-ink" : "border-line-strong text-transparent hover:border-accent hover:text-accent")}
    >
      <Check className="size-3" strokeWidth={3} />
    </button>
  );
}

/** A deadline: red once it has passed, unless the task is done. */
export function DueChip({ due, done, className }: { due: string | null; done?: boolean; className?: string }) {
  if (!due) return null;
  const group = done ? "later" : dueGroup(due);
  return (
    <span className={cn("tabular inline-flex shrink-0 items-center gap-1 text-[12px]", group === "late" ? "font-medium text-danger" : group === "today" ? "font-medium text-accent" : "text-ink-3", className)}>
      <CalendarDays className="size-3.5" />
      {dueLabel(due)}
    </span>
  );
}

/** One line to type a task and press Enter. */
export function QuickAdd({ onAdd, placeholder = "Ajouter une tâche…" }: { onAdd: (title: string) => void; placeholder?: string }) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const input = e.currentTarget.elements.namedItem("title") as HTMLInputElement;
        const title = input.value.trim();
        if (!title) return;
        onAdd(title);
        input.value = "";
      }}
    >
      <input name="title" maxLength={200} placeholder={placeholder} aria-label={placeholder} autoComplete="off" className="h-9 w-full rounded-lg bg-transparent px-2.5 text-[13.5px] outline-none placeholder:text-ink-3 hover:bg-ink/[0.03] focus:bg-surface focus:shadow-[0_0_0_3px_var(--accent-soft)] max-md:h-11 max-md:text-[15px]" />
    </form>
  );
}
