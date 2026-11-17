import { NextResponse } from "next/server";
import { slugify } from "@/lib/utils";
import { currentUser } from "@/server/auth";
import { createChannel, getUser, openDm } from "@/server/db";
import { publish } from "@/server/events";
import { body, fail, text, unauthorized } from "@/server/http";

/** Creates a channel ({ kind: "channel", name, topic }) or opens a direct message ({ kind: "dm", userId }). */
export async function POST(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const data = await body(req);

  if (data.kind === "dm") {
    const other = typeof data.userId === "string" ? getUser(data.userId) : null;
    if (!other) return fail("Personne introuvable", 404);
    const { id, created } = openDm(me.id, other.id);
    if (created) publish({ type: "refresh" }, [me.id, other.id]);
    return NextResponse.json({ id });
  }

  const name = slugify(typeof data.name === "string" ? data.name : "");
  if (!name) return fail("Donne un nom au canal");
  const topic = data.topic === undefined || data.topic === "" ? "" : text(data.topic, 200);
  if (topic === null) return fail("Description trop longue");
  const id = createChannel({ name, topic, createdBy: me.id });
  if (!id) return fail(`Le canal #${name} existe déjà`, 409);
  publish({ type: "refresh" }, "all");
  return NextResponse.json({ id });
}
