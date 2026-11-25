import { createEvent, parseEventInput } from "@/server/alfred";
import { ok, withCalendar } from "@/server/calendar-route";
import { body, fail } from "@/server/http";

/** Creates an event in Alfred. */
export async function POST(req: Request) {
  return withCalendar(async () => {
    const input = parseEventInput(await body(req));
    if (!input) return fail("Événement invalide : titre, calendrier, début et fin");
    return ok(await createEvent(input), 201);
  }, true);
}
