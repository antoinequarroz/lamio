import "server-only";
import type { Transporter } from "nodemailer";
import { checkHost, mailError, MailProblem, smtpTransport } from "./connect";
import { settingsFor } from "./service";
import { mailtoParts } from "./sort";
import * as store from "./store";

/*
 * "Se désabonner" in one click, as the sender asks in List-Unsubscribe:
 *  1. one-click (RFC 8058): a POST to its web address, nothing else to do;
 *  2. otherwise its mail address: a mail is sent from my mailbox;
 *  3. otherwise only a web page: the app opens it (a form there usually needs a click).
 */

export type UnsubscribeResult = { done: "web" | "mail" } | { open: string };

type Deps = {
  fetch: typeof fetch;
  smtp: (userId: string) => Pick<Transporter, "sendMail"> | null;
};

const defaults: Deps = {
  fetch: (...args) => fetch(...args),
  smtp: (userId) => {
    const s = settingsFor(userId);
    return s ? smtpTransport(s) : null;
  },
};

export async function unsubscribe(userId: string, folder: string, uid: number, deps: Deps = defaults): Promise<UnsubscribeResult> {
  const info = store.unsubscribeOf(userId, folder, uid);
  if (!info) throw new MailProblem("Ce mail ne propose pas de désabonnement.");

  if (info.oneClick && info.http) {
    const url = new URL(info.http);
    if (!(await checkHost(url.hostname))) {
      try {
        // No redirect followed: the answer of the sender's own server is enough.
        const res = await deps.fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "Lamio" },
          body: "List-Unsubscribe=One-Click",
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        });
        if (res.status < 400) return { done: "web" };
      } catch {
        // Falls back on the mail address, or the page.
      }
    }
  }

  const mailto = info.mailto ? mailtoParts(info.mailto) : null;
  if (mailto) {
    const account = store.mailAccountInfo(userId);
    const smtp = deps.smtp(userId);
    if (!account || !smtp) throw new MailProblem("Aucune boîte mail branchée");
    try {
      await smtp.sendMail({ from: account.email, to: mailto.to, subject: mailto.subject, text: mailto.body });
    } catch (e) {
      throw new MailProblem(mailError(e, "smtp").message);
    }
    return { done: "mail" };
  }

  if (info.http) return { open: info.http };
  throw new MailProblem("Le désabonnement n'a pas abouti : ouvre le lien en bas du mail.");
}
