"use client";

import { Check, Hash, Loader2, Lock, Paperclip, Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { Avatar, Button, Field, inputClass, Modal } from "@/components/ui";
import { useApp } from "@/lib/store";
import { useStored } from "@/lib/use-stored";
import type { MailContent } from "@/lib/types";
import { api, cn, fileSize } from "@/lib/utils";

/**
 * While a gateway is open, the keys belong to it: nothing reaches the Mails tab's shortcuts
 * (caught first, on the window). Escape closes, ⌘/Ctrl+Enter sends.
 */
function useDialogKeys(onClose: () => void, onSubmit: () => void) {
  const latest = useRef({ onClose, onSubmit });
  latest.current = { onClose, onSubmit };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        latest.current.onClose();
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        latest.current.onSubmit();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);
}

const textareaClass = cn(inputClass, "h-auto min-h-[72px] resize-y py-2 leading-snug");

/** Shares a mail in a channel or a direct message, with a word and the attachments I pick. */
export function ShareDialog({ mail, onClose }: { mail: MailContent; onClose: () => void }) {
  const router = useRouter();
  const { conversations, me, titleOf, userById } = useApp();
  const [query, setQuery] = useState("");
  const [to, setTo] = useState<string | null>(null);
  const [comment, setComment] = useState("");
  const [parts, setParts] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // Where I talk most recently first; my own notes last.
  const list = useMemo(() => {
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return [...conversations]
      .sort((a, b) => Number(a.otherUserId === me.id) - Number(b.otherUserId === me.id) || b.lastMessageId - a.lastMessageId)
      .filter((c) => !q || titleOf(c).toLowerCase().includes(q));
  }, [conversations, query, me.id, titleOf]);
  const target = conversations.find((c) => c.id === to);

  const submit = async () => {
    if (!target || busy) return;
    setBusy(true);
    try {
      await api("/api/mail/share", { method: "POST", json: { folder: mail.folder, uid: mail.uid, conversationId: target.id, comment, parts } });
      toast.success(`Partagé dans ${titleOf(target)}`, { action: { label: "Ouvrir", onClick: () => router.push(`/c/${target.id}`) } });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  useDialogKeys(onClose, () => void submit());

  return (
    <Modal title="Partager dans Lamio" onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="flex flex-col gap-3"
      >
        <div className="relative">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
          <input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Canal ou personne" aria-label="Chercher une conversation" className={cn(inputClass, "pl-8")} />
        </div>
        <div role="radiogroup" aria-label="Conversation" className="scroll-thin -mx-1 flex max-h-[200px] flex-col gap-px overflow-y-auto px-1">
          {list.map((c) => {
            const other = c.kind === "dm" ? userById(c.otherUserId) : undefined;
            const on = c.id === to;
            return (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => setTo(c.id)}
                className={cn("press flex h-9 shrink-0 items-center gap-2.5 rounded-lg px-2.5 text-left text-[13.5px]", on ? "bg-accent-soft text-accent" : "hover:bg-ink/[0.04]")}
              >
                {c.kind === "dm" ? <Avatar id={other?.id ?? c.id} name={other?.name ?? "?"} size="xs" /> : c.private ? <Lock className="size-3.5 text-ink-3" /> : <Hash className="size-3.5 text-ink-3" />}
                <span className="min-w-0 flex-1 truncate">{c.kind === "channel" ? c.name : titleOf(c)}</span>
                {on && <Check className="size-4" />}
              </button>
            );
          })}
          {!list.length && <p className="px-2.5 py-2 text-[12.5px] text-ink-3">Aucune conversation ne correspond.</p>}
        </div>
        <Field label="Un mot (facultatif)" hint="Le message contiendra aussi l'objet, l'expéditeur et le début du mail.">
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="ex. On en parle demain ?" className={textareaClass} />
        </Field>
        {mail.attachmentList.length > 0 && (
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-[12.5px] font-medium text-ink-2">Joindre les fichiers du mail</legend>
            {mail.attachmentList.slice(0, 10).map((a) => (
              <label key={a.part} className="flex cursor-pointer items-center gap-2 rounded-lg px-1 py-1 text-[13px] hover:bg-ink/[0.03]">
                <input type="checkbox" checked={parts.includes(a.part)} onChange={(e) => setParts((p) => (e.target.checked ? [...p, a.part] : p.filter((x) => x !== a.part)))} className="size-4 accent-[var(--accent)]" />
                <Paperclip className="size-3.5 text-ink-3" />
                <span className="min-w-0 flex-1 truncate">{a.name}</span>
                <span className="tabular text-[12px] text-ink-3">{fileSize(a.size)}</span>
              </label>
            ))}
          </fieldset>
        )}
        <div className="mt-1 flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" disabled={busy || !target}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {target ? `Partager dans ${titleOf(target)}` : "Partager"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

const PRIORITIES = [
  { value: 0, label: "Aucune" },
  { value: 1, label: "Urgente" },
  { value: 2, label: "Haute" },
  { value: 3, label: "Moyenne" },
  { value: 4, label: "Basse" },
];

const titleFrom = (subject: string) => subject.replace(/^\s*((re|tr|fwd?|aw|wg)\s*(\[\d+\])?\s*:\s*)+/i, "").trim().slice(0, 200);

/** Turns a mail into a TickUp ticket: project, title, priority and a note; the mail goes in the description. */
export function TicketDialog({ mail, onClose }: { mail: MailContent; onClose: () => void }) {
  const [projects, setProjects] = useState<{ key: string; name: string }[] | null>(null);
  const [ready, setReady] = useState(true);
  const [error, setError] = useState("");
  const [project, setProject] = useStored("mail-tickup-project", "");
  const [title, setTitle] = useState(() => titleFrom(mail.subject));
  const [priority, setPriority] = useState(0);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ ready: boolean; projects: { key: string; name: string }[] }>("/api/tickup/projects").then(
      (r) => {
        setReady(r.ready);
        setProjects(r.projects);
      },
      (e: Error) => setError(e.message),
    );
  }, []);
  const chosen = projects?.find((p) => p.key === project) ? project : (projects?.[0]?.key ?? "");

  const submit = async () => {
    if (!chosen || !title.trim() || busy) return;
    setBusy(true);
    try {
      const issue = await api<{ ref: string; url: string }>("/api/mail/ticket", { method: "POST", json: { folder: mail.folder, uid: mail.uid, project: chosen, title, priority, note } });
      setProject(chosen);
      toast.success(`${issue.ref} créé dans TickUp`, { action: { label: "Ouvrir", onClick: () => window.open(issue.url, "_blank", "noopener") } });
      onClose();
    } catch (e) {
      toast.error((e as Error).message);
      setBusy(false);
    }
  };
  useDialogKeys(onClose, () => void submit());

  return (
    <Modal title="Créer un ticket" onClose={onClose}>
      {error ? (
        <p className="text-[13px] text-ink-2">{error}</p>
      ) : !projects ? (
        <div className="flex justify-center py-6">
          <Loader2 className="size-5 animate-spin text-ink-3" />
        </div>
      ) : !ready ? (
        <div className="flex flex-col gap-2 text-[13px] leading-relaxed text-ink-2">
          <p>TickUp n&apos;est pas encore branché sur Lamio. Pour l&apos;activer :</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Dans TickUp, ouvre Réglages › Agents IA et crée une clé nommée « Lamio ».</li>
            <li>
              Sur le serveur de Lamio, ajoute <code className="rounded bg-ink/[0.06] px-1">TICKUP_TOKEN=</code> suivi de la clé, à côté de <code className="rounded bg-ink/[0.06] px-1">TICKUP_URL</code>, puis redémarre.
            </li>
          </ol>
          <p className="text-ink-3">Les tickets créés depuis tes mails porteront le nom « Lamio » dans TickUp.</p>
        </div>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-col gap-3"
        >
          <div className="grid grid-cols-[1fr_auto] gap-2">
            <Field label="Projet">
              <select value={chosen} onChange={(e) => setProject(e.target.value)} className={inputClass}>
                {projects.map((p) => (
                  <option key={p.key} value={p.key}>
                    {p.name} ({p.key})
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Priorité">
              <select value={priority} onChange={(e) => setPriority(Number(e.target.value))} className={inputClass}>
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Titre">
            <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} className={inputClass} />
          </Field>
          <Field label="Note (facultatif)" hint="Le mail (expéditeur, date, texte, pièces jointes) va dans la description du ticket.">
            <textarea value={note} onChange={(e) => setNote(e.target.value)} maxLength={4000} placeholder="Ce qu'il faut faire" className={textareaClass} />
          </Field>
          <div className="mt-1 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" disabled={busy || !chosen || !title.trim()}>
              {busy && <Loader2 className="size-3.5 animate-spin" />}
              Créer dans {chosen || "TickUp"}
            </Button>
          </div>
          {!projects.length && <p className="text-[12.5px] text-ink-3">Aucun projet ouvert dans TickUp.</p>}
        </form>
      )}
    </Modal>
  );
}
