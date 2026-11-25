"use client";

import { Archive, ArrowLeft, Download, Eye, File, FileText, Image as ImageIcon, Flag, Folder, Forward, Inbox, Loader2, Mail, Paperclip, PencilLine, RefreshCw, Reply, ReplyAll, Send, ShieldAlert, SquarePen, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Compose, composeFrom, type ComposeInit, type SendState } from "@/components/mail/compose";
import { ImagePreview, MailFrame } from "@/components/mail/mail-frame";
import { Avatar, Button, Card, Kbd } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { ComposeMode, MailAccountInfo, MailAttachment, MailContent, MailFolder, MailSummary } from "@/lib/types";
import { api, cn, fileSize } from "@/lib/utils";

const PAGE = 50;

const FOLDER_ICONS: Record<string, typeof Inbox> = { "\\Inbox": Inbox, "\\Sent": Send, "\\Drafts": FileText, "\\Archive": Archive, "\\Junk": ShieldAlert, "\\Trash": Trash2, "\\Flagged": Flag };

/** "14:32" today, "hier", "lun." this week, "12 nov." this year, else "12.11.2025". */
export function shortDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const days = Math.floor((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86_400_000);
  if (days <= 0) return d.toLocaleTimeString("fr-CH", { hour: "2-digit", minute: "2-digit" });
  if (days === 1) return "hier";
  if (days < 7) return d.toLocaleDateString("fr-CH", { weekday: "short" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("fr-CH", { day: "numeric", month: "short" });
  return d.toLocaleDateString("fr-CH");
}

const who = (a: { name: string; address: string }) => a.name || a.address || "(inconnu)";
const keyOf = (m: { folder: string; uid: number }) => `${m.folder}|${m.uid}`;

type Account = { enabled: boolean; account: MailAccountInfo | null };

export function MailView() {
  const router = useRouter();
  const params = useSearchParams();
  const { listen } = useApp();
  const [account, setAccount] = useState<Account | null>(null);
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [messages, setMessages] = useState<MailSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [compose, setCompose] = useState<ComposeInit | null>(null);
  // Mails waiting to leave or just sent: to reopen them on "Annuler" or when sending failed.
  const outgoing = useRef(new Map<string, SendState>());

  const folder = params.get("f") || "INBOX";
  const openUid = Number(params.get("m")) || null;
  const current = folders.find((f) => f.path === folder);

  const go = useCallback(
    (f: string, uid: number | null) => {
      const q = new URLSearchParams();
      if (f !== "INBOX") q.set("f", f);
      if (uid) q.set("m", String(uid));
      const s = q.toString();
      router.replace(s ? `/mail?${s}` : "/mail", { scroll: false });
    },
    [router],
  );

  // How many are shown, so a live refresh keeps the pages already loaded.
  const shown = useRef(PAGE);
  shown.current = Math.max(PAGE, messages.length);

  const loadFolders = useCallback(async () => {
    const [a, f] = await Promise.all([api<Account>("/api/mail/account"), api<{ folders: MailFolder[] }>("/api/mail/folders")]);
    setAccount(a);
    setFolders(f.folders);
  }, []);

  const loadMessages = useCallback(async (path: string, limit = PAGE) => {
    const r = await api<{ messages: MailSummary[]; hasMore: boolean }>(`/api/mail/messages?folder=${encodeURIComponent(path)}&limit=${Math.min(200, limit)}`);
    setMessages(r.messages);
    setHasMore(r.hasMore);
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadFolders().catch(() => setAccount({ enabled: false, account: null }));
  }, [loadFolders]);

  useEffect(() => {
    setLoading(true);
    setMessages([]);
    void loadMessages(folder).catch(() => setLoading(false));
  }, [folder, loadMessages]);

  // Live: a new mail, a mail read or moved elsewhere, a folder created... the view follows.
  useEffect(
    () =>
      listen((e) => {
        if (e.type === "resync") {
          void loadFolders().catch(() => {});
          void loadMessages(folder, shown.current).catch(() => {});
          return;
        }
        if (e.type !== "mail") return;
        if (e.sent) {
          const s = outgoing.current.get(e.sent.id);
          outgoing.current.delete(e.sent.id);
          if (e.sent.error) toast.error("Le mail n'est pas parti", { description: e.sent.error, duration: 15000, action: s ? { label: "Rouvrir", onClick: () => setCompose({ ...s, unsaved: true }) } : undefined });
          else if (s) toast.success("Mail envoyé");
          return;
        }
        void loadFolders().catch(() => {});
        if (e.folders.includes(folder) || e.folders.includes("*")) void loadMessages(folder, shown.current).catch(() => {});
        if (e.added?.length && folder === "INBOX") {
          const keys = e.added.map(keyOf);
          setFresh((s) => new Set([...s, ...keys]));
          setTimeout(() => setFresh((s) => new Set([...s].filter((k) => !keys.includes(k)))), 2400);
        }
      }),
    [listen, folder, loadFolders, loadMessages],
  );

  const more = useCallback(async () => {
    const last = messages.at(-1);
    if (!last || !hasMore) return;
    const r = await api<{ messages: MailSummary[]; hasMore: boolean }>(`/api/mail/messages?folder=${encodeURIComponent(folder)}&before=${encodeURIComponent(`${last.date}|${last.uid}`)}`);
    setMessages((m) => [...m, ...r.messages.filter((x) => !m.some((y) => y.uid === x.uid))]);
    setHasMore(r.hasMore);
  }, [messages, hasMore, folder]);

  const sync = async () => {
    setSyncing(true);
    try {
      await api("/api/mail/sync", { method: "POST" });
      await Promise.all([loadFolders(), loadMessages(folder, shown.current)]);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setSyncing(false);
    }
  };

  // j / k: next / previous mail. Escape: back to the list.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const i = messages.findIndex((m) => m.uid === openUid);
      if (e.key === "c" && !compose) {
        e.preventDefault();
        setCompose({ mode: "new", to: [], cc: [], bcc: [], subject: "", html: "" });
        return;
      }
      if (compose) return;
      if (e.key === "j" || e.key === "ArrowDown") {
        const next = messages[i + 1] ?? (i === -1 ? messages[0] : null);
        if (next) {
          e.preventDefault();
          go(folder, next.uid);
        }
      } else if (e.key === "k" || e.key === "ArrowUp") {
        const prev = messages[i - 1];
        if (prev) {
          e.preventDefault();
          go(folder, prev.uid);
        }
      } else if (e.key === "Escape" && openUid && !e.defaultPrevented) go(folder, null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [messages, openUid, folder, go, compose]);

  const sent = useCallback((id: string, undoMs: number, state: SendState) => {
    outgoing.current.set(id, state);
    setCompose(null);
    toast("Envoi du mail…", {
      id,
      duration: undoMs,
      action: {
        label: "Annuler",
        onClick: async () => {
          try {
            await api(`/api/mail/send?id=${encodeURIComponent(id)}`, { method: "DELETE" });
            outgoing.current.delete(id);
            setCompose({ ...state, unsaved: true });
            toast("Envoi annulé", { description: "Le mail est de nouveau ouvert." });
          } catch (e) {
            toast.error((e as Error).message);
          }
        },
      },
    });
  }, []);

  const markSeen = useCallback((uid: number) => setMessages((m) => m.map((x) => (x.uid === uid ? { ...x, seen: true } : x))), []);

  if (!account) return <Centered><Loader2 className="size-5 animate-spin text-ink-3" /></Centered>;
  if (!account.enabled || !account.account) return <NoMailbox enabled={account.enabled} />;

  const info = account.account;
  return (
    <div className="flex min-h-0 flex-1">
      {/* Folders */}
      <nav className={cn("scroll-thin flex w-[208px] shrink-0 flex-col gap-px overflow-y-auto border-r border-line px-2 py-3 max-lg:hidden")}>
        <div className="mb-2 px-2">
          <h1 className="font-display text-[26px] leading-none">Mails</h1>
          <p className="mt-1.5 truncate text-[12px] text-ink-3" title={info.email}>{info.email}</p>
        </div>
        {folders.map((f) => (
          <FolderLink key={f.path} f={f} active={f.path === folder} onClick={() => go(f.path, null)} />
        ))}
      </nav>

      {/* List */}
      <section className={cn("flex min-h-0 w-[380px] shrink-0 flex-col border-r border-line max-lg:w-[340px] max-md:w-full max-md:border-0", openUid && "max-md:hidden")}>
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b border-line px-3">
          <select value={folder} onChange={(e) => go(e.target.value, null)} aria-label="Dossier" className="h-8 min-w-0 rounded-lg border border-line-strong bg-surface px-2 text-[13px] lg:hidden">
            {folders.map((f) => (
              <option key={f.path} value={f.path}>
                {f.name}
                {f.unread ? ` (${f.unread})` : ""}
              </option>
            ))}
          </select>
          <span className="truncate text-[14px] font-medium max-lg:hidden">{current?.name ?? folder}</span>
          {current && current.unread > 0 && <span className="tabular text-[12px] text-ink-3 max-lg:hidden">{current.unread} non lus</span>}
          <span className="ml-auto flex items-center gap-1" title={info.live ? "Temps réel actif : les nouveaux mails arrivent en direct" : "Temps réel en cours de connexion"}>
            <Zap className={cn("size-3.5", info.live ? "text-accent" : "text-ink-3")} />
            <span className="text-[11.5px] text-ink-3 max-sm:hidden">{info.live ? "En direct" : "Connexion…"}</span>
          </span>
          <button onClick={() => setCompose({ mode: "new", to: [], cc: [], bcc: [], subject: "", html: "" })} aria-label="Nouveau mail" title="Nouveau mail (C)" className="press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
            <SquarePen className="size-4" />
          </button>
          <button onClick={sync} disabled={syncing} aria-label="Synchroniser" title="Synchroniser" className="press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
            <RefreshCw className={cn("size-4", syncing && "animate-spin")} />
          </button>
        </header>
        {(info.status === "error" || info.status === "auth") && (
          <div className="flex items-center gap-2 border-b border-line bg-danger/5 px-3 py-2 text-[12.5px]">
            <ShieldAlert className="size-4 shrink-0 text-danger" />
            <span className="min-w-0 flex-1">{info.lastError ?? "La boîte ne répond pas."}</span>
            <Link href="/settings" className="shrink-0 font-medium text-accent">Réglages</Link>
          </div>
        )}
        <MessageList messages={messages} loading={loading || info.status === "pending" || info.status === "syncing"} hasMore={hasMore} onMore={more} openUid={openUid} fresh={fresh} onOpen={(uid) => go(folder, uid)} />
      </section>

      {/* Reading */}
      <section className={cn("flex min-w-0 flex-1 flex-col", !openUid && "max-md:hidden")}>
        {openUid ? <Reader key={`${folder}|${openUid}`} folder={folder} uid={openUid} me={info.email} isDrafts={current?.specialUse === "\\Drafts"} composing={!!compose} onCompose={setCompose} onBack={() => go(folder, null)} onSeen={markSeen} /> : <EmptyReader count={current?.unread ?? 0} />}
      </section>
      {compose && <Compose key={JSON.stringify([compose.mode, compose.ref, compose.draft, compose.subject])} init={compose} signature={info.signature} onClose={() => setCompose(null)} onSent={sent} />}
    </div>
  );
}

function FolderLink({ f, active, onClick }: { f: MailFolder; active: boolean; onClick: () => void }) {
  const Icon = (f.specialUse && FOLDER_ICONS[f.specialUse]) || Folder;
  const depth = f.delimiter ? f.path.split(f.delimiter).length - 1 : 0;
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={cn("flex h-8 shrink-0 items-center gap-2.5 rounded-lg pr-2 text-left text-[13.5px] transition-colors duration-150", active ? "bg-surface font-medium text-ink shadow-card" : f.unread ? "font-semibold text-ink hover:bg-ink/[0.04]" : "text-ink-2 hover:bg-ink/[0.04] hover:text-ink")}
    >
      <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-ink-3")} strokeWidth={2} />
      <span className="min-w-0 flex-1 truncate">{f.name}</span>
      {f.unread > 0 && f.specialUse !== "\\Sent" && f.specialUse !== "\\Trash" && <span className="tabular text-[11.5px] font-semibold text-ink-2">{f.unread > 999 ? "999+" : f.unread}</span>}
    </button>
  );
}

function MessageList({ messages, loading, hasMore, onMore, openUid, fresh, onOpen }: { messages: MailSummary[]; loading: boolean; hasMore: boolean; onMore: () => void; openUid: number | null; fresh: Set<string>; onOpen: (uid: number) => void }) {
  const end = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLButtonElement>(null);

  // Infinite scroll: the next page when the end of the list comes into view.
  useEffect(() => {
    const el = end.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && onMore(), { rootMargin: "400px" });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onMore]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [openUid]);

  if (!messages.length)
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center text-[13px] text-ink-3">
        {loading ? (
          <>
            <Loader2 className="size-5 animate-spin" />
            Synchronisation de ta boîte…
          </>
        ) : (
          <>
            <Inbox className="size-6" strokeWidth={1.5} />
            Aucun mail dans ce dossier.
          </>
        )}
      </div>
    );

  return (
    <div className="scroll-thin flex-1 overflow-y-auto">
      <ul>
        {messages.map((m) => {
          const active = m.uid === openUid;
          return (
            <li key={m.uid}>
              <button
                ref={active ? activeRef : undefined}
                onClick={() => onOpen(m.uid)}
                className={cn(
                  "relative flex w-full flex-col gap-0.5 border-b border-line px-4 py-2.5 text-left transition-colors duration-300 outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset",
                  active ? "bg-accent-soft" : "hover:bg-ink/[0.03]",
                  fresh.has(keyOf(m)) && !active && "bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]",
                )}
              >
                {!m.seen && <span className="absolute top-[17px] left-1.5 size-1.5 rounded-full bg-accent" aria-label="Non lu" />}
                <span className="flex items-baseline gap-2">
                  <span className={cn("min-w-0 flex-1 truncate text-[13.5px]", m.seen ? "text-ink-2" : "font-semibold text-ink")}>{who(m.from)}</span>
                  {m.flagged && <Flag className="size-3 shrink-0 self-center fill-danger text-danger" />}
                  {m.attachments && <Paperclip className="size-3 shrink-0 self-center text-ink-3" />}
                  <span className={cn("tabular shrink-0 text-[11.5px]", m.seen ? "text-ink-3" : "font-medium text-accent")}>{shortDate(m.date)}</span>
                </span>
                <span className={cn("truncate text-[13px]", m.seen ? "text-ink-2" : "font-medium text-ink")}>{m.subject || "(sans objet)"}</span>
                <span className="line-clamp-2 text-[12.5px] leading-snug text-ink-3">{m.preview || " "}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <div ref={end} className="flex h-12 items-center justify-center">
        {hasMore && <Loader2 className="size-4 animate-spin text-ink-3" />}
      </div>
    </div>
  );
}

// Links in the text become clickable, nothing else is interpreted.
const URL_RE = /(https?:\/\/[^\s<>()"']+[^\s<>()"'.,;:!?])/g;

function Linkified({ text }: { text: string }) {
  const parts = useMemo(() => text.split(URL_RE), [text]);
  return (
    <>
      {parts.map((p, i) =>
        i % 2 ? (
          <a key={i} href={p} target="_blank" rel="noreferrer noopener" title={p} className="break-all text-accent underline decoration-accent/30 underline-offset-2 hover:decoration-accent">
            {p.length > 80 ? `${p.slice(0, 77)}…` : p}
          </a>
        ) : (
          p
        ),
      )}
    </>
  );
}

const PREVIEW_IMAGES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp", "image/avif"]);

const attachmentUrl = (mail: { folder: string; uid: number }, a: MailAttachment, inline = false) =>
  `/api/mail/attachment?folder=${encodeURIComponent(mail.folder)}&uid=${mail.uid}&part=${encodeURIComponent(a.part)}${inline ? "&inline=1" : ""}`;

function Reader({
  folder,
  uid,
  me,
  isDrafts,
  composing,
  onCompose,
  onBack,
  onSeen,
}: {
  folder: string;
  uid: number;
  me: string;
  isDrafts: boolean;
  composing: boolean;
  onCompose: (init: ComposeInit) => void;
  onBack: () => void;
  onSeen: (uid: number) => void;
}) {
  const [mail, setMail] = useState<MailContent | null>(null);
  const [error, setError] = useState("");
  const [showImages, setShowImages] = useState(false);
  const [asText, setAsText] = useState(false);
  const [preview, setPreview] = useState<MailAttachment | null>(null);

  useEffect(() => {
    let live = true;
    setShowImages(false);
    setAsText(false);
    setPreview(null);
    api<{ mail: MailContent }>(`/api/mail/message?folder=${encodeURIComponent(folder)}&uid=${uid}`).then(
      (r) => {
        if (!live) return;
        setMail(r.mail);
        onSeen(uid);
      },
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [folder, uid, onSeen]);

  const trust = async (trusted: boolean) => {
    if (!mail) return;
    try {
      await api("/api/mail/trust", { method: "POST", json: { address: mail.from.address, trusted } });
      setMail({ ...mail, trusted });
      if (!trusted) setShowImages(false);
      toast.success(trusted ? `Les images de ${mail.from.address} s'afficheront toujours` : "Les images de cet expéditeur seront de nouveau bloquées");
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  // r: reply, a: reply to all, f: forward.
  useEffect(() => {
    if (!mail || composing) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const mode = ({ r: "reply", a: "replyAll", f: "forward" } as Record<string, ComposeMode>)[e.key];
      if (!mode) return;
      e.preventDefault();
      onCompose(composeFrom(mail, mode, me));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mail, composing, me, onCompose]);

  const back = (
    <button onClick={onBack} aria-label="Retour à la liste" className="press flex size-8 items-center justify-center rounded-lg text-ink-3 hover:bg-ink/[0.05] hover:text-ink md:hidden">
      <ArrowLeft className="size-4" />
    </button>
  );

  if (error)
    return (
      <div className="flex flex-1 flex-col">
        <header className="flex h-[52px] items-center border-b border-line px-3 md:hidden">{back}</header>
        <Centered>
          <p className="max-w-[320px] text-center text-[13px] text-ink-3">{error}</p>
        </Centered>
      </div>
    );
  if (!mail)
    return (
      <Centered>
        <Loader2 className="size-5 animate-spin text-ink-3" />
      </Centered>
    );

  const recipients = [...mail.to, ...mail.cc];
  return (
    <article className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line px-3 md:px-6">
        {back}
        <span className="min-w-0 truncate text-[12px] text-ink-3">
          {new Date(mail.date).toLocaleString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="flex-1" />
        {isDrafts ? (
          <button onClick={() => onCompose(composeFrom(mail, "draft", me))} className="press flex h-8 items-center gap-1.5 rounded-lg bg-accent px-3 text-[12.5px] font-medium text-accent-ink">
            <PencilLine className="size-3.5" /> Reprendre
          </button>
        ) : (
          <>
            <Action label="Répondre (R)" Icon={Reply} onClick={() => onCompose(composeFrom(mail, "reply", me))} />
            <Action label="Répondre à tous (A)" Icon={ReplyAll} onClick={() => onCompose(composeFrom(mail, "replyAll", me))} />
            <Action label="Transférer (F)" Icon={Forward} onClick={() => onCompose(composeFrom(mail, "forward", me))} />
          </>
        )}
      </header>
      <div className="scroll-thin flex-1 overflow-y-auto px-6 py-6 max-md:px-4">
        <div className="mx-auto max-w-[720px]">
          <h2 className="text-[22px] leading-tight font-semibold tracking-[-0.01em]">{mail.subject || "(sans objet)"}</h2>
          <div className="mt-4 flex items-start gap-3">
            <Avatar id={mail.from.address || mail.from.name} name={who(mail.from)} size="lg" />
            <div className="min-w-0 flex-1 text-[13px] leading-snug">
              <p>
                <span className="font-semibold">{who(mail.from)}</span>
                {mail.from.name && mail.from.address && <span className="text-ink-3"> &lt;{mail.from.address}&gt;</span>}
              </p>
              {recipients.length > 0 && (
                <p className="truncate text-ink-3" title={recipients.map((r) => r.address).join(", ")}>
                  À {recipients.map(who).join(", ")}
                </p>
              )}
            </div>
          </div>

          {mail.attachmentList.length > 0 && (
            <ul className="mt-5 flex flex-wrap gap-2">
              {mail.attachmentList.map((a) => {
                const image = PREVIEW_IMAGES.has(a.type);
                const pdf = a.type === "application/pdf";
                const Icon = image ? ImageIcon : pdf ? FileText : File;
                const label = (
                  <>
                    <Icon className="size-4 shrink-0 text-ink-3" />
                    <span className="min-w-0 truncate">{a.name}</span>
                    {a.size > 0 && <span className="shrink-0 text-ink-3">{fileSize(a.size)}</span>}
                  </>
                );
                const chip = "press flex max-w-[280px] items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12.5px] hover:border-line-strong";
                return (
                  <li key={a.part} className="flex items-center">
                    {image ? (
                      <button onClick={() => setPreview(a)} className={cn(chip, "rounded-r-none")} title={`Voir ${a.name}`}>
                        {label}
                      </button>
                    ) : pdf ? (
                      <a href={attachmentUrl(mail, a, true)} target="_blank" rel="noreferrer" className={cn(chip, "rounded-r-none")} title={`Ouvrir ${a.name}`}>
                        {label}
                      </a>
                    ) : (
                      <a href={attachmentUrl(mail, a)} download={a.name} className={chip} title={`Télécharger ${a.name}`}>
                        {label}
                        <Download className="size-3.5 shrink-0 text-ink-3" />
                      </a>
                    )}
                    {(image || pdf) && (
                      <a href={attachmentUrl(mail, a)} download={a.name} aria-label={`Télécharger ${a.name}`} className="press flex self-stretch items-center rounded-r-lg border border-l-0 border-line bg-surface-2 px-2 text-ink-3 hover:border-line-strong hover:text-ink">
                        <Download className="size-3.5" />
                      </a>
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {mail.html && !asText ? (
            <div className="mt-6">
              {mail.remoteImages && !(showImages || mail.trusted) && (
                <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] text-ink-2">
                  <ShieldAlert className="size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1">Images bloquées : elles peuvent dire à l&apos;expéditeur quand et où tu ouvres ce mail.</span>
                  <button onClick={() => setShowImages(true)} className="press font-medium text-accent hover:underline">
                    Afficher les images
                  </button>
                  {mail.from.address && (
                    <button onClick={() => void trust(true)} className="press font-medium text-accent hover:underline">
                      Toujours pour cet expéditeur
                    </button>
                  )}
                </div>
              )}
              <MailFrame html={mail.html} showImages={showImages || mail.trusted} title={mail.subject || "Mail"} />
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-ink-3">
                <button onClick={() => setAsText(true)} className="press flex items-center gap-1 hover:text-ink">
                  <FileText className="size-3.5" /> Voir en texte
                </button>
                {mail.trusted && mail.remoteImages && (
                  <button onClick={() => void trust(false)} className="press flex items-center gap-1 hover:text-ink">
                    <Eye className="size-3.5" /> Images toujours affichées pour {mail.from.address} · ne plus les afficher
                  </button>
                )}
              </p>
            </div>
          ) : (
            <>
              <div className="mt-6 text-[14.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">{mail.text ? <Linkified text={mail.text} /> : <span className="text-ink-3">(mail sans texte)</span>}</div>
              {mail.html && (
                <button onClick={() => setAsText(false)} className="press mt-6 flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">
                  <Eye className="size-3.5" /> Voir la mise en page d&apos;origine
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {preview && <ImagePreview src={attachmentUrl(mail, preview, true)} name={preview.name} download={attachmentUrl(mail, preview)} onClose={() => setPreview(null)} />}
    </article>
  );
}

function Action({ label, Icon, onClick, active }: { label: string; Icon: typeof Reply; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cn("press flex size-8 items-center justify-center rounded-lg hover:bg-ink/[0.05] hover:text-ink", active ? "text-accent" : "text-ink-3")}>
      <Icon className="size-4" />
    </button>
  );
}

function EmptyReader({ count }: { count: number }) {
  return (
    <Centered>
      <div className="flex flex-col items-center gap-3 text-center text-[13px] text-ink-3">
        <Mail className="size-7" strokeWidth={1.4} />
        <p>{count > 0 ? `${count} mail${count > 1 ? "s" : ""} non lu${count > 1 ? "s" : ""}.` : "Tout est lu."}</p>
        <p className="flex items-center gap-1.5 text-[12px]">
          <Kbd>J</Kbd>
          <Kbd>K</Kbd>
          pour passer d&apos;un mail à l&apos;autre
        </p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-1 items-center justify-center p-6">{children}</div>;
}

function NoMailbox({ enabled }: { enabled: boolean }) {
  return (
    <Centered>
      <Card className="flex max-w-[420px] flex-col items-center gap-3 text-center">
        <span className="flex size-11 items-center justify-center rounded-xl bg-accent-soft text-accent">
          <Mail className="size-5" />
        </span>
        <h1 className="font-display text-[26px] leading-none">Tes mails dans Lamio</h1>
        <p className="text-[13.5px] text-ink-2">
          {enabled
            ? "Branche ta boîte Infomaniak : tes mails arrivent ici en direct, et tout ce que tu fais se retrouve dans le webmail et sur ton iPhone."
            : "Les mails ne sont pas encore activés sur ce serveur (il manque la clé MAIL_SECRET)."}
        </p>
        {enabled && (
          <Link href="/settings">
            <Button variant="primary">Brancher ma boîte</Button>
          </Link>
        )}
      </Card>
    </Centered>
  );
}
