import "server-only";
import { listConversations } from "@/server/db";
import { apnsConfig, deadToken, sendApns, type ApnsConfig, type ApnsMessage, type ApnsResult } from "@/server/push/apns";
import type { MailSummary } from "@/lib/types";
import * as store from "./store";

/*
 * A new mail in the inbox: which ones notify (the person's choice in Réglages › Mails), and the
 * push to the iPhone app. The open app (web, Mac) is told through the live event ("alert").
 */

/** The new mails worth a notification: unread, not from me, and from a known sender when asked. */
export function mailsToAlert(userId: string, mails: MailSummary[]): MailSummary[] {
  const account = store.mailAccountInfo(userId);
  if (!account || account.notify === "off") return [];
  const me = account.email.toLowerCase();
  return mails.filter((m) => !m.seen && m.from.address.toLowerCase() !== me && (account.notify === "all" || store.isKnownSender(userId, m.from.address)));
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** What the phone shows: one notification per mail, or a summary when many arrive at once. */
export function pushMessages(tokens: string[], mails: MailSummary[], badge: number): ApnsMessage[] {
  const alerts =
    mails.length > 3
      ? [{ id: "mail-many", alert: { title: `${mails.length} nouveaux mails`, body: clip(mails.map((m) => m.from.name || m.from.address).join(", "), 180) }, url: "/mail" }]
      : mails.map((m) => ({
          id: `mail-${m.uid}`,
          alert: { title: m.from.name || m.from.address, subtitle: clip(m.subject || "(sans objet)", 120), body: clip(m.preview, 180) },
          url: `/mail?m=${m.uid}`,
        }));
  return tokens.flatMap((token) =>
    alerts.map((a) => ({ token, collapseId: a.id, payload: { aps: { alert: a.alert, badge, sound: "default", "thread-id": "mail" }, url: a.url } })),
  );
}

/** Pushes the new mails to this person's iPhones. Dead tokens are forgotten. */
export async function pushNewMails(
  userId: string,
  mails: MailSummary[],
  deps: { config?: ApnsConfig | null; send?: (c: ApnsConfig, m: ApnsMessage[]) => Promise<ApnsResult[]> } = {},
): Promise<ApnsResult[]> {
  const config = deps.config === undefined ? apnsConfig() : deps.config;
  const tokens = store.pushDevices(userId).filter((d) => d.platform === "ios").map((d) => d.token);
  if (!config || !tokens.length || !mails.length) return [];
  // The icon's badge: unread mails of the inbox and unread messages of Lamio.
  const badge = (store.inboxUnread(userId) ?? 0) + listConversations(userId).reduce((n, c) => n + c.unread, 0);
  const results = await (deps.send ?? sendApns)(config, pushMessages(tokens, mails, badge));
  for (const r of results) if (deadToken(r)) store.removePushDevice(r.token);
  return results;
}
