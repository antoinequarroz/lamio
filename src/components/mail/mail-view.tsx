"use client";

import { Archive, ArrowLeft, Check, Download, Eye, File, FileText, Image as ImageIcon, Flag, Folder, FolderInput, FolderPlus, Forward, Inbox, Loader2, Mail, MailOpen, Paperclip, Pencil, PencilLine, RefreshCw, Reply, ReplyAll, Send, ShieldAlert, ShieldCheck, SquarePen, Trash2, X, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { Compose, composeFrom, type ComposeInit, type SendState } from "@/components/mail/compose";
import { ImagePreview, MailFrame } from "@/components/mail/mail-frame";
import { Avatar, Button, Card, Kbd } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { ComposeMode, MailAccountInfo, MailAction, MailAttachment, MailContent, MailFolder, MailSummary } from "@/lib/types";
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
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [moving, setMoving] = useState<number[] | null>(null);
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
    setSelected(new Set());
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

  const isTrash = current?.specialUse === "\\Trash";
  const isJunk = current?.specialUse === "\\Junk";

  /**
   * Does it at once in the list, then on the mailbox; on failure the list comes back as it was.
   * A move can be undone for a few seconds ("Annuler").
   */
  const act = useCallback(
    async (uids: number[], action: MailAction) => {
      if (!uids.length) return;
      if (action.type === "delete" && !window.confirm(uids.length > 1 ? `Supprimer définitivement ces ${uids.length} mails ?` : "Supprimer définitivement ce mail ?")) return;
      const from = folder;
      const leaves = action.type !== "seen" && action.type !== "flagged";
      if (leaves) {
        // The mail open goes away: the next one opens, like in Mail.
        if (openUid && uids.includes(openUid)) {
          const i = messages.findIndex((m) => m.uid === openUid);
          const next = messages.slice(i + 1).find((m) => !uids.includes(m.uid)) ?? messages.slice(0, i).reverse().find((m) => !uids.includes(m.uid));
          go(from, next?.uid ?? null);
        }
        setMessages((list) => list.filter((m) => !uids.includes(m.uid)));
      } else setMessages((list) => list.map((m) => (uids.includes(m.uid) ? { ...m, [action.type]: action.value } : m)));
      setSelected(new Set());
      try {
        const r = await api<{ moved?: { to: string; uids: number[] } }>("/api/mail/actions", { method: "POST", json: { folder: from, uids, action } });
        if (!leaves) return;
        const n = uids.length > 1 ? `${uids.length} mails` : "Mail";
        const s = uids.length > 1 ? "s" : "";
        const label =
          action.type === "archive" ? `${n} archivé${s}` : action.type === "trash" ? `${n} dans la corbeille` : action.type === "spam" ? `${n} en spam` : action.type === "delete" ? `${n} supprimé${s} définitivement` : `${n} déplacé${s}`;
        const moved = r.moved;
        toast(label, {
          action: moved?.uids.length
            ? {
                label: "Annuler",
                onClick: async () => {
                  try {
                    await api("/api/mail/actions", { method: "POST", json: { folder: moved.to, uids: moved.uids, action: { type: "move", to: from } } });
                    await loadMessages(from, shown.current);
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                },
              }
            : undefined,
        });
      } catch (e) {
        toast.error((e as Error).message);
        void loadMessages(from, shown.current).catch(() => {});
      }
    },
    [folder, openUid, messages, go, loadMessages],
  );

  const toggleSelect = useCallback(
    (uid: number, range: boolean) => {
      setSelected((sel) => {
        const next = new Set(sel);
        const last = [...sel].at(-1);
        if (range && last !== undefined) {
          const a = messages.findIndex((m) => m.uid === last), b = messages.findIndex((m) => m.uid === uid);
          messages.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((m) => next.add(m.uid));
        } else if (next.has(uid)) next.delete(uid);
        else next.add(uid);
        return next;
      });
    },
    [messages],
  );

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
      if (compose || moving) return;
      if (selected.size) {
        const uids = [...selected];
        const keyAction: Record<string, MailAction> = { e: { type: "archive" }, "#": isTrash || isJunk ? { type: "delete" } : { type: "trash" }, Delete: isTrash || isJunk ? { type: "delete" } : { type: "trash" }, "!": { type: "spam" } };
        if (keyAction[e.key]) {
          e.preventDefault();
          void act(uids, keyAction[e.key]);
          return;
        }
        if (e.key === "v") {
          e.preventDefault();
          setMoving(uids);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          setSelected(new Set());
          return;
        }
      }
      if (e.key === "x" && openUid) {
        e.preventDefault();
        toggleSelect(openUid, false);
        return;
      }
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
  }, [messages, openUid, folder, go, compose, moving, selected, act, isTrash, isJunk, toggleSelect]);

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
        <FolderNav folders={folders} current={folder} onOpen={(path) => go(path, null)} onChanged={(next, path) => (setFolders(next), path !== undefined && go(path ?? "INBOX", null))} />
      </nav>

      {/* List */}
      <section className={cn("flex min-h-0 w-[380px] shrink-0 flex-col border-r border-line max-lg:w-[340px] max-md:w-full max-md:border-0", openUid && "max-md:hidden")}>
        {selected.size > 0 ? (
          <SelectionBar
            count={selected.size}
            all={selected.size === messages.length}
            onAll={() => setSelected(selected.size === messages.length ? new Set() : new Set(messages.map((m) => m.uid)))}
            onClear={() => setSelected(new Set())}
            trash={isTrash || isJunk}
            junk={isJunk}
            onAction={(a) => void act([...selected], a)}
            onMove={() => setMoving([...selected])}
            allSeen={messages.filter((m) => selected.has(m.uid)).every((m) => m.seen)}
            allFlagged={messages.filter((m) => selected.has(m.uid)).every((m) => m.flagged)}
          />
        ) : (
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
        )}
        {(info.status === "error" || info.status === "auth") && (
          <div className="flex items-center gap-2 border-b border-line bg-danger/5 px-3 py-2 text-[12.5px]">
            <ShieldAlert className="size-4 shrink-0 text-danger" />
            <span className="min-w-0 flex-1">{info.lastError ?? "La boîte ne répond pas."}</span>
            <Link href="/settings" className="shrink-0 font-medium text-accent">Réglages</Link>
          </div>
        )}
        <MessageList
          messages={messages}
          loading={loading || info.status === "pending" || info.status === "syncing"}
          hasMore={hasMore}
          onMore={more}
          openUid={openUid}
          fresh={fresh}
          selected={selected}
          onSelect={toggleSelect}
          onOpen={(uid) => go(folder, uid)}
        />
      </section>

      {/* Reading */}
      <section className={cn("flex min-w-0 flex-1 flex-col", !openUid && "max-md:hidden")}>
        {openUid ? <Reader
            key={`${folder}|${openUid}`}
            folder={folder}
            uid={openUid}
            me={info.email}
            isDrafts={current?.specialUse === "\\Drafts"}
            trash={isTrash || isJunk}
            junk={isJunk}
            busy={!!compose || !!moving || selected.size > 0}
            onCompose={setCompose}
            onAction={(a) => void act([openUid], a)}
            onMove={() => setMoving([openUid])}
            onBack={() => go(folder, null)}
            onSeen={markSeen}
          /> : <EmptyReader count={current?.unread ?? 0} />}
      </section>
      {moving && (
        <MoveMenu
          folders={folders.filter((f) => f.path !== folder)}
          onClose={() => setMoving(null)}
          onPick={(to) => {
            const uids = moving;
            setMoving(null);
            void act(uids, { type: "move", to });
          }}
        />
      )}
      {compose && <Compose key={JSON.stringify([compose.mode, compose.ref, compose.draft, compose.subject])} init={compose} signature={info.signature} onClose={() => setCompose(null)} onSent={sent} />}
    </div>
  );
}

function SelectionBar({
  count,
  all,
  onAll,
  onClear,
  trash,
  junk,
  onAction,
  onMove,
  allSeen,
  allFlagged,
}: {
  count: number;
  all: boolean;
  onAll: () => void;
  onClear: () => void;
  trash: boolean;
  junk: boolean;
  onAction: (a: MailAction) => void;
  onMove: () => void;
  allSeen: boolean;
  allFlagged: boolean;
}) {
  return (
    <header className="flex h-[52px] shrink-0 items-center gap-1 border-b border-line bg-[color-mix(in_oklab,var(--accent)_7%,transparent)] px-2">
      <button onClick={onAll} aria-label={all ? "Tout désélectionner" : "Tout sélectionner"} className="press flex size-8 items-center justify-center rounded-lg">
        <span className={cn("flex size-4 items-center justify-center rounded border", all ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface")}>{all && <Check className="size-3" strokeWidth={3} />}</span>
      </button>
      <span className="tabular min-w-0 flex-1 truncate text-[13px] font-medium whitespace-nowrap">
        {count} sélectionné{count > 1 ? "s" : ""}
      </span>
      <Action small label="Archiver (E)" Icon={Archive} onClick={() => onAction({ type: "archive" })} />
      <Action small label={trash ? "Supprimer définitivement (#)" : "Corbeille (#)"} Icon={Trash2} onClick={() => onAction(trash ? { type: "delete" } : { type: "trash" })} />
      {junk ? <Action small label="Pas un spam" Icon={ShieldCheck} onClick={() => onAction({ type: "move", to: "INBOX" })} /> : <Action small label="Spam (!)" Icon={ShieldAlert} onClick={() => onAction({ type: "spam" })} />}
      <Action small label="Déplacer (V)" Icon={FolderInput} onClick={onMove} />
      <Action small label={allSeen ? "Marquer comme non lus" : "Marquer comme lus"} Icon={allSeen ? Mail : MailOpen} onClick={() => onAction({ type: "seen", value: !allSeen })} />
      <Action small label={allFlagged ? "Retirer le drapeau" : "Signaler"} Icon={Flag} active={allFlagged} onClick={() => onAction({ type: "flagged", value: !allFlagged })} />
      <Action small label="Annuler la sélection (Échap)" Icon={X} onClick={onClear} />
    </header>
  );
}

/** "Déplacer vers…": the folders, filtered as one types. */
function MoveMenu({ folders, onPick, onClose }: { folders: MailFolder[]; onPick: (path: string) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const list = folders.filter((f) => f.name.toLowerCase().includes(q.trim().toLowerCase()) || f.path.toLowerCase().includes(q.trim().toLowerCase()));
  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/20 pt-[15vh]" onMouseDown={onClose}>
      <div role="dialog" aria-label="Déplacer vers" className="w-[min(360px,calc(100vw-32px))] overflow-hidden rounded-xl border border-line-strong bg-surface shadow-2xl" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          value={q}
          onChange={(e) => (setQ(e.target.value), setActive(0))}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              onClose();
            } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a + (e.key === "ArrowDown" ? 1 : list.length - 1)) % Math.max(1, list.length));
            } else if (e.key === "Enter" && list[active]) {
              e.preventDefault();
              onPick(list[active].path);
            }
          }}
          placeholder="Déplacer vers…"
          className="h-11 w-full border-b border-line bg-transparent px-4 text-[14px] outline-none"
        />
        <ul className="scroll-thin max-h-[320px] overflow-y-auto py-1">
          {list.map((f, i) => {
            const Icon = (f.specialUse && FOLDER_ICONS[f.specialUse]) || Folder;
            return (
              <li key={f.path}>
                <button onClick={() => onPick(f.path)} onMouseEnter={() => setActive(i)} className={cn("flex w-full items-center gap-2.5 px-4 py-2 text-left text-[13.5px]", i === active && "bg-accent-soft")}>
                  <Icon className="size-4 shrink-0 text-ink-3" />
                  <span className="min-w-0 flex-1 truncate">{f.path.split(f.delimiter || "/").join(" › ").replace(/^INBOX$/, f.name)}</span>
                </button>
              </li>
            );
          })}
          {!list.length && <li className="px-4 py-3 text-[13px] text-ink-3">Aucun dossier</li>}
        </ul>
      </div>
    </div>,
    document.body,
  );
}

/** The folders, with creating, renaming and deleting the person's own ones (on the server). */
function FolderNav({ folders, current, onOpen, onChanged }: { folders: MailFolder[]; current: string; onOpen: (path: string) => void; onChanged: (folders: MailFolder[], go?: string | null) => void }) {
  const [editing, setEditing] = useState<{ path: string | null; name: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const call = async (method: "POST" | "PATCH" | "DELETE", json: Record<string, string>) => {
    setBusy(true);
    try {
      return await api<{ path: string | null; folders: MailFolder[] }>("/api/mail/folders", { method, json });
    } catch (e) {
      toast.error((e as Error).message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async () => {
    if (!editing) return;
    const name = editing.name.trim();
    const was = editing.path;
    setEditing(null);
    if (!name) return;
    const r = await call(was ? "PATCH" : "POST", was ? { path: was, name } : { name });
    if (r) onChanged(r.folders, was === current || !was ? r.path : undefined);
  };

  const remove = async (f: MailFolder) => {
    if (!window.confirm(`Supprimer le dossier « ${f.name} » et les ${f.total} mails qu'il contient ? Il disparaît aussi du webmail et de l'iPhone.`)) return;
    const r = await call("DELETE", { path: f.path });
    if (r) onChanged(r.folders, f.path === current ? null : undefined);
  };

  const input = (
    <input
      autoFocus
      value={editing?.name ?? ""}
      disabled={busy}
      onChange={(e) => setEditing((x) => (x ? { ...x, name: e.target.value } : x))}
      onBlur={() => void submit()}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          setEditing(null);
        }
      }}
      aria-label="Nom du dossier"
      className="h-8 w-full rounded-lg border border-accent bg-surface px-2 text-[13.5px] outline-none"
    />
  );

  return (
    <>
      {folders.map((f) =>
        editing?.path === f.path ? (
          <div key={f.path}>{input}</div>
        ) : (
          <div key={f.path} className="group relative">
            <FolderLink f={f} active={f.path === current} onClick={() => onOpen(f.path)} />
            {!f.specialUse && (
              <span className="absolute top-1 right-1 hidden items-center gap-0.5 rounded-md bg-surface-2 group-hover:flex">
                <button onClick={() => setEditing({ path: f.path, name: f.name })} aria-label={`Renommer ${f.name}`} title="Renommer" className="press flex size-6 items-center justify-center rounded text-ink-3 hover:text-ink">
                  <Pencil className="size-3.5" />
                </button>
                <button onClick={() => void remove(f)} aria-label={`Supprimer ${f.name}`} title="Supprimer" className="press flex size-6 items-center justify-center rounded text-ink-3 hover:text-danger">
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            )}
          </div>
        ),
      )}
      {editing && editing.path === null ? (
        <div className="mt-1">{input}</div>
      ) : (
        <button onClick={() => setEditing({ path: null, name: "" })} disabled={busy} className="press mt-1 flex h-8 items-center gap-2.5 rounded-lg px-2 text-[13px] text-ink-3 hover:bg-ink/[0.04] hover:text-ink">
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
          Nouveau dossier
        </button>
      )}
    </>
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

function MessageList({
  messages,
  loading,
  hasMore,
  onMore,
  openUid,
  fresh,
  selected,
  onSelect,
  onOpen,
}: {
  messages: MailSummary[];
  loading: boolean;
  hasMore: boolean;
  onMore: () => void;
  openUid: number | null;
  fresh: Set<string>;
  selected: Set<number>;
  onSelect: (uid: number, range: boolean) => void;
  onOpen: (uid: number) => void;
}) {
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
          const checked = selected.has(m.uid);
          return (
            <li
              key={m.uid}
              className={cn(
                "group relative border-b border-line transition-colors duration-300",
                checked ? "bg-[color-mix(in_oklab,var(--accent)_16%,transparent)]" : active ? "bg-accent-soft" : "hover:bg-ink/[0.03]",
                fresh.has(keyOf(m)) && !active && !checked && "bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]",
              )}
            >
              {/* Select: the box shows on hover, or for all once one is ticked. ⌘/Ctrl-click and Shift-click work too. */}
              <button
                onClick={(e) => onSelect(m.uid, e.shiftKey)}
                aria-label={checked ? "Désélectionner" : "Sélectionner"}
                aria-pressed={checked}
                className={cn(
                  "absolute top-2.5 left-1 z-[1] flex size-6 items-center justify-center rounded-md max-md:hidden",
                  selected.size ? "opacity-100" : "opacity-0 group-hover:opacity-100 focus-visible:opacity-100",
                )}
              >
                <span className={cn("flex size-4 items-center justify-center rounded border", checked ? "border-accent bg-accent text-accent-ink" : "border-line-strong bg-surface")}>{checked && <Check className="size-3" strokeWidth={3} />}</span>
              </button>
              <button
                ref={active ? activeRef : undefined}
                onClick={(e) => (e.metaKey || e.ctrlKey || e.shiftKey || selected.size ? onSelect(m.uid, e.shiftKey) : onOpen(m.uid))}
                className="relative flex w-full flex-col gap-0.5 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-inset md:pl-8"
              >
                {!m.seen && <span className={cn("absolute top-[17px] left-1.5 size-1.5 rounded-full bg-accent md:left-3", (selected.size > 0) && "md:hidden", "md:group-hover:hidden")} aria-label="Non lu" />}
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
  trash,
  junk,
  busy,
  onCompose,
  onAction,
  onMove,
  onBack,
  onSeen,
}: {
  folder: string;
  uid: number;
  me: string;
  isDrafts: boolean;
  /** In the Trash or the Spam: deleting is for good. */
  trash: boolean;
  junk: boolean;
  /** Writing, moving or selecting: the reader's keys are off. */
  busy: boolean;
  onCompose: (init: ComposeInit) => void;
  onAction: (action: MailAction) => void;
  onMove: () => void;
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

  const run = useCallback(
    (a: MailAction) => {
      if (a.type === "flagged") setMail((m) => (m ? { ...m, flagged: a.value } : m));
      onAction(a);
      // Unread again: back to the list, or opening it would mark it read at once.
      if (a.type === "seen" && !a.value) onBack();
    },
    [onAction, onBack],
  );

  // r / a / f: reply, reply to all, forward. e: archive, #: trash, u: unread, s: flag, v: move, !: spam.
  useEffect(() => {
    if (!mail || busy) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || t.closest("input, textarea, select, [contenteditable=true]")) return;
      const mode = ({ r: "reply", a: "replyAll", f: "forward" } as Record<string, ComposeMode>)[e.key];
      const action = ({ e: { type: "archive" }, "#": trash ? { type: "delete" } : { type: "trash" }, Delete: trash ? { type: "delete" } : { type: "trash" }, u: { type: "seen", value: false }, s: { type: "flagged", value: !mail.flagged }, "!": junk ? { type: "move", to: "INBOX" } : { type: "spam" } } as Record<string, MailAction>)[e.key];
      if (mode && !isDrafts) {
        e.preventDefault();
        onCompose(composeFrom(mail, mode, me));
      } else if (action) {
        e.preventDefault();
        run(action);
      } else if (e.key === "v") {
        e.preventDefault();
        onMove();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mail, busy, me, onCompose, run, onMove, trash, junk, isDrafts]);

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
        <span className="min-w-0 truncate text-[12px] text-ink-3 max-sm:hidden">
          {new Date(mail.date).toLocaleString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </span>
        <span className="flex-1" />
        <Action label="Archiver (E)" Icon={Archive} onClick={() => run({ type: "archive" })} />
        {trash ? (
          <Action label="Supprimer définitivement (#)" Icon={Trash2} onClick={() => run({ type: "delete" })} />
        ) : (
          <Action label="Corbeille (#)" Icon={Trash2} onClick={() => run({ type: "trash" })} />
        )}
        {junk ? <Action label="Pas un spam (!)" Icon={ShieldCheck} onClick={() => run({ type: "move", to: "INBOX" })} /> : <Action label="Spam (!)" Icon={ShieldAlert} onClick={() => run({ type: "spam" })} />}
        <Action label="Déplacer (V)" Icon={FolderInput} onClick={onMove} />
        <Action label="Marquer comme non lu (U)" Icon={MailOpen} onClick={() => run({ type: "seen", value: false })} />
        <Action label={mail.flagged ? "Retirer le drapeau (S)" : "Signaler (S)"} Icon={Flag} active={mail.flagged} onClick={() => run({ type: "flagged", value: !mail.flagged })} />
        <span className="mx-1 h-5 w-px bg-line max-sm:hidden" />
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
                  <span className="min-w-[12rem] flex-1">Images bloquées : elles peuvent dire à l&apos;expéditeur quand et où tu ouvres ce mail.</span>
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

function Action({ label, Icon, onClick, active, small }: { label: string; Icon: typeof Reply; onClick: () => void; active?: boolean; small?: boolean }) {
  return (
    <button onClick={onClick} aria-label={label} title={label} className={cn("press flex shrink-0 items-center justify-center rounded-lg hover:bg-ink/[0.05] hover:text-ink", small ? "size-7" : "size-8", active ? "text-accent" : "text-ink-3")}>
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
