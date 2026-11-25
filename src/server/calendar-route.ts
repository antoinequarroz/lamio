import "server-only";
import { NextResponse } from "next/server";
import type { User } from "@/lib/types";
import { AlfredError, alfredConfig } from "./alfred";
import { currentUser } from "./auth";
import { mayOpenModule } from "./db";
import { fail, unauthorized } from "./http";

/**
 * Shared by the routes of the Calendrier tab: signed in, calendar plugged in, access given
 * (admins, and the members ticked in Modules › Alfred › Accès). Alfred's refusals become answers.
 */
export async function withCalendar(handler: (me: User, writable: boolean) => Promise<Response>, write = false) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const config = alfredConfig();
  if (!config) return fail("Le calendrier n'est pas branché", 404);
  if (!mayOpenModule("agenda", me)) return fail("Demande l'accès au calendrier à un administrateur", 403);
  if (write && !config.writable) return fail("Le jeton d'Alfred ne permet que la lecture : crée un jeton « API en lecture et écriture » dans Alfred", 403);
  try {
    return await handler(me, config.writable);
  } catch (err) {
    if (err instanceof AlfredError) return fail(err.message, err.status);
    throw err;
  }
}

export const ok = (data: unknown, status = 200) => NextResponse.json(data, { status });
