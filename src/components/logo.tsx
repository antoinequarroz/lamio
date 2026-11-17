import { cn } from "@/lib/utils";

/** A roped party: three climbers on one rope, the leader in the accent colour. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 28" className={cn("size-7", className)} aria-hidden>
      <rect width="28" height="28" rx="8" fill="var(--ink)" />
      <path d="M7.4 20.2 14 14.6l6.6-6.4" fill="none" stroke="var(--bg)" strokeWidth="1.7" strokeLinecap="round" opacity=".45" />
      <circle cx="7.4" cy="20.2" r="2.9" fill="var(--bg)" opacity=".6" />
      <circle cx="14" cy="14.4" r="2.9" fill="var(--bg)" opacity=".85" />
      <circle cx="20.6" cy="8.2" r="3.1" fill="var(--accent)" />
    </svg>
  );
}
