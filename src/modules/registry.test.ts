import { describe, expect, it } from "vitest";
import { listModules, ssoClient } from "./registry";

const SECRET = "x".repeat(32);

describe("modules", () => {
  it("un outil sans adresse reste « Bientôt », avec une adresse il est branché", () => {
    const modules = listModules({ CAIRN_URL: "https://cairn.exemple.ch/" });
    expect(modules.find((m) => m.name === "Cairn")).toMatchObject({ status: "linked", url: "https://cairn.exemple.ch" });
    expect(modules.find((m) => m.name === "Metricove")).toMatchObject({ status: "soon" });
    expect(listModules({ TICKUP_URL: "https://tickup.exemple.ch" }).find((m) => m.name === "TickUp")).toMatchObject({ id: "projets", status: "linked", url: "https://tickup.exemple.ch" });
    expect(modules.find((m) => m.name === "Cairn")?.sso).toBeUndefined();
  });

  it("Alfred s'affiche aussi dans Lamio (onglet Calendrier) quand son jeton est donné", () => {
    const alfred = (env: Record<string, string>) => listModules(env).find((m) => m.id === "agenda");
    expect(alfred({ ALFRED_URL: "https://alfred.exemple.ch" })?.embedded).toBeUndefined();
    expect(alfred({ ALFRED_URL: "https://alfred.exemple.ch", ALFRED_API_TOKEN: "alfw_" + "x".repeat(43) })).toMatchObject({ status: "linked", embedded: true });
  });

  it("la connexion unique demande une adresse et un vrai secret", () => {
    expect(ssoClient("cairn", { CAIRN_URL: "https://cairn.exemple.ch", CAIRN_SSO_SECRET: SECRET })).toMatchObject({ id: "notes", name: "Cairn", url: "https://cairn.exemple.ch" });
    expect(listModules({ CAIRN_URL: "https://cairn.exemple.ch", CAIRN_SSO_SECRET: SECRET }).find((m) => m.name === "Cairn")?.sso).toBe(true);
    expect(ssoClient("cairn", { CAIRN_URL: "https://cairn.exemple.ch", CAIRN_SSO_SECRET: "court" })).toBeNull();
    expect(ssoClient("cairn", { CAIRN_SSO_SECRET: SECRET })).toBeNull();
    expect(ssoClient("inconnu", {})).toBeNull();
    expect(ssoClient("messagerie", {})).toBeNull();
  });
});
