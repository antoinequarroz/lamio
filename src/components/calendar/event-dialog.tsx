"use client";

import { ArrowUpRight, MapPin, Repeat, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { addDays, dayKey, timeLabel } from "@/lib/calendar";
import type { CalendarEvent, CalendarInfo, EventInput, RepeatRule } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import { Button, Field, inputClass, Modal } from "../ui";

export type Draft = { mode: "new"; start: Date; end: Date; allDay: boolean; calendarId: string; title?: string; description?: string } | { mode: "edit"; event: CalendarEvent };

const REPEATS: { id: RepeatRule; label: string }[] = [
  { id: "none", label: "Ne se répète pas" },
  { id: "daily", label: "Chaque jour" },
  { id: "weekly", label: "Chaque semaine" },
  { id: "monthly", label: "Chaque mois" },
  { id: "yearly", label: "Chaque année" },
];

const hm = (d: Date) => `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
/** "2026-11-25" read as a local day. */
const parseDay = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
};
const at = (day: string, time: string) => {
  const [h, m] = time.split(":").map(Number);
  const d = parseDay(day);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h || 0, m || 0);
};

/** The form's starting values: a new event, or the occurrence that was clicked. */
function initial(draft: Draft) {
  if (draft.mode === "new") {
    return { title: draft.title ?? "", calendarId: draft.calendarId, allDay: draft.allDay, startDay: dayKey(draft.start), startTime: hm(draft.start), endDay: dayKey(draft.allDay ? addDays(draft.end, -1) : draft.end), endTime: hm(draft.end), repeat: "none" as RepeatRule, location: "", description: draft.description ?? "" };
  }
  const e = draft.event;
  if (e.allDay) {
    // Alfred's end date is excluded; the form shows the last day.
    return { title: e.title, calendarId: e.calendarId, allDay: true, startDay: e.start, startTime: "09:00", endDay: dayKey(addDays(parseDay(e.end), -1)), endTime: "10:00", repeat: e.repeat, location: e.location, description: e.description };
  }
  const start = new Date(e.start);
  const end = new Date(e.end);
  return { title: e.title, calendarId: e.calendarId, allDay: false, startDay: dayKey(start), startTime: hm(start), endDay: dayKey(end), endTime: hm(end), repeat: e.repeat, location: e.location, description: e.description };
}

export function EventDialog({ draft, calendars, writable, alfredUrl, onClose, onSaved }: { draft: Draft; calendars: CalendarInfo[]; writable: boolean; alfredUrl: string; onClose: () => void; onSaved: () => void }) {
  const event = draft.mode === "edit" ? draft.event : null;
  const calendar = calendars.find((c) => c.id === (event?.calendarId ?? (draft.mode === "new" ? draft.calendarId : "")));
  const editable = writable && !(event && calendar?.readOnly);
  const [editing, setEditing] = useState(draft.mode === "new");
  const [form, setForm] = useState(() => initial(draft));
  const [scope, setScope] = useState<"this" | "all">("this");
  const [busy, setBusy] = useState(false);
  /** Deleting asks a second click: nothing in Lamio can bring the event back. */
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) => setForm((f) => ({ ...f, [key]: value }));

  const recurring = !!event?.recurring;
  const onlyThis = recurring && scope === "this";

  const input = (): EventInput | string => {
    const title = form.title.trim();
    if (!title) return "Donne un titre à l'événement.";
    if (form.allDay) {
      if (form.endDay < form.startDay) return "La fin est avant le début.";
      return { calendarId: form.calendarId, title, start: form.startDay, end: dayKey(addDays(parseDay(form.endDay), 1)), allDay: true, location: form.location, description: form.description, repeat: onlyThis ? "custom" : form.repeat };
    }
    const start = at(form.startDay, form.startTime);
    const end = at(form.endDay, form.endTime);
    if (end < start) return "La fin est avant le début.";
    return { calendarId: form.calendarId, title, start: start.toISOString(), end: end.toISOString(), allDay: false, location: form.location, description: form.description, repeat: onlyThis ? "custom" : form.repeat };
  };

  const save = async () => {
    const value = input();
    if (typeof value === "string") return void toast.error(value);
    setBusy(true);
    try {
      if (event) {
        await api(`/api/calendar/events/${encodeURIComponent(event.id)}`, { method: "PUT", json: { event: value, scope: recurring ? scope : "all", occurrenceId: event.occurrenceId } });
        toast.success("Événement modifié");
      } else {
        await api("/api/calendar/events", { method: "POST", json: value });
        toast.success("Événement créé", { description: value.title });
      }
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!event) return;
    if (!confirmDelete) return setConfirmDelete(true);
    setBusy(true);
    try {
      const q = new URLSearchParams({ scope: recurring ? scope : "all", ...(event.occurrenceId && { occurrenceId: event.occurrenceId }) });
      await api(`/api/calendar/events/${encodeURIComponent(event.id)}?${q}`, { method: "DELETE" });
      toast.success(onlyThis ? "Occurrence supprimée" : "Événement supprimé", { description: event.title });
      onSaved();
    } catch (err) {
      toast.error((err as Error).message);
      setBusy(false);
    }
  };

  // Details of an event, before editing it (or when it cannot be edited).
  if (event && !editing) {
    return (
      <Modal title={event.title} onClose={onClose} className="!max-w-[480px]">
        <div className="flex flex-col gap-2.5 text-[13.5px]">
          <p className="flex items-center gap-2 text-ink-2">
            <span className="size-2.5 shrink-0 rounded-full" style={{ background: calendar?.color }} />
            {calendar?.name ?? "Calendrier"}
            {calendar?.readOnly && <span className="text-[12px] text-ink-3">· lecture seule</span>}
          </p>
          <p className="first-letter:uppercase">
            {new Date(event.allDay ? `${event.start}T12:00:00` : event.start).toLocaleDateString("fr-CH", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}
            <span className="text-ink-2"> · {timeLabel(event)}</span>
          </p>
          {event.recurring && (
            <p className="flex items-center gap-2 text-ink-2">
              <Repeat className="size-3.5" />
              {REPEATS.find((r) => r.id === event.repeat)?.label ?? "Répétition personnalisée"}
            </p>
          )}
          {event.location && (
            <p className="flex items-center gap-2 text-ink-2">
              <MapPin className="size-3.5 shrink-0" />
              {event.location}
            </p>
          )}
          {event.description && <p className="max-h-[30vh] overflow-y-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-[13px] text-ink-2">{event.description}</p>}
        </div>
        <div className="mt-5 flex items-center gap-2">
          {alfredUrl && (
            <a href={alfredUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[12.5px] font-medium text-ink-3 hover:text-ink">
              Alfred
              <ArrowUpRight className="size-3.5" />
            </a>
          )}
          <span className="flex-1" />
          {editable && (
            <Button variant="primary" onClick={() => setEditing(true)}>
              Modifier
            </Button>
          )}
        </div>
      </Modal>
    );
  }

  const writableCalendars = calendars.filter((c) => !c.readOnly);

  return (
    <Modal title={event ? "Modifier l'événement" : "Nouvel événement"} onClose={onClose} className="!max-w-[520px]">
      <form
        className="flex flex-col gap-3.5"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <input autoFocus className={cn(inputClass, "h-11 text-[16px] font-medium")} placeholder="Titre" value={form.title} maxLength={500} onChange={(e) => set("title", e.target.value)} aria-label="Titre" />

        {recurring && (
          <div role="radiogroup" aria-label="Portée" className="flex rounded-lg border border-line bg-surface-2 p-0.5 text-[12.5px] font-medium">
            {(["this", "all"] as const).map((s) => (
              <button key={s} type="button" role="radio" aria-checked={scope === s} onClick={() => setScope(s)} className={cn("h-7 flex-1 rounded-md", scope === s ? "bg-surface text-ink shadow-card" : "text-ink-3")}>
                {s === "this" ? "Cette occurrence" : "Toute la série"}
              </button>
            ))}
          </div>
        )}

        <div className="grid grid-cols-[1fr_auto] items-end gap-3">
          <Field label="Calendrier">
            <select className={inputClass} value={form.calendarId} onChange={(e) => set("calendarId", e.target.value)} disabled={onlyThis}>
              {writableCalendars.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <label className="flex h-10 cursor-pointer items-center gap-2 text-[13px]">
            <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={form.allDay} onChange={(e) => set("allDay", e.target.checked)} />
            Toute la journée
          </label>
        </div>

        <div className="grid gap-3">
          <Field label="Début">
            <div className="flex gap-1.5">
              <input
                type="date"
                className={cn(inputClass, "min-w-0 px-2")}
                value={form.startDay}
                onChange={(e) => {
                  const v = e.target.value;
                  if (!v) return;
                  // Moving the start moves the end by as much.
                  const shiftDays = Math.round((parseDay(v).getTime() - parseDay(form.startDay).getTime()) / 86_400_000);
                  setForm((f) => ({ ...f, startDay: v, endDay: dayKey(addDays(parseDay(f.endDay), shiftDays)) }));
                }}
                required
              />
              {!form.allDay && (
                <input
                  type="time"
                  step={300}
                  className={cn(inputClass, "!w-[104px] shrink-0 px-2")}
                  value={form.startTime}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    const length = at(form.endDay, form.endTime).getTime() - at(form.startDay, form.startTime).getTime();
                    const end = new Date(at(form.startDay, v).getTime() + Math.max(length, 0));
                    setForm((f) => ({ ...f, startTime: v, endDay: dayKey(end), endTime: hm(end) }));
                  }}
                  required
                />
              )}
            </div>
          </Field>
          <Field label="Fin">
            <div className="flex gap-1.5">
              <input type="date" className={cn(inputClass, "min-w-0 px-2")} value={form.endDay} min={form.startDay} onChange={(e) => e.target.value && set("endDay", e.target.value)} required />
              {!form.allDay && <input type="time" step={300} className={cn(inputClass, "!w-[104px] shrink-0 px-2")} value={form.endTime} onChange={(e) => e.target.value && set("endTime", e.target.value)} required />}
            </div>
          </Field>
        </div>

        {!onlyThis && (
          <Field label="Répétition">
            <select className={inputClass} value={form.repeat} onChange={(e) => set("repeat", e.target.value as RepeatRule)}>
              {REPEATS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label}
                </option>
              ))}
              {form.repeat === "custom" && <option value="custom">Personnalisée (gardée telle quelle)</option>}
            </select>
          </Field>
        )}

        <Field label="Lieu">
          <input className={inputClass} value={form.location} maxLength={1000} onChange={(e) => set("location", e.target.value)} placeholder="Adresse, salle, lien…" />
        </Field>
        <Field label="Notes">
          <textarea className={cn(inputClass, "h-auto min-h-[76px] py-2")} value={form.description} maxLength={20_000} onChange={(e) => set("description", e.target.value)} rows={3} />
        </Field>

        <div className="mt-1 flex items-center gap-2">
          {event && (
            <Button type="button" variant="danger" onClick={() => void remove()} disabled={busy}>
              <Trash2 className="size-3.5" />
              {confirmDelete ? "Confirmer" : onlyThis ? "Supprimer celle-ci" : "Supprimer"}
            </Button>
          )}
          <span className="flex-1" />
          <Button type="button" variant="ghost" onClick={event ? () => setEditing(false) : onClose} disabled={busy}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Enregistrement…" : event ? "Enregistrer" : "Créer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
