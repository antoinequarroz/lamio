import { describe, expect, it } from "vitest";
import { mentionedIds, splitMentions } from "./mentions";

const people = [
  { id: "ana", name: "Ana" },
  { id: "ana-maria", name: "Ana Maria Lopez" },
  { id: "lea", name: "Léa Favre" },
];

describe("mentions", () => {
  it("reconnaît un nom complet, sans tenir compte de la casse", () => {
    expect(mentionedIds("Salut @léa favre, tu as vu ?", people)).toEqual(["lea"]);
  });

  it("le nom le plus long gagne", () => {
    expect(mentionedIds("@Ana Maria Lopez et @Ana", people).sort()).toEqual(["ana", "ana-maria"]);
    expect(mentionedIds("@Ana Maria Lopez", people)).toEqual(["ana-maria"]);
  });

  it("ne coupe pas un mot : @Anaïs n'est pas @Ana", () => {
    expect(mentionedIds("@Anaïs arrive", people)).toEqual([]);
    expect(mentionedIds("@Ana, viens. Et (@Ana) aussi.", people)).toEqual(["ana"]);
  });

  it("une adresse e-mail n'est pas une mention", () => {
    expect(mentionedIds("écris à contact@ana.ch", people)).toEqual([]);
  });

  it("@tous mentionne tout le monde", () => {
    expect(mentionedIds("@tous réunion à 14h", people).sort()).toEqual(["ana", "ana-maria", "lea"]);
    expect(mentionedIds("@tousse", people)).toEqual([]);
  });

  it("découpe le texte en morceaux, dans l'ordre", () => {
    expect(splitMentions("Merci @Ana et @tous !", people)).toEqual([{ text: "Merci " }, { text: "@Ana", userId: "ana" }, { text: " et " }, { text: "@tous", everyone: true }, { text: " !" }]);
    expect(splitMentions("rien ici", people)).toEqual([{ text: "rien ici" }]);
  });
});
