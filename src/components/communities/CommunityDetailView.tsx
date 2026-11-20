import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Calendar,
  Check,
  Flag,
  Globe,
  Heart,
  Image as ImageIcon,
  Lock,
  MapPin,
  Megaphone,
  MessageSquare,
  Pin,
  Plus,
  Send,
  Shield,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserPlus,
  Users,
  Video,
  X,
} from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { getDocsWithIndexFallback, toMillis } from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  BANGLADESH_DISTRICTS,
  DISCOVERY_CATEGORIES,
  type BanaCommunity,
  type BanaEvent,
  type BanaUser,
  type CommunityMemberRecord,
  type CommunityPostComment,
  type CommunityPostItem,
  type CommunityRequest,
  type CommunityRole,
  type DiscoveryCategory,
} from '@/src/types/bana';
import {
  addCommunityPostComment,
  createCommunityPost,
  fetchCommunityMembers,
  fetchCommunityPostComments,
  fetchCommunityPosts,
  fetchCommunityRequests,
  inviteUserToCommunity,
  isAdminRole,
  isStaffRole,
  joinOrLeaveCommunity,
  removeCommunityMember,
  respondToJoinRequest,
  setEventRsvpStatus,
  toggleCommunityPostLike,
  updateCommunityMemberRoleOrStatus,
  voteCommunityPoll,
} from '@/src/lib/communities';
import { CommunityReportDialog } from '@/src/components/communities/CommunityReportDialog';
import { compressImageFile, formatRelativeTime, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { Avatar, ResilientImage } from '@/src/components/common/Avatar';
import { GroupChatPanel } from '@/src/components/communities/GroupChatPanel';
import defaultCommunityCover from '@/src/assets/images/bana_community_cover_1794590889543.jpg';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';

interface CommunityDetailViewProps {
  community: BanaCommunity;
  onBack: () => void;
  onCommunityUpdated: (updated: BanaCommunity) => void;
}

export function CommunityDetailView({
  community,
  onBack,
  onCommunityUpdated,
}: CommunityDetailViewProps) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [subTab, setSubTab] = useState<'feed' | 'chat' | 'events' | 'members'>('feed');
  const [members, setMembers] = useState<CommunityMemberRecord[]>([]);
  const [requests, setRequests] = useState<CommunityRequest[]>([]);
  const [posts, setPosts] = useState<CommunityPostItem[]>([]);
  const [events, setEvents] = useState<BanaEvent[]>([]);
  const [rsvpMap, setRsvpMap] = useState<Record<string, 'going' | 'interested'>>({});
  const [loading, setLoading] = useState(true);
  const [reportTarget, setReportTarget] = useState<{ type: 'community' | 'community_post'; id: string; title: string } | null>(null);

  // Composer state
  const [postKind, setPostKind] = useState<'post' | 'announcement' | 'poll'>('post');
  const [postContent, setPostContent] = useState('');
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [pollQuestion, setPollQuestion] = useState('');
  const [pollOptionsRaw, setPollOptionsRaw] = useState('Yes\nNo');
  const [posting, setPosting] = useState(false);

  // Comments drawer per post
  const [openCommentsPostId, setOpenCommentsPostId] = useState<string | null>(null);
  const [commentsByPost, setCommentsByPost] = useState<Record<string, CommunityPostComment[]>>({});
  const [commentInput, setCommentInput] = useState('');
  const [replyTarget, setReplyTarget] = useState<CommunityPostComment | null>(null);

  // Invite modal
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteSearch, setInviteSearch] = useState('');
  const [inviteResults, setInviteResults] = useState<BanaUser[]>([]);

  // Event creation modal inside community
  const [eventOpen, setEventOpen] = useState(false);
  const [evTitle, setEvTitle] = useState('');
  const [evDesc, setEvDesc] = useState('');
  const [evDate, setEvDate] = useState('');
  const [evTime, setEvTime] = useState('17:00');
  const [evVenue, setEvVenue] = useState('');
  const [evDistrict, setEvDistrict] = useState(community.district || 'Dhaka');
  const [evCategory, setEvCategory] = useState<DiscoveryCategory>('News & Community');
  const [evIsOnline, setEvIsOnline] = useState(false);
  const [evOnlineUrl, setEvOnlineUrl] = useState('');
  const [evCapacity, setEvCapacity] = useState('150');
  const [evCoverFile, setEvCoverFile] = useState<File | null>(null);
  const [savingEvent, setSavingEvent] = useState(false);

  // Community settings edit (staff)
  const [rulesEdit, setRulesEdit] = useState((community.rules || []).join('\n'));
  const [descEdit, setDescEdit] = useState(community.description);
  const [privacyEdit, setPrivacyEdit] = useState<'public' | 'private'>(community.privacy);
  const [approvalEdit, setApprovalEdit] = useState(Boolean(community.requiresApproval));

  const myMemberRecord = firebaseUser
    ? members.find((m) => m.userId === firebaseUser.uid) || null
    : null;
  const isCreator = Boolean(firebaseUser && community.creatorId === firebaseUser.uid);
  const myRole: CommunityRole = isCreator ? 'owner' : myMemberRecord?.role || 'member';
  const isActiveMember = Boolean(isCreator || myMemberRecord?.status === 'active');
  const isRestricted = myMemberRecord?.status === 'restricted';
  const canModerate = isStaffRole(myRole, isCreator);
  const canAdminister = isAdminRole(myRole, isCreator);
  const canViewContent = community.privacy === 'public' || isActiveMember;

  const loadWorkspace = async () => {
    setLoading(true);
    try {
      const memList = await fetchCommunityMembers(community.id);
      setMembers(memList);

      const userActive = Boolean(
        firebaseUser &&
          (community.creatorId === firebaseUser.uid ||
            memList.some((m) => m.userId === firebaseUser.uid && m.status === 'active'))
      );

      if (community.privacy === 'public' || userActive) {
        const postList = await fetchCommunityPosts(community.id).catch(() => []);
        setPosts(postList);
      } else {
        setPosts([]);
      }

      if (firebaseUser) {
        const me = memList.find((m) => m.userId === firebaseUser.uid);
        if (isStaffRole(me?.role, community.creatorId === firebaseUser.uid)) {
          const reqs = await fetchCommunityRequests(community.id);
          setRequests(reqs);
        }
        const regSnap = await getDocs(
          query(collection(db, 'eventRegistrations'), where('userId', '==', firebaseUser.uid))
        ).catch(() => null);
        if (regSnap) {
          const map: Record<string, 'going' | 'interested'> = {};
          regSnap.docs.forEach((d) => {
            const data = d.data();
            map[String(data.eventId)] = data.rsvpStatus === 'interested' ? 'interested' : 'going';
          });
          setRsvpMap(map);
        }
      }

      const evRes = await getDocsWithIndexFallback<BanaEvent>(
        query(
          collection(db, 'events'),
          where('communityId', '==', community.id),
          orderBy('eventDate', 'asc'),
          limit(30)
        ),
        query(collection(db, 'events'), where('communityId', '==', community.id), limit(40)),
        (a, b) => toMillis(a.eventDate) - toMillis(b.eventDate)
      ).catch(() => null);
      if (evRes) {
        setEvents(evRes.items.slice(0, 30));
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [community.id, firebaseUser?.uid]);

  const handleJoinLeave = async () => {
    if (!firebaseUser || !profile) {
      openAuthModal(`Sign in to join ${community.name}.`);
      return;
    }
    try {
      const result = await joinOrLeaveCommunity({
        community,
        user: profile,
        existingMembership: myMemberRecord,
      });
      toast.success(
        result === 'joined'
          ? `Welcome to ${community.name}!`
          : result === 'requested'
          ? 'Join request sent to community admins.'
          : 'You left this community.'
      );
      const delta = result === 'joined' ? 1 : result === 'left' && myMemberRecord?.status === 'active' ? -1 : 0;
      onCommunityUpdated({ ...community, membersCount: Math.max(1, community.membersCount + delta) });
      loadWorkspace();
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    }
  };

  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    if (isRestricted) {
      toast.error('Your account is restricted from posting in this group.');
      return;
    }
    if (!postContent.trim() && !mediaFile && postKind !== 'poll') return;

    setPosting(true);
    try {
      let mediaUrls: string[] = [];
      let mediaType: 'image' | 'video' | 'none' = 'none';
      if (mediaFile) {
        if (mediaFile.type.startsWith('video/')) {
          const url = await uploadMediaWithProgress(
            `communities/${firebaseUser.uid}/vid_${Date.now()}_${mediaFile.name}`,
            mediaFile
          );
          mediaUrls = [url];
          mediaType = 'video';
        } else {
          const comp = await compressImageFile(mediaFile, 1600);
          const url = await uploadMediaWithProgress(
            `communities/${firebaseUser.uid}/img_${Date.now()}_${comp.name}`,
            comp
          );
          mediaUrls = [url];
          mediaType = 'image';
        }
      }

      const created = await createCommunityPost({
        communityId: community.id,
        author: profile,
        authorRole: myRole,
        kind: canModerate ? postKind : postKind === 'announcement' ? 'post' : postKind,
        content: postContent || pollQuestion,
        mediaUrls,
        mediaType,
        pollQuestion,
        pollOptions: pollOptionsRaw.split('\n').filter(Boolean),
      });
      setPosts((prev) => [created, ...prev]);
      if (created.kind === 'announcement') {
        onCommunityUpdated({ ...community, announcement: created.content.slice(0, 480) });
      }
      setPostContent('');
      setMediaFile(null);
      setPollQuestion('');
      setPostKind('post');
      toast.success('Published to community feed.');
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setPosting(false);
    }
  };

  const toggleComments = async (postId: string) => {
    if (openCommentsPostId === postId) {
      setOpenCommentsPostId(null);
      return;
    }
    setOpenCommentsPostId(postId);
    setReplyTarget(null);
    const list = await fetchCommunityPostComments(community.id, postId).catch(() => []);
    setCommentsByPost((prev) => ({ ...prev, [postId]: list }));
  };

  const handleAddComment = async (postId: string) => {
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to comment in this community.');
      return;
    }
    if (!commentInput.trim()) return;
    const created = await addCommunityPostComment({
      communityId: community.id,
      postId,
      author: profile,
      content: commentInput,
      parentCommentId: replyTarget?.id,
      replyToUsername: replyTarget?.authorUsername,
    });
    setCommentsByPost((prev) => ({
      ...prev,
      [postId]: [...(prev[postId] || []), created],
    }));
    setPosts((prev) =>
      prev.map((p) => (p.id === postId ? { ...p, commentsCount: (p.commentsCount || 0) + 1 } : p))
    );
    setCommentInput('');
    setReplyTarget(null);
  };

  const handleSearchInviteUsers = async (qStr: string) => {
    setInviteSearch(qStr);
    if (qStr.trim().length < 2) {
      setInviteResults([]);
      return;
    }
    const snap = await getDocs(query(collection(db, 'users'), limit(35))).catch(() => null);
    if (!snap) return;
    const term = qStr.trim().toLowerCase();
    const list = snap.docs
      .map((d) => ({ uid: d.id, ...(d.data() as Omit<BanaUser, 'uid'>) }))
      .filter(
        (u) =>
          u.uid !== firebaseUser?.uid &&
          (u.displayName?.toLowerCase().includes(term) || u.username?.toLowerCase().includes(term))
      )
      .slice(0, 8);
    setInviteResults(list);
  };

  const handleCreateCommunityEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    setSavingEvent(true);
    try {
      let coverUrl = '';
      if (evCoverFile) {
        const comp = await compressImageFile(evCoverFile, 1600);
        coverUrl = await uploadMediaWithProgress(
          `communities/${firebaseUser.uid}/ev_${Date.now()}_${comp.name}`,
          comp
        );
      }
      await addDoc(collection(db, 'events'), {
        organizerId: firebaseUser.uid,
        organizerName: profile.displayName,
        communityId: community.id,
        communityName: community.name,
        title: evTitle.trim(),
        description: evDesc.trim(),
        coverUrl,
        isOnline: evIsOnline,
        onlineUrl: evIsOnline ? evOnlineUrl.trim() : '',
        category: evCategory,
        district: evDistrict,
        venue: evIsOnline ? 'Online Event' : evVenue.trim(),
        eventDate: evDate,
        eventTime: evTime,
        capacity: Math.max(10, Number(evCapacity) || 100),
        attendeesCount: 0,
        interestedCount: 0,
        status: 'upcoming',
        createdAt: serverTimestamp(),
      });
      setEventOpen(false);
      setEvTitle('');
      setEvDesc('');
      setEvVenue('');
      setEvDate('');
      setEvCoverFile(null);
      toast.success('Community event published.');
      loadWorkspace();
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setSavingEvent(false);
    }
  };

  const sortedPosts = [...posts].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 space-y-5">
      <div className="flex items-center justify-between gap-4">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:underline"
        >
          <ArrowLeft className="w-4 h-4" /> All Communities
        </button>

        <button
          type="button"
          onClick={() => {
            if (!firebaseUser) return openAuthModal('Sign in to report this community.');
            setReportTarget({ type: 'community', id: community.id, title: `Report group “${community.name}”` });
          }}
          className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-red-600"
        >
          <Flag className="w-3.5 h-3.5" /> Report Group
        </button>
      </div>

      {/* Group Banner Card */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
        <ResilientImage
          src={community.coverUrl || defaultCommunityCover}
          alt={community.name}
          className="w-full h-48 sm:h-60 object-cover"
        />
        <div className="p-5 sm:p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display font-extrabold text-2xl">{community.name}</h1>
              <span className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300 capitalize">
                {community.privacy === 'private' ? <Lock className="w-3 h-3" /> : <Globe className="w-3 h-3" />}
                {community.privacy} group
              </span>
            </div>
            <p className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
              <span>{community.category}</span>
              {community.district && (
                <>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3 h-3" /> {community.district}
                  </span>
                </>
              )}
              <span>·</span>
              <span className="font-mono tabular-nums">{community.membersCount} members</span>
            </p>
            <p className="text-sm text-neutral-700 dark:text-neutral-300 pt-1">{community.description}</p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {isActiveMember && (
              <button
                type="button"
                onClick={() => setInviteOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                <UserPlus className="w-3.5 h-3.5" /> Invite
              </button>
            )}
            {!isCreator && (
              <button
                type="button"
                onClick={handleJoinLeave}
                className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                  myMemberRecord?.status === 'active'
                    ? 'border border-neutral-200 dark:border-neutral-700 text-neutral-700 dark:text-neutral-200'
                    : myMemberRecord?.status === 'pending'
                    ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 border border-amber-200'
                    : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                }`}
              >
                {myMemberRecord?.status === 'active'
                  ? 'Joined (Leave)'
                  : myMemberRecord?.status === 'pending'
                  ? 'Request Pending'
                  : community.privacy === 'private' || community.requiresApproval
                  ? 'Request to Join'
                  : 'Join Group'}
              </button>
            )}
          </div>
        </div>

        {/* Sub-navigation Tabs */}
        <div className="px-5 pb-3 pt-1 border-t border-neutral-100 dark:border-neutral-800 flex items-center gap-2 overflow-x-auto">
          {(
            [
              { id: 'feed', label: `Feed & Discussions (${posts.length})` },
              { id: 'chat', label: 'Group Chat' },
              { id: 'events', label: `Events (${events.length})` },
              {
                id: 'members',
                label: `Members${requests.length > 0 ? ` (${requests.length} pending)` : ` (${members.length})`}`,
              },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setSubTab(t.id)}
              className={`px-3.5 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
                subTab === t.id
                  ? 'bg-[#1877F2] text-white'
                  : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {!canViewContent ? (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-12 text-center space-y-3">
          <Lock className="w-9 h-9 mx-auto text-neutral-400" />
          <h3 className="font-display font-bold text-base">This community is private</h3>
          <p className="text-xs text-neutral-500 max-w-sm mx-auto">
            Request membership to view discussions, polls, announcements, events, and group chat.
          </p>
        </div>
      ) : subTab === 'chat' ? (
        <GroupChatPanel
          community={community}
          members={members}
          isMember={isActiveMember}
          isRestricted={isRestricted}
          onConversationLinked={(cid) => onCommunityUpdated({ ...community, chatConversationId: cid })}
        />
      ) : subTab === 'events' ? (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-display font-bold text-lg">Community Events</h2>
            {canModerate && (
              <button
                type="button"
                onClick={() => setEventOpen(true)}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold"
              >
                <Plus className="w-4 h-4" /> Create Group Event
              </button>
            )}
          </div>

          {events.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center space-y-2">
              <Calendar className="w-8 h-8 mx-auto text-neutral-400" />
              <p className="text-xs text-neutral-500">No upcoming events scheduled in {community.name}.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {events.map((ev) => {
                const status = rsvpMap[ev.id] || null;
                return (
                  <div
                    key={ev.id}
                    className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden flex flex-col"
                  >
                    {ev.coverUrl && (
                      <ResilientImage src={ev.coverUrl} alt={ev.title} className="w-full h-36 object-cover" />
                    )}
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div className="space-y-1.5">
                        <p className="text-[11px] font-semibold text-[#1877F2]">
                          {ev.eventDate} {ev.eventTime ? `· ${ev.eventTime}` : ''} · {ev.status}
                        </p>
                        <h3 className="font-display font-bold text-base">{ev.title}</h3>
                        <p className="text-xs text-neutral-600 dark:text-neutral-400">{ev.description}</p>
                        <p className="text-xs text-neutral-500 flex items-center gap-1">
                          <MapPin className="w-3.5 h-3.5" />
                          {ev.isOnline ? `Online (${ev.onlineUrl || 'Link provided'})` : `${ev.venue}, ${ev.district}`}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                        <span className="text-[11px] font-mono text-neutral-500 tabular-nums">
                          {ev.attendeesCount} going · {ev.interestedCount || 0} interested
                        </span>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!firebaseUser) return openAuthModal('Sign in to RSVP.');
                              try {
                                const next = await setEventRsvpStatus({
                                  event: ev,
                                  uid: firebaseUser.uid,
                                  currentStatus: status,
                                  nextStatus: 'interested',
                                });
                                setRsvpMap((prev) => {
                                  const copy = { ...prev };
                                  if (next) copy[ev.id] = next;
                                  else delete copy[ev.id];
                                  return copy;
                                });
                                loadWorkspace();
                              } catch (err) {
                                toast.error(formatFirebaseErrorMessage(err));
                              }
                            }}
                            className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${
                              status === 'interested'
                                ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]'
                                : 'border-neutral-200 dark:border-neutral-700'
                            }`}
                          >
                            Interested
                          </button>
                          <button
                            type="button"
                            onClick={async () => {
                              if (!firebaseUser) return openAuthModal('Sign in to RSVP.');
                              try {
                                const next = await setEventRsvpStatus({
                                  event: ev,
                                  uid: firebaseUser.uid,
                                  currentStatus: status,
                                  nextStatus: 'going',
                                });
                                setRsvpMap((prev) => {
                                  const copy = { ...prev };
                                  if (next) copy[ev.id] = next;
                                  else delete copy[ev.id];
                                  return copy;
                                });
                                loadWorkspace();
                              } catch (err) {
                                toast.error(formatFirebaseErrorMessage(err));
                              }
                            }}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                              status === 'going'
                                ? 'bg-emerald-600 text-white'
                                : 'bg-[#1877F2] text-white'
                            }`}
                          >
                            {status === 'going' ? 'Going ✓' : 'Going'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ) : subTab === 'members' ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            {canModerate && requests.length > 0 && (
              <div className="rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/40 dark:bg-amber-950/20 p-4 space-y-3">
                <h3 className="font-display font-bold text-sm">
                  Pending Join Requests ({requests.length})
                </h3>
                {requests.map((req) => (
                  <div
                    key={req.id}
                    className="flex items-center justify-between gap-3 py-2 border-b border-amber-100 dark:border-amber-900/40 last:border-0 text-xs"
                  >
                    <div>
                      <p className="font-semibold">{req.targetName || 'User'}</p>
                      <p className="text-[11px] text-neutral-500">@{req.targetUsername || req.targetUid.slice(0, 8)}</p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!firebaseUser) return;
                          await respondToJoinRequest({
                            community,
                            memberUid: req.targetUid,
                            memberName: req.targetName,
                            memberUsername: req.targetUsername,
                            approve: true,
                            actorUid: firebaseUser.uid,
                          });
                          toast.success('Member approved.');
                          loadWorkspace();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600 text-white font-semibold inline-flex items-center gap-1"
                      >
                        <Check className="w-3.5 h-3.5" /> Approve
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          if (!firebaseUser) return;
                          await respondToJoinRequest({
                            community,
                            memberUid: req.targetUid,
                            approve: false,
                            actorUid: firebaseUser.uid,
                          });
                          toast.info('Request declined.');
                          loadWorkspace();
                        }}
                        className="px-2.5 py-1 rounded-lg bg-neutral-200 dark:bg-neutral-800 text-xs font-semibold"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
              <h3 className="font-display font-bold text-base">Members ({members.length})</h3>
              {members.map((m) => {
                const isTargetOwner = m.userId === community.creatorId;
                return (
                  <div
                    key={m.id}
                    className="flex flex-wrap items-center justify-between gap-3 py-2.5 border-b border-neutral-100 dark:border-neutral-800 last:border-0 text-xs"
                  >
                    <div className="flex items-center gap-2.5">
                      <Avatar src={m.userAvatar} name={m.userName || 'Member'} size="sm" />
                      <div>
                        <p className="font-semibold flex items-center gap-1.5">
                          <span>{m.userName || 'Member'}</span>
                          <span className="px-1.5 py-0.5 rounded bg-neutral-100 dark:bg-neutral-800 text-[10px] font-mono capitalize">
                            {isTargetOwner ? 'owner' : m.role}
                          </span>
                          {m.status === 'restricted' && (
                            <span className="text-[10px] text-amber-600 font-semibold">Restricted</span>
                          )}
                        </p>
                        <p className="text-[11px] text-neutral-500">@{m.userUsername || m.userId.slice(0, 8)}</p>
                      </div>
                    </div>

                    {canModerate && !isTargetOwner && m.userId !== firebaseUser?.uid && (
                      <div className="flex flex-wrap items-center gap-1.5">
                        {canAdminister && (
                          <button
                            type="button"
                            onClick={async () => {
                              const nextRole: CommunityRole =
                                m.role === 'moderator' ? 'member' : 'moderator';
                              await updateCommunityMemberRoleOrStatus({
                                communityId: community.id,
                                member: m,
                                role: nextRole,
                              });
                              toast.success(`Role updated to ${nextRole}.`);
                              loadWorkspace();
                            }}
                            className="px-2.5 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 font-medium"
                          >
                            {m.role === 'moderator' ? 'Revoke Mod' : 'Make Moderator'}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={async () => {
                            const nextStatus = m.status === 'restricted' ? 'active' : 'restricted';
                            await updateCommunityMemberRoleOrStatus({
                              communityId: community.id,
                              member: m,
                              status: nextStatus,
                            });
                            toast.success(`Member ${nextStatus}.`);
                            loadWorkspace();
                          }}
                          className="px-2.5 py-1 rounded-lg border border-amber-200 dark:border-amber-900 text-amber-700 dark:text-amber-300"
                        >
                          {m.status === 'restricted' ? 'Unrestrict' : 'Restrict'}
                        </button>
                        <button
                          type="button"
                          onClick={async () => {
                            await removeCommunityMember(community.id, m);
                            toast.success('Member removed.');
                            loadWorkspace();
                          }}
                          className="px-2.5 py-1 rounded-lg bg-red-600 text-white"
                        >
                          Remove
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {canModerate && (
            <aside className="lg:col-span-4 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3 h-fit">
              <h3 className="font-display font-bold text-sm flex items-center gap-1.5">
                <ShieldCheck className="w-4 h-4 text-[#1877F2]" /> Group Administration
              </h3>
              <div className="space-y-2.5 text-xs">
                <div>
                  <label className="block font-medium mb-1">Description</label>
                  <textarea
                    rows={3}
                    value={descEdit}
                    onChange={(e) => setDescEdit(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-2.5"
                  />
                </div>
                <div>
                  <label className="block font-medium mb-1">Privacy</label>
                  <select
                    value={privacyEdit}
                    onChange={(e) => setPrivacyEdit(e.target.value as any)}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-2.5"
                  >
                    <option value="public">Public</option>
                    <option value="private">Private</option>
                  </select>
                </div>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={approvalEdit}
                    onChange={(e) => setApprovalEdit(e.target.checked)}
                  />
                  <span>Require admin approval to join</span>
                </label>
                <div>
                  <label className="block font-medium mb-1">Group Rules (one per line)</label>
                  <textarea
                    rows={4}
                    value={rulesEdit}
                    onChange={(e) => setRulesEdit(e.target.value)}
                    className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-2.5"
                  />
                </div>
                <button
                  type="button"
                  onClick={async () => {
                    const rules = rulesEdit
                      .split('\n')
                      .map((r) => r.trim())
                      .filter(Boolean);
                    await updateDoc(doc(db, 'communities', community.id), {
                      description: descEdit.trim(),
                      privacy: privacyEdit,
                      requiresApproval: approvalEdit,
                      rules,
                      updatedAt: serverTimestamp(),
                    });
                    onCommunityUpdated({
                      ...community,
                      description: descEdit.trim(),
                      privacy: privacyEdit,
                      requiresApproval: approvalEdit,
                      rules,
                    });
                    toast.success('Community settings updated.');
                  }}
                  className="w-full h-9 rounded-xl bg-[#1877F2] text-white font-semibold"
                >
                  Save Group Settings
                </button>
              </div>
            </aside>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8 space-y-4">
            {community.announcement && (
              <div className="rounded-2xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 p-4 flex items-start gap-3">
                <Megaphone className="w-4 h-4 text-[#1877F2] mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-bold text-blue-900 dark:text-blue-200">Pinned Announcement</p>
                  <p className="text-xs text-blue-800 dark:text-blue-300 mt-0.5">{community.announcement}</p>
                </div>
              </div>
            )}

            {isActiveMember && !isRestricted && (
              <form
                onSubmit={handleCreatePost}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {(
                    [
                      { id: 'post', label: 'Discussion / Media' },
                      { id: 'poll', label: 'Poll' },
                      ...(canModerate ? [{ id: 'announcement', label: 'Announcement' }] : []),
                    ] as const
                  ).map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setPostKind(k.id as any)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold ${
                        postKind === k.id
                          ? 'bg-[#1877F2] text-white'
                          : 'bg-neutral-100 dark:bg-neutral-800 text-neutral-600 dark:text-neutral-300'
                      }`}
                    >
                      {k.label}
                    </button>
                  ))}
                </div>

                {postKind === 'poll' ? (
                  <div className="space-y-2">
                    <input
                      type="text"
                      required
                      value={pollQuestion}
                      onChange={(e) => setPollQuestion(e.target.value)}
                      placeholder="Ask a question to members..."
                      className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                    />
                    <textarea
                      rows={3}
                      value={pollOptionsRaw}
                      onChange={(e) => setPollOptionsRaw(e.target.value)}
                      placeholder="Poll options (one per line)"
                      className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-xs"
                    />
                  </div>
                ) : (
                  <textarea
                    rows={3}
                    value={postContent}
                    onChange={(e) => setPostContent(e.target.value)}
                    placeholder={
                      postKind === 'announcement'
                        ? 'Write a group announcement...'
                        : `Share an update, photo, or video with ${community.name}...`
                    }
                    className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-xs"
                  />
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs cursor-pointer">
                    <ImageIcon className="w-3.5 h-3.5" />
                    <Video className="w-3.5 h-3.5" />
                    <span>{mediaFile ? mediaFile.name : 'Photo / Video'}</span>
                    <input
                      type="file"
                      accept="image/*,video/*"
                      onChange={(e) => setMediaFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={posting}
                    className="px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {posting ? 'Publishing...' : 'Post to Group'}
                  </button>
                </div>
              </form>
            )}

            {loading ? (
              <div className="h-44 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
            ) : sortedPosts.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center text-xs text-neutral-500">
                No discussions in this community yet. Start the first post!
              </div>
            ) : (
              sortedPosts.map((post) => {
                const liked = Boolean(firebaseUser && (post.likesUserIds || []).includes(firebaseUser.uid));
                const votedOpt = firebaseUser ? post.pollVoters?.[firebaseUser.uid] : undefined;
                const totalVotes = (post.pollOptions || []).reduce((s, o) => s + (o.votes || 0), 0);
                const postComments = commentsByPost[post.id] || [];

                return (
                  <article
                    key={post.id}
                    className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={post.authorAvatar} name={post.authorName} size="sm" />
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-bold">{post.authorName}</span>
                            {post.authorRole && post.authorRole !== 'member' && (
                              <span className="px-1.5 py-0.5 rounded bg-[#1877F2]/10 text-[#1877F2] text-[10px] font-semibold capitalize">
                                {post.authorRole}
                              </span>
                            )}
                            {post.isPinned && (
                              <span className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-amber-600">
                                <Pin className="w-3 h-3" /> Pinned
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-neutral-500">
                            @{post.authorUsername} · {formatRelativeTime(post.createdAt)}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5">
                        {firebaseUser && firebaseUser.uid !== post.authorId && (
                          <button
                            type="button"
                            onClick={() => setReportTarget({ type: 'community_post', id: post.id, title: 'Report this post' })}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-amber-600"
                            title="Report post"
                            aria-label="Report post"
                          >
                            <Flag className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {canModerate && (
                          <button
                            type="button"
                            onClick={async () => {
                              await updateDoc(doc(db, 'communities', community.id, 'posts', post.id), {
                                isPinned: !post.isPinned,
                              });
                              setPosts((prev) =>
                                prev.map((p) => (p.id === post.id ? { ...p, isPinned: !p.isPinned } : p))
                              );
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-[#1877F2]"
                            title={post.isPinned ? 'Unpin post' : 'Pin post'}
                          >
                            <Pin className="w-3.5 h-3.5" />
                          </button>
                        )}
                        {(canModerate || firebaseUser?.uid === post.authorId) && (
                          <button
                            type="button"
                            onClick={async () => {
                              await updateDoc(doc(db, 'communities', community.id, 'posts', post.id), {
                                status: 'removed',
                              });
                              setPosts((prev) => prev.filter((p) => p.id !== post.id));
                              toast.success('Post removed.');
                            }}
                            className="p-1.5 rounded-lg text-neutral-400 hover:text-red-600"
                            title="Remove post"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>

                    {post.kind === 'announcement' && (
                      <p className="text-[11px] font-bold text-[#1877F2] flex items-center gap-1">
                        <Sparkles className="w-3.5 h-3.5" /> Community Announcement
                      </p>
                    )}

                    {post.content && (
                      <p className="text-sm text-neutral-800 dark:text-neutral-200 whitespace-pre-wrap">
                        {post.content}
                      </p>
                    )}

                    {post.mediaType === 'image' && post.mediaUrls?.[0] && (
                      <img loading="lazy"
                        src={post.mediaUrls[0]}
                        alt="Community attachment"
                        className="rounded-xl w-full max-h-96 object-cover"
                      />
                    )}
                    {post.mediaType === 'video' && post.mediaUrls?.[0] && (
                      <video
                        src={post.mediaUrls[0]}
                        controls
                        className="rounded-xl w-full max-h-96 bg-black"
                      />
                    )}

                    {post.kind === 'poll' && post.pollOptions && post.pollOptions.length > 0 && (
                      <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 space-y-2">
                        <p className="text-xs font-bold">{post.pollQuestion || post.content}</p>
                        {post.pollOptions.map((opt) => {
                          const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                          const picked = votedOpt === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              disabled={Boolean(votedOpt) || !isActiveMember}
                              onClick={async () => {
                                if (!firebaseUser) return;
                                await voteCommunityPoll(community.id, post, opt.id, firebaseUser.uid);
                                loadWorkspace();
                              }}
                              className={`w-full relative overflow-hidden rounded-lg border p-2.5 text-left text-xs flex justify-between ${
                                picked
                                  ? 'border-[#1877F2] bg-[#1877F2]/5 font-semibold'
                                  : 'border-neutral-200 dark:border-neutral-800'
                              }`}
                            >
                              <span>{opt.label}</span>
                              {votedOpt && <span className="font-mono">{pct}% ({opt.votes})</span>}
                            </button>
                          );
                        })}
                        <p className="text-[11px] text-neutral-500">{totalVotes} total votes</p>
                      </div>
                    )}

                    <div className="flex items-center gap-5 pt-2 border-t border-neutral-100 dark:border-neutral-800 text-xs text-neutral-500">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!firebaseUser) return openAuthModal('Sign in to react to community posts.');
                          await toggleCommunityPostLike(community.id, post, firebaseUser.uid);
                          setPosts((prev) =>
                            prev.map((p) => {
                              if (p.id !== post.id) return p;
                              const ids = p.likesUserIds || [];
                              const nextIds = liked
                                ? ids.filter((x) => x !== firebaseUser.uid)
                                : [...ids, firebaseUser.uid];
                              return { ...p, likesUserIds: nextIds, likesCount: nextIds.length };
                            })
                          );
                        }}
                        className={`inline-flex items-center gap-1.5 ${
                          liked ? 'text-rose-600 font-semibold' : 'hover:text-neutral-900 dark:hover:text-white'
                        }`}
                      >
                        <Heart className={`w-4 h-4 ${liked ? 'fill-current' : ''}`} />
                        <span className="font-mono">{post.likesCount || 0}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleComments(post.id)}
                        className="inline-flex items-center gap-1.5 hover:text-neutral-900 dark:hover:text-white"
                      >
                        <MessageSquare className="w-4 h-4" />
                        <span className="font-mono">{post.commentsCount || 0}</span> Comments
                      </button>
                    </div>

                    {openCommentsPostId === post.id && (
                      <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 space-y-3">
                        <div className="space-y-2 max-h-60 overflow-y-auto">
                          {postComments.map((cmt) => (
                            <div
                              key={cmt.id}
                              className={`text-xs flex gap-2 ${cmt.parentCommentId ? 'pl-6' : ''}`}
                            >
                              <Avatar src={cmt.authorAvatar} name={cmt.authorName} size="xs" />
                              <div className="flex-1 bg-neutral-50 dark:bg-neutral-950 rounded-xl px-3 py-2">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-semibold">{cmt.authorName}</span>
                                  <button
                                    type="button"
                                    onClick={() => setReplyTarget(cmt)}
                                    className="text-[10px] text-[#1877F2] hover:underline"
                                  >
                                    Reply
                                  </button>
                                </div>
                                <p className="text-neutral-700 dark:text-neutral-300 mt-0.5">
                                  {cmt.replyToUsername && (
                                    <span className="text-[#1877F2] mr-1">@{cmt.replyToUsername}</span>
                                  )}
                                  {cmt.content}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                        {isActiveMember && !isRestricted && (
                          <div className="space-y-1">
                            {replyTarget && (
                              <div className="flex items-center justify-between text-[11px] text-[#1877F2]">
                                <span>Replying to @{replyTarget.authorUsername}</span>
                                <button type="button" onClick={() => setReplyTarget(null)}>
                                  Cancel
                                </button>
                              </div>
                            )}
                            <div className="flex gap-2">
                              <input
                                type="text"
                                value={commentInput}
                                onChange={(e) => setCommentInput(e.target.value)}
                                placeholder="Write a comment..."
                                className="flex-1 h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                              />
                              <button
                                type="button"
                                onClick={() => handleAddComment(post.id)}
                                className="px-3 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold inline-flex items-center gap-1"
                              >
                                <Send className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </article>
                );
              })
            )}
          </div>

          <aside className="lg:col-span-4 space-y-4">
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-2.5">
              <h3 className="font-display font-bold text-sm flex items-center gap-1.5">
                <Shield className="w-4 h-4 text-[#1877F2]" /> Community Rules
              </h3>
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-neutral-600 dark:text-neutral-400">
                {(community.rules || []).map((rule, idx) => (
                  <li key={idx}>{rule}</li>
                ))}
              </ol>
            </div>
          </aside>
        </div>
      )}

      {/* Invite Modal */}
      {inviteOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-base">Invite Members to {community.name}</h3>
              <button type="button" onClick={() => setInviteOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="search"
              value={inviteSearch}
              onChange={(e) => handleSearchInviteUsers(e.target.value)}
              placeholder="Search people by name or @username..."
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
            />
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {inviteResults.map((u) => (
                <div key={u.uid} className="flex items-center justify-between text-xs py-1.5">
                  <div className="flex items-center gap-2">
                    <Avatar src={u.avatarUrl} name={u.displayName} size="xs" />
                    <div>
                      <p className="font-semibold">{u.displayName}</p>
                      <p className="text-[11px] text-neutral-500">@{u.username}</p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!profile) return;
                      await inviteUserToCommunity({
                        community,
                        inviter: profile,
                        targetUser: u,
                      });
                      toast.success(`Invitation sent to @${u.username}`);
                    }}
                    className="px-3 py-1 rounded-lg bg-[#1877F2] text-white font-semibold"
                  >
                    Invite
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Community Event Creation Modal */}
      {eventOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <form
            onSubmit={handleCreateCommunityEvent}
            className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-3.5 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-base">Host Event in {community.name}</h3>
              <button type="button" onClick={() => setEventOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>
            <input
              type="text"
              required
              value={evTitle}
              onChange={(e) => setEvTitle(e.target.value)}
              placeholder="Event Title"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
            />
            <textarea
              rows={3}
              required
              value={evDesc}
              onChange={(e) => setEvDesc(e.target.value)}
              placeholder="Event details and agenda..."
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
            />
            <div className="grid grid-cols-2 gap-2.5">
              <select
                value={evCategory}
                onChange={(e) => setEvCategory(e.target.value as DiscoveryCategory)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {DISCOVERY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={evDistrict}
                onChange={(e) => setEvDistrict(e.target.value)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                {BANGLADESH_DISTRICTS.filter((d) => d !== 'All Districts').map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid grid-cols-3 gap-2.5">
              <input
                type="date"
                required
                value={evDate}
                onChange={(e) => setEvDate(e.target.value)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <input
                type="time"
                value={evTime}
                onChange={(e) => setEvTime(e.target.value)}
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              />
              <input
                type="number"
                min={10}
                value={evCapacity}
                onChange={(e) => setEvCapacity(e.target.value)}
                placeholder="Capacity"
                className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs font-mono"
              />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={evIsOnline}
                onChange={(e) => setEvIsOnline(e.target.checked)}
              />
              <span>Online event (livestream / webinar)</span>
            </label>
            {evIsOnline ? (
              <input
                type="url"
                value={evOnlineUrl}
                onChange={(e) => setEvOnlineUrl(e.target.value)}
                placeholder="Meeting URL (https://...)"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
              />
            ) : (
              <input
                type="text"
                required
                value={evVenue}
                onChange={(e) => setEvVenue(e.target.value)}
                placeholder="Venue address"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
              />
            )}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setEvCoverFile(e.target.files?.[0] || null)}
              className="text-xs"
            />
            <button
              type="submit"
              disabled={savingEvent}
              className="w-full h-10 rounded-xl bg-[#1877F2] text-white text-xs font-semibold disabled:opacity-50"
            >
              {savingEvent ? 'Publishing...' : 'Publish Community Event'}
            </button>
          </form>
        </div>
      )}
      {reportTarget && (
        <CommunityReportDialog
          open
          targetType={reportTarget.type}
          targetId={reportTarget.id}
          communityId={community.id}
          title={reportTarget.title}
          onClose={() => setReportTarget(null)}
        />
      )}
    </div>
  );
}
