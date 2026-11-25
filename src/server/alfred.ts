import "server-only";
import type { CalendarData, CalendarEvent, CalendarSource, EventInput, RepeatRule } from "@/lib/types";

/**
 * The calendar of Alfred, shown inside Lamio without copying it.
 *
 * Alfred stays its own product: it keeps the events and exposes them through its read API
 * (/api/v1, see docs/API.md in the Alfred repository). Lamio's server reads that API with an
 * access token created in Alfred (Réglages › Accès à l'agenda) and hands the result to the
 * Calendrier tab. The browser never talks to Alfred and never sees the token.
 *
 *   ALFRED_URL        public address of Alfred (also used for the "Ouvrir dans Alfred" links)
 *   ALFRED_API_TOKEN  an access token of Alfred: "alfw_…" (read and write, the Calendrier tab
 *                     creates and edits events) or "alf_…" (read only)
 *   ALFRED_API_URL    optional: where Lamio's server reaches Alfred, when it is not ALFRED_URL
 *                     (for instance http://alfred:3200 on the same Docker network)
 */

const TIMEOUT_MS = 8_000;

const cleanUrl = (value: string | undefined) => (value && /^https?:\/\//.test(value) ? value.replace(/\/+$/, "") : undefined);

export function alfredConfig(env: Record<string, string | undefined> = process.env) {
  const url = cleanUrl(env.ALFRED_URL);
  const token = env.ALFRED_API_TOKEN?.trim();
  if (!url || !token || !/^alfw?_[A-Za-z0-9_-]{20,200}$/.test(token)) return null;
  return { url, apiUrl: cleanUrl(env.ALFRED_API_URL) ?? url, token, writable: token.startsWith("alfw_") };
}

export const calendarConfigured = (env: Record<string, string | undefined> = process.env) => alfredConfig(env) !== null;

export class AlfredError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

type Fetcher = typeof fetch;

async function call<T>(path: string, fetcher: Fetcher, env: Record<string, string | undefined>, method = "GET", body?: unknown): Promise<T> {
  const config = alfredConfig(env);
  if (!config) throw new AlfredError("Le calendrier n'est pas branché", 503);
  let res: Response;
  try {
    res = await fetcher(config.apiUrl + path, {
      method,
      headers: { Authorization: `Bearer ${config.token}`, Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new AlfredError("Alfred ne répond pas pour l'instant", 502);
  }
  if (res.status === 401) throw new AlfredError("Alfred refuse le jeton d'accès : crée-en un nouveau dans Alfred, Réglages › Accès à l'agenda", 502);
  const data = (await res.json().catch(() => null)) as T | { error?: string } | null;
  if (res.status === 405) throw new AlfredError("Le jeton d'Alfred ne permet que la lecture : crée un jeton « API en lecture et écriture » dans Alfred", 403);
  if (!res.ok) {
    const error = data && typeof data === "object" && "error" in data && typeof data.error === "string" ? data.error : `Alfred a répondu ${res.status}`;
    // Alfred's own refusals (bad input, read-only calendar, unknown event, conflict with iCloud) are passed on as they are.
    throw new AlfredError(error, [400, 403, 404, 409].includes(res.status) ? res.status : 502);
  }
  return data as T;
}

type RawCalendar = { id: string; name: string; color: string; source: string; visible: boolean; readOnly: boolean };
type RawEvent = {
  id: string;
  repeat?: string;
  occurrenceId: string | null;
  calendarId: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  location: string;
  description: string;
  recurring: boolean;
};

const SOURCES: CalendarSource[] = ["local", "caldav"];
const REPEATS: RepeatRule[] = ["none", "daily", "weekly", "monthly", "yearly", "custom"];
const str = (v: unknown, max = 4000) => (typeof v === "string" ? v.slice(0, max) : "");
const color = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{3,8}$/i.test(v) ? v : "#6f42e6");

/** Calendars and events of a period, as the Calendrier tab shows them. Only what it needs, checked. */
export async function readCalendar(start: Date, end: Date, fetcher: Fetcher = fetch, env: Record<string, string | undefined> = process.env): Promise<CalendarData> {
  const config = alfredConfig(env);
  const q = new URLSearchParams({ start: start.toISOString(), end: end.toISOString() });
  const [calendars, events] = await Promise.all([call<RawCalendar[]>("/api/v1/calendars", fetcher, env), call<RawEvent[]>(`/api/v1/events?${q}`, fetcher, env)]);
  if (!Array.isArray(calendars) || !Array.isArray(events)) throw new AlfredError("Réponse d'Alfred illisible", 502);
  return {
    alfredUrl: config?.url ?? "",
    writable: !!config?.writable,
    calendars: calendars.map((c) => ({
      id: str(c.id, 200),
      name: str(c.name, 120) || "Calendrier",
      color: color(c.color),
      source: SOURCES.includes(c.source as CalendarSource) ? (c.source as CalendarSource) : "local",
      visible: c.visible !== false,
      readOnly: !!c.readOnly,
    })),
    events: events
      .filter((e) => typeof e.start === "string" && typeof e.end === "string")
      .map(
        (e): CalendarEvent => ({
          key: `${str(e.id, 200)}|${e.occurrenceId ?? ""}`,
          id: str(e.id, 200),
          occurrenceId: typeof e.occurrenceId === "string" ? e.occurrenceId.slice(0, 100) : null,
          repeat: REPEATS.includes(e.repeat as RepeatRule) ? (e.repeat as RepeatRule) : "none",
          calendarId: str(e.calendarId, 200),
          title: str(e.title, 300) || "(sans titre)",
          start: e.start,
          end: e.end,
          allDay: !!e.allDay,
          location: str(e.location, 500),
          description: str(e.description),
          recurring: !!e.recurring,
        }),
      ),
  };
}

/** Writing goes to Alfred, which keeps the event (and writes it to iCloud when the calendar is there). Lamio stores nothing. */
export async function createEvent(input: EventInput, fetcher: Fetcher = fetch, env: Record<string, string | undefined> = process.env) {
  return call<{ id: string }>("/api/v1/events", fetcher, env, "POST", input);
}

export async function updateEvent(id: string, input: EventInput, scope: "this" | "all", occurrenceId: string | null, fetcher: Fetcher = fetch, env: Record<string, string | undefined> = process.env) {
  return call<{ id: string }>(`/api/v1/events/${encodeURIComponent(id)}`, fetcher, env, "PUT", { event: input, scope, occurrenceId });
}

export async function deleteEvent(id: string, scope: "this" | "all", occurrenceId: string | null, fetcher: Fetcher = fetch, env: Record<string, string | undefined> = process.env) {
  const q = new URLSearchParams({ scope, ...(occurrenceId && { occurrenceId }) });
  return call<{ ok: true }>(`/api/v1/events/${encodeURIComponent(id)}?${q}`, fetcher, env, "DELETE");
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** An event sent by the browser, checked before it goes to Alfred. Null when it is not acceptable. */
export function parseEventInput(value: unknown): EventInput | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const s = (k: string, max: number) => (typeof v[k] === "string" && (v[k] as string).length <= max ? (v[k] as string) : null);
  const calendarId = s("calendarId", 200);
  const title = s("title", 500)?.trim();
  const start = s("start", 40);
  const end = s("end", 40);
  const allDay = v.allDay === true;
  const repeat = v.repeat === undefined ? "none" : REPEATS.includes(v.repeat as RepeatRule) ? (v.repeat as RepeatRule) : null;
  const location = v.location === undefined ? "" : s("location", 1000);
  const description = v.description === undefined ? "" : s("description", 20_000);
  if (!calendarId || !title || !start || !end || repeat === null || location === null || description === null) return null;
  if (allDay ? !DATE.test(start) || !DATE.test(end) || end <= start : Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end)) || Date.parse(end) < Date.parse(start)) return null;
  return { calendarId, title, start: allDay ? start : new Date(start).toISOString(), end: allDay ? end : new Date(end).toISOString(), allDay, location, description, repeat };
}

// ---- Video calls (ALFRED-313): the room is Alfred's, Lamio shows it in its call window.

const SLUG = /^[a-z0-9-]{6,64}$/;
export const validSlug = (slug: string) => SLUG.test(slug);

/** Calls work with a token that may write (creating a room is a write). */
export const callsConfigured = (env: Record<string, string | undefined> = process.env) => !!alfredConfig(env)?.writable;

export async function createCallRoom(title: string, fetcher: Fetcher = fetch, env: Record<string, string | undefined> = process.env) {
  const room = await call<{ slug: string; title: string }>("/api/v1/video/rooms", fetcher, env, "POST", { title: title.slice(0, 120) });
  if (!room || typeof room.slug !== "string" || !validSlug(room.slug)) throw new AlfredError("Réponse d'Alfred illisible", 502);
  return { slug: room.slug, title: typeof room.title === "string" ? room.title : title };
}

export async function callStatus(slug: string, fetcher: Fetcher = fetch, env: Record<string, string | undefined> = process.env) {
  const r = await call<{ status: string; live: number | null }>(`/api/v1/video/rooms/${encodeURIComponent(slug)}`, fetcher, env);
  return { status: typeof r.status === "string" ? r.status : "unavailable", live: typeof r.live === "number" ? r.live : null };
}

/**
 * The address of the call for one person, in Alfred's room page, entering without waiting room.
 * It must be on Alfred's public address: the browser opens it in Lamio's call window.
 */
export async function callPass(slug: string, name: string, fetcher: Fetcher = fetch, env: Record<string, string | undefined> = process.env) {
  const config = alfredConfig(env);
  const r = await call<{ url: string }>(`/api/v1/video/rooms/${encodeURIComponent(slug)}/passes`, fetcher, env, "POST", { name: name.slice(0, 50) });
  if (!config || typeof r.url !== "string" || !r.url.startsWith(`${config.url}/v/`)) throw new AlfredError("Réponse d'Alfred illisible", 502);
  return { url: r.url };
}
