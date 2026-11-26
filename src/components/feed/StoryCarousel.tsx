import React, { useCallback, useEffect, useState } from 'react';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';
import {
  Plus,
  X,
  Heart,
  Eye,
  ChevronLeft,
  ChevronRight,
  Trash2,
  Pause,
  Play,
  Send,
} from 'lucide-react';
import {
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  getDoc,
  doc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  updateDoc,
  increment,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { BanaStory, ReactionType } from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import { ReactionPickerButton } from '@/src/components/feed/ReactionBar';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { readSessionCache, writeSessionCache } from '@/src/lib/firebasePlan';

const STORY_DURATION_MS = 5500;

export function StoryCarousel({ onAddStory }: { onAddStory: () => void }) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [stories, setStories] = useState<BanaStory[]>([]);
  const [viewedIds, setViewedIds] = useState<Record<string, boolean>>({});
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [progress, setProgress] = useState(0);
  const [userReaction, setUserReaction] = useState<ReactionType | null>(null);
  const [replyText, setReplyText] = useState('');
  const [sendingReply, setSendingReply] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [useBackupMedia, setUseBackupMedia] = useState(false);

  // Load stories & strictly filter out >= 24h expired or removed stories from public feed
  useEffect(() => {
    const cacheKey = `bana_stories_cache_${firebaseUser ? 'auth' : 'guest'}`;
    const cached = readSessionCache<BanaStory[]>(cacheKey, 60 * 1000);
    if (cached) {
      const now = Date.now();
      setStories(
        cached.filter((s) => {
          const exp = s.expiresAt?.toDate
            ? s.expiresAt.toDate().getTime()
            : s.expiresAt?.seconds
            ? Number(s.expiresAt.seconds) * 1000
            : 0;
          return exp > now && (!s.status || s.status === 'active');
        })
      );
    }

    const primaryQ = firebaseUser
      ? query(collection(db, 'stories'), orderBy('createdAt', 'desc'), limit(25))
      : query(
          collection(db, 'stories'),
          where('visibility', '==', 'public'),
          orderBy('createdAt', 'desc'),
          limit(25)
        );
    const fallbackQ = firebaseUser
      ? query(collection(db, 'stories'), limit(30))
      : query(collection(db, 'stories'), where('visibility', '==', 'public'), limit(30));

    getDocsWithIndexFallback<BanaStory>(primaryQ, fallbackQ, sortByCreatedAtDesc)
      .then(({ items }) => {
        const now = Date.now();
        const valid = items.filter((s) => {
          if (s.status && s.status !== 'active') return false;
          const exp = s.expiresAt?.toDate
            ? s.expiresAt.toDate().getTime()
            : s.expiresAt?.seconds
            ? Number(s.expiresAt.seconds) * 1000
            : s.createdAt?.toDate
            ? s.createdAt.toDate().getTime() + 24 * 60 * 60 * 1000
            : 0;
          return exp > now;
        });
        setStories(valid);
        writeSessionCache(cacheKey, valid);
      })
      .catch((err) => logFirestoreError(err, OperationType.LIST, 'stories'));
  }, [firebaseUser]);

  // Hydrate persisted viewed story state from Firestore
  useEffect(() => {
    if (!firebaseUser) {
      setViewedIds({});
      return;
    }
    getDocs(
      query(
        collection(db, 'storyViews'),
        where('viewerId', '==', firebaseUser.uid),
        limit(100)
      )
    )
      .then((snap) => {
        const map: Record<string, boolean> = {};
        snap.docs.forEach((d) => {
          const sid = d.data().storyId;
          if (sid) map[String(sid)] = true;
        });
        setViewedIds(map);
      })
      .catch(() => {});
  }, [firebaseUser]);

  const activeStory = activeIndex !== null ? stories[activeIndex] || null : null;

  useEffect(() => {
    setUseBackupMedia(false);
    setReplyText('');
  }, [activeStory?.id]);

  const markStoryViewed = useCallback(
    async (story: BanaStory) => {
      if (viewedIds[story.id]) return;
      setViewedIds((prev) => ({ ...prev, [story.id]: true }));
      if (firebaseUser) {
        await setDoc(doc(db, 'storyViews', `${story.id}_${firebaseUser.uid}`), {
          storyId: story.id,
          storyAuthorId: story.authorId,
          viewerId: firebaseUser.uid,
          createdAt: serverTimestamp(),
        }).catch(() => {});
        await updateDoc(doc(db, 'stories', story.id), { viewsCount: increment(1) }).catch(() => {});
      }
    },
    [firebaseUser, viewedIds]
  );

  const openStoryAt = useCallback(
    (idx: number) => {
      const target = stories[idx];
      if (!target) return;
      setActiveIndex(idx);
      setPaused(false);
      setProgress(0);
      markStoryViewed(target);
    },
    [stories, markStoryViewed]
  );

  const goNext = useCallback(() => {
    if (activeIndex === null) return;
    if (activeIndex < stories.length - 1) {
      openStoryAt(activeIndex + 1);
    } else {
      setActiveIndex(null);
    }
  }, [activeIndex, stories.length, openStoryAt]);

  const goPrev = useCallback(() => {
    if (activeIndex === null) return;
    if (activeIndex > 0) {
      openStoryAt(activeIndex - 1);
    } else {
      setProgress(0);
    }
  }, [activeIndex, openStoryAt]);

  useEffect(() => {
    if (!activeStory || !firebaseUser) {
      setUserReaction(null);
      return;
    }
    getDoc(doc(db, 'postLikes', `${activeStory.id}_${firebaseUser.uid}`))
      .then((s) => {
        setUserReaction(s.exists() ? ((s.data().reactionType as ReactionType) || 'love') : null);
      })
      .catch(() => setUserReaction(null));
  }, [activeStory, firebaseUser]);

  useEffect(() => {
    if (!activeStory || paused || confirmDeleteOpen || replyText.length > 0) return;
    if (activeStory.mediaType === 'video') return;

    setProgress(0);
    const start = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / STORY_DURATION_MS) * 100);
      setProgress(pct);
      if (pct >= 100) {
        window.clearInterval(interval);
        goNext();
      }
    }, 60);
    return () => window.clearInterval(interval);
  }, [activeStory, paused, confirmDeleteOpen, replyText.length, goNext]);

  useEffect(() => {
    if (activeIndex === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (confirmDeleteOpen) return;
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (e.key === 'Escape') setActiveIndex(null);
      else if (e.key === 'ArrowRight') goNext();
      else if (e.key === 'ArrowLeft') goPrev();
      else if (e.key === ' ') {
        e.preventDefault();
        setPaused((p) => !p);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeIndex, confirmDeleteOpen, goNext, goPrev]);

  const reactToStory = async (reaction: ReactionType) => {
    if (!firebaseUser) {
      openAuthModal('Sign in to react to stories.');
      return;
    }
    if (!activeStory) return;
    const isRemoving = userReaction === reaction;
    const nextReaction = isRemoving ? null : reaction;
    setUserReaction(nextReaction);

    const ref = doc(db, 'postLikes', `${activeStory.id}_${firebaseUser.uid}`);
    try {
      if (nextReaction) {
        await setDoc(ref, {
          userId: firebaseUser.uid,
          targetType: 'story',
          targetId: activeStory.id,
          reactionType: nextReaction,
          createdAt: serverTimestamp(),
        });
      } else {
        await deleteDoc(ref);
      }
    } catch {
      setUserReaction(userReaction);
    }
  };

  const handleSendStoryReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to reply to this Story.');
      return;
    }
    if (!activeStory || !replyText.trim() || sendingReply) return;
    const msg = replyText.trim().slice(0, 500);
    setSendingReply(true);
    try {
      await addDoc(collection(db, 'storyReplies'), {
        storyId: activeStory.id,
        storyAuthorId: activeStory.authorId,
        senderId: firebaseUser.uid,
        senderUsername: profile.username,
        senderName: profile.displayName,
        senderAvatar: profile.avatarUrl || '',
        message: msg,
        createdAt: serverTimestamp(),
      });
      if (activeStory.authorId !== firebaseUser.uid) {
        await addDoc(collection(db, 'notifications'), {
          recipientId: activeStory.authorId,
          actorId: firebaseUser.uid,
          actorName: profile.displayName,
          actorAvatar: profile.avatarUrl || '',
          type: 'comment',
          title: 'Story Reply',
          body: `${profile.displayName} replied to your story: "${msg.slice(0, 70)}"`,
          linkUrl: `/profile/${activeStory.authorUsername}`,
          isRead: false,
          createdAt: serverTimestamp(),
        }).catch(() => {});
      }
      setReplyText('');
      toast.success('Reply sent to story author.');
    } catch {
      toast.error('Could not send story reply.');
    } finally {
      setSendingReply(false);
    }
  };

  const handleDeleteStory = async () => {
    if (!activeStory || !firebaseUser || activeStory.authorId !== firebaseUser.uid) return;
    setDeleting(true);
    try {
      // Remove from active 24h stories feed while keeping archival backup copy under retention policy
      await deleteDoc(doc(db, 'stories', activeStory.id));
      await updateDoc(doc(db, 'storyBackups', activeStory.id), {
        expiredFromFeed: true,
        deletedByOwnerAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }).catch(() => {});

      setStories((prev) => prev.filter((s) => s.id !== activeStory.id));
      try {
        sessionStorage.removeItem('bana_stories_cache_auth');
        sessionStorage.removeItem('bana_stories_cache_guest');
      } catch {
        // ignore cache error
      }
      toast.success('Story removed from active feed (archival backup retained under retention policy).');
      setConfirmDeleteOpen(false);
      setActiveIndex(null);
    } catch {
      toast.error('Could not remove story. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  const activeMediaSrc =
    useBackupMedia && activeStory?.backupMediaUrl
      ? activeStory.backupMediaUrl
      : activeStory?.mediaUrl || '';

  return (
    <>
      <div className="flex items-center gap-3.5 overflow-x-auto no-scrollbar pb-1">
        {/* Add Story Button */}
        <button
          type="button"
          onClick={onAddStory}
          className="flex flex-col items-center gap-1.5 shrink-0 group"
        >
          <div className="relative h-16 w-16 rounded-full p-0.5 border border-dashed border-neutral-300 dark:border-neutral-700 flex items-center justify-center bg-neutral-50 dark:bg-neutral-900 group-hover:border-brand transition-colors">
            <Avatar src={profile?.avatarUrl} name={profile?.displayName || 'You'} size="lg" />
            <span className="absolute -bottom-0.5 -right-0.5 h-6 w-6 rounded-full bg-brand text-white border-2 border-white dark:border-neutral-950 flex items-center justify-center">
              <Plus className="w-3.5 h-3.5" />
            </span>
          </div>
          <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300 max-w-[68px] truncate">
            Your Story
          </span>
        </button>

        {stories.map((story, idx) => {
          const isViewed = viewedIds[story.id];
          return (
            <button
              key={story.id}
              type="button"
              onClick={() => openStoryAt(idx)}
              className="flex flex-col items-center gap-1.5 shrink-0 group"
            >
              <div
                className={`h-16 w-16 rounded-full p-[2.5px] transition-transform group-hover:scale-[1.03] ${
                  isViewed
                    ? 'bg-neutral-300 dark:bg-neutral-700'
                    : 'bg-gradient-to-tr from-brand to-emerald-500'
                }`}
              >
                <div className="h-full w-full rounded-full p-0.5 bg-white dark:bg-neutral-950 flex items-center justify-center">
                  <Avatar src={story.authorAvatar} name={story.authorName} size="lg" />
                </div>
              </div>
              <span className="text-[11px] font-medium text-neutral-700 dark:text-neutral-300 max-w-[68px] truncate">
                {story.authorUsername}
              </span>
            </button>
          );
        })}
      </div>

      {/* Fullscreen Story Viewer */}
      {activeStory && activeIndex !== null && (
        <div className="fixed inset-0 z-50 bg-black/95 flex items-center justify-center">
          <div className="animate-modal-in relative w-full max-w-md h-full sm:h-[90vh] sm:rounded-2xl overflow-hidden bg-neutral-950 flex flex-col">
            {/* Multi-segment Progress Bars + Meta */}
            <div className="absolute inset-x-0 top-0 z-20 p-4 bg-gradient-to-b from-black/80 to-transparent space-y-3">
              <div className="flex items-center gap-1">
                {stories.map((s, idx) => (
                  <div key={s.id} className="h-1 flex-1 rounded-full bg-white/30 overflow-hidden">
                    <div
                      className="h-full bg-white transition-[width] duration-75"
                      style={{
                        width:
                          idx < activeIndex
                            ? '100%'
                            : idx === activeIndex
                            ? activeStory.mediaType === 'video'
                              ? '100%'
                              : `${progress}%`
                            : '0%',
                      }}
                    />
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-white">
                <div className="flex items-center gap-2.5 min-w-0">
                  <Avatar src={activeStory.authorAvatar} name={activeStory.authorName} size="sm" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold truncate flex items-center gap-1">
                      <span className="truncate">{activeStory.authorName}</span>
                      <LiveVerifiedBadge uid={activeStory.authorId} size={12} />
                    </p>
                    <p className="text-[11px] text-white/70 truncate">
                      {formatRelativeTime(activeStory.createdAt)} · {activeStory.visibility}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {activeStory.mediaType !== 'video' && (
                    <button
                      type="button"
                      onClick={() => setPaused((p) => !p)}
                      aria-label={paused ? 'Resume story' : 'Pause story'}
                      className="h-9 w-9 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center"
                    >
                      {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
                    </button>
                  )}
                  {firebaseUser?.uid === activeStory.authorId && (
                    <button
                      type="button"
                      onClick={() => {
                        setPaused(true);
                        setConfirmDeleteOpen(true);
                      }}
                      aria-label="Delete story"
                      className="h-9 w-9 rounded-full bg-black/40 hover:bg-rose-600/80 flex items-center justify-center"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setActiveIndex(null)}
                    aria-label="Close story viewer"
                    className="h-9 w-9 rounded-full bg-black/40 hover:bg-black/60 flex items-center justify-center"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Story Canvas (Text, Video, or Image with auto backup fallback) */}
            <div className="relative flex-1 flex items-center justify-center bg-black">
              {activeStory.mediaType === 'text' ? (
                <div
                  className={`w-full h-full flex items-center justify-center p-8 text-center ${
                    activeStory.bgGradient || 'bg-gradient-to-br from-brand via-blue-600 to-blue-700'
                  }`}
                >
                  <p className="font-display font-bold text-2xl sm:text-3xl text-white leading-snug drop-shadow-sm whitespace-pre-wrap break-words">
                    {activeStory.caption || 'BANA Story'}
                  </p>
                </div>
              ) : activeStory.mediaType === 'video' ? (
                <video
                  src={activeMediaSrc}
                  autoPlay
                  playsInline
                  controls
                  onEnded={goNext}
                  onError={() => {
                    if (!useBackupMedia && activeStory.backupMediaUrl) {
                      setUseBackupMedia(true);
                    }
                  }}
                  className="w-full h-full object-contain"
                />
              ) : (
                <img loading="lazy"
                  src={activeMediaSrc}
                  alt={activeStory.caption || 'Story'}
                  referrerPolicy="no-referrer"
                  onError={() => {
                    if (!useBackupMedia && activeStory.backupMediaUrl) {
                      setUseBackupMedia(true);
                    }
                  }}
                  className="w-full h-full object-contain"
                />
              )}

              {activeIndex > 0 && (
                <button
                  type="button"
                  onClick={goPrev}
                  aria-label="Previous story"
                  className="absolute left-2 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
              )}
              <button
                type="button"
                onClick={goNext}
                aria-label="Next story"
                className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-full bg-black/45 hover:bg-black/70 text-white flex items-center justify-center"
              >
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>

            {/* Bottom Caption, Reply Input & Reaction Bar */}
            <div className="absolute inset-x-0 bottom-0 z-20 p-4 bg-gradient-to-t from-black/90 via-black/65 to-transparent space-y-2.5 text-white">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  {activeStory.mediaType !== 'text' && activeStory.caption && (
                    <p className="text-sm mb-1 line-clamp-2">{activeStory.caption}</p>
                  )}
                  <p className="inline-flex items-center gap-1 text-xs text-white/75 font-mono tabular-nums">
                    <Eye className="w-3.5 h-3.5" /> {activeStory.viewsCount || 0} views
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <ReactionPickerButton
                    variant="overlay"
                    currentReaction={userReaction}
                    totalCount={0}
                    onSelect={reactToStory}
                  />
                  <button
                    type="button"
                    onClick={() => reactToStory('love')}
                    className={`h-9 px-3.5 rounded-full inline-flex items-center gap-1.5 text-xs font-medium transition-colors ${
                      userReaction
                        ? 'bg-rose-600 text-white'
                        : 'bg-white/15 hover:bg-white/25 text-white'
                    }`}
                  >
                    <Heart className={`w-4 h-4 ${userReaction ? 'fill-current' : ''}`} />
                    {userReaction ? 'Reacted' : 'Love'}
                  </button>
                </div>
              </div>

              <form onSubmit={handleSendStoryReply} className="flex items-center gap-2">
                <input
                  type="text"
                  value={replyText}
                  onFocus={() => setPaused(true)}
                  onChange={(e) => setReplyText(e.target.value)}
                  placeholder={`Reply to ${activeStory.authorName}...`}
                  className="flex-1 h-9 rounded-full border border-white/25 bg-white/10 backdrop-blur-sm px-3.5 text-xs text-white placeholder:text-white/60 focus:outline-none focus:border-white/50"
                />
                <button
                  type="submit"
                  disabled={sendingReply || !replyText.trim()}
                  aria-label="Send story reply"
                  className="h-9 w-9 rounded-full bg-brand hover:bg-brand-hover text-white flex items-center justify-center disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={confirmDeleteOpen}
        title="Remove this story from active feed?"
        description="This story will disappear immediately from BANA Stories, while its backup copy stays governed by platform retention policy."
        confirmLabel="Remove Story"
        loading={deleting}
        onConfirm={handleDeleteStory}
        onCancel={() => {
          setConfirmDeleteOpen(false);
          setPaused(false);
        }}
      />
    </>
  );
}
