import type { MailAddress, MailContent } from "@/lib/types";
import { htmlToReadable } from "./preview";

/** How much of the mail goes into a Lamio message or a TickUp ticket. */
export const SHARE_EXCERPT = 1200;

const who = (a: MailAddress) => (a.name && a.address ? `${a.name} <${a.address}>` : a.name || a.address || "inconnu");
const when = (iso: string) => new Date(iso).toLocaleString("fr-CH", { day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });

/** The readable text of a mail, without the quoted history, cut at `max`. */
export function mailExcerpt(mail: Pick<MailContent, "text" | "html">, max = SHARE_EXCERPT): string {
  const raw = (mail.text?.trim() ? mail.text : mail.html ? htmlToReadable(mail.html) : "").replace(/\r/g, "");
  const lines: string[] = [];
  for (const line of raw.split("\n")) {
    // The quoted history starts here ("Le 12 mars, X a écrit :", "On … wrote:", "> …", "-----Original Message-----").
    if (/^\s*>/.test(line) || /^(le .+ a écrit|on .+ wrote)\s*:\s*$/i.test(line.trim()) || /^-{2,}\s*(original message|message d'origine)/i.test(line.trim())) break;
    lines.push(line.trimEnd());
  }
  const text = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;
}

/**
 * The Lamio message that shares a mail: my comment, then who wrote, the subject and the start of
 * the mail. The attachments not shared as files (`shared`: their parts) are named at the end.
 */
export function shareText(mail: MailContent, comment: string, shared: string[] = [], max = 8000): string {
  const head = [`✉️ ${mail.subject || "(sans objet)"}`, `De ${who(mail.from)}, le ${when(mail.date)}`];
  const left = mail.attachmentList.filter((a) => !shared.includes(a.part));
  const files = left.length ? `📎 ${left.map((a) => a.name).join(", ")}` : "";
  const parts = [comment.trim(), head.join("\n"), mailExcerpt(mail), files].filter(Boolean);
  const out = parts.join("\n\n");
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** The description of a TickUp ticket made from a mail (TickUp reads Markdown). */
export function ticketDescription(mail: MailContent, note: string): string {
  const quote = mailExcerpt(mail, 3000)
    .split("\n")
    .map((l) => `> ${l}`)
    .join("\n");
  const lines = [
    note.trim(),
    `**Mail** : ${mail.subject || "(sans objet)"}`,
    `**De** : ${who(mail.from)}`,
    `**Reçu le** : ${when(mail.date)}`,
    mail.attachmentList.length ? `**Pièces jointes** : ${mail.attachmentList.map((a) => a.name).join(", ")}` : "",
    quote,
    "_Créé depuis Lamio Mails._",
  ];
  return lines.filter(Boolean).join("\n\n");
}

/** "Re: TR: Devis" → "Devis": a ticket title from a subject. */
export const ticketTitle = (subject: string) => subject.replace(/^\s*((re|tr|fwd?|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i, "").trim().slice(0, 200) || "Mail sans objet";
