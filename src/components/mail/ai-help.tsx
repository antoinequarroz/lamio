"use client";

import { CalendarPlus, CircleDollarSign, ListTodo, Loader2, PenLine, RefreshCw, Sparkles, TicketPlus, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { EventDialog, type Draft as EventDraft } from "@/components/calendar/event-dialog";
import { useApp } from "@/lib/store";
import type { CalendarData, MailAiAction, MailAiSummary, MailContent } from "@/lib/types";
import { api, cn } from "@/lib/utils";

/** Claude's plain text as the compose window's HTML: paragraphs and line breaks, nothing else. */
export function aiTextToHtml(text: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((p) => `<p>${esc(p.trim()).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/** "2026-11-27T14:00" or "2026-11-27", read as local time. */
function localDate(value: string) {
  const m = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return m ? new Date(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0) : null;
}

const when = (a: MailAiAction) => {
  const d = localDate(a.start);
  if (!d) return "";
  return a.allDay || a.start.length === 10
    ? d.toLocaleDateString("fr-CH", { weekday: "short", day: "numeric", month: "short" })
    : d.toLocaleString("fr-CH", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};

const ICONS = { rdv: CalendarPlus, tache: ListTodo, montant: CircleDollarSign };

/**
 * The AI help on an open mail: the conversation summed up, what it asks of me (with a button to
 * put a meeting in the calendar or a task in TickUp), and a reply drafted in my tone.
 */
export function AiPanel({ mail, onDraft, onTicket, onClose }: { mail: MailContent; onDraft: (text: string) => void; onTicket: (init: { title: string; note: string }) => void; onClose: () => void }) {
  const app = useApp();
  const [result, setResult] = useState<MailAiSummary | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [drafting, setDrafting] = useState(false);
  const [event, setEvent] = useState<{ draft: EventDraft; data: CalendarData } | null>(null);

  const load = useCallback(
    async (fresh = false) => {
      setLoading(true);
      setError("");
      try {
        setResult(await api<MailAiSummary>("/api/mail/ai", { method: "POST", json: { action: "summary", folder: mail.folder, uid: mail.uid, fresh } }));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [mail.folder, mail.uid],
  );

  useEffect(() => {
    setResult(null);
    void load();
  }, [load]);

  const draft = async () => {
    setDrafting(true);
    try {
      const r = await api<{ text: string }>("/api/mail/ai", { method: "POST", json: { action: "draft", folder: mail.folder, uid: mail.uid, instruction } });
      onDraft(r.text);
      setInstruction("");
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDrafting(false);
    }
  };

  const addEvent = async (a: MailAiAction) => {
    const start = localDate(a.start);
    if (!start) return;
    try {
      const day = 86_400_000;
      const data = await api<CalendarData>(`/api/calendar?start=${encodeURIComponent(new Date(Date.now() - day).toISOString())}&end=${encodeURIComponent(new Date(Date.now() + day).toISOString())}`);
      const calendar = data.calendars.find((c) => !c.readOnly && c.visible) ?? data.calendars.find((c) => !c.readOnly);
      if (!data.writable || !calendar) return void toast.error("Le calendrier d'Alfred est en lecture seule pour Lamio");
      const allDay = a.allDay || a.start.length === 10;
      const end = localDate(a.end) ?? new Date(start.getTime() + (allDay ? day : 3600_000));
      const description = [a.details, `D'après le mail « ${mail.subject || "(sans objet)"} » de ${mail.from.name || mail.from.address}.`].filter(Boolean).join("\n\n");
      setEvent({ data, draft: { mode: "new", start, end: end > start ? end : new Date(start.getTime() + (allDay ? day : 3600_000)), allDay, calendarId: calendar.id, title: a.title, description } });
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  return (
    <section aria-label="Aide IA" className="mb-4 rounded-xl border border-accent/25 bg-accent-soft/60 p-3 text-[13px]">
      <header className="flex items-center gap-1.5">
        <Sparkles className="size-4 text-accent" />
        <span className="font-medium text-accent">Aide IA</span>
        {result && <span className="text-[11.5px] text-ink-3">· {result.mails > 1 ? `${result.mails} mails lus` : "1 mail lu"}</span>}
        <span className="flex-1" />
        <button onClick={() => void load(true)} disabled={loading} aria-label="Refaire le résumé" title="Refaire le résumé" className="press flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.05] hover:text-ink disabled:opacity-40">
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
        </button>
        <button onClick={onClose} aria-label="Fermer l'aide IA" className="press flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-ink/[0.05] hover:text-ink">
          <X className="size-3.5" />
        </button>
      </header>

      {loading && !result && (
        <p className="mt-2 flex items-center gap-2 text-ink-3">
          <Loader2 className="size-3.5 animate-spin" /> Claude lit la conversation…
        </p>
      )}
      {error && <p className="mt-2 text-danger">{error}</p>}
      {result && (
        <>
          <p className="mt-2 leading-relaxed text-ink">{result.summary}</p>
          {result.actions.length > 0 && (
            <ul className="mt-2.5 flex flex-col gap-1.5">
              {result.actions.map((a, i) => {
                const Icon = ICONS[a.kind];
                return (
                  <li key={i} className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-line bg-surface px-2.5 py-1.5">
                    <Icon className="size-3.5 shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{a.title}</span>
                      {a.kind === "montant" && a.amount && <span className="tabular ml-1.5 whitespace-nowrap text-ink-2">{a.amount}</span>}
                      {when(a) && <span className="ml-1.5 whitespace-nowrap text-ink-3">{when(a)}</span>}
                      {a.details && <span className="block text-[12px] text-ink-3">{a.details}</span>}
                    </span>
                    {a.kind === "rdv" && app.calendar && (
                      <button onClick={() => void addEvent(a)} className="press flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-accent hover:bg-accent/10">
                        <CalendarPlus className="size-3.5" /> Ajouter au calendrier
                      </button>
                    )}
                    {a.kind !== "rdv" && (
                      <button onClick={() => onTicket({ title: a.title, note: [a.amount, when(a) && `Échéance : ${when(a)}`, a.details].filter(Boolean).join("\n") })} className="press flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-medium text-accent hover:bg-accent/10">
                        <TicketPlus className="size-3.5" /> Créer un ticket
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!drafting) void draft();
        }}
        className="mt-2.5 flex items-center gap-1.5"
      >
        <input value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={2000} placeholder="Consigne pour la réponse (facultatif) : accepte, propose mardi…" aria-label="Consigne pour la réponse" className="h-8 min-w-0 flex-1 rounded-md border border-line-strong bg-surface px-2 text-[12.5px] outline-none focus:border-accent" />
        <button disabled={drafting} className="press flex h-8 shrink-0 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12.5px] font-medium text-accent-ink disabled:opacity-60">
          {drafting ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" />}
          <span className="max-sm:hidden">Rédiger une réponse</span>
          <span className="sm:hidden">Rédiger</span>
        </button>
      </form>
      <p className="mt-1.5 text-[11px] text-ink-3">Le brouillon s&apos;ouvre dans la fenêtre de rédaction : rien ne part sans toi. Les mails sont envoyés à Claude (Anthropic) seulement quand tu utilises l&apos;aide.</p>

      {event && <EventDialog draft={event.draft} calendars={event.data.calendars} writable={event.data.writable} alfredUrl={event.data.alfredUrl} onClose={() => setEvent(null)} onSaved={() => setEvent(null)} />}
    </section>
  );
}
