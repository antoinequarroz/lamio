import { readCalendar } from "@/server/alfred";
import { ok, withCalendar } from "@/server/calendar-route";
import { fail } from "@/server/http";

export const dynamic = "force-dynamic";

/** Longest period asked at once: a month view with its spill-over weeks fits easily. */
const MAX_RANGE_MS = 62 * 86_400_000;

/** The calendars and events of Alfred for a period, for the Calendrier tab. */
export async function GET(req: Request) {
  return withCalendar(async () => {
    const params = new URL(req.url).searchParams;
    const start = new Date(params.get("start") ?? "");
    const end = new Date(params.get("end") ?? "");
    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= start || end.getTime() - start.getTime() > MAX_RANGE_MS) return fail("Période invalide");
    return ok(await readCalendar(start, end));
  });
}
