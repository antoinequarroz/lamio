"use client";

import { Command } from "cmdk";
import { Hash, LayoutGrid, Lock, Mail, MessageSquareText, Plus, Settings, SquarePen, User } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useApp } from "@/lib/store";
import type { MailSummary, SearchHit } from "@/lib/types";
import { api, clock, dayLabel } from "@/lib/utils";

export function CommandMenu() {
  const { conversations, users, me, commandOpen: open, setCommandOpen: setOpen, setDialog, reload, userById, titleOf } = useApp();
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [mails, setMails] = useState<MailSummary[]>([]);

  // Messages are searched on the server, a moment after typing stops.
  useEffect(() => {
    const q = query.trim();
    if (!open || q.length < 2) {
      setHits([]);
      setMails([]);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api<{ hits: SearchHit[] }>(`/api/search?q=${encodeURIComponent(q)}`).then(
        (r) => current && setHits(r.hits),
        () => {},
      );
      // The mails too, from the local copy of the mailbox (the Mails tab searches the server as well).
      api<{ messages: MailSummary[] }>(`/api/mail/search?q=${encodeURIComponent(q)}&limit=5`).then(
        (r) => current && setMails(r.messages),
        () => {},
      );
    }, 180);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, open]);

  useEffect(() => {
    if (!open) setQuery("");
  }, [open]);

  const run = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  const openDm = async (userId: string) => {
    const { id } = await api<{ id: string }>("/api/conversations", { method: "POST", json: { kind: "dm", userId } });
    await reload();
    router.push(`/c/${id}`);
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Recherche"
      overlayClassName="fixed inset-0 z-40 bg-[rgba(15,14,12,0.3)] backdrop-blur-[2px]"
      contentClassName="fixed top-[16vh] left-1/2 z-50 w-[min(600px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-2xl border border-line-strong bg-surface shadow-[0_30px_80px_-20px_rgba(0,0,0,0.45)] max-md:top-[calc(env(safe-area-inset-top)+8px)] max-md:w-[calc(100vw-16px)]"
    >
      <Command.Input value={query} onValueChange={setQuery} placeholder="Chercher un message, un canal, une personne…" className="h-12 w-full border-b border-line bg-transparent px-4 text-[14.5px] outline-none placeholder:text-ink-3 max-md:text-[16px]" />
      <Command.List className="scroll-thin max-h-[380px] overflow-y-auto p-2 max-md:max-h-[55dvh] [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:pt-2 [&_[cmdk-group-heading]]:pb-1 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-ink-3">
        {/* The menu only counts its own matches: with messages found by the server, it is not empty. */}
        {!hits.length && !mails.length && <Command.Empty className="py-10 text-center text-[13px] text-ink-3">Aucun résultat.</Command.Empty>}
        <Command.Group heading="Canaux">
          {conversations
            .filter((c) => c.kind === "channel")
            .map((c) => (
              <Item key={c.id} value={`canal ${c.name} ${c.topic} ${c.id}`} onSelect={() => run(() => router.push(`/c/${c.id}`))} icon={c.private ? <Lock className="size-4" /> : <Hash className="size-4" />}>
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                {c.topic && <span className="max-w-[45%] shrink-0 truncate text-[11.5px] text-ink-3">{c.topic}</span>}
              </Item>
            ))}
        </Command.Group>
        <Command.Group heading="Personnes">
          {users.map((u) => (
            <Item key={u.id} value={`personne ${u.name} ${u.email} ${u.id}`} onSelect={() => run(() => openDm(u.id))} icon={<User className="size-4" />}>
              <span className="min-w-0 flex-1 truncate">{u.id === me.id ? `${u.name} (toi)` : u.name}</span>
              <span className="shrink-0 text-[11.5px] text-ink-3">{u.email}</span>
            </Item>
          ))}
        </Command.Group>
        {hits.length > 0 && (
          <Command.Group heading="Messages" forceMount>
            {hits.map((h) => {
              const conversation = conversations.find((c) => c.id === h.conversationId);
              return (
                // forceMount: the server already matched these, the menu's own filter must not hide them.
                <Command.Item
                  key={h.id}
                  forceMount
                  value={`message-${h.id}`}
                  onSelect={() => run(() => router.push(`/c/${h.conversationId}?m=${h.id}${h.parentId ? `&t=${h.parentId}` : ""}`))}
                  className="flex cursor-default items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink"
                >
                  <MessageSquareText className="mt-0.5 size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-1.5 text-[11.5px] text-ink-3">
                      <span className="truncate font-medium text-ink-2">{userById(h.userId)?.name ?? "Ancien membre"}</span>
                      <span className="truncate">{conversation ? titleOf(conversation) : ""}</span>
                      <span className="ml-auto shrink-0 first-letter:uppercase">
                        {dayLabel(h.createdAt)}, {clock(h.createdAt)}
                      </span>
                    </span>
                    <span className="line-clamp-2 [overflow-wrap:anywhere]">{h.body}</span>
                  </span>
                </Command.Item>
              );
            })}
          </Command.Group>
        )}
        {mails.length > 0 && (
          <Command.Group heading="Mails" forceMount>
            {mails.map((m) => (
              <Command.Item
                key={`${m.folder}|${m.uid}`}
                forceMount
                value={`mail-${m.folder}-${m.uid}`}
                onSelect={() => run(() => router.push(`/mail?${new URLSearchParams({ ...(m.folder !== "INBOX" && { f: m.folder }), m: String(m.uid) })}`))}
                className="flex cursor-default items-start gap-2.5 rounded-lg px-2 py-1.5 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink"
              >
                <Mail className="mt-0.5 size-4 shrink-0 text-ink-3" />
                <span className="min-w-0 flex-1">
                  <span className="flex items-baseline gap-1.5 text-[11.5px] text-ink-3">
                    <span className="truncate font-medium text-ink-2">{m.from.name || m.from.address}</span>
                    <span className="ml-auto shrink-0 first-letter:uppercase">
                      {dayLabel(m.date)}, {clock(m.date)}
                    </span>
                  </span>
                  <span className="block truncate">{m.subject || "(sans objet)"}</span>
                </span>
              </Command.Item>
            ))}
          </Command.Group>
        )}
        <Command.Group heading="Actions">
          <Item onSelect={() => run(() => setDialog("dm"))} icon={<SquarePen className="size-4" />}>
            Nouveau message
          </Item>
          <Item onSelect={() => run(() => setDialog("channel"))} icon={<Plus className="size-4" />}>
            Créer un canal
          </Item>
          <Item onSelect={() => run(() => router.push("/mail"))} icon={<Mail className="size-4" />}>
            Mails
          </Item>
          <Item onSelect={() => run(() => router.push("/modules"))} icon={<LayoutGrid className="size-4" />}>
            Modules
          </Item>
          <Item onSelect={() => run(() => router.push("/settings"))} icon={<Settings className="size-4" />}>
            Réglages
          </Item>
        </Command.Group>
      </Command.List>
    </Command.Dialog>
  );
}

function Item({ children, icon, onSelect, value }: { children: React.ReactNode; icon: React.ReactNode; onSelect: () => void; value?: string }) {
  return (
    <Command.Item value={value} onSelect={onSelect} className="flex h-9 cursor-default items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 data-[selected=true]:bg-ink/[0.05] data-[selected=true]:text-ink">
      <span className="text-ink-3">{icon}</span>
      {children}
    </Command.Item>
  );
}
