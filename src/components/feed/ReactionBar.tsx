import React, { useRef, useState } from 'react';
import { ThumbsUp } from 'lucide-react';
import type { ReactionType } from '@/src/types/bana';
import { formatCompactNumber } from '@/src/lib/mediaUtils';

export interface ReactionMeta {
  type: ReactionType;
  label: string;
  emoji: string;
  textColor: string;
}

export const REACTIONS: ReactionMeta[] = [
  { type: 'like', label: 'Like', emoji: '👍', textColor: 'text-[#1877F2]' },
  { type: 'love', label: 'Love', emoji: '❤️', textColor: 'text-[#F33E58]' },
  { type: 'haha', label: 'Haha', emoji: '😂', textColor: 'text-amber-500' },
  { type: 'wow', label: 'Wow', emoji: '😮', textColor: 'text-amber-500' },
  { type: 'sad', label: 'Sad', emoji: '😢', textColor: 'text-amber-500' },
  { type: 'angry', label: 'Angry', emoji: '😡', textColor: 'text-orange-600' },
];

export function getReactionMeta(type: ReactionType | null | undefined): ReactionMeta {
  return REACTIONS.find((r) => r.type === type) || REACTIONS[0];
}

export function ReactionPickerButton({
  currentReaction,
  totalCount,
  onSelect,
  variant = 'card',
}: {
  currentReaction: ReactionType | null;
  totalCount: number;
  onSelect: (reaction: ReactionType) => void;
  variant?: 'card' | 'overlay';
}) {
  const [open, setOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const openTray = () => {
    if (closeTimerRef.current) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setOpen(true);
  };

  const scheduleClose = () => {
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = window.setTimeout(() => setOpen(false), 220);
  };

  const handlePointerDown = () => {
    longPressedRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setOpen(true);
    }, 380);
  };

  const handlePointerUp = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  const handleButtonClick = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    onSelect(currentReaction || 'like');
    setOpen(false);
  };

  const activeMeta = currentReaction ? getReactionMeta(currentReaction) : null;

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={openTray}
      onMouseLeave={scheduleClose}
    >
      {open && (
        <div
          onMouseEnter={openTray}
          onMouseLeave={scheduleClose}
          className={`animate-reaction-pop absolute z-30 flex items-center gap-1 px-2 py-1.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl ${
            variant === 'overlay' ? 'right-12 bottom-0' : 'bottom-full left-0 mb-2'
          }`}
        >
          {REACTIONS.map((r) => (
            <button
              key={r.type}
              type="button"
              title={r.label}
              onClick={(e) => {
                e.stopPropagation();
                onSelect(r.type);
                setOpen(false);
              }}
              className={`group relative h-9 w-9 rounded-full flex items-center justify-center text-xl transition-transform duration-150 hover:scale-125 active:scale-95 ${
                currentReaction === r.type ? 'bg-blue-50 dark:bg-blue-950/50 scale-110' : ''
              }`}
            >
              <span>{r.emoji}</span>
              <span className="pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-neutral-900 text-white text-[10px] font-medium whitespace-nowrap">
                {r.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {variant === 'overlay' ? (
        <button
          type="button"
          onClick={handleButtonClick}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="flex flex-col items-center gap-1"
        >
          <span
            className={`h-11 w-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center text-lg transition-transform active:scale-90 ${
              activeMeta ? 'ring-2 ring-white/40' : 'text-white'
            }`}
          >
            {activeMeta ? <span>{activeMeta.emoji}</span> : <ThumbsUp className="w-5 h-5" />}
          </span>
          <span className="text-[11px] font-mono font-semibold text-white tabular-nums">
            {formatCompactNumber(totalCount)}
          </span>
        </button>
      ) : (
        <button
          type="button"
          onClick={handleButtonClick}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors min-h-[38px] ${
            activeMeta
              ? activeMeta.textColor
              : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
          }`}
        >
          {activeMeta ? (
            <span className="text-base leading-none">{activeMeta.emoji}</span>
          ) : (
            <ThumbsUp className="w-4 h-4" />
          )}
          <span>{activeMeta ? activeMeta.label : 'Like'}</span>
          <span className="font-mono tabular-nums text-[11px] opacity-85">
            {totalCount > 0 ? formatCompactNumber(totalCount) : ''}
          </span>
        </button>
      )}
    </div>
  );
}

export function ReactionSummary({
  summary,
  totalCount,
}: {
  summary?: Record<string, number>;
  totalCount: number;
}) {
  if (totalCount <= 0) return null;

  const activeTypes = REACTIONS.filter((r) => (summary?.[r.type] || 0) > 0)
    .sort((a, b) => (summary?.[b.type] || 0) - (summary?.[a.type] || 0))
    .slice(0, 3);

  const displayIcons = activeTypes.length > 0 ? activeTypes : [REACTIONS[0]];

  return (
    <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400">
      <div className="flex items-center -space-x-1">
        {displayIcons.map((r) => (
          <span
            key={r.type}
            title={r.label}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 text-[11px]"
          >
            {r.emoji}
          </span>
        ))}
      </div>
      <span className="font-mono tabular-nums">{formatCompactNumber(totalCount)}</span>
    </div>
  );
}
