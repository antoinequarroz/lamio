import "server-only";

/**
 * Lamio writes in TickUp through its REST API, with the key of an agent made in TickUp
 * (Réglages › Agents IA › « Créer la clé », name it "Lamio"): TICKUP_URL and TICKUP_TOKEN.
 * The tickets then carry the agent's name, and the key can be revoked in TickUp at any time.
 */
export type TickupProject = { key: string; name: string };
export type TickupIssue = { ref: string; title: string; url: string };

export class TickupProblem extends Error {}

export function tickupConfig(env: Record<string, string | undefined> = process.env) {
  const url = env.TICKUP_URL && /^https?:\/\//.test(env.TICKUP_URL) ? env.TICKUP_URL.replace(/\/+$/, "") : "";
  const token = env.TICKUP_TOKEN?.trim() ?? "";
  return url && token.length >= 16 ? { url, token } : null;
}

async function call<T>(path: string, init: RequestInit = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const config = tickupConfig();
  if (!config) throw new TickupProblem("TickUp n'est pas branché : ajoute TICKUP_URL et TICKUP_TOKEN (une clé d'agent créée dans TickUp).");
  let res: Response;
  try {
    res = await fetcher(`${config.url}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json", "User-Agent": "Lamio" },
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch {
    throw new TickupProblem("TickUp ne répond pas pour le moment.");
  }
  const data = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.status === 401) throw new TickupProblem("TickUp refuse la clé : crée une nouvelle clé d'agent et mets-la dans TICKUP_TOKEN.");
  if (!res.ok || !data) throw new TickupProblem(data?.error || `TickUp a répondu ${res.status}`);
  return data;
}

/** The open projects, by name. */
export async function tickupProjects(fetcher?: typeof fetch): Promise<TickupProject[]> {
  const list = await call<{ key: string; name: string; archived?: boolean }[]>("/api/projects", {}, fetcher);
  return list.filter((p) => !p.archived).map((p) => ({ key: p.key, name: p.name }));
}

/** Creates a ticket; its address in TickUp comes back. */
export async function createTickupIssue(input: { project: string; title: string; description: string; priority: number }, fetcher?: typeof fetch): Promise<TickupIssue> {
  const key = input.project.toUpperCase();
  const issue = await call<{ ref: string; title: string }>(`/api/projects/${encodeURIComponent(key)}/issues`, { method: "POST", body: JSON.stringify({ title: input.title, description: input.description, priority: input.priority }) }, fetcher);
  return { ref: issue.ref, title: issue.title, url: `${tickupConfig()!.url}/p/${key}?issue=${encodeURIComponent(issue.ref)}` };
}
