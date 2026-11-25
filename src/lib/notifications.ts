"use client";

import { useSyncExternalStore } from "react";

// Notifications on this device: a choice kept in this browser, on top of the browser's own permission.
const KEY = "app-notifications";
const listeners = new Set<() => void>();

export type NotificationState = "on" | "off" | "blocked" | "unsupported";

function read(): NotificationState {
  if (typeof Notification === "undefined") return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  try {
    return Notification.permission === "granted" && localStorage.getItem(KEY) === "on" ? "on" : "off";
  } catch {
    return "off";
  }
}

export function useNotificationState(): NotificationState {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => void listeners.delete(fn);
    },
    read,
    () => "off",
  );
}

/** Turns device notifications on (asking the browser if needed) or off. Returns the resulting state. */
export async function setNotifications(on: boolean): Promise<NotificationState> {
  if (typeof Notification === "undefined") return "unsupported";
  if (on && Notification.permission === "default") await Notification.requestPermission();
  try {
    if (on && Notification.permission === "granted") localStorage.setItem(KEY, "on");
    else localStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((fn) => fn());
  return read();
}

type TauriWindow = { __TAURI_INTERNALS__?: { invoke: (cmd: string, args?: object) => Promise<unknown> } };

/**
 * The count on the app's icon: the Dock for the Mac app (Tauri), the installed web app elsewhere
 * (navigator.setAppBadge). 0 clears it. Does nothing where neither exists.
 */
export function setAppBadge(count: number) {
  const tauri = (window as unknown as TauriWindow).__TAURI_INTERNALS__;
  if (tauri) {
    tauri.invoke("plugin:window|set_badge_count", { label: "main", value: count > 0 ? count : null }).catch(() => {});
    return;
  }
  const nav = navigator as Navigator & { setAppBadge?: (n?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
  if (count > 0) nav.setAppBadge?.(count).catch(() => {});
  else nav.clearAppBadge?.().catch(() => {});
}

/** Shows a device notification if they are on. `onOpen` runs when it is clicked. */
export function deviceNotify(title: string, body: string, tag: string, onOpen: () => void) {
  if (read() !== "on") return;
  try {
    const n = new Notification(title, { body, tag, icon: "/icon.svg" });
    n.onclick = () => {
      window.focus();
      onOpen();
      n.close();
    };
  } catch {
    // Some mobile browsers only allow notifications from a service worker: nothing to do here.
  }
}
