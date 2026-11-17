import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./db";

const account = (n: string) => ({ email: `${n}@exemple.ch`, name: n, salt: "s", hash: "h" });

// A fresh database for every test.
beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "cordee-"));
});

function team() {
  const ana = store.createFirstUser(account("Ana"))!;
  const bob = store.createUser({ ...account("Bob"), role: "member" })!;
  const cleo = store.createUser({ ...account("Cleo"), role: "member" })!;
  const general = store.listConversations(ana.id)[0];
  return { ana, bob, cleo, general };
}

describe("comptes", () => {
  it("le premier compte est admin et crée #general, une seule fois", () => {
    const first = store.createFirstUser(account("Ana"))!;
    expect(first.role).toBe("admin");
    expect(store.listConversations(first.id).map((c) => c.name)).toEqual(["general"]);
    expect(store.createFirstUser(account("Intrus"))).toBeNull();
    expect(store.countUsers()).toBe(1);
  });

  it("refuse deux comptes avec le même e-mail, sans tenir compte de la casse", () => {
    store.createFirstUser(account("Ana"));
    expect(store.createUser({ ...account("Ana"), email: "ANA@exemple.ch", role: "member" })).toBeNull();
    expect(store.getCredentials(" Ana@Exemple.ch ")?.user.name).toBe("Ana");
  });

  it("changer de mot de passe ferme toutes les sessions", () => {
    const { ana } = team();
    store.addSession("t1", ana.id, new Date(Date.now() + 60_000).toISOString());
    expect(store.sessionUser("t1")?.id).toBe(ana.id);
    store.setUserPassword(ana.id, "s2", "h2");
    expect(store.sessionUser("t1")).toBeNull();
  });

  it("une session expirée ne vaut plus rien", () => {
    const { ana } = team();
    store.addSession("vieux", ana.id, new Date(Date.now() - 1000).toISOString());
    expect(store.sessionUser("vieux")).toBeNull();
  });
});

describe("conversations", () => {
  it("un nom de canal est unique", () => {
    const { ana } = team();
    expect(store.createChannel({ name: "projets", createdBy: ana.id })).toBeTruthy();
    expect(store.createChannel({ name: "projets", createdBy: ana.id })).toBeNull();
  });

  it("un message direct est le même dans les deux sens, et fermé aux autres", () => {
    const { ana, bob, cleo } = team();
    const dm = store.openDm(ana.id, bob.id);
    expect(dm.created).toBe(true);
    expect(store.openDm(bob.id, ana.id)).toEqual({ id: dm.id, created: false });

    expect(store.accessTo(dm.id, ana.id)).toBe("dm");
    expect(store.accessTo(dm.id, cleo.id)).toBeNull();
    expect([...store.audienceOf(dm.id)].sort()).toEqual([ana.id, bob.id].sort());
    expect(store.listConversations(cleo.id).some((c) => c.id === dm.id)).toBe(false);
    expect(store.listConversations(bob.id).find((c) => c.id === dm.id)?.otherUserId).toBe(ana.id);
  });

  it("on peut s'écrire à soi-même", () => {
    const { ana } = team();
    const dm = store.openDm(ana.id, ana.id);
    expect(store.listConversations(ana.id).find((c) => c.id === dm.id)?.otherUserId).toBe(ana.id);
  });

  it("tout le monde lit les canaux", () => {
    const { cleo, general } = team();
    expect(store.accessTo(general.id, cleo.id)).toBe("channel");
    expect(store.audienceOf(general.id)).toBe("all");
    expect(store.accessTo("inconnu", cleo.id)).toBeNull();
  });
});

describe("messages", () => {
  it("compte les non lus des autres, pas les siens, et les remet à zéro à la lecture", () => {
    const { ana, bob, general } = team();
    const unread = (userId: string) => store.listConversations(userId).find((c) => c.id === general.id)!.unread;
    store.addMessage({ conversationId: general.id, userId: ana.id, body: "Salut", fileIds: [] });
    const last = store.addMessage({ conversationId: general.id, userId: ana.id, body: "Ça va ?", fileIds: [] })!;
    expect(unread(ana.id)).toBe(0);
    expect(unread(bob.id)).toBe(2);
    store.markRead(bob.id, general.id, last.id);
    expect(unread(bob.id)).toBe(0);
    // Reading never goes backwards.
    store.markRead(bob.id, general.id, 0);
    expect(unread(bob.id)).toBe(0);
  });

  it("donne les messages par pages, du plus ancien au plus récent", () => {
    const { ana, general } = team();
    for (let i = 1; i <= store.PAGE + 5; i++) store.addMessage({ conversationId: general.id, userId: ana.id, body: `n°${i}`, fileIds: [] });
    const latest = store.listMessages(general.id);
    expect(latest.hasMore).toBe(true);
    expect(latest.messages).toHaveLength(store.PAGE);
    expect(latest.messages.at(-1)?.body).toBe(`n°${store.PAGE + 5}`);
    const older = store.listMessages(general.id, latest.messages[0].id);
    expect(older.hasMore).toBe(false);
    expect(older.messages.map((m) => m.body)).toEqual(["n°1", "n°2", "n°3", "n°4", "n°5"]);
  });

  it("n'attache que les fichiers de l'auteur, une seule fois", () => {
    const { ana, bob, general } = team();
    store.addFile({ id: "f-ana", userId: ana.id, name: "plan.pdf", mime: "application/pdf", size: 10 });
    store.addFile({ id: "f-bob", userId: bob.id, name: "secret.pdf", mime: "application/pdf", size: 10 });

    const sent = store.addMessage({ conversationId: general.id, userId: ana.id, body: "", fileIds: ["f-ana", "f-bob"] })!;
    expect(sent.files.map((f) => f.id)).toEqual(["f-ana"]);
    // Someone else's file, or one already sent, is not enough to make a message.
    expect(store.addMessage({ conversationId: general.id, userId: ana.id, body: "", fileIds: ["f-bob"] })).toBeNull();
    expect(store.addMessage({ conversationId: general.id, userId: ana.id, body: "", fileIds: ["f-ana"] })).toBeNull();
    expect(store.getFile("f-ana")?.conversationId).toBe(general.id);
    expect(store.getFile("f-bob")?.conversationId).toBeNull();
  });

  it("supprimer un message rend ses fichiers à effacer", () => {
    const { ana, general } = team();
    store.addFile({ id: "f1", userId: ana.id, name: "a.png", mime: "image/png", size: 1 });
    const m = store.addMessage({ conversationId: general.id, userId: ana.id, body: "voilà", fileIds: ["f1"] })!;
    expect(store.deleteMessage(m.id)).toEqual(["f1"]);
    expect(store.getMessage(m.id)).toBeNull();
    expect(store.getFile("f1")).toBeUndefined();
  });
});
