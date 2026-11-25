"use client";

import { Maximize2, Minimize2, PhoneOff, Video } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useApp } from "@/lib/store";
import type { CallInfo, CallStatus } from "@/lib/types";
import { api, cn } from "@/lib/utils";
import { Button } from "./ui";

/**
 * The call window: Alfred's room page (its video engine, blur, screen sharing…) inside Lamio.
 * Large over the app, or small in a corner to keep writing while talking.
 */
export function CallWindow() {
  const { call, leaveCall } = useApp();
  const [small, setSmall] = useState(false);

  useEffect(() => setSmall(false), [call?.url]);
  if (!call) return null;

  return (
    <div
      role="dialog"
      aria-label={`Appel ${call.title}`}
      className={cn(
        "fixed z-50 flex flex-col overflow-hidden border border-line-strong bg-[#0f0f0e] shadow-[0_30px_80px_-20px_rgba(0,0,0,0.55)] transition-[inset,width,height,border-radius] duration-300 ease-[var(--ease-out)]",
        small ? "right-4 bottom-4 h-[300px] w-[420px] rounded-2xl max-md:right-2 max-md:bottom-2 max-md:h-[220px] max-md:w-[300px]" : "inset-3 rounded-2xl max-md:inset-0 max-md:rounded-none",
      )}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-white/10 px-3 text-[13px] text-white/85">
        <Video className="size-4 text-[#a488ff]" />
        <span className="min-w-0 flex-1 truncate font-medium">{call.title}</span>
        <button onClick={() => setSmall((s) => !s)} aria-label={small ? "Agrandir l'appel" : "Réduire l'appel"} title={small ? "Agrandir" : "Réduire"} className="press flex size-7 items-center justify-center rounded-md text-white/70 hover:bg-white/10 hover:text-white">
          {small ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
        </button>
        <button onClick={leaveCall} className="press flex h-7 items-center gap-1.5 rounded-md bg-[#dc3a2f] px-2.5 text-[12px] font-medium text-white hover:brightness-110">
          <PhoneOff className="size-3.5" />
          Quitter
        </button>
      </div>
      {/* The room is Alfred's: camera, microphone and screen sharing are allowed to it in this window. */}
      <iframe key={call.url} src={call.url} title={`Appel ${call.title}`} allow="camera; microphone; display-capture; fullscreen; autoplay; clipboard-write" className="min-h-0 w-full flex-1 border-0 bg-[#0f0f0e]" />
    </div>
  );
}

/** How often a call card asks Alfred whether the call is still on. */
const STATUS_MS = 20_000;
/** A call card older than this stops asking: the room of an instant call lasts 12 hours. */
const LIVE_FOR_MS = 12 * 3_600_000;

/** The card of a call in a conversation: who started it, whether it is on, and "Rejoindre". */
export function CallCard({ call, createdAt }: { call: CallInfo; createdAt: string }) {
  const { joinCall, call: open } = useApp();
  const recent = Date.now() - Date.parse(createdAt) < LIVE_FOR_MS;
  const [status, setStatus] = useState<CallStatus | null>(recent ? null : { status: "ended", live: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!recent) return;
    let stop = false;
    const read = () => !document.hidden && api<CallStatus>(`/api/calls/${encodeURIComponent(call.slug)}`).then((s) => !stop && setStatus(s), () => undefined);
    void read();
    const timer = setInterval(read, STATUS_MS);
    return () => {
      stop = true;
      clearInterval(timer);
    };
  }, [call.slug, recent]);

  const on = status === null || status.status === "open" || status.status === "upcoming";
  const here = open?.slug === call.slug;
  const label = !on ? "Appel terminé" : status?.live ? `En cours · ${status.live} ${status.live > 1 ? "personnes" : "personne"}` : "Appel ouvert";

  return (
    <div className="mt-1 mb-1 flex max-w-[420px] items-center gap-3 rounded-xl border border-line bg-surface p-3 shadow-card">
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-lg", on ? "bg-accent-soft text-accent" : "bg-ink/[0.06] text-ink-3")}>
        <Video className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13.5px] font-medium">Appel vidéo</p>
        <p className={cn("flex items-center gap-1.5 text-[12px]", on && status?.live ? "text-ok" : "text-ink-3")}>
          {on && !!status?.live && <span className="size-1.5 animate-pulse rounded-full bg-ok" />}
          {label}
        </p>
      </div>
      {on && (
        <Button
          size="sm"
          variant={here ? "secondary" : "primary"}
          disabled={busy || here}
          onClick={async (e) => {
            e.stopPropagation();
            setBusy(true);
            await joinCall(call.slug, call.title);
            setBusy(false);
          }}
        >
          {here ? "Ouvert" : "Rejoindre"}
        </Button>
      )}
    </div>
  );
}

/** "Appeler" in a conversation's header: starts a call there and opens it. */
export function CallButton({ conversationId }: { conversationId: string }) {
  const { calls, joinCall } = useApp();
  const [busy, setBusy] = useState(false);
  if (!calls) return null;
  return (
    <Button
      size="sm"
      disabled={busy}
      aria-label="Lancer un appel vidéo"
      onClick={async () => {
        setBusy(true);
        try {
          const m = await api<{ call: CallInfo | null }>(`/api/conversations/${conversationId}/call`, { method: "POST" });
          if (m.call) await joinCall(m.call.slug, m.call.title);
        } catch (err) {
          toast.error((err as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <Video className="size-3.5" />
      <span className="max-sm:hidden">Appeler</span>
    </Button>
  );
}
