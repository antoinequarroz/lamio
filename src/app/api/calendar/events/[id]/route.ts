import { deleteEvent, parseEventInput, updateEvent } from "@/server/alfred";
import { ok, withCalendar } from "@/server/calendar-route";
import { body, fail } from "@/server/http";

type Params = { params: Promise<{ id: string }> };

const scopeOf = (v: unknown) => (v === "this" ? "this" : "all");
const occurrenceOf = (v: unknown) => (typeof v === "string" && v.length <= 100 ? v : null);

/** Edits an event in Alfred: the whole series, or one occurrence ({ scope: "this", occurrenceId }). */
export async function PUT(req: Request, { params }: Params) {
  return withCalendar(async () => {
    const { id } = await params;
    const data = await body(req);
    const input = parseEventInput(data.event);
    if (!input || id.length > 200) return fail("Événement invalide : titre, calendrier, début et fin");
    return ok(await updateEvent(id, input, scopeOf(data.scope), occurrenceOf(data.occurrenceId)));
  }, true);
}

/** Deletes an event in Alfred, or one occurrence (?scope=this&occurrenceId=…). */
export async function DELETE(req: Request, { params }: Params) {
  return withCalendar(async () => {
    const { id } = await params;
    if (id.length > 200) return fail("Événement introuvable", 404);
    const q = new URL(req.url).searchParams;
    return ok(await deleteEvent(id, scopeOf(q.get("scope")), occurrenceOf(q.get("occurrenceId"))));
  }, true);
}
