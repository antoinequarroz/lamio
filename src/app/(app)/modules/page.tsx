"use client";

import { ArrowUpRight, KeyRound } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ModulePicto } from "@/components/module-icon";
import { Avatar, Card, Modal, PageHeader } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { ModuleInfo } from "@/lib/types";
import { api, APP_NAME, cn, moduleLink } from "@/lib/utils";

const STATUS: Record<ModuleInfo["status"], { label: string; className: string }> = {
  core: { label: "Actif", className: "bg-accent-soft text-accent" },
  linked: { label: "Branché", className: "bg-[color-mix(in_oklab,var(--ok)_14%,transparent)] text-ok" },
  soon: { label: "Bientôt", className: "bg-ink/[0.06] text-ink-3" },
};

export default function ModulesPage() {
  const { me, modules } = useApp();
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const editing = modules.find((m) => m.id === accessFor && (m.sso || m.embedded));

  // Sent back here by the single sign-on when a tool is not open to this person.
  useEffect(() => {
    const refused = new URLSearchParams(window.location.search).get("refus");
    if (!refused) return;
    toast.error(`Tu n'as pas accès à ${refused.slice(0, 40)}.`, { description: "Demande à un administrateur de te l'ouvrir." });
    window.history.replaceState(null, "", "/modules");
  }, []);

  return (
    <>
      <PageHeader title="Modules" subtitle={`${APP_NAME} est la base. Les autres outils de la suite viennent s'y brancher un par un.`} />
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto grid max-w-[860px] gap-3 sm:grid-cols-2">
          {modules.map((m, i) => {
            const status = STATUS[m.status];
            const link = moduleLink(m);
            const inner = (
              <Card className={cn("rise flex h-full flex-col gap-3", m.href && "press hover:bg-surface-2")} style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex items-center gap-3">
                  <ModulePicto icon={m.icon} className={cn("size-10", m.status === "soon" && "opacity-45 grayscale")} />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-medium leading-tight">{m.name}</h2>
                    <p className="text-[12.5px] leading-tight text-ink-3">{m.role}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", status.className)}>{status.label}</span>
                </div>
                <p className="text-[13px] text-ink-2">{m.description}</p>
                {m.url && (
                  <div className="mt-auto flex items-center gap-3 text-[12.5px] font-medium">
                    {link ? (
                      <a href={link} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-accent hover:underline">
                        Ouvrir {m.name}
                        <ArrowUpRight className="size-3.5" />
                      </a>
                    ) : (
                      <span className="font-normal text-ink-3">Réservé : demande l&apos;accès à un administrateur.</span>
                    )}
                    {(m.sso || m.embedded) && me.role === "admin" && (
                      <button onClick={() => setAccessFor(m.id)} className="press ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-ink-2 hover:bg-ink/5 hover:text-ink">
                        <KeyRound className="size-3.5" />
                        Accès
                      </button>
                    )}
                  </div>
                )}
              </Card>
            );
            return m.href ? (
              <Link key={m.id} href={m.href}>
                {inner}
              </Link>
            ) : (
              <div key={m.id}>{inner}</div>
            );
          })}
        </div>
        {me.role === "admin" && (
          <p className="mx-auto mt-5 max-w-[860px] text-[12.5px] text-ink-3">
            Pour brancher un outil, indique son adresse dans le fichier .env (CAIRN_URL, METRICOVE_URL, ALFRED_URL, NINO_URL, TICKUP_URL). Avec un secret partagé en plus (CAIRN_SSO_SECRET), on y entre avec son compte {APP_NAME}, sans autre mot de passe.
          </p>
        )}
      </div>
      {editing && <AccessDialog module={editing} onClose={() => setAccessFor(null)} />}
    </>
  );
}

/** Who may open a tool with their account. Admins always may. */
function AccessDialog({ module, onClose }: { module: ModuleInfo; onClose: () => void }) {
  const { users } = useApp();
  const allowed = new Set(module.allowedIds);
  /** What was just ticked, shown at once, before the server confirms. */
  const [ticked, setTicked] = useState<Record<string, boolean>>({});

  const toggle = async (userId: string, on: boolean) => {
    setTicked((t) => ({ ...t, [userId]: on }));
    try {
      await api(`/api/modules/${module.id}/access`, { method: "PUT", json: { userId, allowed: on } });
    } catch (err) {
      setTicked((t) => ({ ...t, [userId]: !on }));
      toast.error((err as Error).message);
    }
  };

  return (
    <Modal title={`Accès à ${module.name}`} onClose={onClose}>
      <p className="mb-3 text-[13px] text-ink-3">
        {module.sso ? `Les personnes cochées ouvrent ${module.name} avec leur compte ${APP_NAME}.` : `Les personnes cochées voient l'onglet Calendrier, qui affiche l'agenda de ${module.name}.`} Les administrateurs y ont toujours accès.
      </p>
      <ul className="scroll-thin -mx-2 flex max-h-[46vh] flex-col overflow-y-auto">
        {users.map((u) => {
          const admin = u.role === "admin";
          return (
            <li key={u.id}>
              <label className={cn("flex items-center gap-2.5 rounded-lg px-2 py-1.5", !admin && "cursor-pointer hover:bg-ink/[0.04]")}>
                <Avatar id={u.id} name={u.name} size="sm" />
                <span className="min-w-0 flex-1 truncate text-[13.5px]">{u.name}</span>
                {admin && <span className="text-[12px] text-ink-3">Administrateur</span>}
                <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={admin || (ticked[u.id] ?? allowed.has(u.id))} disabled={admin} onChange={(e) => toggle(u.id, e.target.checked)} aria-label={`Ouvrir ${module.name} à ${u.name}`} />
              </label>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
