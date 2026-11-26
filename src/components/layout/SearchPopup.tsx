import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search,
  X,
  Clock,
  Hash,
  Users,
  FileText,
  Film,
  Compass,
  Trash2,
  Loader2,
  ArrowUpRight,
} from 'lucide-react';
import {
  collection,
  query as fsQuery,
  where,
  orderBy,
  limit,
  getDocs,
  addDoc,
  deleteDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type {
  BanaUser,
  BanaPost,
  BanaCommunity,
  BanaReel,
  RecentSearchItem,
} from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import { formatCompactNumber, formatRelativeTime } from '@/src/lib/mediaUtils';
import { fetchSuggestedUsers } from '@/src/lib/socialGraph';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';

type SearchTab = 'all' | 'users' | 'posts' | 'hashtags' | 'communities' | 'videos';

const SUGGESTED_TERMS = [
  'Technology',
  'Dhaka',
  'Bangla Music',
  'Photography',
  'Startups',
  'Education',
];

const LOCAL_RECENT_KEY = 'bana_recent_searches';

export function SearchPopup({
  isOpen,
  initialQuery = '',
  onClose,
}: {
  isOpen: boolean;
  initialQuery?: string;
  onClose: () => void;
}) {
  const { firebaseUser, profile, settings, blockedUids } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement | null>(null);

  const [term, setTerm] = useState(initialQuery);
  const [activeTab, setActiveTab] = useState<SearchTab>('all');
  const [loading, setLoading] = useState(false);

  const [recentSearches, setRecentSearches] = useState<RecentSearchItem[]>([]);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);
  const [clearingHistory, setClearingHistory] = useState(false);

  const [users, setUsers] = useState<BanaUser[]>([]);
  const [userVisibleLimit, setUserVisibleLimit] = useState(8);
  const [suggestedCreators, setSuggestedCreators] = useState<BanaUser[]>([]);
  const [posts, setPosts] = useState<BanaPost[]>([]);
  const [communities, setCommunities] = useState<BanaCommunity[]>([]);
  const [reels, setReels] = useState<BanaReel[]>([]);
  const [hashtags, setHashtags] = useState<{ tag: string; count: number }[]>([]);

  useEffect(() => {
    if (!isOpen) return;
    setTerm(initialQuery);
    setTimeout(() => inputRef.current?.focus(), 40);

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !confirmClearOpen) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, initialQuery, onClose, confirmClearOpen]);

  // Load recent searches from Firestore (if signed in) or localStorage fallback
  useEffect(() => {
    if (!isOpen) return;
    if (!firebaseUser) {
      try {
        const raw = JSON.parse(localStorage.getItem(LOCAL_RECENT_KEY) || '[]') as string[];
        setRecentSearches(
          raw.slice(0, 8).map((q, idx) => ({ id: `local_${idx}`, userId: 'guest', query: q }))
        );
      } catch {
        setRecentSearches([]);
      }
      return;
    }

    getDocsWithIndexFallback<RecentSearchItem>(
      fsQuery(
        collection(db, 'recentSearches'),
        where('userId', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
        limit(8)
      ),
      fsQuery(collection(db, 'recentSearches'), where('userId', '==', firebaseUser.uid), limit(16)),
      sortByCreatedAtDesc
    )
      .then(({ items }) => {
        setRecentSearches(items.slice(0, 8));
      })
      .catch(() => {
        try {
          const raw = JSON.parse(localStorage.getItem(LOCAL_RECENT_KEY) || '[]') as string[];
          setRecentSearches(
            raw.slice(0, 8).map((q, idx) => ({ id: `local_${idx}`, userId: firebaseUser.uid, query: q }))
          );
        } catch {
          setRecentSearches([]);
        }
      });
    fetchSuggestedUsers({
      myProfile: profile,
      blockedUids,
      dismissedUids: settings?.dismissedSuggestionIds || [],
      limitCount: 5,
    })
      .then((res) => setSuggestedCreators(res.map((r) => r.user)))
      .catch(() => setSuggestedCreators([]));
  }, [isOpen, firebaseUser, profile, blockedUids, settings?.dismissedSuggestionIds]);

  // Live debounced search across Users, Posts, Hashtags, Communities, Reels/Videos
  useEffect(() => {
    if (!isOpen) return;
    const clean = term.trim().toLowerCase().replace(/^#/, '');
    if (!clean) {
      setUsers([]);
      setPosts([]);
      setCommunities([]);
      setReels([]);
      setHashtags([]);
      setUserVisibleLimit(8);
      setLoading(false);
      return;
    }

    setLoading(true);
    setUserVisibleLimit(8);
    const timer = window.setTimeout(async () => {
      try {
        const [usersSnap, postsRes, commSnap, reelsRes] = await Promise.all([
          getDocs(fsQuery(collection(db, 'users'), limit(120))).catch(() => null),
          getDocsWithIndexFallback<BanaPost>(
            fsQuery(
              collection(db, 'posts'),
              where('status', '==', 'published'),
              where('visibility', '==', 'public'),
              orderBy('createdAt', 'desc'),
              limit(45)
            ),
            fsQuery(
              collection(db, 'posts'),
              where('status', '==', 'published'),
              where('visibility', '==', 'public'),
              limit(60)
            ),
            sortByCreatedAtDesc
          ).catch(() => null),
          getDocs(
            fsQuery(collection(db, 'communities'), where('status', '==', 'active'), limit(30))
          ).catch(() => null),
          getDocsWithIndexFallback<BanaReel>(
            fsQuery(
              collection(db, 'reels'),
              where('status', '==', 'active'),
              where('visibility', '==', 'public'),
              orderBy('createdAt', 'desc'),
              limit(25)
            ),
            fsQuery(
              collection(db, 'reels'),
              where('status', '==', 'active'),
              where('visibility', '==', 'public'),
              limit(40)
            ),
            sortByCreatedAtDesc
          ).catch(() => null),
        ]);

        const allPosts = (postsRes?.items || []).filter((p) => !blockedUids.includes(p.authorId));

        const matchedUsers = (usersSnap?.docs || [])
          .map((d) => {
            const data = d.data();
            // Project public fields only — never expose private info
            return {
              uid: d.id,
              username: String(data.username || ''),
              displayName: String(data.displayName || ''),
              avatarUrl: data.avatarUrl || '',
              bio: data.bio || '',
              isVerified: Boolean(data.isVerified),
              isCreator: Boolean(data.isCreator),
              accountStatus: data.accountStatus || 'active',
              followersCount: Number(data.followersCount || 0),
              followingCount: Number(data.followingCount || 0),
            } as BanaUser;
          })
          .filter(
            (u) =>
              u.accountStatus === 'active' &&
              !blockedUids.includes(u.uid) &&
              (u.displayName.toLowerCase().includes(clean) ||
                u.username.toLowerCase().includes(clean) ||
                (u.bio || '').toLowerCase().includes(clean))
          );



        const matchedPosts = allPosts
          .filter((p) => {
            const hay = `${p.content} ${p.authorName} ${p.authorUsername} ${p.category || ''} ${p.locationName || ''} ${(p.hashtags || []).join(' ')}`.toLowerCase();
            return hay.includes(clean);
          })
          .slice(0, 10);

        const tagCounts: Record<string, number> = {};
        allPosts.forEach((p) => {
          (p.hashtags || []).forEach((tag) => {
            const lower = tag.toLowerCase();
            if (lower.includes(clean)) {
              tagCounts[tag] = (tagCounts[tag] || 0) + 1;
            }
          });
        });
        const matchedTags = Object.entries(tagCounts)
          .map(([tag, count]) => ({ tag, count }))
          .sort((a, b) => b.count - a.count)
          .slice(0, 10);

        const matchedCommunities = (commSnap?.docs || [])
          .map((d) => ({ id: d.id, ...(d.data() as Omit<BanaCommunity, 'id'>) }))
          .filter(
            (c) =>
              c.name.toLowerCase().includes(clean) ||
              c.description.toLowerCase().includes(clean) ||
              (c.district || '').toLowerCase().includes(clean) ||
              c.category.toLowerCase().includes(clean)
          )
          .slice(0, 8);

        const matchedReels = (reelsRes?.items || [])
          .filter(
            (r) =>
              !blockedUids.includes(r.authorId) &&
              ((r.caption || '').toLowerCase().includes(clean) ||
                r.authorUsername.toLowerCase().includes(clean) ||
                (r.hashtags || []).some((h) => h.toLowerCase().includes(clean)))
          )
          .slice(0, 8);

        setUsers(matchedUsers);
        setPosts(matchedPosts);
        setHashtags(matchedTags);
        setCommunities(matchedCommunities);
        setReels(matchedReels);
      } finally {
        setLoading(false);
      }
    }, 220);

    return () => window.clearTimeout(timer);
  }, [term, isOpen]);

  if (!isOpen) return null;

  const saveRecentSearch = async (rawQuery: string) => {
    const q = rawQuery.trim().slice(0, 120);
    if (!q) return;

    // Persist locally as quick cache
    try {
      const existing = JSON.parse(localStorage.getItem(LOCAL_RECENT_KEY) || '[]') as string[];
      const next = [q, ...existing.filter((item) => item.toLowerCase() !== q.toLowerCase())].slice(0, 8);
      localStorage.setItem(LOCAL_RECENT_KEY, JSON.stringify(next));
    } catch {
      // ignore localStorage failure
    }

    if (firebaseUser) {
      const duplicate = recentSearches.find((r) => r.query.toLowerCase() === q.toLowerCase());
      if (duplicate && !duplicate.id.startsWith('local_')) {
        await deleteDoc(doc(db, 'recentSearches', duplicate.id)).catch(() => {});
      }
      await addDoc(collection(db, 'recentSearches'), {
        userId: firebaseUser.uid,
        query: q,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  };

  const removeSingleRecent = async (item: RecentSearchItem) => {
    setRecentSearches((prev) => prev.filter((r) => r.id !== item.id));
    try {
      const existing = JSON.parse(localStorage.getItem(LOCAL_RECENT_KEY) || '[]') as string[];
      localStorage.setItem(
        LOCAL_RECENT_KEY,
        JSON.stringify(existing.filter((x) => x.toLowerCase() !== item.query.toLowerCase()))
      );
    } catch {
      // ignore
    }
    if (firebaseUser && !item.id.startsWith('local_')) {
      await deleteDoc(doc(db, 'recentSearches', item.id)).catch(() => {});
    }
  };

  const handleClearHistory = async () => {
    setClearingHistory(true);
    try {
      localStorage.removeItem(LOCAL_RECENT_KEY);
      if (firebaseUser) {
        await Promise.all(
          recentSearches
            .filter((r) => !r.id.startsWith('local_'))
            .map((r) => deleteDoc(doc(db, 'recentSearches', r.id)).catch(() => {}))
        );
      }
      setRecentSearches([]);
      setConfirmClearOpen(false);
      toast.info('Recent search history cleared.');
    } finally {
      setClearingHistory(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = term.trim();
    if (!q) return;
    saveRecentSearch(q);
    onClose();
    navigate(`/discover?q=${encodeURIComponent(q.replace(/^#/, ''))}`);
  };

  const goToResult = (path: string, queryLabel?: string) => {
    if (queryLabel) saveRecentSearch(queryLabel);
    onClose();
    navigate(path);
  };

  const videoPosts = posts.filter((p) => p.type === 'video');
  const totalResults =
    users.length + posts.length + hashtags.length + communities.length + reels.length;
  const hasQuery = term.trim().length > 0;

  return (
    <>
      <div
        className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-start justify-center pt-4 sm:pt-14 px-3 sm:px-4"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label="Global BANA Search"
      >
        <div
          className="animate-modal-in w-full max-w-2xl rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden flex flex-col max-h-[84vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Search Input Bar */}
          <form
            onSubmit={handleSubmit}
            className="flex items-center gap-2.5 px-4 py-3 border-b border-neutral-200 dark:border-neutral-800"
          >
            <Search className="w-4 h-4 text-brand shrink-0" />
            <input
              ref={inputRef}
              type="search"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Search people, posts, #hashtags, communities, videos..."
              className="flex-1 bg-transparent text-sm text-neutral-950 dark:text-white placeholder:text-neutral-400 focus:outline-none"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm('')}
                className="p-1 rounded-lg text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                aria-label="Clear input"
              >
                <X className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800"
            >
              Esc
            </button>
          </form>

          {/* Category Filter Tabs when searching */}
          {hasQuery && (
            <div className="px-4 py-2 border-b border-neutral-100 dark:border-neutral-900 flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {(
                [
                  { id: 'all', label: `All (${totalResults})` },
                  { id: 'users', label: `Users (${users.length})` },
                  { id: 'posts', label: `Posts (${posts.length})` },
                  { id: 'hashtags', label: `Hashtags (${hashtags.length})` },
                  { id: 'communities', label: `Communities (${communities.length})` },
                  { id: 'videos', label: `Videos (${reels.length + videoPosts.length})` },
                ] as { id: SearchTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    activeTab === tab.id
                      ? 'bg-brand text-white'
                      : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-800'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {!hasQuery ? (
              <>
                {/* Recent Searches */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" /> Recent Searches
                    </h3>
                    {recentSearches.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setConfirmClearOpen(true)}
                        className="text-xs font-medium text-rose-600 dark:text-rose-400 hover:underline inline-flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Clear history
                      </button>
                    )}
                  </div>

                  {recentSearches.length === 0 ? (
                    <p className="text-xs text-neutral-500 py-2">
                      Your recent searches will appear here for quick access.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {recentSearches.map((item) => (
                        <div
                          key={item.id}
                          className="flex items-center justify-between gap-2 px-2.5 py-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
                        >
                          <button
                            type="button"
                            onClick={() => setTerm(item.query)}
                            className="flex-1 flex items-center gap-2.5 text-left text-xs font-medium text-neutral-800 dark:text-neutral-200 min-w-0"
                          >
                            <Clock className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                            <span className="truncate">{item.query}</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => removeSingleRecent(item)}
                            aria-label={`Remove ${item.query}`}
                            className="p-1 text-neutral-400 hover:text-neutral-700 dark:hover:text-neutral-200"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Search Suggestions */}
                <div className="space-y-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                    <Compass className="w-3.5 h-3.5 text-brand" /> Suggested Topics
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {SUGGESTED_TERMS.map((suggestion) => (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setTerm(suggestion)}
                        className="px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:border-brand hover:text-brand transition-colors"
                      >
                        {suggestion}
                      </button>
                    ))}
                  </div>
                </div>
                {/* Suggested People when search is empty */}
                {suggestedCreators.length > 0 && (
                  <div className="space-y-2.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5 text-brand" /> Suggested People
                    </h3>
                    <div className="space-y-1">
                      {suggestedCreators.map((u) => (
                        <button
                          key={u.uid}
                          type="button"
                          onClick={() => goToResult(`/profile/${u.username}`)}
                          className="w-full flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-left transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-semibold truncate text-neutral-950 dark:text-white">
                                  {u.displayName}
                                </span>
                                <LiveVerifiedBadge uid={u.uid} size={13} />
                              </div>
                              <p className="text-[11px] text-neutral-500 truncate">
                                @{u.username} · {formatCompactNumber(u.followersCount)} followers
                              </p>
                            </div>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </>
            ) : loading ? (
              <div className="py-12 flex flex-col items-center justify-center gap-2 text-xs text-neutral-500">
                <Loader2 className="w-5 h-5 animate-spin text-brand" />
                Searching BANA...
              </div>
            ) : totalResults === 0 ? (
              <div className="py-8 text-center space-y-4">
                <div className="space-y-2">
                  <p className="text-sm font-semibold text-neutral-900 dark:text-white">
                    No results found for "{term.trim()}"
                  </p>
                  <p className="text-xs text-neutral-500">
                    Try searching another name, hashtag, district, or topic.
                  </p>
                  <button
                    type="button"
                    onClick={() => goToResult(`/discover?q=${encodeURIComponent(term.trim())}`, term.trim())}
                    className="mt-2 inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover"
                  >
                    Search in Discover Feed <ArrowUpRight className="w-3.5 h-3.5" />
                  </button>
                </div>
                {suggestedCreators.length > 0 && (
                  <div className="text-left pt-4 border-t border-neutral-100 dark:border-neutral-900 space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wider text-neutral-500">
                      People you may know
                    </p>
                    <div className="space-y-1">
                      {suggestedCreators.slice(0, 3).map((u) => (
                        <button
                          key={u.uid}
                          type="button"
                          onClick={() => goToResult(`/profile/${u.username}`, term.trim())}
                          className="w-full flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-left transition-colors"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                            <div className="min-w-0">
                              <span className="text-xs font-semibold truncate block">{u.displayName}</span>
                              <span className="text-[11px] text-neutral-500">@{u.username}</span>
                            </div>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-5">
                {/* Users */}
                {(activeTab === 'all' || activeTab === 'users') && users.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                      <Users className="w-3.5 h-3.5" /> People & Creators
                    </h4>
                    <div className="space-y-1">
                      {users.slice(0, userVisibleLimit).map((u) => (
                        <button
                          key={u.uid}
                          type="button"
                          onClick={() => goToResult(`/profile/${u.username}`, term.trim())}
                          className="w-full flex items-center justify-between gap-3 p-2 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-left transition-colors"
                        >
                          <div className="flex items-center gap-3 min-w-0">
                            <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                            <div className="min-w-0">
                              <div className="flex items-center gap-1">
                                <span className="text-xs font-semibold truncate text-neutral-950 dark:text-white">
                                  {u.displayName}
                                </span>
                                <LiveVerifiedBadge uid={u.uid} size={13} />
                              </div>
                              <p className="text-[11px] text-neutral-500 truncate">
                                @{u.username} · {formatCompactNumber(u.followersCount)} followers
                              </p>
                            </div>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                    {users.length > userVisibleLimit && (
                      <button
                        type="button"
                        onClick={() => setUserVisibleLimit((n) => n + 12)}
                        className="w-full py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-brand hover:bg-neutral-50 dark:hover:bg-neutral-900"
                      >
                        Load more people ({users.length - userVisibleLimit} remaining)
                      </button>
                    )}
                  </section>
                )}

                {/* Hashtags */}
                {(activeTab === 'all' || activeTab === 'hashtags') && hashtags.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                      <Hash className="w-3.5 h-3.5" /> Hashtags
                    </h4>
                    <div className="flex flex-wrap gap-2">
                      {hashtags.map((h) => (
                        <button
                          key={h.tag}
                          type="button"
                          onClick={() => goToResult(`/discover?q=${encodeURIComponent(h.tag)}`, `#${h.tag}`)}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 hover:border-brand text-xs font-medium"
                        >
                          <span className="text-brand font-semibold">#{h.tag}</span>
                          <span className="text-[11px] font-mono text-neutral-400 tabular-nums">{h.count}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Communities */}
                {(activeTab === 'all' || activeTab === 'communities') && communities.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                      <Compass className="w-3.5 h-3.5" /> Communities
                    </h4>
                    <div className="space-y-1">
                      {communities.map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() => goToResult('/communities', term.trim())}
                          className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-left transition-colors"
                        >
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-neutral-950 dark:text-white truncate">{c.name}</p>
                            <p className="text-[11px] text-neutral-500 truncate tabular-nums">
                              {c.category} {c.district ? `· ${c.district}` : ''} · {c.membersCount} members
                            </p>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* Videos & Reels */}
                {(activeTab === 'all' || activeTab === 'videos') &&
                  (reels.length > 0 || videoPosts.length > 0) && (
                    <section className="space-y-2">
                      <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                        <Film className="w-3.5 h-3.5" /> Videos & Reels
                      </h4>
                      <div className="space-y-1">
                        {reels.map((r) => (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => goToResult('/reels', term.trim())}
                            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-left transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-neutral-950 dark:text-white truncate">
                                {r.caption || `Reel by @${r.authorUsername}`}
                              </p>
                              <p className="text-[11px] text-neutral-500 truncate tabular-nums">
                                Reel · @{r.authorUsername} · {formatCompactNumber(r.viewsCount)} views
                              </p>
                            </div>
                            <Film className="w-4 h-4 text-brand shrink-0" />
                          </button>
                        ))}
                        {videoPosts.map((vp) => (
                          <button
                            key={vp.id}
                            type="button"
                            onClick={() =>
                              goToResult(`/discover?q=${encodeURIComponent(term.trim())}`, term.trim())
                            }
                            className="w-full flex items-center justify-between gap-3 p-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-left transition-colors"
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-neutral-950 dark:text-white truncate">
                                {vp.content || `Video post by ${vp.authorName}`}
                              </p>
                              <p className="text-[11px] text-neutral-500 truncate">
                                Video Post · @{vp.authorUsername} · {formatRelativeTime(vp.createdAt)}
                              </p>
                            </div>
                            <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                          </button>
                        ))}
                      </div>
                    </section>
                  )}

                {/* Posts */}
                {(activeTab === 'all' || activeTab === 'posts') && posts.length > 0 && (
                  <section className="space-y-2">
                    <h4 className="text-xs font-semibold uppercase tracking-wider text-neutral-500 flex items-center gap-1.5">
                      <FileText className="w-3.5 h-3.5" /> Posts
                    </h4>
                    <div className="space-y-1">
                      {posts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() =>
                            goToResult(`/discover?q=${encodeURIComponent(term.trim())}`, term.trim())
                          }
                          className="w-full flex items-start justify-between gap-3 p-2.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 text-left transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-medium text-neutral-900 dark:text-neutral-100 line-clamp-2">
                              {p.content || `[${p.type}] post`}
                            </p>
                            <p className="text-[11px] text-neutral-500 mt-0.5">
                              {p.authorName} · @{p.authorUsername} · {formatRelativeTime(p.createdAt)}
                            </p>
                          </div>
                          <ArrowUpRight className="w-3.5 h-3.5 text-neutral-400 shrink-0 mt-0.5" />
                        </button>
                      ))}
                    </div>
                  </section>
                )}
              </div>
            )}
          </div>

          {hasQuery && (
            <div className="px-4 py-2.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/50 flex items-center justify-between">
              <span className="text-[11px] text-neutral-500">
                Press Enter to filter the Discover Feed
              </span>
              <button
                type="button"
                onClick={() =>
                  goToResult(`/discover?q=${encodeURIComponent(term.trim().replace(/^#/, ''))}`, term.trim())
                }
                className="text-xs font-semibold text-brand hover:underline"
              >
                View all feed matches →
              </button>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmClearOpen}
        title="Clear search history?"
        description="This removes all saved recent searches from your BANA account and this browser."
        confirmLabel="Clear History"
        loading={clearingHistory}
        onConfirm={handleClearHistory}
        onCancel={() => setConfirmClearOpen(false)}
      />
    </>
  );
}
