import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
// @ts-expect-error: no types for the test IMAP server
import hoodiecrow from "hoodiecrow-imap";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as users from "@/server/db";
import { imapClient } from "./connect";
import { parseQuery, searchLocal, searchServer } from "./search";
import * as store from "./store";
import { INITIAL_LIMIT, syncMailbox } from "./sync";

const mail = (from: string, subject: string, body: string, date: string, extra = "") => ({
  raw: `From: ${from}\r\nTo: Antoine <antoine@exemple.ch>\r\nSubject: ${subject}\r\nDate: ${date}\r\n${extra}Content-Type: text/plain; charset=utf-8\r\n\r\n${body}\r\n`,
  internaldate: date,
});

let server: { listen: (p: number, cb: () => void) => void; close: (cb: () => void) => void; address: () => AddressInfo };
let userId: string;
const connect = () => {
  const c = imapClient({ email: "testuser", username: "testuser", password: "testpass", imapHost: "127.0.0.1", imapPort: server.address().port, smtpHost: "", smtpPort: 465 }, { plain: true });
  c.on("error", () => {});
  return c;
};

beforeEach(async () => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "search-test-"));
  userId = users.createFirstUser({ email: "antoine@exemple.ch", name: "Antoine", salt: "s", hash: "h" })!.id;
  store.saveMailAccount(userId, { email: "testuser", username: "testuser", imapHost: "127.0.0.1", imapPort: 143, smtpHost: "x", smtpPort: 465 }, "secret");
  const filler = Array.from({ length: INITIAL_LIMIT }, (_, i) => mail("news@x.ch", `Lettre ${i}`, "rien", "Mon, 2 Nov 2026 10:00:00 +0100"));
  server = hoodiecrow({
    plugins: ["SPECIAL-USE"],
    storage: {
      INBOX: {
        messages: [
          // Older than the first sync: only the server knows it.
          mail("Paul <paul@agence.ch>", "Ancien contrat", "Le contrat de location du studio", "Mon, 5 Jan 2026 10:00:00 +0100"),
          ...filler,
          mail("Léa Martin <lea@agence.ch>", "Visuels hiver", "Voici les maquettes", "Tue, 24 Nov 2026 09:00:00 +0100"),
          mail("Paul <paul@agence.ch>", "Devis", "Le budget pour le tournage du studio", "Wed, 25 Nov 2026 09:00:00 +0100", 'X-A: 1\r\n'),
        ],
      },
      "": { separator: "/", folders: { Archives: { "special-use": "\\Archive", messages: [mail("Léa Martin <lea@agence.ch>", "Facture visuels", "Facture des maquettes", "Fri, 20 Nov 2026 09:00:00 +0100")] } } },
    },
  });
  await new Promise<void>((r) => server.listen(0, r));
  const c = connect();
  await c.connect();
  await syncMailbox(c, userId);
  await c.logout();
}, 30000);

afterEach(() => new Promise<void>((r) => server.close(r)));

describe("chercher dans ses mails", () => {
  it("lit les mots et les filtres de / à", () => {
    expect(parseQuery('visuels de:lea à:"paul" hiver')).toEqual({ words: ["visuels", "hiver"], from: ["lea"], to: ["paul"] });
  });

  it("trouve tout de suite dans la copie locale, tous dossiers, tous les mots requis", () => {
    expect(searchLocal(userId, { q: "visuels" }).map((m) => m.subject)).toEqual(["Visuels hiver", "Facture visuels"]);
    expect(searchLocal(userId, { q: "visuels de:lea", folder: "Archives" }).map((m) => m.subject)).toEqual(["Facture visuels"]);
    expect(searchLocal(userId, { q: "visuels hiver" }).map((m) => m.subject)).toEqual(["Visuels hiver"]);
    expect(searchLocal(userId, { q: "de:paul", since: "2026-11-01T00:00:00Z" }).map((m) => m.subject)).toEqual(["Devis"]);
    expect(searchLocal(userId, { q: "100%" })).toEqual([]);
  });

  it("complète sur le serveur : texte complet des mails et mails anciens, ajoutés à la copie", async () => {
    // The contract is older than the first sync: only the server knows it.
    expect(searchLocal(userId, { q: "studio" }).map((m) => m.subject)).toEqual(["Devis"]);
    const found = await searchServer(userId, { q: "studio" }, 50, connect);
    expect(found.map((m) => m.subject)).toEqual(["Devis", "Ancien contrat"]);
    expect(searchLocal(userId, { q: "ancien" }).map((m) => m.subject)).toEqual(["Ancien contrat"]);
    expect(await searchServer(userId, { q: "studio tournage" }, 50, connect)).toHaveLength(1);
  }, 30000);
});
