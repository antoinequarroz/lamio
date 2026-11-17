"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { AppState, Conversation, ServerEvent, User } from "./types";
import { api, APP_NAME } from "./utils";

/** What a conversation view hears: server events, plus "resync" after the connection came back. */
export type LiveEvent = ServerEvent | { type: "resync" };

type Store = AppState & {
  loaded: boolean;
  error: string;
  userById: (id: string | undefined) => User | undefined;
  /** Display name of a conversation: "#canal" or the other person's name. */
  titleOf: (c: Conversation) => string;
  reload: () => Promise<void>;
  /** The conversation on screen: its messages are read as they arrive. */
  setActive: (id: string | null) => void;
  markRead: (id: string, messageId: number) => void;
  /** Is this conversation on screen, in a visible tab, right now? */
  isReading: (id: string) => boolean;
  listen: (fn: (event: LiveEvent) => void) => () => void;
  commandOpen: boolean;
  setCommandOpen: (open: boolean) => void;
  dialog: "channel" | "dm" | null;
  setDialog: (dialog: "channel" | "dm" | null) => void;
};

const Ctx = createContext<Store | null>(null);

export function useApp() {
  const store = useContext(Ctx);
  if (!store) throw new Error("useApp hors de AppProvider");
  return store;
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState | null>(null);
  const [error, setError] = useState("");
  const [commandOpen, setCommandOpen] = useState(false);
  const [dialog, setDialog] = useState<Store["dialog"]>(null);
  const active = useRef<string | null>(null);
  const meId = useRef("");
  const known = useRef(new Set<string>());
  const listeners = useRef(new Set<(event: LiveEvent) => void>());

  const reload = useCallback(async () => {
    try {
      const next = await api<AppState>("/api/state");
      meId.current = next.me.id;
      known.current = new Set(next.conversations.map((c) => c.id));
      // The conversation on screen is being read: its counter stays at zero.
      setState({ ...next, conversations: next.conversations.map((c) => (c.id === active.current && !document.hidden ? { ...c, unread: 0, mentions: 0 } : c)) });
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    reload();
    let source: EventSource | null = null;
    let dropped = false;
    const connect = () => {
      source = new EventSource("/api/events");
      source.onopen = () => {
        if (!dropped) return;
        // Events were missed while offline: reload everything.
        dropped = false;
        reload();
        listeners.current.forEach((fn) => fn({ type: "resync" }));
      };
      source.onerror = () => {
        dropped = true;
      };
      source.onmessage = (e) => {
        const event = JSON.parse(e.data) as ServerEvent;
        if (event.type === "refresh") return void reload();
        // The counters of the projects (sidebar, list, search) follow every change.
        if (event.type === "project") void reload();
        if (event.type === "message") {
          const { conversationId, id, userId, mentionIds } = event.message;
          const reading = conversationId === active.current && !document.hidden;
          const counts = !reading && userId !== meId.current;
          const mentioned = counts && mentionIds.includes(meId.current);
          // A direct message from someone new: the conversation is not in the list yet.
          if (!known.current.has(conversationId)) void reload();
          setState((s) => s && { ...s, conversations: s.conversations.map((c) => (c.id === conversationId ? { ...c, lastMessageId: Math.max(c.lastMessageId, id), unread: counts ? c.unread + 1 : c.unread, mentions: mentioned ? c.mentions + 1 : c.mentions } : c)) });
        }
        listeners.current.forEach((fn) => fn(event));
      };
    };
    connect();
    return () => source?.close();
  }, [reload]);

  const markRead = useCallback((id: string, messageId: number) => {
    setState((s) => (s && s.conversations.some((c) => c.id === id && (c.unread || c.mentions)) ? { ...s, conversations: s.conversations.map((c) => (c.id === id ? { ...c, unread: 0, mentions: 0 } : c)) } : s));
    if (messageId > 0) api(`/api/conversations/${id}/read`, { method: "POST", json: { messageId } }).catch(() => {});
  }, []);

  const setActive = useCallback((id: string | null) => {
    active.current = id;
  }, []);

  const isReading = useCallback((id: string) => id === active.current && !document.hidden, []);

  const listen = useCallback((fn: (event: LiveEvent) => void) => {
    listeners.current.add(fn);
    return () => void listeners.current.delete(fn);
  }, []);

  const unread = state?.conversations.reduce((n, c) => n + c.unread, 0) ?? 0;
  useEffect(() => {
    document.title = unread ? `(${unread}) ${APP_NAME}` : APP_NAME;
  }, [unread]);

  const store = useMemo<Store | null>(() => {
    if (!state) return null;
    const byId = new Map(state.users.map((u) => [u.id, u]));
    const userById = (id: string | undefined) => (id ? byId.get(id) : undefined);
    return {
      ...state,
      loaded: true,
      error,
      userById,
      titleOf: (c) => (c.kind === "channel" ? `#${c.name}` : c.otherUserId === state.me.id ? `${state.me.name} (toi)` : (userById(c.otherUserId)?.name ?? "Ancien membre")),
      reload,
      setActive,
      markRead,
      isReading,
      listen,
      commandOpen,
      setCommandOpen,
      dialog,
      setDialog,
    };
  }, [state, error, reload, setActive, markRead, isReading, listen, commandOpen, dialog]);

  if (!store) {
    return error ? (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 p-8 text-center">
        <p className="text-[15px] font-medium">Impossible de charger {APP_NAME}</p>
        <p className="text-[13px] text-ink-3">{error}</p>
      </div>
    ) : (
      <div className="h-dvh" />
    );
  }
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
