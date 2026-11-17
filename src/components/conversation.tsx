"use client";

import { ArrowLeft, Download, FileIcon, Hash, Trash2 } from "lucide-react";
import Link from "next/link";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Message } from "@/lib/types";
import { api, clock, cn, dayLabel, fileSize } from "@/lib/utils";
import { Composer } from "./composer";
import { Avatar, Button } from "./ui";

type Page = { messages: Message[]; hasMore: boolean };

const GROUP_MS = 5 * 60_000;
const INLINE = /^image\/(png|jpeg|gif|webp|avif)$/;

export function ConversationView({ id }: { id: string }) {
  const { conversations, userById, titleOf, users, me, setActive, markRead, listen } = useApp();
  const conversation = conversations.find((c) => c.id === id);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  /** Stay glued to the newest message unless the reader scrolled up. */
  const stick = useRef(true);
  /** Height before older messages were added on top, to keep the view in place. */
  const prepend = useRef<number | null>(null);

  const load = useCallback(async () => {
    try {
      const page = await api<Page>(`/api/conversations/${id}/messages`);
      setMessages(page.messages);
      setHasMore(page.hasMore);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    setMessages(null);
    stick.current = true;
    load();
  }, [load]);

  useEffect(() => {
    setActive(id);
    return () => setActive(null);
  }, [id, setActive]);

  useEffect(
    () =>
      listen((event) => {
        if (event.type === "resync") load();
        else if (event.type === "message" && event.message.conversationId === id) setMessages((list) => (list && !list.some((m) => m.id === event.message.id) ? [...list, event.message] : list));
        else if (event.type === "message-deleted" && event.conversationId === id) setMessages((list) => list?.filter((m) => m.id !== event.id) ?? list);
      }),
    [id, listen, load],
  );

  // Reading: whatever is on screen while the tab is visible counts as read.
  const lastId = messages?.at(-1)?.id ?? 0;
  useEffect(() => {
    if (!messages) return;
    const read = () => !document.hidden && markRead(id, lastId);
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [id, lastId, messages, markRead]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prepend.current !== null) {
      el.scrollTop = el.scrollHeight - prepend.current;
      prepend.current = null;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const loadOlder = async () => {
    if (!messages?.length) return;
    try {
      const page = await api<Page>(`/api/conversations/${id}/messages?before=${messages[0].id}`);
      prepend.current = scroller.current ? scroller.current.scrollHeight - scroller.current.scrollTop : null;
      setMessages((list) => [...page.messages, ...(list ?? [])]);
      setHasMore(page.hasMore);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const remove = async (m: Message) => {
    if (!window.confirm("Supprimer ce message ?")) return;
    try {
      await api(`/api/messages/${m.id}`, { method: "DELETE" });
      setMessages((list) => list?.filter((x) => x.id !== m.id) ?? list);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  if (!conversation) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[15px] font-medium">Conversation introuvable</p>
        <Link href="/c" className="text-[13px] text-accent">
          Retour à la messagerie
        </Link>
      </div>
    );
  }

  const other = userById(conversation.otherUserId);
  const title = titleOf(conversation);
  const isChannel = conversation.kind === "channel";
  const subtitle = isChannel ? conversation.topic || `${users.length} ${users.length > 1 ? "membres" : "membre"}` : other?.id === me.id ? "Ton espace à toi : notes, liens, fichiers" : (other?.email ?? "");

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-7 py-4 max-md:px-3 max-md:py-2.5">
        <Link href="/c" aria-label="Retour" className="-ml-1 flex size-9 items-center justify-center rounded-lg text-ink-2 md:hidden">
          <ArrowLeft className="size-[18px]" />
        </Link>
        {isChannel ? (
          <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent max-md:hidden">
            <Hash className="size-[18px]" strokeWidth={2.2} />
          </span>
        ) : (
          <Avatar id={other?.id ?? id} name={other?.name ?? "?"} size="lg" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[24px] leading-none">{isChannel ? conversation.name : title}</h1>
          <p className="mt-1 truncate text-[12.5px] text-ink-3">{subtitle}</p>
        </div>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-7 py-4 max-md:px-3"
      >
        {error && !messages ? (
          <p className="m-auto text-[13px] text-ink-3">{error}</p>
        ) : !messages ? null : (
          <>
            {hasMore ? (
              <Button size="sm" className="mx-auto mb-3 shrink-0" onClick={loadOlder}>
                Messages précédents
              </Button>
            ) : (
              <div className="mt-auto pb-5 pt-8">
                <h2 className="font-display text-[30px] leading-tight">{isChannel ? `Bienvenue dans #${conversation.name}` : title}</h2>
                <p className="mt-1 max-w-[60ch] text-[13.5px] text-ink-3">
                  {isChannel ? conversation.topic || "C'est le tout début de ce canal." : other?.id === me.id ? "Écris-toi ici : c'est pratique pour garder un lien, un fichier ou une idée." : `C'est le début de ta conversation avec ${other?.name ?? "cette personne"}.`}
                </p>
              </div>
            )}
            {messages.map((m, i) => {
              const prev = messages[i - 1];
              const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
              const grouped = !newDay && prev.userId === m.userId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;
              const author = userById(m.userId);
              return (
                <Fragment key={m.id}>
                  {newDay && (
                    <div className="my-3 flex shrink-0 items-center gap-3 text-[11.5px] font-medium text-ink-3">
                      <span className="h-px flex-1 bg-line" />
                      <span className="first-letter:uppercase">{dayLabel(m.createdAt)}</span>
                      <span className="h-px flex-1 bg-line" />
                    </div>
                  )}
                  <div className={cn("group relative -mx-2 flex shrink-0 gap-3 rounded-lg px-2 py-0.5 hover:bg-ink/[0.03]", !grouped && "mt-2.5")}>
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
                      {m.body && <p className="whitespace-pre-wrap text-[14.5px] leading-[1.5] [overflow-wrap:anywhere]">{linkify(m.body)}</p>}
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
                    </div>
                    {(m.userId === me.id || me.role === "admin") && (
                      <button
                        onClick={() => remove(m)}
                        aria-label="Supprimer le message"
                        title="Supprimer"
                        className="press absolute -top-3 right-2 flex size-7 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-3 opacity-0 shadow-card hover:text-danger focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </>
        )}
      </div>

      <Composer
        conversationId={id}
        placeholder={isChannel ? `Écrire dans #${conversation.name}` : other?.id === me.id ? "Une note pour toi" : `Écrire à ${other?.name ?? ""}`}
        onSent={(m) => {
          stick.current = true;
          setMessages((list) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list));
        }}
      />
    </>
  );
}

/** Plain text, with web addresses turned into links. */
function linkify(text: string) {
  return text.split(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g).map((part, i) =>
    i % 2 ? (
      <a key={i} href={part} target="_blank" rel="noreferrer noopener" className="text-accent underline decoration-accent/40 underline-offset-[3px]">
        {part}
      </a>
    ) : (
      part
    ),
  );
}
