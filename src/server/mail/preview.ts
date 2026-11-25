/*
 * The short excerpt shown under the subject in the list: the start of the text part of a mail,
 * decoded (transfer encoding, then charset) and flattened to one line. Pure functions, no I/O.
 */

export type StructureNode = {
  part?: string;
  type: string;
  parameters?: Record<string, string>;
  encoding?: string;
  disposition?: string;
  childNodes?: StructureNode[];
};

/** The part to read the excerpt from: the first text/plain, else the first text/html. Attachments are skipped. */
export function previewPart(node: StructureNode | undefined): { part: string; html: boolean; encoding: string; charset: string } | null {
  if (!node) return null;
  const all: StructureNode[] = [];
  const walk = (n: StructureNode) => {
    if (n.childNodes?.length) n.childNodes.forEach(walk);
    else if (n.disposition !== "attachment") all.push(n);
  };
  walk(node);
  const pick = all.find((n) => n.type === "text/plain") ?? all.find((n) => n.type === "text/html");
  if (!pick) return null;
  return { part: pick.part ?? "1", html: pick.type === "text/html", encoding: (pick.encoding ?? "7bit").toLowerCase(), charset: pick.parameters?.charset ?? "utf-8" };
}

/** True when the mail carries files (attachments, not the inline images of an HTML mail). */
export function hasAttachments(node: StructureNode | undefined): boolean {
  if (!node) return false;
  if (node.childNodes?.length) return node.childNodes.some(hasAttachments);
  return node.disposition === "attachment" || (!!node.parameters?.name && !node.type.startsWith("text/") && node.disposition !== "inline");
}

function decodeQuotedPrintable(input: Buffer): Buffer {
  const s = input.toString("latin1").replace(/=\r?\n/g, "");
  const out: number[] = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out.push(parseInt(s.slice(i + 1, i + 3), 16));
      i += 2;
    } else out.push(s.charCodeAt(i) & 0xff);
  }
  return Buffer.from(out);
}

function decodeBase64(input: Buffer): Buffer {
  const raw = input.toString("latin1");
  const s = raw.replace(/[^A-Za-z0-9+/]/g, "");
  // Padding means the end of the data. Without it, the excerpt was cut at a byte limit: drop the incomplete last group.
  return Buffer.from(raw.includes("=") ? s : s.slice(0, s.length - (s.length % 4)), "base64");
}

function toText(bytes: Buffer, charset: string): string {
  try {
    return new TextDecoder(charset.toLowerCase(), { fatal: false }).decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}

const ENTITIES: Record<string, string> = { nbsp: " ", amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", eacute: "é", egrave: "è", agrave: "à", ccedil: "ç", rsquo: "’", laquo: "«", raquo: "»" };

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script|head|title)[^>]*>[\s\S]*?(<\/\1>|$)/gi, " ")
    .replace(/<[^>]*>?/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, e: string) => {
      if (e[0] === "#") {
        const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : " ";
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}

export const PREVIEW_LENGTH = 200;

export function makePreview(raw: Buffer, p: { html: boolean; encoding: string; charset: string }): string {
  const bytes = p.encoding === "base64" ? decodeBase64(raw) : p.encoding === "quoted-printable" ? decodeQuotedPrintable(raw) : raw;
  // A character cut in half at the byte limit decodes as U+FFFD: dropped.
  let text = toText(bytes, p.charset).replace(/\uFFFD+$/, "");
  if (p.html) text = htmlToText(text);
  text = text
    // Quoted replies ("> …") and the "On … wrote:" line say nothing new.
    .split(/\r?\n/)
    .filter((l) => !l.trimStart().startsWith(">"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > PREVIEW_LENGTH ? text.slice(0, PREVIEW_LENGTH - 1).trimEnd() + "…" : text;
}
