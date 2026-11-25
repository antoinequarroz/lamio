import type { CalendarEvent } from "./types";

/** Date arithmetic and layout for the Calendrier tab. Everything is in the browser's local time. */

export type CalendarView = "day" | "week" | "month";

const DAY_MS = 86_400_000;

export const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/** Same time, n days later (calendar days, so a change to summer time keeps midnight at midnight). */
export const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n, d.getHours(), d.getMinutes());

/** The Monday of the week (weeks start on Monday, as in Switzerland). */
export function startOfWeek(d: Date) {
  const day = startOfDay(d);
  return addDays(day, -((day.getDay() + 6) % 7));
}

/** "2026-11-25" in local time: the key of a day, comparable with the dates of all-day events. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const sameDay = (a: Date, b: Date) => dayKey(a) === dayKey(b);

/** The days shown by a view, and the period to ask for. A month shows six full weeks. */
export function viewDays(view: CalendarView, anchor: Date): Date[] {
  if (view === "day") return [startOfDay(anchor)];
  if (view === "week") return Array.from({ length: 7 }, (_, i) => addDays(startOfWeek(anchor), i));
  const first = startOfWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1));
  return Array.from({ length: 42 }, (_, i) => addDays(first, i));
}

export function viewRange(view: CalendarView, anchor: Date) {
  const days = viewDays(view, anchor);
  return { start: days[0], end: addDays(days[days.length - 1], 1) };
}

/** The anchor of the previous or next page of a view. */
export function shift(view: CalendarView, anchor: Date, step: -1 | 1) {
  if (view === "day") return addDays(anchor, step);
  if (view === "week") return addDays(anchor, 7 * step);
  return new Date(anchor.getFullYear(), anchor.getMonth() + step, 1);
}

/** Title of the page: "novembre 2026", "23 – 29 novembre 2026", "mercredi 25 novembre". */
export function viewTitle(view: CalendarView, anchor: Date) {
  if (view === "month") return anchor.toLocaleDateString("fr-CH", { month: "long", year: "numeric" });
  if (view === "day") return anchor.toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
  const days = viewDays("week", anchor);
  const a = days[0];
  const b = days[6];
  if (a.getMonth() === b.getMonth()) return `${a.getDate()} – ${b.toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" })}`;
  if (a.getFullYear() === b.getFullYear()) return `${a.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })} – ${b.toLocaleDateString("fr-CH", { day: "numeric", month: "short", year: "numeric" })}`;
  return `${a.toLocaleDateString("fr-CH", { day: "numeric", month: "short", year: "numeric" })} – ${b.toLocaleDateString("fr-CH", { day: "numeric", month: "short", year: "numeric" })}`;
}

/** Whether an event takes place (in part) on this day. */
export function onDay(e: CalendarEvent, day: Date) {
  if (e.allDay) {
    const key = dayKey(day);
    return e.start <= key && key < e.end;
  }
  const from = startOfDay(day).getTime();
  const to = addDays(startOfDay(day), 1).getTime();
  return Date.parse(e.start) < to && Date.parse(e.end) > from;
}

/** Sorted the way a day lists them: all-day first, then by start, the longest first. */
export function byStart(a: CalendarEvent, b: CalendarEvent) {
  if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
  const sa = a.allDay ? a.start : new Date(a.start).toISOString();
  const sb = b.allDay ? b.start : new Date(b.start).toISOString();
  if (sa !== sb) return sa < sb ? -1 : 1;
  return Date.parse(b.end) - Date.parse(a.end);
}

export type Placed = { event: CalendarEvent; top: number; height: number; column: number; columns: number };

/** Shortest block drawn, in minutes, so a ten-minute event stays readable. */
export const MIN_BLOCK_MIN = 20;

/**
 * Where the timed events of one day go in its column: top and height in minutes from midnight,
 * and side by side when they overlap (a cluster of overlapping events shares the width).
 */
export function layoutDay(events: CalendarEvent[], day: Date): Placed[] {
  const from = startOfDay(day).getTime();
  const to = addDays(startOfDay(day), 1).getTime();
  const spans = events
    .filter((e) => !e.allDay && onDay(e, day))
    .map((event) => {
      const start = Math.max(Date.parse(event.start), from);
      const end = Math.min(Math.max(Date.parse(event.end), start), to);
      const top = (start - from) / 60_000;
      const height = Math.max((end - start) / 60_000, MIN_BLOCK_MIN);
      return { event, top: Math.min(top, 24 * 60 - MIN_BLOCK_MIN), height, column: 0, columns: 1 };
    })
    .sort((a, b) => a.top - b.top || b.height - a.height);

  let cluster: Placed[] = [];
  let clusterEnd = -1;
  let ends: number[] = [];
  const close = () => {
    for (const p of cluster) p.columns = ends.length;
    cluster = [];
    ends = [];
  };
  for (const p of spans) {
    if (p.top >= clusterEnd) close();
    let column = ends.findIndex((end) => end <= p.top);
    if (column === -1) column = ends.push(0) - 1;
    ends[column] = p.top + p.height;
    p.column = column;
    cluster.push(p);
    clusterEnd = Math.max(clusterEnd, p.top + p.height);
  }
  close();
  return spans;
}

/** "09:00 – 10:30", or "Toute la journée". */
export function timeLabel(e: CalendarEvent) {
  if (e.allDay) {
    const days = Math.round((Date.parse(e.end) - Date.parse(e.start)) / DAY_MS);
    return days > 1 ? `Toute la journée · ${days} jours` : "Toute la journée";
  }
  const t = (iso: string) => new Date(iso).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  const start = new Date(e.start);
  const end = new Date(e.end);
  if (sameDay(start, end) || (end.getTime() - start.getTime() <= DAY_MS && end.getHours() === 0 && end.getMinutes() === 0)) return `${t(e.start)} – ${t(e.end)}`;
  return `${start.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })} ${t(e.start)} – ${end.toLocaleDateString("fr-CH", { day: "numeric", month: "short" })} ${t(e.end)}`;
}
