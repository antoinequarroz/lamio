import MailComposer from "nodemailer/lib/mail-composer";
import type { MailAddress } from "@/lib/types";
import { REMOTE_BACKGROUND, REMOTE_SRC } from "@/lib/mail-frame";
import { cleanOutgoingHtml } from "./html";
import { htmlToReadable } from "./preview";

/*
 * Builds the mail Lamio sends: pure functions, no I/O. The same bytes go to the SMTP server and,
 * with the Bcc kept, into the Sent folder, so the copy seen on the iPhone is the mail that left.
 */

export type OutFile = { name: string; type: string; data: Buffer };

export type Outgoing = {
  from: MailAddress;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  /** What the person wrote, from the editor (cleaned here). */
  html: string;
  /** Added under it as is: the signature and the quoted or forwarded mail, already safe HTML. */
  tail?: string;
  files: OutFile[];
  inReplyTo?: string | null;
  references?: string[];
  messageId?: string;
  date?: Date;
};

const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A plain-text signature, as HTML under the mail. */
export const signatureHtml = (signature: string) =>
  signature.trim() ? `<div class="lamio-signature" style="color:#666">-- <br>${escape(signature.trim()).replace(/\r?\n/g, "<br>")}</div>` : "";

/** A shown mail's HTML, back to what its sender wrote: the remote images it had are put back. */
export const restoreImages = (html: string) => html.replaceAll(` ${REMOTE_SRC}="`, ` src="`).replaceAll(` ${REMOTE_BACKGROUND}="`, ` background="`);

const who = (a: MailAddress) => (a.name ? `${escape(a.name)} &lt;${escape(a.address)}&gt;` : escape(a.address));

/** "Le 25 nov. 2026 à 08:31, Léa Martin <lea@…> a écrit :" and the mail, in a quote. */
export function quoteHtml(original: { from: MailAddress; date: string; html: string | null; text: string }): string {
  const when = new Date(original.date).toLocaleString("fr-CH", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  const body = original.html ? restoreImages(original.html) : escape(original.text).replace(/\n/g, "<br>");
  return `<p>Le ${escape(when)}, ${who(original.from)} a écrit :</p><blockquote type="cite" style="margin:0 0 0 .8ex;border-left:2px solid #ccc;padding-left:1ex">${body}</blockquote>`;
}

/** The header block of a forwarded mail, then the mail. */
export function forwardHtml(original: { from: MailAddress; to: MailAddress[]; cc: MailAddress[]; date: string; subject: string; html: string | null; text: string }): string {
  const when = new Date(original.date).toLocaleString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Zurich" });
  const lines = [
    `<b>De :</b> ${who(original.from)}`,
    `<b>Date :</b> ${escape(when)}`,
    `<b>Objet :</b> ${escape(original.subject)}`,
    original.to.length ? `<b>À :</b> ${original.to.map(who).join(", ")}` : "",
    original.cc.length ? `<b>Cc :</b> ${original.cc.map(who).join(", ")}` : "",
  ].filter(Boolean);
  const body = original.html ? restoreImages(original.html) : escape(original.text).replace(/\n/g, "<br>");
  return `<p>---------- Message transféré ----------<br>${lines.join("<br>")}</p>${body}`;
}

/** "Re: Devis" stays "Re: Devis", "RE: Devis" too; "Devis" becomes "Re: Devis". */
export function replySubject(subject: string, forward = false): string {
  const s = subject.trim();
  if (forward) return /^(fwd?|tr)\s*:/i.test(s) ? s : `Fwd: ${s}`;
  return /^(re|aw|sv)\s*:/i.test(s) ? s : `Re: ${s}`;
}

/** The mail as bytes (RFC 5322). keepBcc: for the copy in Sent, never for the one sent. */
export async function buildMessage(out: Outgoing, options: { keepBcc: boolean }): Promise<Buffer> {
  const html = `<!doctype html><html><head><meta charset="utf-8"></head><body><div>${cleanOutgoingHtml(restoreImages(out.html))}</div>${out.tail ?? ""}</body></html>`;
  const composer = new MailComposer({
    from: out.from,
    to: out.to,
    cc: out.cc.length ? out.cc : undefined,
    bcc: out.bcc.length ? out.bcc : undefined,
    subject: out.subject,
    html,
    // The signature line stays "-- " (with its space): mail apps recognise it.
    text: htmlToReadable(html).replace(/^--$/m, "-- "),
    attachments: out.files.map((f) => ({ filename: f.name, content: f.data, contentType: f.type || "application/octet-stream" })),
    inReplyTo: out.inReplyTo ?? undefined,
    references: out.references?.length ? out.references : undefined,
    messageId: out.messageId,
    date: out.date,
    headers: { "X-Mailer": "Lamio" },
  });
  const mail = composer.compile();
  mail.keepBcc = options.keepBcc;
  return new Promise((resolve, reject) => mail.build((err, data) => (err ? reject(err) : resolve(data))));
}

/** Everyone the SMTP server delivers to. */
export const envelopeOf = (out: Outgoing) => ({ from: out.from.address, to: [...out.to, ...out.cc, ...out.bcc].map((a) => a.address) });
