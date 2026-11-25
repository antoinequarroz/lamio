import "server-only";
import crypto from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import type { ImapFlow } from "imapflow";
import { db } from "@/server/db";
import type { MailAiAction, MailAiSummary, MailContent } from "@/lib/types";
import { openMail } from "./body";
import { MailProblem } from "./connect";
import { mailExcerpt } from "./share";
import * as store from "./store";

/*
 * The AI help in Mails (LAMIO-315), with Claude through the Anthropic API:
 *  - a conversation summed up in a few lines, with what it asks of me (a meeting, a task, an amount);
 *  - a reply drafted in my own tone, learnt from mails I sent; it opens in the compose window and
 *    nothing leaves before I read it and press Envoyer.
 *
 * The mails are sent to Anthropic only when I press the button. Without ANTHROPIC_API_KEY the
 * buttons are not shown. A summary is kept (table mail_ai) until the conversation changes.
 */

export const AI_MODEL = "claude-opus-5-5";
/** One mail of a conversation: enough for any real mail once the quoted history is cut. */
const MAIL_CHARS = 20_000;
const THREAD_MAILS = 15;
const TONE_SAMPLES = 6;

export const aiReady = (env: Record<string, string | undefined> = process.env) => !!env.ANTHROPIC_API_KEY?.trim() && env.MAIL_AI !== "off";

type Ask = (req: { system: string; content: string; schema: Record<string, unknown> }) => Promise<unknown>;

let client: Anthropic | null = null;

/** One request to Claude whose answer follows `schema`. */
const askClaude: Ask = async ({ system, content, schema }) => {
  client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await client.beta.messages.create({
      model: AI_MODEL,
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      // A request declined by a safety check is answered by another model instead of failing.
      fallbacks: "default",
      output_config: { effort: "low", format: { type: "json_schema", schema } },
      system,
      messages: [{ role: "user", content }],
    });
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new MailProblem("La clé Anthropic est refusée : vérifie ANTHROPIC_API_KEY sur le serveur");
    if (e instanceof Anthropic.RateLimitError) throw new MailProblem("Trop de demandes à Claude pour l'instant : réessaie dans une minute");
    if (e instanceof Anthropic.APIError) throw new MailProblem(`Claude ne répond pas pour l'instant (${e.status ?? "réseau"})`);
    throw e;
  }
  if (res.stop_reason === "refusal") throw new MailProblem("Claude a refusé de traiter ce mail");
  if (res.stop_reason === "max_tokens") throw new MailProblem("La réponse de Claude a été coupée : réessaie");
  const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
  try {
    return JSON.parse(text);
  } catch {
    throw new MailProblem("La réponse de Claude n'a pas pu être lue : réessaie");
  }
};

type Deps = { ask: Ask; connect?: (userId: string) => ImapFlow | null; now?: () => Date };
const defaults: Deps = { ask: askClaude };

const zurich = (d: Date) => d.toLocaleString("fr-CH", { timeZone: "Europe/Zurich", weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" });
const who = (a: { name: string; address: string }) => (a.name ? `${a.name} <${a.address}>` : a.address);

/** The conversation of this mail, oldest first, each mail without the history it quotes. */
async function conversation(userId: string, folder: string, uid: number, deps: Deps): Promise<{ mails: MailContent[]; key: string }> {
  const list = store.threadMessages(userId, folder, uid);
  const refs = (list.length ? list : [{ folder, uid }]).slice(-THREAD_MAILS);
  const mails: MailContent[] = [];
  for (const r of refs) {
    const m = await openMail(userId, r.folder, r.uid, deps.connect);
    if (m) mails.push(m);
  }
  if (!mails.length) throw new MailProblem("Ce mail n'existe plus");
  const key = crypto.createHash("sha256").update(mails.map((m) => `${m.folder}/${m.uid}/${m.messageId ?? ""}`).join("|")).digest("hex");
  return { mails, key };
}

function transcript(mails: MailContent[]): string {
  return mails
    .map((m, i) => {
      const body = mailExcerpt(m, MAIL_CHARS) || "(sans texte)";
      const files = m.attachmentList.length ? `\nPièces jointes : ${m.attachmentList.map((a) => a.name).join(", ")}` : "";
      return `<mail n="${i + 1}">\nDe : ${who(m.from)}\nÀ : ${m.to.map(who).join(", ")}${m.cc.length ? `\nCc : ${m.cc.map(who).join(", ")}` : ""}\nDate : ${zurich(new Date(m.date))}\nObjet : ${m.subject}${files}\n\n${body}\n</mail>`;
    })
    .join("\n\n");
}

const SUMMARY_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "actions"],
  properties: {
    summary: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "title", "start", "end", "allDay", "amount", "details"],
        properties: {
          kind: { type: "string", enum: ["rdv", "tache", "montant"] },
          title: { type: "string" },
          start: { type: "string" },
          end: { type: "string" },
          allDay: { type: "boolean" },
          amount: { type: "string" },
          details: { type: "string" },
        },
      },
    },
  },
};

const SUMMARY_SYSTEM = `Tu aides la personne à qui appartient cette boîte mail (« moi ») à lire ses mails vite. Réponds en français, en tutoyant.

summary : 2 à 4 phrases simples. Dis où en est l'échange et ce qu'on attend de moi, s'il y a quelque chose. Pas de formule d'introduction comme « Ce mail parle de ».

actions : seulement ce que la conversation demande vraiment, au plus 5, souvent aucune.
- rdv : un rendez-vous, une réunion ou une échéance avec une date. start et end en heure locale de Suisse, au format AAAA-MM-JJTHH:MM (ou AAAA-MM-JJ si toute la journée, allDay vrai, end = le jour suivant). Sans heure de fin connue, une heure après le début. Si la date reste vague, ne mets pas de rdv.
- tache : une chose concrète que je dois faire (envoyer, relire, payer, répondre sur un point). start et end vides, sauf une échéance précise dans start.
- montant : une somme d'argent qui me concerne (devis, facture, prix). amount comme dans le mail, par exemple « 1 250 CHF ».
title : court, comme un titre d'agenda ou de ticket. details : une phrase de contexte, ou vide. Les champs sans objet sont des chaînes vides.`;

function cleanActions(raw: unknown): MailAiAction[] {
  if (!Array.isArray(raw)) return [];
  const s = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  return raw.slice(0, 5).flatMap((a): MailAiAction[] => {
    const kind = a?.kind;
    if (kind !== "rdv" && kind !== "tache" && kind !== "montant") return [];
    const title = s(a.title, 200);
    if (!title) return [];
    const start = s(a.start, 20);
    const end = s(a.end, 20);
    const allDay = a.allDay === true;
    const date = allDay ? /^\d{4}-\d{2}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/;
    if (kind === "rdv" && (!date.test(start) || !date.test(end))) return [];
    return [{ kind, title, start: date.test(start) || /^\d{4}-\d{2}-\d{2}/.test(start) ? start : "", end: date.test(end) ? end : "", allDay, amount: s(a.amount, 60), details: s(a.details, 400) }];
  });
}

/** The conversation summed up, with what it asks of me. Kept until the conversation changes. */
export async function summarize(userId: string, folder: string, uid: number, deps: Deps = defaults, fresh = false): Promise<MailAiSummary> {
  const { mails, key } = await conversation(userId, folder, uid, deps);
  if (!fresh) {
    const kept = db().prepare("select result from mail_ai where user_id = ? and key = ?").get(userId, key) as { result: string } | undefined;
    if (kept) return JSON.parse(kept.result) as MailAiSummary;
  }
  const me = store.mailAccountInfo(userId);
  const mine = (me?.identities ?? []).map((i) => i.address).join(", ");
  const now = (deps.now ?? (() => new Date()))();
  const content = `Mes adresses : ${mine || "inconnues"}\nAujourd'hui : ${zurich(now)} (heure de Suisse)\n\n${transcript(mails)}`;
  const raw = (await deps.ask({ system: SUMMARY_SYSTEM, content, schema: SUMMARY_SCHEMA })) as { summary?: unknown; actions?: unknown };
  const result: MailAiSummary = { summary: typeof raw?.summary === "string" ? raw.summary.trim() : "", actions: cleanActions(raw?.actions), mails: mails.length, at: now.toISOString() };
  if (!result.summary) throw new MailProblem("Claude n'a rien renvoyé : réessaie");
  db().prepare("insert or replace into mail_ai (user_id, key, result, created_at) values (?, ?, ?, ?)").run(userId, key, JSON.stringify(result), now.toISOString());
  // Only the latest few hundred are worth keeping.
  db().prepare("delete from mail_ai where user_id = ? and key not in (select key from mail_ai where user_id = ? order by created_at desc limit 300)").run(userId, userId);
  return result;
}

/** A few mails I wrote, my own words only: how I write. */
async function toneSamples(userId: string, deps: Deps): Promise<string[]> {
  const sent = store.specialFolder(userId, "\\Sent");
  if (!sent) return [];
  const out: string[] = [];
  for (const m of store.listMailMessages(userId, sent, undefined, 25).messages) {
    if (out.length >= TONE_SAMPLES) break;
    const full = await openMail(userId, sent, m.uid, deps.connect).catch(() => null);
    const text = full ? mailExcerpt(full, 1500).trim() : "";
    if (text.length >= 40) out.push(`<exemple objet="${m.subject.replace(/"/g, "'")}">\n${text}\n</exemple>`);
  }
  return out;
}

const DRAFT_SCHEMA = { type: "object", additionalProperties: false, required: ["body"], properties: { body: { type: "string" } } };

const DRAFT_SYSTEM = `Tu écris des brouillons de réponse pour la personne à qui appartient cette boîte mail (« moi »). Je relis toujours avant d'envoyer.

Écris comme moi : reprends le ton, la longueur, les salutations et la façon de tutoyer ou vouvoyer que montrent mes mails envoyés, et la langue de la conversation. Avec un correspondant que je vouvoie ou tutoie déjà dans la conversation, garde la même chose.
Réponds au dernier mail de la conversation. Suis la consigne si j'en donne une. N'invente ni engagement, ni date, ni prix, ni fait : là où il manque une information que moi seul connais, mets [à compléter].
body : le texte seul, en paragraphes séparés par une ligne vide, avec la salutation et la formule de fin, sans objet ni signature (Lamio ajoute la signature).`;

/** A reply to the last mail of the conversation, in my tone. Plain text: the compose window takes it. */
export async function draftReply(userId: string, folder: string, uid: number, instruction: string, deps: Deps = defaults): Promise<string> {
  const { mails } = await conversation(userId, folder, uid, deps);
  const samples = await toneSamples(userId, deps);
  const me = store.mailAccountInfo(userId);
  const mine = (me?.identities ?? []).map((i) => i.address).join(", ");
  const now = (deps.now ?? (() => new Date()))();
  const content = [
    `Mes adresses : ${mine || "inconnues"}\nAujourd'hui : ${zurich(now)}`,
    samples.length ? `Mes mails envoyés, pour le ton :\n${samples.join("\n\n")}` : "Aucun mail envoyé à disposition : écris simplement et poliment.",
    `La conversation :\n${transcript(mails)}`,
    instruction.trim() ? `Ma consigne : ${instruction.trim()}` : "Pas de consigne : propose la réponse la plus probable.",
  ].join("\n\n");
  const raw = (await deps.ask({ system: DRAFT_SYSTEM, content, schema: DRAFT_SCHEMA })) as { body?: unknown };
  const body = typeof raw?.body === "string" ? raw.body.trim() : "";
  if (!body) throw new MailProblem("Claude n'a rien renvoyé : réessaie");
  return body;
}
