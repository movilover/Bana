import { submitReport } from '@/src/lib/reports';
import React, { useEffect, useState, useCallback } from 'react';
import { useFeedHides } from '@/src/lib/feedHides';
import { Link, useParams, useNavigate } from 'react-router-dom';
import {
  MapPin,
  Link as LinkIcon,
  UserPlus,
  UserCheck,
  UserMinus,
  MessageSquare,
  Edit3,
  Ban,
  Flag,
  X,
  BarChart3,
  Plus,
  Trash2,
  Pencil,
  Send,
  Eye,
  Heart,
  ShieldCheck,
  Lock,
  MoreHorizontal,
  Copy,
  EyeOff,
  ShieldAlert,
  LayoutGrid,
  List,
  Users,
  Clock,
  Pin,
  Sparkles,
  Check,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
  updateDoc,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { useAuth, sanitizeUsername } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  DISCOVERY_CATEGORIES,
  type BanaUser,
  type BanaPost,
  type BanaReel,
  type DiscoveryCategory,
  type ProfileAccent,
  type FriendRequestRecord,
  type FollowRequestRecord,
} from '@/src/types/bana';
import { AppShell } from '@/src/components/layout/AppShell';
import { Avatar, ResilientImage } from '@/src/components/common/Avatar';
import { CreatorBadge } from '@/src/components/common/BanaLogo';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';
import { PostCard } from '@/src/components/feed/PostCard';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import { ReelUploadModal } from '@/src/components/reels/ReelUploadModal';
import { compressImageFile, formatCompactNumber, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { formatDurationClock } from '@/src/lib/videoUtils';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { checkPairBlockedAndPrivacy } from '@/src/lib/webrtcCalling';
import {
  getSocialRelationship,
  followOrRequestUser,
  cancelFollowRequest,
  unfollowUser,
  removeFollower,
  acceptFollowRequest,
  declineFollowRequest,
  sendFriendRequest,
  acceptFriendRequest,
  declineFriendRequest,
  cancelFriendRequest,
  unfriendUser,
  blockUser,
  unblockUser,
  toggleRestrictUser,
  getUserFriendIds,
  getMutualFriendIds,
  fetchUsersByIds,
  fetchPendingSocialRequests,
  recordDailyProfileView,
  type SocialRelationship,
} from '@/src/lib/socialGraph';
import { fetchLiveFollowCounts } from '@/src/lib/socialCounts';
import { useLiveVerified } from '@/src/lib/verifiedStatus';

type ProfileTab = 'posts' | 'reels' | 'photos' | 'videos' | 'about' | 'friends' | 'saved' | 'analytics';
type ConnectionsTab = 'followers' | 'following' | 'friends' | 'mutual' | 'requests';

const ACCENT_COVERS: Record<ProfileAccent, string> = {
  blue: 'from-blue-100 via-slate-100 to-blue-200 dark:from-slate-900 dark:via-neutral-950 dark:to-blue-950',
  slate: 'from-neutral-200 via-neutral-100 to-slate-200 dark:from-neutral-900 dark:via-neutral-950 dark:to-slate-900',
  emerald: 'from-emerald-100 via-teal-50 to-neutral-100 dark:from-neutral-900 dark:via-emerald-950/60 dark:to-neutral-950',
  amber: 'from-amber-100 via-orange-50 to-neutral-100 dark:from-neutral-900 dark:via-amber-950/50 dark:to-neutral-950',
  rose: 'from-rose-100 via-pink-50 to-neutral-100 dark:from-neutral-900 dark:via-rose-950/50 dark:to-neutral-950',
};

export function ProfilePage() {
  const { username } = useParams();
  const navigate = useNavigate();
  const {
    firebaseUser,
    profile: myProfile,
    updateLocalSettings,
    refreshProfile,
    refreshSocialFilters,
    openAuthModal,
    checkUsernameAvailable,
    reserveUsername,
  } = useAuth();
  const toast = useToast();
  const feedHides = useFeedHides();

  const [targetUser, setTargetUser] = useState<BanaUser | null>(null);
  // Live, server-authoritative verification (updates on grant/revoke without a reload).
  const liveVerifiedTarget = useLiveVerified(targetUser?.uid);
  const [posts, setPosts] = useState<BanaPost[]>([]);
  const [reels, setReels] = useState<BanaReel[]>([]);
  const [savedPosts, setSavedPosts] = useState<BanaPost[]>([]);
  const [tab, setTab] = useState<ProfileTab>('posts');
  const [postLayout, setPostLayout] = useState<'list' | 'grid'>('list');
  const [loading, setLoading] = useState(true);

  const [rel, setRel] = useState<SocialRelationship>({
    isFollowing: false,
    followsMe: false,
    followRequestStatus: 'none',
    friendStatus: 'none',
    isBlockedByMe: false,
    amIBlocked: false,
    isRestrictedByMe: false,
    amIRestricted: false,
  });

  const [mutualFriends, setMutualFriends] = useState<BanaUser[]>([]);
  const [friendsList, setFriendsList] = useState<BanaUser[]>([]);
  const [followersList, setFollowersList] = useState<BanaUser[]>([]);
  const [followingList, setFollowingList] = useState<BanaUser[]>([]);
  const [pendingRequests, setPendingRequests] = useState<{
    incomingFriends: Array<{ req: FriendRequestRecord; user: BanaUser }>;
    sentFriends: Array<{ req: FriendRequestRecord; user: BanaUser }>;
    incomingFollows: Array<{ req: FollowRequestRecord; user: BanaUser }>;
  }>({ incomingFriends: [], sentFriends: [], incomingFollows: [] });

  // Connections Modal
  const [connectionsOpen, setConnectionsOpen] = useState<ConnectionsTab | null>(null);
  const [connectionsLoading, setConnectionsLoading] = useState(false);

  // Header Menus & Dialogs
  const [moreMenuOpen, setMoreMenuOpen] = useState(false);
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportReason, setReportReason] = useState('Harassment or impersonation');
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);

  // Owner Analytics
  const [profileVisits7d, setProfileVisits7d] = useState(0);
  const [profileVisits30d, setProfileVisits30d] = useState(0);

  // Edit Profile Modal
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState('');
  const [editUsername, setEditUsername] = useState('');
  const [editUsernameOk, setEditUsernameOk] = useState<boolean | null>(true);
  const [editBio, setEditBio] = useState('');
  const [editLocation, setEditLocation] = useState('');
  const [editWebsite, setEditWebsite] = useState('');
  const [editCategory, setEditCategory] = useState('');
  const [editLayout, setEditLayout] = useState<'list' | 'grid'>('list');
  const [editAccent, setEditAccent] = useState<ProfileAccent>('blue');
  const [editHighlights, setEditHighlights] = useState('');
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [coverPreview, setCoverPreview] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Creator Reels Management state
  const [reelFilter, setReelFilter] = useState<'active' | 'draft'>('active');
  const [reelUploadOpen, setReelUploadOpen] = useState(false);
  const [editingReel, setEditingReel] = useState<BanaReel | null>(null);
  const [reelTitleInput, setReelTitleInput] = useState('');
  const [reelCaptionInput, setReelCaptionInput] = useState('');
  const [reelDescInput, setReelDescInput] = useState('');
  const [reelSoundInput, setReelSoundInput] = useState('');
  const [reelTagsInput, setReelTagsInput] = useState('');
  const [reelCatInput, setReelCatInput] = useState<DiscoveryCategory>('Entertainment');
  const [reelVisInput, setReelVisInput] = useState<'public' | 'followers' | 'only_me'>('public');
  const [reelStatusInput, setReelStatusInput] = useState<'active' | 'draft'>('active');
  const [savingReelEdit, setSavingReelEdit] = useState(false);
  const [deleteReelTarget, setDeleteReelTarget] = useState<BanaReel | null>(null);
  const [deletingReel, setDeletingReel] = useState(false);

  const loadConnections = useCallback(async (userObj: BanaUser, isOwn: boolean) => {
    setConnectionsLoading(true);
    // Spark plan: stored counters are never updated (Cloud Functions are off), so show the real counts.
    fetchLiveFollowCounts(userObj.uid)
      .then((c) => {
        if (c) {
          setTargetUser((u) => (u && u.uid === userObj.uid ? { ...u, followersCount: c.followers, followingCount: c.following } : u));
        }
      })
      .catch(() => {});
    try {
      const [friendIds, followersSnap, followingSnap] = await Promise.all([
        getUserFriendIds(userObj.uid),
        getDocs(query(collection(db, 'userFollows'), where('followingId', '==', userObj.uid), limit(80))).catch(() => null),
        getDocs(query(collection(db, 'userFollows'), where('followerId', '==', userObj.uid), limit(80))).catch(() => null),
      ]);

      const followerUids = followersSnap?.docs.map((d) => String(d.data().followerId || '')).filter(Boolean) || [];
      const followingUids = followingSnap?.docs.map((d) => String(d.data().followingId || '')).filter(Boolean) || [];

      const [friends, followers, following] = await Promise.all([
        fetchUsersByIds(friendIds),
        fetchUsersByIds(followerUids),
        fetchUsersByIds(followingUids),
      ]);
      setFriendsList(friends);
      setFollowersList(followers);
      setFollowingList(following);

      if (isOwn) {
        const reqs = await fetchPendingSocialRequests(userObj.uid);
        setPendingRequests(reqs);
      }
    } finally {
      setConnectionsLoading(false);
    }
  }, []);

  const loadProfileData = useCallback(async () => {
    setLoading(true);
    try {
      let userObj: BanaUser | null = null;
      if (username) {
        const snap = await getDocs(query(collection(db, 'users'), where('username', '==', username), limit(1)));
        if (!snap.empty) {
          userObj = { uid: snap.docs[0].id, ...(snap.docs[0].data() as Omit<BanaUser, 'uid'>) };
        }
      } else if (myProfile) {
        userObj = myProfile;
      }

      setTargetUser(userObj);
      if (!userObj) {
        setLoading(false);
        return;
      }

      setPostLayout(userObj.profileLayout === 'grid' ? 'grid' : 'list');
      const isOwnProfile = firebaseUser?.uid === userObj.uid;

      // Relationship state + Mutual friends + Record view
      if (firebaseUser && !isOwnProfile) {
        const [relationship, mutualIds] = await Promise.all([
          getSocialRelationship(firebaseUser.uid, userObj.uid),
          getMutualFriendIds(firebaseUser.uid, userObj.uid),
        ]);
        setRel(relationship);
        if (mutualIds.length > 0) {
          fetchUsersByIds(mutualIds.slice(0, 20)).then(setMutualFriends).catch(() => {});
        } else {
          setMutualFriends([]);
        }
        if (!relationship.isBlockedByMe && !relationship.amIBlocked) {
          recordDailyProfileView(userObj.uid, firebaseUser.uid);
        }
      } else {
        setMutualFriends([]);
      }

      // Fetch posts & reels (only public posts/reels for non-owners to respect Firestore list rules)
      const postFilters = [
        where('authorId', '==', userObj.uid),
        where('status', '==', 'published'),
        ...(isOwnProfile ? [] : [where('visibility', '==', 'public')]),
      ];
      const reelFilters = [
        where('authorId', '==', userObj.uid),
        ...(isOwnProfile ? [] : [where('status', '==', 'active'), where('visibility', '==', 'public')]),
      ];

      const [postsRes, reelsRes] = await Promise.all([
        getDocsWithIndexFallback<BanaPost>(
          query(collection(db, 'posts'), ...postFilters, orderBy('createdAt', 'desc'), limit(40)),
          query(collection(db, 'posts'), ...postFilters, limit(60)),
          sortByCreatedAtDesc
        ),
        getDocsWithIndexFallback<BanaReel>(
          query(collection(db, 'reels'), ...reelFilters, orderBy('createdAt', 'desc'), limit(40)),
          query(collection(db, 'reels'), ...reelFilters, limit(60)),
          sortByCreatedAtDesc
        ),
      ]);

      setPosts(postsRes.items.slice(0, 40));
      setReels(reelsRes.items.slice(0, 40));

      if (firebaseUser) {
        loadConnections(userObj, isOwnProfile);
      }

      if (isOwnProfile && firebaseUser) {
        const [savedSnap, viewsSnap] = await Promise.all([
          getDocs(query(collection(db, 'savedPosts'), where('userId', '==', firebaseUser.uid), limit(20))).catch(() => null),
          getDocs(query(collection(db, 'profileViews'), where('profileUid', '==', firebaseUser.uid), limit(200))).catch(() => null),
        ]);

        if (savedSnap) {
          const postIds = savedSnap.docs.map((d) => d.data().postId);
          const loadedSaved: BanaPost[] = [];
          for (const pid of postIds.slice(0, 10)) {
            const ps = await getDoc(doc(db, 'posts', pid)).catch(() => null);
            if (ps?.exists()) loadedSaved.push({ id: ps.id, ...(ps.data() as Omit<BanaPost, 'id'>) });
          }
          setSavedPosts(loadedSaved);
        }

        if (viewsSnap) {
          const now = Date.now();
          let v7 = 0;
          let v30 = 0;
          viewsSnap.docs.forEach((d) => {
            const data = d.data();
            const ts = data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.parse(data.dayKey || '') || 0;
            if (!ts || now - ts <= 30 * 86400000) v30 += 1;
            if (!ts || now - ts <= 7 * 86400000) v7 += 1;
          });
          setProfileVisits7d(v7);
          setProfileVisits30d(v30);
        }
      }
    } catch (err) {
      logFirestoreError(err, OperationType.GET, `profile/${username}`);
    } finally {
      setLoading(false);
    }
  }, [username, myProfile, firebaseUser, loadConnections]);

  useEffect(() => {
    loadProfileData();
  }, [loadProfileData]);

  useEffect(() => {
    if (!editOpen || !targetUser) return;
    const clean = sanitizeUsername(editUsername);
    if (clean === targetUser.username) {
      setEditUsernameOk(true);
      return;
    }
    if (clean.length < 3) {
      setEditUsernameOk(false);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const ok = await checkUsernameAvailable(clean, targetUser.uid);
      if (!cancelled) setEditUsernameOk(ok);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [editOpen, editUsername, targetUser, checkUsernameAvailable]);

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-4xl mx-auto px-4 py-8 animate-pulse space-y-4">
          <div className="h-48 rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
          <div className="h-24 rounded-2xl bg-neutral-100 dark:bg-neutral-900" />
        </div>
      </AppShell>
    );
  }

  if (!targetUser) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 text-center space-y-3">
          <h1 className="font-display font-bold text-xl">Profile not found</h1>
          <p className="text-xs text-neutral-500">The requested BANA profile @{username} does not exist.</p>
          <button
            type="button"
            onClick={() => navigate('/discover')}
            className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold transition-colors"
          >
            Back to Discover
          </button>
        </div>
      </AppShell>
    );
  }

  const isMe = firebaseUser?.uid === targetUser.uid;
  const accentClass = ACCENT_COVERS[targetUser.profileAccent || 'blue'];

  // Privacy enforcement checks
  const canViewPrivateProfile =
    isMe ||
    !targetUser.isPrivateAccount ||
    rel.isFollowing ||
    rel.friendStatus === 'friends';

  const canViewFollowersList =
    isMe ||
    (targetUser.whoCanViewFollowers || 'everyone') === 'everyone' ||
    (targetUser.whoCanViewFollowers === 'followers' && (rel.isFollowing || rel.friendStatus === 'friends'));

  const canViewFriendsList =
    isMe ||
    (targetUser.whoCanViewFriends || 'everyone') === 'everyone' ||
    (targetUser.whoCanViewFriends === 'friends' && rel.friendStatus === 'friends');

  const showLocationPublic = targetUser.showPersonalInfo !== false && targetUser.showLocation !== false;
  const showWebsitePublic = targetUser.showPersonalInfo !== false;

  const totalPendingRequestsCount =
    pendingRequests.incomingFriends.length + pendingRequests.incomingFollows.length;

  const handleFollowAction = async () => {
    if (!firebaseUser || !myProfile) {
      return openAuthModal(`Sign in to follow ${targetUser.displayName}.`);
    }
    try {
      if (rel.isFollowing) {
        await unfollowUser(firebaseUser.uid, targetUser.uid);
        setRel((p) => ({ ...p, isFollowing: false }));
        setTargetUser((u) => (u ? { ...u, followersCount: Math.max(0, (u.followersCount || 1) - 1) } : u));
        toast.info(`Unfollowed @${targetUser.username}`);
      } else if (rel.followRequestStatus === 'sent_pending') {
        await cancelFollowRequest(firebaseUser.uid, targetUser.uid);
        setRel((p) => ({ ...p, followRequestStatus: 'none' }));
        toast.info('Follow request cancelled.');
      } else {
        const res = await followOrRequestUser(myProfile, targetUser);
        if (res === 'requested') {
          setRel((p) => ({ ...p, followRequestStatus: 'sent_pending' }));
          toast.success(`Follow request sent to ${targetUser.displayName}.`);
        } else {
          setRel((p) => ({ ...p, isFollowing: true, followRequestStatus: 'none' }));
          setTargetUser((u) => (u ? { ...u, followersCount: (u.followersCount || 0) + 1 } : u));
          toast.success(`Following ${targetUser.displayName}.`);
        }
      }
    } catch (err: any) {
      toast.error(err?.message || 'Unable to update follow status.');
    }
  };

  const handleFriendAction = async (action: 'send' | 'cancel' | 'accept' | 'decline' | 'unfriend') => {
    if (!firebaseUser || !myProfile) {
      return openAuthModal(`Sign in to connect with ${targetUser.displayName}.`);
    }
    try {
      if (action === 'send') {
        await sendFriendRequest(myProfile, targetUser);
        setRel((p) => ({ ...p, friendStatus: 'sent_pending' }));
        toast.success(`Friend request sent to ${targetUser.displayName}.`);
      } else if (action === 'cancel') {
        await cancelFriendRequest(firebaseUser.uid, targetUser.uid);
        setRel((p) => ({ ...p, friendStatus: 'none' }));
        toast.info('Friend request cancelled.');
      } else if (action === 'accept') {
        await acceptFriendRequest(myProfile, targetUser.uid);
        setRel((p) => ({ ...p, friendStatus: 'friends' }));
        setTargetUser((u) => (u ? { ...u, friendsCount: (u.friendsCount || 0) + 1 } : u));
        toast.success(`You and ${targetUser.displayName} are now friends!`);
      } else if (action === 'decline') {
        await declineFriendRequest(firebaseUser.uid, targetUser.uid);
        setRel((p) => ({ ...p, friendStatus: 'none' }));
        toast.info('Friend request declined.');
      } else if (action === 'unfriend') {
        await unfriendUser(firebaseUser.uid, targetUser.uid);
        setRel((p) => ({ ...p, friendStatus: 'none' }));
        setTargetUser((u) => (u ? { ...u, friendsCount: Math.max(0, (u.friendsCount || 1) - 1) } : u));
        toast.info(`Removed ${targetUser.displayName} from friends.`);
      }
    } catch (err: any) {
      toast.error(err?.message || 'Unable to update friend status.');
    }
  };

  const startMessage = async () => {
    if (!firebaseUser || !myProfile) {
      return openAuthModal(`Sign in to message ${targetUser.displayName} in BANA Messenger.`);
    }
    const check = await checkPairBlockedAndPrivacy(firebaseUser.uid, targetUser.uid, 'message');
    if (check.status === 'denied') {
      toast.error(check.reason || 'Messaging is restricted for this user.');
      return;
    }

    const existingSnap = await getDocs(
      query(collection(db, 'conversations'), where('participantIds', 'array-contains', firebaseUser.uid))
    );
    const existing = existingSnap.docs.find((d) => !d.data().isGroup && d.data().participantIds.includes(targetUser.uid));
    if (existing) return navigate(`/messages/${existing.id}`);

    const convRef = await addDoc(collection(db, 'conversations'), {
      participantIds: [firebaseUser.uid, targetUser.uid],
      participantMeta: {
        [firebaseUser.uid]: {
          displayName: myProfile.displayName,
          username: myProfile.username,
          avatarUrl: myProfile.avatarUrl || '',
        },
        [targetUser.uid]: {
          displayName: targetUser.displayName,
          username: targetUser.username,
          avatarUrl: targetUser.avatarUrl || '',
        },
      },
      isGroup: false,
      isRequest: check.status === 'request',
      lastMessageText: '',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    navigate(`/messages/${convRef.id}`);
  };

  const handleTogglePin = async (postId: string) => {
    if (!firebaseUser || !isMe) return;
    const nextPinned = targetUser.pinnedPostId === postId ? '' : postId;
    await updateDoc(doc(db, 'users', firebaseUser.uid), {
      pinnedPostId: nextPinned,
      updatedAt: serverTimestamp(),
    });
    setTargetUser((u) => (u ? { ...u, pinnedPostId: nextPinned } : u));
    await refreshProfile();
    toast.success(nextPinned ? 'Post pinned to the top of your profile.' : 'Post unpinned.');
  };

  const handleHideCreator = async () => {
    if (!firebaseUser || isMe) return;
    const prev = feedHides.hiddenCreatorIds;
    if (prev.includes(targetUser.uid)) await feedHides.unhideCreator(targetUser.uid);
    else await feedHides.hideCreator(targetUser.uid);
    setMoreMenuOpen(false);
    toast.info(
      prev.includes(targetUser.uid)
        ? `Posts from @${targetUser.username} will appear in your feed again.`
        : `Posts from @${targetUser.username} are hidden from your feed.`
    );
  };

  const handleToggleRestrict = async () => {
    if (!firebaseUser || isMe) return;
    const next = await toggleRestrictUser(firebaseUser.uid, targetUser.uid, rel.isRestrictedByMe);
    setRel((p) => ({ ...p, isRestrictedByMe: next }));
    await refreshSocialFilters();
    setMoreMenuOpen(false);
    toast.info(next ? `Restricted @${targetUser.username}.` : `Removed restriction on @${targetUser.username}.`);
  };

  const handleBlock = async () => {
    if (!firebaseUser || isMe) return;
    await blockUser(firebaseUser.uid, targetUser.uid);
    setRel((p) => ({ ...p, isBlockedByMe: true, isFollowing: false, friendStatus: 'none' }));
    await refreshSocialFilters();
    setMoreMenuOpen(false);
    toast.info(`Blocked @${targetUser.username}.`);
  };

  const handleUnblock = async () => {
    if (!firebaseUser || isMe) return;
    await unblockUser(firebaseUser.uid, targetUser.uid);
    setRel((p) => ({ ...p, isBlockedByMe: false }));
    await refreshSocialFilters();
    toast.info(`Unblocked @${targetUser.username}.`);
    loadProfileData();
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return openAuthModal('Sign in to report this profile.');
    const outcome = await submitReport({
      reporterId: firebaseUser.uid, targetType: 'user', targetId: targetUser.uid, reason: reportReason, details: `Reported profile @${targetUser.username}`,
    }).catch(() => null);
    setReportModalOpen(false);
    if (outcome === 'submitted') toast.success('Profile report submitted to BANA Moderation.');
    else if (outcome === 'duplicate') toast.info('You already reported this profile.');
    else toast.error('Could not submit the report. Please try again.');
  };

  const openEditModal = () => {
    setEditName(targetUser.displayName);
    setEditUsername(targetUser.username);
    setEditUsernameOk(true);
    setEditBio(targetUser.bio || '');
    setEditLocation(targetUser.location || '');
    setEditWebsite(targetUser.website || '');
    setEditCategory(targetUser.creatorCategory || '');
    setEditLayout(targetUser.profileLayout === 'grid' ? 'grid' : 'list');
    setEditAccent(targetUser.profileAccent || 'blue');
    setEditHighlights((targetUser.highlights || []).join(', '));
    setAvatarFile(null);
    setAvatarPreview(null);
    setCoverFile(null);
    setCoverPreview(null);
    setUploadProgress(null);
    setError(null);
    setEditOpen(true);
  };

  const handleFilePick = (kind: 'avatar' | 'cover', file: File | null) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Please select a valid image file (JPG, PNG, or WebP).');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('Image size must be 10 MB or smaller.');
      return;
    }
    setError(null);
    const preview = URL.createObjectURL(file);
    if (kind === 'avatar') {
      setAvatarFile(file);
      setAvatarPreview(preview);
    } else {
      setCoverFile(file);
      setCoverPreview(preview);
    }
  };

  const saveEditProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !isMe) return;
    const nextUname = sanitizeUsername(editUsername, firebaseUser.uid);
    if (nextUname !== targetUser.username) {
      const available = await checkUsernameAvailable(nextUname, firebaseUser.uid);
      if (!available) {
        setError(`Username "@${nextUname}" is already taken.`);
        return;
      }
    }

    setSaving(true);
    setError(null);
    try {
      let avatarUrl = targetUser.avatarUrl || '';
      let coverUrl = targetUser.coverUrl || '';

      if (avatarFile) {
        const compressed = await compressImageFile(avatarFile, 600);
        avatarUrl = await uploadMediaWithProgress(
          `users/${firebaseUser.uid}/avatar_${Date.now()}.jpg`,
          compressed,
          (pct) => setUploadProgress(pct)
        );
      }
      if (coverFile) {
        const compressed = await compressImageFile(coverFile, 1600);
        coverUrl = await uploadMediaWithProgress(
          `users/${firebaseUser.uid}/cover_${Date.now()}.jpg`,
          compressed,
          (pct) => setUploadProgress(pct)
        );
      }

      if (nextUname !== targetUser.username) {
        await reserveUsername(nextUname, firebaseUser.uid, targetUser.username);
      }

      const highlightsArr = editHighlights
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 6);

      await updateDoc(doc(db, 'users', firebaseUser.uid), {
        displayName: editName.trim().slice(0, 80),
        username: nextUname,
        bio: editBio.trim().slice(0, 300),
        location: editLocation.trim().slice(0, 80),
        website: editWebsite.trim().slice(0, 140),
        creatorCategory: editCategory.trim().slice(0, 50),
        profileLayout: editLayout,
        profileAccent: editAccent,
        highlights: highlightsArr,
        avatarUrl,
        coverUrl,
        updatedAt: serverTimestamp(),
      });

      await refreshProfile();
      setEditOpen(false);
      toast.success('Profile updated.');
      if (nextUname !== targetUser.username) {
        navigate(`/profile/${nextUname}`, { replace: true });
      } else {
        loadProfileData();
      }
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSaving(false);
      setUploadProgress(null);
    }
  };

  // Ordered Posts (Pinned first)
  const orderedPosts = [...posts].sort((a, b) => {
    if (targetUser.pinnedPostId && a.id === targetUser.pinnedPostId) return -1;
    if (targetUser.pinnedPostId && b.id === targetUser.pinnedPostId) return 1;
    return 0;
  });

  const photoPosts = orderedPosts.filter((p) => p.mediaUrls && p.mediaUrls.length > 0 && p.type !== 'video');
  const videoPosts = orderedPosts.filter((p) => p.type === 'video');

  const publishedReels = reels.filter((r) => r.status === 'active');
  const draftReels = reels.filter((r) => r.status === 'draft');
  const displayedReels = isMe
    ? reelFilter === 'draft'
      ? draftReels
      : reels.filter((r) => r.status !== 'draft')
    : publishedReels;

  const totalReelViews = publishedReels.reduce((s, r) => s + Number(r.viewsCount || 0), 0);
  const totalReelLikes = publishedReels.reduce((s, r) => s + Number(r.likesCount || 0), 0);
  const totalReelComments = publishedReels.reduce((s, r) => s + Number(r.commentsCount || 0), 0);
  const totalReelShares = publishedReels.reduce((s, r) => s + Number(r.sharesCount || 0), 0);

  const totalPostLikes = posts.reduce((s, p) => s + Number(p.likesCount || 0), 0);
  const totalPostComments = posts.reduce((s, p) => s + Number(p.commentsCount || 0), 0);
  const totalPostShares = posts.reduce((s, p) => s + Number(p.sharesCount || 0), 0);

  const openEditReelModal = (r: BanaReel) => {
    setEditingReel(r);
    setReelTitleInput(r.title || '');
    setReelCaptionInput(r.caption || '');
    setReelDescInput(r.description || '');
    setReelSoundInput(r.soundName || 'Original Audio');
    setReelTagsInput((r.hashtags || []).map((h) => `#${h}`).join(', '));
    setReelCatInput(r.category || 'Entertainment');
    setReelVisInput(r.visibility || 'public');
    setReelStatusInput(r.status === 'draft' ? 'draft' : 'active');
  };

  const handleSaveReelEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingReel || !firebaseUser || !isMe) return;
    setSavingReelEdit(true);
    try {
      const hashtags = reelTagsInput
        .split(/[\s,]+/)
        .map((s) => s.trim().replace(/^#/, ''))
        .filter(Boolean)
        .slice(0, 12);
      await updateDoc(doc(db, 'reels', editingReel.id), {
        title: reelTitleInput.trim().slice(0, 120),
        caption: reelCaptionInput.trim().slice(0, 2000),
        description: reelDescInput.trim().slice(0, 2000),
        soundName: reelSoundInput.trim() || 'Original Audio',
        category: reelCatInput,
        hashtags,
        visibility: reelVisInput,
        status: editingReel.status === 'removed' ? 'removed' : reelStatusInput,
        updatedAt: serverTimestamp(),
      });
      toast.success('Video details updated.');
      setEditingReel(null);
      loadProfileData();
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setSavingReelEdit(false);
    }
  };

  const handlePublishDraftReel = async (r: BanaReel) => {
    try {
      await updateDoc(doc(db, 'reels', r.id), {
        status: 'active',
        updatedAt: serverTimestamp(),
      });
      toast.success('Draft Reel published.');
      setReelFilter('active');
      loadProfileData();
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    }
  };

  const handleConfirmDeleteReel = async () => {
    if (!deleteReelTarget) return;
    setDeletingReel(true);
    try {
      await deleteDoc(doc(db, 'reels', deleteReelTarget.id));
      toast.info('Video deleted.');
      setReels((prev) => prev.filter((item) => item.id !== deleteReelTarget.id));
      setDeleteReelTarget(null);
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setDeletingReel(false);
    }
  };

  const isCreatorHidden = feedHides.hiddenCreatorIds.includes(targetUser.uid);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Blocked Banner / Gate */}
        {!isMe && (rel.isBlockedByMe || rel.amIBlocked) ? (
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center space-y-3">
            <Ban className="w-10 h-10 mx-auto text-neutral-400" />
            <h1 className="font-display font-bold text-lg">
              {rel.isBlockedByMe ? `You blocked @${targetUser.username}` : 'Profile unavailable'}
            </h1>
            <p className="text-xs text-neutral-500 max-w-md mx-auto">
              {rel.isBlockedByMe
                ? 'Blocked accounts cannot message, call, follow, or view your profile content.'
                : 'This profile cannot be viewed right now.'}
            </p>
            {rel.isBlockedByMe && (
              <button
                type="button"
                onClick={handleUnblock}
                className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold"
              >
                Unblock @{targetUser.username}
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Profile Header Card */}
            <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden">
              <div className="h-44 sm:h-56 bg-neutral-100 dark:bg-neutral-950 relative">
                {targetUser.coverUrl ? (
                  <ResilientImage src={targetUser.coverUrl} alt="Cover" className="w-full h-full object-cover" />
                ) : (
                  <div className={`w-full h-full bg-gradient-to-br ${accentClass}`} />
                )}
              </div>

              <div className="px-5 pb-5">
                <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-12 relative z-10">
                  <div className="ring-4 ring-white dark:ring-neutral-900 rounded-full w-fit">
                    <Avatar src={targetUser.avatarUrl} name={targetUser.displayName} size="xl" />
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {isMe ? (
                      <>
                        <Link
                          to="/creator-studio"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold transition-colors whitespace-nowrap"
                        >
                          <BarChart3 className="w-3.5 h-3.5" /> Creator Studio
                        </Link>
                        <button
                          type="button"
                          onClick={openEditModal}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap"
                        >
                          <Edit3 className="w-3.5 h-3.5" /> Edit Profile
                        </button>
                        <Link
                          to="/verification"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap"
                        >
                          <ShieldCheck className="w-3.5 h-3.5 text-brand" />
                          {(liveVerifiedTarget ?? targetUser.isVerified) ? 'Verified' : 'Get Verified'}
                        </Link>
                        <Link
                          to="/analytics/videos"
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap"
                        >
                          Video analytics
                        </Link>
                        {totalPendingRequestsCount > 0 && (
                          <button
                            type="button"
                            onClick={() => setConnectionsOpen('requests')}
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-semibold whitespace-nowrap"
                          >
                            <UserPlus className="w-3.5 h-3.5" /> Requests ({totalPendingRequestsCount})
                          </button>
                        )}
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={handleFollowAction}
                          className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                            rel.isFollowing || rel.followRequestStatus === 'sent_pending'
                              ? 'border border-neutral-200 dark:border-neutral-700 text-neutral-800 dark:text-neutral-200'
                              : 'bg-brand hover:bg-brand-hover text-white'
                          }`}
                        >
                          {rel.isFollowing ? (
                            <>
                              <UserCheck className="w-3.5 h-3.5" /> Following
                            </>
                          ) : rel.followRequestStatus === 'sent_pending' ? (
                            <>
                              <Clock className="w-3.5 h-3.5" /> Requested
                            </>
                          ) : (
                            <>
                              <UserPlus className="w-3.5 h-3.5" />{' '}
                              {targetUser.isPrivateAccount || targetUser.whoCanFollow === 'approval'
                                ? 'Request Follow'
                                : 'Follow'}
                            </>
                          )}
                        </button>

                        {rel.friendStatus === 'received_pending' ? (
                          <div className="inline-flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => handleFriendAction('accept')}
                              className="inline-flex items-center gap-1 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold whitespace-nowrap"
                            >
                              <Check className="w-3.5 h-3.5" /> Accept Friend
                            </button>
                            <button
                              type="button"
                              onClick={() => handleFriendAction('decline')}
                              className="px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold whitespace-nowrap"
                            >
                              Decline
                            </button>
                          </div>
                        ) : rel.friendStatus === 'friends' ? (
                          <button
                            type="button"
                            onClick={() => handleFriendAction('unfriend')}
                            title="Click to unfriend"
                            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-rose-50 dark:hover:bg-rose-950/30 hover:text-rose-600 whitespace-nowrap"
                          >
                            <Users className="w-3.5 h-3.5" /> Friends
                          </button>
                        ) : rel.friendStatus === 'sent_pending' ? (
                          <button
                            type="button"
                            onClick={() => handleFriendAction('cancel')}
                            className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:text-red-600 whitespace-nowrap"
                          >
                            Cancel Friend Request
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleFriendAction('send')}
                            className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 whitespace-nowrap"
                          >
                            Add Friend
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={startMessage}
                          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-xs font-semibold whitespace-nowrap"
                        >
                          <MessageSquare className="w-3.5 h-3.5" /> Message
                        </button>

                        <div className="relative">
                          <button
                            type="button"
                            onClick={() => setMoreMenuOpen((v) => !v)}
                            aria-label="More profile options"
                            className="h-9 w-9 rounded-xl border border-neutral-200 dark:border-neutral-800 flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>
                          {moreMenuOpen && (
                            <div className="absolute right-0 mt-1.5 w-52 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-xl py-1 z-30 text-xs">
                              <button
                                type="button"
                                onClick={() => {
                                  navigator.clipboard?.writeText(window.location.href).catch(() => {});
                                  toast.success('Profile link copied.');
                                  setMoreMenuOpen(false);
                                }}
                                className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                              >
                                <Copy className="w-3.5 h-3.5" /> Copy profile link
                              </button>
                              {firebaseUser && (
                                <>
                                  <button
                                    type="button"
                                    onClick={handleToggleRestrict}
                                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                  >
                                    <ShieldAlert className="w-3.5 h-3.5 text-amber-600" />
                                    {rel.isRestrictedByMe ? 'Unrestrict account' : 'Restrict account'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={handleHideCreator}
                                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                                  >
                                    <EyeOff className="w-3.5 h-3.5" />
                                    {isCreatorHidden ? 'Show posts in feed' : 'Mute / Hide posts'}
                                  </button>
                                </>
                              )}
                              <button
                                type="button"
                                onClick={() => {
                                  setMoreMenuOpen(false);
                                  if (!firebaseUser) return openAuthModal('Sign in to report this profile.');
                                  setReportModalOpen(true);
                                }}
                                className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900 text-amber-600"
                              >
                                <Flag className="w-3.5 h-3.5" /> Report profile
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  if (!firebaseUser) return openAuthModal('Sign in to block accounts.');
                                  handleBlock();
                                }}
                                className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                              >
                                <Ban className="w-3.5 h-3.5" /> Block @{targetUser.username}
                              </button>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-4 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="font-display font-extrabold text-xl">{targetUser.displayName}</h1>
                    <LiveVerifiedBadge uid={targetUser.uid} size={17} />
                    {targetUser.isCreator && <CreatorBadge size={15} />}
                    {targetUser.isPrivateAccount && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-500">
                        · <Lock className="w-3 h-3" /> Private
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-500">
                    <span>@{targetUser.username}</span>
                    {targetUser.creatorCategory && (
                      <>
                        <span>·</span>
                        <span className="font-medium text-neutral-700 dark:text-neutral-300">
                          {targetUser.creatorCategory}
                        </span>
                      </>
                    )}
                    {!isMe && rel.followsMe && (
                      <>
                        <span>·</span>
                        <span className="font-medium text-brand">Follows you</span>
                      </>
                    )}
                    {!isMe && mutualFriends.length > 0 && (
                      <>
                        <span>·</span>
                        <button
                          type="button"
                          onClick={() => setConnectionsOpen('mutual')}
                          className="font-semibold text-neutral-700 dark:text-neutral-300 hover:underline"
                        >
                          {mutualFriends.length} mutual friend{mutualFriends.length > 1 ? 's' : ''}
                        </button>
                      </>
                    )}
                  </div>

                  {targetUser.bio && (
                    <p className="text-sm text-neutral-700 dark:text-neutral-300 max-w-2xl leading-relaxed">
                      {targetUser.bio}
                    </p>
                  )}

                  {targetUser.highlights && targetUser.highlights.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                      {targetUser.highlights.map((h) => (
                        <span
                          key={h}
                          className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-600 dark:text-neutral-300 bg-neutral-100 dark:bg-neutral-800 px-2.5 py-0.5 rounded-lg"
                        >
                          <Sparkles className="w-3 h-3 text-brand" /> {h}
                        </span>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-500 pt-1">
                    {showLocationPublic && targetUser.location && (
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5" /> {targetUser.location}
                      </span>
                    )}
                    {showWebsitePublic && targetUser.website && (
                      <a
                        href={targetUser.website.startsWith('http') ? targetUser.website : `https://${targetUser.website}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand dark:text-blue-400 hover:underline"
                      >
                        <LinkIcon className="w-3.5 h-3.5" /> {targetUser.website}
                      </a>
                    )}
                  </div>

                  {/* Clickable Social Stat Counters */}
                  <div className="flex flex-wrap items-center gap-5 pt-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setConnectionsOpen('followers')}
                      className="hover:underline text-left"
                    >
                      <strong className="font-mono tabular-nums text-neutral-950 dark:text-white">
                        {formatCompactNumber(targetUser.followersCount)}
                      </strong>{' '}
                      <span className="text-neutral-500">Followers</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConnectionsOpen('following')}
                      className="hover:underline text-left"
                    >
                      <strong className="font-mono tabular-nums text-neutral-950 dark:text-white">
                        {formatCompactNumber(targetUser.followingCount)}
                      </strong>{' '}
                      <span className="text-neutral-500">Following</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setConnectionsOpen('friends')}
                      className="hover:underline text-left"
                    >
                      <strong className="font-mono tabular-nums text-neutral-950 dark:text-white">
                        {formatCompactNumber(Math.max(targetUser.friendsCount || 0, friendsList.length))}
                      </strong>{' '}
                      <span className="text-neutral-500">Friends</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {!canViewPrivateProfile ? (
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center space-y-2.5">
                <Lock className="w-8 h-8 mx-auto text-neutral-400" />
                <h2 className="font-display font-bold text-base">This account is private</h2>
                <p className="text-xs text-neutral-500 max-w-md mx-auto">
                  Follow or become friends with {targetUser.displayName} to see their posts, Reels, photos, and friends.
                </p>
              </div>
            ) : (
              <>
                {/* Profile Tabs + View Toggle */}
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="inline-flex p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 overflow-x-auto no-scrollbar max-w-full">
                    {(
                      [
                        { id: 'posts', label: `Posts (${orderedPosts.length})` },
                        { id: 'reels', label: `Reels (${reels.length})` },
                        { id: 'photos', label: `Photos (${photoPosts.length})` },
                        { id: 'videos', label: `Videos (${videoPosts.length})` },
                        { id: 'about', label: 'About' },
                        { id: 'friends', label: `Friends (${friendsList.length})` },
                        ...(isMe
                          ? [
                              { id: 'saved' as const, label: `Saved (${savedPosts.length})` },
                              { id: 'analytics' as const, label: 'Analytics' },
                            ]
                          : []),
                      ] as const
                    ).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => setTab(t.id)}
                        className={`px-3.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap ${
                          tab === t.id
                            ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                            : 'text-neutral-500'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>

                  {(tab === 'posts' || tab === 'videos') && (
                    <div className="inline-flex items-center gap-1 p-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900">
                      <button
                        type="button"
                        onClick={() => setPostLayout('list')}
                        aria-label="List view"
                        className={`p-1.5 rounded-lg text-xs ${
                          postLayout === 'list' ? 'bg-neutral-950 text-white dark:bg-white dark:text-black' : 'text-neutral-500'
                        }`}
                      >
                        <List className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setPostLayout('grid')}
                        aria-label="Grid view"
                        className={`p-1.5 rounded-lg text-xs ${
                          postLayout === 'grid' ? 'bg-neutral-950 text-white dark:bg-white dark:text-black' : 'text-neutral-500'
                        }`}
                      >
                        <LayoutGrid className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>

                {/* Tab Content */}
                {tab === 'posts' && (
                  orderedPosts.length === 0 ? (
                    <p className="text-xs text-neutral-500 py-8 text-center">No posts published yet.</p>
                  ) : postLayout === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {orderedPosts.map((p) => (
                        <PostCard
                          key={p.id}
                          post={p}
                          isPinned={targetUser.pinnedPostId === p.id}
                          onTogglePin={isMe ? handleTogglePin : undefined}
                          onDeleted={(id) => setPosts((prev) => prev.filter((item) => item.id !== id))}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {orderedPosts.map((p) => (
                        <PostCard
                          key={p.id}
                          post={p}
                          isPinned={targetUser.pinnedPostId === p.id}
                          onTogglePin={isMe ? handleTogglePin : undefined}
                          onDeleted={(id) => setPosts((prev) => prev.filter((item) => item.id !== id))}
                        />
                      ))}
                    </div>
                  )
                )}

                {tab === 'videos' && (
                  videoPosts.length === 0 ? (
                    <p className="text-xs text-neutral-500 py-8 text-center">No video posts published yet.</p>
                  ) : postLayout === 'grid' ? (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      {videoPosts.map((p) => (
                        <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))} />
                      ))}
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {videoPosts.map((p) => (
                        <PostCard key={p.id} post={p} onDeleted={(id) => setPosts((prev) => prev.filter((x) => x.id !== id))} />
                      ))}
                    </div>
                  )
                )}

                {tab === 'reels' && (
                  <div className="space-y-4">
                    {isMe && (
                      <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => setReelFilter('active')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                reelFilter === 'active'
                                  ? 'bg-brand text-white'
                                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                              }`}
                            >
                              Published ({publishedReels.length})
                            </button>
                            <button
                              type="button"
                              onClick={() => setReelFilter('draft')}
                              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                                reelFilter === 'draft'
                                  ? 'bg-brand text-white'
                                  : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                              }`}
                            >
                              Drafts ({draftReels.length})
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => setReelUploadOpen(true)}
                            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold transition-colors"
                          >
                            <Plus className="w-3.5 h-3.5" /> Upload Reel
                          </button>
                        </div>

                        {/* Verified Creator Reels Statistics */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-xs">
                          <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-2.5">
                            <p className="text-[11px] text-neutral-500">Total Views</p>
                            <p className="font-mono font-bold text-sm tabular-nums">{formatCompactNumber(totalReelViews)}</p>
                          </div>
                          <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-2.5">
                            <p className="text-[11px] text-neutral-500">Likes</p>
                            <p className="font-mono font-bold text-sm tabular-nums">{formatCompactNumber(totalReelLikes)}</p>
                          </div>
                          <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-2.5">
                            <p className="text-[11px] text-neutral-500">Comments</p>
                            <p className="font-mono font-bold text-sm tabular-nums">{formatCompactNumber(totalReelComments)}</p>
                          </div>
                          <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-2.5">
                            <p className="text-[11px] text-neutral-500">Shares</p>
                            <p className="font-mono font-bold text-sm tabular-nums">{formatCompactNumber(totalReelShares)}</p>
                          </div>
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {displayedReels.length === 0 ? (
                        <p className="col-span-full text-xs text-neutral-500 py-8 text-center">
                          {isMe && reelFilter === 'draft' ? 'No draft Reels saved.' : 'No Reels uploaded yet.'}
                        </p>
                      ) : (
                        displayedReels.map((r) => (
                          <div
                            key={r.id}
                            className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 flex flex-col"
                          >
                            <button
                              type="button"
                              onClick={() =>
                                r.status === 'active' ? navigate(`/reels?reel=${r.id}`) : openEditReelModal(r)
                              }
                              className="aspect-[9/16] bg-black relative group w-full overflow-hidden"
                            >
                              <video
                                src={r.videoUrl}
                                poster={r.thumbnailUrl || undefined}
                                muted
                                preload="metadata"
                                className="w-full h-full object-cover"
                              />
                              <div className="absolute top-2 left-2 flex items-center gap-1">
                                {r.status === 'draft' && (
                                  <span className="px-2 py-0.5 rounded bg-amber-500 text-white text-[10px] font-bold uppercase">
                                    Draft
                                  </span>
                                )}
                                {r.status === 'removed' && (
                                  <span className="px-2 py-0.5 rounded bg-rose-600 text-white text-[10px] font-bold uppercase">
                                    Removed
                                  </span>
                                )}
                                {r.durationSeconds ? (
                                  <span className="px-1.5 py-0.5 rounded bg-black/70 text-white text-[10px] font-mono tabular-nums">
                                    {formatDurationClock(r.durationSeconds)}
                                  </span>
                                ) : null}
                              </div>
                              <div className="absolute inset-x-0 bottom-0 p-2.5 bg-gradient-to-t from-black/85 via-black/40 to-transparent text-white text-left space-y-0.5">
                                {r.title && <p className="text-xs font-semibold truncate">{r.title}</p>}
                                <div className="flex items-center gap-2 text-[11px] font-mono tabular-nums text-white/90">
                                  <span className="inline-flex items-center gap-1">
                                    <Eye className="w-3 h-3" /> {formatCompactNumber(r.viewsCount)}
                                  </span>
                                  <span className="inline-flex items-center gap-1">
                                    <Heart className="w-3 h-3" /> {formatCompactNumber(r.likesCount)}
                                  </span>
                                </div>
                              </div>
                            </button>

                            {isMe && (
                              <div className="p-2 flex items-center justify-between gap-1 text-[11px] border-t border-neutral-100 dark:border-neutral-800">
                                <span className="text-neutral-500 capitalize truncate">{r.visibility}</span>
                                <div className="flex items-center gap-1 shrink-0">
                                  {r.status === 'draft' && (
                                    <button
                                      type="button"
                                      onClick={() => handlePublishDraftReel(r)}
                                      title="Publish Draft"
                                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-brand text-white font-semibold"
                                    >
                                      <Send className="w-3 h-3" /> Publish
                                    </button>
                                  )}
                                  {r.status !== 'removed' && (
                                    <button
                                      type="button"
                                      onClick={() => openEditReelModal(r)}
                                      aria-label="Edit video details"
                                      className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-300"
                                    >
                                      <Pencil className="w-3.5 h-3.5" />
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    onClick={() => setDeleteReelTarget(r)}
                                    aria-label="Delete video"
                                    className="p-1.5 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-600"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                )}

                {tab === 'photos' && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                    {photoPosts.length === 0 ? (
                      <p className="col-span-full text-xs text-neutral-500 py-8 text-center">No photos shared yet.</p>
                    ) : (
                      photoPosts.map((p) => (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setPhotoPreviewUrl(p.mediaUrls?.[0] || null)}
                          className="aspect-square rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800 block"
                        >
                          <ResilientImage
                            src={p.mediaUrls?.[0]}
                            alt={p.content || 'Photo'}
                            className="w-full h-full object-cover hover:scale-105 transition-transform duration-200"
                          />
                        </button>
                      ))
                    )}
                  </div>
                )}

                {tab === 'about' && (
                  <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4 text-xs">
                    <div>
                      <h2 className="font-display font-bold text-sm mb-1">About {targetUser.displayName}</h2>
                      <p className="text-neutral-600 dark:text-neutral-300 leading-relaxed">
                        {targetUser.bio || 'No bio added yet.'}
                      </p>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                      <div>
                        <span className="text-neutral-500 block">Username</span>
                        <span className="font-mono font-semibold">@{targetUser.username}</span>
                      </div>
                      {targetUser.creatorCategory && (
                        <div>
                          <span className="text-neutral-500 block">Category</span>
                          <span className="font-semibold">{targetUser.creatorCategory}</span>
                        </div>
                      )}
                      {showLocationPublic && targetUser.location && (
                        <div>
                          <span className="text-neutral-500 block">Location</span>
                          <span className="font-semibold">{targetUser.location}</span>
                        </div>
                      )}
                      {showWebsitePublic && targetUser.website && (
                        <div>
                          <span className="text-neutral-500 block">Website</span>
                          <a
                            href={targetUser.website.startsWith('http') ? targetUser.website : `https://${targetUser.website}`}
                            target="_blank"
                            rel="noreferrer"
                            className="font-semibold text-brand hover:underline"
                          >
                            {targetUser.website}
                          </a>
                        </div>
                      )}
                      <div>
                        <span className="text-neutral-500 block">Account Status</span>
                        <span className="font-semibold">
                          {(liveVerifiedTarget ?? targetUser.isVerified) ? `Verified (${targetUser.verificationType || 'identity'})` : 'Standard Member'}
                          {targetUser.isPrivateAccount ? ' · Private Account' : ' · Public Account'}
                        </span>
                      </div>
                      {targetUser.interests && targetUser.interests.length > 0 && (
                        <div className="sm:col-span-2">
                          <span className="text-neutral-500 block mb-1.5">Interests</span>
                          <div className="flex flex-wrap gap-1.5">
                            {targetUser.interests.map((i) => (
                              <span key={i} className="px-2.5 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-800 font-medium">
                                {i}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {tab === 'friends' && (
                  <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
                    {!canViewFriendsList ? (
                      <div className="py-8 text-center space-y-2">
                        <Lock className="w-6 h-6 mx-auto text-neutral-400" />
                        <p className="text-xs text-neutral-500">
                          Friends list visibility is restricted by {targetUser.displayName}.
                        </p>
                      </div>
                    ) : friendsList.length === 0 ? (
                      <p className="text-xs text-neutral-500 py-8 text-center">No friends connected yet.</p>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {friendsList.map((f) => (
                          <div
                            key={f.uid}
                            className="flex items-center justify-between gap-2 p-2.5 rounded-xl border border-neutral-200 dark:border-neutral-800"
                          >
                            <Link to={`/profile/${f.username}`} className="flex items-center gap-2.5 min-w-0">
                              <Avatar src={f.avatarUrl} name={f.displayName} size="sm" />
                              <div className="min-w-0">
                                <p className="text-xs font-bold truncate inline-flex items-center gap-1">
                                  <span className="truncate">{f.displayName}</span>
                                  <LiveVerifiedBadge uid={f.uid} size={12} />
                                </p>
                                <p className="text-[11px] text-neutral-500 truncate">@{f.username}</p>
                              </div>
                            </Link>
                            {isMe && (
                              <button
                                type="button"
                                onClick={async () => {
                                  if (!firebaseUser) return;
                                  await unfriendUser(firebaseUser.uid, f.uid);
                                  setFriendsList((prev) => prev.filter((x) => x.uid !== f.uid));
                                  toast.info(`Removed @${f.username} from friends.`);
                                }}
                                className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-600 hover:text-red-600 shrink-0"
                              >
                                Unfriend
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                {tab === 'saved' && isMe && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                      <p className="text-xs text-neutral-500">
                        Showing recent saved posts ({savedPosts.length})
                      </p>
                      <Link
                        to="/saved"
                        className="text-xs font-semibold text-brand hover:underline"
                      >
                        Open Full Saved Library →
                      </Link>
                    </div>
                    {savedPosts.length === 0 ? (
                      <p className="text-xs text-neutral-500 py-8 text-center">
                        No saved posts yet.{' '}
                        <Link to="/saved" className="text-brand font-semibold hover:underline">
                          Check Saved Videos & Reels
                        </Link>
                      </p>
                    ) : (
                      savedPosts.map((p) => (
                        <PostCard
                          key={p.id}
                          post={p}
                          onUnsaved={(id) => setSavedPosts((prev) => prev.filter((item) => item.id !== id))}
                        />
                      ))
                    )}
                  </div>
                )}

                {tab === 'analytics' && isMe && (
                  <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
                    <div>
                      <h2 className="font-display font-bold text-base">Personal Profile Analytics</h2>
                      <p className="text-xs text-neutral-500">
                        Private owner-only engagement and daily deduplicated visit counts.
                      </p>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Profile Visits (7d)</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(profileVisits7d)}</p>
                      </div>
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Profile Visits (30d)</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(profileVisits30d)}</p>
                      </div>
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Followers</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(targetUser.followersCount)}</p>
                      </div>
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Friends</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(Math.max(targetUser.friendsCount || 0, friendsList.length))}</p>
                      </div>
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Post Reactions</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(totalPostLikes)}</p>
                      </div>
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Post Comments</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(totalPostComments)}</p>
                      </div>
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Post Shares</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(totalPostShares)}</p>
                      </div>
                      <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-950 p-3">
                        <p className="text-neutral-500">Reel Views</p>
                        <p className="font-mono font-bold text-lg tabular-nums mt-0.5">{formatCompactNumber(totalReelViews)}</p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Connections / Mutual Friends / Pending Requests Modal */}
      {connectionsOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
              <h2 className="font-display font-bold text-base capitalize">
                {connectionsOpen === 'requests' ? 'Pending Requests' : connectionsOpen}
              </h2>
              <button type="button" onClick={() => setConnectionsOpen(null)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
              {(
                [
                  { id: 'followers', label: `Followers (${followersList.length})` },
                  { id: 'following', label: `Following (${followingList.length})` },
                  { id: 'friends', label: `Friends (${friendsList.length})` },
                  ...(!isMe && mutualFriends.length > 0 ? [{ id: 'mutual' as const, label: `Mutual (${mutualFriends.length})` }] : []),
                  ...(isMe ? [{ id: 'requests' as const, label: `Requests (${totalPendingRequestsCount})` }] : []),
                ] as Array<{ id: ConnectionsTab; label: string }>
              ).map((cTab) => (
                <button
                  key={cTab.id}
                  type="button"
                  onClick={() => setConnectionsOpen(cTab.id)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold whitespace-nowrap ${
                    connectionsOpen === cTab.id
                      ? 'bg-brand text-white'
                      : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-300'
                  }`}
                >
                  {cTab.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto space-y-2.5">
              {connectionsLoading ? (
                <p className="text-xs text-neutral-500 text-center py-6">Loading...</p>
              ) : connectionsOpen === 'followers' ? (
                !canViewFollowersList ? (
                  <p className="text-xs text-neutral-500 text-center py-6">Followers list is private.</p>
                ) : followersList.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-6">No followers yet.</p>
                ) : (
                  followersList.map((u) => (
                    <div key={u.uid} className="flex items-center justify-between gap-2 text-xs py-1">
                      <Link
                        to={`/profile/${u.username}`}
                        onClick={() => setConnectionsOpen(null)}
                        className="flex items-center gap-2.5 min-w-0"
                      >
                        <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold truncate inline-flex items-center gap-1">
                            <span className="truncate">{u.displayName}</span>
                            <LiveVerifiedBadge uid={u.uid} size={12} />
                          </p>
                          <p className="text-[11px] text-neutral-500 truncate">@{u.username}</p>
                        </div>
                      </Link>
                      {isMe && firebaseUser && (
                        <button
                          type="button"
                          onClick={async () => {
                            await removeFollower(firebaseUser.uid, u.uid);
                            setFollowersList((prev) => prev.filter((x) => x.uid !== u.uid));
                            toast.info(`Removed @${u.username} from followers.`);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-600 hover:text-red-600 shrink-0"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  ))
                )
              ) : connectionsOpen === 'following' ? (
                !canViewFollowersList ? (
                  <p className="text-xs text-neutral-500 text-center py-6">Following list is private.</p>
                ) : followingList.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-6">Not following anyone yet.</p>
                ) : (
                  followingList.map((u) => (
                    <div key={u.uid} className="flex items-center justify-between gap-2 text-xs py-1">
                      <Link
                        to={`/profile/${u.username}`}
                        onClick={() => setConnectionsOpen(null)}
                        className="flex items-center gap-2.5 min-w-0"
                      >
                        <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold truncate inline-flex items-center gap-1">
                            <span className="truncate">{u.displayName}</span>
                            <LiveVerifiedBadge uid={u.uid} size={12} />
                          </p>
                          <p className="text-[11px] text-neutral-500 truncate">@{u.username}</p>
                        </div>
                      </Link>
                      {isMe && firebaseUser && (
                        <button
                          type="button"
                          onClick={async () => {
                            await unfollowUser(firebaseUser.uid, u.uid);
                            setFollowingList((prev) => prev.filter((x) => x.uid !== u.uid));
                            toast.info(`Unfollowed @${u.username}.`);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold shrink-0"
                        >
                          Unfollow
                        </button>
                      )}
                    </div>
                  ))
                )
              ) : connectionsOpen === 'friends' ? (
                !canViewFriendsList ? (
                  <p className="text-xs text-neutral-500 text-center py-6">Friends list is private.</p>
                ) : friendsList.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-6">No friends yet.</p>
                ) : (
                  friendsList.map((u) => (
                    <div key={u.uid} className="flex items-center justify-between gap-2 text-xs py-1">
                      <Link
                        to={`/profile/${u.username}`}
                        onClick={() => setConnectionsOpen(null)}
                        className="flex items-center gap-2.5 min-w-0"
                      >
                        <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                        <div className="min-w-0">
                          <p className="font-semibold truncate">{u.displayName}</p>
                          <p className="text-[11px] text-neutral-500 truncate">@{u.username}</p>
                        </div>
                      </Link>
                      {isMe && firebaseUser && (
                        <button
                          type="button"
                          onClick={async () => {
                            await unfriendUser(firebaseUser.uid, u.uid);
                            setFriendsList((prev) => prev.filter((x) => x.uid !== u.uid));
                            toast.info(`Unfriended @${u.username}.`);
                          }}
                          className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[11px] font-semibold text-neutral-600 hover:text-red-600 shrink-0"
                        >
                          <UserMinus className="w-3 h-3 inline mr-1" />Unfriend
                        </button>
                      )}
                    </div>
                  ))
                )
              ) : connectionsOpen === 'mutual' ? (
                mutualFriends.map((u) => (
                  <Link
                    key={u.uid}
                    to={`/profile/${u.username}`}
                    onClick={() => setConnectionsOpen(null)}
                    className="flex items-center gap-2.5 text-xs py-1"
                  >
                    <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{u.displayName}</p>
                      <p className="text-[11px] text-neutral-500 truncate">@{u.username}</p>
                    </div>
                  </Link>
                ))
              ) : (
                <div className="space-y-4 text-xs">
                  {pendingRequests.incomingFollows.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        Follow Requests ({pendingRequests.incomingFollows.length})
                      </p>
                      {pendingRequests.incomingFollows.map(({ req, user }) => (
                        <div key={req.id} className="flex items-center justify-between gap-2">
                          <Link
                            to={`/profile/${user.username}`}
                            onClick={() => setConnectionsOpen(null)}
                            className="flex items-center gap-2 min-w-0"
                          >
                            <Avatar src={user.avatarUrl} name={user.displayName} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{user.displayName}</p>
                              <p className="text-[11px] text-neutral-500 truncate">@{user.username}</p>
                            </div>
                          </Link>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!myProfile) return;
                                await acceptFollowRequest(myProfile, user.uid);
                                setPendingRequests((p) => ({
                                  ...p,
                                  incomingFollows: p.incomingFollows.filter((x) => x.req.id !== req.id),
                                }));
                                toast.success(`Accepted @${user.username}.`);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-brand text-white font-semibold"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!firebaseUser) return;
                                await declineFollowRequest(firebaseUser.uid, user.uid);
                                setPendingRequests((p) => ({
                                  ...p,
                                  incomingFollows: p.incomingFollows.filter((x) => x.req.id !== req.id),
                                }));
                              }}
                              className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {pendingRequests.incomingFriends.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        Friend Requests ({pendingRequests.incomingFriends.length})
                      </p>
                      {pendingRequests.incomingFriends.map(({ req, user }) => (
                        <div key={req.id} className="flex items-center justify-between gap-2">
                          <Link
                            to={`/profile/${user.username}`}
                            onClick={() => setConnectionsOpen(null)}
                            className="flex items-center gap-2 min-w-0"
                          >
                            <Avatar src={user.avatarUrl} name={user.displayName} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{user.displayName}</p>
                              <p className="text-[11px] text-neutral-500 truncate">@{user.username}</p>
                            </div>
                          </Link>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={async () => {
                                if (!myProfile) return;
                                await acceptFriendRequest(myProfile, user.uid);
                                setPendingRequests((p) => ({
                                  ...p,
                                  incomingFriends: p.incomingFriends.filter((x) => x.req.id !== req.id),
                                }));
                                toast.success(`You and @${user.username} are now friends!`);
                              }}
                              className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold"
                            >
                              Accept
                            </button>
                            <button
                              type="button"
                              onClick={async () => {
                                if (!firebaseUser) return;
                                await declineFriendRequest(firebaseUser.uid, user.uid);
                                setPendingRequests((p) => ({
                                  ...p,
                                  incomingFriends: p.incomingFriends.filter((x) => x.req.id !== req.id),
                                }));
                              }}
                              className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                            >
                              Decline
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {pendingRequests.sentFriends.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                        Sent Friend Requests ({pendingRequests.sentFriends.length})
                      </p>
                      {pendingRequests.sentFriends.map(({ req, user }) => (
                        <div key={req.id} className="flex items-center justify-between gap-2">
                          <Link
                            to={`/profile/${user.username}`}
                            onClick={() => setConnectionsOpen(null)}
                            className="flex items-center gap-2 min-w-0"
                          >
                            <Avatar src={user.avatarUrl} name={user.displayName} size="sm" />
                            <div className="min-w-0">
                              <p className="font-semibold truncate">{user.displayName}</p>
                              <p className="text-[11px] text-neutral-500 truncate">@{user.username}</p>
                            </div>
                          </Link>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!firebaseUser) return;
                              await cancelFriendRequest(firebaseUser.uid, user.uid);
                              setPendingRequests((p) => ({
                                ...p,
                                sentFriends: p.sentFriends.filter((x) => x.req.id !== req.id),
                              }));
                            }}
                            className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700"
                          >
                            Cancel
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {pendingRequests.incomingFollows.length === 0 &&
                    pendingRequests.incomingFriends.length === 0 &&
                    pendingRequests.sentFriends.length === 0 && (
                      <p className="text-neutral-500 text-center py-6">No pending requests.</p>
                    )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Photo Preview Lightbox */}
      {photoPreviewUrl && (
        <div
          className="fixed inset-0 z-50 bg-black/85 flex items-center justify-center p-4"
          onClick={() => setPhotoPreviewUrl(null)}
        >
          <button
            type="button"
            onClick={() => setPhotoPreviewUrl(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 text-white flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
          <img loading="lazy"
            src={photoPreviewUrl}
            alt="Preview"
            className="max-h-[90vh] max-w-full rounded-xl object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

      {/* Report Profile Modal */}
      {reportModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <form
            onSubmit={handleReportSubmit}
            className="w-full max-w-sm rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-3"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base">Report @{targetUser.username}</h2>
              <button type="button" onClick={() => setReportModalOpen(false)}>
                <X className="w-4 h-4" />
              </button>
            </div>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
            >
              <option value="Harassment or impersonation">Harassment or impersonation</option>
              <option value="Spam or fake account">Spam or fake account</option>
              <option value="Inappropriate content">Inappropriate content</option>
              <option value="Scam or fraud">Scam or fraud</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportModalOpen(false)}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold"
              >
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit Profile Modal (Enhanced with previews, upload progress, layout, accent, highlights) */}
      {editOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <form
            onSubmit={saveEditProfile}
            className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-3.5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg">Edit Profile</h2>
              <button type="button" onClick={() => setEditOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            {error && <p className="text-xs text-red-600">{error}</p>}

            {/* Live Avatar & Cover Preview */}
            <div className="rounded-xl overflow-hidden border border-neutral-200 dark:border-neutral-800">
              <div className="h-24 bg-neutral-100 dark:bg-neutral-900 relative">
                {coverPreview || targetUser.coverUrl ? (
                  <img loading="lazy" src={coverPreview || targetUser.coverUrl} alt="Cover preview" className="w-full h-full object-cover" />
                ) : (
                  <div className={`w-full h-full bg-gradient-to-br ${ACCENT_COVERS[editAccent]}`} />
                )}
              </div>
              <div className="px-4 pb-3 -mt-7 flex items-end gap-3">
                <div className="w-14 h-14 rounded-full overflow-hidden ring-4 ring-white dark:ring-neutral-950 bg-neutral-200 dark:bg-neutral-800 flex items-center justify-center font-bold">
                  {avatarPreview || targetUser.avatarUrl ? (
                    <img loading="lazy" src={avatarPreview || targetUser.avatarUrl} alt="Avatar preview" className="w-full h-full object-cover" />
                  ) : (
                    editName[0]?.toUpperCase() || 'B'
                  )}
                </div>
                <div className="grid grid-cols-2 gap-2 flex-1 pt-8 text-[11px]">
                  <label className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-center cursor-pointer font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-900">
                    Change Photo
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFilePick('avatar', e.target.files?.[0] || null)} />
                  </label>
                  <label className="px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-center cursor-pointer font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-900">
                    Change Cover
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => handleFilePick('cover', e.target.files?.[0] || null)} />
                  </label>
                </div>
              </div>
            </div>

            {uploadProgress !== null && (
              <div>
                <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                  <div className="h-full bg-brand transition-all" style={{ width: `${uploadProgress}%` }} />
                </div>
                <p className="text-[11px] text-neutral-500 mt-1">Uploading photo... {uploadProgress}%</p>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <span className="text-[11px] text-neutral-500">Display Name</span>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  placeholder="Display Name"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
                />
              </div>
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[11px]">
                  <span className="text-neutral-500">Username</span>
                  {editUsernameOk === true && <span className="text-emerald-600 font-semibold">Available</span>}
                  {editUsernameOk === false && <span className="text-red-600 font-semibold">Taken / Invalid</span>}
                </div>
                <input
                  type="text"
                  required
                  value={editUsername}
                  onChange={(e) => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                  placeholder="username"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
                />
              </div>
            </div>

            <textarea
              rows={3}
              value={editBio}
              onChange={(e) => setEditBio(e.target.value)}
              placeholder="Bio"
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-sm"
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <input
                type="text"
                value={editLocation}
                onChange={(e) => setEditLocation(e.target.value)}
                placeholder="Location (e.g. Dhaka, Bangladesh)"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
              />
              <input
                type="text"
                value={editWebsite}
                onChange={(e) => setEditWebsite(e.target.value)}
                placeholder="Website URL"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">Creator / Role Category</label>
                <input
                  type="text"
                  value={editCategory}
                  onChange={(e) => setEditCategory(e.target.value)}
                  placeholder="e.g. Software Engineer, Filmmaker"
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3"
                />
              </div>
              <div>
                <label className="block text-[11px] text-neutral-500 mb-1">Default Feed Layout</label>
                <select
                  value={editLayout}
                  onChange={(e) => setEditLayout(e.target.value as 'list' | 'grid')}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3"
                >
                  <option value="list">Classic List</option>
                  <option value="grid">Two-Column Grid</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-[11px] text-neutral-500 mb-1">Profile Highlights (comma-separated)</label>
              <input
                type="text"
                value={editHighlights}
                onChange={(e) => setEditHighlights(e.target.value)}
                placeholder="e.g. Photographer, Dhaka Community Lead, Open Source"
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
              />
            </div>

            <div>
              <label className="block text-[11px] text-neutral-500 mb-1.5">Header Accent Theme</label>
              <div className="flex items-center gap-2">
                {(['blue', 'slate', 'emerald', 'amber', 'rose'] as ProfileAccent[]).map((acc) => (
                  <button
                    key={acc}
                    type="button"
                    onClick={() => setEditAccent(acc)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize border ${
                      editAccent === acc
                        ? 'border-brand bg-brand/10 text-brand'
                        : 'border-neutral-200 dark:border-neutral-800'
                    }`}
                  >
                    {acc}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              disabled={saving}
              className="w-full h-10 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold transition-colors"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
          </form>
        </div>
      )}

      {/* Edit Creator Video Details Modal */}
      {editingReel && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveReelEdit}
            className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-3.5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base">Edit Reel Details</h2>
              <button type="button" onClick={() => setEditingReel(null)} aria-label="Close edit modal">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-neutral-500">Title</label>
              <input
                type="text"
                maxLength={120}
                value={reelTitleInput}
                onChange={(e) => setReelTitleInput(e.target.value)}
                placeholder="Video title"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-neutral-500">Caption</label>
              <textarea
                rows={2}
                maxLength={2000}
                value={reelCaptionInput}
                onChange={(e) => setReelCaptionInput(e.target.value)}
                placeholder="Write a caption..."
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-neutral-500">Description</label>
              <textarea
                rows={2}
                maxLength={2000}
                value={reelDescInput}
                onChange={(e) => setReelDescInput(e.target.value)}
                placeholder="Detailed description or links..."
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-neutral-500">Sound Credit</label>
                <input
                  type="text"
                  value={reelSoundInput}
                  onChange={(e) => setReelSoundInput(e.target.value)}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-neutral-500">Category</label>
                <select
                  value={reelCatInput}
                  onChange={(e) => setReelCatInput(e.target.value as DiscoveryCategory)}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-2.5 text-xs"
                >
                  {DISCOVERY_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="space-y-1">
              <label className="block text-[11px] font-medium text-neutral-500">Hashtags</label>
              <input
                type="text"
                value={reelTagsInput}
                onChange={(e) => setReelTagsInput(e.target.value)}
                placeholder="#bangladesh, #creator"
                className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5">
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-neutral-500">Audience</label>
                <select
                  value={reelVisInput}
                  onChange={(e) => setReelVisInput(e.target.value as any)}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-2.5 text-xs"
                >
                  <option value="public">Public</option>
                  <option value="followers">Followers Only</option>
                  <option value="only_me">Private (Only me)</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="block text-[11px] font-medium text-neutral-500">Status</label>
                <select
                  value={reelStatusInput}
                  onChange={(e) => setReelStatusInput(e.target.value as 'active' | 'draft')}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-2.5 text-xs"
                >
                  <option value="active">Published</option>
                  <option value="draft">Draft</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingReel(null)}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-medium"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={savingReelEdit}
                className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-60"
              >
                {savingReelEdit ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      )}


      <ReelUploadModal
        isOpen={reelUploadOpen}
        onClose={() => setReelUploadOpen(false)}
        onUploaded={loadProfileData}
      />

      <ConfirmDialog
        isOpen={Boolean(deleteReelTarget)}
        title="Delete Video"
        description="Permanently delete this Reel and remove it from BANA Reels? This cannot be undone."
        confirmLabel="Delete Video"
        variant="danger"
        loading={deletingReel}
        onConfirm={handleConfirmDeleteReel}
        onCancel={() => {
          if (!deletingReel) setDeleteReelTarget(null);
        }}
      />
    </AppShell>
  );
}
