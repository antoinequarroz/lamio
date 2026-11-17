import { SSO_CALLBACK_PATH } from "@/lib/utils";
import { ssoClient } from "@/modules/registry";
import { currentUser } from "@/server/auth";
import { mayOpenModule } from "@/server/db";
import { issueCode, validState } from "@/server/sso";

export const dynamic = "force-dynamic";

// Relative addresses stay on this app whatever sits in front of it (Caddy, Portly).
const go = (location: string) => new Response(null, { status: 302, headers: { Location: location, "Cache-Control": "no-store" } });

/** Step 1 and 2 of the single sign-on: see src/server/sso.ts. */
export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const name = params.get("client") ?? "";
  const state = params.get("state");
  const client = ssoClient(name);
  if (!client || !validState(state)) return new Response("Demande de connexion invalide.", { status: 400 });

  const me = await currentUser();
  if (!me) return go(`/login?next=${encodeURIComponent(`/sso/authorize?client=${name}&state=${state}`)}`);
  if (!mayOpenModule(client.id, me)) return go(`/modules?refus=${encodeURIComponent(client.name)}`);

  return go(`${client.url}${SSO_CALLBACK_PATH}?code=${issueCode(name, me.id)}&state=${state}`);
}
