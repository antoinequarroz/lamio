import "server-only";
import type { Readable } from "node:stream";
import type { ImapFlow } from "imapflow";
import type { MailAttachment, MailContent } from "@/lib/types";
import { imapClient, MailProblem } from "./connect";
import { cleanMailHtml } from "./html";
import { htmlToReadable, type StructureNode } from "./preview";
import { settingsFor } from "./service";
import * as store from "./store";

function defaultConnect(userId: string) {
  const settings = settingsFor(userId);
  return settings ? imapClient(settings) : null;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 200_000;
/** Images carried by the mail (logos, signatures) are stored with it up to these sizes, else loaded on demand. */
const MAX_INLINE_IMAGE = 512 * 1024;
const MAX_INLINE_TOTAL = 2 * 1024 * 1024;

type Node = StructureNode & { id?: string; size?: number; dispositionParameters?: Record<string, string> };

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

/** The leaves of a mail. An attached mail (message/rfc822) is one file, not opened. */
function leaves(node: Node, out: Node[] = []): Node[] {
  if (node.childNodes?.length && node.type !== "message/rfc822") node.childNodes.forEach((n) => leaves(n as Node, out));
  else out.push(node);
  return out;
}

const contentId = (n: Node) => (n.id ?? "").trim().replace(/^<|>$/g, "");

/** The parts that make up a mail: its text, its HTML, the images the HTML shows, and the files. */
export function mailParts(structure: Node | undefined) {
  const all = structure ? leaves(structure) : [];
  const body = all.filter((n) => n.disposition !== "attachment");
  const text = body.find((n) => n.type === "text/plain");
  const html = body.find((n) => n.type === "text/html");
  const images = html ? body.filter((n) => n.type.startsWith("image/") && contentId(n)) : [];
  const files: MailAttachment[] = all
    .filter((n) => n !== text && n !== html && !images.includes(n))
    .filter((n) => n.disposition === "attachment" || !n.type.startsWith("text/") || n.dispositionParameters?.filename || n.parameters?.name)
    .filter((n) => n.type !== "multipart/alternative")
    .map((n) => ({
      name: n.dispositionParameters?.filename ?? n.parameters?.name ?? (n.type === "message/rfc822" ? "mail.eml" : "fichier"),
      type: n.type,
      size: n.size ?? 0,
      part: n.part ?? "1",
    }));
  return { text, html, images, files };
}

/** The URL that serves one part of a mail (same origin: the mail's iframe can load it). */
export const partUrl = (folder: string, uid: number, part: string, inline = false) =>
  `/api/mail/attachment?folder=${encodeURIComponent(folder)}&uid=${uid}&part=${encodeURIComponent(part)}${inline ? "&inline=1" : ""}`;

async function readBody(client: ImapFlow, folder: string, uid: number, structure: Node | undefined): Promise<store.MailBody> {
  const { text, html, images, files } = mailParts(structure);
  const read = async (n: Node, maxBytes = MAX_BYTES) => {
    const download = await client.download(String(uid), n.part ?? "1", { uid: true, maxBytes });
    return download.content ? readAll(download.content) : Buffer.alloc(0);
  };
  const plain = text ? (await read(text)).toString("utf8") : "";
  const rawHtml = html ? (await read(html)).toString("utf8") : "";

  const inline = new Map<string, string>();
  let total = 0;
  for (const img of images) {
    const id = contentId(img);
    const small = (img.size ?? Infinity) <= MAX_INLINE_IMAGE * 1.4 && total < MAX_INLINE_TOTAL;
    if (small) {
      const data = await read(img, MAX_INLINE_IMAGE);
      if (data.length && data.length < MAX_INLINE_IMAGE) {
        total += data.length;
        inline.set(id, `data:${img.type};base64,${data.toString("base64")}`);
        continue;
      }
    }
    inline.set(id, partUrl(folder, uid, img.part ?? "1", true));
  }

  const clean = rawHtml ? cleanMailHtml(rawHtml, inline) : null;
  const readable = plain || (rawHtml ? htmlToReadable(rawHtml) : "");
  return {
    v: 2,
    text: readable.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT),
    html: clean && clean.html.trim() ? clean.html : null,
    remoteImages: clean?.remote ?? false,
    attachmentList: files,
  };
}

/**
 * Opens a mail: its text, read from the server the first time, then kept. Opening it marks it as
 * read on the server too, like any mail app: the webmail and the iPhone see it read.
 * Null when the mail no longer exists. Throws when the mailbox cannot be reached.
 */
export async function openMail(userId: string, folder: string, uid: number, connect: (userId: string) => ImapFlow | null = defaultConnect): Promise<MailContent | null> {
  const summary = store.mailSummaries(userId, folder, [uid])[0];
  if (!summary) return null;
  const cached = store.mailBody(userId, folder, uid);
  const trusted = store.isTrustedSender(userId, summary.from.address);
  if (cached && summary.seen) return { ...summary, ...cached, trusted };

  const client = connect(userId);
  if (!client) throw new MailProblem("Aucune boîte mail branchée");
  client.on("error", () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder);
    try {
      let body = cached;
      if (!body) {
        const msg = await client.fetchOne(String(uid), { uid: true, bodyStructure: true }, { uid: true });
        if (!msg) {
          store.removeMessages(userId, folder, [uid]);
          return null;
        }
        body = await readBody(client, folder, uid, msg.bodyStructure as Node | undefined);
        store.setMailBody(userId, folder, uid, body);
      }
      if (!summary.seen) {
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        store.updateFlags(userId, folder, new Map([[uid, { seen: true, flagged: summary.flagged, answered: summary.answered }]]));
        store.adjustUnread(userId, folder, -1);
      }
      return { ...summary, seen: true, ...body, trusted };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
