"use client";

import Link from "next/link";
import { CalendarView } from "@/components/calendar/calendar-view";
import { PageHeader } from "@/components/ui";
import { useApp } from "@/lib/store";

/** Alfred's calendar, inside Lamio. */
export default function CalendarPage() {
  const { calendar, me } = useApp();
  if (calendar) return <CalendarView />;
  return (
    <>
      <PageHeader title="Calendrier" />
      <div className="flex flex-1 items-center justify-center p-8 text-center text-[13.5px] text-ink-2">
        <p className="max-w-[440px]">
          {me.role === "admin" ? (
            <>
              Le calendrier n&apos;est pas branché : indique ALFRED_URL et ALFRED_API_TOKEN (un jeton « API en lecture et écriture » créé dans Alfred) dans le fichier .env.
            </>
          ) : (
            <>Le calendrier ne t&apos;est pas ouvert. Demande l&apos;accès à Alfred à un administrateur.</>
          )}{" "}
          <Link href="/modules" className="text-accent hover:underline">
            Voir les modules
          </Link>
        </p>
      </div>
    </>
  );
}
