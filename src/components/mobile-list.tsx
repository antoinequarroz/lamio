"use client";

import { Hash, Lock, Plus, Search, SquarePen } from "lucide-react";
import Link from "next/link";
import { useApp } from "@/lib/store";
import type { Conversation } from "@/lib/types";
import { cn, shortWhen } from "@/lib/utils";
import { Avatar, primaryClass } from "./ui";

/**
 * The Messagerie on a phone, like Messages on iOS: a large title, a search field, then one row per
 * conversation with its newest message and when it came.
 */
export function MobileConversations() {
  const { conversations, userById, titleOf, me, setCommandOpen, setDialog } = useApp();
  const recent = (a: Conversation, b: Conversation) => (b.last?.at ?? "").localeCompare(a.last?.at ?? "");
  const channels = conversations.filter((c) => c.kind === "channel").sort(recent);
  const dms = conversations.filter((c) => c.kind === "dm").sort(recent);

  const preview = (c: Conversation) => {
    const l = c.last;
    if (!l) return c.kind === "channel" ? c.topic || "Aucun message pour l'instant" : "Aucun message pour l'instant";
    const text = l.call ? "Appel vidéo" : l.body.replace(/\s+/g, " ").trim() || (l.files ? (l.files > 1 ? `${l.files} fichiers` : "Un fichier") : "");
    const who = l.userId === me.id ? "Toi" : c.kind === "channel" ? userById(l.userId)?.name.split(" ")[0] : null;
    return who ? `${who} : ${text}` : text;
  };

  const row = (c: Conversation, icon: React.ReactNode, title: string) => {
    const unread = c.unread > 0;
    return (
      <Link key={c.id} href={`/c/${c.id}`} className="flex items-center gap-3 pl-4 active:bg-ink/[0.05]">
        {icon}
        <span className="flex min-w-0 flex-1 flex-col gap-0.5 border-b border-line py-2.5 pr-4">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-[16px]", unread ? "font-semibold text-ink" : "font-medium text-ink")}>{title}</span>
            {c.last && <span className={cn("tabular shrink-0 text-[13px]", unread ? "font-medium text-accent" : "text-ink-3")}>{shortWhen(c.last.at)}</span>}
          </span>
          <span className="flex items-center gap-2">
            <span className={cn("line-clamp-2 min-w-0 flex-1 text-[14px] leading-snug", unread ? "text-ink-2" : "text-ink-3")}>{preview(c)}</span>
            {unread && (
              <span className={cn("tabular shrink-0 rounded-full px-1.5 text-center text-[12px] leading-[20px] font-semibold min-w-[20px]", c.kind === "dm" || c.mentions ? "bg-accent text-accent-ink" : "bg-ink/[0.1] text-ink-2")}>
                {c.mentions > 0 && c.kind === "channel" && "@"}
                {c.kind === "channel" && c.mentions ? c.mentions : c.unread > 99 ? "99+" : c.unread}
              </span>
            )}
          </span>
        </span>
      </Link>
    );
  };

  const channelIcon = (c: Conversation) => (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent">
      {c.private ? <Lock className="size-[18px]" strokeWidth={2.2} /> : <Hash className="size-5" strokeWidth={2.2} />}
    </span>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="shrink-0 px-4 pt-2 pb-2">
        <div className="flex h-10 items-center justify-end gap-2">
          <button onClick={() => setDialog("dm")} aria-label="Nouveau message" className={cn("press flex size-9 items-center justify-center rounded-full", primaryClass)}>
            <SquarePen className="size-[17px]" strokeWidth={2.2} />
          </button>
        </div>
        <h1 className="font-display text-[34px] leading-none">Messages</h1>
        <button onClick={() => setCommandOpen(true)} className="mt-3 flex h-10 w-full items-center gap-2 rounded-xl bg-ink/[0.06] px-3 text-left text-[16px] text-ink-3">
          <Search className="size-[18px]" />
          Rechercher
        </button>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-3">
        <Section title="Canaux" onAdd={() => setDialog("channel")} addLabel="Créer un canal" />
        {channels.map((c) => row(c, channelIcon(c), c.name))}
        <Section title="Messages directs" onAdd={() => setDialog("dm")} addLabel="Nouveau message direct" />
        {dms.map((c) => {
          const other = userById(c.otherUserId);
          return row(c, <Avatar id={other?.id ?? c.id} name={other?.name ?? "?"} size="xl" />, other?.id === me.id ? `${me.name} (toi)` : titleOf(c));
        })}
        {!dms.length && <p className="px-4 py-3 text-[14px] text-ink-3">Aucune conversation privée pour l&apos;instant.</p>}
      </div>
    </div>
  );
}

function Section({ title, onAdd, addLabel }: { title: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex items-center justify-between px-4 pt-5 pb-1">
      <span className="text-[13px] font-semibold tracking-wide text-ink-3 uppercase">{title}</span>
      <button onClick={onAdd} aria-label={addLabel} className="press -mr-2 flex size-9 items-center justify-center rounded-full text-accent">
        <Plus className="size-5" strokeWidth={2.2} />
      </button>
    </div>
  );
}
