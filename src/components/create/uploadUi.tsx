import React from 'react';
import { ArrowLeft, Upload, X } from 'lucide-react';

/**
 * Shared Black & White building blocks for the Post, Story and Reel upload screens.
 * UI only: no business logic lives here.
 */

export const inputCls =
  'w-full min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 text-sm text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors';

export const textareaCls =
  'w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-3 text-sm text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-colors resize-none';

export const btnPrimary =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-5 rounded-xl bg-brand text-white hover:bg-brand-hover text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export const btnSecondary =
  'inline-flex items-center justify-center gap-2 min-h-[44px] px-4 rounded-xl border border-neutral-300 dark:border-neutral-700 bg-white dark:bg-neutral-950 text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-sm font-semibold disabled:opacity-50 disabled:cursor-not-allowed transition-colors';

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-semibold text-neutral-900 dark:text-neutral-100">{label}</span>
        {hint && <span className="text-[11px] text-neutral-500">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

export function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: { id: T; label: string; icon: React.ComponentType<{ className?: string }> }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div
      role="tablist"
      className="flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 overflow-x-auto no-scrollbar"
    >
      {items.map((it) => {
        const Icon = it.icon;
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(it.id)}
            className={`flex-1 inline-flex items-center justify-center gap-1.5 min-h-[40px] px-3 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors ${
              active
                ? 'bg-brand text-white shadow-sm'
                : 'text-neutral-600 dark:text-neutral-400 hover:text-brand'
            }`}
          >
            <Icon className="w-4 h-4" />
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

export function Dropzone({
  title,
  hint,
  accept,
  multiple,
  onPick,
  compact,
}: {
  title: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  onPick: (files: File[]) => void;
  compact?: boolean;
}) {
  return (
    <label
      className={`cursor-pointer flex flex-col items-center justify-center text-center rounded-2xl border-2 border-dashed border-neutral-300 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-900/60 hover:border-brand hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors px-4 ${
        compact ? 'py-8' : 'py-12'
      }`}
    >
      <span className="h-12 w-12 rounded-full bg-brand text-white flex items-center justify-center mb-3">
        <Upload className="w-5 h-5" />
      </span>
      <span className="text-sm font-semibold text-neutral-950 dark:text-white">{title}</span>
      <span className="text-xs text-neutral-500 mt-1">{hint}</span>
      <input
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        onChange={(e) => {
          onPick(Array.from(e.target.files || []));
          e.target.value = '';
        }}
      />
    </label>
  );
}

export function ProgressBar({ pct, label }: { pct: number; label: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs font-medium text-neutral-700 dark:text-neutral-300">
        <span>{label}</span>
        <span className="font-mono tabular-nums">{pct}%</span>
      </div>
      <div className="h-2 w-full rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
        <div className="h-full bg-brand transition-all" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ModalShell({
  icon: Icon,
  title,
  subtitle,
  onClose,
  onBack,
  actions,
  footer,
  children,
  wide,
  closeLabel = 'Close',
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  subtitle?: string;
  onClose: () => void;
  onBack?: () => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  children: React.ReactNode;
  wide?: boolean;
  closeLabel?: string;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-xs p-0 sm:p-4">
      <div
        className={`animate-modal-in w-full ${
          wide ? 'max-w-3xl' : 'max-w-xl'
        } rounded-t-3xl sm:rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden flex flex-col max-h-[94vh] sm:max-h-[90vh]`}
      >
        <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-3 min-w-0">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                aria-label="Back"
                className="h-10 w-10 -ml-2 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center text-neutral-700 dark:text-neutral-300"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            )}
            <div className="h-10 w-10 shrink-0 rounded-xl bg-brand text-white flex items-center justify-center">
              <Icon className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2 className="font-display font-bold text-base text-neutral-950 dark:text-white truncate">{title}</h2>
              {subtitle && <p className="text-xs text-neutral-500 truncate">{subtitle}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {actions}
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="h-10 w-10 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center text-neutral-700 dark:text-neutral-300"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
        <div className="p-5 overflow-y-auto space-y-5 flex-1">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2.5 px-5 py-4 pb-safe border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
