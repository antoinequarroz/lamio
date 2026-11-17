"use client";

import { Download, FileIcon, MessageSquare, Pencil, SmilePlus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Message } from "@/lib/types";
import { api, clock, cn, fileSize } from "@/lib/utils";
import { Avatar, Button } from "./ui";

const INLINE = /^image\/(png|jpeg|gif|webp|avif)$/;
export const QUICK_REACTIONS = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"];

type Props = {
  message: Message;
  /** Follows a message of the same person a moment earlier: no avatar, no name. */
  grouped?: boolean;
  /** Inside the thread panel: no "reply" there, threads are one level deep. */
  inThread?: boolean;
  onOpenThread?: (m: Message) => void;
  /** The server's answer after my own action, so the screen does not wait for the live event. */
  onChange: (m: Message) => void;
  onRemove: (m: Message) => void;
};

export function MessageItem({ message: m, grouped, inThread, onOpenThread, onChange, onRemove }: Props) {
  const { me, userById } = useApp();
  const author = userById(m.userId);
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  /** On a touch screen there is no hover: a tap on the message shows its actions. */
  const [tapped, setTapped] = useState(false);
  const mine = m.userId === me.id;

  const react = async (emoji: string) => {
    setPicking(false);
    try {
      onChange(await api<Message>(`/api/messages/${m.id}/reactions`, { method: "POST", json: { emoji } }));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async () => {
    const withReplies = m.replyCount > 0 ? ` Ses ${m.replyCount > 1 ? `${m.replyCount} réponses seront supprimées` : "réponse sera supprimée"} aussi.` : "";
    if (!window.confirm(`Supprimer ce message ?${withReplies}`)) return;
    try {
      await api(`/api/messages/${m.id}`, { method: "DELETE" });
      onRemove(m);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const toolbarOpen = picking || tapped;
  const action = "press flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink";

  return (
    <div
      data-message={m.id}
      onClick={() => window.matchMedia("(hover: none)").matches && setTapped((t) => !t)}
      onMouseLeave={() => setPicking(false)}
      className={cn("group relative -mx-2 flex shrink-0 gap-3 rounded-lg px-2 py-0.5 hover:bg-ink/[0.03]", !grouped && "mt-2.5", toolbarOpen && "bg-ink/[0.03]")}
    >
      {grouped ? (
        <span className="tabular w-8 shrink-0 pt-[3px] text-right text-[10.5px] text-ink-3 opacity-0 group-hover:opacity-100">{clock(m.createdAt)}</span>
      ) : (
        <Avatar id={m.userId} name={author?.name ?? "?"} className="mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        {!grouped && (
          <div className="flex items-baseline gap-2">
            <span className="text-[13.5px] font-semibold">{author?.name ?? "Ancien membre"}</span>
            <span className="tabular text-[11.5px] text-ink-3">{clock(m.createdAt)}</span>
          </div>
        )}

        {editing ? (
          <EditForm message={m} onDone={() => setEditing(false)} onChange={onChange} />
        ) : (
          m.body && (
            <p className="whitespace-pre-wrap text-[14.5px] leading-[1.5] [overflow-wrap:anywhere]">
              {linkify(m.body)}
              {m.editedAt && (
                <span className="ml-1.5 text-[11.5px] text-ink-3" title={`Modifié à ${clock(m.editedAt)}`}>
                  (modifié)
                </span>
              )}
            </p>
          )
        )}

        {m.files.length > 0 && (
          <div className="mt-1.5 mb-1 flex flex-wrap gap-2">
            {m.files.map((f) =>
              INLINE.test(f.mime) ? (
                <a key={f.id} href={`/api/files/${f.id}`} target="_blank" rel="noreferrer" title={f.name}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/files/${f.id}`} alt={f.name} loading="lazy" className="max-h-[280px] max-w-full rounded-xl border border-line" />
                </a>
              ) : (
                <a key={f.id} href={`/api/files/${f.id}`} className="press flex max-w-full items-center gap-2.5 rounded-xl border border-line-strong bg-surface py-2 pr-3 pl-2.5 shadow-card hover:bg-surface-2">
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                    <FileIcon className="size-4" />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[13px] font-medium leading-tight">{f.name}</span>
                    <span className="block text-[11.5px] leading-tight text-ink-3">{fileSize(f.size)}</span>
                  </span>
                  <Download className="ml-1 size-4 shrink-0 text-ink-3" />
                </a>
              ),
            )}
          </div>
        )}

        {m.reactions.length > 0 && (
          <div className="mt-1 mb-0.5 flex flex-wrap gap-1">
            {m.reactions.map((r) => {
              const reacted = r.userIds.includes(me.id);
              return (
                <button
                  key={r.emoji}
                  onClick={(e) => (e.stopPropagation(), react(r.emoji))}
                  aria-pressed={reacted}
                  title={r.userIds.map((id) => (id === me.id ? "Toi" : (userById(id)?.name ?? "Ancien membre"))).join(", ")}
                  className={cn("press flex h-6 items-center gap-1 rounded-full border px-2 text-[12px]", reacted ? "border-accent/50 bg-accent-soft text-accent" : "border-line-strong bg-surface text-ink-2 hover:bg-surface-2")}
                >
                  <span className="text-[13px] leading-none">{r.emoji}</span>
                  <span className="tabular font-medium">{r.userIds.length}</span>
                </button>
              );
            })}
          </div>
        )}

        {!inThread && m.replyCount > 0 && (
          <button onClick={(e) => (e.stopPropagation(), onOpenThread?.(m))} className="press -ml-1.5 mt-0.5 mb-0.5 flex h-7 items-center gap-1.5 rounded-md px-1.5 text-[12.5px] font-medium text-accent hover:bg-accent-soft">
            <MessageSquare className="size-3.5" />
            {m.replyCount} {m.replyCount > 1 ? "réponses" : "réponse"}
            {m.lastReplyAt && <span className="font-normal text-ink-3">dernière à {clock(m.lastReplyAt)}</span>}
          </button>
        )}
      </div>

      {!editing && (
        <div
          onClick={(e) => e.stopPropagation()}
          className={cn("absolute -top-3.5 right-2 flex items-center gap-px rounded-lg border border-line-strong bg-surface p-0.5 shadow-card transition-opacity duration-100 focus-within:opacity-100 group-hover:opacity-100", toolbarOpen ? "opacity-100" : "opacity-0")}
        >
          {picking ? (
            QUICK_REACTIONS.map((emoji) => (
              <button key={emoji} onClick={() => react(emoji)} aria-label={`Réagir avec ${emoji}`} className="press flex size-7 items-center justify-center rounded-md text-[15px] hover:bg-ink/[0.06]">
                {emoji}
              </button>
            ))
          ) : (
            <>
              <button onClick={() => setPicking(true)} aria-label="Réagir" title="Réagir" className={action}>
                <SmilePlus className="size-4" />
              </button>
              {!inThread && (
                <button onClick={() => onOpenThread?.(m)} aria-label="Répondre dans un fil" title="Répondre dans un fil" className={action}>
                  <MessageSquare className="size-4" />
                </button>
              )}
              {mine && (
                <button onClick={() => setEditing(true)} aria-label="Modifier le message" title="Modifier" className={action}>
                  <Pencil className="size-3.5" />
                </button>
              )}
              {(mine || me.role === "admin") && (
                <button onClick={remove} aria-label="Supprimer le message" title="Supprimer" className={cn(action, "hover:text-danger")}>
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function EditForm({ message, onDone, onChange }: { message: Message; onDone: () => void; onChange: (m: Message) => void }) {
  const [text, setText] = useState(message.body);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 240)}px`;
  }, [text]);

  const save = async () => {
    if (busy) return;
    if (text.trim() === message.body) return onDone();
    setBusy(true);
    try {
      onChange(await api<Message>(`/api/messages/${message.id}`, { method: "PATCH", json: { body: text } }));
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="my-1 rounded-xl border border-accent/60 bg-surface shadow-[0_0_0_3px_var(--accent-soft)]" onClick={(e) => e.stopPropagation()}>
      <textarea
        ref={area}
        rows={1}
        value={text}
        maxLength={8000}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          else if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            save();
          }
        }}
        aria-label="Modifier le message"
        className="scroll-thin block w-full resize-none bg-transparent px-3 pt-2.5 pb-1 text-[14.5px] leading-[1.5] outline-none"
      />
      <div className="flex items-center gap-1.5 px-2 pb-2">
        <span className="mr-auto pl-1 text-[11px] text-ink-3 max-md:hidden">Entrée pour enregistrer, Échap pour annuler</span>
        <Button size="sm" variant="ghost" onClick={onDone}>
          Annuler
        </Button>
        <Button size="sm" variant="primary" onClick={save} disabled={busy || (!text.trim() && !message.files.length)}>
          Enregistrer
        </Button>
      </div>
    </div>
  );
}

/** Plain text, with web addresses turned into links. */
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()} className="text-accent underline decoration-accent/40 underline-offset-[3px]">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
