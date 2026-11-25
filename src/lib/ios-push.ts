import { api } from "@/lib/utils";

type PushWindow = Window & { __LAMIO_PUSH_TOKEN__?: string };

/**
 * In the iPhone app, the app hands the page its push token (window.__LAMIO_PUSH_TOKEN__, then the
 * "lamio-push-token" event). The page registers it under the signed-in account, so the server can
 * send mails and messages to this iPhone through Apple. Does nothing in a browser or on the Mac.
 * Returns the cleanup.
 */
export function registerIosPush(): () => void {
  let sent = "";
  const send = () => {
    const token = (window as PushWindow).__LAMIO_PUSH_TOKEN__;
    if (!token || token === sent) return;
    sent = token;
    api("/api/push/devices", { method: "POST", json: { token, platform: "ios" } }).catch(() => {
      sent = "";
    });
  };
  send();
  window.addEventListener("lamio-push-token", send);
  return () => window.removeEventListener("lamio-push-token", send);
}
