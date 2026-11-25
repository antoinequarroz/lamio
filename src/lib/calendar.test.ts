import { describe, expect, it } from "vitest";
import { dayKey, layoutDay, onDay, shift, startOfWeek, viewDays, viewRange } from "./calendar";
import type { CalendarEvent } from "./types";

const ev = (title: string, start: string, end: string, allDay = false): CalendarEvent => ({ key: title, id: title, occurrenceId: null, repeat: "none", calendarId: "c", title, start, end, allDay, location: "", description: "", recurring: false });
/** A local time on 25.11.2026 (a Wednesday), as an ISO instant. */
const at = (h: number, m = 0, day = 25) => new Date(2026, 10, day, h, m).toISOString();
const wed = new Date(2026, 10, 25, 15, 30);

describe("calendrier : dates", () => {
  it("la semaine commence le lundi, le mois montre six semaines entières", () => {
    expect(dayKey(startOfWeek(wed))).toBe("2026-11-23");
    expect(dayKey(startOfWeek(new Date(2026, 10, 29)))).toBe("2026-11-23"); // dimanche
    expect(viewDays("week", wed).map(dayKey)).toEqual(["2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28", "2026-11-29"]);
    const month = viewDays("month", wed);
    expect(month).toHaveLength(42);
    expect(dayKey(month[0])).toBe("2026-10-26");
    const { start, end } = viewRange("day", wed);
    expect([dayKey(start), dayKey(end)]).toEqual(["2026-11-25", "2026-11-26"]);
  });

  it("avance d'un jour, d'une semaine ou d'un mois", () => {
    expect(dayKey(shift("day", wed, 1))).toBe("2026-11-26");
    expect(dayKey(shift("week", wed, -1))).toBe("2026-11-18");
    expect(dayKey(shift("month", new Date(2026, 0, 31), 1))).toBe("2026-02-01");
  });

  it("une journée entière couvre ses dates, fin exclue ; un événement à l'heure, les jours qu'il touche", () => {
    const leave = ev("Congé", "2026-11-25", "2026-11-27", true);
    expect(onDay(leave, new Date(2026, 10, 25))).toBe(true);
    expect(onDay(leave, new Date(2026, 10, 26))).toBe(true);
    expect(onDay(leave, new Date(2026, 10, 27))).toBe(false);
    const night = ev("Nuit", at(22), at(2, 0, 26));
    expect(onDay(night, new Date(2026, 10, 25))).toBe(true);
    expect(onDay(night, new Date(2026, 10, 26))).toBe(true);
    // Finit à minuit pile : pas le lendemain.
    expect(onDay(ev("Soir", at(20), at(0, 0, 26)), new Date(2026, 10, 26))).toBe(false);
  });
});

describe("calendrier : disposition d'une journée", () => {
  it("place les événements à l'heure et partage la largeur quand ils se chevauchent", () => {
    const day = new Date(2026, 10, 25);
    const placed = layoutDay([ev("A", at(9), at(10)), ev("B", at(9, 30), at(11)), ev("C", at(10), at(10, 30)), ev("D", at(14), at(15)), ev("Toute", "2026-11-25", "2026-11-26", true)], day);
    const by = Object.fromEntries(placed.map((p) => [p.event.title, p]));
    expect(Object.keys(by).sort()).toEqual(["A", "B", "C", "D"]);
    expect(by.A).toMatchObject({ top: 540, height: 60, column: 0, columns: 2 });
    expect(by.B).toMatchObject({ top: 570, column: 1, columns: 2 });
    // C commence quand A finit : il reprend la première colonne.
    expect(by.C).toMatchObject({ top: 600, column: 0, columns: 2 });
    expect(by.D).toMatchObject({ top: 840, column: 0, columns: 1 });
  });

  it("coupe un événement de nuit au bord du jour et garde une hauteur lisible", () => {
    const placed = layoutDay([ev("Nuit", at(22), at(2, 0, 26)), ev("Court", at(8), at(8, 5))], new Date(2026, 10, 26));
    expect(placed).toEqual([expect.objectContaining({ top: 0, height: 120 })]);
    const short = layoutDay([ev("Court", at(8), at(8, 5))], new Date(2026, 10, 25))[0];
    expect(short.height).toBe(20);
  });
});
