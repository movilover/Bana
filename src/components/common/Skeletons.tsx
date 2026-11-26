import React, { useEffect, useState } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { BanaLogo } from '@/src/components/common/BanaLogo';

const bar = 'rounded bg-neutral-200 dark:bg-neutral-800';

export function PostSkeleton() {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 animate-pulse" aria-hidden="true">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-800" />
        <div className="space-y-1.5 flex-1">
          <div className={`h-3 w-32 ${bar}`} />
          <div className={`h-2.5 w-20 ${bar}`} />
        </div>
      </div>
      <div className={`h-3 w-full ${bar}`} />
      <div className={`h-3 w-4/5 ${bar}`} />
      <div className="h-40 rounded-xl bg-neutral-100 dark:bg-neutral-800/60" />
    </div>
  );
}

export function CommentSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3 animate-pulse" role="status" aria-label="Loading comments">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5">
          <div className="h-7 w-7 rounded-full bg-neutral-200 dark:bg-neutral-800 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className={`h-2.5 w-28 ${bar}`} />
            <div className={`h-2.5 w-full ${bar}`} />
            <div className={`h-2.5 w-2/3 ${bar}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function ErrorNotice({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex items-center justify-between gap-3 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900 px-3.5 py-3 text-xs text-neutral-800 dark:text-neutral-200"
    >
      <span className="inline-flex items-center gap-2">
        <AlertCircle className="w-4 h-4 shrink-0" />
        {message}
      </span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 min-h-[36px] px-3 rounded-lg bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 font-semibold shrink-0"
        >
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      )}
    </div>
  );
}

/** Branded full-page loader. After `timeoutMs` it stops spinning and offers a reload instead of waiting forever. */
export function BrandedLoader({ label = 'Loading BANA...', timeoutMs = 20000 }: { label?: string; timeoutMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setSlow(true), timeoutMs);
    return () => window.clearTimeout(t);
  }, [timeoutMs]);

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-5 p-6 bg-white dark:bg-neutral-950">
      <BanaLogo />
      {!slow ? (
        <div role="status" className="w-full max-w-sm space-y-3">
          <p className="text-xs font-medium text-center text-neutral-500">{label}</p>
          <div className="h-1 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
            <div className="h-full w-1/3 rounded-full bg-neutral-950 dark:bg-white animate-[bana-slide_1.2s_ease-in-out_infinite]" />
          </div>
        </div>
      ) : (
        <div className="w-full max-w-sm space-y-3 text-center">
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            This is taking longer than expected. Please check your connection.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-sm font-semibold"
          >
            <RefreshCw className="w-4 h-4" /> Try again
          </button>
        </div>
      )}
    </div>
  );
}
