import { describe, expect, it } from "vitest";
import { hasAttachments, makePreview, previewPart } from "./preview";

describe("aperçu d'un mail", () => {
  it("choisit le texte brut plutôt que le HTML, et saute les pièces jointes", () => {
    const structure = {
      type: "multipart/mixed",
      childNodes: [
        { type: "multipart/alternative", childNodes: [ { part: "1.1", type: "text/plain", encoding: "quoted-printable", parameters: { charset: "utf-8" } }, { part: "1.2", type: "text/html" } ] },
        { part: "2", type: "application/pdf", disposition: "attachment", parameters: { name: "a.pdf" } },
      ],
    };
    expect(previewPart(structure)).toEqual({ part: "1.1", html: false, encoding: "quoted-printable", charset: "utf-8" });
    expect(hasAttachments(structure)).toBe(true);
    expect(hasAttachments({ type: "text/plain", part: "1" })).toBe(false);
    expect(previewPart({ type: "image/png", part: "1", disposition: "attachment" })).toBeNull();
  });

  it("décode base64, quoted-printable et les jeux de caractères", () => {
    expect(makePreview(Buffer.from(Buffer.from("Réunion à 14h\r\n\r\nÀ demain").toString("base64")), { html: false, encoding: "base64", charset: "utf-8" })).toBe("Réunion à 14h À demain");
    expect(makePreview(Buffer.from("Caf=E9 cr=E8me =\r\nsoft"), { html: false, encoding: "quoted-printable", charset: "iso-8859-1" })).toBe("Café crème soft");
    // Cut in the middle of a base64 group: the incomplete end is dropped, no garbage.
    expect(makePreview(Buffer.from("Qm9uam91cg=="), { html: false, encoding: "base64", charset: "utf-8" })).toBe("Bonjour");
  });

  it("aplatit le HTML et retire les citations, puis coupe à 200 caractères", () => {
    expect(makePreview(Buffer.from("<style>p{color:red}</style><p>Salut&nbsp;<b>Antoine</b> &amp; co &#233;</p>"), { html: true, encoding: "7bit", charset: "utf-8" })).toBe("Salut Antoine & co é");
    expect(makePreview(Buffer.from("Oui.\n> Tu viens ?\n> Bises"), { html: false, encoding: "8bit", charset: "utf-8" })).toBe("Oui.");
    const long = makePreview(Buffer.from("mot ".repeat(100)), { html: false, encoding: "7bit", charset: "utf-8" });
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long.endsWith("…")).toBe(true);
  });
});
