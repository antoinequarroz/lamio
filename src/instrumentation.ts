/** Runs once when the server starts: the plugged-in mailboxes start syncing. */
export async function register() {
  // Written this way so that Next leaves the mail service (Node only) out of the Edge build.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startAll } = await import("@/server/mail/service");
    startAll();
  }
}
