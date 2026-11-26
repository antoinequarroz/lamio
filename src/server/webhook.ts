import "server-only";
import { MAX_MESSAGE } from "@/server/http";

/**
 * What an incoming webhook accepts, the same shape as Orbi's alerts:
 *   { "text": "🔴 **Nouvelle erreur sur Lamio**\nTypeError: boom\nhttps://…" }
 * `text` is enough. Without it, the message is built from `title`, `body` and `url`.
 * Other fields (severity, kind, project, source…) are accepted and ignored.
 * Lamio shows plain text: the **bold** marks are taken out, the web addresses become links.
 */
export function webhookText(data: Record<string, unknown>): string | null {
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  let text = str(data.text);
  if (!text) text = [str(data.title), str(data.body), str(data.url)].filter(Boolean).join("\n");
  text = text.replace(/\*\*([\s\S]+?)\*\*/g, "$1").trim();
  if (!text) return null;
  return text.length > MAX_MESSAGE ? `${text.slice(0, MAX_MESSAGE - 1)}…` : text;
}

/** At most `limit` messages per minute and per webhook: a tool in a loop must not flood a channel. */
const hits = new Map<string, number[]>();
export function withinRate(id: string, limit = 30, at = Date.now()): boolean {
  const recent = (hits.get(id) ?? []).filter((t) => at - t < 60_000);
  if (recent.length >= limit) {
    hits.set(id, recent);
    return false;
  }
  recent.push(at);
  hits.set(id, recent);
  return true;
}

/** The public address of this Lamio: APP_URL, else the one the request came to. */
export function publicOrigin(req: Request, env: Record<string, string | undefined> = process.env): string {
  const app = (env.APP_URL ?? "").trim().replace(/\/+$/, "");
  if (app) return app;
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(":", "");
  return host ? `${proto}://${host}` : new URL(req.url).origin;
}

export const hookUrl = (origin: string, token: string) => `${origin}/api/hooks/${token}`;
