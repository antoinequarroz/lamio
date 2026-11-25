"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * A state kept in this browser (localStorage): a panel's width, a view chosen. It starts from
 * `initial` (the same on the server and the first render) and takes the kept value once mounted.
 */
export function useStored<T>(key: string, initial: T, valid: (v: unknown) => v is T = (v): v is T => typeof v === typeof initial): [T, (next: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState(initial);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return;
      const parsed: unknown = JSON.parse(raw);
      if (valid(parsed)) setValue(parsed);
    } catch {}
    // Read once: the key and the check do not change for a given component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const set = useCallback(
    (next: T | ((prev: T) => T)) =>
      setValue((prev) => {
        const v = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          localStorage.setItem(key, JSON.stringify(v));
        } catch {}
        return v;
      }),
    [key],
  );
  return [value, set];
}
