import { describe, expect, it } from "vitest";
import { alfredConfig, AlfredError, createEvent, deleteEvent, parseEventInput, readCalendar } from "./alfred";

const TOKEN = "alfw_" + "x".repeat(43);
const ENV = { ALFRED_URL: "https://alfred.exemple.ch/", ALFRED_API_TOKEN: TOKEN };

type Call = { url: string; init: RequestInit };
function fakeFetch(answers: Record<string, { status?: number; body: unknown }>) {
  const calls: Call[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const answer = answers[`${init.method ?? "GET"} ${path}`];
    if (!answer) throw new Error("injoignable");
    return new Response(JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetcher, calls };
}

describe("Alfred : réglages", () => {
  it("demande une adresse et un vrai jeton ; alfw_ permet d'écrire, alf_ seulement de lire", () => {
    expect(alfredConfig({})).toBeNull();
    expect(alfredConfig({ ALFRED_URL: "https://a.ch" })).toBeNull();
    expect(alfredConfig({ ALFRED_URL: "https://a.ch", ALFRED_API_TOKEN: "court" })).toBeNull();
    expect(alfredConfig({ ALFRED_URL: "https://a.ch", ALFRED_API_TOKEN: "alfcal_" + "x".repeat(43) })).toBeNull();
    expect(alfredConfig(ENV)).toEqual({ url: "https://alfred.exemple.ch", apiUrl: "https://alfred.exemple.ch", token: TOKEN, writable: true });
    expect(alfredConfig({ ...ENV, ALFRED_API_TOKEN: "alf_" + "y".repeat(43), ALFRED_API_URL: "http://alfred:3200" })).toMatchObject({ apiUrl: "http://alfred:3200", writable: false });
  });
});

describe("Alfred : lecture", () => {
  it("lit les calendriers et les événements avec le jeton, et ne garde que ce qu'il faut", async () => {
    const { fetcher, calls } = fakeFetch({
      "GET /api/v1/calendars": { body: [{ id: "local:1", name: "Perso", color: "#2f7cf6", source: "local", visible: true, readOnly: false, blocksBooking: true }, { id: "caldav:2", name: "Fériés", color: "javascript:x", source: "caldav", visible: false, readOnly: true }] },
      "GET /api/v1/events": { body: [{ id: "e1", address: "media://alfred/event/u1", occurrenceId: "2026-11-23T08:00:00.000Z", calendarId: "local:1", title: "Cours", start: "2026-11-23T08:00:00.000Z", end: "2026-11-23T09:00:00.000Z", allDay: false, location: "", description: "", recurring: true, repeat: "weekly" }] },
    });
    const data = await readCalendar(new Date("2026-11-23T00:00:00Z"), new Date("2026-11-30T00:00:00Z"), fetcher, ENV);
    expect(calls[0].init.headers).toMatchObject({ Authorization: `Bearer ${TOKEN}` });
    expect(calls[1].url).toBe("https://alfred.exemple.ch/api/v1/events?start=2026-11-23T00%3A00%3A00.000Z&end=2026-11-30T00%3A00%3A00.000Z");
    expect(data.writable).toBe(true);
    expect(data.alfredUrl).toBe("https://alfred.exemple.ch");
    expect(data.calendars[1]).toEqual({ id: "caldav:2", name: "Fériés", color: "#6f42e6", source: "caldav", visible: false, readOnly: true });
    expect(data.events).toEqual([expect.objectContaining({ key: "e1|2026-11-23T08:00:00.000Z", id: "e1", title: "Cours", recurring: true, repeat: "weekly" })]);
    expect(JSON.stringify(data)).not.toContain("media://");
  });

  it("dit clairement quand Alfred ne répond pas ou refuse le jeton", async () => {
    const down = fakeFetch({});
    await expect(readCalendar(new Date(), new Date(Date.now() + 1000), down.fetcher, ENV)).rejects.toMatchObject({ status: 502, message: "Alfred ne répond pas pour l'instant" });
    const refused = fakeFetch({ "GET /api/v1/calendars": { status: 401, body: { error: "Jeton invalide" } }, "GET /api/v1/events": { status: 401, body: {} } });
    await expect(readCalendar(new Date(), new Date(Date.now() + 1000), refused.fetcher, ENV)).rejects.toBeInstanceOf(AlfredError);
  });
});

describe("Alfred : écriture", () => {
  it("transmet la création et la suppression, et rend les refus d'Alfred tels quels", async () => {
    const { fetcher, calls } = fakeFetch({
      "POST /api/v1/events": { status: 201, body: { id: "e9" } },
      "DELETE /api/v1/events/e9": { body: { ok: true } },
    });
    const input = parseEventInput({ calendarId: "local:1", title: " Tournage ", start: "2026-11-25T09:00:00+01:00", end: "2026-11-25T11:00:00+01:00" })!;
    expect(await createEvent(input, fetcher, ENV)).toEqual({ id: "e9" });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ calendarId: "local:1", title: "Tournage", start: "2026-11-25T08:00:00.000Z", end: "2026-11-25T10:00:00.000Z", allDay: false, location: "", description: "", repeat: "none" });
    await deleteEvent("e9", "this", "2026-11-25T08:00:00.000Z", fetcher, ENV);
    expect(calls[1].url).toBe("https://alfred.exemple.ch/api/v1/events/e9?scope=this&occurrenceId=2026-11-25T08%3A00%3A00.000Z");

    const readOnly = fakeFetch({ "POST /api/v1/events": { status: 403, body: { error: "Ce calendrier est en lecture seule" } } });
    await expect(createEvent(input, readOnly.fetcher, ENV)).rejects.toMatchObject({ status: 403, message: "Ce calendrier est en lecture seule" });
    const reader = fakeFetch({ "POST /api/v1/events": { status: 405, body: { error: "API en lecture seule" } } });
    await expect(createEvent(input, reader.fetcher, ENV)).rejects.toMatchObject({ status: 403 });
  });

  it("refuse un événement incomplet ou à l'envers avant de l'envoyer", () => {
    const base = { calendarId: "local:1", title: "A", start: "2026-11-25T09:00:00Z", end: "2026-11-25T10:00:00Z" };
    expect(parseEventInput(base)).not.toBeNull();
    expect(parseEventInput({ ...base, title: "  " })).toBeNull();
    expect(parseEventInput({ ...base, end: "2026-11-25T08:00:00Z" })).toBeNull();
    expect(parseEventInput({ ...base, start: "demain" })).toBeNull();
    expect(parseEventInput({ ...base, repeat: "hourly" })).toBeNull();
    expect(parseEventInput({ ...base, allDay: true })).toBeNull();
    expect(parseEventInput({ ...base, allDay: true, start: "2026-11-25", end: "2026-11-26" })).toMatchObject({ allDay: true, start: "2026-11-25", end: "2026-11-26" });
    expect(parseEventInput({ ...base, allDay: true, start: "2026-11-25", end: "2026-11-25" })).toBeNull();
    expect(parseEventInput(null)).toBeNull();
  });
});
