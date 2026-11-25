"use client";

import { ArrowLeft, Hash, Lock, Settings2, Users, X } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { Message } from "@/lib/types";
import { api, cn, dayLabel } from "@/lib/utils";
import { CallButton } from "./call";
import { Composer } from "./composer";
import { ChannelDialog } from "./dialogs";
import { MessageItem } from "./message";
import { Avatar, Button } from "./ui";

type Page = { messages: Message[]; hasMore: boolean };

const GROUP_MS = 5 * 60_000;

const replace = (list: Message[] | null, m: Message) => list?.map((x) => (x.id === m.id ? m : x)) ?? list;
const append = (list: Message[] | null, m: Message) => (list && !list.some((x) => x.id === m.id) ? [...list, m] : list);
const without = (list: Message[] | null, id: number) => list?.filter((x) => x.id !== id) ?? list;

const sameDay = (a: string, b: string) => new Date(a).toDateString() === new Date(b).toDateString();
const follows = (prev: Message | undefined, m: Message) => !!prev && sameDay(prev.createdAt, m.createdAt) && prev.userId === m.userId && new Date(m.createdAt).getTime() - new Date(prev.createdAt).getTime() < GROUP_MS;

export function ConversationView({ id }: { id: string }) {
  const { conversations, userById, titleOf, users, me, setActive, markRead, listen } = useApp();
  const conversation = conversations.find((c) => c.id === id);
  const [messages, setMessages] = useState<Message[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState("");
  /** The thread open in the side panel: the id of the message that started it. */
  const [threadId, setThreadId] = useState<number | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Coming from a search result or a notification: ?m= is the message to show, ?t= its thread if it is a reply.
  const params = useSearchParams();
  const target = Number(params.get("m")) || null;
  const targetThread = Number(params.get("t")) || null;
  const reached = useRef<number | null>(null);
  const tries = useRef(0);
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
    setThreadId(null);
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
        else if (event.type === "message" && event.message.conversationId === id) {
          // Replies live in their thread; the message that started it gets its own update.
          if (!event.message.parentId) setMessages((list) => append(list, event.message));
        } else if (event.type === "message-updated" && event.message.conversationId === id) setMessages((list) => replace(list, event.message));
        else if (event.type === "message-deleted" && event.conversationId === id) {
          setMessages((list) => without(list, event.id));
          setThreadId((open) => (open === event.id ? null : open));
        }
      }),
    [id, listen, load],
  );

  // Reading: whatever is on screen while the tab is visible counts as read. Replies count too,
  // so the newest id comes from the conversation, not only from the messages listed here.
  const lastId = Math.max(messages?.at(-1)?.id ?? 0, conversation?.lastMessageId ?? 0);
  const ready = messages !== null;
  useEffect(() => {
    if (!ready) return;
    const read = () => !document.hidden && markRead(id, lastId);
    read();
    document.addEventListener("visibilitychange", read);
    return () => document.removeEventListener("visibilitychange", read);
  }, [id, lastId, ready, markRead]);

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

  // Stable, so the thread panel does not reload each time this view renders.
  const closeThread = useCallback(() => setThreadId(null), []);
  const parentChanged = useCallback((m: Message) => setMessages((list) => replace(list, m)), []);

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

  useEffect(() => {
    if (!target || !messages || reached.current === target) return;
    if (targetThread) {
      reached.current = target;
      return setThreadId(targetThread);
    }
    if (messages.some((m) => m.id === target)) {
      reached.current = target;
      stick.current = false;
      requestAnimationFrame(() => flash(scroller.current, target));
    } else if (hasMore && tries.current < 20) {
      // Older than what is loaded: go back page by page until it shows up.
      tries.current++;
      loadOlder();
    } else reached.current = target;
    // loadOlder changes with every page, and each new page reruns this effect through `messages`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, targetThread, messages, hasMore]);

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
  const count = conversation.private ? (conversation.memberIds?.length ?? 0) : users.length;
  const people = `${count} ${count > 1 ? "membres" : "membre"}`;
  const subtitle = isChannel ? conversation.topic || (conversation.private ? "Canal privé" : people) : other?.id === me.id ? "Ton espace à toi : notes, liens, fichiers" : (other?.email ?? "");
  const ChannelIcon = conversation.private ? Lock : Hash;

  return (
    <div className="flex min-h-0 flex-1">
      <section className={cn("flex min-w-0 flex-1 flex-col", threadId !== null && "max-lg:hidden")}>
        <header className="flex items-center gap-3 border-b border-line px-7 py-4 max-md:px-3 max-md:py-2.5">
          <Link href="/c" aria-label="Retour" className="-ml-1 flex size-9 items-center justify-center rounded-lg text-ink-2 md:hidden">
            <ArrowLeft className="size-[18px]" />
          </Link>
          {isChannel ? (
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent max-md:hidden">
              <ChannelIcon className="size-[18px]" strokeWidth={2.2} />
            </span>
          ) : (
            <Avatar id={other?.id ?? id} name={other?.name ?? "?"} size="lg" />
          )}
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-[24px] leading-none">{isChannel ? conversation.name : title}</h1>
            <p className="mt-1 truncate text-[12.5px] text-ink-3">{subtitle}</p>
          </div>
          <CallButton conversationId={id} />
          {isChannel && (conversation.private || conversation.canManage) && (
            <Button size="sm" onClick={() => setSettingsOpen(true)} aria-label={conversation.private ? `Réglages du canal, ${people}` : "Réglages du canal"}>
              {conversation.private ? <Users className="size-3.5" /> : <Settings2 className="size-3.5" />}
              {conversation.private ? count : "Réglages"}
            </Button>
          )}
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
                    {isChannel
                      ? conversation.topic || (conversation.private ? "Ce canal est privé : seuls ses membres le voient." : "C'est le tout début de ce canal.")
                      : other?.id === me.id
                        ? "Écris-toi ici : c'est pratique pour garder un lien, un fichier ou une idée."
                        : `C'est le début de ta conversation avec ${other?.name ?? "cette personne"}.`}
                  </p>
                </div>
              )}
              {messages.map((m, i) => {
                const prev = messages[i - 1];
                return (
                  <Fragment key={m.id}>
                    {(!prev || !sameDay(prev.createdAt, m.createdAt)) && (
                      <div className="my-3 flex shrink-0 items-center gap-3 text-[11.5px] font-medium text-ink-3">
                        <span className="h-px flex-1 bg-line" />
                        <span className="first-letter:uppercase">{dayLabel(m.createdAt)}</span>
                        <span className="h-px flex-1 bg-line" />
                      </div>
                    )}
                    <MessageItem
                      message={m}
                      grouped={follows(prev, m)}
                      onOpenThread={(x) => setThreadId(x.id)}
                      onChange={(x) => setMessages((list) => replace(list, x))}
                      onRemove={(x) => {
                        setMessages((list) => without(list, x.id));
                        setThreadId((open) => (open === x.id ? null : open));
                      }}
                    />
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
            setMessages((list) => append(list, m));
          }}
        />
      </section>

      {threadId !== null && <ThreadPanel key={threadId} conversationId={id} parentId={threadId} where={isChannel ? `#${conversation.name}` : title} onClose={closeThread} onParentChange={parentChanged} highlightId={targetThread === threadId ? target : null} />}
      {settingsOpen && isChannel && <ChannelDialog key={conversation.id} conversation={conversation} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

/** Scrolls to a message and lights it up for a moment. */
function flash(container: HTMLElement | null, messageId: number) {
  const el = container?.querySelector(`[data-message="${messageId}"]`);
  if (!el) return;
  el.scrollIntoView({ block: "center" });
  el.classList.remove("flash");
  void (el as HTMLElement).offsetWidth;
  el.classList.add("flash");
}

type ThreadProps = { conversationId: string; parentId: number; where: string; onClose: () => void; onParentChange: (m: Message) => void; highlightId?: number | null };

/** A thread: the message that started it, then its replies. Beside the conversation, or instead of it on a small screen. */
function ThreadPanel({ conversationId, parentId, where, onClose, onParentChange, highlightId }: ThreadProps) {
  const { listen } = useApp();
  const [parent, setParent] = useState<Message | null>(null);
  const [replies, setReplies] = useState<Message[] | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  const load = useCallback(async () => {
    try {
      const thread = await api<{ parent: Message; replies: Message[] }>(`/api/messages/${parentId}/thread`);
      setParent(thread.parent);
      setReplies(thread.replies);
    } catch (e) {
      toast.error((e as Error).message);
      onClose();
    }
  }, [parentId, onClose]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(
    () =>
      listen((event) => {
        if (event.type === "resync") load();
        else if (event.type === "message" && event.message.parentId === parentId) setReplies((list) => append(list, event.message));
        else if (event.type === "message-updated") {
          if (event.message.id === parentId) setParent(event.message);
          else if (event.message.parentId === parentId) setReplies((list) => replace(list, event.message));
        } else if (event.type === "message-deleted" && event.parentId === parentId) setReplies((list) => without(list, event.id));
      }),
    [parentId, listen, load],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !(e.target as HTMLElement).closest("textarea, input") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [replies]);

  const loaded = replies !== null;
  useEffect(() => {
    if (!loaded || !highlightId) return;
    stick.current = false;
    requestAnimationFrame(() => flash(scroller.current, highlightId));
  }, [loaded, highlightId]);

  const changed = (m: Message) => {
    if (m.id === parentId) {
      setParent(m);
      onParentChange(m);
    } else setReplies((list) => replace(list, m));
  };

  return (
    <aside aria-label="Fil de réponses" className="flex w-[400px] shrink-0 flex-col border-l border-line bg-surface/50 max-lg:w-auto max-lg:flex-1 max-lg:border-l-0">
      <header className="flex items-center gap-2 border-b border-line py-4 pr-3 pl-5 max-md:py-2.5 max-md:pl-3">
        <button onClick={onClose} aria-label="Retour à la conversation" className="-ml-1 flex size-9 items-center justify-center rounded-lg text-ink-2 lg:hidden">
          <ArrowLeft className="size-[18px]" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[24px] leading-none">Fil</h2>
          <p className="mt-1 truncate text-[12.5px] text-ink-3">{where}</p>
        </div>
        <button onClick={onClose} aria-label="Fermer le fil" className="press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/5 hover:text-ink max-lg:hidden">
          <X className="size-4" />
        </button>
      </header>

      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
        }}
        className="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-4 max-md:px-3"
      >
        {parent && replies && (
          <>
            <MessageItem message={parent} inThread onChange={changed} onRemove={onClose} />
            <div className="my-3 flex shrink-0 items-center gap-3 text-[11.5px] font-medium text-ink-3">
              <span>{replies.length ? `${replies.length} ${replies.length > 1 ? "réponses" : "réponse"}` : "Pas encore de réponse"}</span>
              <span className="h-px flex-1 bg-line" />
            </div>
            {replies.map((m, i) => (
              <MessageItem key={m.id} message={m} grouped={follows(replies[i - 1], m)} inThread onChange={changed} onRemove={(x) => setReplies((list) => without(list, x.id))} />
            ))}
          </>
        )}
      </div>

      <Composer
        conversationId={conversationId}
        parentId={parentId}
        compact
        placeholder="Répondre dans le fil"
        onSent={(m) => {
          stick.current = true;
          setReplies((list) => append(list, m));
        }}
      />
    </aside>
  );
}
