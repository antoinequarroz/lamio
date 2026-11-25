import type { ComposeMode, MailAddress } from "@/lib/types";
import type { OutFile } from "./compose";
import { MAX_FILES_BYTES, type Draft } from "./send";

const MODES: ComposeMode[] = ["new", "reply", "replyAll", "forward", "draft"];
const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

function addresses(value: unknown, max = 100): MailAddress[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: MailAddress[] = [];
  for (const v of value) {
    const a = v as { name?: unknown; address?: unknown };
    const address = typeof a?.address === "string" ? a.address.trim() : "";
    const name = typeof a?.name === "string" ? a.name.trim().slice(0, 200) : "";
    if (!EMAIL.test(address) || address.length > 320) return null;
    out.push({ name, address });
  }
  return out;
}

function ref(value: unknown): { folder: string; uid: number } | null {
  const r = value as { folder?: unknown; uid?: unknown } | null;
  if (!r || typeof r.folder !== "string" || !r.folder || r.folder.length > 500 || !Number.isInteger(r.uid) || (r.uid as number) <= 0) return null;
  return { folder: r.folder, uid: r.uid as number };
}

/** The mail sent by the compose window: a "mail" JSON field and the attached files. */
export async function parseDraft(form: FormData, { requireRecipient }: { requireRecipient: boolean }): Promise<{ draft: Draft; files: OutFile[] } | { error: string }> {
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(String(form.get("mail") ?? "")) as Record<string, unknown>;
  } catch {
    return { error: "Mail invalide" };
  }
  const to = addresses(raw.to), cc = addresses(raw.cc), bcc = addresses(raw.bcc);
  if (!to || !cc || !bcc) return { error: "Une des adresses n'est pas valide" };
  if (requireRecipient && !to.length && !cc.length && !bcc.length) return { error: "Ajoute au moins un destinataire" };
  const mode = MODES.includes(raw.mode as ComposeMode) ? (raw.mode as ComposeMode) : "new";
  const subject = typeof raw.subject === "string" ? raw.subject.replace(/[\r\n]+/g, " ").slice(0, 500) : "";
  const html = typeof raw.html === "string" ? raw.html : "";
  if (html.length > 2_000_000) return { error: "Mail trop long" };
  const keepRef = ref(raw.keep);
  const parts = Array.isArray((raw.keep as { parts?: unknown })?.parts) ? ((raw.keep as { parts: unknown[] }).parts.filter((p) => typeof p === "string" && /^\d+(\.\d+)*$/.test(p)) as string[]).slice(0, 50) : [];

  const files: OutFile[] = [];
  let total = 0;
  for (const f of form.getAll("files")) {
    if (typeof f === "string") continue;
    total += f.size;
    if (total > MAX_FILES_BYTES) return { error: "Pièces jointes trop lourdes (25 Mo au plus en tout)" };
    files.push({ name: f.name.slice(0, 255) || "fichier", type: f.type || "application/octet-stream", data: Buffer.from(await f.arrayBuffer()) });
  }
  return {
    draft: { to, cc, bcc, subject, html, mode, ref: ref(raw.ref), keep: keepRef && parts.length ? { ...keepRef, parts } : null, draft: ref(raw.draft), from: typeof raw.from === "string" && EMAIL.test(raw.from.trim()) ? raw.from.trim() : null },
    files,
  };
}
