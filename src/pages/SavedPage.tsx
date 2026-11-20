import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Bookmark,
  Film,
  Image as ImageIcon,
  FileText,
  Video,
  Trash2,
  Loader2,
  Play,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  getDoc,
  doc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { BanaPost, BanaReel } from '@/src/types/bana';
import { AppShell } from '@/src/components/layout/AppShell';
import { PostCard } from '@/src/components/feed/PostCard';
import { Avatar } from '@/src/components/common/Avatar';
import { formatCompactNumber, formatRelativeTime } from '@/src/lib/mediaUtils';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';

type SavedTab = 'all' | 'posts' | 'videos' | 'reels';

const SAVED_COLLECTIONS = ['General', 'Watch Later', 'Inspiration', 'Learning', 'Shopping'];

interface HydratedSavedEntry {
  saveId: string;
  targetType: 'post' | 'photo' | 'video' | 'reel';
  collectionName: string;
  savedAt?: any;
  post?: BanaPost;
  reel?: BanaReel;
}

export function SavedPage() {
  const { firebaseUser } = useAuth();
  const toast = useToast();

  const [tab, setTab] = useState<SavedTab>('all');
  const [selectedCollection, setSelectedCollection] = useState<string>('All');
  const [entries, setEntries] = useState<HydratedSavedEntry[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const loadSaved = useCallback(
    async (reset = true) => {
      if (!firebaseUser) {
        setLoading(false);
        return;
      }
      if (reset) {
        setLoading(true);
      } else {
        setLoadingMore(true);
      }

      try {
        const pageSize = 12;
        const constraints: any[] = [
          where('userId', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc'),
          limit(pageSize),
        ];
        if (!reset && lastDoc) {
          constraints.push(startAfter(lastDoc));
        }

        const primaryPostsQ = query(collection(db, 'savedPosts'), ...constraints);
        const fallbackPostsQ = query(collection(db, 'savedPosts'), where('userId', '==', firebaseUser.uid), limit(50));

        const [savedRes, savedVidRes] = await Promise.all([
          getDocsWithIndexFallback<{ id: string; postId?: string; targetType?: string; collectionName?: string; createdAt?: any }>(
            primaryPostsQ,
            fallbackPostsQ,
            sortByCreatedAtDesc
          ),
          reset
            ? getDocsWithIndexFallback<{ id: string; postId?: string; collectionName?: string; createdAt?: any }>(
                query(
                  collection(db, 'savedVideos'),
                  where('userId', '==', firebaseUser.uid),
                  orderBy('createdAt', 'desc'),
                  limit(20)
                ),
                query(collection(db, 'savedVideos'), where('userId', '==', firebaseUser.uid), limit(30)),
                sortByCreatedAtDesc
              ).catch(() => null)
            : Promise.resolve(null),
        ]);

        const savedSnap = savedRes.snap;
        const rawMap = new Map<
          string,
          { saveId: string; postId: string; targetType?: string; collectionName?: string; createdAt?: any }
        >();

        savedRes.items.forEach((data) => {
          rawMap.set(data.id, {
            saveId: data.id,
            postId: String(data.postId),
            targetType: data.targetType,
            collectionName: data.collectionName || 'General',
            createdAt: data.createdAt,
          });
        });

        savedVidRes?.items.forEach((data) => {
          if (!rawMap.has(data.id)) {
            rawMap.set(data.id, {
              saveId: data.id,
              postId: String(data.postId),
              targetType: 'video',
              collectionName: data.collectionName || 'General',
              createdAt: data.createdAt,
            });
          }
        });

        const hydrated: HydratedSavedEntry[] = [];
        await Promise.all(
          Array.from(rawMap.values()).map(async (item) => {
            if (item.targetType === 'reel') {
              const rSnap = await getDoc(doc(db, 'reels', item.postId)).catch(() => null);
              if (rSnap?.exists()) {
                hydrated.push({
                  saveId: item.saveId,
                  targetType: 'reel',
                  collectionName: item.collectionName || 'General',
                  savedAt: item.createdAt,
                  reel: { id: rSnap.id, ...(rSnap.data() as Omit<BanaReel, 'id'>) },
                });
              }
              return;
            }

            const pSnap = await getDoc(doc(db, 'posts', item.postId)).catch(() => null);
            if (pSnap?.exists()) {
              const pData = { id: pSnap.id, ...(pSnap.data() as Omit<BanaPost, 'id'>) };
              const inferredType =
                item.targetType === 'video' || pData.type === 'video'
                  ? 'video'
                  : item.targetType === 'photo' || pData.type === 'image' || pData.type === 'gallery'
                  ? 'photo'
                  : 'post';
              hydrated.push({
                saveId: item.saveId,
                targetType: inferredType,
                collectionName: item.collectionName || 'General',
                savedAt: item.createdAt,
                post: pData,
              });
              return;
            }

            // Fallback check in reels collection for legacy saves without targetType
            const rSnap = await getDoc(doc(db, 'reels', item.postId)).catch(() => null);
            if (rSnap?.exists()) {
              hydrated.push({
                saveId: item.saveId,
                targetType: 'reel',
                collectionName: item.collectionName || 'General',
                savedAt: item.createdAt,
                reel: { id: rSnap.id, ...(rSnap.data() as Omit<BanaReel, 'id'>) },
              });
            }
          })
        );

        hydrated.sort((a, b) => {
          const ams = a.savedAt?.toMillis ? a.savedAt.toMillis() : 0;
          const bms = b.savedAt?.toMillis ? b.savedAt.toMillis() : 0;
          return bms - ams;
        });

        setLastDoc(savedSnap.docs[savedSnap.docs.length - 1] || null);
        setHasMore(savedSnap.docs.length === pageSize);
        setEntries((prev) => {
          if (reset) return hydrated;
          const seen = new Set(prev.map((x) => x.saveId));
          return [...prev, ...hydrated.filter((x) => !seen.has(x.saveId))];
        });
      } catch (err) {
        logFirestoreError(err, OperationType.LIST, 'savedPosts');
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [firebaseUser, lastDoc]
  );

  useEffect(() => {
    loadSaved(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid]);

  const handleUnsaveEntry = async (entry: HydratedSavedEntry) => {
    setEntries((prev) => prev.filter((e) => e.saveId !== entry.saveId));
    await Promise.all([
      deleteDoc(doc(db, 'savedPosts', entry.saveId)).catch(() => {}),
      deleteDoc(doc(db, 'savedVideos', entry.saveId)).catch(() => {}),
    ]);
    toast.info('Removed from Saved.');
  };

  const handleCollectionChange = async (entry: HydratedSavedEntry, nextCol: string) => {
    setEntries((prev) =>
      prev.map((e) => (e.saveId === entry.saveId ? { ...e, collectionName: nextCol } : e))
    );
    await Promise.all([
      updateDoc(doc(db, 'savedPosts', entry.saveId), {
        collectionName: nextCol,
        updatedAt: serverTimestamp(),
      }).catch(() => {}),
      updateDoc(doc(db, 'savedVideos', entry.saveId), {
        collectionName: nextCol,
        updatedAt: serverTimestamp(),
      }).catch(() => {}),
    ]);
    toast.success(`Moved to "${nextCol}" collection.`);
  };

  const filtered = useMemo(() => {
    const byTab =
      tab === 'all'
        ? entries
        : tab === 'posts'
        ? entries.filter((e) => e.targetType === 'post' || e.targetType === 'photo')
        : tab === 'videos'
        ? entries.filter((e) => e.targetType === 'video' || e.targetType === 'reel')
        : entries.filter((e) => e.targetType === 'reel');

    if (selectedCollection === 'All') return byTab;
    return byTab.filter((e) => e.collectionName === selectedCollection);
  }, [entries, tab, selectedCollection]);

  const counts = useMemo(
    () => ({
      all: entries.length,
      posts: entries.filter((e) => e.targetType === 'post' || e.targetType === 'photo').length,
      videos: entries.filter((e) => e.targetType === 'video' || e.targetType === 'reel').length,
      reels: entries.filter((e) => e.targetType === 'reel').length,
    }),
    [entries]
  );

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center">
                <Bookmark className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display font-bold text-lg text-neutral-950 dark:text-white">
                  Saved Library
                </h1>
                <p className="text-xs text-neutral-500">
                  Private collection of your bookmarked posts, photos, videos, and Reels
                </p>
              </div>
            </div>

            <div className="inline-flex p-1 rounded-xl bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 overflow-x-auto no-scrollbar">
              {(
                [
                  { id: 'all', label: `All (${counts.all})`, icon: Bookmark },
                  { id: 'posts', label: `Posts & Photos (${counts.posts})`, icon: FileText },
                  { id: 'videos', label: `Videos (${counts.videos})`, icon: Video },
                  { id: 'reels', label: `Reels (${counts.reels})`, icon: Film },
                ] as { id: SavedTab; label: string; icon: React.ComponentType<{ className?: string }> }[]
              ).map((t) => {
                const Icon = t.icon;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                      tab === t.id
                        ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-xs'
                        : 'text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Saved Collections Filter Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-2 border-t border-neutral-100 dark:border-neutral-800">
            <span className="text-[11px] font-medium text-neutral-500 pr-1 whitespace-nowrap">Collections:</span>
            {['All', ...SAVED_COLLECTIONS].map((col) => (
              <button
                key={col}
                type="button"
                onClick={() => setSelectedCollection(col)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  selectedCollection === col
                    ? 'bg-[#1877F2] text-white'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                }`}
              >
                {col}
              </button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((k) => (
              <div
                key={k}
                className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3 animate-pulse"
              >
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                  <div className="space-y-1.5 flex-1">
                    <div className="h-3 w-36 rounded bg-neutral-200 dark:bg-neutral-800" />
                    <div className="h-2.5 w-24 rounded bg-neutral-100 dark:bg-neutral-800" />
                  </div>
                </div>
                <div className="h-24 w-full rounded-xl bg-neutral-100 dark:bg-neutral-800" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center space-y-3">
            <div className="mx-auto h-12 w-12 rounded-xl bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-400">
              {tab === 'videos' || tab === 'reels' ? (
                <Film className="w-6 h-6" />
              ) : tab === 'posts' ? (
                <ImageIcon className="w-6 h-6" />
              ) : (
                <Bookmark className="w-6 h-6" />
              )}
            </div>
            <h2 className="font-display font-bold text-base">No saved items yet</h2>
            <p className="text-xs text-neutral-500 max-w-sm mx-auto">
              Tap the bookmark icon on any post, video, or Reel across BANA to save it privately here.
            </p>
            <div className="flex items-center justify-center gap-2 pt-1">
              <Link
                to="/discover"
                className="px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors"
              >
                Explore Feed
              </Link>
              <Link
                to="/reels"
                className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-100 dark:hover:bg-neutral-800"
              >
                Watch Reels
              </Link>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {filtered.map((entry) => {
              if (entry.post) {
                return (
                  <div key={entry.saveId} className="space-y-1.5">
                    <div className="flex items-center justify-end gap-2 px-1 text-[11px] text-neutral-500">
                      <span>Collection:</span>
                      <select
                        aria-label="Saved item collection"
                        value={entry.collectionName}
                        onChange={(e) => handleCollectionChange(entry, e.target.value)}
                        className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-0.5 text-[11px] font-medium"
                      >
                        {SAVED_COLLECTIONS.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </div>
                    <PostCard
                      post={entry.post}
                      onUnsaved={() =>
                        setEntries((prev) => prev.filter((item) => item.saveId !== entry.saveId))
                      }
                      onDeleted={() =>
                        setEntries((prev) => prev.filter((item) => item.saveId !== entry.saveId))
                      }
                    />
                  </div>
                );
              }

              if (entry.reel) {
                const reel = entry.reel;
                return (
                  <div
                    key={entry.saveId}
                    className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 flex flex-col sm:flex-row gap-4"
                  >
                    <Link
                      to="/reels"
                      className="relative w-full sm:w-36 aspect-[9/14] rounded-xl overflow-hidden bg-black shrink-0 group"
                    >
                      <video
                        src={reel.videoUrl}
                        poster={reel.thumbnailUrl || undefined}
                        muted
                        playsInline
                        preload="metadata"
                        className="w-full h-full object-cover"
                      />
                      <span className="absolute inset-0 flex items-center justify-center bg-black/25 group-hover:bg-black/40 transition-colors">
                        <span className="h-10 w-10 rounded-full bg-white/90 text-neutral-950 flex items-center justify-center shadow">
                          <Play className="w-4 h-4 fill-current ml-0.5" />
                        </span>
                      </span>
                    </Link>

                    <div className="flex-1 min-w-0 flex flex-col justify-between gap-3">
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <Link
                            to={`/profile/${reel.authorUsername}`}
                            className="inline-flex items-center gap-2 min-w-0"
                          >
                            <Avatar src={reel.authorAvatar} name={reel.authorName} size="sm" />
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-neutral-950 dark:text-white truncate">
                                {reel.authorName}
                              </p>
                              <p className="text-[11px] text-neutral-500 truncate">
                                @{reel.authorUsername} · Reel · {formatRelativeTime(reel.createdAt)}
                              </p>
                            </div>
                          </Link>

                          <button
                            type="button"
                            onClick={() => handleUnsaveEntry(entry)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-medium text-neutral-600 dark:text-neutral-300 hover:text-rose-600 hover:border-rose-300"
                          >
                            <Trash2 className="w-3.5 h-3.5" /> Unsave
                          </button>
                        </div>

                        {reel.caption && (
                          <p className="text-sm text-neutral-800 dark:text-neutral-200 line-clamp-3">
                            {reel.caption}
                          </p>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-500">
                        <span className="font-mono tabular-nums">
                          {formatCompactNumber(reel.viewsCount)} views · {formatCompactNumber(reel.likesCount)} likes
                        </span>
                        <Link
                          to="/reels"
                          className="font-semibold text-[#1877F2] hover:underline"
                        >
                          Watch in Reels →
                        </Link>
                      </div>
                    </div>
                  </div>
                );
              }

              return null;
            })}

            {hasMore && (
              <div className="pt-2 text-center">
                <button
                  type="button"
                  disabled={loadingMore}
                  onClick={() => loadSaved(false)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Load more saved items
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </AppShell>
  );
}
