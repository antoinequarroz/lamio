"use client";

import { ArrowUpRight, CalendarDays, ChevronLeft, ChevronRight, Eye, Plus, Repeat } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { addDays, byStart, dayKey, layoutDay, onDay as happensOn, sameDay, shift, startOfDay, viewDays, viewRange, viewTitle, type CalendarView as View, type Placed } from "@/lib/calendar";
import type { CalendarData, CalendarEvent, CalendarInfo, EventInput } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import { Button, PageHeader } from "../ui";
import { EventDialog, type Draft } from "./event-dialog";

/** Height of one hour in the day and week grids, in pixels. */
const HOUR_PX = 48;
const SNAP_MIN = 15;
const REFRESH_MS = 60_000;
const HIDDEN_KEY = "lamio.calendar.hidden";
const VIEW_KEY = "lamio.calendar.view";

const VIEWS: { id: View; label: string }[] = [
  { id: "day", label: "Jour" },
  { id: "week", label: "Semaine" },
  { id: "month", label: "Mois" },
];

function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

/** The Calendrier tab: Alfred's calendar, read and written through Lamio's server. */
export function CalendarView() {
  const [view, setView] = useState<View>("week");
  const [anchor, setAnchor] = useState(() => startOfDay(new Date()));
  const [data, setData] = useState<CalendarData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  /** Calendars hidden in this browser. Null until read: Alfred's own choice is used then. */
  const [hidden, setHidden] = useState<string[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [filterOpen, setFilterOpen] = useState(false);

  useEffect(() => {
    setHidden(readStored<string[] | null>(HIDDEN_KEY, null));
    const stored = readStored<View | null>(VIEW_KEY, null);
    // A phone shows one day by default; otherwise the last view chosen.
    setView(stored && VIEWS.some((v) => v.id === stored) ? stored : window.matchMedia("(max-width: 767px)").matches ? "day" : "week");
  }, []);

  const range = useMemo(() => viewRange(view, anchor), [view, anchor]);
  const request = useRef(0);

  const load = useCallback(
    async (quiet = false) => {
      const n = ++request.current;
      if (!quiet) setLoading(true);
      try {
        const q = new URLSearchParams({ start: range.start.toISOString(), end: range.end.toISOString() });
        const next = await api<CalendarData>(`/api/calendar?${q}`);
        if (n !== request.current) return;
        setData(next);
        setError(null);
      } catch (err) {
        if (n !== request.current) return;
        setError((err as Error).message);
      } finally {
        if (n === request.current) setLoading(false);
      }
    },
    [range],
  );

  useEffect(() => {
    void load();
    const timer = setInterval(() => !document.hidden && void load(true), REFRESH_MS);
    const onVisible = () => !document.hidden && void load(true);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const calendars = useMemo(() => data?.calendars ?? [], [data]);
  const hiddenIds = useMemo(() => new Set(hidden ?? calendars.filter((c) => !c.visible).map((c) => c.id)), [hidden, calendars]);
  const calendarById = useMemo(() => new Map(calendars.map((c) => [c.id, c])), [calendars]);
  const events = useMemo(() => (data?.events ?? []).filter((e) => !hiddenIds.has(e.calendarId)).sort(byStart), [data, hiddenIds]);
  const writableCalendars = calendars.filter((c) => !c.readOnly);
  const canWrite = !!data?.writable && writableCalendars.length > 0;

  const toggleCalendar = (id: string) => {
    const next = new Set(hiddenIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setHidden([...next]);
    store(HIDDEN_KEY, [...next]);
  };

  const pickView = (v: View) => {
    setView(v);
    store(VIEW_KEY, v);
  };

  const openDay = (day: Date) => {
    setAnchor(startOfDay(day));
    pickView("day");
  };

  /** A new event at this time (an hour), or on this day (all day). */
  const create = (start: Date, allDay = false) => {
    if (!canWrite) return;
    const calendarId = (writableCalendars.find((c) => !hiddenIds.has(c.id)) ?? writableCalendars[0]).id;
    setDraft({ mode: "new", start, end: allDay ? addDays(start, 1) : new Date(start.getTime() + 3_600_000), allDay, calendarId });
  };

  const open = (event: CalendarEvent) => setDraft({ mode: "edit", event });

  /** Moves an event (a drag in the grid). Only a single event: a series is edited in its dialog. */
  const move = async (event: CalendarEvent, start: Date) => {
    const length = Date.parse(event.end) - Date.parse(event.start);
    const end = new Date(start.getTime() + length);
    const input: EventInput = { calendarId: event.calendarId, title: event.title, start: start.toISOString(), end: end.toISOString(), allDay: false, location: event.location, description: event.description, repeat: event.repeat };
    // Shown at once; the next read from Alfred confirms it.
    setData((d) => d && { ...d, events: d.events.map((e) => (e.key === event.key ? { ...e, start: input.start, end: input.end } : e)) });
    try {
      await api(`/api/calendar/events/${encodeURIComponent(event.id)}`, { method: "PUT", json: { event: input, scope: "all", occurrenceId: null } });
      toast.success("Événement déplacé", { description: `${event.title} · ${start.toLocaleString("fr-CH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` });
    } catch (err) {
      toast.error((err as Error).message);
    }
    void load(true);
  };

  const days = viewDays(view, anchor);
  const today = new Date();

  return (
    <>
      <PageHeader title="Calendrier" subtitle={data ? `L'agenda d'Alfred${canWrite ? "" : ", en lecture"}` : "L'agenda d'Alfred"}>
        {data?.alfredUrl && (
          <a href={data.alfredUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12.5px] font-medium text-ink-2 hover:text-ink max-md:hidden">
            Ouvrir Alfred
            <ArrowUpRight className="size-3.5" />
          </a>
        )}
        {canWrite && (
          <Button variant="primary" size="sm" onClick={() => create(defaultStart(view, anchor))}>
            <Plus className="size-3.5" strokeWidth={2.4} />
            <span className="max-sm:hidden">Nouvel événement</span>
          </Button>
        )}
      </PageHeader>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-7 py-2.5 max-md:px-3">
        <div className="flex items-center gap-1">
          <Button size="sm" onClick={() => setAnchor(startOfDay(new Date()))}>
            Aujourd&apos;hui
          </Button>
          <button onClick={() => setAnchor(shift(view, anchor, -1))} aria-label="Précédent" className="press flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-ink/5 hover:text-ink">
            <ChevronLeft className="size-4" />
          </button>
          <button onClick={() => setAnchor(shift(view, anchor, 1))} aria-label="Suivant" className="press flex size-7 items-center justify-center rounded-md text-ink-2 hover:bg-ink/5 hover:text-ink">
            <ChevronRight className="size-4" />
          </button>
        </div>
        <h2 className="min-w-0 truncate text-[15px] font-medium first-letter:uppercase" aria-live="polite">
          {viewTitle(view, anchor)}
        </h2>
        {loading && <span className="size-1.5 animate-pulse rounded-full bg-accent" aria-label="Chargement" />}
        <div className="ml-auto flex items-center gap-1.5">
          {calendars.length > 0 && (
            <div className="relative">
              <Button size="sm" variant="ghost" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen}>
                <Eye className="size-3.5" />
                <span className="max-sm:hidden">Calendriers</span>
              </Button>
              {filterOpen && <CalendarFilter calendars={calendars} hidden={hiddenIds} onToggle={toggleCalendar} onClose={() => setFilterOpen(false)} />}
            </div>
          )}
          <div role="tablist" aria-label="Vue" className="flex rounded-lg border border-line bg-surface-2 p-0.5">
            {VIEWS.map((v) => (
              <button
                key={v.id}
                role="tab"
                aria-selected={view === v.id}
                onClick={() => pickView(v.id)}
                className={cn("h-6 rounded-md px-2.5 text-[12.5px] font-medium transition-colors", view === v.id ? "bg-surface text-ink shadow-card" : "text-ink-3 hover:text-ink")}
              >
                {v.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {error && !data ? (
        <Problem message={error} onRetry={() => void load()} />
      ) : view === "month" ? (
        <MonthGrid days={days} anchor={anchor} events={events} calendarById={calendarById} today={today} onOpen={open} onDay={openDay} onCreate={canWrite ? (d) => create(new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9)) : undefined} />
      ) : (
        <TimeGrid days={days} events={events} calendarById={calendarById} today={today} canWrite={canWrite} onOpen={open} onDay={openDay} onCreate={create} onMove={move} />
      )}
      {error && data && <p className="border-t border-line bg-[color-mix(in_oklab,var(--danger)_8%,transparent)] px-7 py-2 text-[12.5px] text-danger max-md:px-3">{error}</p>}

      {draft && data && (
        <EventDialog
          draft={draft}
          calendars={calendars}
          writable={canWrite}
          alfredUrl={data.alfredUrl}
          onClose={() => setDraft(null)}
          onSaved={() => {
            setDraft(null);
            void load(true);
          }}
        />
      )}
    </>
  );
}

/** Where "Nouvel événement" starts: the next round hour today, 9:00 on another day. */
function defaultStart(view: View, anchor: Date) {
  const now = new Date();
  const inView = view === "month" ? anchor.getMonth() === now.getMonth() && anchor.getFullYear() === now.getFullYear() : viewDays(view, anchor).some((d) => sameDay(d, now));
  if (inView) return new Date(now.getFullYear(), now.getMonth(), now.getDate(), Math.min(now.getHours() + 1, 23));
  const day = view === "month" ? new Date(anchor.getFullYear(), anchor.getMonth(), 1) : viewDays(view, anchor)[0];
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9);
}

function Problem({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <CalendarDays className="size-8 text-ink-3" />
      <p className="max-w-[420px] text-[13.5px] text-ink-2">{message}</p>
      <Button size="sm" onClick={onRetry}>
        Réessayer
      </Button>
    </div>
  );
}

function CalendarFilter({ calendars, hidden, onToggle, onClose }: { calendars: CalendarInfo[]; hidden: Set<string>; onToggle: (id: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => !ref.current?.parentElement?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);
  return (
    <div ref={ref} className="dialog-popup absolute right-0 top-9 z-30 w-[240px] rounded-xl border border-line-strong bg-surface p-1.5 shadow-card">
      {calendars.map((c) => (
        <label key={c.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-1.5 text-[13px] hover:bg-ink/[0.04]">
          <input type="checkbox" className="sr-only" checked={!hidden.has(c.id)} onChange={() => onToggle(c.id)} />
          <span className="flex size-4 shrink-0 items-center justify-center rounded-[4px] border-2" style={{ borderColor: c.color, background: hidden.has(c.id) ? "transparent" : c.color }} aria-hidden />
          <span className="min-w-0 flex-1 truncate">{c.name}</span>
          {c.readOnly && <span className="text-[11px] text-ink-3">lecture</span>}
        </label>
      ))}
    </div>
  );
}

/** The colours of an event block, from its calendar's colour. */
function tint(color: string) {
  return {
    background: `color-mix(in oklab, ${color} 16%, var(--surface))`,
    borderColor: `color-mix(in oklab, ${color} 55%, transparent)`,
    color: `color-mix(in oklab, ${color} 45%, var(--ink))`,
  };
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });

type GridProps = {
  days: Date[];
  events: CalendarEvent[];
  calendarById: Map<string, CalendarInfo>;
  today: Date;
  onOpen: (e: CalendarEvent) => void;
  onDay: (d: Date) => void;
};

function TimeGrid({ days, events, calendarById, today, canWrite, onOpen, onDay, onCreate, onMove }: GridProps & { canWrite: boolean; onCreate: (start: Date, allDay?: boolean) => void; onMove: (e: CalendarEvent, start: Date) => void }) {
  const scroller = useRef<HTMLDivElement>(null);
  const columns = useRef<HTMLDivElement>(null);
  const [now, setNow] = useState(() => new Date());
  const [drag, setDrag] = useState<{ key: string; dayIndex: number; top: number } | null>(null);

  // Opens at 7:00 (or an hour before now, when today is shown).
  const showsToday = days.some((d) => sameDay(d, today));
  useEffect(() => {
    const hour = showsToday ? Math.max(new Date().getHours() - 1, 0) : 7;
    scroller.current?.scrollTo({ top: hour * HOUR_PX });
  }, [showsToday, days.length]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const allDay = days.map((d) => events.filter((e) => e.allDay && happensOn(e, d)));
  const placed = days.map((d) => layoutDay(events, d));
  const single = days.length === 1;

  const minutesAt = (clientY: number) => {
    const rect = columns.current!.getBoundingClientRect();
    const minutes = ((clientY - rect.top) / HOUR_PX) * 60;
    return Math.max(0, Math.min(24 * 60 - SNAP_MIN, Math.round(minutes / SNAP_MIN) * SNAP_MIN));
  };
  const dayAt = (clientX: number) => {
    const rect = columns.current!.getBoundingClientRect();
    return Math.max(0, Math.min(days.length - 1, Math.floor(((clientX - rect.left) / rect.width) * days.length)));
  };

  const clickEmpty = (e: React.MouseEvent, dayIndex: number) => {
    if (!canWrite || e.target !== e.currentTarget) return;
    // The half hour under the pointer.
    const m = Math.floor(minutesAt(e.clientY) / 30) * 30;
    const d = days[dayIndex];
    onCreate(new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(m / 60), m % 60));
  };

  /** Drag a single event to another time or day; a plain click opens it. */
  const startDrag = (e: React.PointerEvent, p: Placed, dayIndex: number) => {
    if (e.button !== 0) return;
    const draggable = canWrite && !p.event.recurring && !calendarById.get(p.event.calendarId)?.readOnly;
    const startY = e.clientY;
    const startX = e.clientX;
    const grab = minutesAt(e.clientY) - p.top;
    let moved = false;
    let target = { dayIndex, top: p.top };
    const onMoveEvt = (ev: PointerEvent) => {
      if (!draggable) return;
      if (!moved && Math.abs(ev.clientY - startY) + Math.abs(ev.clientX - startX) < 5) return;
      moved = true;
      target = { dayIndex: dayAt(ev.clientX), top: Math.max(0, Math.min(24 * 60 - SNAP_MIN, Math.round((minutesAt(ev.clientY) - grab) / SNAP_MIN) * SNAP_MIN)) };
      setDrag({ key: p.event.key, ...target });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMoveEvt);
      window.removeEventListener("pointerup", onUp);
      setDrag(null);
      if (!moved) return onOpen(p.event);
      const original = new Date(p.event.start);
      const d = days[target.dayIndex];
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(target.top / 60), target.top % 60);
      if (start.getTime() !== original.getTime()) onMove(p.event, start);
    };
    window.addEventListener("pointermove", onMoveEvt);
    window.addEventListener("pointerup", onUp);
  };

  const nowTop = (now.getHours() * 60 + now.getMinutes()) * (HOUR_PX / 60);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Day names and all-day events */}
      <div className="flex border-b border-line pr-[var(--scrollbar,0px)]">
        <div className="w-14 shrink-0 max-md:w-11" />
        <div className="grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
          {days.map((d, i) => {
            const isToday = sameDay(d, today);
            return (
              <div key={dayKey(d)} className="flex min-w-0 flex-col gap-1 border-l border-line px-1 pb-1.5 pt-2">
                <button onClick={() => !single && onDay(d)} className={cn("flex items-baseline gap-1.5 self-start rounded-md px-1 text-left", !single && "hover:bg-ink/5")}>
                  <span className={cn("text-[11.5px] uppercase tracking-wide", isToday ? "text-accent" : "text-ink-3")}>{d.toLocaleDateString("fr-CH", { weekday: single ? "long" : "short" })}</span>
                  <span className={cn("tabular text-[17px] font-medium leading-none", isToday && "flex size-7 items-center justify-center rounded-full bg-accent text-[14px] text-accent-ink")}>{d.getDate()}</span>
                </button>
                {allDay[i].map((e) => {
                  const cal = calendarById.get(e.calendarId);
                  return (
                    <button key={e.key} onClick={() => onOpen(e)} className="truncate rounded-md border px-1.5 py-0.5 text-left text-[12px] font-medium" style={tint(cal?.color ?? "#6f42e6")}>
                      {e.title}
                    </button>
                  );
                })}
                {canWrite && !allDay[i].length && <button onClick={() => onCreate(d, true)} aria-label={`Événement sur toute la journée du ${d.toLocaleDateString("fr-CH")}`} className="h-1.5 rounded hover:bg-ink/[0.06]" />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Hours */}
      <div ref={scroller} className="scroll-thin relative min-h-0 flex-1 overflow-y-auto">
        <div className="relative flex" style={{ height: 24 * HOUR_PX }}>
          <div className="w-14 shrink-0 max-md:w-11">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="relative" style={{ height: HOUR_PX }}>
                {h > 0 && <span className="tabular absolute -top-2 right-2 text-[10.5px] text-ink-3">{String(h).padStart(2, "0")}:00</span>}
              </div>
            ))}
          </div>
          <div ref={columns} className="relative grid flex-1" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))` }}>
            {days.map((d, i) => {
              const isToday = sameDay(d, today);
              return (
                <div
                  key={dayKey(d)}
                  onClick={(e) => clickEmpty(e, i)}
                  className={cn("relative border-l border-line", canWrite && "cursor-cell", isToday && "bg-accent/[0.03]")}
                  style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--line) ${HOUR_PX - 1}px, var(--line) ${HOUR_PX}px)` }}
                >
                  {placed[i].map((p) => {
                    const cal = calendarById.get(p.event.calendarId);
                    const dragging = drag?.key === p.event.key;
                    const short = p.height < 40;
                    return (
                      <button
                        key={p.event.key}
                        onPointerDown={(e) => startDrag(e, p, i)}
                        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onOpen(p.event)}
                        className={cn("absolute overflow-hidden rounded-md border px-1.5 text-left text-[12px] leading-tight shadow-[0_1px_2px_rgba(0,0,0,0.06)] transition-opacity", dragging && "opacity-40", short ? "py-0" : "py-1")}
                        style={{ ...tint(cal?.color ?? "#6f42e6"), top: (p.top * HOUR_PX) / 60 + 1, height: (p.height * HOUR_PX) / 60 - 2, left: `calc(${(p.column / p.columns) * 100}% + 2px)`, width: `calc(${100 / p.columns}% - 4px)` }}
                      >
                        <span className={cn("block font-medium", short ? "truncate" : "line-clamp-2")}>
                          {p.event.recurring && <Repeat className="mr-1 inline size-3 align-[-1px] opacity-70" />}
                          {p.event.title}
                          {short && <span className="ml-1 font-normal opacity-75">{hhmm(p.event.start)}</span>}
                        </span>
                        {!short && (
                          <span className="tabular block truncate opacity-75">
                            {hhmm(p.event.start)} – {hhmm(p.event.end)}
                            {p.event.location && ` · ${p.event.location}`}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {drag && drag.dayIndex === i && (() => {
                    const p = placed.flat().find((x) => x.event.key === drag.key);
                    if (!p) return null;
                    const cal = calendarById.get(p.event.calendarId);
                    return (
                      <div className="pointer-events-none absolute left-0.5 right-0.5 z-10 rounded-md border-2 px-1.5 py-1 text-[12px] font-medium shadow-card" style={{ ...tint(cal?.color ?? "#6f42e6"), top: (drag.top * HOUR_PX) / 60, height: (p.height * HOUR_PX) / 60 }}>
                        <span className="tabular">
                          {String(Math.floor(drag.top / 60)).padStart(2, "0")}:{String(drag.top % 60).padStart(2, "0")}
                        </span>{" "}
                        {p.event.title}
                      </div>
                    );
                  })()}
                  {isToday && (
                    <div className="pointer-events-none absolute left-0 right-0 z-10 flex items-center" style={{ top: nowTop }}>
                      <span className="-ml-1 size-2 rounded-full bg-danger" />
                      <span className="h-px flex-1 bg-danger" />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const MONTH_MAX = 3;

function MonthGrid({ days, anchor, events, calendarById, today, onOpen, onDay, onCreate }: GridProps & { anchor: Date; onCreate?: (d: Date) => void }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b border-line">
        {days.slice(0, 7).map((d) => (
          <div key={d.getDay()} className="border-l border-line px-2 py-1.5 text-[11.5px] uppercase tracking-wide text-ink-3 first:border-l-0">
            {d.toLocaleDateString("fr-CH", { weekday: "short" })}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-cols-7 grid-rows-6">
        {days.map((d, i) => {
          const list = events.filter((e) => happensOn(e, d));
          const other = d.getMonth() !== anchor.getMonth();
          const isToday = sameDay(d, today);
          return (
            <div
              key={dayKey(d)}
              onClick={(e) => e.target === e.currentTarget && onCreate?.(d)}
              className={cn("flex min-h-0 min-w-0 flex-col gap-0.5 overflow-hidden border-l border-t border-line p-1", i % 7 === 0 && "border-l-0", i < 7 && "border-t-0", other && "bg-ink/[0.02]", onCreate && "cursor-cell")}
            >
              <button onClick={() => onDay(d)} className={cn("tabular self-start rounded-md px-1 text-[12.5px] hover:bg-ink/5", other ? "text-ink-3" : "text-ink-2", isToday && "bg-accent font-semibold text-accent-ink hover:bg-accent")}>
                {d.getDate()}
              </button>
              {list.slice(0, MONTH_MAX).map((e) => {
                const color = calendarById.get(e.calendarId)?.color ?? "#6f42e6";
                return e.allDay ? (
                  <button key={e.key} onClick={() => onOpen(e)} className="truncate rounded px-1 text-left text-[11.5px] font-medium" style={tint(color)}>
                    {e.title}
                  </button>
                ) : (
                  <button key={e.key} onClick={() => onOpen(e)} className="flex min-w-0 items-center gap-1 rounded px-1 text-left text-[11.5px] hover:bg-ink/5">
                    <span className="size-1.5 shrink-0 rounded-full" style={{ background: color }} />
                    <span className="tabular shrink-0 text-ink-3 max-md:hidden">{hhmm(e.start)}</span>
                    <span className="truncate">{e.title}</span>
                  </button>
                );
              })}
              {list.length > MONTH_MAX && (
                <button onClick={() => onDay(d)} className="self-start px-1 text-[11px] font-medium text-ink-3 hover:text-ink">
                  + {list.length - MONTH_MAX} autres
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
