import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Heart,
  MessageCircle,
  Share2,
  Bookmark,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  Music2,
  Plus,
  RotateCcw,
  Loader2,
  Play,
  Pause,
  Film,
  Flag,
  Search,
  X,
  MoreHorizontal,
  EyeOff,
  UserX,
  SlidersHorizontal,
  Subtitles,
  Link2,
  RefreshCw,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { FIREBASE_PLAN_MODE } from '@/src/lib/firebasePlan';
import { useAuth } from '@/src/contexts/AuthContext';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { useToast } from '@/src/contexts/ToastContext';
import type { AdCampaign, BanaReel, DiscoveryCategory, ReactionType } from '@/src/types/bana';
import { AppShell } from '@/src/components/layout/AppShell';
import { Avatar } from '@/src/components/common/Avatar';
import { VerifiedBadge } from '@/src/components/common/BanaLogo';
import { ReelUploadModal } from '@/src/components/reels/ReelUploadModal';
import { ReelCommentsPanel } from '@/src/components/reels/ReelCommentsPanel';
import { ReportDialog } from '@/src/components/common/ReportDialog';
import { ReactionPickerButton } from '@/src/components/feed/ReactionBar';
import { ShareToMessengerModal } from '@/src/components/feed/ShareToMessengerModal';
import { SponsoredAdCard } from '@/src/components/ads/SponsoredAdCard';
import { fetchEligibleAdsForPlacement } from '@/src/lib/ads';
import { recordQualifiedView } from '@/src/lib/monetization';
import { formatCompactNumber } from '@/src/lib/mediaUtils';
import {
  detectNetworkSavingMode,
  formatDurationClock,
  rankReelsForDiscovery,
  type ReelFeedTab,
} from '@/src/lib/videoUtils';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';

const FEED_TABS: { id: ReelFeedTab; label: string }[] = [
  { id: 'recommended', label: 'For You' },
  { id: 'following', label: 'Following' },
  { id: 'trending', label: 'Trending' },
  { id: 'new', label: 'New' },
  { id: 'Entertainment', label: 'Entertainment' },
  { id: 'Technology', label: 'Technology' },
  { id: 'Education', label: 'Education' },
  { id: 'Gaming', label: 'Gaming' },
  { id: 'Lifestyle', label: 'Lifestyle' },
];

function ReelSlide({
  reel,
  index,
  activeIndex,
  isActive,
  muted,
  preloadMode,
  isFollowingCreator,
  onToggleMute,
  onToggleFollow,
  onOpenComments,
  onOpenShare,
  onNotInterested,
  onHideCreator,
  onResetRecommendations,
  onTagClick,
  onBoostCategory,
  onModeChange,
}: {
  reel: BanaReel;
  index: number;
  activeIndex: number;
  isActive: boolean;
  muted: boolean;
  preloadMode: 'auto' | 'saver';
  isFollowingCreator: boolean;
  onToggleMute: () => void;
  onToggleFollow: (authorId: string, currentlyFollowing: boolean) => Promise<void>;
  onOpenComments: (reel: BanaReel) => void;
  onOpenShare: (reel: BanaReel) => void;
  onNotInterested: (reel: BanaReel) => void;
  onHideCreator: (authorId: string, authorUsername: string) => void;
  onResetRecommendations: () => void;
  onTagClick: (tag: string) => void;
  onBoostCategory: (cat?: DiscoveryCategory, delta?: number) => void;
  onModeChange: (mode: 'auto' | 'saver') => void;
}) {
  const { firebaseUser, openAuthModal } = useAuth();
  const toast = useToast();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const [userReaction, setUserReaction] = useState<ReactionType | null>(null);
  const [saved, setSaved] = useState(false);
  const [likesCount, setLikesCount] = useState(reel.likesCount || 0);
  const [buffering, setBuffering] = useState(true);
  const [slowNetworkHint, setSlowNetworkHint] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [tapFeedback, setTapFeedback] = useState<'play' | 'pause' | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(reel.durationSeconds || 0);
  const [heartPop, setHeartPop] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const likeBusyRef = useRef(false);
  const saveBusyRef = useRef(false);
  const [captionExpanded, setCaptionExpanded] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [captionsEnabled, setCaptionsEnabled] = useState(Boolean(reel.captionsVttUrl));
  const [fitMode, setFitMode] = useState<'cover' | 'contain'>(
    reel.aspectRatio === '16:9' ? 'contain' : 'cover'
  );
  const [selectedSrcUrl, setSelectedSrcUrl] = useState(reel.videoUrl);

  const lastTapRef = useRef(0);
  const viewedRef = useRef(false);
  const singleTapTimerRef = useRef<number | null>(null);

  useEffect(() => {
    setSelectedSrcUrl(reel.videoUrl);
    setFitMode(reel.aspectRatio === '16:9' ? 'contain' : 'cover');
    setCaptionsEnabled(Boolean(reel.captionsVttUrl));
  }, [reel.id, reel.videoUrl, reel.aspectRatio, reel.captionsVttUrl]);

  useEffect(() => {
    setLikesCount(reel.likesCount || 0);
  }, [reel.likesCount]);

  // Apply the chosen playback speed (also after the source changes) and reset it per reel.
  useEffect(() => {
    setPlaybackRate(1);
  }, [reel.id]);
  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = playbackRate;
  }, [playbackRate, selectedSrcUrl]);

  useEffect(() => {
    if (!firebaseUser) {
      setUserReaction(null);
      setSaved(false);
      return;
    }
    getDoc(doc(db, 'postLikes', `${reel.id}_${firebaseUser.uid}`))
      .then((s) => setUserReaction(s.exists() ? ((s.data().reactionType as ReactionType) || 'like') : null))
      .catch(() => {});
    getDoc(doc(db, 'savedPosts', `${reel.id}_${firebaseUser.uid}`))
      .then((s) => setSaved(s.exists()))
      .catch(() => {});
  }, [reel.id, firebaseUser]);

  // Preload strategy: release buffers on distant slides and conserve Spark bandwidth
  const distance = Math.abs(index - activeIndex);
  const computedPreload: 'auto' | 'metadata' | 'none' =
    distance > 1
      ? 'none'
      : preloadMode === 'saver'
      ? index === activeIndex
        ? 'metadata'
        : 'none'
      : FIREBASE_PLAN_MODE === 'spark'
      ? index === activeIndex
        ? 'auto'
        : 'metadata'
      : index === activeIndex || index === activeIndex + 1
      ? 'auto'
      : 'metadata';

  // Active playback lifecycle
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (isActive) {
      setIsPaused(false);
      video.play().catch(() => {
        setIsPaused(true);
      });
      if (!viewedRef.current && firebaseUser) {
        viewedRef.current = true;
        const viewDedupeKey = `bana_rv_${reel.id}`;
        let alreadyViewed = false;
        try {
          alreadyViewed = Boolean(sessionStorage.getItem(viewDedupeKey));
          if (!alreadyViewed) sessionStorage.setItem(viewDedupeKey, '1');
        } catch {
          alreadyViewed = false;
        }
        if (!alreadyViewed) {
          setDoc(doc(db, 'reelViews', `${reel.id}_${firebaseUser.uid}_${Date.now()}`), {
            reelId: reel.id,
            viewerId: firebaseUser.uid,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
        onBoostCategory(reel.category, 1);
      }
    } else {
      video.pause();
      setMenuOpen(false);
    }
  }, [isActive, reel.id, reel.category, firebaseUser, onBoostCategory]);

  // Qualified creator view tracking (>= 5s continuous active playback)
  useEffect(() => {
    if (!isActive || isPaused) return;
    const timer = window.setTimeout(() => {
      recordQualifiedView('reel', reel.id, 5).catch(() => {});
    }, 5000);
    return () => window.clearTimeout(timer);
  }, [isActive, isPaused, reel.id]);

  // Pause when browser tab goes to background
  useEffect(() => {
    const onVis = () => {
      if (document.hidden && videoRef.current) {
        videoRef.current.pause();
      } else if (!document.hidden && isActive && !isPaused && videoRef.current) {
        videoRef.current.play().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [isActive, isPaused]);

  // Detect slow buffering (> 4 seconds on active slide)
  useEffect(() => {
    if (!isActive || !buffering || videoError || isPaused) {
      setSlowNetworkHint(false);
      return;
    }
    const timer = window.setTimeout(() => setSlowNetworkHint(true), 4000);
    return () => window.clearTimeout(timer);
  }, [isActive, buffering, videoError, isPaused]);

  const handleReaction = async (reaction: ReactionType, forceSet = false) => {
    if (!firebaseUser) return openAuthModal('Sign in to react to this Reel.');
    if (forceSet && userReaction) return;
    // Prevent duplicate writes / double counting from rapid taps while a write is in flight.
    if (likeBusyRef.current) return;
    likeBusyRef.current = true;
    const isRemoving = !forceSet && userReaction === reaction;
    const nextReaction = isRemoving ? null : reaction;
    const prevReaction = userReaction;
    const prevCount = likesCount;

    setUserReaction(nextReaction);
    setLikesCount((c) => {
      if (!prevReaction && nextReaction) return c + 1;
      if (prevReaction && !nextReaction) return Math.max(0, c - 1);
      return c;
    });

    const likeRef = doc(db, 'postLikes', `${reel.id}_${firebaseUser.uid}`);
    try {
      if (nextReaction) {
        await setDoc(likeRef, {
          userId: firebaseUser.uid,
          targetType: 'reel',
          targetId: reel.id,
          reactionType: nextReaction,
          createdAt: serverTimestamp(),
        });
        if (!prevReaction) onBoostCategory(reel.category, 2);
      } else {
        await deleteDoc(likeRef);
      }
    } catch {
      // Roll back optimistic UI so counters never show a state the backend rejected.
      setUserReaction(prevReaction);
      setLikesCount(prevCount);
      toast.error('Could not update your reaction. Please try again.');
    } finally {
      likeBusyRef.current = false;
    }
  };

  const togglePlayPause = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) {
      v.play().catch(() => {});
      setIsPaused(false);
      setTapFeedback('play');
    } else {
      v.pause();
      setIsPaused(true);
      setTapFeedback('pause');
    }
    window.setTimeout(() => setTapFeedback(null), 550);
  };

  const handleVideoTap = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const now = Date.now();
    if (now - lastTapRef.current < 260) {
      if (singleTapTimerRef.current) {
        window.clearTimeout(singleTapTimerRef.current);
        singleTapTimerRef.current = null;
      }
      setHeartPop(true);
      window.setTimeout(() => setHeartPop(false), 650);
      handleReaction('love', true);
    } else {
      singleTapTimerRef.current = window.setTimeout(() => {
        togglePlayPause();
        singleTapTimerRef.current = null;
      }, 220);
    }
    lastTapRef.current = now;
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value);
    const v = videoRef.current;
    if (!v || !duration) return;
    const nextTime = (val / 100) * duration;
    v.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const switchQualitySource = (url: string, label: string) => {
    const v = videoRef.current;
    const resumeAt = v?.currentTime || 0;
    const wasPlaying = v ? !v.paused : true;
    setSelectedSrcUrl(url);
    setMenuOpen(false);
    toast.info(`Switched video source to ${label}`);
    window.setTimeout(() => {
      const nextEl = videoRef.current;
      if (!nextEl) return;
      nextEl.currentTime = resumeAt;
      if (wasPlaying) nextEl.play().catch(() => {});
    }, 120);
  };

  const toggleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const retryPlayback = () => {
    setVideoError(false);
    setSlowNetworkHint(false);
    setBuffering(true);
    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  };

  const progressPct = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;
  const availableVariants = reel.qualityVariants || [];

  return (
    <div
      ref={containerRef}
      data-reel-id={reel.id}
      className="relative h-[calc(100vh-4rem)] lg:h-[calc(100vh-2rem)] w-full max-w-[440px] mx-auto snap-start snap-always rounded-none sm:rounded-2xl overflow-hidden bg-black flex items-center justify-center shrink-0 select-none"
    >
      <video
        ref={videoRef}
        src={selectedSrcUrl}
        poster={reel.thumbnailUrl || undefined}
        loop
        muted={muted}
        playsInline
        preload={computedPreload}
        crossOrigin="anonymous"
        onClick={handleVideoTap}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuration(d);
        }}
        onWaiting={() => setBuffering(true)}
        onPlaying={() => {
          setBuffering(false);
          setSlowNetworkHint(false);
          setVideoError(false);
          setIsPaused(false);
        }}
        onCanPlay={() => setBuffering(false)}
        onError={() => {
          if (reel.backupVideoUrl && selectedSrcUrl !== reel.backupVideoUrl) {
            setSelectedSrcUrl(reel.backupVideoUrl);
            toast.info('Switched to verified Secondary Backup stream.');
            return;
          }
          setBuffering(false);
          setVideoError(true);
        }}
        onTimeUpdate={(e) => {
          const v = e.currentTarget;
          setCurrentTime(v.currentTime || 0);
          if (Number.isFinite(v.duration) && v.duration > 0) setDuration(v.duration);
        }}
        className={`w-full h-full cursor-pointer transition-all ${
          fitMode === 'contain' ? 'object-contain' : 'object-cover'
        }`}
      >
        {reel.captionsVttUrl && captionsEnabled && (
          <track kind="captions" src={reel.captionsVttUrl} srcLang="en" label="English" default />
        )}
      </video>

      {/* Buffering & Slow Network Indicator */}
      {buffering && !videoError && !isPaused && isActive && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <Loader2 className="w-9 h-9 text-white/85 animate-spin" />
          {slowNetworkHint && (
            <span className="px-3 py-1 rounded-full bg-black/65 text-[11px] text-white/90">
              Slow connection · Buffering video...
            </span>
          )}
        </div>
      )}

      {/* Tap Play/Pause Indicator */}
      {(tapFeedback || (isPaused && isActive && !videoError)) && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="h-14 w-14 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center">
            {tapFeedback === 'pause' || isPaused ? (
              <Play className="w-7 h-7 fill-current ml-0.5" />
            ) : (
              <Pause className="w-7 h-7 fill-current" />
            )}
          </div>
        </div>
      )}

      {/* Playback Error + Retry */}
      {videoError && (
        <div className="absolute inset-0 bg-black/85 flex flex-col items-center justify-center gap-3 text-white p-6 text-center z-20">
          <p className="text-sm font-medium">Video playback stalled or failed to load.</p>
          <p className="text-xs text-white/70">Check your connection and retry loading this stream.</p>
          <button
            type="button"
            onClick={retryPlayback}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-black text-xs font-semibold min-h-[44px]"
          >
            <RotateCcw className="w-3.5 h-3.5" /> Retry Playback
          </button>
        </div>
      )}

      {/* Double-tap heart burst */}
      {heartPop && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <Heart className="w-20 h-20 text-rose-500 fill-rose-500 animate-ping" />
        </div>
      )}

      {/* Top Slide Quick Controls (offset cleanly below page top bar) */}
      <div className="absolute top-16 right-3 z-20 flex items-center gap-2">
        {reel.captionsVttUrl && (
          <button
            type="button"
            onClick={() => setCaptionsEnabled((v) => !v)}
            aria-label={captionsEnabled ? 'Disable captions' : 'Enable captions'}
            title={captionsEnabled ? 'Captions On' : 'Captions Off'}
            className={`h-11 w-11 rounded-full backdrop-blur-sm flex items-center justify-center transition-colors ${
              captionsEnabled ? 'bg-[#1877F2] text-white' : 'bg-black/50 text-white'
            }`}
          >
            <Subtitles className="w-4 h-4" />
          </button>
        )}
        {reel.aspectRatio === '16:9' && (
          <button
            type="button"
            onClick={() => setFitMode((m) => (m === 'contain' ? 'cover' : 'contain'))}
            aria-label="Toggle video fit"
            title={fitMode === 'contain' ? 'Fill screen' : 'Fit video'}
            className="h-11 px-3 rounded-full bg-black/50 backdrop-blur-sm text-white text-[11px] font-semibold"
          >
            {fitMode === 'contain' ? 'Fill' : 'Fit'}
          </button>
        )}
        <button
          type="button"
          onClick={onToggleMute}
          aria-label={muted ? 'Unmute' : 'Mute'}
          className="h-11 w-11 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center"
        >
          {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={toggleFullscreen}
          aria-label="Toggle fullscreen"
          className="h-11 w-11 rounded-full bg-black/50 backdrop-blur-sm text-white flex items-center justify-center"
        >
          {document.fullscreenElement ? <Minimize2 className="w-4 h-4" /> : <Maximize2 className="w-4 h-4" />}
        </button>
      </div>

      {/* Right Interaction Column (>=44px touch targets) */}
      <div className="absolute right-2.5 bottom-24 z-20 flex flex-col items-center gap-3 text-white">
        {/* Creator Avatar + Quick Follow */}
        <div className="relative mb-1">
          <Link to={`/profile/${reel.authorUsername}`} className="block rounded-full ring-2 ring-white/80">
            <Avatar src={reel.authorAvatar} name={reel.authorName} size="md" />
          </Link>
          {firebaseUser?.uid !== reel.authorId && !isFollowingCreator && (
            <button
              type="button"
              onClick={() => onToggleFollow(reel.authorId, false)}
              aria-label={`Follow ${reel.authorUsername}`}
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 h-6 w-6 rounded-full bg-[#1877F2] text-white flex items-center justify-center shadow ring-2 ring-black"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        <ReactionPickerButton
          variant="overlay"
          currentReaction={userReaction}
          totalCount={likesCount}
          onSelect={(r) => handleReaction(r)}
        />

        <button
          type="button"
          onClick={() => onOpenComments(reel)}
          aria-label="Open comments"
          className="flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px]"
        >
          <span className="h-11 w-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center hover:bg-black/65 transition-colors">
            <MessageCircle className="w-5 h-5" />
          </span>
          <span className="text-[11px] font-mono tabular-nums font-semibold">
            {formatCompactNumber(reel.commentsCount)}
          </span>
        </button>

        <button
          type="button"
          onClick={async () => {
            if (!firebaseUser) return openAuthModal('Sign in to save Reels.');
            if (saveBusyRef.current) return;
            saveBusyRef.current = true;
            const prev = saved;
            const next = !prev;
            setSaved(next);
            const saveId = `${reel.id}_${firebaseUser.uid}`;
            const postSaveRef = doc(db, 'savedPosts', saveId);
            const vidSaveRef = doc(db, 'savedVideos', saveId);
            try {
              if (next) {
                const payload = {
                  userId: firebaseUser.uid,
                  postId: reel.id,
                  targetType: 'reel',
                  createdAt: serverTimestamp(),
                };
                await Promise.all([setDoc(postSaveRef, payload), setDoc(vidSaveRef, payload)]);
                onBoostCategory(reel.category, 2);
                toast.success('Reel saved to your library.');
              } else {
                await Promise.all([deleteDoc(postSaveRef), deleteDoc(vidSaveRef)]);
                toast.info('Removed Reel from Saved.');
              }
            } catch {
              setSaved(prev);
              toast.error('Could not update Saved. Please try again.');
            } finally {
              saveBusyRef.current = false;
            }
          }}
          aria-label={saved ? 'Remove from saved' : 'Save reel'}
          className="flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px]"
        >
          <span
            className={`h-11 w-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center hover:bg-black/65 transition-colors ${
              saved ? 'text-[#1877F2]' : 'text-white'
            }`}
          >
            <Bookmark className={`w-5 h-5 ${saved ? 'fill-current' : ''}`} />
          </span>
          <span className="text-[11px] font-medium">{saved ? 'Saved' : 'Save'}</span>
        </button>

        <button
          type="button"
          onClick={() => onOpenShare(reel)}
          aria-label="Share reel"
          className="flex flex-col items-center gap-0.5 min-w-[44px] min-h-[44px]"
        >
          <span className="h-11 w-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center hover:bg-black/65 transition-colors">
            <Share2 className="w-5 h-5" />
          </span>
          <span className="text-[11px] font-medium">Share</span>
        </button>

        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="More options"
            className="h-11 w-11 rounded-full bg-black/45 backdrop-blur-sm flex items-center justify-center hover:bg-black/65 transition-colors"
          >
            <MoreHorizontal className="w-5 h-5" />
          </button>

          {menuOpen && (
            <div className="absolute right-12 bottom-0 w-64 rounded-2xl border border-neutral-800 bg-neutral-950/95 backdrop-blur-md text-white shadow-2xl p-2 space-y-1 text-xs z-30">
              {/* Quality / Source Selector */}
              <div className="px-2.5 py-1.5 border-b border-white/10 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] text-white/60">
                  <span className="inline-flex items-center gap-1 font-semibold">
                    <SlidersHorizontal className="w-3 h-3" /> Video Source
                  </span>
                  <button
                    type="button"
                    onClick={() => onModeChange(preloadMode === 'auto' ? 'saver' : 'auto')}
                    className="text-[10px] text-[#1877F2] font-semibold hover:underline"
                  >
                    Preload: {preloadMode === 'saver' ? 'Data Saver' : 'Auto'}
                  </button>
                </div>

                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => switchQualitySource(reel.videoUrl, 'Primary')}
                    className={`px-2 py-1 rounded-lg text-[11px] font-medium ${
                      selectedSrcUrl === reel.videoUrl
                        ? 'bg-[#1877F2] text-white'
                        : 'bg-white/10 text-white/80 hover:bg-white/15'
                    }`}
                  >
                    Primary ({reel.storageProvider || 'R2'})
                  </button>
                  {reel.backupVideoUrl && (
                    <button
                      type="button"
                      onClick={() => switchQualitySource(reel.backupVideoUrl!, 'Backup Mirror')}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium ${
                        selectedSrcUrl === reel.backupVideoUrl
                          ? 'bg-[#1877F2] text-white'
                          : 'bg-white/10 text-white/80 hover:bg-white/15'
                      }`}
                    >
                      Backup ({reel.backupProvider || 'B2'})
                    </button>
                  )}
                  {availableVariants.map((v) => (
                    <button
                      key={v.label}
                      type="button"
                      onClick={() => switchQualitySource(v.url, v.label)}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium ${
                        selectedSrcUrl === v.url
                          ? 'bg-[#1877F2] text-white'
                          : 'bg-white/10 text-white/80 hover:bg-white/15'
                      }`}
                    >
                      {v.label}
                    </button>
                  ))}
                </div>
                {availableVariants.length === 0 && !reel.hlsManifestUrl && (
                  <p className="text-[10px] text-white/45 leading-snug">
                    Progressive MP4/WebM streaming with HTTP Range support. Multi-bitrate HLS presets appear only when optional external transcoding is enabled.
                  </p>
                )}
              </div>

              <div className="px-2.5 py-1.5 border-b border-white/10 space-y-1.5">
                <span className="text-[11px] font-semibold text-white/60">Playback speed</span>
                <div className="flex flex-wrap gap-1">
                  {[0.5, 1, 1.25, 1.5, 2].map((r) => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setPlaybackRate(r)}
                      aria-pressed={playbackRate === r}
                      className={`px-2 py-1 rounded-lg text-[11px] font-medium ${
                        playbackRate === r ? 'bg-[#1877F2] text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'
                      }`}
                    >
                      {r === 1 ? 'Normal' : `${r}x`}
                    </button>
                  ))}
                </div>
              </div>

              <button
                type="button"
                onClick={() => {
                  const link = `${window.location.origin}/reels?reel=${reel.id}`;
                  if (navigator.clipboard?.writeText) {
                    navigator.clipboard
                      .writeText(link)
                      .then(() => toast.success('Reel link copied.'))
                      .catch(() => toast.error('Could not copy the link. Copy it from the address bar.'));
                  } else {
                    toast.error('Copying is not supported in this browser.');
                  }
                  setMenuOpen(false);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/10 text-left"
              >
                <Link2 className="w-3.5 h-3.5 text-white/70" /> Copy Reel Link
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onNotInterested(reel);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/10 text-left"
              >
                <EyeOff className="w-3.5 h-3.5 text-white/70" /> Not interested in this video
              </button>

              {firebaseUser?.uid !== reel.authorId && (
                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    onHideCreator(reel.authorId, reel.authorUsername);
                  }}
                  className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/10 text-left"
                >
                  <UserX className="w-3.5 h-3.5 text-white/70" /> Hide @{reel.authorUsername}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  if (!firebaseUser) return openAuthModal('Sign in to report this Reel.');
                  setReportOpen(true);
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/10 text-left text-amber-300"
              >
                <Flag className="w-3.5 h-3.5" /> Report video
              </button>

              <button
                type="button"
                onClick={() => {
                  setMenuOpen(false);
                  onResetRecommendations();
                }}
                className="w-full flex items-center gap-2.5 px-2.5 py-2 rounded-xl hover:bg-white/10 text-left text-white/70 border-t border-white/10 mt-1 pt-2"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reset Reel preferences
              </button>
            </div>
          )}
        </div>
      </div>

      <ReportDialog
        open={reportOpen}
        targetType="reel"
        targetId={reel.id}
        title="Report Reel"
        context={{ reelAuthorId: reel.authorId }}
        onClose={() => setReportOpen(false)}
      />

      {/* Bottom Metadata Scrim & Scrubbable Progress */}
      <div className="absolute inset-x-0 bottom-0 z-10 p-4 pr-16 bg-gradient-to-t from-black/90 via-black/50 to-transparent text-white space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <Link to={`/profile/${reel.authorUsername}`} className="flex items-center gap-1.5 font-semibold text-sm">
            <span>{reel.authorName}</span>
            <span className="text-xs text-white/75 font-normal">@{reel.authorUsername}</span>
            {reel.authorVerified && <VerifiedBadge size={14} />}
          </Link>
          {firebaseUser?.uid !== reel.authorId && (
            <button
              type="button"
              onClick={() => onToggleFollow(reel.authorId, isFollowingCreator)}
              className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                isFollowingCreator
                  ? 'border border-white/40 bg-white/10 text-white'
                  : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
              }`}
            >
              {isFollowingCreator ? 'Following' : 'Follow'}
            </button>
          )}
          {reel.category && (
            <span className="text-[11px] font-medium text-blue-300">· {reel.category}</span>
          )}
        </div>

        {reel.title && <h3 className="text-sm font-bold leading-snug">{reel.title}</h3>}

        {(reel.caption || reel.description) && (
          <div className="text-xs leading-relaxed text-white/90">
            <p className={captionExpanded ? '' : 'line-clamp-2'}>
              {reel.caption}
              {reel.description ? (reel.caption ? ` — ${reel.description}` : reel.description) : ''}
            </p>
            {(reel.caption?.length || 0) + (reel.description?.length || 0) > 85 && (
              <button
                type="button"
                onClick={() => setCaptionExpanded((v) => !v)}
                className="text-[11px] font-semibold text-white/75 hover:text-white mt-0.5"
              >
                {captionExpanded ? 'Show less' : 'More'}
              </button>
            )}
          </div>
        )}

        {reel.hashtags && reel.hashtags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {reel.hashtags.map((h) => (
              <button
                key={h}
                type="button"
                onClick={() => onTagClick(h)}
                className="text-xs text-blue-300 hover:underline font-medium"
              >
                #{h}
              </button>
            ))}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 text-[11px] text-white/80">
          <div className="flex items-center gap-1.5 min-w-0">
            <Music2 className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate">{reel.soundName || 'Original Audio'}</span>
            <span>·</span>
            <span className="font-mono tabular-nums shrink-0">{formatCompactNumber(reel.viewsCount)} views</span>
          </div>
          <span className="font-mono tabular-nums shrink-0 text-[10px] text-white/75">
            {formatDurationClock(currentTime)} / {formatDurationClock(duration)}
          </span>
        </div>

        {/* Scrubbable Progress Bar */}
        <div className="relative flex items-center pt-0.5">
          <input
            type="range"
            min={0}
            max={100}
            step={0.5}
            value={progressPct}
            onChange={handleSeek}
            aria-label="Seek video progress"
            className="w-full h-1 accent-[#1877F2] cursor-pointer bg-white/25 rounded-full"
          />
        </div>
      </div>
    </div>
  );
}

export function ReelsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedReelId = searchParams.get('reel');

  const { firebaseUser, profile, adminRole, settings, platformSettings, blockedUids, updateLocalSettings, openAuthModal } = useAuth();
  const toast = useToast();

  const [rawReels, setRawReels] = useState<BanaReel[]>([]);
  const [reelLimit, setReelLimit] = useState(15);
  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [muted, setMuted] = useState(true);
  const [preloadMode, setPreloadMode] = useState<'auto' | 'saver'>(() =>
    detectNetworkSavingMode() ? 'saver' : 'auto'
  );

  const [feedTab, setFeedTab] = useState<ReelFeedTab>('recommended');
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Guest / local fallback discovery signals
  const [guestHiddenCreators, setGuestHiddenCreators] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('bana_hidden_creators') || '[]');
    } catch {
      return [];
    }
  });
  const [guestDismissed, setGuestDismissed] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('bana_dismissed_reels') || '[]');
    } catch {
      return [];
    }
  });
  const [guestWeights, setGuestWeights] = useState<Record<string, number>>({});

  const [uploadOpen, setUploadOpen] = useState(false);
  const [commentReel, setCommentReel] = useState<BanaReel | null>(null);
  const [shareReel, setShareReel] = useState<BanaReel | null>(null);

  const feedRef = useRef<HTMLDivElement | null>(null);

  const hiddenCreatorIds = settings?.hiddenCreatorIds ?? guestHiddenCreators;
  const dismissedReelIds = settings?.dismissedPostIds ?? guestDismissed;
  const interestWeights = settings?.interestWeights ?? guestWeights;
  const userInterests = settings?.interests ?? [];

  const fetchReels = useCallback(async () => {
    setLoading(true);
    try {
      const primaryQ = query(
        collection(db, 'reels'),
        where('status', '==', 'active'),
        where('visibility', '==', 'public'),
        orderBy('createdAt', 'desc'),
        limit(reelLimit)
      );
      const fallbackQ = query(
        collection(db, 'reels'),
        where('status', '==', 'active'),
        where('visibility', '==', 'public'),
        limit(reelLimit + 10)
      );
      let { items: loaded } = await getDocsWithIndexFallback<BanaReel>(
        primaryQ,
        fallbackQ,
        sortByCreatedAtDesc
      );
      loaded = loaded.slice(0, reelLimit);

      // If user opened a deep-linked ?reel=<id> not in the current window, fetch it directly
      if (requestedReelId && !loaded.some((r) => r.id === requestedReelId)) {
        const directSnap = await getDoc(doc(db, 'reels', requestedReelId)).catch(() => null);
        if (directSnap?.exists()) {
          loaded = [{ id: directSnap.id, ...(directSnap.data() as Omit<BanaReel, 'id'>) }, ...loaded];
        }
      }
      setRawReels(loaded);
    } catch (err) {
      logFirestoreError(err, OperationType.LIST, 'reels');
    } finally {
      setLoading(false);
    }
  }, [requestedReelId, reelLimit]);

  useEffect(() => {
    fetchReels();
  }, [fetchReels]);

  useEffect(() => {
    if (!firebaseUser) {
      setFollowingIds([]);
      return;
    }
    getDocs(query(collection(db, 'userFollows'), where('followerId', '==', firebaseUser.uid), limit(100)))
      .then((snap) => setFollowingIds(snap.docs.map((d) => String(d.data().followingId || ''))))
      .catch(() => {});
  }, [firebaseUser]);

  const rankedReels = useMemo(() => {
    const filteredForBlocks = rawReels.filter((r) => !blockedUids.includes(r.authorId));
    const ordered = rankReelsForDiscovery(filteredForBlocks, {
      tab: feedTab,
      searchQuery,
      followingIds,
      hiddenCreatorIds,
      dismissedReelIds,
      interests: userInterests,
      interestWeights,
    });

    if (requestedReelId) {
      const idx = ordered.findIndex((r) => r.id === requestedReelId);
      if (idx > 0) {
        const copy = [...ordered];
        const [picked] = copy.splice(idx, 1);
        return [picked, ...copy];
      }
    }
    return ordered;
  }, [rawReels, blockedUids, feedTab, searchQuery, followingIds, hiddenCreatorIds, dismissedReelIds, userInterests, interestWeights, requestedReelId]);

  // Restore last active slide or jump to top when tab/search changes
  useEffect(() => {
    const container = feedRef.current;
    if (!container || rankedReels.length === 0) return;

    if (!requestedReelId && feedTab === 'recommended' && !searchQuery) {
      const savedId = localStorage.getItem('bana_last_reel_id');
      const foundIdx = savedId ? rankedReels.findIndex((r) => r.id === savedId) : 0;
      if (foundIdx > 0) {
        const el = container.querySelector(`[data-reel-id="${savedId}"]`);
        el?.scrollIntoView({ behavior: 'instant' as ScrollBehavior });
        setActiveIndex(foundIdx);
        return;
      }
    }
    setActiveIndex(0);
    container.scrollTo({ top: 0 });
  }, [feedTab, searchQuery, requestedReelId, rankedReels.length]);

  // Track active slide via IntersectionObserver
  useEffect(() => {
    const container = feedRef.current;
    if (!container || rankedReels.length === 0) return;

    const slides = container.querySelectorAll('[data-reel-id]');
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.65) {
            const id = entry.target.getAttribute('data-reel-id');
            const idx = rankedReels.findIndex((r) => r.id === id);
            if (idx >= 0) {
              setActiveIndex(idx);
              if (id) localStorage.setItem('bana_last_reel_id', id);
            }
          }
        });
      },
      { root: container, threshold: 0.65 }
    );

    slides.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [rankedReels]);

  // Keyboard navigation on desktop (ArrowDown / ArrowUp / M)
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (uploadOpen) return;

      if (e.key === 'ArrowDown' || e.key === 'j') {
        e.preventDefault();
        const nextIdx = Math.min(rankedReels.length - 1, activeIndex + 1);
        const nextId = rankedReels[nextIdx]?.id;
        if (nextId) {
          feedRef.current?.querySelector(`[data-reel-id="${nextId}"]`)?.scrollIntoView({ behavior: 'smooth' });
        }
      } else if (e.key === 'ArrowUp' || e.key === 'k') {
        e.preventDefault();
        const prevIdx = Math.max(0, activeIndex - 1);
        const prevId = rankedReels[prevIdx]?.id;
        if (prevId) {
          feedRef.current?.querySelector(`[data-reel-id="${prevId}"]`)?.scrollIntoView({ behavior: 'smooth' });
        }
      } else if (e.key.toLowerCase() === 'm') {
        setMuted((m) => !m);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [activeIndex, rankedReels, uploadOpen]);

  const followBusyRef = useRef<Set<string>>(new Set());
  const handleToggleFollow = async (authorId: string, currentlyFollowing: boolean) => {
    if (!firebaseUser) return openAuthModal('Sign in to follow creators on BANA.');
    if (authorId === firebaseUser.uid) return;
    if (followBusyRef.current.has(authorId)) return;
    followBusyRef.current.add(authorId);
    const nextFollowing = !currentlyFollowing;
    setFollowingIds((prev) => (nextFollowing ? Array.from(new Set([...prev, authorId])) : prev.filter((id) => id !== authorId)));
    // Deterministic id => a user can never follow the same creator twice.
    const followRef = doc(db, 'userFollows', `${firebaseUser.uid}_${authorId}`);
    try {
      if (nextFollowing) {
        await setDoc(followRef, {
          followerId: firebaseUser.uid,
          followingId: authorId,
          createdAt: serverTimestamp(),
        });
        toast.success('Following creator.');
      } else {
        await deleteDoc(followRef);
        toast.info('Unfollowed creator.');
      }
    } catch {
      setFollowingIds((prev) => (currentlyFollowing ? Array.from(new Set([...prev, authorId])) : prev.filter((id) => id !== authorId)));
      toast.error('Could not update follow status. Please try again.');
    } finally {
      followBusyRef.current.delete(authorId);
    }
  };

  const handleBoostCategory = useCallback(
    (cat?: DiscoveryCategory, delta = 1) => {
      if (!cat) return;
      const next = {
        ...interestWeights,
        [cat]: Math.max(-10, Math.min(20, (interestWeights[cat] || 0) + delta)),
      };
      if (firebaseUser) {
        updateLocalSettings({ interestWeights: next }).catch(() => {});
      } else {
        setGuestWeights(next);
      }
    },
    [interestWeights, firebaseUser, updateLocalSettings]
  );

  const handleNotInterested = (reel: BanaReel) => {
    const next = Array.from(new Set([...dismissedReelIds, reel.id]));
    if (firebaseUser) {
      updateLocalSettings({ dismissedPostIds: next }).catch(() => {});
    } else {
      setGuestDismissed(next);
      localStorage.setItem('bana_dismissed_reels', JSON.stringify(next));
    }
    if (reel.category) handleBoostCategory(reel.category, -2);
    toast.info('We will show fewer Reels like this.');
  };

  const handleHideCreator = (authorId: string, authorUsername: string) => {
    const next = Array.from(new Set([...hiddenCreatorIds, authorId]));
    if (firebaseUser) {
      updateLocalSettings({ hiddenCreatorIds: next }).catch(() => {});
    } else {
      setGuestHiddenCreators(next);
      localStorage.setItem('bana_hidden_creators', JSON.stringify(next));
    }
    toast.info(`Hid Reels from @${authorUsername}.`);
  };

  const handleResetRecommendations = () => {
    if (firebaseUser) {
      updateLocalSettings({
        dismissedPostIds: [],
        hiddenCreatorIds: [],
        interestWeights: {},
      }).catch(() => {});
    } else {
      setGuestDismissed([]);
      setGuestHiddenCreators([]);
      setGuestWeights({});
      localStorage.removeItem('bana_dismissed_reels');
      localStorage.removeItem('bana_hidden_creators');
    }
    toast.success('Reels recommendations reset.');
  };

  const [reelsAd, setReelsAd] = useState<AdCampaign | null>(null);

  useEffect(() => {
    const isAdult = !profile?.isMinor && (!settings?.birthYear || new Date().getFullYear() - settings.birthYear >= 18);
    fetchEligibleAdsForPlacement('reels_feed', {
      isAdult,
      interests: userInterests,
      viewerUid: firebaseUser?.uid,
    })
      .then((ads) => setReelsAd(ads[0] || null))
      .catch(() => {});
  }, [firebaseUser?.uid, profile?.isMinor, settings?.birthYear, userInterests]);

  return (
    <AppShell fullBleed>
      <div className="relative h-[calc(100vh-4rem)] lg:h-screen bg-neutral-950 flex overflow-hidden">
        {/* Main Video Stage */}
        <div className="relative flex-1 h-full flex flex-col items-center justify-center sm:py-4">
          {reelsAd && activeIndex > 0 && activeIndex % 4 === 3 && (
            <div className="absolute bottom-24 left-4 z-30 pointer-events-auto">
              <SponsoredAdCard
                campaign={reelsAd}
                placement="reels_feed"
                variant="reels"
                onDismiss={() => setReelsAd(null)}
              />
            </div>
          )}
          {/* Compact Top Discovery Header */}
          <div className="absolute top-3 inset-x-3 z-20 max-w-[440px] mx-auto space-y-2 pointer-events-none">
            <div className="flex items-center justify-between gap-2 pointer-events-auto">
              <span className="font-display font-bold text-base text-white drop-shadow">
                BANA Reels
              </span>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setSearchOpen((s) => !s)}
                  aria-label="Search reels"
                  className="h-9 w-9 rounded-full bg-black/55 backdrop-blur-sm text-white flex items-center justify-center border border-white/15"
                >
                  {searchOpen ? <X className="w-4 h-4" /> : <Search className="w-4 h-4" />}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!firebaseUser) return openAuthModal('Sign in to upload a Reel to BANA.');
                    if (profile && profile.accountStatus !== 'active') {
                      toast.error(
                        profile.accountRestrictionNote ||
                          `Your account is currently ${profile.accountStatus}. Uploading Reels is disabled.`
                      );
                      return;
                    }
                    if (platformSettings.maintenanceMode && !adminRole) {
                      toast.error(platformSettings.maintenanceMessage || 'BANA is currently in maintenance mode.');
                      return;
                    }
                    setUploadOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 h-9 px-3.5 rounded-full bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold shadow transition-colors"
                >
                  <Plus className="w-3.5 h-3.5" /> Upload
                </button>
              </div>
            </div>

            {searchOpen && (
              <div className="pointer-events-auto flex items-center gap-2 rounded-xl bg-black/75 backdrop-blur-md border border-white/20 px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-white/60 shrink-0" />
                <input
                  type="search"
                  autoFocus
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search videos, #hashtags, sounds, creators..."
                  className="flex-1 bg-transparent text-xs text-white placeholder:text-white/55 focus:outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      if (requestedReelId) setSearchParams({});
                    }}
                    className="text-[11px] text-white/70 hover:text-white"
                  >
                    Clear
                  </button>
                )}
              </div>
            )}

            {/* Category / Feed Tabs */}
            <div className="pointer-events-auto flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
              {FEED_TABS.map((t) => {
                const active = feedTab === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setFeedTab(t.id);
                      if (requestedReelId) setSearchParams({});
                    }}
                    className={`px-3 py-1 rounded-full text-[11px] font-semibold whitespace-nowrap shrink-0 backdrop-blur-sm transition-colors ${
                      active
                        ? 'bg-white text-neutral-950 shadow-sm'
                        : 'bg-black/45 text-white/85 hover:bg-black/65 border border-white/10'
                    }`}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          {loading ? (
            <Loader2 className="w-8 h-8 text-white animate-spin" />
          ) : rankedReels.length === 0 ? (
            <div className="max-w-sm text-center text-white space-y-3 p-6">
              <div className="mx-auto h-14 w-14 rounded-2xl bg-white/10 flex items-center justify-center">
                <Film className="w-7 h-7" />
              </div>
              <h2 className="font-display font-bold text-lg">
                {searchQuery || feedTab !== 'recommended'
                  ? 'No matching Reels found'
                  : 'No Reels published yet'}
              </h2>
              <p className="text-xs text-white/70">
                {feedTab === 'following'
                  ? 'Follow creators to populate your Following Reels feed, or switch back to For You.'
                  : searchQuery
                  ? `No active Reels matched "${searchQuery}".`
                  : 'Upload a vertical video (MP4/WebM) to Firebase Storage to start the BANA Reels stream.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {(searchQuery || feedTab !== 'recommended') && (
                  <button
                    type="button"
                    onClick={() => {
                      setFeedTab('recommended');
                      setSearchQuery('');
                    }}
                    className="px-4 py-2 rounded-xl border border-white/25 text-white text-xs font-semibold hover:bg-white/10"
                  >
                    View For You
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => (firebaseUser ? setUploadOpen(true) : openAuthModal('Sign in to upload a Reel.'))}
                  className="px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors"
                >
                  Upload Reel
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={feedRef}
              className="w-full h-full overflow-y-scroll snap-y snap-mandatory no-scrollbar space-y-4"
            >
              {rankedReels.map((reel, idx) => (
                <ReelSlide
                  key={reel.id}
                  reel={reel}
                  index={idx}
                  activeIndex={activeIndex}
                  isActive={idx === activeIndex}
                  muted={muted}
                  preloadMode={preloadMode}
                  isFollowingCreator={followingIds.includes(reel.authorId)}
                  onToggleMute={() => setMuted((m) => !m)}
                  onToggleFollow={handleToggleFollow}
                  onOpenComments={(r) => setCommentReel(r)}
                  onOpenShare={(r) => setShareReel(r)}
                  onNotInterested={handleNotInterested}
                  onHideCreator={handleHideCreator}
                  onResetRecommendations={handleResetRecommendations}
                  onTagClick={(tag) => {
                    setSearchOpen(true);
                    setSearchQuery(tag);
                  }}
                  onBoostCategory={handleBoostCategory}
                  onModeChange={(m) => {
                    setPreloadMode(m);
                    toast.info(m === 'saver' ? 'Data Saver preloading enabled.' : 'Auto preloading enabled.');
                  }}
                />
              ))}
              {rawReels.length >= reelLimit && (
                <div className="snap-center py-8 flex flex-col items-center justify-center gap-2 text-white">
                  <p className="text-xs text-white/70">Loaded {rawReels.length} Reels</p>
                  <button
                    type="button"
                    onClick={() => setReelLimit((prev) => prev + 15)}
                    className="px-4 py-2 rounded-xl bg-white/15 hover:bg-white/25 text-xs font-semibold transition-colors"
                  >
                    Load More Reels
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Desktop Side Panel / Mobile Bottom Sheet Comments */}
        <ReelCommentsPanel reel={commentReel} onClose={() => setCommentReel(null)} />
      </div>

      <ReelUploadModal
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onUploaded={fetchReels}
      />

      <ShareToMessengerModal
        isOpen={Boolean(shareReel)}
        payload={
          shareReel
            ? {
                targetType: 'reel',
                targetId: shareReel.id,
                authorId: shareReel.authorId,
                authorName: shareReel.authorName,
                authorUsername: shareReel.authorUsername,
                content: shareReel.title || shareReel.caption || 'Watch this Reel on BANA',
                mediaUrl: shareReel.thumbnailUrl || shareReel.videoUrl,
              }
            : null
        }
        onClose={() => setShareReel(null)}
      />
    </AppShell>
  );
}
