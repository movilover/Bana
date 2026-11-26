import React from 'react';
import { BadgeCheck, Sparkles } from 'lucide-react';

export function BanaLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5 select-none whitespace-nowrap shrink-0">
      <span className="relative inline-flex h-9 w-9 items-center justify-center rounded-xl bg-neutral-950 dark:bg-white shadow-sm">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path
            d="M6 4.5H13.5C16.2614 4.5 18.5 6.41776 18.5 8.83333C18.5 10.42 17.55 11.81 16.12 12.56C17.85 13.28 19 14.88 19 16.75C19 19.3734 16.5376 21.5 13.5 21.5H6V4.5Z"
            className="stroke-white dark:stroke-neutral-950"
            strokeWidth="2.4"
            strokeLinejoin="round"
          />
          <path d="M6 12.5H13.5" className="stroke-white dark:stroke-neutral-950" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
        <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-900" />
      </span>
      {!compact && (
        <span className="font-display font-extrabold text-lg tracking-tight text-neutral-950 dark:text-white">
          BANA
        </span>
      )}
    </span>
  );
}

export function VerifiedBadge({ size = 15 }: { size?: number }) {
  return (
    <span
      title="Verified BANA Account"
      role="img"
      aria-label="Verified account"
      className="inline-flex items-center text-brand dark:text-blue-400 shrink-0"
    >
      <BadgeCheck style={{ width: size, height: size }} />
    </span>
  );
}

export function CreatorBadge({ size = 14 }: { size?: number }) {
  return (
    <span title="Approved BANA Creator" className="inline-flex items-center text-amber-600 dark:text-amber-400 shrink-0">
      <Sparkles style={{ width: size, height: size }} />
    </span>
  );
}
