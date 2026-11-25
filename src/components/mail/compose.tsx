"use client";

import { Bold, ChevronUp, Expand, File as FileIcon, Italic, Link2, List, ListOrdered, Loader2, Maximize2, Minimize2, Minus, Paperclip, Quote, Send, Shrink, Trash2, Underline, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useStored } from "@/lib/use-stored";
import { toast } from "sonner";
import { REMOTE_SRC } from "@/lib/mail-frame";
import type { ComposeMode, MailAddress, MailAttachment, MailContent, MailIdentity } from "@/lib/types";
import { api, cn, fileSize } from "@/lib/utils";
import { WhenMenu } from "./when-menu";

/** What the compose window starts with. */
export type ComposeInit = {
  mode: ComposeMode;
  to: MailAddress[];
  cc: MailAddress[];
  bcc: MailAddress[];
  subject: string;
  html: string;
  ref?: { folder: string; uid: number } | null;
  /** Files of another mail carried over (forward, draft taken up again). */
  keep?: { folder: string; uid: number; files: MailAttachment[] } | null;
  draft?: { folder: string; uid: number } | null;
  files?: File[];
  /** Reopened after "Annuler" or a failed send: not in Drafts yet, closing saves it. */
  unsaved?: boolean;
  /** The mail quoted or forwarded, shown under the editor (the server adds it). */
  original?: { from: MailAddress; preview: string } | null;
  /** The address it leaves from; missing: the mailbox's own. */
  from?: string | null;
};

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;
const who = (a: MailAddress) => a.name || a.address;
const sameAddress = (a: MailAddress, b: MailAddress) => a.address.toLowerCase() === b.address.toLowerCase();
const dedupe = (list: MailAddress[], without: MailAddress[] = []) =>
  list.filter((a, i) => list.findIndex((b) => sameAddress(a, b)) === i && !without.some((w) => sameAddress(a, w)));

/** "Léa <lea@x.ch>", "lea@x.ch" → an address, or null. */
function parseAddress(text: string): MailAddress | null {
  const t = text.trim().replace(/[,;]+$/, "");
  const m = t.match(/^"?([^"<]*?)"?\s*<([^>]+)>$/);
  const address = (m ? m[2] : t).trim();
  return EMAIL.test(address) ? { name: m ? m[1].trim() : "", address } : null;
}

/**
 * The compose window's start, for an answer, a forward or a draft taken up again. `mine` are my
 * addresses (the mailbox's own first): an answer leaves from the one the mail was sent to.
 */
export function composeFrom(mail: MailContent, mode: ComposeMode, mine: string[]): ComposeInit {
  const self = mine.map((address) => ({ name: "", address }));
  const isMine = (a: MailAddress) => self.some((s) => sameAddress(s, a));
  const ref = { folder: mail.folder, uid: mail.uid };
  const original = { from: mail.from, preview: mail.text.slice(0, 180) };
  const from = (isMine(mail.from) ? mail.from : [...mail.to, ...mail.cc].find(isMine))?.address.toLowerCase() ?? null;
  if (mode === "reply") return { mode, to: dedupe([mail.from], self).length ? [mail.from] : mail.to, cc: [], bcc: [], subject: replySubject(mail.subject), html: "", ref, original, from };
  if (mode === "replyAll") {
    const to = dedupe([mail.from, ...mail.to], self);
    return { mode, to, cc: dedupe(mail.cc, [...self, ...to]), bcc: [], subject: replySubject(mail.subject), html: "", ref, original, from };
  }
  if (mode === "forward") return { mode, to: [], cc: [], bcc: [], subject: replySubject(mail.subject, true), html: "", ref, original, from, keep: mail.attachmentList.length ? { ...ref, files: mail.attachmentList } : null };
  // A draft: everything it holds goes back into the window.
  return { mode: "draft", to: mail.to, cc: mail.cc, bcc: [], subject: mail.subject, html: editableHtml(mail.html ?? textToHtml(mail.text)), draft: ref, from: isMine(mail.from) ? mail.from.address.toLowerCase() : null, keep: mail.attachmentList.length ? { ...ref, files: mail.attachmentList } : null };
}

function replySubject(subject: string, forward = false) {
  const s = subject.trim();
  if (forward) return /^(fwd?|tr)\s*:/i.test(s) ? s : `Fwd: ${s}`;
  return /^(re|aw|sv)\s*:/i.test(s) ? s : `Re: ${s}`;
}

const textToHtml = (text: string) =>
  text
    .split("\n")
    .map((l) => l.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"))
    .join("<br>");

/**
 * A draft's HTML (already cleaned on the server), made safe to edit inside the app: no styles
 * that would reach the app's page, remote images still kept aside (the server puts them back).
 */
function editableHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  doc.querySelectorAll("style, link, meta, script, iframe, object, embed, form").forEach((n) => n.remove());
  doc.querySelectorAll("[class], [id]").forEach((n) => (n.removeAttribute("class"), n.removeAttribute("id")));
  doc.querySelectorAll("img").forEach((img) => {
    const src = img.getAttribute("src") ?? "";
    if (/^https?:/i.test(src)) {
      img.setAttribute(REMOTE_SRC, src);
      img.removeAttribute("src");
    }
  });
  return doc.body.innerHTML;
}

export type SendState = ComposeInit;

type ComposeSize = "normal" | "large" | "full";

export function Compose({ init, identities, onClose, onSent, onScheduled }: { init: ComposeInit; identities: MailIdentity[]; onClose: () => void; onSent: (id: string, undoMs: number, state: SendState) => void; onScheduled: (id: string, due: string, state: SendState) => void }) {
  const [to, setTo] = useState(init.to);
  const [cc, setCc] = useState(init.cc);
  const [bcc, setBcc] = useState(init.bcc);
  const [showCc, setShowCc] = useState(init.cc.length > 0 || init.bcc.length > 0);
  const [subject, setSubject] = useState(init.subject);
  const [from, setFrom] = useState(() => (identities.find((i) => i.address.toLowerCase() === init.from?.toLowerCase()) ?? identities[0])?.address ?? "");
  const signature = identities.find((i) => i.address === from)?.signature ?? "";
  const [files, setFiles] = useState<File[]>(init.files ?? []);
  const [kept, setKept] = useState<MailAttachment[]>(init.keep?.files ?? []);
  const [draft, setDraft] = useState(init.draft ?? null);
  const [saved, setSaved] = useState<"" | "saving" | "saved" | "error">("");
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Small, large or full screen (kept for the next mail), and folded into a bar to read meanwhile.
  const [size, setSize] = useStored<ComposeSize>("mail-compose-size", "normal", (v): v is ComposeSize => v === "normal" || v === "large" || v === "full");
  const [min, setMin] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const savedRange = useRef<Range | null>(null);
  const dirty = useRef(!!init.unsaved);
  const saving = useRef<Promise<void> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closed = useRef(false);

  useEffect(() => {
    if (editor.current) editor.current.innerHTML = init.html;
    // Answers start in the editor, a new mail on its first empty field.
    if (init.mode === "reply" || init.mode === "replyAll" || init.mode === "draft") editor.current?.focus();
  }, [init]);

  const state = useCallback(
    (): SendState => ({ ...init, to, cc, bcc, subject, html: editor.current?.innerHTML ?? "", files, keep: init.keep && kept.length ? { ...init.keep, files: kept } : null, draft, from }),
    [init, to, cc, bcc, subject, files, kept, draft, from],
  );

  const form = useCallback((s: SendState) => {
    const f = new FormData();
    f.set(
      "mail",
      JSON.stringify({ to: s.to, cc: s.cc, bcc: s.bcc, subject: s.subject, html: s.html, mode: s.mode, from: s.from ?? null, ref: s.ref ?? null, draft: s.draft ?? null, keep: s.keep ? { folder: s.keep.folder, uid: s.keep.uid, parts: s.keep.files.map((k) => k.part) } : null }),
    );
    (s.files ?? []).forEach((file) => f.append("files", file));
    return f;
  }, []);

  const hasContent = () => !!(to.length || cc.length || bcc.length || subject.trim() || editor.current?.innerText.trim() || files.length);

  // Saved into the mailbox's Drafts a few seconds after the last change: found again on the iPhone too.
  const saveDraft = useCallback(async () => {
    if (saving.current) await saving.current;
    if (!dirty.current || closed.current) return;
    dirty.current = false;
    setSaved("saving");
    const run = (async () => {
      try {
        const r = await fetch("/api/mail/draft", { method: "POST", body: form(state()) });
        const data = (await r.json().catch(() => ({}))) as { folder?: string; uid?: number | null; error?: string };
        if (!r.ok) throw new Error(data.error);
        if (data.folder && data.uid) setDraft({ folder: data.folder, uid: data.uid });
        setSaved("saved");
      } catch {
        setSaved("error");
        dirty.current = true;
      }
    })();
    saving.current = run;
    await run;
    saving.current = null;
  }, [form, state]);

  const changed = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void saveDraft(), 4000);
  }, [saveDraft]);

  // Every change but the first render: recipients, subject, files.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    changed();
  }, [to, cc, bcc, subject, files, kept, from, changed]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const close = async () => {
    if (timer.current) clearTimeout(timer.current);
    if (dirty.current && hasContent()) {
      await saveDraft();
      toast("Brouillon enregistré", { description: "Il est dans le dossier Brouillons." });
    }
    closed.current = true;
    onClose();
  };

  const discard = async () => {
    if (timer.current) clearTimeout(timer.current);
    closed.current = true;
    if (saving.current) await saving.current;
    const d = draft;
    onClose();
    if (d) await api(`/api/mail/draft?folder=${encodeURIComponent(d.folder)}&uid=${d.uid}`, { method: "DELETE" }).catch(() => {});
  };

  /** Now (with a few seconds to cancel), or at a chosen time: the server keeps it until then. */
  const send = async (when?: Date) => {
    if (!to.length && !cc.length && !bcc.length) return toast.error("Ajoute au moins un destinataire");
    if (timer.current) clearTimeout(timer.current);
    setSending(true);
    closed.current = true;
    if (saving.current) await saving.current;
    const s = state();
    try {
      const body = form(s);
      if (when) body.set("at", when.toISOString());
      const r = await fetch("/api/mail/send", { method: "POST", body });
      const data = (await r.json().catch(() => ({}))) as { id?: string; undoMs?: number; scheduled?: { id: string; due: string }; error?: string };
      if (r.ok && data.scheduled) return onScheduled(data.scheduled.id, data.scheduled.due, s);
      if (!r.ok || !data.id) throw new Error(data.error ?? "L'envoi a échoué");
      onSent(data.id, data.undoMs ?? 5000, s);
    } catch (e) {
      closed.current = false;
      setSending(false);
      toast.error((e as Error).message);
    }
  };

  const addFiles = (list: FileList | File[]) => {
    const next = [...files, ...Array.from(list)];
    if (next.reduce((n, f) => n + f.size, 0) > 25 * 1024 * 1024) return toast.error("25 Mo au plus en tout");
    setFiles(next);
  };

  const exec = (command: string, value?: string) => {
    editor.current?.focus();
    document.execCommand(command, false, value);
    changed();
  };

  const startLink = () => {
    const sel = window.getSelection();
    savedRange.current = sel && sel.rangeCount ? sel.getRangeAt(0).cloneRange() : null;
    setLinking("https://");
  };
  const applyLink = () => {
    const url = (linking ?? "").trim();
    setLinking(null);
    if (!/^(https?:\/\/|mailto:)\S+$/i.test(url)) return;
    editor.current?.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    if (sel && sel.isCollapsed) document.execCommand("insertHTML", false, `<a href="${url.replace(/"/g, "&quot;")}">${url.replace(/</g, "&lt;")}</a>`);
    else document.execCommand("createLink", false, url);
    changed();
  };

  const title = { new: "Nouveau mail", reply: "Répondre", replyAll: "Répondre à tous", forward: "Transférer", draft: "Brouillon" }[init.mode];

  const sizeButton = "press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink max-md:hidden";

  // Above everything, the app bar included (on a phone it takes the whole screen).
  return createPortal(
    <>
    {size === "full" && !min && <div className="fixed inset-0 z-[59] bg-[rgba(15,14,12,0.3)] backdrop-blur-[2px] max-md:hidden" onClick={() => setSize("normal")} />}
    <div
      role="dialog"
      aria-label={title}
      className={cn(
        "fixed z-[60] flex flex-col overflow-hidden border border-line-strong bg-surface shadow-2xl",
        // On a phone: full screen, clear of the notch and the home bar.
        "inset-0 max-md:border-0 max-md:pt-[env(safe-area-inset-top)] max-md:pb-[env(safe-area-inset-bottom)]",
        min
          ? "md:top-auto md:left-auto md:right-6 md:bottom-0 md:h-12 md:w-[360px] md:rounded-t-xl md:rounded-b-none"
          : size === "full"
            ? "md:inset-6 md:rounded-2xl"
            : size === "large"
              ? "md:top-auto md:left-auto md:right-6 md:bottom-6 md:h-[calc(100vh-48px)] md:w-[min(960px,calc(100vw-48px))] md:rounded-2xl"
              : "md:top-auto md:left-auto md:right-6 md:bottom-6 md:h-[min(640px,calc(100vh-48px))] md:w-[600px] md:rounded-2xl",
        dragging && "ring-2 ring-accent",
      )}
      onKeyDown={(e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          void send();
        } else if (e.key === "Escape" && !e.defaultPrevented) {
          e.preventDefault();
          e.stopPropagation();
          void close();
        }
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        if (!e.dataTransfer.files.length) return;
        e.preventDefault();
        setDragging(false);
        addFiles(e.dataTransfer.files);
      }}
    >
      <header className="flex h-12 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4" onDoubleClick={(e) => e.target === e.currentTarget && (min ? setMin(false) : setSize(size === "normal" ? "large" : "normal"))}>
        <h2 className={cn("min-w-0 flex-1 truncate text-[14px] font-semibold", min && "cursor-pointer")} onClick={() => min && setMin(false)}>
          {min ? subject.trim() || title : title}
        </h2>
        <span className="mr-1 shrink-0 text-[11.5px] text-ink-3 max-sm:hidden">{min ? "" : saved === "saving" ? "Enregistrement…" : saved === "saved" ? "Brouillon enregistré" : saved === "error" ? "Brouillon non enregistré" : ""}</span>
        <button onClick={() => setMin(!min)} aria-label={min ? "Rouvrir" : "Réduire"} title={min ? "Rouvrir" : "Réduire (le mail reste ouvert en bas)"} className={sizeButton}>
          {min ? <Maximize2 className="size-4" /> : <Minus className="size-4" />}
        </button>
        {!min && (
          <>
            <button onClick={() => setSize(size === "large" ? "normal" : "large")} aria-label={size === "large" ? "Taille normale" : "Agrandir"} title={size === "large" ? "Taille normale" : "Agrandir"} className={sizeButton}>
              {size === "large" ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
            </button>
            <button onClick={() => setSize(size === "full" ? "normal" : "full")} aria-label={size === "full" ? "Quitter le plein écran" : "Plein écran"} title={size === "full" ? "Quitter le plein écran" : "Plein écran"} className={sizeButton}>
              {size === "full" ? <Shrink className="size-4" /> : <Expand className="size-4" />}
            </button>
          </>
        )}
        <button onClick={() => void close()} aria-label="Fermer" className="press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
          <X className="size-4" />
        </button>
      </header>

      <div className="flex flex-col border-b border-line text-[13.5px]">
        {identities.length > 1 && (
          <label className="flex items-center gap-3 border-b border-line px-4">
            <span className="w-8 shrink-0 text-ink-3">De</span>
            <select value={from} onChange={(e) => setFrom(e.target.value)} aria-label="De" className="h-10 min-w-0 flex-1 cursor-pointer truncate bg-transparent outline-none">
              {identities.map((i) => (
                <option key={i.address} value={i.address}>
                  {i.name ? `${i.name} <${i.address}>` : i.address}
                </option>
              ))}
            </select>
          </label>
        )}
        <AddressField label="À" value={to} onChange={setTo} autoFocus={init.mode === "new" || init.mode === "forward"}>
          {!showCc && (
            <button onClick={() => setShowCc(true)} className="press shrink-0 px-1 text-[12.5px] text-ink-3 hover:text-ink">
              Cc Cci
            </button>
          )}
        </AddressField>
        {showCc && <AddressField label="Cc" value={cc} onChange={setCc} />}
        {showCc && <AddressField label="Cci" value={bcc} onChange={setBcc} />}
        <label className="flex items-center gap-3 px-4">
          <span className="w-8 shrink-0 text-ink-3">Objet</span>
          <input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-10 min-w-0 flex-1 bg-transparent outline-none" aria-label="Objet" />
        </label>
      </div>

      <div className="flex shrink-0 items-center gap-0.5 border-b border-line px-2 py-1">
        <Tool label="Gras (⌘B)" onClick={() => exec("bold")} Icon={Bold} />
        <Tool label="Italique (⌘I)" onClick={() => exec("italic")} Icon={Italic} />
        <Tool label="Souligné (⌘U)" onClick={() => exec("underline")} Icon={Underline} />
        <span className="mx-1 h-4 w-px bg-line" />
        <Tool label="Liste à puces" onClick={() => exec("insertUnorderedList")} Icon={List} />
        <Tool label="Liste numérotée" onClick={() => exec("insertOrderedList")} Icon={ListOrdered} />
        <Tool label="Citation" onClick={() => exec("formatBlock", "blockquote")} Icon={Quote} />
        <Tool label="Lien" onClick={startLink} Icon={Link2} />
        {linking !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              applyLink();
            }}
            className="ml-1 flex min-w-0 flex-1 items-center gap-1"
          >
            <input
              autoFocus
              value={linking}
              onChange={(e) => setLinking(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && (e.stopPropagation(), e.preventDefault(), setLinking(null))}
              aria-label="Adresse du lien"
              className="h-7 min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 text-[12.5px] outline-none focus:border-accent"
            />
            <button className="press h-7 rounded-md bg-accent px-2 text-[12px] font-medium text-accent-ink">OK</button>
          </form>
        )}
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <div
          ref={editor}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline
          aria-label="Message"
          onInput={changed}
          className="mail-editor min-h-[140px] text-[14px] leading-relaxed outline-none [&_a]:text-accent [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-line-strong [&_blockquote]:pl-3 [&_blockquote]:text-ink-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6"
        />
        {signature.trim() && init.mode !== "draft" && (
          <div className="mt-4 text-[13px] whitespace-pre-line text-ink-3">
            {"-- \n"}
            {signature.trim()}
          </div>
        )}
        {init.original && (
          <div className="mt-4 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-3">
            <p className="font-medium text-ink-2">
              {init.mode === "forward" ? "Mail transféré" : "Mail cité"} de {who(init.original.from)}
            </p>
            <p className="mt-0.5 line-clamp-2">{init.original.preview || "(sans texte)"}</p>
          </div>
        )}
        {(files.length > 0 || kept.length > 0) && (
          <ul className="mt-4 flex flex-wrap gap-2">
            {kept.map((k) => (
              <FileChip key={`k${k.part}`} name={k.name} size={k.size} onRemove={() => setKept(kept.filter((x) => x !== k))} />
            ))}
            {files.map((f, i) => (
              <FileChip key={`f${i}${f.name}`} name={f.name} size={f.size} onRemove={() => setFiles(files.filter((x) => x !== f))} />
            ))}
          </ul>
        )}
      </div>

      <footer className="flex h-14 shrink-0 items-center gap-2 border-t border-line px-3">
        <button
          onClick={() => void send()}
          disabled={sending}
          className="press flex h-9 items-center gap-2 rounded-lg bg-accent px-4 text-[13.5px] font-medium text-accent-ink shadow-card hover:brightness-110 disabled:opacity-60"
        >
          {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
          Envoyer
        </button>
        <WhenMenu kind="send" title="Programmer l'envoi" align="left" up onPick={(d) => void send(d)}>
          {(toggle, open) => (
            <button onClick={toggle} disabled={sending} aria-label="Programmer l'envoi" title="Programmer l'envoi" aria-expanded={open} className={cn("press -ml-1 flex h-9 w-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink", open && "bg-ink/[0.05] text-ink")}>
              <ChevronUp className="size-4" />
            </button>
          )}
        </WhenMenu>
        <span className="hidden text-[11.5px] text-ink-3 md:inline">⌘ Entrée</span>
        <span className="flex-1" />
        <input ref={fileInput} type="file" multiple hidden onChange={(e) => (e.target.files && addFiles(e.target.files), (e.target.value = ""))} />
        <Tool label="Joindre des fichiers" onClick={() => fileInput.current?.click()} Icon={Paperclip} />
        <Tool label="Supprimer le brouillon" onClick={() => void discard()} Icon={Trash2} />
      </footer>
      {dragging && <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-accent/10 text-[14px] font-medium text-accent">Dépose les fichiers pour les joindre</div>}
    </div>
    </>,
    document.body,
  );
}

function Tool({ label, onClick, Icon }: { label: string; onClick: () => void; Icon: typeof Bold }) {
  return (
    <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={onClick} aria-label={label} title={label} className="press flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
      <Icon className="size-4" />
    </button>
  );
}

function FileChip({ name, size, onRemove }: { name: string; size: number; onRemove: () => void }) {
  return (
    <li className="flex max-w-[260px] items-center gap-2 rounded-lg border border-line bg-surface-2 py-1 pr-1 pl-2.5 text-[12.5px]">
      <FileIcon className="size-4 shrink-0 text-ink-3" />
      <span className="min-w-0 truncate">{name}</span>
      {size > 0 && <span className="shrink-0 text-ink-3">{fileSize(size)}</span>}
      <button onClick={onRemove} aria-label={`Retirer ${name}`} className="press flex size-6 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
        <X className="size-3.5" />
      </button>
    </li>
  );
}

/** To / Cc / Cci: addresses as chips, with the people already seen in the mailbox suggested. */
function AddressField({ label, value, onChange, autoFocus, children }: { label: string; value: MailAddress[]; onChange: (v: MailAddress[]) => void; autoFocus?: boolean; children?: React.ReactNode }) {
  const [text, setText] = useState("");
  const [suggestions, setSuggestions] = useState<MailAddress[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const q = text.trim();
    if (q.length < 2) return setSuggestions([]);
    let live = true;
    const t = setTimeout(() => {
      api<{ contacts: MailAddress[] }>(`/api/mail/contacts?q=${encodeURIComponent(q)}`).then(
        (r) => live && (setSuggestions(r.contacts.filter((c) => !value.some((v) => sameAddress(v, c)))), setActive(0)),
        () => {},
      );
    }, 120);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [text, value]);

  const add = (a: MailAddress | null) => {
    if (!a) return false;
    if (!value.some((v) => sameAddress(v, a))) onChange([...value, a]);
    setText("");
    setSuggestions([]);
    return true;
  };
  const commit = () => {
    const parts = text.split(/[,;\n]+/).map((p) => p.trim()).filter(Boolean);
    const parsed = parts.map(parseAddress);
    if (parsed.length && parsed.every(Boolean)) {
      onChange(dedupe([...value, ...(parsed as MailAddress[])]));
      setText("");
      setSuggestions([]);
      return true;
    }
    return false;
  };
  const list = useMemo(() => suggestions.slice(0, 6), [suggestions]);

  return (
    <div className="relative flex min-h-10 items-center gap-3 border-b border-line px-4 last:border-b-0">
      <span className="w-8 shrink-0 text-ink-3">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1 py-1.5">
        {value.map((a) => (
          <span key={a.address} title={a.address} className="flex max-w-[240px] items-center gap-1 rounded-md bg-accent-soft py-0.5 pr-0.5 pl-2 text-[12.5px] text-ink">
            <span className="truncate">{who(a)}</span>
            <button onClick={() => onChange(value.filter((v) => v !== a))} aria-label={`Retirer ${a.address}`} className="press flex size-5 items-center justify-center rounded text-ink-3 hover:text-ink">
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          autoFocus={autoFocus}
          value={text}
          aria-label={label === "À" ? "Destinataires" : label}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTimeout(() => (commit(), setSuggestions([])), 150)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData("text");
            if (/[,;\n]/.test(pasted)) {
              e.preventDefault();
              setText(pasted);
              setTimeout(commit, 0);
            }
          }}
          onKeyDown={(e) => {
            if ((e.key === "ArrowDown" || e.key === "ArrowUp") && list.length) {
              e.preventDefault();
              setActive((active + (e.key === "ArrowDown" ? 1 : list.length - 1)) % list.length);
            } else if ((e.key === "Enter" || e.key === "Tab") && list.length && text.trim()) {
              e.preventDefault();
              add(list[active]);
            } else if ((e.key === "Enter" || e.key === "," || e.key === ";") && text.trim()) {
              e.preventDefault();
              if (!commit()) toast.error(`« ${text.trim()} » n'est pas une adresse valide`);
            } else if (e.key === "Backspace" && !text && value.length) onChange(value.slice(0, -1));
          }}
          className="h-7 min-w-[120px] flex-1 bg-transparent outline-none"
        />
      </div>
      {children}
      {list.length > 0 && (
        <ul role="listbox" className="absolute top-full left-12 z-10 mt-1 w-[min(360px,calc(100%-3.5rem))] overflow-hidden rounded-lg border border-line-strong bg-surface py-1 shadow-xl">
          {list.map((c, i) => (
            <li key={c.address}>
              <button
                role="option"
                aria-selected={i === active}
                onMouseDown={(e) => (e.preventDefault(), add(c))}
                className={cn("flex w-full flex-col px-3 py-1.5 text-left text-[13px]", i === active ? "bg-accent-soft" : "hover:bg-ink/[0.04]")}
              >
                <span className="truncate">{c.name || c.address}</span>
                {c.name && <span className="truncate text-[12px] text-ink-3">{c.address}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
