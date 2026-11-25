import { NextResponse } from "next/server";
import { currentUser } from "@/server/auth";
import { fail, unauthorized } from "@/server/http";
import { mailAccountInfo, setIdentities } from "@/server/mail/store";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@<>()",;]+@[^\s@<>()",;]+\.[^\s@<>()",;]+$/;

/**
 * The other addresses I send from with this mailbox (aliases):
 * { identities: [{ address, name, signature }] }, 20 at most. The mailbox's own is not in the list.
 */
export async function PUT(req: Request) {
  const me = await currentUser();
  if (!me) return unauthorized();
  const account = mailAccountInfo(me.id);
  if (!account) return fail("Aucune boîte mail branchée", 404);
  const body = (await req.json().catch(() => null)) as { identities?: unknown } | null;
  if (!Array.isArray(body?.identities) || body.identities.length > 20) return fail("Liste d'adresses invalide");
  const list: { address: string; name: string; signature: string }[] = [];
  for (const v of body.identities) {
    const i = v as { address?: unknown; name?: unknown; signature?: unknown };
    const address = typeof i?.address === "string" ? i.address.trim().toLowerCase() : "";
    if (!EMAIL.test(address) || address.length > 320) return fail(`Adresse invalide : ${address || "(vide)"}`);
    if (address === account.email.toLowerCase() || list.some((l) => l.address === address)) continue;
    const name = typeof i.name === "string" ? i.name.replace(/[\r\n]+/g, " ").trim().slice(0, 200) : "";
    const signature = typeof i.signature === "string" ? i.signature.replace(/\r\n/g, "\n").slice(0, 2000) : "";
    list.push({ address, name, signature });
  }
  setIdentities(me.id, list);
  return NextResponse.json({ account: mailAccountInfo(me.id) });
}
