import { describe, expect, it } from "vitest";
import { listModules } from "@/modules/registry";
import { initials, slugify } from "./utils";

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
  it("la messagerie est active, les autres attendent leur adresse", () => {
    const modules = listModules({});
    expect(modules.find((m) => m.id === "messagerie")?.status).toBe("core");
    expect(modules.filter((m) => m.id !== "messagerie").every((m) => m.status === "soon")).toBe(true);
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
