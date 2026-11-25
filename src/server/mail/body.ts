import "server-only";
import type { Readable } from "node:stream";
import type { ImapFlow } from "imapflow";
import type { MailAttachment, MailContent } from "@/lib/types";
import { imapClient } from "./connect";
import { htmlToReadable, previewPart, type StructureNode } from "./preview";
import { settingsFor } from "./service";
import * as store from "./store";

function defaultConnect(userId: string) {
  const settings = settingsFor(userId);
  return settings ? imapClient(settings) : null;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_TEXT = 200_000;

async function readAll(stream: Readable): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

function attachmentsOf(node: StructureNode & { size?: number; dispositionParameters?: Record<string, string> }, out: MailAttachment[] = []): MailAttachment[] {
  if (node.childNodes?.length) node.childNodes.forEach((n) => attachmentsOf(n, out));
  else {
    const name = node.dispositionParameters?.filename ?? node.parameters?.name;
    if (name && (node.disposition === "attachment" || !node.type.startsWith("text/"))) out.push({ name, type: node.type, size: node.size ?? 0 });
  }
  return out;
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
  if (cached && summary.seen) return { ...summary, ...cached };

  const client = connect(userId);
  if (!client) throw new Error("Aucune boîte mail branchée");
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
        const structure = msg.bodyStructure as StructureNode | undefined;
        const part = previewPart(structure);
        let text = "";
        if (part) {
          const download = await client.download(String(uid), part.part, { uid: true, maxBytes: MAX_BYTES });
          if (download.content) text = await readAll(download.content);
          if (part.html) text = htmlToReadable(text);
        }
        body = { text: text.replace(/\r\n/g, "\n").trim().slice(0, MAX_TEXT), fromHtml: !!part?.html, attachmentList: structure ? attachmentsOf(structure) : [] };
        store.setMailBody(userId, folder, uid, body);
      }
      if (!summary.seen) {
        await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
        store.updateFlags(userId, folder, new Map([[uid, { seen: true, flagged: summary.flagged, answered: summary.answered }]]));
        store.adjustUnread(userId, folder, -1);
      }
      return { ...summary, seen: true, ...body };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
