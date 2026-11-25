import "server-only";
import dns from "node:dns/promises";
import net from "node:net";
import { ImapFlow } from "imapflow";
import nodemailer from "nodemailer";
import type { MailAccountInput } from "./store";

/** Infomaniak, filled in by default. Any other IMAP/SMTP provider works too. */
export const INFOMANIAK = { imapHost: "mail.infomaniak.com", imapPort: 993, smtpHost: "mail.infomaniak.com", smtpPort: 465 };

// Only the mail ports: the server must not become a way to reach anything else.
export const IMAP_PORTS = [993, 143];
export const SMTP_PORTS = [465, 587];

export type MailSettings = MailAccountInput & { password: string };

const TIMEOUT = 20_000;

/** "plain" (tests only): no TLS at all, for a local test server. */
export function imapClient(s: MailSettings, options: { autoIdle?: boolean; plain?: boolean } = {}) {
  return new ImapFlow({
    host: s.imapHost,
    port: s.imapPort,
    // 993: TLS from the start. 143: STARTTLS, required below.
    secure: s.imapPort === 993,
    doSTARTTLS: options.plain ? false : s.imapPort === 993 ? undefined : true,
    auth: { user: s.username, pass: s.password },
    logger: false,
    disableAutoIdle: !options.autoIdle,
    // The live connection: IDLE right after each command, renewed every 5 min (servers and NAT drop idle ones).
    ...(options.autoIdle && { autoIdleDelay: 300, maxIdleTime: 5 * 60_000 }),
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
    clientInfo: { name: "Lamio" },
  });
}

export function smtpTransport(s: MailSettings) {
  return nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    requireTLS: s.smtpPort !== 465,
    auth: { user: s.username, pass: s.password },
    connectionTimeout: TIMEOUT,
    greetingTimeout: TIMEOUT,
  });
}

const isPrivate = (ip: string) => {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
  }
  const v = ip.toLowerCase();
  if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
  return v === "::" || v === "::1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80");
};

/**
 * Refuses a server inside the private network (localhost, the Docker network, the LAN): a member
 * could otherwise use Lamio to knock on internal services. MAIL_ALLOW_PRIVATE=true lifts it (tests).
 */
export async function checkHost(host: string): Promise<string | null> {
  if (process.env.MAIL_ALLOW_PRIVATE === "true") return null;
  try {
    const addresses = net.isIP(host) ? [host] : (await dns.lookup(host, { all: true })).map((a) => a.address);
    if (addresses.some(isPrivate)) return `Le serveur ${host} n'est pas accepté`;
    return null;
  } catch {
    return `Serveur ${host} introuvable`;
  }
}

/** A readable reason, in French, for a failed connection. Never contains the password. */
/** A problem Lamio explains itself (a missing folder, a file too big…): its message is shown as is. */
export class MailProblem extends Error {}

export function mailError(e: unknown, server: "imap" | "smtp" = "imap"): { message: string; auth: boolean } {
  if (e instanceof MailProblem) return { message: e.message, auth: false };
  const err = e as { code?: string; authenticationFailed?: boolean; responseCode?: number; responseText?: string; message?: string };
  const label = server === "imap" ? "réception (IMAP)" : "envoi (SMTP)";
  if (err.authenticationFailed || err.code === "EAUTH" || err.code === "AUTHENTICATIONFAILED" || err.responseCode === 535)
    return { message: `Adresse ou mot de passe refusé par le serveur de ${label}`, auth: true };
  if (err.code === "ENOTFOUND" || err.code === "EAI_AGAIN") return { message: `Serveur de ${label} introuvable`, auth: false };
  if (err.code === "ETIMEDOUT" || err.code === "ETIMEOUT" || err.code === "CONNECT_TIMEOUT" || err.code === "GREETING_TIMEOUT" || /timeout/i.test(err.message ?? ""))
    return { message: `Le serveur de ${label} ne répond pas`, auth: false };
  if (err.code === "ECONNREFUSED") return { message: `Le serveur de ${label} refuse la connexion sur ce port`, auth: false };
  if (err.code === "ECONNRESET" || err.code === "NoConnection" || err.code === "EConnectionClosed") return { message: `La connexion au serveur de ${label} a été coupée`, auth: false };
  if (/certificate|self.signed|TLS|SSL/i.test(err.message ?? "")) return { message: `Connexion sécurisée impossible avec le serveur de ${label}`, auth: false };
  return { message: `Connexion au serveur de ${label} impossible${err.responseText ? ` : ${err.responseText.slice(0, 160)}` : ""}`, auth: false };
}

/** Logs in to both servers, without keeping anything. Null when both accept, else the reason. */
export async function testMailSettings(s: MailSettings): Promise<{ message: string; auth: boolean } | null> {
  for (const host of new Set([s.imapHost, s.smtpHost])) {
    const refused = await checkHost(host);
    if (refused) return { message: refused, auth: false };
  }
  const client = imapClient(s);
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (e) {
    return mailError(e, "imap");
  } finally {
    await client.logout().catch(() => client.close());
  }
  const smtp = smtpTransport(s);
  try {
    await smtp.verify();
  } catch (e) {
    return mailError(e, "smtp");
  } finally {
    smtp.close();
  }
  return null;
}
