"use client";

import { useEffect, useRef } from "react";

/**
 * "Back" on a phone: swiping from the left edge, like every iPhone app.
 *
 * A screen that has somewhere to go back to (a conversation → the list, an open mail → the
 * inbox, a thread → its conversation) registers it with `useSwipeBack`. The last one registered
 * wins, so a thread open over its conversation goes back to the conversation first.
 * `EdgeSwipe` follows the finger, slides the page away, then calls it.
 */
const stack: { current: () => void }[] = [];

export function useSwipeBack(back: (() => void) | null) {
  const latest = useRef(back);
  latest.current = back;
  const on = !!back;
  useEffect(() => {
    if (!on) return;
    const entry = { current: () => latest.current?.() };
    stack.push(entry);
    return () => {
      const i = stack.indexOf(entry);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [on]);
}

/** Where a swipe can start: the first pixels of the screen, as on iOS. */
const EDGE = 28;
/** How far (share of the width) or how fast (px/ms) the finger must go for the swipe to count. */
const DISTANCE = 0.33;
const SPEED = 0.45;

/** Follows a swipe from the left edge on `target` (the page), on touch screens only. */
export function useEdgeSwipe(target: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = target.current;
    if (!el || !window.matchMedia("(hover: none) and (max-width: 767px)").matches) return;

    let start: { x: number; y: number; t: number } | null = null;
    let dragging = false;
    let last = { x: 0, t: 0, v: 0 };

    const set = (x: number, animate: boolean) => {
      el.style.transition = animate ? "transform 260ms var(--ease-drawer)" : "none";
      el.style.transform = x ? `translate3d(${x}px,0,0)` : "";
      el.style.boxShadow = x ? "-12px 0 32px -12px rgba(0,0,0,0.25)" : "";
    };

    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      start = e.touches.length === 1 && t.clientX <= EDGE && stack.length ? { x: t.clientX, y: t.clientY, t: e.timeStamp } : null;
      dragging = false;
      last = { x: t.clientX, t: e.timeStamp, v: 0 };
    };

    const move = (e: TouchEvent) => {
      if (!start) return;
      const t = e.touches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (!dragging) {
        // Mostly vertical: a scroll, not a swipe.
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) return void (start = null);
        if (dx < 8) return;
        dragging = true;
      }
      e.preventDefault();
      const dt = Math.max(1, e.timeStamp - last.t);
      last = { x: t.clientX, t: e.timeStamp, v: (t.clientX - last.x) / dt };
      set(Math.max(0, dx), false);
    };

    const up = () => {
      if (!start || !dragging) return void (start = null);
      const dx = last.x - start.x;
      start = null;
      dragging = false;
      const width = el.offsetWidth;
      if (dx > width * DISTANCE || (last.v > SPEED && dx > 40)) {
        set(width, true);
        window.setTimeout(() => {
          stack[stack.length - 1]?.current();
          // The next screen shows in place: no slide back.
          requestAnimationFrame(() => set(0, false));
        }, 240);
      } else set(0, true);
    };

    el.addEventListener("touchstart", down, { passive: true });
    // Not passive: once it is a swipe, the page must not scroll at the same time.
    el.addEventListener("touchmove", move, { passive: false });
    el.addEventListener("touchend", up);
    el.addEventListener("touchcancel", up);
    return () => {
      el.removeEventListener("touchstart", down);
      el.removeEventListener("touchmove", move);
      el.removeEventListener("touchend", up);
      el.removeEventListener("touchcancel", up);
    };
  }, [target]);
}
