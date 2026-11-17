import type { ModuleInfo } from "@/lib/types";

/**
 * The modules of the suite. This app is the base: every other tool plugs in here.
 *
 * Three levels, as in the roadmap:
 *  - "core"   : built into this app (the messaging).
 *  - "linked" : the tool runs at its own address and this app opens it (set its URL in .env).
 *  - "soon"   : planned, not plugged in yet.
 *
 * To add a module: add an entry here. To plug an existing tool: give its URL in the
 * environment variable named in `env` (CAIRN_URL).
 *
 * Single sign-on: give the tool a shared secret as well (CAIRN_SSO_SECRET here, LAMIO_SSO_SECRET
 * in the tool). The tool then offers "Se connecter avec Lamio", see src/server/sso.ts.
 */
type ModuleDef = Omit<ModuleInfo, "status" | "url"> & { core?: boolean; env?: string };

const MODULES: ModuleDef[] = [
  {
    id: "messagerie",
    name: "Messagerie",
    role: "Canaux, messages directs, fichiers",
    description: "La base de la suite : les conversations de l'équipe, par canal ou en privé.",
    icon: "messages",
    core: true,
    href: "/c",
  },
  {
    id: "projets",
    name: "Projets",
    role: "Projets et tâches",
    description: "Les projets de l'équipe, leurs tâches en liste ou en tableau, et un canal par projet.",
    icon: "projets",
    core: true,
    href: "/p",
  },
  {
    id: "notes",
    name: "Cairn",
    role: "Notes et coffre",
    description: "Notes en Markdown et coffre chiffré pour les mots de passe et les clés.",
    icon: "notes",
    env: "CAIRN_URL",
  },
  {
    id: "publication",
    name: "Metricove",
    role: "Publication",
    description: "Calendrier éditorial et publication sur les réseaux sociaux.",
    icon: "publication",
    env: "METRICOVE_URL",
  },
  {
    id: "agenda",
    name: "Alfred",
    role: "Calendrier et rendez-vous",
    description: "Agenda, prise de rendez-vous et visio.",
    icon: "agenda",
    env: "ALFRED_URL",
  },
  {
    id: "studio",
    name: "Nino",
    role: "Régie vidéo",
    description: "Podcasts, tables rondes et lives, pilotés depuis la salle.",
    icon: "studio",
    env: "NINO_URL",
  },
];

const validUrl = (value: string | undefined) => (value && /^https?:\/\//.test(value) ? value.replace(/\/+$/, "") : undefined);

/** A secret too short to be one is treated as missing. */
export const MIN_SSO_SECRET = 32;
const secretKey = (urlKey: string) => urlKey.replace(/_URL$/, "_SSO_SECRET");


export function listModules(env: Record<string, string | undefined> = process.env): ModuleInfo[] {
  return MODULES.map(({ core, env: key, ...m }) => {
    const url = key ? validUrl(env[key]) : undefined;
    const sso = !!url && !!key && (env[secretKey(key)]?.length ?? 0) >= MIN_SSO_SECRET;
    return { ...m, status: core ? "core" : url ? "linked" : "soon", url, ...(sso && { sso }) };
  });
}

/** A tool that signs people in with this app: its name in the protocol is its env prefix in lower case ("cairn"). */
export function ssoClient(client: string, env: Record<string, string | undefined> = process.env) {
  const def = MODULES.find((m) => m.env && m.env.replace(/_URL$/, "").toLowerCase() === client);
  if (!def?.env) return null;
  const url = validUrl(env[def.env]);
  const secret = env[secretKey(def.env)] ?? "";
  return url && secret.length >= MIN_SSO_SECRET ? { id: def.id, name: def.name, url, secret } : null;
}
