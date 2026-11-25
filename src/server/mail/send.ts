import "server-only";
import crypto from "node:crypto";
import type { ImapFlow } from "imapflow";
import type { Transporter } from "nodemailer";
import { publish } from "@/server/events";
import type { ComposeMode, MailAddress } from "@/lib/types";
import { readPart } from "./attachment";
import { openMail } from "./body";
import { buildMessage, envelopeOf, forwardHtml, quoteHtml, signatureHtml, type OutFile, type Outgoing } from "./compose";
import { imapClient, mailError, smtpTransport } from "./connect";
import { settingsFor, syncNow } from "./service";
import * as store from "./store";

/*
 * Sending a mail written in Lamio: through the mailbox's own SMTP server (so from the person's
 * real address), then a copy into Sent and, for a reply, the original marked as answered, so the
 * webmail and the iPhone see the same thing.
 *
 * A mail waits UNDO_MS before it leaves ("Annuler" in the app), on the server: closing the tab
 * right after "Envoyer" does not lose it. The outcome comes back through /api/events.
 */

export const UNDO_MS = 5000;
export const MAX_FILES_BYTES = 25 * 1024 * 1024;

/** What the app sends: the editor's content and how the mail relates to another one. */
export type Draft = {
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  mode: ComposeMode;
  /** The mail replied to or forwarded. */
  ref?: { folder: string; uid: number } | null;
  /** Files of a mail to carry over (a forward, a draft taken up again). */
  keep?: { folder: string; uid: number; parts: string[] } | null;
  /** The draft this mail comes from: removed from Drafts once sent. */
  draft?: { folder: string; uid: number } | null;
};

type Deps = {
  smtp: (userId: string) => Pick<Transporter, "sendMail"> | null;
  imap: (userId: string) => ImapFlow | null;
};

const defaults: Deps = {
  smtp: (userId) => {
    const s = settingsFor(userId);
    return s ? smtpTransport(s) : null;
  },
  imap: (userId) => {
    const s = settingsFor(userId);
    return s ? imapClient(s) : null;
  },
};

/** The full mail: what was written, the signature, the quote or the forwarded mail, the files. */
export async function prepare(userId: string, fromName: string, draft: Draft, files: OutFile[], deps: Deps = defaults, withSignature = true): Promise<Outgoing> {
  const account = store.mailAccountInfo(userId);
  if (!account) throw new Error("Aucune boîte mail branchée");
  const out: Outgoing = {
    from: { name: fromName, address: account.email },
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc,
    subject: draft.subject.trim(),
    html: draft.html,
    files: [...files],
  };
  let tail = draft.mode === "draft" || !withSignature ? "" : signatureHtml(account.signature);

  if (draft.ref && (draft.mode === "reply" || draft.mode === "replyAll" || draft.mode === "forward")) {
    const original = await openMail(userId, draft.ref.folder, draft.ref.uid, deps.imap);
    if (!original) throw new Error("Le mail d'origine n'existe plus (supprimé ou déplacé ailleurs)");
    if (draft.mode === "forward") tail += forwardHtml(original);
    else {
      tail += quoteHtml(original);
      const thread = store.threadHeaders(userId, draft.ref.folder, draft.ref.uid);
      if (thread?.messageId) {
        out.inReplyTo = thread.messageId;
        out.references = [...thread.references.filter((r) => r !== thread.messageId), thread.messageId].slice(-20);
      }
    }
  }
  if (draft.mode === "draft" && draft.draft) {
    const thread = store.threadHeaders(userId, draft.draft.folder, draft.draft.uid);
    if (thread?.inReplyTo) out.inReplyTo = thread.inReplyTo;
    if (thread?.references.length) out.references = thread.references;
  }
  out.tail = tail;

  if (draft.keep?.parts.length) {
    for (const part of draft.keep.parts) {
      const file = await readPart(userId, draft.keep.folder, draft.keep.uid, part, deps.imap);
      if (file) out.files.push({ name: file.name, type: file.type, data: file.data });
    }
  }
  if (out.files.reduce((n, f) => n + f.data.length, 0) > MAX_FILES_BYTES) throw new Error("Pièces jointes trop lourdes (25 Mo au plus en tout)");
  return out;
}

/** Sends now: SMTP first (the mail has left, whatever comes after), then the copies on IMAP. */
export async function deliver(userId: string, draft: Draft, out: Outgoing, deps: Deps = defaults): Promise<void> {
  out.messageId ??= `<${crypto.randomUUID()}@${out.from.address.split("@")[1] ?? "lamio"}>`;
  out.date ??= new Date();
  const smtp = deps.smtp(userId);
  if (!smtp) throw new Error("Aucune boîte mail branchée");
  try {
    await smtp.sendMail({ envelope: envelopeOf(out), raw: await buildMessage(out, { keepBcc: false }) });
  } catch (e) {
    throw new Error(mailError(e, "smtp").message);
  }

  const sent = store.specialFolder(userId, "\\Sent");
  const client = deps.imap(userId);
  if (!client) return;
  client.on("error", () => {});
  try {
    await client.connect();
    if (sent) await client.append(sent, await buildMessage(out, { keepBcc: true }), ["\\Seen"], out.date);
    if (draft.ref && (draft.mode === "reply" || draft.mode === "replyAll")) {
      const lock = await client.getMailboxLock(draft.ref.folder);
      try {
        await client.messageFlagsAdd(String(draft.ref.uid), ["\\Answered"], { uid: true });
      } finally {
        lock.release();
      }
      const [m] = store.mailSummaries(userId, draft.ref.folder, [draft.ref.uid]);
      if (m) store.updateFlags(userId, draft.ref.folder, new Map([[m.uid, { seen: m.seen, flagged: m.flagged, answered: true }]]));
    }
    if (draft.draft) await removeDraft(client, userId, draft.draft.folder, draft.draft.uid);
  } finally {
    await client.logout().catch(() => client.close());
  }
}

async function removeDraft(client: ImapFlow, userId: string, folder: string, uid: number) {
  const lock = await client.getMailboxLock(folder);
  try {
    await client.messageDelete(String(uid), { uid: true });
  } finally {
    lock.release();
  }
  store.removeMessages(userId, folder, [uid]);
}

// ---- Waiting room ("Annuler")

type Pending = { userId: string; timer: ReturnType<typeof setTimeout> };
const globalForSend = globalThis as unknown as { __mailOutbox?: Map<string, Pending> };
const outbox = (globalForSend.__mailOutbox ??= new Map());

/** Sends in UNDO_MS unless cancelled. The outcome is published as a mail event { sent: { id, error? } }. */
export function queueSend(userId: string, draft: Draft, out: Outgoing, delay = UNDO_MS, deps: Deps = defaults): string {
  const id = crypto.randomUUID();
  const timer = setTimeout(async () => {
    outbox.delete(id);
    try {
      await deliver(userId, draft, out, deps);
      publish({ type: "mail", status: "ok", folders: [], sent: { id } }, [userId]);
      void syncNow(userId);
    } catch (e) {
      publish({ type: "mail", status: "ok", folders: [], sent: { id, error: (e as Error).message } }, [userId]);
    }
  }, delay);
  outbox.set(id, { userId, timer });
  return id;
}

/** True when the mail had not left yet: it will not. */
export function cancelSend(userId: string, id: string): boolean {
  const p = outbox.get(id);
  if (!p || p.userId !== userId) return false;
  clearTimeout(p.timer);
  outbox.delete(id);
  return true;
}

// ---- Drafts

/** Saves the mail in the mailbox's Drafts (replacing the previous version). Returns where it is. */
export async function saveDraft(userId: string, draft: Draft, out: Outgoing, deps: Deps = defaults): Promise<{ folder: string; uid: number | null }> {
  const folder = store.specialFolder(userId, "\\Drafts");
  if (!folder) throw new Error("Cette boîte n'a pas de dossier Brouillons");
  out.date ??= new Date();
  const client = deps.imap(userId);
  if (!client) throw new Error("Aucune boîte mail branchée");
  client.on("error", () => {});
  try {
    await client.connect();
    const res = await client.append(folder, await buildMessage(out, { keepBcc: true }), ["\\Draft", "\\Seen"], out.date);
    if (draft.draft && draft.draft.folder === folder) await removeDraft(client, userId, folder, draft.draft.uid).catch(() => {});
    void syncNow(userId);
    return { folder, uid: res && typeof res === "object" && "uid" in res && typeof res.uid === "number" ? res.uid : null };
  } finally {
    await client.logout().catch(() => client.close());
  }
}

export async function deleteDraft(userId: string, folder: string, uid: number, deps: Deps = defaults) {
  const client = deps.imap(userId);
  if (!client) return;
  client.on("error", () => {});
  try {
    await client.connect();
    await removeDraft(client, userId, folder, uid);
  } finally {
    await client.logout().catch(() => client.close());
  }
}
