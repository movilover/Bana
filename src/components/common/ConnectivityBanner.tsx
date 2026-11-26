import React, { useCallback, useEffect, useState } from 'react';
import { RefreshCw, WifiOff, Wifi } from 'lucide-react';

async function probeConnection(): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return false;
  try {
    const ctrl = new AbortController();
    const t = window.setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`${import.meta.env.BASE_URL}robots.txt?bana_probe=${Date.now()}`, {
      cache: 'no-store',
      signal: ctrl.signal,
    });
    window.clearTimeout(t);
    return res.ok || res.status < 500;
  } catch {
    return false;
  }
}

/**
 * Non-blocking offline banner. Already-loaded content stays on screen (nothing is cleared);
 * normal operation resumes automatically when the browser reports the connection is back.
 */
export function ConnectivityBanner() {
  const [online, setOnline] = useState<boolean>(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [justRestored, setJustRestored] = useState(false);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      setJustRestored(true);
      window.setTimeout(() => setJustRestored(false), 3000);
    };
    const goOffline = () => {
      setOnline(false);
      setJustRestored(false);
    };
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
    };
  }, []);

  const tryAgain = useCallback(async () => {
    setChecking(true);
    const ok = await probeConnection();
    setChecking(false);
    if (ok) {
      setOnline(true);
      setJustRestored(true);
      window.setTimeout(() => setJustRestored(false), 3000);
    }
  }, []);

  if (online && !justRestored) return null;

  if (online && justRestored) {
    return (
      <div role="status" className="fixed top-0 inset-x-0 z-[70] flex justify-center p-2 pointer-events-none">
        <div className="inline-flex items-center gap-2 rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 px-4 py-2 text-xs font-semibold shadow-lg">
          <Wifi className="w-4 h-4" /> Back online
        </div>
      </div>
    );
  }

  return (
    <div role="alert" className="fixed top-0 inset-x-0 z-[70] p-2 sm:p-3">
      <div className="mx-auto max-w-xl flex items-center justify-between gap-3 rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-4 py-3 shadow-xl">
        <div className="flex items-center gap-3 min-w-0">
          <span className="h-10 w-10 shrink-0 rounded-full bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 flex items-center justify-center">
            <WifiOff className="w-5 h-5" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-bold text-neutral-950 dark:text-white">No Internet Connection</p>
            <p className="text-xs text-neutral-600 dark:text-neutral-400">
              Connection unavailable. Content already loaded stays visible; new content and uploads need a connection.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={tryAgain}
          disabled={checking}
          className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-xs font-semibold shrink-0 disabled:opacity-60"
        >
          <RefreshCw className={`w-4 h-4 ${checking ? 'animate-spin' : ''}`} />
          Try Again
        </button>
      </div>
    </div>
  );
}
