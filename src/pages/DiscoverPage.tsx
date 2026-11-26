import React, { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useFeedHides } from '@/src/lib/feedHides';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Image as ImageIcon,
  Video,
  Mic,
  BarChart2,
  Loader2,
  ExternalLink,
  RefreshCw,
  UserPlus,
  Compass,
  SlidersHorizontal,
  RotateCcw,
  Film,
  MapPin,
  ShoppingBag,
  Calendar,
  Check,
  X,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  startAfter,
  getDocs,
  doc,
  setDoc,
  addDoc,
  serverTimestamp,
  QueryDocumentSnapshot,
  DocumentData,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  DISCOVERY_CATEGORIES,
  BANGLADESH_DISTRICTS,
  type DiscoveryCategory,
  type BanaPost,
  type BanaUser,
  type BanaCommunity,
  type BanaReel,
  type BanaMarketListing,
  type BanaEvent,
  type AdCampaign,
} from '@/src/types/bana';
import { AppShell } from '@/src/components/layout/AppShell';
import { StoryCarousel } from '@/src/components/feed/StoryCarousel';
import { PostCard } from '@/src/components/feed/PostCard';
import { CreateModal, CreateMode } from '@/src/components/create/CreateModal';
import { Avatar, ResilientImage } from '@/src/components/common/Avatar';
import { VerifiedBadge } from '@/src/components/common/BanaLogo';
import { formatCompactNumber } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { getDocsWithIndexFallback, sortByCreatedAtDesc, toMillis } from '@/src/lib/firestoreQuery';
import { PeopleYouMayKnow } from '@/src/components/social/PeopleYouMayKnow';
import { FeedFriendSuggestions } from '@/src/components/social/FeedFriendSuggestions';
import { useFriendSuggestions } from '@/src/lib/useFriendSuggestions';
import { pickFeedSlots } from '@/src/lib/friendSuggestionsCore';
import { getSeenKeys, hiddenVideoPostIds } from '@/src/lib/videoDistribution';
import { SponsoredAdCard } from '@/src/components/ads/SponsoredAdCard';
import { fetchEligibleAdsForPlacement } from '@/src/lib/ads';

type SortTab = 'recommended' | 'following' | 'latest' | 'popular';

export function DiscoverPage() {
  const { firebaseUser, profile, adminRole, settings, platformSettings, blockedUids, updateLocalSettings, openAuthModal } = useAuth();
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const searchQuery = (searchParams.get('q') || '').trim().toLowerCase();

  const [sortTab, setSortTab] = useState<SortTab>('recommended');
  const [activeCategory, setActiveCategory] = useState<'All' | DiscoveryCategory>('All');
  const [localDistrict, setLocalDistrict] = useState('All Districts');
  const [interestsEditorOpen, setInterestsEditorOpen] = useState(false);

  const [posts, setPosts] = useState<BanaPost[]>([]);
  const [lastDoc, setLastDoc] = useState<QueryDocumentSnapshot<DocumentData> | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [recBanner, setRecBanner] = useState<string | null>(null);

  const [followingIds, setFollowingIds] = useState<string[]>([]);
  const [blockedIds, setBlockedIds] = useState<string[]>([]);
  const [topCommunities, setTopCommunities] = useState<BanaCommunity[]>([]);
  const [trendingReels, setTrendingReels] = useState<BanaReel[]>([]);
  const [businessHighlights, setBusinessHighlights] = useState<BanaMarketListing[]>([]);
  const [upcomingEvents, setUpcomingEvents] = useState<BanaEvent[]>([]);
  const [activeAd, setActiveAd] = useState<AdCampaign | null>(null);

  // Local fallback states for signed-out guests
  const [guestInterests, setGuestInterests] = useState<DiscoveryCategory[]>(['Technology', 'Education', 'Business']);
  const [guestWeights, setGuestWeights] = useState<Record<string, number>>({});
  const [guestHiddenCreators, setGuestHiddenCreators] = useState<string[]>([]);
  const [guestDismissedPosts, setGuestDismissedPosts] = useState<string[]>([]);

  const [composerOpen, setComposerOpen] = useState(false);
  const [composerMode, setComposerMode] = useState<CreateMode>('text');

  const userInterests = settings?.interests ?? guestInterests;
  const interestWeights = settings?.interestWeights ?? guestWeights;
  const feedHides = useFeedHides();
  const hiddenCreatorIds = firebaseUser ? feedHides.hiddenCreatorIds : guestHiddenCreators;
  const dismissedPostIds = firebaseUser ? feedHides.dismissedPostIds : guestDismissedPosts;

  useEffect(() => {
    setBlockedIds(blockedUids);
  }, [blockedUids]);

  // Load user's following + blocked lists
  useEffect(() => {
    if (!firebaseUser) {
      setFollowingIds([]);
      setBlockedIds([]);
      return;
    }
    getDocs(query(collection(db, 'userFollows'), where('followerId', '==', firebaseUser.uid), limit(100)))
      .then((snap) => setFollowingIds(snap.docs.map((d) => String(d.data().followingId))))
      .catch(() => {});
  }, [firebaseUser]);

  // Load Smart Discovery widgets (Communities, Reels, Market Business Highlights, Local Events, Approved Ads)
  useEffect(() => {

    getDocsWithIndexFallback<BanaCommunity>(
      query(collection(db, 'communities'), where('status', '==', 'active'), orderBy('membersCount', 'desc'), limit(4)),
      query(collection(db, 'communities'), where('status', '==', 'active'), limit(16)),
      (a, b) => Number(b.membersCount || 0) - Number(a.membersCount || 0)
    )
      .then(({ items }) => {
        setTopCommunities(items.slice(0, 4));
      })
      .catch(() => {});

    getDocsWithIndexFallback<BanaReel>(
      query(
        collection(db, 'reels'),
        where('status', '==', 'active'),
        where('visibility', '==', 'public'),
        orderBy('createdAt', 'desc'),
        limit(4)
      ),
      query(
        collection(db, 'reels'),
        where('status', '==', 'active'),
        where('visibility', '==', 'public'),
        limit(16)
      ),
      sortByCreatedAtDesc
    )
      .then(({ items }) => {
        setTrendingReels(items.slice(0, 4));
      })
      .catch(() => {});

    getDocs(query(collection(db, 'marketplaceListings'), where('status', '==', 'active'), limit(4)))
      .then((snap) => {
        setBusinessHighlights(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BanaMarketListing, 'id'>) })));
      })
      .catch(() => {});

    getDocsWithIndexFallback<BanaEvent>(
      query(collection(db, 'events'), where('status', '==', 'upcoming'), orderBy('eventDate', 'asc'), limit(4)),
      query(collection(db, 'events'), where('status', '==', 'upcoming'), limit(16)),
      (a, b) => toMillis(a.eventDate) - toMillis(b.eventDate)
    )
      .then(({ items }) => {
        setUpcomingEvents(items.slice(0, 4));
      })
      .catch(() => {});

    // Minor safeguard: never serve behavioral ads to minor accounts
    const isAdult = !profile?.isMinor && (!settings?.birthYear || new Date().getFullYear() - settings.birthYear >= 18);
    fetchEligibleAdsForPlacement('home_feed', {
      isAdult,
      district: localDistrict,
      interests: settings?.interests ?? guestInterests,
      viewerUid: firebaseUser?.uid,
    })
      .then((ads) => setActiveAd(ads[0] || null))
      .catch(() => {});
  }, [firebaseUser, profile?.isMinor, settings?.birthYear, localDistrict, settings?.interests, guestInterests]);

  const loadFeed = useCallback(
    async (reset = true) => {
      if (reset) {
        setLoading(true);
        setFeedError(null);
      } else {
        setLoadingMore(true);
      }

      try {
        const pageSize = 12;
        const orderField = sortTab === 'popular' ? 'likesCount' : 'createdAt';
        const constraints: any[] = [
          where('status', '==', 'published'),
          where('visibility', '==', 'public'),
          orderBy(orderField, 'desc'),
          limit(pageSize),
        ];

        if (!reset && lastDoc) {
          constraints.push(startAfter(lastDoc));
        }

        const primaryQuery = query(collection(db, 'posts'), ...constraints);
        const fallbackQuery = query(
          collection(db, 'posts'),
          where('status', '==', 'published'),
          where('visibility', '==', 'public'),
          limit(60)
        );
        const comparator =
          sortTab === 'popular'
            ? (a: BanaPost, b: BanaPost) =>
                Number(b.likesCount || 0) - Number(a.likesCount || 0) || sortByCreatedAtDesc(a, b)
            : sortByCreatedAtDesc;

        const { items: batch, usedFallback, snap } = await getDocsWithIndexFallback<BanaPost>(
          primaryQuery,
          fallbackQuery,
          comparator
        );

        if (usedFallback) {
          setLastDoc(null);
          setHasMore(false);
          setPosts(batch);
        } else {
          setLastDoc(snap.docs[snap.docs.length - 1] || null);
          setHasMore(snap.docs.length === pageSize);
          setPosts((prev) => (reset ? batch : [...prev, ...batch]));
        }
      } catch (err: any) {
        logFirestoreError(err, OperationType.LIST, 'posts');
        setFeedError(formatFirebaseErrorMessage(err));
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [sortTab, lastDoc]
  );

  useEffect(() => {
    setLastDoc(null);
    loadFeed(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sortTab]);

  const toggleInterest = async (cat: DiscoveryCategory) => {
    const next = userInterests.includes(cat)
      ? userInterests.filter((c) => c !== cat)
      : [...userInterests, cat];
    if (firebaseUser) {
      await updateLocalSettings({ interests: next }).catch(() => {});
    } else {
      setGuestInterests(next);
    }
  };

  const handleAdjustInterest = async (category: DiscoveryCategory, delta: number) => {
    const nextWeights = {
      ...interestWeights,
      [category]: Math.max(-10, Math.min(20, (interestWeights[category] || 0) + delta)),
    };
    if (firebaseUser) {
      await updateLocalSettings({ interestWeights: nextWeights }).catch(() => {});
    } else {
      setGuestWeights(nextWeights);
    }
  };

  const handleHideCreator = async (uid: string) => {
    const next = Array.from(new Set([...hiddenCreatorIds, uid]));
    if (firebaseUser) {
      await feedHides.hideCreator(uid);
    } else {
      setGuestHiddenCreators(next);
    }
    setRecBanner('Creator hidden from your Smart Discovery feed.');
    toast.info('Creator hidden from your feed.');
  };

  const handleNotInterested = async (postId: string) => {
    const next = Array.from(new Set([...dismissedPostIds, postId]));
    if (firebaseUser) {
      await feedHides.dismissPost(postId);
    } else {
      setGuestDismissedPosts(next);
    }
    setRecBanner('Post removed from recommendations.');
    toast.info('Post removed from recommendations.');
  };

  const handleResetRecommendations = async () => {
    if (firebaseUser) {
      await updateLocalSettings({ interestWeights: {} }).catch(() => {});
      await feedHides.resetHides();
    } else {
      setGuestWeights({});
      setGuestHiddenCreators([]);
      setGuestDismissedPosts([]);
    }
    setActiveCategory('All');
    setLocalDistrict('All Districts');
    setRecBanner('Smart Discovery signals and hidden items have been reset.');
    toast.info('Discovery preferences reset.');
  };

  // Explicit-interest + legitimate engagement ranking (never sensitive attributes)
  // Friend suggestions inside the feed (placement/frequency come from the admin-configured friendSuggestionConfig).
  const friendSug = useFriendSuggestions(24);

  // Smart Video Distribution for regular video posts (recommended feed only; followed creators are never gated)
  const [gatedVideoPostIds, setGatedVideoPostIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (!firebaseUser || sortTab !== 'recommended' || posts.length === 0) { setGatedVideoPostIds(new Set()); return; }
    let cancelled = false;
    hiddenVideoPostIds(posts, {
      uid: firebaseUser.uid, following: new Set(followingIds), interests: userInterests, interestWeights,
      blockedAuthors: new Set(blockedIds), hiddenAuthors: new Set(hiddenCreatorIds), dismissed: new Set(dismissedPostIds), seen: getSeenKeys(),
    }).then((s) => { if (!cancelled) setGatedVideoPostIds(s); }).catch(() => { if (!cancelled) setGatedVideoPostIds(new Set()); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, sortTab, posts, followingIds.length]);

  const visiblePosts = useMemo(() => {
    const filtered = posts.filter((p) => {
      if (blockedIds.includes(p.authorId)) return false;
      if (hiddenCreatorIds.includes(p.authorId)) return false;
      if (dismissedPostIds.includes(p.id)) return false;
      if (gatedVideoPostIds.has(p.id)) return false;
      if (activeCategory !== 'All' && (p.category || 'News & Community') !== activeCategory) return false;
      if (localDistrict !== 'All Districts') {
        const loc = (p.locationName || '').toLowerCase();
        if (!loc.includes(localDistrict.toLowerCase())) return false;
      }
      if (sortTab === 'following' && firebaseUser) {
        if (p.authorId !== firebaseUser.uid && !followingIds.includes(p.authorId)) return false;
      }
      if (searchQuery) {
        const hay = `${p.content} ${p.authorName} ${p.authorUsername} ${p.category || ''} ${(p.hashtags || []).join(' ')}`.toLowerCase();
        if (!hay.includes(searchQuery)) return false;
      }
      return true;
    });

    if (sortTab !== 'recommended') return filtered;

    return [...filtered].sort((a, b) => {
      const score = (post: BanaPost) => {
        const cat = post.category || 'News & Community';
        const explicitMatch = userInterests.includes(cat) ? 25 : 0;
        const weight = (interestWeights[cat] || 0) * 4;
        const followBoost = followingIds.includes(post.authorId) ? 10 : 0;
        const engagement =
          (post.likesCount || 0) * 1.5 + (post.commentsCount || 0) * 2.5 + (post.sharesCount || 0) * 3;
        const createdMs = post.createdAt?.toMillis ? post.createdAt.toMillis() : 0;
        const ageHours = createdMs ? Math.max(0, (Date.now() - createdMs) / 3600000) : 24;
        const recency = Math.max(0, 48 - ageHours) * 0.6;
        return explicitMatch + weight + followBoost + Math.min(60, engagement) + recency;
      };
      return score(b) - score(a);
    });
  }, [
    posts,
    blockedIds,
    hiddenCreatorIds,
    dismissedPostIds,
    activeCategory,
    localDistrict,
    sortTab,
    firebaseUser,
    followingIds,
    searchQuery,
    userInterests,
    interestWeights,
    gatedVideoPostIds,
  ]);

  const filteredEvents = useMemo(() => {
    if (localDistrict === 'All Districts') return upcomingEvents;
    return upcomingEvents.filter((ev) => ev.district === localDistrict);
  }, [upcomingEvents, localDistrict]);

  const openComposer = (mode: CreateMode) => {
    if (!firebaseUser) return openAuthModal('Sign in to create posts, stories, polls, or voice notes.');
    if (profile && profile.accountStatus !== 'active') {
      toast.error(
        profile.accountRestrictionNote ||
          `Your account is currently ${profile.accountStatus}. Publishing actions are disabled.`
      );
      return;
    }
    if (platformSettings.maintenanceMode && !adminRole) {
      toast.error(platformSettings.maintenanceMessage || 'BANA is currently in maintenance mode.');
      return;
    }
    setComposerMode(mode);
    setComposerOpen(true);
  };

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 grid grid-cols-1 lg:grid-cols-12 gap-8">
        {/* Main Smart Discovery Column */}
        <div className="lg:col-span-8 space-y-5">
          {/* Stories Carousel */}
          <section className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4">
            <StoryCarousel onAddStory={() => openComposer('story')} />
          </section>

          {/* Smart Discovery Interest Bar */}
          <section className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h1 className="font-display font-bold text-sm text-neutral-950 dark:text-white">
                  Smart Discovery
                </h1>
                <p className="text-[11px] text-neutral-500">
                  Ranked by your chosen interests and authentic engagement
                </p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setInterestsEditorOpen((o) => !o)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <SlidersHorizontal className="w-3.5 h-3.5" />
                  Personalize ({userInterests.length})
                </button>
                <button
                  type="button"
                  onClick={handleResetRecommendations}
                  title="Reset recommendations"
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Reset</span>
                </button>
              </div>
            </div>

            {interestsEditorOpen && (
              <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
                <p className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Select topics you want to see more of:
                </p>
                <div className="flex flex-wrap gap-2">
                  {DISCOVERY_CATEGORIES.map((cat) => {
                    const active = userInterests.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() => toggleInterest(cat)}
                        className={`inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                          active
                            ? 'bg-brand border-blue-600 text-white'
                            : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                        }`}
                      >
                        {active && <Check className="w-3 h-3" />}
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Category filter strip */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1">
              <button
                type="button"
                onClick={() => setActiveCategory('All')}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  activeCategory === 'All'
                    ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                    : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                }`}
              >
                For You
              </button>
              {DISCOVERY_CATEGORIES.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    activeCategory === cat
                      ? 'bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
                      : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </div>
          </section>

          {searchQuery && (
            <div className="rounded-xl border border-brand/30 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-2.5 flex items-center justify-between text-xs text-neutral-900 dark:text-neutral-100">
              <span>
                Showing results for <strong className="text-brand dark:text-blue-400">"{searchParams.get('q')}"</strong>
              </span>
              <button
                type="button"
                onClick={() => setSearchParams({})}
                className="inline-flex items-center gap-1 font-semibold text-brand dark:text-blue-400 hover:underline"
              >
                <X className="w-3.5 h-3.5" /> Clear search
              </button>
            </div>
          )}

          {recBanner && (
            <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-2.5 flex items-center justify-between text-xs text-blue-800 dark:text-blue-200">
              <span>{recBanner}</span>
              <button type="button" onClick={() => setRecBanner(null)} className="font-semibold hover:underline">
                Dismiss
              </button>
            </div>
          )}

          {/* Inline Composer Trigger */}
          <section className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Avatar src={profile?.avatarUrl} name={profile?.displayName || 'Guest'} size="md" />
              <button
                type="button"
                onClick={() => openComposer('text')}
                className="flex-1 text-left h-10 px-4 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-sm text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200/70 dark:hover:bg-neutral-700/70 transition-colors"
              >
                {profile ? `Share something with BANA, ${profile.displayName.split(' ')[0]}...` : 'Sign in to post to BANA...'}
              </button>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-neutral-100 dark:border-neutral-800 gap-2 overflow-x-auto no-scrollbar">
              <button
                type="button"
                onClick={() => openComposer('image')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap"
              >
                <ImageIcon className="w-4 h-4 text-brand" /> Photo
              </button>
              <button
                type="button"
                onClick={() => openComposer('video')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap"
              >
                <Video className="w-4 h-4 text-emerald-600" /> Video
              </button>
              <button
                type="button"
                onClick={() => openComposer('voice')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap"
              >
                <Mic className="w-4 h-4 text-rose-600" /> Voice
              </button>
              <button
                type="button"
                onClick={() => openComposer('poll')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800 whitespace-nowrap"
              >
                <BarChart2 className="w-4 h-4 text-amber-600" /> Poll
              </button>
            </div>
          </section>

          {/* Mobile / Tablet People You May Know strip */}
          <div className="lg:hidden">
            <PeopleYouMayKnow variant="strip" limitCount={6} />
          </div>

          {/* Trending Reels Strip */}
          {platformSettings.enableReels !== false && trendingReels.length > 0 && (
            <section className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-sm flex items-center gap-1.5">
                  <Film className="w-4 h-4 text-brand" /> Trending Reels
                </h2>
                <Link to="/reels" className="text-xs font-medium text-brand dark:text-blue-400 hover:underline">
                  Watch all
                </Link>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {trendingReels.map((reel) => (
                  <Link
                    key={reel.id}
                    to={`/reels?reel=${reel.id}`}
                    className="group relative aspect-[9/14] rounded-xl overflow-hidden bg-neutral-950 block"
                  >
                    {reel.thumbnailUrl ? (
                      <ResilientImage
                        src={reel.thumbnailUrl}
                        alt={reel.caption || reel.authorUsername}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                      />
                    ) : (
                      <video src={reel.videoUrl} muted playsInline preload="metadata" className="w-full h-full object-cover" />
                    )}
                    <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/80 to-transparent text-white">
                      <p className="text-[11px] font-semibold truncate">@{reel.authorUsername}</p>
                      <p className="text-[10px] font-mono text-white/80 tabular-nums">
                        {formatCompactNumber(reel.viewsCount)} views
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* Feed Sorting Tabs + Local District Filter */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 overflow-x-auto no-scrollbar">
              {(
                [
                  { id: 'recommended', label: 'Recommended' },
                  { id: 'following', label: 'Following' },
                  { id: 'latest', label: 'Latest' },
                  { id: 'popular', label: 'Trending' },
                ] as { id: SortTab; label: string }[]
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    if (tab.id === 'following' && !firebaseUser) {
                      openAuthModal('Sign in to see posts from creators you follow.');
                      return;
                    }
                    setSortTab(tab.id);
                  }}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    sortTab === tab.id
                      ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <div className="flex items-center gap-2">
              <select
                aria-label="Local Bangladesh District Filter"
                value={localDistrict}
                onChange={(e) => setLocalDistrict(e.target.value)}
                className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 text-xs font-medium"
              >
                {BANGLADESH_DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {d === 'All Districts' ? 'Bangladesh: All' : d}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => loadFeed(true)}
                aria-label="Refresh feed"
                className="h-9 w-9 rounded-xl border border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              </button>
            </div>
          </div>

          {/* Mobile/Tablet Smart People You May Know Strip */}
          <div className="lg:hidden">
            <PeopleYouMayKnow variant="strip" limitCount={8} />
          </div>

          {/* Feed State */}
          {feedError && (
            <div className="rounded-[12px] border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="space-y-1">
                <p className="font-semibold">
                  {feedError.toLowerCase().includes('index')
                    ? 'Firestore Index Setup Required on bana-a5770'
                    : feedError.toLowerCase().includes('permission')
                    ? 'Firestore Rules Setup Required on bana-a5770'
                    : 'Feed Connection Notice on bana-a5770'}
                </p>
                <p>{feedError}</p>
                <p className="font-mono text-[11px] bg-white/70 dark:bg-black/30 px-2.5 py-1 rounded-lg inline-block">
                  firebase deploy --only firestore:rules,firestore:indexes,storage
                </p>
              </div>
              <button
                type="button"
                onClick={() => loadFeed(true)}
                className="px-3.5 py-2 rounded-xl bg-amber-900 text-white dark:bg-amber-200 dark:text-neutral-950 font-semibold shrink-0 self-start sm:self-center"
              >
                Retry Connection
              </button>
            </div>
          )}

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
                      <div className="h-3 w-32 rounded bg-neutral-200 dark:bg-neutral-800" />
                      <div className="h-2.5 w-24 rounded bg-neutral-100 dark:bg-neutral-800" />
                    </div>
                  </div>
                  <div className="h-20 w-full rounded-xl bg-neutral-100 dark:bg-neutral-800" />
                </div>
              ))}
            </div>
          ) : visiblePosts.length === 0 ? (
            <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center space-y-3">
              <div className="mx-auto h-12 w-12 rounded-[12px] bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500">
                <Compass className="w-6 h-6" />
              </div>
              <h3 className="font-display font-bold text-base">
                {sortTab === 'following' ? 'Follow people to fill this feed' : 'No matching posts in Smart Discovery'}
              </h3>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                {searchQuery
                  ? `No posts matched "${searchQuery}". Try another keyword.`
                  : 'Adjust your topic or district filters, or be the first to share something with BANA.'}
              </p>
              <button
                type="button"
                onClick={() => openComposer('text')}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover transition-colors"
              >
                Create Post
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              {visiblePosts.map((post, idx) => (
                <React.Fragment key={post.id}>
                  <PostCard
                    post={post}
                    onDeleted={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
                    onBlockedUser={(uid) => setBlockedIds((prev) => [...prev, uid])}
                    onHideCreator={handleHideCreator}
                    onNotInterested={handleNotInterested}
                    onAdjustInterest={handleAdjustInterest}
                  />
                  {(() => {
                    const cfg = friendSug.config;
                    if (!cfg || !firebaseUser) return null;
                    const slots = pickFeedSlots(visiblePosts.length, cfg);
                    const slot = slots.indexOf(idx);
                    if (slot < 0) return null;
                    return (
                      <FeedFriendSuggestions
                        slotIndex={slot}
                        items={friendSug.items.slice(slot * cfg.cardsPerSlot, (slot + 1) * cfg.cardsPerSlot)}
                        loading={friendSug.loading}
                        error={friendSug.error}
                        status={friendSug.status}
                        busy={friendSug.busy}
                        cardError={friendSug.cardError}
                        onAdd={friendSug.add}
                        onUndo={friendSug.undo}
                        onDismiss={friendSug.dismiss}
                        onRefresh={friendSug.refresh}
                      />
                    );
                  })()}
                  {idx === 2 && activeAd && (
                    <SponsoredAdCard
                      campaign={activeAd}
                      placement="home_feed"
                      variant="feed"
                      onDismiss={() => setActiveAd(null)}
                    />
                  )}
                </React.Fragment>
              ))}

              {hasMore && (
                <div className="pt-2 text-center">
                  <button
                    type="button"
                    disabled={loadingMore}
                    onClick={() => loadFeed(false)}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-900 disabled:opacity-50"
                  >
                    {loadingMore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    Load More Posts
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right Smart Discovery Rail */}
        <aside className="hidden lg:block lg:col-span-4 space-y-5">
          {/* Active Approved Ad (only shown when real Admin-approved active ad exists for adults) */}
          {activeAd && (
            <SponsoredAdCard
              campaign={activeAd}
              placement="home_feed"
              variant="feed"
              onDismiss={() => setActiveAd(null)}
            />
          )}

          {/* Smart People You May Know */}
          <PeopleYouMayKnow variant="sidebar" limitCount={5} />

          {/* Local Discoveries (Bangladesh Events) */}
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-brand" /> Local Discoveries
              </h3>
              <Link to="/communities?tab=events" className="text-xs font-medium text-brand dark:text-blue-400 hover:underline">
                Events
              </Link>
            </div>
            {filteredEvents.length === 0 ? (
              <p className="text-xs text-neutral-500">
                Upcoming meetups and events across Bangladesh districts will appear here.
              </p>
            ) : (
              <div className="space-y-2.5">
                {filteredEvents.map((ev) => (
                  <Link
                    key={ev.id}
                    to="/communities?tab=events"
                    className="block rounded-xl border border-neutral-100 dark:border-neutral-800 p-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                  >
                    <p className="text-xs font-semibold truncate">{ev.title}</p>
                    <p className="text-[11px] text-neutral-500 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{ev.district} · {ev.eventDate}</span>
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Community Highlights */}
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm">Community Highlights</h3>
              <Link to="/communities" className="text-xs font-medium text-brand dark:text-blue-400 hover:underline">
                View all
              </Link>
            </div>
            {topCommunities.length === 0 ? (
              <p className="text-xs text-neutral-500">Create or join district and interest communities.</p>
            ) : (
              <div className="space-y-2.5">
                {topCommunities.map((c) => (
                  <Link
                    key={c.id}
                    to={`/communities/${c.id}`}
                    className="block rounded-xl border border-neutral-100 dark:border-neutral-800 p-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                  >
                    <p className="text-xs font-semibold truncate">{c.name}</p>
                    <p className="text-[11px] text-neutral-500 mt-0.5 tabular-nums">
                      {c.category} {c.district ? `· ${c.district}` : ''} · {c.membersCount} members
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </div>

          {/* Business Highlights (BANA Market) */}
          {platformSettings.enableMarketplace !== false && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-sm flex items-center gap-1.5">
                <ShoppingBag className="w-4 h-4 text-emerald-600" /> Business Highlights
              </h3>
              <Link to="/market" className="text-xs font-medium text-brand dark:text-blue-400 hover:underline">
                BANA Market
              </Link>
            </div>
            {businessHighlights.length === 0 ? (
              <p className="text-xs text-neutral-500">Featured local shops and listings from BANA Market appear here.</p>
            ) : (
              <div className="space-y-2.5">
                {businessHighlights.map((item) => (
                  <Link
                    key={item.id}
                    to={`/market/product/${item.id}`}
                    className="flex items-center gap-2.5 rounded-xl border border-neutral-100 dark:border-neutral-800 p-2 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors"
                  >
                    {item.imageUrls?.[0] && (
                      <ResilientImage
                        src={item.imageUrls[0]}
                        alt={item.title}
                        className="h-11 w-11 rounded-lg object-cover shrink-0"
                      />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-semibold truncate">{item.title}</p>
                      <p className="text-[11px] font-mono text-brand dark:text-blue-400 tabular-nums">
                        {item.currency} {item.price.toLocaleString()} · {item.location}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
          )}
        </aside>
      </div>

      <CreateModal
        isOpen={composerOpen}
        initialMode={composerMode}
        onClose={() => setComposerOpen(false)}
        onCreated={() => loadFeed(true)}
      />
    </AppShell>
  );
}

