import { afterEach, describe, expect, it } from "vitest";
import type { MailContent } from "@/lib/types";
import { createTickupIssue, tickupConfig, tickupProjects } from "@/server/tickup";
import { mailExcerpt, shareText, ticketDescription, ticketTitle } from "./share";

const mail = (over: Partial<MailContent> = {}): MailContent => ({
  folder: "INBOX",
  uid: 7,
  messageId: "<a@x>",
  subject: "Re: TR: Devis tournage",
  from: { name: "Léa Martin", address: "lea@client.ch" },
  to: [{ name: "", address: "antoine@exemple.ch" }],
  cc: [],
  date: "2026-11-20T09:30:00.000Z",
  seen: true,
  flagged: false,
  answered: false,
  attachments: true,
  preview: "",
  size: 100,
  text: "Bonjour,\n\nVoici le devis.\n\n\n\nMerci\n\nLe 19 nov. 2026, Antoine a écrit :\n> ancien texte",
  html: null,
  remoteImages: false,
  attachmentList: [{ name: "devis.pdf", type: "application/pdf", size: 1200, part: "2" }],
  trusted: false,
  ...over,
} as MailContent);

describe("partager un mail", () => {
  it("garde le texte sans l'historique cité", () => {
    expect(mailExcerpt(mail())).toBe("Bonjour,\n\nVoici le devis.\n\nMerci");
    expect(mailExcerpt(mail({ text: "", html: "<p>Salut <b>toi</b></p>" }))).toContain("Salut toi");
    expect(mailExcerpt(mail({ text: "mot ".repeat(500) }), 50).length).toBeLessThanOrEqual(51);
  });

  it("met mon mot, l'objet, l'expéditeur, le début et les fichiers", () => {
    const text = shareText(mail(), "On en parle ?");
    expect(text.startsWith("On en parle ?\n\n✉️ Re: TR: Devis tournage\nDe Léa Martin <lea@client.ch>, le 20 novembre 2026")).toBe(true);
    expect(text).toContain("Voici le devis.");
    expect(text).toContain("📎 devis.pdf");
    expect(text).not.toContain("ancien texte");
    expect(shareText(mail(), "").startsWith("✉️")).toBe(true);
    expect(shareText(mail(), "", ["2"])).not.toContain("📎");
  });

  it("fait un titre et une description de ticket", () => {
    expect(ticketTitle("Re: TR: Devis tournage")).toBe("Devis tournage");
    expect(ticketTitle("RE : ")).toBe("Mail sans objet");
    const d = ticketDescription(mail(), "Relancer vendredi");
    expect(d).toMatch(/^Relancer vendredi\n\n\*\*Mail\*\* : Re: TR: Devis tournage/);
    expect(d).toContain("> Voici le devis.");
    expect(d).toContain("**Pièces jointes** : devis.pdf");
  });
});

describe("TickUp", () => {
  const saved = { url: process.env.TICKUP_URL, token: process.env.TICKUP_TOKEN };
  afterEach(() => {
    process.env.TICKUP_URL = saved.url;
    process.env.TICKUP_TOKEN = saved.token;
    if (saved.url === undefined) delete process.env.TICKUP_URL;
    if (saved.token === undefined) delete process.env.TICKUP_TOKEN;
  });

  it("n'est branché qu'avec une adresse et une clé", () => {
    expect(tickupConfig({ TICKUP_URL: "https://tickup.x.ch/" })).toBeNull();
    expect(tickupConfig({ TICKUP_URL: "tickup.x.ch", TICKUP_TOKEN: "tku_0123456789abcdef" })).toBeNull();
    expect(tickupConfig({ TICKUP_URL: "https://tickup.x.ch/", TICKUP_TOKEN: "tku_0123456789abcdef" })).toEqual({ url: "https://tickup.x.ch", token: "tku_0123456789abcdef" });
  });

  it("liste les projets ouverts et crée un ticket avec la clé", async () => {
    process.env.TICKUP_URL = "https://tickup.x.ch";
    process.env.TICKUP_TOKEN = "tku_0123456789abcdef";
    const calls: { url: string; init: RequestInit }[] = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (url.endsWith("/api/projects"))
        return Response.json([
          { key: "LAMIO", name: "Lamio", archived: false },
          { key: "OLD", name: "Ancien", archived: true },
        ]);
      return Response.json({ ref: "LAMIO-42", title: JSON.parse(String(init.body)).title });
    }) as unknown as typeof fetch;

    expect(await tickupProjects(fake)).toEqual([{ key: "LAMIO", name: "Lamio" }]);
    const issue = await createTickupIssue({ project: "lamio", title: "Devis", description: "…", priority: 2 }, fake);
    expect(issue).toEqual({ ref: "LAMIO-42", title: "Devis", url: "https://tickup.x.ch/p/LAMIO?issue=LAMIO-42" });
    expect(calls[1].url).toBe("https://tickup.x.ch/api/projects/LAMIO/issues");
    expect((calls[1].init.headers as Record<string, string>).Authorization).toBe("Bearer tku_0123456789abcdef");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ title: "Devis", description: "…", priority: 2 });
  });

  it("dit clairement quand la clé est refusée", async () => {
    process.env.TICKUP_URL = "https://tickup.x.ch";
    process.env.TICKUP_TOKEN = "tku_0123456789abcdef";
    const refused = (async () => Response.json({ error: "Non autorisé" }, { status: 401 })) as unknown as typeof fetch;
    await expect(tickupProjects(refused)).rejects.toThrow(/refuse la clé/);
  });
});
