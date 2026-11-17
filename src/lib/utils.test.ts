import { describe, expect, it } from "vitest";
import { listModules } from "@/modules/registry";
import { dayKey, dueGroup, dueLabel, initials, slugify } from "./utils";

describe("slugify", () => {
  it("donne un nom de canal propre", () => {
    expect(slugify("  Général ")).toBe("general");
    expect(slugify("Projets & Idées 2027")).toBe("projets-idees-2027");
    expect(slugify("!!!")).toBe("");
    expect(slugify("x".repeat(80))).toHaveLength(40);
  });
});

describe("initials", () => {
  it("prend la première et la dernière partie du nom", () => {
    expect(initials("Antoine Quarroz")).toBe("AQ");
    expect(initials("ana")).toBe("A");
    expect(initials("Jean Pierre Dupont")).toBe("JD");
  });
});

describe("modules", () => {
  it("la messagerie et les projets sont actifs, les autres attendent leur adresse", () => {
    const modules = listModules({});
    const core = ["messagerie", "projets"];
    expect(modules.filter((m) => m.status === "core").map((m) => m.id)).toEqual(core);
    expect(modules.filter((m) => !core.includes(m.id)).every((m) => m.status === "soon")).toBe(true);
  });

  it("un outil est branché dès que son adresse est donnée, si elle est valide", () => {
    const modules = listModules({ CAIRN_URL: "https://cairn.exemple.ch", METRICOVE_URL: "javascript:alert(1)" });
    expect(modules.find((m) => m.name === "Cairn")).toMatchObject({ status: "linked", url: "https://cairn.exemple.ch" });
    expect(modules.find((m) => m.name === "Metricove")?.status).toBe("soon");
  });
});

describe("safeNext", () => {
  it("ne renvoie que vers une page de l'app", async () => {
    const { safeNext } = await import("./utils");
    expect(safeNext("/sso/authorize?client=cairn&state=abc")).toBe("/sso/authorize?client=cairn&state=abc");
    for (const bad of [null, "", "https://ailleurs.ch", "//ailleurs.ch", "/\\ailleurs.ch", "javascript:alert(1)"]) expect(safeNext(bad)).toBe("/c");
  });
});

describe("échéances", () => {
  // 2027-03-10 is a Wednesday.
  const today = "2027-03-10";

  it("range une échéance par rapport à aujourd'hui, la semaine finit dimanche", () => {
    expect(dueGroup(null, today)).toBe("none");
    expect(dueGroup("2027-03-09", today)).toBe("late");
    expect(dueGroup("2027-03-10", today)).toBe("today");
    expect(dueGroup("2027-03-14", today)).toBe("week");
    expect(dueGroup("2027-03-15", today)).toBe("later");
    // On a Sunday, the week is over: tomorrow is already "later".
    expect(dueGroup("2027-03-15", "2027-03-14")).toBe("later");
  });

  it("dit aujourd'hui, demain, hier, sinon la date", () => {
    expect(dueLabel("2027-03-10", today)).toBe("Aujourd'hui");
    expect(dueLabel("2027-03-11", today)).toBe("Demain");
    expect(dueLabel("2027-03-09", today)).toBe("Hier");
    expect(dueLabel("2027-03-20", today)).toMatch(/^20 mars/);
    expect(dueLabel("2028-01-05", today)).toContain("2028");
  });

  it("écrit un jour dans l'heure de l'appareil", () => {
    expect(dayKey(new Date(2027, 0, 5, 23, 59))).toBe("2027-01-05");
  });
});
