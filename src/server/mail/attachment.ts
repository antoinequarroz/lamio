import "server-only";
import type { Readable } from "node:stream";
import type { ImapFlow } from "imapflow";
import { imapClient, MailProblem } from "./connect";
import { settingsFor } from "./service";
import * as store from "./store";

function defaultConnect(userId: string) {
  const settings = settingsFor(userId);
  return settings ? imapClient(settings) : null;
}

export const MAX_ATTACHMENT = 40 * 1024 * 1024;

export type Part = { data: Buffer; type: string; name: string };

/**
 * One file of a mail, read from the server (decoded). Null when the mail or the part no longer
 * exists. Reading it does not mark the mail as read. Throws when the mailbox cannot be reached,
 * or when the file is over MAX_ATTACHMENT.
 */
export async function readPart(userId: string, folder: string, uid: number, part: string, connect: (userId: string) => ImapFlow | null = defaultConnect): Promise<Part | null> {
  if (!store.mailSummaries(userId, folder, [uid])[0]) return null;
  const client = connect(userId);
  if (!client) throw new MailProblem("Aucune boîte mail branchée");
  client.on("error", () => {});
  try {
    await client.connect();
    const lock = await client.getMailboxLock(folder, { readOnly: true });
    try {
      const download = await client.download(String(uid), part, { uid: true, maxBytes: MAX_ATTACHMENT + 1, decodeText: false });
      if (!download?.content) return null;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of download.content as Readable) {
        const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += b.length;
        if (size > MAX_ATTACHMENT) throw new MailProblem("Fichier trop lourd pour être ouvert ici (plus de 40 Mo) : ouvre-le dans le webmail.");
        chunks.push(b);
      }
      const { contentType, filename } = download.meta;
      return { data: Buffer.concat(chunks), type: (contentType ?? "application/octet-stream").toLowerCase(), name: filename ?? "fichier" };
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => client.close());
  }
}
