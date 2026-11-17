import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import * as store from "./db";
import { day } from "./http";
import * as projects from "./projects";
import { taskFields } from "./task-fields";

const account = (n: string) => ({ email: `${n}@exemple.ch`, name: n, salt: "s", hash: "h" });

// A fresh database for every test.
beforeEach(() => {
  process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "app-test-"));
});

function team() {
  const ana = store.createFirstUser(account("Ana"))!;
  const bob = store.createUser({ ...account("Bob"), role: "member" })!;
  return { ana, bob };
}

describe("projets", () => {
  it("un projet peut naître avec son canal, nommé d'après lui", () => {
    const { ana, bob } = team();
    const site = projects.createProject({ name: "Refonte du site", channel: true, createdBy: ana.id });
    const channel = store.listConversations(bob.id).find((c) => c.id === site.conversationId);
    expect(channel?.name).toBe("refonte-du-site");
    expect(channel?.topic).toBe("Projet Refonte du site");
    expect(projects.createProject({ name: "Sans canal", createdBy: ana.id }).conversationId).toBeNull();
  });

  it("deux projets du même nom ont chacun leur canal", () => {
    const { ana } = team();
    const a = projects.createProject({ name: "Podcast", channel: true, createdBy: ana.id });
    const b = projects.createProject({ name: "Podcast", channel: true, createdBy: ana.id });
    const names = store.listConversations(ana.id).filter((c) => [a.conversationId, b.conversationId].includes(c.id)).map((c) => c.name);
    expect(names.sort()).toEqual(["podcast", "podcast-2"]);
  });

  it("le canal se crée après coup, une seule fois", () => {
    const { ana } = team();
    const p = projects.createProject({ name: "Été 2027 !", createdBy: ana.id });
    const channelId = projects.openProjectChannel(p.id, ana.id);
    expect(projects.getProject(p.id)?.conversationId).toBe(channelId);
    expect(projects.openProjectChannel(p.id, ana.id)).toBeNull();
  });

  it("compte les tâches, les terminées et la prochaine échéance", () => {
    const { ana } = team();
    const p = projects.createProject({ name: "Clip", createdBy: ana.id });
    projects.addTask({ projectId: p.id, title: "Tourner", dueDate: "2027-03-12", createdBy: ana.id });
    projects.addTask({ projectId: p.id, title: "Monter", dueDate: "2027-03-20", createdBy: ana.id });
    const done = projects.addTask({ projectId: p.id, title: "Écrire", dueDate: "2027-03-01", status: "done", createdBy: ana.id })!;
    expect(projects.getProject(p.id)).toMatchObject({ taskCount: 3, doneCount: 1, nextDue: "2027-03-12" });
    expect(done.doneAt).toBeTruthy();
  });

  it("archiver garde les tâches, supprimer les emporte et laisse le canal", () => {
    const { ana } = team();
    const p = projects.createProject({ name: "Salon", channel: true, createdBy: ana.id });
    const task = projects.addTask({ projectId: p.id, title: "Stand", createdBy: ana.id })!;
    expect(projects.updateProject(p.id, { archived: true })).toMatchObject({ archived: true, name: "Salon", taskCount: 1 });
    expect(projects.deleteProject(p.id)).toBe(true);
    expect(projects.getTask(task.id)).toBeNull();
    expect(store.listConversations(ana.id).some((c) => c.id === p.conversationId)).toBe(true);
  });
});

describe("tâches", () => {
  it("s'ajoutent à la suite, et ne changent que sur les champs donnés", () => {
    const { ana, bob } = team();
    const p = projects.createProject({ name: "Clip", createdBy: ana.id });
    const a = projects.addTask({ projectId: p.id, title: "A", assigneeId: ana.id, dueDate: "2027-03-12", createdBy: ana.id })!;
    const b = projects.addTask({ projectId: p.id, title: "B", createdBy: ana.id })!;
    expect(b.position).toBeGreaterThan(a.position);

    const moved = projects.updateTask(a.id, { status: "doing", position: b.position + 1 })!;
    expect(moved).toMatchObject({ title: "A", status: "doing", dueDate: "2027-03-12", assigneeId: ana.id });
    expect(projects.listTasks(p.id).map((t) => t.title)).toEqual(["B", "A"]);

    expect(projects.updateTask(a.id, { dueDate: null, assigneeId: bob.id })).toMatchObject({ dueDate: null, assigneeId: bob.id, status: "doing" });
  });

  it("terminer note le moment, rouvrir l'efface", () => {
    const { ana } = team();
    const p = projects.createProject({ name: "Clip", createdBy: ana.id });
    const t = projects.addTask({ projectId: p.id, title: "A", createdBy: ana.id })!;
    const done = projects.updateTask(t.id, { status: "done" })!;
    expect(done.doneAt).toBeTruthy();
    expect(projects.updateTask(t.id, { title: "A bis" })?.doneAt).toBe(done.doneAt);
    expect(projects.updateTask(t.id, { status: "todo" })?.doneAt).toBeNull();
  });

  it("refuse un projet ou une personne qui n'existent pas", () => {
    const { ana } = team();
    const p = projects.createProject({ name: "Clip", createdBy: ana.id });
    expect(projects.addTask({ projectId: "inconnu", title: "A", createdBy: ana.id })).toBeNull();
    expect(projects.addTask({ projectId: p.id, title: "A", assigneeId: "inconnu", createdBy: ana.id })).toBeNull();
    const t = projects.addTask({ projectId: p.id, title: "A", createdBy: ana.id })!;
    expect(projects.updateTask(t.id, { assigneeId: "inconnu" })).toBeNull();
    expect(projects.updateTask("inconnue", { title: "B" })).toBeNull();
  });

  it("« Mes tâches » : les miennes, pas finies, hors projets archivés, par échéance", () => {
    const { ana, bob } = team();
    const clip = projects.createProject({ name: "Clip", createdBy: ana.id });
    const vieux = projects.createProject({ name: "Vieux", createdBy: ana.id });
    projects.addTask({ projectId: clip.id, title: "Sans date", assigneeId: ana.id, createdBy: ana.id });
    projects.addTask({ projectId: clip.id, title: "Plus tard", assigneeId: ana.id, dueDate: "2027-04-01", createdBy: ana.id });
    projects.addTask({ projectId: clip.id, title: "Bientôt", assigneeId: ana.id, dueDate: "2027-03-01", createdBy: bob.id });
    projects.addTask({ projectId: clip.id, title: "Finie", assigneeId: ana.id, status: "done", createdBy: ana.id });
    projects.addTask({ projectId: clip.id, title: "À Bob", assigneeId: bob.id, createdBy: ana.id });
    projects.addTask({ projectId: vieux.id, title: "Archivée", assigneeId: ana.id, createdBy: ana.id });
    projects.updateProject(vieux.id, { archived: true });
    const mine = projects.myTasks(ana.id);
    expect(mine.map((t) => t.title)).toEqual(["Bientôt", "Plus tard", "Sans date"]);
    expect(mine[0].projectName).toBe("Clip");
  });

  it("la recherche lit le titre et la description, sans se faire piéger par %", () => {
    const { ana } = team();
    const p = projects.createProject({ name: "Clip", createdBy: ana.id });
    projects.addTask({ projectId: p.id, title: "Louer la caméra", description: "Chez Visuals, 100% remboursé", createdBy: ana.id });
    projects.addTask({ projectId: p.id, title: "Réserver la salle", createdBy: ana.id });
    expect(projects.searchTasks("caméra louer").map((t) => t.title)).toEqual(["Louer la caméra"]);
    expect(projects.searchTasks("visuals")).toHaveLength(1);
    expect(projects.searchTasks("100%")).toHaveLength(1);
    expect(projects.searchTasks("%")).toHaveLength(1);
    expect(projects.searchTasks("  ")).toEqual([]);
  });
});

describe("champs d'une tâche", () => {
  it("un jour doit exister dans le calendrier", () => {
    expect(day("2027-02-28")).toBe("2027-02-28");
    expect(day("2027-02-30")).toBeNull();
    expect(day("12.03.2027")).toBeNull();
    expect(day(20270312)).toBeNull();
  });

  it("ne garde que ce qui est envoyé, et vide une échéance avec null", () => {
    expect(taskFields({ title: "  Monter  ", dueDate: null })).toEqual({ title: "Monter", dueDate: null });
    expect(taskFields({ status: "doing", assigneeId: "" })).toEqual({ status: "doing", assigneeId: null });
    expect(taskFields({})).toEqual({});
  });

  it("refuse un titre vide, un statut inconnu, une date fausse", () => {
    expect(typeof taskFields({ title: " " })).toBe("string");
    expect(typeof taskFields({ status: "fini" })).toBe("string");
    expect(typeof taskFields({ dueDate: "demain" })).toBe("string");
    expect(typeof taskFields({ position: "1" })).toBe("string");
  });
});
