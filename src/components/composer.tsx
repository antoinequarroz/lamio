"use client";

import { ArrowUp, Paperclip, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import type { FileInfo, Message } from "@/lib/types";
import { api, cn, fileSize } from "@/lib/utils";
import { primaryClass } from "./ui";

type Pending = { key: string; name: string; size: number; file?: FileInfo };

type Props = {
  conversationId: string;
  /** Set to reply in a thread. */
  parentId?: number;
  placeholder: string;
  onSent: (m: Message) => void;
  /** Narrow version, for the thread panel. */
  compact?: boolean;
};

export function Composer({ conversationId, parentId, placeholder, onSent, compact }: Props) {
  const [text, setText] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setText("");
    setPending([]);
    // Typing right away on a computer; on a phone this would pop the keyboard open.
    if (window.matchMedia("(min-width: 768px)").matches) area.current?.focus();
  }, [conversationId, parentId]);

  // The field grows with the text, up to a few lines.
  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const upload = (files: FileList | File[]) => {
    for (const file of Array.from(files)) {
      const key = `${Date.now()}-${Math.random()}`;
      setPending((p) => [...p, { key, name: file.name, size: file.size }]);
      const form = new FormData();
      form.append("file", file);
      api<FileInfo>("/api/files", { method: "POST", body: form }).then(
        (info) => setPending((p) => p.map((x) => (x.key === key ? { ...x, file: info } : x))),
        (e) => {
          setPending((p) => p.filter((x) => x.key !== key));
          toast.error(`${file.name} : ${(e as Error).message}`);
        },
      );
    }
  };

  const uploading = pending.some((p) => !p.file);
  const canSend = !sending && !uploading && (text.trim().length > 0 || pending.length > 0);

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    try {
      const message = await api<Message>(`/api/conversations/${conversationId}/messages`, { method: "POST", json: { body: text, fileIds: pending.map((p) => p.file!.id), parentId } });
      setText("");
      setPending([]);
      onSent(message);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
      area.current?.focus();
    }
  };

  return (
    <div className={cn("pb-5 max-md:px-3 max-md:pb-3", compact ? "px-4" : "px-7")}>
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setDragging(true);
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) upload(e.dataTransfer.files);
        }}
        className={cn(
          "rounded-xl border bg-surface shadow-card transition-[border-color,box-shadow] duration-150 focus-within:border-accent/60 focus-within:shadow-[0_0_0_3px_var(--accent-soft)]",
          dragging ? "border-accent shadow-[0_0_0_3px_var(--accent-soft)]" : "border-line-strong",
        )}
      >
        {pending.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-3 pt-3">
            {pending.map((p) => (
              <span key={p.key} className={cn("flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface-2 py-1 pr-1 pl-2 text-[12px]", !p.file && "animate-pulse")}>
                <Paperclip className="size-3.5 shrink-0 text-ink-3" />
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-ink-3">{p.file ? fileSize(p.size) : "envoi…"}</span>
                <button onClick={() => setPending((list) => list.filter((x) => x.key !== p.key))} aria-label={`Retirer ${p.name}`} className="flex size-5 shrink-0 items-center justify-center rounded text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
                  <X className="size-3.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={area}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send();
            }
          }}
          onPaste={(e) => {
            if (e.clipboardData.files.length) {
              e.preventDefault();
              upload(e.clipboardData.files);
            }
          }}
          maxLength={8000}
          placeholder={dragging ? "Dépose le fichier ici" : placeholder}
          className="scroll-thin block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-[14.5px] leading-[1.5] outline-none placeholder:text-ink-3"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          <input ref={picker} type="file" multiple hidden onChange={(e) => (e.target.files?.length && upload(e.target.files), (e.target.value = ""))} />
          <button onClick={() => picker.current?.click()} aria-label="Joindre un fichier" title="Joindre un fichier" className="press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
            <Paperclip className="size-4" />
          </button>
          {!compact && <span className="ml-auto text-[11px] text-ink-3 max-md:hidden">Entrée pour envoyer, Maj + Entrée pour aller à la ligne</span>}
          <button onClick={send} disabled={!canSend} aria-label="Envoyer" className={cn("press ml-2 flex size-8 items-center justify-center rounded-lg disabled:pointer-events-none disabled:opacity-35 max-md:ml-auto", compact && "ml-auto", primaryClass)}>
            <ArrowUp className="size-4" strokeWidth={2.6} />
          </button>
        </div>
      </div>
    </div>
  );
}
