"use client";

import { CalendarClock } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** A time of day on a day from now: at(1, 9) = tomorrow at 9:00. */
function at(days: number, hour: number, from = new Date()) {
  const d = new Date(from);
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Next Monday (a week from today when today is Monday). */
const monday = (hour: number) => {
  const now = new Date();
  return at(((8 - now.getDay()) % 7) || 7, hour);
};

export type WhenKind = "snooze" | "send" | "followup";

/** The usual choices, all in the future. */
export function presets(kind: WhenKind, now = new Date()): { label: string; date: Date }[] {
  if (kind === "followup")
    return [
      { label: "Dans 2 jours", date: at(2, 9, now) },
      { label: "Dans 3 jours", date: at(3, 9, now) },
      { label: "Dans une semaine", date: at(7, 9, now) },
    ];
  const hour = kind === "send" ? 8 : 9;
  const list = [
    ...(now.getHours() < 17 ? [{ label: "Ce soir", date: at(0, 18, now) }] : []),
    { label: "Demain matin", date: at(1, hour, now) },
    ...(now.getDay() !== 0 ? [{ label: "Lundi matin", date: monday(hour) }] : []),
    { label: "Dans une semaine", date: at(7, hour, now) },
  ];
  return list.filter((p) => p.date > now);
}

export const whenText = (d: Date | string) =>
  new Date(d).toLocaleString("fr-CH", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/**
 * A button that opens the usual times and a date picker. `children` is the button itself
 * (rendered with the toggle), so each place keeps its own look.
 */
export function WhenMenu({ kind, title, onPick, align = "right", up, children }: { kind: WhenKind; title: string; onPick: (d: Date) => void; align?: "left" | "right"; up?: boolean; children: (toggle: () => void, open: boolean) => React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    setCustom(local(at(1, kind === "send" ? 8 : 9)));
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)) {
        if (e instanceof KeyboardEvent) e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close, true);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close, true);
    };
  }, [open, kind]);
  const pick = (d: Date) => {
    setOpen(false);
    onPick(d);
  };
  const customDate = custom ? new Date(custom) : null;
  const valid = !!customDate && !isNaN(customDate.getTime()) && customDate.getTime() > Date.now();

  return (
    <div ref={box} className="relative">
      {children(() => setOpen((o) => !o), open)}
      {open && (
        <div role="menu" aria-label={title} className={cn("absolute z-40 w-[250px] rounded-xl border border-line-strong bg-surface p-1 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.35)]", align === "right" ? "right-0" : "left-0", up ? "bottom-11" : "top-9")}>
          <p className="px-2.5 pt-1.5 pb-1 text-[11.5px] font-medium text-ink-3">{title}</p>
          {presets(kind).map((p) => (
            <button key={p.label} role="menuitem" onClick={() => pick(p.date)} className="press flex h-9 w-full items-center justify-between gap-2 rounded-lg px-2.5 text-left text-[13px] hover:bg-ink/[0.04]">
              <span>{p.label}</span>
              <span className="tabular text-[11.5px] text-ink-3">{p.date.toLocaleString("fr-CH", { weekday: "short", hour: "2-digit", minute: "2-digit" })}</span>
            </button>
          ))}
          <div className="mt-1 flex items-center gap-1.5 border-t border-line px-1.5 pt-1.5 pb-0.5">
            <CalendarClock className="size-3.5 shrink-0 text-ink-3" />
            <input type="datetime-local" aria-label="Date et heure" value={custom} onChange={(e) => setCustom(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]" />
            <button onClick={() => valid && pick(customDate!)} disabled={!valid} className="press h-8 shrink-0 rounded-md bg-accent px-2.5 text-[12px] font-medium text-accent-ink disabled:opacity-50">
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
