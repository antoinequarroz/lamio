import "server-only";
import { email, text } from "@/server/http";
import { INFOMANIAK, IMAP_PORTS, SMTP_PORTS, type MailSettings } from "./connect";

const host = (v: unknown, fallback: string) => {
  if (v === undefined || v === null || v === "") return fallback;
  const h = text(v, 253)?.toLowerCase();
  return h && /^[a-z0-9.-]+$/.test(h) && !h.startsWith(".") && !h.endsWith(".") ? h : null;
};

const port = (v: unknown, fallback: number, allowed: number[]) => {
  if (v === undefined || v === null || v === "") return fallback;
  const n = Number(v);
  return allowed.includes(n) ? n : null;
};

/**
 * The mailbox settings sent by the form, with Infomaniak's servers by default.
 * The password may be left empty to keep the saved one (passed as "saved").
 */
export function parseMailSettings(b: Record<string, unknown>, saved: string | null): MailSettings | string {
  const address = email(b.email);
  if (!address) return "Indique une adresse e-mail valide";
  const username = b.username ? text(b.username, 200) : address;
  if (!username) return "Identifiant invalide";
  const imapHost = host(b.imapHost, INFOMANIAK.imapHost);
  const smtpHost = host(b.smtpHost, INFOMANIAK.smtpHost);
  if (!imapHost || !smtpHost) return "Nom de serveur invalide";
  const imapPort = port(b.imapPort, INFOMANIAK.imapPort, IMAP_PORTS);
  if (!imapPort) return `Port IMAP accepté : ${IMAP_PORTS.join(" ou ")}`;
  const smtpPort = port(b.smtpPort, INFOMANIAK.smtpPort, SMTP_PORTS);
  if (!smtpPort) return `Port SMTP accepté : ${SMTP_PORTS.join(" ou ")}`;
  const typed = typeof b.password === "string" && b.password.length > 0 ? b.password : null;
  if (typed && typed.length > 500) return "Mot de passe trop long";
  const password = typed ?? saved;
  if (!password) return "Indique le mot de passe de la boîte";
  return { email: address, username, imapHost, imapPort, smtpHost, smtpPort, password };
}
