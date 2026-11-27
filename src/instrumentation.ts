/**
 * Runs once when the server starts: the plugged-in mailboxes start syncing, and server errors
 * start going to Orbi (the suite's monitoring, which speaks the Sentry protocol).
 * Server side only: no page loads an extra script. Empty SENTRY_DSN = nothing is sent.
 */
import type { Instrumentation } from "next";

export async function register() {
  // Written this way so that Next leaves Node-only code (mail service, @sentry/node) out of the Edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startErrorReporting } = await import("@/lib/error-reporting.node");
    await startErrorReporting();
    const { startAll } = await import("@/server/mail/service");
    startAll();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { reportRequestError } = await import("@/lib/error-reporting.node");
    await reportRequestError(error, request, context);
  }
};
