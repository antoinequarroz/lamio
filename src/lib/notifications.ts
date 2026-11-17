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
