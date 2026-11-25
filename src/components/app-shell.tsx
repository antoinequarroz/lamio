"use client";

import { ArrowUpRight, CalendarDays, Hash, LayoutGrid, Lock, Mail, MessagesSquare, PanelLeftClose, PanelLeftOpen, Plus, Search, Settings, SquarePen } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import { toast, Toaster } from "sonner";
import { registerIosPush } from "@/lib/ios-push";
import { deviceNotify } from "@/lib/notifications";
import { AppProvider, useApp } from "@/lib/store";
import { useStored } from "@/lib/use-stored";
import type { Conversation } from "@/lib/types";
import { APP_VERSION } from "@/lib/brand";
import { APP_NAME, cn, moduleLink } from "@/lib/utils";
import { CallWindow } from "./call";
import { CommandMenu } from "./command-menu";
import { NewChannelDialog, NewDmDialog } from "./dialogs";
import { ResizeHandle } from "./resize-handle";
import { Logo } from "./logo";
import { ModulePicto } from "./module-icon";
import { Avatar, Kbd, primaryClass } from "./ui";

const NAV = [
  { href: "/c", label: "Messagerie", Icon: MessagesSquare },
  { href: "/mail", label: "Mails", Icon: Mail },
  { href: "/calendar", label: "Calendrier", Icon: CalendarDays },
  { href: "/modules", label: "Modules", Icon: LayoutGrid },
  { href: "/settings", label: "Réglages", Icon: Settings },
];

/** The tabs I see: the Calendrier only when Alfred is plugged in and open to me. */
const useNav = () => {
  const { calendar } = useApp();
  return NAV.filter((n) => n.href !== "/calendar" || calendar);
};

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppProvider>
      <Shell>{children}</Shell>
    </AppProvider>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  const { commandOpen, setCommandOpen, dialog, setDialog } = useApp();
  // The sidebar's width, or folded into a narrow rail of icons (⌘\ or the button).
  const [side, setSide] = useStored("app-sidebar", SIDEBAR, (v): v is typeof SIDEBAR => !!v && typeof (v as typeof SIDEBAR).width === "number");

  // The iPhone app's push token, registered under this account.
  useEffect(() => registerIosPush(), []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setCommandOpen(!commandOpen);
      } else if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        setSide((s) => ({ ...s, collapsed: !s.collapsed }));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commandOpen, setCommandOpen, setSide]);

  return (
    <div className="flex h-dvh min-h-0">
      {side.collapsed ? (
        <aside className="flex w-[60px] shrink-0 flex-col items-center gap-1 py-3 max-md:hidden">
          <Rail onExpand={() => setSide({ ...side, collapsed: false })} />
        </aside>
      ) : (
        <>
          <aside style={{ width: side.width }} className="flex shrink-0 flex-col gap-1 px-3 py-3 max-md:hidden">
            <Sidebar onCollapse={() => setSide({ ...side, collapsed: true })} />
          </aside>
          <ResizeHandle label="Largeur de la barre latérale" className="after:bg-transparent" width={side.width} min={208} max={380} onChange={(w) => setSide({ ...side, width: w })} onReset={() => setSide({ ...side, width: SIDEBAR.width })} />
        </>
      )}
      <main className="flex min-w-0 flex-1 flex-col p-2 pl-0 max-md:p-0">
        <MobileBar />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-line bg-surface/70 shadow-card backdrop-blur-xl max-md:rounded-none max-md:border-0">{children}</div>
      </main>
      <CommandMenu />
      <Notifier />
      <CallWindow />
      {dialog === "channel" && <NewChannelDialog onClose={() => setDialog(null)} />}
      {dialog === "dm" && <NewDmDialog onClose={() => setDialog(null)} />}
      <Toaster
        position="bottom-right"
        // On the iPhone the page runs under the notch and the home bar: keep toasts clear of them.
        offset={{ top: "calc(24px + env(safe-area-inset-top))", right: "calc(24px + env(safe-area-inset-right))", bottom: "calc(24px + env(safe-area-inset-bottom))", left: "calc(24px + env(safe-area-inset-left))" }}
        mobileOffset={{ top: "calc(16px + env(safe-area-inset-top))", right: "calc(16px + env(safe-area-inset-right))", bottom: "calc(16px + env(safe-area-inset-bottom))", left: "calc(16px + env(safe-area-inset-left))" }}
        toastOptions={{ className: "!rounded-xl !border-line-strong !bg-surface !text-ink !shadow-card !font-sans", classNames: { description: "!text-ink-2", actionButton: "!bg-ink !text-bg !rounded-md !font-medium" } }} />
    </div>
  );
}

const SIDEBAR = { width: 248, collapsed: false };

/** The folded sidebar: the sections as icons, with a dot when something is unread. */
function Rail({ onExpand }: { onExpand: () => void }) {
  const pathname = usePathname();
  const { me, conversations, mail, setCommandOpen, setDialog } = useApp();
  const unread = conversations.reduce((n, c) => n + c.unread, 0);
  const nav = useNav();
  const button = "press relative flex size-10 items-center justify-center rounded-lg";
  return (
    <>
      <button onClick={onExpand} aria-label="Déplier la barre latérale (⌘\)" title="Déplier la barre latérale (⌘\)" className={cn(button, "mb-2")}>
        <Logo />
      </button>
      <button onClick={() => setDialog("dm")} aria-label="Nouveau message" title="Nouveau message" className={cn(button, primaryClass)}>
        <SquarePen className="size-4" strokeWidth={2.2} />
      </button>
      <button onClick={() => setCommandOpen(true)} aria-label="Rechercher" title="Rechercher (⌘K)" className={cn(button, "mb-2 text-ink-2 hover:bg-ink/[0.05] hover:text-ink")}>
        <Search className="size-4" />
      </button>
      {nav.map(({ href, label, Icon }) => {
        const active = pathname.startsWith(href);
        const dot = (href === "/c" && unread > 0) || (href === "/mail" && !!mail?.unread);
        return (
          <Link key={href} href={href} aria-label={label} title={label} className={cn(button, active ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink")}>
            <Icon className={cn("size-[18px]", active ? "text-accent" : "text-ink-3")} />
            {dot && <span className="absolute top-2 right-2 size-2 rounded-full bg-accent ring-2 ring-bg" />}
          </Link>
        );
      })}
      <span className="flex-1" />
      <button onClick={onExpand} aria-label="Déplier la barre latérale" title="Déplier la barre latérale (⌘\)" className={cn(button, "text-ink-3 hover:bg-ink/[0.05] hover:text-ink")}>
        <PanelLeftOpen className="size-4" />
      </button>
      <Link href="/settings" aria-label={me.name} title={me.name} className="mt-1">
        <Avatar id={me.id} name={me.name} size="sm" />
      </Link>
    </>
  );
}

function Sidebar({ onCollapse }: { onCollapse: () => void }) {
  const pathname = usePathname();
  const { me, conversations, modules, mail, setCommandOpen, setDialog } = useApp();
  const unread = conversations.reduce((n, c) => n + c.unread, 0);
  const mine = conversations.reduce((n, c) => n + forMe(c), 0);
  const linked = modules.filter((m) => m.status === "linked" && moduleLink(m));
  const nav = useNav();

  return (
    <>
      <div className="flex items-center gap-2 px-1.5 pb-3">
        <Logo />
        <span className="text-[15px] font-semibold tracking-[-0.01em]">{APP_NAME}</span>
        <span className="ml-auto rounded-md border border-line px-1.5 py-px font-mono text-[10px] text-ink-3">v{APP_VERSION}</span>
        <button onClick={onCollapse} aria-label="Replier la barre latérale" title="Replier la barre latérale (⌘\)" className="press -mr-1 flex size-7 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
          <PanelLeftClose className="size-4" />
        </button>
      </div>

      <div className="mb-2 flex gap-1.5">
        <button onClick={() => setDialog("dm")} className={cn("press flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-medium", primaryClass)}>
          <SquarePen className="size-4" strokeWidth={2.2} />
          Nouveau message
        </button>
        <button onClick={() => setCommandOpen(true)} aria-label="Rechercher" className="press flex size-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-ink-2 shadow-card hover:text-ink">
          <Search className="size-4" />
        </button>
      </div>

      <nav className="flex flex-col gap-px">
        {nav.map(({ href, label, Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn("flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors duration-150", active ? "bg-surface font-medium text-ink shadow-card" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink")}
            >
              <Icon className={cn("size-4", active ? "text-accent" : "text-ink-3")} strokeWidth={2} />
              {label}
              {href === "/c" && unread > 0 && <Badge n={mine || unread} strong={mine > 0} />}
              {href === "/mail" && !!mail?.unread && <Badge n={mail.unread} />}
            </Link>
          );
        })}
      </nav>

      <div className="scroll-thin -mx-1 mt-3 flex min-h-0 flex-1 flex-col overflow-y-auto px-1">
        <ConversationList />
        {linked.length > 0 && (
          <>
            <SectionTitle>Suite</SectionTitle>
            {linked.map((m) => (
              <a key={m.id} href={moduleLink(m)} target="_blank" rel="noreferrer" className="group flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-[13.5px] text-ink-2 transition-colors duration-150 hover:bg-ink/[0.04] hover:text-ink">
                <ModulePicto icon={m.icon} className="size-[18px]" />
                {m.name}
                <ArrowUpRight className="ml-auto size-3.5 text-ink-3 opacity-0 transition-opacity group-hover:opacity-100" />
              </a>
            ))}
          </>
        )}
      </div>

      <div className="mt-2 flex flex-col gap-1.5 rounded-xl border border-line bg-surface/60 p-2.5">
        <Link href="/settings" className="flex items-center gap-2 text-[12.5px]">
          <Avatar id={me.id} name={me.name} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="block truncate font-medium leading-tight">{me.name}</span>
            <span className="block truncate text-[11px] leading-tight text-ink-3">{me.role === "admin" ? "Administrateur" : "Membre"}</span>
          </span>
          <span className="size-1.5 shrink-0 rounded-full bg-ok shadow-[0_0_0_3px_color-mix(in_oklab,var(--ok)_18%,transparent)]" aria-label="En ligne" />
        </Link>
        <div className="mt-1 flex items-center gap-1.5 text-[11px] text-ink-3">
          <Kbd>⌘</Kbd>
          <Kbd>K</Kbd>
          <span>pour tout trouver</span>
        </div>
      </div>
    </>
  );
}

function SectionTitle({ children, onAdd, addLabel }: { children: React.ReactNode; onAdd?: () => void; addLabel?: string }) {
  return (
    <div className="mt-4 flex shrink-0 items-center justify-between px-2 pb-1.5 first:mt-1">
      <span className="text-[11px] font-medium tracking-wide text-ink-3 uppercase">{children}</span>
      {onAdd && (
        <button onClick={onAdd} aria-label={addLabel} title={addLabel} className="press -mr-1 flex size-5 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.06] hover:text-ink">
          <Plus className="size-3.5" strokeWidth={2.4} />
        </button>
      )}
    </div>
  );
}

/** Unread counter. `strong` (accent colour) when it is for me: a mention, or a direct message. */
function Badge({ n, strong, mention }: { n: number; strong?: boolean; mention?: boolean }) {
  return (
    <span className={cn("tabular ml-auto rounded-full px-1.5 text-[10.5px] leading-[17px] font-semibold", strong ? "bg-accent text-accent-ink" : "bg-ink/[0.09] text-ink-2")}>
      {mention && "@"}
      {n > 99 ? "99+" : n}
    </span>
  );
}

/** What is waiting for me personally in a conversation: its mentions, or every message of a direct one. */
const forMe = (c: Conversation) => (c.kind === "dm" ? c.unread : c.mentions);

/** Tells me about a mention or a direct message that arrives while I am looking elsewhere. */
function Notifier() {
  const router = useRouter();
  const { listen, isReading, conversations, userById, titleOf, me, joinCall } = useApp();
  const latest = useRef({ conversations, userById, titleOf });
  latest.current = { conversations, userById, titleOf };
  const pathname = useRef("");
  pathname.current = usePathname();

  useEffect(
    () =>
      listen((event) => {
        if (event.type === "mail" && event.reminder) {
          // Something held by the server: a mail nobody answered, a scheduled send that left.
          const r = event.reminder;
          const open = r.uid ? () => router.push(`/mail?${new URLSearchParams({ ...(r.folder && r.folder !== "INBOX" ? { f: r.folder } : {}), m: String(r.uid) })}`) : undefined;
          if (document.hidden) deviceNotify(r.title, r.body, `reminder${r.uid ?? r.title}`, open ?? (() => router.push("/mail")));
          else toast(r.title, { description: r.body, icon: <Mail className="size-4" />, duration: 10_000, action: open ? { label: "Ouvrir", onClick: open } : undefined });
          return;
        }
        if (event.type === "mail") {
          // A new mail worth telling (the server applied the choice made in Réglages › Mails).
          const alert = event.alert ?? [];
          if (!alert.length || (pathname.current === "/mail" && !document.hidden)) return;
          const many = alert.length > 1;
          const title = many ? `${alert.length} nouveaux mails` : alert[0].from.name || alert[0].from.address;
          const text = many ? alert.map((a) => a.from.name || a.from.address).join(", ") : alert[0].subject || "(sans objet)";
          const open = () => router.push(many ? "/mail" : `/mail?m=${alert[0].uid}`);
          if (document.hidden) deviceNotify(title, text, many ? "mail" : `mail${alert[0].uid}`, open);
          else toast(title, { description: text, icon: <Mail className="size-4" />, action: { label: "Ouvrir", onClick: open } });
          return;
        }
        if (event.type !== "message") return;
        const m = event.message;
        const conversation = latest.current.conversations.find((c) => c.id === m.conversationId);
        // A call started by someone else, in a conversation I am in: an invitation to join.
        if (m.call && m.userId !== me.id) {
          const author = latest.current.userById(m.userId)?.name ?? "Quelqu'un";
          const where = conversation ? latest.current.titleOf(conversation) : "";
          const join = () => void joinCall(m.call!.slug, m.call!.title);
          if (document.hidden) deviceNotify(`${author} t'appelle`, where, `call${m.id}`, join);
          else toast(`${author} lance un appel`, { id: `call:${m.call.slug}`, description: where, duration: 30_000, action: { label: "Rejoindre", onClick: join } });
          return;
        }
        // Not in my list yet: the first message of a new direct conversation.
        const direct = !conversation || conversation.kind === "dm";
        if (m.userId === me.id || isReading(m.conversationId) || !(direct || m.mentionIds.includes(me.id))) return;

        const author = latest.current.userById(m.userId)?.name ?? "Quelqu'un";
        const title = direct || !conversation ? author : `${author} dans ${latest.current.titleOf(conversation)}`;
        const text = m.body || (m.files.length ? "A envoyé un fichier" : "");
        const open = () => router.push(`/c/${m.conversationId}?m=${m.id}${m.parentId ? `&t=${m.parentId}` : ""}`);
        if (document.hidden) deviceNotify(title, text, `m${m.id}`, open);
        else toast(title, { description: text.length > 140 ? `${text.slice(0, 140)}…` : text, action: { label: "Ouvrir", onClick: open } });
      }),
    [listen, isReading, me.id, router, joinCall],
  );
  return null;
}

/** Channels then direct messages. In the sidebar on desktop, full page on a phone. */
export function ConversationList() {
  const pathname = usePathname();
  const { conversations, userById, titleOf, me, setDialog } = useApp();
  const channels = conversations.filter((c) => c.kind === "channel");
  const dms = conversations.filter((c) => c.kind === "dm");

  const row = (active: boolean, unread: number) =>
    cn("flex h-8 shrink-0 items-center gap-2.5 rounded-lg px-2 text-[13.5px] transition-colors duration-150 max-md:h-11 max-md:text-[15px]", active ? "bg-surface font-medium text-ink shadow-card" : unread ? "font-semibold text-ink hover:bg-ink/[0.04]" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink");

  return (
    <>
      <SectionTitle onAdd={() => setDialog("channel")} addLabel="Créer un canal">
        Canaux
      </SectionTitle>
      {channels.map((c) => {
        const active = pathname === `/c/${c.id}`;
        return (
          <Link key={c.id} href={`/c/${c.id}`} className={row(active, c.unread)}>
            {c.private ? <Lock className={cn("size-4 shrink-0 p-px", active ? "text-accent" : "text-ink-3")} strokeWidth={2} /> : <Hash className={cn("size-4 shrink-0", active ? "text-accent" : "text-ink-3")} strokeWidth={2} />}
            <span className="truncate">{c.name}</span>
            {c.unread > 0 && <Badge n={c.mentions || c.unread} strong={c.mentions > 0} mention={c.mentions > 0} />}
          </Link>
        );
      })}

      <SectionTitle onAdd={() => setDialog("dm")} addLabel="Nouveau message direct">
        Messages directs
      </SectionTitle>
      {dms.map((c) => {
        const active = pathname === `/c/${c.id}`;
        const other = userById(c.otherUserId);
        return (
          <Link key={c.id} href={`/c/${c.id}`} className={row(active, c.unread)}>
            <Avatar id={other?.id ?? c.id} name={other?.name ?? "?"} size="xs" />
            <span className="truncate">{other?.id === me.id ? `${me.name} (toi)` : titleOf(c)}</span>
            {c.unread > 0 && <Badge n={c.unread} strong />}
          </Link>
        );
      })}
      {!dms.length && <p className="px-2 py-1 text-[12.5px] text-ink-3">Aucune conversation privée pour l&apos;instant.</p>}
    </>
  );
}

function MobileBar() {
  const pathname = usePathname();
  const { setCommandOpen, setDialog } = useApp();
  const nav = useNav();
  return (
    <div className="flex items-center gap-1 border-b border-line px-3 py-2 md:hidden">
      <Logo className="mr-1 size-6" />
      {nav.map(({ href, label, Icon }) => (
        <Link key={href} href={href} aria-label={label} className={cn("flex size-9 items-center justify-center rounded-lg", pathname.startsWith(href) ? "bg-surface text-accent shadow-card" : "text-ink-3")}>
          <Icon className="size-[18px]" />
        </Link>
      ))}
      <button onClick={() => setCommandOpen(true)} aria-label="Rechercher" className="ml-auto flex size-9 items-center justify-center rounded-lg text-ink-3">
        <Search className="size-[18px]" />
      </button>
      <button onClick={() => setDialog("dm")} aria-label="Nouveau message" className="press flex size-9 items-center justify-center rounded-lg bg-accent text-accent-ink">
        <SquarePen className="size-4" strokeWidth={2.2} />
      </button>
    </div>
  );
}
