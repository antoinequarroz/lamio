"use client";

import { ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { ModuleIcon } from "@/components/module-icon";
import { Card, PageHeader } from "@/components/ui";
import { useApp } from "@/lib/store";
import type { ModuleInfo } from "@/lib/types";
import { cn } from "@/lib/utils";

const STATUS: Record<ModuleInfo["status"], { label: string; className: string }> = {
  core: { label: "Actif", className: "bg-accent-soft text-accent" },
  linked: { label: "Branché", className: "bg-[color-mix(in_oklab,var(--ok)_14%,transparent)] text-ok" },
  soon: { label: "Bientôt", className: "bg-ink/[0.06] text-ink-3" },
};

export default function ModulesPage() {
  const { modules } = useApp();
  return (
    <>
      <PageHeader title="Modules" subtitle="Ici, c'est la base. Les autres outils de la suite viennent s'y brancher un par un." />
      <div className="scroll-thin flex-1 overflow-y-auto p-7 max-md:p-4">
        <div className="mx-auto grid max-w-[860px] gap-3 sm:grid-cols-2">
          {modules.map((m, i) => {
            const status = STATUS[m.status];
            const inner = (
              <Card className={cn("rise flex h-full flex-col gap-3", (m.href || m.url) && "press hover:bg-surface-2")} style={{ animationDelay: `${i * 40}ms` }}>
                <div className="flex items-center gap-3">
                  <span className={cn("flex size-10 items-center justify-center rounded-xl", m.status === "soon" ? "bg-ink/[0.05] text-ink-3" : "bg-accent-soft text-accent")}>
                    <ModuleIcon icon={m.icon} className="size-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="text-[15px] font-medium leading-tight">{m.name}</h2>
                    <p className="text-[12.5px] leading-tight text-ink-3">{m.role}</p>
                  </div>
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", status.className)}>{status.label}</span>
                </div>
                <p className="text-[13px] text-ink-2">{m.description}</p>
                {m.url && (
                  <span className="mt-auto flex items-center gap-1 text-[12.5px] font-medium text-accent">
                    Ouvrir {m.name}
                    <ArrowUpRight className="size-3.5" />
                  </span>
                )}
              </Card>
            );
            return m.url ? (
              <a key={m.id} href={m.url} target="_blank" rel="noreferrer">
                {inner}
              </a>
            ) : m.href ? (
              <Link key={m.id} href={m.href}>
                {inner}
              </Link>
            ) : (
              <div key={m.id}>{inner}</div>
            );
          })}
        </div>
        <p className="mx-auto mt-5 max-w-[860px] text-[12.5px] text-ink-3">
          Pour brancher un outil, indique son adresse dans le fichier .env (CAIRN_URL, METRICOVE_URL, ALFRED_URL, NINO_URL). Il apparaît alors ici et dans la barre de gauche.
        </p>
      </div>
    </>
  );
}
