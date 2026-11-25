"use client";

import { useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * The edge between two panels: drag it to change the width of the one before, double-click to
 * give it back its usual width. Arrow keys work too once it has the focus.
 */
export function ResizeHandle({ width, min, max, onChange, onReset, label, className }: { width: number; min: number; max: number; onChange: (width: number) => void; onReset: () => void; label: string; className?: string }) {
  const start = useRef<{ x: number; width: number } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)));
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label} · double-clic pour la taille d'origine`}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        start.current = { x: e.clientX, width };
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
      }}
      onPointerMove={(e) => start.current && onChange(clamp(start.current.width + e.clientX - start.current.x))}
      onPointerUp={(e) => {
        start.current = null;
        e.currentTarget.releasePointerCapture(e.pointerId);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }}
      onDoubleClick={onReset}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          onChange(clamp(width + (e.key === "ArrowRight" ? 16 : -16)));
        }
      }}
      className={cn(
        "group relative z-10 -mx-[3px] w-[7px] shrink-0 cursor-col-resize touch-none outline-none max-md:hidden",
        "after:absolute after:inset-y-0 after:left-[3px] after:w-px after:bg-line after:transition-colors hover:after:bg-accent/60 focus-visible:after:bg-accent active:after:bg-accent",
        className,
      )}
    />
  );
}
