import React from 'react';
import { CheckCircle2, Loader2, RotateCcw, X, AlertCircle } from 'lucide-react';
import { BanaLogo } from '@/src/components/common/BanaLogo';
import { dismissUploadTask, useUploadTasks, type UploadTask } from '@/src/lib/uploadTracker';

const KIND_LABEL: Record<UploadTask['kind'], string> = {
  post: 'Post',
  photo: 'Photo',
  video: 'Video',
  reel: 'Reel',
  story: 'Story',
};

function statusText(t: UploadTask): string {
  if (t.status === 'uploading') return `Uploading ${KIND_LABEL[t.kind]}...`;
  if (t.status === 'processing') return 'Finishing up...';
  if (t.status === 'success') return `${KIND_LABEL[t.kind]} uploaded`;
  return 'Upload failed';
}

/**
 * Global upload progress. Shown whenever an upload is running, failed or just finished,
 * including after the upload screen was closed or the user moved to another page.
 */
export function UploadStatusDock() {
  const tasks = useUploadTasks();
  if (tasks.length === 0) return null;

  return (
    <div
      className="fixed inset-x-0 bottom-20 lg:bottom-4 z-[60] flex flex-col items-center gap-2 px-3 pointer-events-none"
      aria-live="polite"
    >
      {tasks.map((t) => (
        <div
          key={t.id}
          className="pointer-events-auto w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-3.5 space-y-2.5"
        >
          <div className="flex items-center justify-between gap-2">
            <BanaLogo compact />
            <p className="flex-1 min-w-0 text-xs font-semibold text-neutral-950 dark:text-white truncate">
              {statusText(t)}
            </p>
            {t.status !== 'uploading' && t.status !== 'processing' && (
              <button
                type="button"
                onClick={() => dismissUploadTask(t.id)}
                aria-label="Dismiss"
                className="h-8 w-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          <p className="text-[11px] text-neutral-500 truncate">{t.fileName}</p>

          {(t.status === 'uploading' || t.status === 'processing') && (
            <div className="space-y-1.5">
              <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                <div className="h-full rounded-full bg-neutral-950 dark:bg-white transition-all" style={{ width: `${t.pct}%` }} />
              </div>
              <div className="flex items-center justify-between text-[11px] text-neutral-600 dark:text-neutral-400">
                <span className="inline-flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Keep BANA open until this finishes
                </span>
                <span className="font-mono tabular-nums font-semibold text-neutral-950 dark:text-white">{t.pct}%</span>
              </div>
              {t.cancel && (
                <button type="button" onClick={t.cancel} className="text-[11px] font-semibold underline text-neutral-600 dark:text-neutral-400">
                  Cancel upload
                </button>
              )}
            </div>
          )}

          {t.status === 'success' && (
            <p className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-800 dark:text-neutral-200">
              <CheckCircle2 className="w-4 h-4" /> Confirmed by the server
            </p>
          )}

          {t.status === 'failed' && (
            <div className="space-y-2">
              <p className="inline-flex items-start gap-1.5 text-xs text-neutral-800 dark:text-neutral-200">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t.error || 'Something went wrong while uploading.'}</span>
              </p>
              {t.retry && (
                <button
                  type="button"
                  onClick={() => {
                    const r = t.retry;
                    dismissUploadTask(t.id);
                    r?.();
                  }}
                  className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-xs font-semibold"
                >
                  <RotateCcw className="w-3.5 h-3.5" /> Retry
                </button>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
