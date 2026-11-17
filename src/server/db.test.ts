import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./db";

const account = (n: string) => ({ email: `${n}@exemple.ch`, name: n, salt: "s", hash: "h" });

// A fresh database for every test.
beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "app-test-"));
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

describe("modifier, réagir, répondre", () => {
  it("modifier un message garde sa place et note qu'il a changé", () => {
    const { ana, general } = team();
    const m = store.addMessage({ conversationId: general.id, userId: ana.id, body: "Rdv à 14h", fileIds: [] })!;
    expect(m.editedAt).toBeNull();
    const edited = store.editMessage(m.id, "Rdv à 15h")!;
    expect(edited).toMatchObject({ id: m.id, body: "Rdv à 15h", createdAt: m.createdAt });
    expect(edited.editedAt).toBeTruthy();
  });

  it("une réaction s'ajoute puis s'enlève, et se regroupe par emoji", () => {
    const { ana, bob, general } = team();
    const m = store.addMessage({ conversationId: general.id, userId: ana.id, body: "Livré !", fileIds: [] })!;
    store.toggleReaction(m.id, ana.id, "🎉");
    store.toggleReaction(m.id, bob.id, "🎉");
    expect(store.toggleReaction(m.id, bob.id, "👍")!.reactions).toEqual([
      { emoji: "🎉", userIds: [ana.id, bob.id] },
      { emoji: "👍", userIds: [bob.id] },
    ]);
    expect(store.toggleReaction(m.id, ana.id, "🎉")!.reactions[0]).toEqual({ emoji: "🎉", userIds: [bob.id] });
  });

  it("refuse trop de réactions différentes sur un même message", () => {
    const { ana, general } = team();
    const m = store.addMessage({ conversationId: general.id, userId: ana.id, body: "x", fileIds: [] })!;
    for (let i = 0; i < store.MAX_REACTIONS; i++) store.toggleReaction(m.id, ana.id, `e${i}`);
    expect(store.toggleReaction(m.id, ana.id, "de-trop")).toBeNull();
    // Removing one of mine still works.
    expect(store.toggleReaction(m.id, ana.id, "e0")!.reactions).toHaveLength(store.MAX_REACTIONS - 1);
  });

  it("les réponses vont dans le fil, pas dans la conversation, mais comptent comme non lues", () => {
    const { ana, bob, general } = team();
    const start = store.addMessage({ conversationId: general.id, userId: ana.id, body: "Qui vient lundi ?", fileIds: [] })!;
    const reply = store.addMessage({ conversationId: general.id, userId: bob.id, body: "Moi", fileIds: [], parentId: start.id })!;
    expect(reply.parentId).toBe(start.id);

    expect(store.listMessages(general.id).messages.map((m) => m.id)).toEqual([start.id]);
    expect(store.listMessages(general.id).messages[0]).toMatchObject({ replyCount: 1, lastReplyAt: reply.createdAt });
    expect(store.listReplies(start.id).map((m) => m.body)).toEqual(["Moi"]);
    expect(store.listConversations(ana.id).find((c) => c.id === general.id)).toMatchObject({ unread: 1, lastMessageId: reply.id });
  });

  it("pas de fil dans un fil, ni de réponse à un message d'une autre conversation", () => {
    const { ana, bob, general } = team();
    const start = store.addMessage({ conversationId: general.id, userId: ana.id, body: "a", fileIds: [] })!;
    const reply = store.addMessage({ conversationId: general.id, userId: bob.id, body: "b", fileIds: [], parentId: start.id })!;
    expect(store.addMessage({ conversationId: general.id, userId: ana.id, body: "c", fileIds: [], parentId: reply.id })).toBeNull();
    const dm = store.openDm(ana.id, bob.id);
    expect(store.addMessage({ conversationId: dm.id, userId: ana.id, body: "d", fileIds: [], parentId: start.id })).toBeNull();
    expect(store.addMessage({ conversationId: general.id, userId: ana.id, body: "e", fileIds: [], parentId: 9999 })).toBeNull();
  });

  it("supprimer le premier message supprime tout son fil, fichiers compris", () => {
    const { ana, bob, general } = team();
    const start = store.addMessage({ conversationId: general.id, userId: ana.id, body: "a", fileIds: [] })!;
    store.addFile({ id: "f-reply", userId: bob.id, name: "r.pdf", mime: "application/pdf", size: 1 });
    const reply = store.addMessage({ conversationId: general.id, userId: bob.id, body: "", fileIds: ["f-reply"], parentId: start.id })!;
    expect(store.deleteMessage(start.id)).toEqual(["f-reply"]);
    expect(store.getMessage(reply.id)).toBeNull();
  });
});

describe("canaux privés", () => {
  it("seuls les membres le voient, le lisent et reçoivent ses messages", () => {
    const { ana, bob, cleo } = team();
    const id = store.createChannel({ name: "direction", private: true, createdBy: ana.id })!;
    expect(store.accessTo(id, ana.id)).toBe("private");
    expect(store.accessTo(id, bob.id)).toBeNull();
    expect(store.listConversations(bob.id).some((c) => c.id === id)).toBe(false);
    expect(store.audienceOf(id)).toEqual([ana.id]);

    expect(store.addMember(id, bob.id)).toBe(true);
    expect(store.addMember(id, bob.id)).toBe(false);
    expect(store.accessTo(id, bob.id)).toBe("private");
    expect(store.accessTo(id, cleo.id)).toBeNull();
    const seen = store.listConversations(bob.id).find((c) => c.id === id)!;
    expect(seen.private).toBe(true);
    expect([...seen.memberIds!].sort()).toEqual([ana.id, bob.id].sort());
  });

  it("un nom pris par un canal privé reste pris", () => {
    const { ana, bob } = team();
    store.createChannel({ name: "direction", private: true, createdBy: ana.id });
    expect(store.createChannel({ name: "direction", createdBy: bob.id })).toBeNull();
  });

  it("quitter retire l'accès ; quand le dernier membre part, le canal disparaît avec ses fichiers", () => {
    const { ana, bob } = team();
    const id = store.createChannel({ name: "direction", private: true, createdBy: ana.id })!;
    store.addMember(id, bob.id);
    store.addFile({ id: "f-priv", userId: ana.id, name: "budget.pdf", mime: "application/pdf", size: 1 });
    store.addMessage({ conversationId: id, userId: ana.id, body: "", fileIds: ["f-priv"] });

    expect(store.removeMember(id, ana.id)).toEqual([]);
    expect(store.accessTo(id, ana.id)).toBeNull();
    expect(store.accessTo(id, bob.id)).toBe("private");

    expect(store.removeMember(id, bob.id)).toEqual(["f-priv"]);
    expect(store.getFile("f-priv")).toBeUndefined();
    expect(store.createChannel({ name: "direction", createdBy: bob.id })).toBeTruthy();
  });
});

describe("mentions et notifications", () => {
  it("compte à part les messages qui me mentionnent, jusqu'à ce que je les lise", () => {
    const { ana, bob, cleo, general } = team();
    const of = (userId: string) => store.listConversations(userId).find((c) => c.id === general.id)!;
    store.addMessage({ conversationId: general.id, userId: ana.id, body: "Bonjour", fileIds: [] });
    const m = store.addMessage({ conversationId: general.id, userId: ana.id, body: "@Bob tu peux regarder ?", fileIds: [] })!;
    expect(m.mentionIds).toEqual([bob.id]);
    expect(of(bob.id)).toMatchObject({ unread: 2, mentions: 1 });
    expect(of(cleo.id)).toMatchObject({ unread: 2, mentions: 0 });
    store.markRead(bob.id, general.id, m.id);
    expect(of(bob.id)).toMatchObject({ unread: 0, mentions: 0 });
  });

  it("@tous prévient tout le monde sauf l'auteur", () => {
    const { ana, bob, cleo, general } = team();
    store.addMessage({ conversationId: general.id, userId: ana.id, body: "@tous on démarre", fileIds: [] });
    const mentions = (userId: string) => store.listConversations(userId).find((c) => c.id === general.id)!.mentions;
    expect([mentions(ana.id), mentions(bob.id), mentions(cleo.id)]).toEqual([0, 1, 1]);
  });

  it("modifier un message refait ses mentions", () => {
    const { ana, bob, cleo, general } = team();
    const m = store.addMessage({ conversationId: general.id, userId: ana.id, body: "@Bob ?", fileIds: [] })!;
    expect(store.editMessage(m.id, "@Cleo ?")!.mentionIds).toEqual([cleo.id]);
    expect(store.editMessage(m.id, "personne")!.mentionIds).toEqual([]);
    expect(store.listConversations(bob.id).find((c) => c.id === general.id)!.mentions).toBe(0);
  });

  it("dans un canal privé, on ne mentionne que ses membres", () => {
    const { ana, bob, cleo } = team();
    const id = store.createChannel({ name: "direction", private: true, createdBy: ana.id })!;
    store.addMember(id, bob.id);
    expect(store.addMessage({ conversationId: id, userId: ana.id, body: "@Bob et @Cleo", fileIds: [] })!.mentionIds).toEqual([bob.id]);
    expect(store.addMessage({ conversationId: id, userId: ana.id, body: "@tous", fileIds: [] })!.mentionIds.sort()).toEqual([ana.id, bob.id].sort());
    expect(cleo.id).toBeTruthy();
  });
});

describe("gérer un canal", () => {
  it("seuls son créateur et les admins peuvent le gérer", () => {
    const { ana, bob, cleo } = team();
    const id = store.createChannel({ name: "projets", createdBy: bob.id })!;
    expect(store.canManage(id, bob)).toBe(true);
    expect(store.canManage(id, ana)).toBe(true);
    expect(store.canManage(id, cleo)).toBe(false);
    expect(store.listConversations(bob.id, bob.role).find((c) => c.id === id)!.canManage).toBe(true);
    expect(store.listConversations(cleo.id, cleo.role).find((c) => c.id === id)!.canManage).toBe(false);
  });

  it("un admin ne gère pas un canal privé dont il n'est pas membre", () => {
    const { ana, bob } = team();
    const id = store.createChannel({ name: "secret", private: true, createdBy: bob.id })!;
    expect(store.canManage(id, ana)).toBe(false);
  });

  it("renommer garde les messages, et refuse un nom déjà pris", () => {
    const { ana, general } = team();
    const id = store.createChannel({ name: "projets", createdBy: ana.id })!;
    store.addMessage({ conversationId: id, userId: ana.id, body: "un message", fileIds: [] });
    expect(store.updateChannel(id, { name: "chantiers", topic: "Les chantiers en cours" })).toBe(true);
    expect(store.listConversations(ana.id).find((c) => c.id === id)).toMatchObject({ name: "chantiers", topic: "Les chantiers en cours" });
    expect(store.listMessages(id).messages).toHaveLength(1);
    expect(store.updateChannel(id, { name: "general" })).toBe(false);
    // Only the description: the name stays.
    expect(store.updateChannel(general.id, { topic: "Tout le monde" })).toBe(true);
    expect(store.listConversations(ana.id).find((c) => c.id === general.id)).toMatchObject({ name: "general", topic: "Tout le monde" });
  });
});

describe("recherche", () => {
  it("trouve les messages par mots, y compris dans les fils, les plus récents d'abord", () => {
    const { ana, bob, general } = team();
    const start = store.addMessage({ conversationId: general.id, userId: ana.id, body: "Le budget du projet Alpha", fileIds: [] })!;
    const reply = store.addMessage({ conversationId: general.id, userId: bob.id, body: "Budget validé pour Alpha", fileIds: [], parentId: start.id })!;
    store.addMessage({ conversationId: general.id, userId: bob.id, body: "Rien à voir", fileIds: [] });
    expect(store.searchMessages(ana.id, "alpha budget").map((h) => h.id)).toEqual([reply.id, start.id]);
    expect(store.searchMessages(ana.id, "alpha budget")[0].parentId).toBe(start.id);
    expect(store.searchMessages(ana.id, "   ")).toEqual([]);
  });

  it("ne montre jamais un message d'une conversation fermée à la personne", () => {
    const { ana, bob, cleo } = team();
    const priv = store.createChannel({ name: "direction", private: true, createdBy: ana.id })!;
    store.addMessage({ conversationId: priv, userId: ana.id, body: "salaire confidentiel", fileIds: [] });
    const dm = store.openDm(ana.id, bob.id);
    store.addMessage({ conversationId: dm.id, userId: ana.id, body: "confidentiel entre nous", fileIds: [] });
    expect(store.searchMessages(ana.id, "confidentiel")).toHaveLength(2);
    expect(store.searchMessages(bob.id, "confidentiel")).toHaveLength(1);
    expect(store.searchMessages(cleo.id, "confidentiel")).toHaveLength(0);
  });

  it("prend % et _ pour du texte, pas pour des jokers", () => {
    const { ana, general } = team();
    store.addMessage({ conversationId: general.id, userId: ana.id, body: "Remise de 20% accordée", fileIds: [] });
    store.addMessage({ conversationId: general.id, userId: ana.id, body: "Remise de 200 francs", fileIds: [] });
    expect(store.searchMessages(ana.id, "20%").map((h) => h.body)).toEqual(["Remise de 20% accordée"]);
    expect(store.searchMessages(ana.id, "2_0")).toEqual([]);
  });
});

describe("connexion unique", () => {
  const later = () => new Date(Date.now() + 60_000).toISOString();

  it("un code ne sert qu'une fois, et seulement pour l'outil prévu", () => {
    const { ana } = team();
    store.addSsoCode("h1", "cairn", ana.id, later());
    expect(store.takeSsoCode("h1", "metricove")).toBeNull();
    expect(store.takeSsoCode("h1", "cairn")).toBeNull();
    store.addSsoCode("h2", "cairn", ana.id, later());
    expect(store.takeSsoCode("h2", "cairn")?.id).toBe(ana.id);
    expect(store.takeSsoCode("h2", "cairn")).toBeNull();
  });

  it("un code expiré est refusé", () => {
    const { ana } = team();
    store.addSsoCode("h3", "cairn", ana.id, new Date(Date.now() - 1000).toISOString());
    expect(store.takeSsoCode("h3", "cairn")).toBeNull();
  });

  it("un outil est ouvert aux administrateurs, et aux membres qu'on y ajoute", () => {
    const { ana, bob } = team();
    expect(store.mayOpenModule("notes", ana)).toBe(true);
    expect(store.mayOpenModule("notes", bob)).toBe(false);
    store.setModuleAccess("notes", bob.id, true);
    expect(store.mayOpenModule("notes", bob)).toBe(true);
    expect(store.mayOpenModule("publication", bob)).toBe(false);
    expect(store.moduleAccess()).toEqual({ notes: [bob.id] });
    store.setModuleAccess("notes", bob.id, false);
    expect(store.mayOpenModule("notes", bob)).toBe(false);
  });
});

describe("anciennes bases", () => {
  it("une base de la v0.1 reçoit les nouvelles colonnes sans perdre ses messages", async () => {
    const Database = (await import("better-sqlite3")).default;
    const dir = process.env.DATA_DIR!;
    const old = new Database(path.join(dir, "app.db"));
    old.exec(`
      create table users (id text primary key, email text not null unique, name text not null, role text not null default 'member', salt text not null, password_hash text not null, created_at text not null);
      create table conversations (id text primary key, kind text not null, name text not null default '', topic text not null default '', dm_key text unique, created_by text, created_at text not null);
      create table messages (id integer primary key autoincrement, conversation_id text not null, user_id text not null, body text not null default '', created_at text not null);
      insert into users values ('u1', 'ana@exemple.ch', 'Ana', 'admin', 's', 'h', '2026-11-17T08:00:00.000Z');
      insert into conversations values ('c1', 'channel', 'general', '', null, 'u1', '2026-11-17T08:00:00.000Z');
      insert into messages (conversation_id, user_id, body, created_at) values ('c1', 'u1', 'Ancien message', '2026-11-17T08:01:00.000Z');
    `);
    old.close();

    expect(store.listConversations("u1")[0]).toMatchObject({ name: "general", private: false });
    expect(store.listMessages("c1").messages[0]).toMatchObject({ body: "Ancien message", parentId: null, editedAt: null, replyCount: 0, reactions: [] });
  });
});
