import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { publish } from "@/server/events";
import { fail, unauthorized } from "@/server/http";
import { getProject, openProjectChannel } from "@/server/projects";

/** Gives a project its channel in the messaging, when it has none yet. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const { id } = await params;
  const project = getProject(id);
  if (!project) return fail("Projet introuvable", 404);
  if (project.conversationId) return NextResponse.json({ id: project.conversationId });
  const channelId = openProjectChannel(id, me.id);
  if (!channelId) return fail("Impossible de créer le canal : essaie de renommer le projet", 409);
  publish({ type: "refresh" }, "all");
  publish({ type: "project", projectId: id }, "all");
  return NextResponse.json({ id: channelId });
}
