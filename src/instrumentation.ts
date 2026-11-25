/** Runs once when the server starts: the plugged-in mailboxes start syncing. */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startAll } = await import("@/server/mail/service");
  startAll();
}
