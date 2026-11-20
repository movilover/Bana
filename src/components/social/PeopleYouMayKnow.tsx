import React, { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  UserPlus,
  UserCheck,
  CheckCircle2,
  X,
  EyeOff,
  Sparkles,
  RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import {
  fetchSuggestedUsers,
  followOrRequestUser,
  sendFriendRequest,
  type SuggestedUserItem,
} from '@/src/lib/socialGraph';

interface PeopleYouMayKnowProps {
  variant?: 'sidebar' | 'strip';
  limitCount?: number;
}

export function PeopleYouMayKnow({ variant = 'sidebar', limitCount = 5 }: PeopleYouMayKnowProps) {
  const { firebaseUser, profile, settings, blockedUids, updateLocalSettings, openAuthModal } = useAuth();
  const [items, setItems] = useState<SuggestedUserItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [followedMap, setFollowedMap] = useState<Record<string, 'following' | 'requested'>>({});
  const [friendReqMap, setFriendReqMap] = useState<Record<string, boolean>>({});
  const [actionError, setActionError] = useState<string | null>(null);

  const loadSuggestions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchSuggestedUsers({
        myProfile: profile,
        blockedUids,
        dismissedUids: settings?.dismissedSuggestionIds || [],
        limitCount,
      });
      setItems(data);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [profile, blockedUids, settings?.dismissedSuggestionIds, limitCount]);

  useEffect(() => {
    loadSuggestions();
  }, [loadSuggestions]);

  const handleFollow = async (item: SuggestedUserItem) => {
    if (!firebaseUser || !profile) {
      openAuthModal(`Sign in to follow ${item.user.displayName}.`);
      return;
    }
    setActionError(null);
    try {
      const outcome = await followOrRequestUser(profile, item.user);
      setFollowedMap((prev) => ({ ...prev, [item.user.uid]: outcome }));
    } catch (err: any) {
      setActionError(err?.message || 'Could not update follow status.');
    }
  };

  const handleAddFriend = async (item: SuggestedUserItem) => {
    if (!firebaseUser || !profile) {
      openAuthModal(`Sign in to send a friend request to ${item.user.displayName}.`);
      return;
    }
    setActionError(null);
    try {
      await sendFriendRequest(profile, item.user);
      setFriendReqMap((prev) => ({ ...prev, [item.user.uid]: true }));
    } catch (err: any) {
      setActionError(err?.message || 'Could not send friend request.');
    }
  };

  const handleRemove = (uid: string) => {
    setItems((prev) => prev.filter((item) => item.user.uid !== uid));
  };

  const handleNotInterested = async (uid: string) => {
    handleRemove(uid);
    if (!firebaseUser) return;
    const prevList = settings?.dismissedSuggestionIds || [];
    if (!prevList.includes(uid)) {
      const next = [...prevList, uid].slice(-100);
      await updateLocalSettings({ dismissedSuggestionIds: next }).catch(() => {});
    }
  };

  if (loading && items.length === 0) {
    return (
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4 animate-pulse space-y-3">
        <div className="h-4 w-36 bg-neutral-100 dark:bg-neutral-800 rounded" />
        <div className="h-12 bg-neutral-100 dark:bg-neutral-800 rounded-xl" />
        <div className="h-12 bg-neutral-100 dark:bg-neutral-800 rounded-xl" />
      </div>
    );
  }

  if (!loading && items.length === 0) {
    return null;
  }

  if (variant === 'strip') {
    return (
      <section className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-[#1877F2]" />
            <h2 className="text-sm font-bold text-black dark:text-white">People you may know</h2>
          </div>
          <button
            type="button"
            onClick={loadSuggestions}
            className="text-xs font-semibold text-neutral-500 hover:text-black dark:hover:text-white inline-flex items-center gap-1"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
        </div>
        {actionError && <p className="text-xs text-red-600 mb-2">{actionError}</p>}
        <div className="flex gap-3 overflow-x-auto pb-1">
          {items.map((item) => {
            const followState = followedMap[item.user.uid];
            const friendSent = friendReqMap[item.user.uid];
            return (
              <div
                key={item.user.uid}
                className="w-44 shrink-0 border border-neutral-200 dark:border-neutral-800 rounded-xl p-3 flex flex-col justify-between bg-neutral-50/50 dark:bg-neutral-950/40 relative"
              >
                <button
                  type="button"
                  onClick={() => handleNotInterested(item.user.uid)}
                  title="Not interested"
                  className="absolute top-2 right-2 w-6 h-6 rounded-full hover:bg-neutral-200 dark:hover:bg-neutral-800 flex items-center justify-center text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <Link to={`/profile/${item.user.username}`} className="flex flex-col items-center text-center pt-1">
                  <div className="w-14 h-14 rounded-full overflow-hidden bg-neutral-200 dark:bg-neutral-800 mb-2 flex items-center justify-center font-bold text-base">
                    {item.user.avatarUrl ? (
                      <img loading="lazy" src={item.user.avatarUrl} alt={item.user.displayName} className="w-full h-full object-cover" />
                    ) : (
                      item.user.displayName[0]?.toUpperCase()
                    )}
                  </div>
                  <p className="text-xs font-bold text-black dark:text-white truncate max-w-full inline-flex items-center gap-1">
                    <span className="truncate">{item.user.displayName}</span>
                    {item.user.isVerified && <CheckCircle2 className="w-3.5 h-3.5 text-[#1877F2] shrink-0" />}
                  </p>
                  <p className="text-[11px] text-neutral-500 truncate max-w-full">@{item.user.username}</p>
                  <p className="text-[11px] text-neutral-600 dark:text-neutral-400 mt-1 line-clamp-1">{item.reason}</p>
                </Link>
                <div className="mt-3 space-y-1.5">
                  <button
                    type="button"
                    onClick={() => handleFollow(item)}
                    disabled={Boolean(followState)}
                    className={`w-full py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      followState
                        ? 'bg-neutral-200 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                        : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                    }`}
                  >
                    {followState === 'following' ? 'Following' : followState === 'requested' ? 'Requested' : 'Follow'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddFriend(item)}
                    disabled={Boolean(friendSent)}
                    className="w-full py-1.5 rounded-lg text-xs font-semibold border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 disabled:opacity-60 whitespace-nowrap"
                  >
                    {friendSent ? 'Friend Request Sent' : 'Add Friend'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    );
  }

  return (
    <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
          <Sparkles className="w-3.5 h-3.5 text-[#1877F2]" /> People You May Know
        </h3>
        <button
          type="button"
          onClick={loadSuggestions}
          title="Refresh suggestions"
          className="text-neutral-400 hover:text-black dark:hover:text-white p-1 rounded-lg"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {actionError && <p className="text-[11px] text-red-600">{actionError}</p>}

      <div className="space-y-3">
        {items.map((item) => {
          const followState = followedMap[item.user.uid];
          const friendSent = friendReqMap[item.user.uid];
          return (
            <div key={item.user.uid} className="flex items-start gap-2.5">
              <Link to={`/profile/${item.user.username}`} className="shrink-0">
                <div className="w-10 h-10 rounded-full overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center font-bold text-xs">
                  {item.user.avatarUrl ? (
                    <img loading="lazy" src={item.user.avatarUrl} alt={item.user.displayName} className="w-full h-full object-cover" />
                  ) : (
                    item.user.displayName[0]?.toUpperCase()
                  )}
                </div>
              </Link>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <Link
                    to={`/profile/${item.user.username}`}
                    className="text-xs font-bold text-black dark:text-white hover:underline truncate inline-flex items-center gap-1"
                  >
                    <span className="truncate">{item.user.displayName}</span>
                    {item.user.isVerified && <CheckCircle2 className="w-3.5 h-3.5 text-[#1877F2] shrink-0" />}
                  </Link>
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleNotInterested(item.user.uid)}
                      title="Not interested"
                      className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded"
                    >
                      <EyeOff className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(item.user.uid)}
                      title="Dismiss"
                      className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200 rounded"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                </div>
                <p className="text-[11px] text-neutral-500 truncate">
                  @{item.user.username} · {item.reason}
                </p>
                <div className="flex items-center gap-1.5 mt-2">
                  <button
                    type="button"
                    onClick={() => handleFollow(item)}
                    disabled={Boolean(followState)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
                      followState
                        ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                        : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                    }`}
                  >
                    {followState === 'following' ? 'Following' : followState === 'requested' ? 'Requested' : 'Follow'}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleAddFriend(item)}
                    disabled={Boolean(friendSent)}
                    className="px-2.5 py-1 rounded-lg text-[11px] font-semibold border border-neutral-200 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-700 dark:text-neutral-200 disabled:opacity-60 inline-flex items-center gap-1 whitespace-nowrap"
                  >
                    {friendSent ? (
                      <>
                        <UserCheck className="w-3 h-3" /> Sent
                      </>
                    ) : (
                      <>
                        <UserPlus className="w-3 h-3" /> Add Friend
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
