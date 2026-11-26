import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Loader2, RefreshCw, UserPlus, X } from 'lucide-react';
import { Avatar } from '@/src/components/common/Avatar';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';
import type { FriendStatus, SuggestedUserItem } from '@/src/lib/socialGraph';
import { recordSuggestionStat } from '@/src/lib/friendSuggestions';

interface Props {
  slotIndex: number;
  items: SuggestedUserItem[];
  loading: boolean;
  error: string | null;
  status: Record<string, FriendStatus>;
  busy: Record<string, boolean>;
  cardError: Record<string, string>;
  onAdd: (item: SuggestedUserItem) => void;
  onUndo: (uid: string) => void;
  onDismiss: (uid: string) => void;
  onRefresh: () => void;
}

/** Only publicly-visible profile info: private accounts and users who hide their location show name + avatar only. */
function publicLine(item: SuggestedUserItem): string {
  const u = item.user;
  if (u.isPrivateAccount) return '';
  if (item.mutualFriendsCount === 0 && u.location && u.showLocation !== false && item.reason.startsWith('Near')) return u.location;
  if (u.creatorCategory && u.isCreator) return `${u.creatorCategory} Creator`;
  if (item.sharedInterests.length && !item.reason.startsWith('Shares')) return `Shares ${item.sharedInterests[0]}`;
  return '';
}

export function FeedFriendSuggestions(p: Props) {
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const counted = useRef(false);

  useEffect(() => {
    if (!counted.current && p.items.length > 0) {
      counted.current = true;
      recordSuggestionStat('impressions', p.items.length);
    }
  }, [p.items.length]);

  const dismiss = (uid: string) => {
    setLeaving((s) => new Set(s).add(uid));
    window.setTimeout(() => p.onDismiss(uid), 180);
  };

  if (p.loading && p.slotIndex === 0 && p.items.length === 0) {
    return (
      <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4" aria-busy="true">
        <div className="h-4 w-40 rounded bg-neutral-100 dark:bg-neutral-800 animate-pulse mb-3" />
        <div className="flex gap-3 overflow-hidden">
          {[1, 2, 3].map((k) => (
            <div key={k} className="h-44 w-40 shrink-0 rounded-xl bg-neutral-100 dark:bg-neutral-800 animate-pulse" />
          ))}
        </div>
      </div>
    );
  }
  if (p.error && p.slotIndex === 0) {
    return (
      <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3 flex items-center justify-between gap-3 text-xs text-neutral-600 dark:text-neutral-300">
        <span>Suggestions are unavailable right now.</span>
        <button type="button" onClick={p.onRefresh} className="font-semibold text-brand inline-flex items-center gap-1">
          <RefreshCw className="w-3.5 h-3.5" /> Retry
        </button>
      </div>
    );
  }
  if (p.items.length === 0) return null; // empty → never interrupt the feed with a blank box

  return (
    <section aria-label="People you may know" className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-display font-bold text-sm text-neutral-950 dark:text-white">People you may know</h2>
        {p.slotIndex === 0 && (
          <button type="button" onClick={p.onRefresh} aria-label="Refresh suggestions" className="text-neutral-500 hover:text-neutral-900 dark:hover:text-white p-1">
            <RefreshCw className={`w-3.5 h-3.5 ${p.loading ? 'animate-spin' : ''}`} />
          </button>
        )}
      </div>
      <ul className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-1 -mx-1 px-1">
        {p.items.map((item) => {
          const u = item.user;
          const st = p.status[u.uid] || 'none';
          const busy = p.busy[u.uid];
          const info = publicLine(item);
          return (
            <li
              key={u.uid}
              className={`relative w-40 shrink-0 snap-start rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 flex flex-col items-center text-center transition-all duration-150 motion-reduce:transition-none ${
                leaving.has(u.uid) ? 'opacity-0 scale-95' : 'opacity-100'
              }`}
            >
              <button
                type="button"
                onClick={() => dismiss(u.uid)}
                aria-label={`Not interested in ${u.displayName}`}
                title="Not interested"
                className="absolute right-1.5 top-1.5 h-7 w-7 rounded-full flex items-center justify-center text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800 hover:text-neutral-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
              <Link to={`/profile/${u.username || u.uid}`} aria-label={`View ${u.displayName}'s profile`} className="mt-1">
                <Avatar src={u.avatarUrl} name={u.displayName} size="lg" />
              </Link>
              <Link to={`/profile/${u.username || u.uid}`} className="mt-2 max-w-full inline-flex items-center gap-1 text-sm font-semibold text-neutral-950 dark:text-white hover:underline">
                <span className="truncate">{u.displayName}</span>
                <LiveVerifiedBadge uid={u.uid} size={13} />
              </Link>
              <p className="text-[11px] text-neutral-500 min-h-[16px] truncate max-w-full">{item.reason}</p>
              <p className="text-[11px] text-neutral-400 min-h-[16px] truncate max-w-full">{info}</p>

              <div className="mt-2 w-full space-y-1.5">
                {st === 'friends' ? (
                  <span className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300 text-xs font-semibold py-2">
                    <Check className="w-3.5 h-3.5" /> Friends
                  </span>
                ) : st === 'sent_pending' ? (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => p.onUndo(u.uid)}
                    aria-label={`Request sent to ${u.displayName}. Press to cancel.`}
                    className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 text-xs font-semibold py-2 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Request Sent
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => p.onAdd(item)}
                    className="w-full inline-flex items-center justify-center gap-1 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold py-2 disabled:opacity-60"
                  >
                    {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />} Add Friend
                  </button>
                )}
                <Link to={`/profile/${u.username || u.uid}`} className="block text-[11px] font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
                  View Profile
                </Link>
                {st === 'sent_pending' && <p className="text-[10px] text-neutral-400">Tap to cancel</p>}
                {p.cardError[u.uid] && <p className="text-[10px] text-red-600" role="alert">{p.cardError[u.uid]}</p>}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
