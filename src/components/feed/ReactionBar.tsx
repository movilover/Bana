import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ThumbsUp } from 'lucide-react';
import type { ReactionType } from '@/src/types/bana';
import { formatCompactNumber } from '@/src/lib/mediaUtils';
import { playReactionSound } from '@/src/lib/reactionSound';

export interface ReactionMeta {
  type: ReactionType;
  label: string;
  emoji: string;
  textColor: string;
}

export const REACTIONS: ReactionMeta[] = [
  { type: 'like', label: 'Like', emoji: '👍', textColor: 'text-brand' },
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
  variant?: 'card' | 'overlay' | 'inline';
}) {
  const [open, setOpen] = useState(false);
  const [shiftX, setShiftX] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const trayRef = useRef<HTMLDivElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const longPressTimerRef = useRef<number | null>(null);
  const longPressedRef = useRef(false);

  const clearLongPress = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

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

  // Keep the tray fully inside the viewport (never cut off on small screens).
  useLayoutEffect(() => {
    if (!open || !trayRef.current) {
      setShiftX(0);
      return;
    }
    const rect = trayRef.current.getBoundingClientRect();
    const margin = 8;
    let dx = 0;
    if (rect.right > window.innerWidth - margin) dx = window.innerWidth - margin - rect.right;
    if (rect.left + dx < margin) dx = margin - rect.left;
    setShiftX(dx);
  }, [open]);

  // Tap outside closes the tray (touch screens have no mouse-leave).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => () => {
    clearLongPress();
    if (closeTimerRef.current) window.clearTimeout(closeTimerRef.current);
  }, []);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    longPressedRef.current = false;
    clearLongPress();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressedRef.current = true;
      setOpen(true);
    }, 380);
  };

  const handlePointerEnd = () => clearLongPress();

  const select = (reaction: ReactionType) => {
    playReactionSound(reaction);
    onSelect(reaction);
    setOpen(false);
  };

  const handleButtonClick = () => {
    if (longPressedRef.current) {
      longPressedRef.current = false;
      return;
    }
    select(currentReaction || 'like');
  };

  const activeMeta = currentReaction ? getReactionMeta(currentReaction) : null;

  const pressProps = {
    onClick: handleButtonClick,
    onPointerDown: handlePointerDown,
    onPointerUp: handlePointerEnd,
    onPointerCancel: handlePointerEnd,
    onPointerLeave: handlePointerEnd,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    style: { touchAction: 'manipulation', WebkitTouchCallout: 'none', WebkitUserSelect: 'none', userSelect: 'none' } as React.CSSProperties,
    'aria-haspopup': 'true' as const,
    'aria-expanded': open,
  };

  const trayPosition =
    variant === 'overlay' ? 'right-12 bottom-0' : variant === 'inline' ? 'bottom-full left-0 mb-1.5' : 'bottom-full left-0 mb-2';

  return (
    <div
      ref={rootRef}
      className="relative inline-flex items-center"
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') openTray();
      }}
      onPointerLeave={(e) => {
        if (e.pointerType === 'mouse') scheduleClose();
      }}
    >
      {open && (
        <div
          ref={trayRef}
          role="menu"
          aria-label="Choose a reaction"
          style={{ transform: `translateX(${shiftX}px)` }}
          className={`animate-reaction-pop absolute z-30 flex items-center gap-0.5 px-1.5 py-1 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 shadow-xl max-w-[calc(100vw-16px)] ${trayPosition}`}
        >
          {REACTIONS.map((r) => (
            <button
              key={r.type}
              type="button"
              role="menuitem"
              title={r.label}
              aria-label={r.label}
              onClick={(e) => {
                e.stopPropagation();
                longPressedRef.current = false;
                select(r.type);
              }}
              className={`group relative h-10 w-10 sm:h-9 sm:w-9 rounded-full flex items-center justify-center text-xl transition-transform duration-150 hover:scale-125 active:scale-95 ${
                currentReaction === r.type ? 'bg-neutral-100 dark:bg-neutral-800 scale-110' : ''
              }`}
            >
              <span>{r.emoji}</span>
              <span className="pointer-events-none hidden sm:block opacity-0 group-hover:opacity-100 transition-opacity absolute -top-7 left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-neutral-900 text-white text-[10px] font-medium whitespace-nowrap">
                {r.label}
              </span>
            </button>
          ))}
        </div>
      )}

      {variant === 'overlay' ? (
        <button type="button" {...pressProps} className="flex flex-col items-center gap-1">
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
      ) : variant === 'inline' ? (
        <button
          type="button"
          {...pressProps}
          className={`inline-flex items-center gap-1 min-h-[32px] px-1.5 -mx-1.5 rounded-md text-[11px] font-semibold transition-colors ${
            activeMeta ? 'text-neutral-950 dark:text-white' : 'text-neutral-500 hover:text-neutral-950 dark:hover:text-white'
          }`}
        >
          {activeMeta ? <span className="text-sm leading-none">{activeMeta.emoji}</span> : <ThumbsUp className="w-3.5 h-3.5" />}
          <span>{activeMeta ? activeMeta.label : 'Like'}</span>
          {totalCount > 0 && <span className="font-mono tabular-nums opacity-80">{formatCompactNumber(totalCount)}</span>}
        </button>
      ) : (
        <button
          type="button"
          {...pressProps}
          className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 transition-colors min-h-[40px] ${
            activeMeta
              ? 'text-neutral-950 dark:text-white'
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
