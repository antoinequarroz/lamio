export { default as cn } from "clsx";

export { APP_NAME } from "./brand";

/** Where a tool of the suite starts and ends its sign-in with this app. */
export const SSO_START_PATH = "/api/auth/lamio/start";
export const SSO_CALLBACK_PATH = "/api/auth/lamio";

/** Where "Ouvrir" leads for a linked tool: through the single sign-on when it has one. Undefined when it is not open to me. */
export function moduleLink(m: { url?: string; sso?: boolean; allowed?: boolean }) {
  if (!m.url) return undefined;
  if (!m.sso) return m.url;
  return m.allowed ? m.url + SSO_START_PATH : undefined;
}

/** The page to go back to after signing in: a path of this app, never another site. */
export function safeNext(next: string | null) {
  return next && /^\/(?![/\\])/.test(next) ? next : "/c";
}

const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function clock(iso: string) {
  return new Date(iso).toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
}

/** "Aujourd'hui", "Hier", or the date: the separators between days in a conversation. */
export function dayLabel(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return "Aujourd'hui";
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return "Hier";
  return d.toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

export function fileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} o`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} Ko`;
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}

export function initials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "?") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

/** A channel name the way it is stored: lowercase, no accents, dashes. */
export function slugify(name: string) {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export async function api<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const res = await fetch(url, init?.json !== undefined ? { ...init, headers: { "Content-Type": "application/json" }, body: JSON.stringify(init.json) } : init);
  if (res.status === 401 && !url.startsWith("/api/auth/")) window.location.href = "/login";
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((data as { error?: string }).error ?? "Une erreur est survenue");
  return data as T;
}

/** When, in a list: the time today, "Hier", the weekday this week, else the date (as Messages on iOS). */
export function shortWhen(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return clock(iso);
  if (sameDay(d, new Date(now.getTime() - 86_400_000))) return "Hier";
  if (now.getTime() - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString("fr-CH", { weekday: "long" });
  return d.toLocaleDateString("fr-CH", { day: "numeric", month: "numeric", year: d.getFullYear() === now.getFullYear() ? undefined : "2-digit" });
}
