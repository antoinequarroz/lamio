import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { POST as hook } from "@/app/api/hooks/[token]/route";
import * as store from "./db";
import { hookUrl, publicOrigin, webhookText, withinRate } from "./webhook";

beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "app-test-"));
});

// What Orbi sends (apps/worker/src/channels.ts in postmelo-orbi).
const orbi = {
  text: "🔴 **Nouvelle erreur sur Lamio**\nTypeError: boom\nhttps://orbi.postmelo.ch/projects/1/issues/7",
  title: "Nouvelle erreur sur Lamio",
  body: "TypeError: boom",
  url: "https://orbi.postmelo.ch/projects/1/issues/7",
  severity: "critical",
  kind: "issue.new",
  project: { id: 1, name: "Lamio" },
  source: "orbi",
};

const post = (token: string, data: unknown) =>
  hook(new Request(`http://localhost/api/hooks/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }), { params: Promise.resolve({ token }) });

function setup() {
  const ana = store.createFirstUser({ email: "ana@exemple.ch", name: "Ana", salt: "s", hash: "h" })!;
  const general = store.listConversations(ana.id)[0];
  const created = store.createWebhook({ conversationId: general.id, name: "Orbi", createdBy: ana.id })!;
  return { ana, general, ...created };
}

describe("texte d'un webhook", () => {
  it("prend text, sans les marques de gras", () => {
    expect(webhookText(orbi)).toBe("🔴 Nouvelle erreur sur Lamio\nTypeError: boom\nhttps://orbi.postmelo.ch/projects/1/issues/7");
  });
  it("sans text, assemble title, body et url", () => {
    expect(webhookText({ title: "Site en panne", url: "https://x.ch" })).toBe("Site en panne\nhttps://x.ch");
    expect(webhookText({ text: "  " })).toBeNull();
    expect(webhookText({})).toBeNull();
  });
  it("coupe un texte trop long", () => {
    expect(webhookText({ text: "a".repeat(9000) })!.length).toBe(8000);
  });
});

describe("débit", () => {
  it("refuse au-delà de la limite par minute, puis repart", () => {
    for (let i = 0; i < 3; i++) expect(withinRate("w", 3, 1000)).toBe(true);
    expect(withinRate("w", 3, 1000)).toBe(false);
    expect(withinRate("w", 3, 62_000)).toBe(true);
  });
});

describe("adresse", () => {
  it("APP_URL d'abord, sinon l'hôte de la requête", () => {
    const req = new Request("http://interne:3000/x", { headers: { host: "lamio.ch", "x-forwarded-proto": "https" } });
    expect(publicOrigin(req, { APP_URL: "https://lamio.postmelo.ch/" })).toBe("https://lamio.postmelo.ch");
    expect(publicOrigin(req, {})).toBe("https://lamio.ch");
    expect(hookUrl("https://lamio.ch", "whk_abc")).toBe("https://lamio.ch/api/hooks/whk_abc");
  });
});

describe("webhooks entrants", () => {
  it("son compte écrit dans le canal, mais n'est pas une personne", () => {
    const { ana, general, webhook, token } = setup();
    expect(token.startsWith("whk_")).toBe(true);
    expect(store.listUsers().map((u) => u.name)).toEqual(["Ana"]);
    expect(store.listBots()).toEqual([expect.objectContaining({ id: webhook.userId, name: "Orbi", bot: true })]);
    expect(store.countUsers()).toBe(1);
    expect(store.getCredentialsById(webhook.userId)).toBeNull();
    expect(store.listWebhooks(general.id)).toEqual([expect.objectContaining({ name: "Orbi", createdBy: ana.id, lastUsedAt: null })]);
  });

  it("refuse une conversation privée à deux", () => {
    const { ana } = setup();
    const bob = store.createUser({ email: "bob@exemple.ch", name: "Bob", role: "member", salt: "s", hash: "h" })!;
    const dm = store.openDm(ana.id, bob.id);
    expect(store.createWebhook({ conversationId: dm.id, name: "Orbi", createdBy: ana.id })).toBeNull();
  });

  it("POST /api/hooks/<token> poste le message d'Orbi, compté comme non lu", async () => {
    const { ana, general, webhook, token } = setup();
    const res = await post(token, orbi);
    expect(res.status).toBe(200);
    const { id } = await res.json();
    const m = store.getMessage(id)!;
    expect(m).toMatchObject({ conversationId: general.id, userId: webhook.userId, body: expect.stringContaining("Nouvelle erreur sur Lamio") });
    expect(store.listConversations(ana.id)[0].unread).toBe(1);
    expect(store.getWebhook(webhook.id)!.lastUsedAt).not.toBeNull();
  });

  it("une adresse inconnue, supprimée ou un message vide sont refusés", async () => {
    const { webhook, token } = setup();
    expect((await post(token, { text: "" })).status).toBe(400);
    expect((await post("whk_inconnu", orbi)).status).toBe(404);
    expect((await post("pas-un-token", orbi)).status).toBe(404);
    expect(store.deleteWebhook(webhook.id)).toBe(true);
    expect((await post(token, orbi)).status).toBe(404);
    // Its account stays: the messages it posted keep their author.
    expect(store.listBots()).toHaveLength(1);
  });

  it("le webhook n'est mentionnable par personne", () => {
    const { ana, general } = setup();
    const m = store.addMessage({ conversationId: general.id, userId: ana.id, body: "@Orbi tu es là ?", fileIds: [] })!;
    expect(m.mentionIds).toEqual([]);
  });
});
