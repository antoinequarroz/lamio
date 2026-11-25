import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, mailEnabled } from "./secret";

const env = { MAIL_SECRET: "une-cle-de-test-assez-longue-pour-le-chiffrement" };

describe("mot de passe de la boîte mail", () => {
  it("se chiffre et se déchiffre, jamais en clair", () => {
    const value = encryptSecret("mon mot de passe é", "ana", env);
    expect(value).not.toContain("mot de passe");
    expect(decryptSecret(value, "ana", env)).toBe("mon mot de passe é");
    // A new random nonce every time.
    expect(encryptSecret("mon mot de passe é", "ana", env)).not.toBe(value);
  });

  it("ne se déchiffre pas pour un autre compte, avec une autre clé, ni modifié", () => {
    const value = encryptSecret("secret", "ana", env);
    expect(decryptSecret(value, "bob", env)).toBeNull();
    expect(decryptSecret(value, "ana", { MAIL_SECRET: "une-autre-cle-de-test-assez-longue-aussi-oui" })).toBeNull();
    const [v, iv, tag, data] = value.split(".");
    expect(decryptSecret([v, iv, tag, data.slice(0, -2) + (data.endsWith("A") ? "B" : "A") + data.slice(-1)].join("."), "ana", env)).toBeNull();
    expect(decryptSecret("n'importe quoi", "ana", env)).toBeNull();
  });

  it("sans MAIL_SECRET (ou trop courte), les mails restent éteints", () => {
    expect(mailEnabled({})).toBe(false);
    expect(mailEnabled({ MAIL_SECRET: "courte" })).toBe(false);
    expect(mailEnabled(env)).toBe(true);
    expect(() => encryptSecret("x", "ana", {})).toThrow();
  });
});
