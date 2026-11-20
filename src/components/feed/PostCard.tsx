import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  MessageCircle,
  Share2,
  Bookmark,
  MoreHorizontal,
  Trash2,
  Edit3,
  Flag,
  Ban,
  Mic,
  Send,
  ChevronLeft,
  ChevronRight,
  MapPin,
  TrendingUp,
  TrendingDown,
  EyeOff,
  UserX,
  CornerDownRight,
  X,
  Maximize2,
  UserCheck,
  UserPlus,
  Zap,
  Pin,
} from 'lucide-react';
import {
  doc,
  setDoc,
  deleteDoc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import {
  sortByCreatedAtAsc,
  sortByCreatedAtDesc,
  subscribeWithIndexFallback,
} from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type {
  BanaPost,
  BanaComment,
  BanaVoiceComment,
  DiscoveryCategory,
  ReactionType,
} from '@/src/types/bana';
import { Avatar, ResilientImage } from '@/src/components/common/Avatar';
import { VerifiedBadge } from '@/src/components/common/BanaLogo';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import { VoicePlayer, VoiceRecorder } from '@/src/components/voice/VoiceRecorderAndPlayer';
import { ReactionPickerButton, ReactionSummary } from '@/src/components/feed/ReactionBar';
import { ShareToMessengerModal } from '@/src/components/feed/ShareToMessengerModal';
import { FullscreenVideoModal } from '@/src/components/feed/FullscreenVideoModal';
import { BoostAndPaymentModal } from '@/src/components/monetization/BoostAndPaymentModal';
import { formatCompactNumber, formatRelativeTime } from '@/src/lib/mediaUtils';
import {
  createHardenedComment,
  formatVisibleCommentText,
  softDeleteComment,
} from '@/src/lib/comments';
import { logFirestoreError, OperationType, formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';
import { blockUser } from '@/src/lib/socialGraph';

interface PostCardProps {
  post: BanaPost;
  isPinned?: boolean;
  onTogglePin?: (postId: string) => void;
  onDeleted?: (id: string) => void;
  onUnsaved?: (id: string) => void;
  onBlockedUser?: (uid: string) => void;
  onHideCreator?: (uid: string) => void;
  onNotInterested?: (postId: string) => void;
  onAdjustInterest?: (category: DiscoveryCategory, delta: number) => void;
}

function renderFormattedText(text: string) {
  const tokens = text.split(/(#[a-zA-Z0-9_]+|@[a-zA-Z0-9_.]+)/g);
  return tokens.map((part, idx) => {
    if (part.startsWith('#') && part.length > 1) {
      const q = encodeURIComponent(part.slice(1));
      return (
        <Link key={idx} to={`/discover?q=${q}`} className="text-[#1877F2] dark:text-blue-400 hover:underline font-medium">
          {part}
        </Link>
      );
    }
    if (part.startsWith('@') && part.length > 1) {
      const uname = encodeURIComponent(part.slice(1));
      return (
        <Link key={idx} to={`/profile/${uname}`} className="text-[#1877F2] dark:text-blue-400 hover:underline font-medium">
          {part}
        </Link>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function PostCard({
  post,
  isPinned = false,
  onTogglePin,
  onDeleted,
  onUnsaved,
  onBlockedUser,
  onHideCreator,
  onNotInterested,
  onAdjustInterest,
}: PostCardProps) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();
  const [userReaction, setUserReaction] = useState<ReactionType | null>(null);
  const [reactionsSummary, setReactionsSummary] = useState<Record<string, number>>(post.reactionsSummary || {});
  const [saved, setSaved] = useState(false);
  // In-flight guards: prevent double-tap duplicate writes and count drift.
  const reactBusy = useRef(false);
  const saveBusy = useRef(false);
  const commentBusy = useRef(false);
  const [following, setFollowing] = useState(false);
  const [likesCount, setLikesCount] = useState(post.likesCount || 0);
  const [commentsCount, setCommentsCount] = useState(post.commentsCount || 0);
  const [sharesCount, setSharesCount] = useState(post.sharesCount || 0);

  const [galleryIndex, setGalleryIndex] = useState(0);
  const [showComments, setShowComments] = useState(false);
  const [commentLimit, setCommentLimit] = useState(30);
  const [videoFallbackActive, setVideoFallbackActive] = useState(false);
  const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [replyingTo, setReplyingTo] = useState<BanaComment | null>(null);
  const [comments, setComments] = useState<BanaComment[]>([]);
  const [voiceComments, setVoiceComments] = useState<BanaVoiceComment[]>([]);

  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [fullscreenVideoOpen, setFullscreenVideoOpen] = useState(false);
  const [boostModalOpen, setBoostModalOpen] = useState(false);

  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(post.content);
  const [currentContent, setCurrentContent] = useState(post.content);
  const [pollOptions, setPollOptions] = useState(post.pollOptions || []);
  const [votedOption, setVotedOption] = useState<string | null>(
    firebaseUser && post.pollVoters ? post.pollVoters[firebaseUser.uid] || null : null
  );
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isOwner = firebaseUser?.uid === post.authorId;

  useEffect(() => {
    if (!firebaseUser) {
      setUserReaction(null);
      setSaved(false);
      setFollowing(false);
      return;
    }
    getDoc(doc(db, 'postLikes', `${post.id}_${firebaseUser.uid}`))
      .then((s) => {
        if (s.exists()) {
          setUserReaction((s.data().reactionType as ReactionType) || 'like');
        } else {
          setUserReaction(null);
        }
      })
      .catch(() => {});
    getDoc(doc(db, 'savedPosts', `${post.id}_${firebaseUser.uid}`))
      .then((s) => setSaved(s.exists()))
      .catch(() => {});
    if (firebaseUser.uid !== post.authorId) {
      getDoc(doc(db, 'userFollows', `${firebaseUser.uid}_${post.authorId}`))
        .then((s) => setFollowing(s.exists()))
        .catch(() => {});
    }
  }, [post.id, post.authorId, firebaseUser]);

  useEffect(() => {
    if (!showComments) return;
    const cPrimary = query(
      collection(db, 'comments'),
      where('targetId', '==', post.id),
      orderBy('createdAt', 'asc'),
      limit(commentLimit)
    );
    const cFallback = query(collection(db, 'comments'), where('targetId', '==', post.id), limit(commentLimit));

    const vcPrimary = query(
      collection(db, 'voiceComments'),
      where('targetId', '==', post.id),
      orderBy('createdAt', 'desc'),
      limit(15)
    );
    const vcFallback = query(collection(db, 'voiceComments'), where('targetId', '==', post.id), limit(15));

    const unsubC = subscribeWithIndexFallback<BanaComment>({
      primaryQuery: cPrimary,
      fallbackQuery: cFallback,
      comparator: sortByCreatedAtAsc,
      onData: (list) => setComments(list),
      onError: (err) => logFirestoreError(err, OperationType.LIST, 'comments'),
    });

    const unsubVc = subscribeWithIndexFallback<BanaVoiceComment>({
      primaryQuery: vcPrimary,
      fallbackQuery: vcFallback,
      comparator: sortByCreatedAtDesc,
      onData: (list) => setVoiceComments(list),
      onError: (err) => logFirestoreError(err, OperationType.LIST, 'voiceComments'),
    });

    return () => {
      unsubC();
      unsubVc();
    };
  }, [showComments, post.id, commentLimit]);

  const handleSelectReaction = async (reaction: ReactionType) => {
    if (!firebaseUser) return openAuthModal('Sign in to react to this post.');
    if (reactBusy.current) return;
    reactBusy.current = true;
    const prevLikesCount = likesCount;
    const prevSummary = reactionsSummary;
    const likeId = `${post.id}_${firebaseUser.uid}`;
    const likeRef = doc(db, 'postLikes', likeId);
    const prevReaction = userReaction;
    const isRemoving = prevReaction === reaction;
    const nextReaction = isRemoving ? null : reaction;

    setUserReaction(nextReaction);
    setLikesCount((c) => {
      if (!prevReaction && nextReaction) return c + 1;
      if (prevReaction && !nextReaction) return Math.max(0, c - 1);
      return c;
    });
    setReactionsSummary((prev) => {
      const next = { ...prev };
      if (prevReaction) next[prevReaction] = Math.max(0, (next[prevReaction] || 1) - 1);
      if (nextReaction) next[nextReaction] = (next[nextReaction] || 0) + 1;
      return next;
    });

    try {
      if (nextReaction) {
        await setDoc(likeRef, {
          userId: firebaseUser.uid,
          targetType: 'post',
          targetId: post.id,
          reactionType: nextReaction,
          createdAt: serverTimestamp(),
        });
        if (!prevReaction && post.authorId !== firebaseUser.uid && profile) {
          await addDoc(collection(db, 'notifications'), {
            recipientId: post.authorId,
            actorId: firebaseUser.uid,
            actorName: profile.displayName,
            actorAvatar: profile.avatarUrl || '',
            type: 'like',
            title: 'Post Reaction',
            body: `${profile.displayName} reacted (${nextReaction}) to your post.`,
            linkUrl: `/profile/${post.authorUsername}`,
            dedupeKey: `like_${post.id}_${firebaseUser.uid}`,
            isRead: false,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
      } else {
        await deleteDoc(likeRef);
      }
    } catch (err) {
      // Roll back every optimistic update so the UI matches the database.
      setUserReaction(prevReaction);
      setLikesCount(prevLikesCount);
      setReactionsSummary(prevSummary);
      logFirestoreError(err, OperationType.WRITE, `postLikes/${likeId}`);
      toast.error(formatFirebaseErrorMessage(err) || 'Could not update your reaction. Please try again.');
    } finally {
      reactBusy.current = false;
    }
  };

  const toggleFollowAuthor = async () => {
    if (!firebaseUser) return openAuthModal(`Sign in to follow ${post.authorName}.`);
    if (isOwner) return;
    const followId = `${firebaseUser.uid}_${post.authorId}`;
    const ref = doc(db, 'userFollows', followId);
    const next = !following;
    setFollowing(next);
    try {
      if (next) {
        await setDoc(ref, {
          followerId: firebaseUser.uid,
          followingId: post.authorId,
          createdAt: serverTimestamp(),
        });
        if (profile) {
          await addDoc(collection(db, 'notifications'), {
            recipientId: post.authorId,
            actorId: firebaseUser.uid,
            actorName: profile.displayName,
            actorAvatar: profile.avatarUrl || '',
            type: 'follow',
            title: 'New Follower',
            body: `${profile.displayName} started following you.`,
            linkUrl: `/profile/${profile.username}`,
            dedupeKey: `follow_${followId}`,
            isRead: false,
            createdAt: serverTimestamp(),
          }).catch(() => {});
        }
        toast.success(`Following ${post.authorName}`);
      } else {
        await deleteDoc(ref);
        toast.info(`Unfollowed ${post.authorName}`);
      }
    } catch (err) {
      setFollowing(!next);
      logFirestoreError(err, OperationType.WRITE, `userFollows/${followId}`);
    }
  };

  const toggleSave = async () => {
    if (!firebaseUser) return openAuthModal('Sign in to save posts to your collection.');
    if (saveBusy.current) return;
    saveBusy.current = true;
    const saveId = `${post.id}_${firebaseUser.uid}`;
    const nextSaved = !saved;
    const targetType =
      post.type === 'video'
        ? 'video'
        : post.type === 'image' || post.type === 'gallery'
        ? 'photo'
        : 'post';
    setSaved(nextSaved);
    try {
      if (nextSaved) {
        await setDoc(doc(db, 'savedPosts', saveId), {
          userId: firebaseUser.uid,
          postId: post.id,
          targetType,
          createdAt: serverTimestamp(),
        });
        if (post.type === 'video') {
          await setDoc(doc(db, 'savedVideos', saveId), {
            userId: firebaseUser.uid,
            postId: post.id,
            targetType: 'video',
            createdAt: serverTimestamp(),
          });
        }
        toast.success(post.type === 'video' ? 'Video saved to your library.' : 'Post saved.');
      } else {
        await deleteDoc(doc(db, 'savedPosts', saveId));
        if (post.type === 'video') {
          await deleteDoc(doc(db, 'savedVideos', saveId)).catch(() => {});
        }
        toast.info('Removed from Saved.');
        onUnsaved?.(post.id);
      }
    } catch (err) {
      setSaved(!nextSaved);
      logFirestoreError(err, OperationType.WRITE, `savedPosts/${saveId}`);
      // Keep savedPosts / savedVideos consistent if only one of the two writes succeeded.
      if (nextSaved) {
        await deleteDoc(doc(db, 'savedPosts', saveId)).catch(() => {});
      }
      toast.error(formatFirebaseErrorMessage(err) || 'Could not update Saved. Please try again.');
    } finally {
      saveBusy.current = false;
    }
  };

  const handleOpenShare = () => {
    if (!firebaseUser || !profile) return openAuthModal('Sign in to share posts in BANA Messenger or on your feed.');
    setShareModalOpen(true);
  };

  const handleVote = async (optionId: string) => {
    if (!firebaseUser) return openAuthModal('Sign in to vote in this poll.');
    if (votedOption) return;
    const prevOptions = pollOptions;
    const updatedOptions = pollOptions.map((o) =>
      o.id === optionId ? { ...o, votes: (o.votes || 0) + 1 } : o
    );
    setPollOptions(updatedOptions);
    setVotedOption(optionId);
    try {
      await updateDoc(doc(db, 'posts', post.id), {
        pollOptions: updatedOptions,
        [`pollVoters.${firebaseUser.uid}`]: optionId,
        updatedAt: serverTimestamp(),
      });
    } catch (err) {
      setPollOptions(prevOptions);
      setVotedOption(null);
      logFirestoreError(err, OperationType.UPDATE, `posts/${post.id}`);
      toast.error('Your vote could not be saved. Please try again.');
    }
  };

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return openAuthModal('Sign in to comment on this post.');
    if (!commentText.trim() || commentBusy.current) return;
    commentBusy.current = true;
    const text = commentText.trim();
    const parent = replyingTo;
    setCommentText('');
    setReplyingTo(null);
    try {
      await createHardenedComment({
        targetType: 'post',
        targetId: post.id,
        authorId: firebaseUser.uid,
        authorUsername: profile.username,
        authorName: profile.displayName,
        authorAvatar: profile.avatarUrl || '',
        content: text,
        parentCommentId: parent?.id,
        replyToUsername: parent?.authorUsername,
      });
      setCommentsCount((c) => c + 1);
    } catch (err: any) {
      if (err?.message !== 'Duplicate submission ignored.') {
        logFirestoreError(err, OperationType.CREATE, 'comments');
        // Restore what the user typed so it is not lost.
        setCommentText(text);
        setReplyingTo(parent);
        toast.error(formatFirebaseErrorMessage(err) || 'Comment could not be posted. Please try again.');
      }
    } finally {
      commentBusy.current = false;
    }
  };

  const handleVoiceCommentUploaded = async (payload: {
    audioUrl: string;
    durationSeconds: number;
    waveform: number[];
  }) => {
    if (!firebaseUser || !profile) return;
    await addDoc(collection(db, 'voiceComments'), {
      targetType: 'post',
      targetId: post.id,
      authorId: firebaseUser.uid,
      authorUsername: profile.username,
      authorName: profile.displayName,
      authorAvatar: profile.avatarUrl || '',
      ...payload,
      createdAt: serverTimestamp(),
    });
    setCommentsCount((c) => c + 1);
    setShowVoiceRecorder(false);
  };

  const handleSaveEdit = async () => {
    if (!isOwner || !editText.trim()) return;
    await updateDoc(doc(db, 'posts', post.id), {
      content: editText.trim(),
      updatedAt: serverTimestamp(),
    });
    setCurrentContent(editText.trim());
    setEditing(false);
    toast.success('Post updated.');
  };

  const handleDeletePost = async () => {
    if (!isOwner) return;
    setDeletingPost(true);
    try {
      await deleteDoc(doc(db, 'posts', post.id));
      toast.success('Post deleted.');
      setConfirmDeleteOpen(false);
      onDeleted?.(post.id);
    } catch {
      toast.error('Could not delete post.');
    } finally {
      setDeletingPost(false);
    }
  };

  const handleDeleteComment = async (comment: BanaComment) => {
    if (!firebaseUser) return;
    const hasReplies = comments.some((c) => c.parentCommentId === comment.id);
    try {
      await softDeleteComment(comment, firebaseUser.uid, hasReplies);
      toast.info('Comment removed (recoverable by moderators).');
    } catch {
      toast.error('Could not delete comment.');
    }
  };

  const handleReport = async (targetType: 'post' | 'voice_comment', targetId: string) => {
    if (!firebaseUser) return openAuthModal('Sign in to report content.');
    await addDoc(collection(db, 'reports'), {
      reporterId: firebaseUser.uid,
      targetType,
      targetId,
      reason: 'Community guidelines review',
      details: 'Reported directly from BANA feed.',
      status: 'pending',
      createdAt: serverTimestamp(),
    });
    setStatusMessage('Report submitted to BANA Safety Team.');
    toast.info('Report submitted to BANA Safety Team.');
    setMenuOpen(false);
  };

  const handleBlock = async () => {
    if (!firebaseUser) return openAuthModal('Sign in to manage blocked accounts.');
    if (isOwner) return;
    await blockUser(firebaseUser.uid, post.authorId);
    setMenuOpen(false);
    toast.info(`Blocked @${post.authorUsername}.`);
    onBlockedUser?.(post.authorId);
  };

  const totalVotes = pollOptions.reduce((sum, o) => sum + (o.votes || 0), 0);

  return (
    <>
      <article className="rounded-[12px] border border-neutral-200/80 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-[0_1px_2px_rgba(0,0,0,0.06)] overflow-hidden transition-shadow hover:shadow-md">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2">
          <div className="flex items-center gap-3 min-w-0">
            <Link to={`/profile/${post.authorUsername}`}>
              <Avatar src={post.authorAvatar} name={post.authorName} size="md" />
            </Link>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <Link
                  to={`/profile/${post.authorUsername}`}
                  className="font-display font-semibold text-sm text-neutral-950 dark:text-white truncate hover:underline"
                >
                  {post.authorName}
                </Link>
                {post.authorVerified && <VerifiedBadge size={14} />}
                {isPinned && (
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-neutral-500">
                    · <Pin className="w-3 h-3 text-[#1877F2]" /> Pinned
                  </span>
                )}
                {post.isBoosted && (
                  <span className="text-[11px] font-medium text-[#1877F2]">· Sponsored Boost</span>
                )}
              </div>
              <div className="flex items-center gap-1.5 text-xs text-neutral-500 dark:text-neutral-400 truncate">
                <span>@{post.authorUsername}</span>
                <span aria-hidden="true">·</span>
                <span>{formatRelativeTime(post.createdAt)}</span>
                {post.category && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{post.category}</span>
                  </>
                )}
                {post.communityName && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-medium text-[#1877F2]">{post.communityName}</span>
                  </>
                )}
              {post.locationName && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="inline-flex items-center gap-0.5">
                    <MapPin className="w-3 h-3" />
                    {post.locationName}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {!isOwner && (
            <button
              type="button"
              onClick={toggleFollowAuthor}
              className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                following
                  ? 'bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-200 dark:hover:bg-neutral-700'
                  : 'bg-[#1877F2]/10 text-[#1877F2] hover:bg-[#1877F2]/20'
              }`}
            >
              {following ? <UserCheck className="w-3.5 h-3.5" /> : <UserPlus className="w-3.5 h-3.5" />}
              <span>{following ? 'Following' : 'Follow'}</span>
            </button>
          )}

          <div className="relative">
            <button
              type="button"
              onClick={() => setMenuOpen((o) => !o)}
              aria-label="Post options"
              className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center text-neutral-500"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
            {menuOpen && (
              <div className="animate-dropdown-in absolute right-0 mt-1 w-52 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-lg py-1 z-20 text-xs">
                {onAdjustInterest && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        onAdjustInterest(post.category || 'Technology', 2);
                        setStatusMessage(`More ${post.category || 'similar'} posts will appear in Discover.`);
                        setMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    >
                      <TrendingUp className="w-3.5 h-3.5 text-emerald-600" /> Show more like this
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onAdjustInterest(post.category || 'Technology', -2);
                        setStatusMessage(`Fewer ${post.category || 'similar'} posts will be prioritized.`);
                        setMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    >
                      <TrendingDown className="w-3.5 h-3.5 text-amber-600" /> Show less like this
                    </button>
                  </>
                )}
                {isOwner ? (
                  <>
                    {onTogglePin && (
                      <button
                        type="button"
                        onClick={() => {
                          onTogglePin(post.id);
                          setMenuOpen(false);
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                      >
                        <Pin className="w-3.5 h-3.5 text-[#1877F2]" /> {isPinned ? 'Unpin from Profile' : 'Pin to Profile'}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setEditing(true);
                        setMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    >
                      <Edit3 className="w-3.5 h-3.5" /> Edit Post
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setMenuOpen(false);
                        setConfirmDeleteOpen(true);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                    >
                      <Trash2 className="w-3.5 h-3.5" /> Delete Post
                    </button>
                  </>
                ) : (
                <>
                  {onNotInterested && (
                    <button
                      type="button"
                      onClick={() => {
                        onNotInterested(post.id);
                        setMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    >
                      <EyeOff className="w-3.5 h-3.5" /> Not interested
                    </button>
                  )}
                  {onHideCreator && (
                    <button
                      type="button"
                      onClick={() => {
                        onHideCreator(post.authorId);
                        setMenuOpen(false);
                      }}
                      className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    >
                      <UserX className="w-3.5 h-3.5" /> Hide @{post.authorUsername}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleReport('post', post.id)}
                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    <Flag className="w-3.5 h-3.5" /> Report Post
                  </button>
                  <button
                    type="button"
                    onClick={handleBlock}
                    className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                  >
                    <Ban className="w-3.5 h-3.5" /> Block @{post.authorUsername}
                  </button>
                </>
              )}
            </div>
          )}
          </div>
        </div>
      </div>

      {/* Body text */}
      <div className="px-4 py-2 space-y-3">
        {editing ? (
          <div className="space-y-2">
            <textarea
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              rows={3}
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-sm"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="px-3 py-1.5 rounded-lg text-xs text-neutral-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                className="px-3.5 py-1.5 rounded-lg bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-medium"
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          currentContent && (
            <p className="text-[15px] leading-relaxed text-neutral-900 dark:text-neutral-100 whitespace-pre-wrap break-words">
              {renderFormattedText(currentContent)}
            </p>
          )
        )}

        {post.hashtags && post.hashtags.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 text-xs text-[#1877F2] dark:text-blue-400 font-medium">
            {post.hashtags.map((tag) => (
              <Link key={tag} to={`/discover?q=${encodeURIComponent(tag)}`} className="hover:underline">
                #{tag}
              </Link>
            ))}
          </div>
        )}

        {/* Voice Post */}
        {post.type === 'voice' && post.audioUrl && (
          <VoicePlayer audioUrl={post.audioUrl} durationSeconds={post.audioDuration || 15} />
        )}

        {/* Poll */}
        {post.type === 'poll' && pollOptions.length > 0 && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 space-y-2.5">
            <p className="text-sm font-semibold text-neutral-950 dark:text-white">{post.pollQuestion}</p>
            <div className="space-y-2">
              {pollOptions.map((opt) => {
                const pct = totalVotes > 0 ? Math.round((opt.votes / totalVotes) * 100) : 0;
                const selected = votedOption === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={Boolean(votedOption)}
                    onClick={() => handleVote(opt.id)}
                    className={`relative w-full text-left rounded-lg border px-3 py-2 text-xs font-medium overflow-hidden transition-colors ${
                      selected
                        ? 'border-[#1877F2] text-[#1877F2] dark:text-blue-300'
                        : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-50 dark:hover:bg-neutral-800/50'
                    }`}
                  >
                    {votedOption && (
                      <div
                        className="absolute inset-y-0 left-0 bg-[#1877F2]/10 dark:bg-[#1877F2]/20"
                        style={{ width: `${pct}%` }}
                      />
                    )}
                    <div className="relative flex items-center justify-between">
                      <span>{opt.label}</span>
                      {votedOption && <span className="font-mono">{pct}%</span>}
                    </div>
                  </button>
                );
              })}
            </div>
            <p className="text-[11px] font-mono text-neutral-500">{totalVotes} votes</p>
          </div>
        )}

        {/* Shared Post Snapshot */}
        {post.type === 'shared' && post.sharedPostSnapshot && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 bg-neutral-50 dark:bg-neutral-950/60 space-y-1.5">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-neutral-800 dark:text-neutral-200">
              <span>{post.sharedPostSnapshot.authorName}</span>
              <span className="text-neutral-500 font-normal">@{post.sharedPostSnapshot.authorUsername}</span>
            </div>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">{post.sharedPostSnapshot.content}</p>
          </div>
        )}
      </div>

      {/* Media: Image / Gallery / Video */}
      {post.mediaUrls && post.mediaUrls.length > 0 && (
        <div className="relative bg-neutral-100 dark:bg-neutral-950">
          {post.type === 'video' ? (
            <div className="relative group bg-black">
              <video
                src={videoFallbackActive && post.backupUrl ? post.backupUrl : post.mediaUrls[0]}
                poster={post.thumbnailUrl || undefined}
                controls
                playsInline
                preload="metadata"
                onError={() => {
                  if (!videoFallbackActive && post.backupUrl) {
                    setVideoFallbackActive(true);
                  }
                }}
                className="w-full max-h-[520px] object-contain bg-black"
              />
              <button
                type="button"
                onClick={() => setFullscreenVideoOpen(true)}
                className="absolute top-3 right-3 z-10 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/65 hover:bg-black/85 backdrop-blur-sm text-white text-xs font-semibold transition-colors shadow"
              >
                <Maximize2 className="w-3.5 h-3.5" /> Full Screen
              </button>
            </div>
          ) : (
            <>
              <ResilientImage
                src={post.mediaUrls[galleryIndex]}
                alt={currentContent || `Post by ${post.authorName}`}
                className="w-full max-h-[540px] object-cover"
              />
              {post.mediaUrls.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setGalleryIndex((i) => (i > 0 ? i - 1 : post.mediaUrls!.length - 1))}
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryIndex((i) => (i + 1) % post.mediaUrls!.length)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                  <div className="absolute bottom-3 right-3 rounded-md bg-black/65 px-2 py-0.5 text-[11px] font-mono text-white">
                    {galleryIndex + 1} / {post.mediaUrls.length}
                  </div>
                </>
              )}
            </>
          )}
        </div>
      )}

      {statusMessage && (
        <p className="px-4 pt-2 text-xs text-[#1877F2]">{statusMessage}</p>
      )}

      {/* Reaction & Metric Summary Strip */}
      {(likesCount > 0 || commentsCount > 0 || sharesCount > 0) && (
        <div className="px-4 py-2 flex items-center justify-between text-xs text-neutral-500 dark:text-neutral-400 border-t border-neutral-100 dark:border-neutral-800/60">
          <ReactionSummary summary={reactionsSummary} totalCount={likesCount} />
          <div className="flex items-center gap-3 font-mono tabular-nums">
            {commentsCount > 0 && <span>{formatCompactNumber(commentsCount)} comments</span>}
            {sharesCount > 0 && <span>{formatCompactNumber(sharesCount)} shares</span>}
          </div>
        </div>
      )}

      {/* Action Bar */}
      <div className="flex items-center justify-between px-3 py-1.5 border-t border-neutral-100 dark:border-neutral-800/80">
        <div className="flex items-center gap-1 sm:gap-2">
          <ReactionPickerButton
            currentReaction={userReaction}
            totalCount={likesCount}
            onSelect={handleSelectReaction}
          />

          <button
            type="button"
            onClick={() => setShowComments((s) => !s)}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white min-h-[38px] transition-colors"
          >
            <MessageCircle className="w-4 h-4" />
            <span>Comment</span>
          </button>

          <button
            type="button"
            onClick={handleOpenShare}
            className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-neutral-600 dark:text-neutral-400 hover:text-neutral-950 dark:hover:text-white min-h-[38px] transition-colors"
          >
            <Share2 className="w-4 h-4" />
            <span>Share</span>
          </button>
        </div>

        <div className="flex items-center gap-1">
          {isOwner && !post.isBoosted && (
            <button
              type="button"
              onClick={() => setBoostModalOpen(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-[#1877F2]/10 hover:bg-[#1877F2]/20 text-[#1877F2] text-xs font-semibold transition-colors"
            >
              <Zap className="w-3.5 h-3.5" /> Boost Post
            </button>
          )}
          <button
            type="button"
            onClick={toggleSave}
            aria-label="Save post"
            className={`p-2 rounded-lg transition-colors ${
              saved
                ? 'text-[#1877F2]'
                : 'text-neutral-500 hover:text-neutral-950 dark:hover:text-white'
            }`}
          >
            <Bookmark className={`w-4 h-4 ${saved ? 'fill-current' : ''}`} />
          </button>
        </div>
      </div>

      {/* Comments & Voice Comments */}
      {showComments && (
        <div className="border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950/60 px-4 py-3 space-y-3">
          <div className="space-y-2">
            {replyingTo && (
              <div className="flex items-center justify-between text-[11px] text-blue-600 dark:text-blue-400 px-1">
                <span>
                  Replying to <strong>{replyingTo.authorName}</strong>
                </span>
                <button type="button" onClick={() => setReplyingTo(null)} className="hover:underline inline-flex items-center gap-0.5">
                  <X className="w-3 h-3" /> Cancel
                </button>
              </div>
            )}
            <form onSubmit={submitComment} className="flex items-center gap-2">
              <input
                type="text"
                value={commentText}
                onFocus={() => {
                  if (!firebaseUser) openAuthModal('Sign in to write a comment on BANA.');
                }}
                onChange={(e) => setCommentText(e.target.value)}
                placeholder={replyingTo ? `Reply to ${replyingTo.authorName}...` : 'Write a comment...'}
                className="flex-1 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3.5 py-2 text-xs text-neutral-950 dark:text-white"
              />
              <button
                type="button"
                onClick={() => {
                  if (!firebaseUser) return openAuthModal('Sign in to record and send a voice comment.');
                  setShowVoiceRecorder((v) => !v);
                }}
                title="Record voice comment"
                className={`h-9 px-2.5 rounded-xl border flex items-center justify-center gap-1 text-xs font-medium transition-colors ${
                  showVoiceRecorder
                    ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]'
                    : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-800'
                }`}
              >
                <Mic className="w-4 h-4" />
                <span className="hidden sm:inline">Voice</span>
              </button>
              <button
                type="submit"
                className="h-9 px-3 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-medium inline-flex items-center gap-1 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
              </button>
            </form>

            {firebaseUser && showVoiceRecorder && (
              <VoiceRecorder
                uid={firebaseUser.uid}
                storagePrefix="voice"
                submitLabel="Send Voice Comment"
                onCancel={() => setShowVoiceRecorder(false)}
                onUploaded={handleVoiceCommentUploaded}
              />
            )}
          </div>

          {voiceComments.length > 0 && (
            <div className="space-y-2">
              {voiceComments.map((vc) => (
                <div key={vc.id} className="space-y-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <span className="font-semibold text-neutral-900 dark:text-neutral-100">{vc.authorName}</span>
                    <span className="text-neutral-400">· Voice comment · {formatRelativeTime(vc.createdAt)}</span>
                  </div>
                  <VoicePlayer
                    audioUrl={vc.audioUrl}
                    durationSeconds={vc.durationSeconds}
                    waveform={vc.waveform}
                    canDelete={firebaseUser?.uid === vc.authorId}
                    onDelete={async () => {
                      await deleteDoc(doc(db, 'voiceComments', vc.id));
                      await updateDoc(doc(db, 'posts', post.id), { commentsCount: increment(-1) }).catch(() => {});
                    }}
                    onReport={() => handleReport('voice_comment', vc.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {comments.length > 0 ? (
            <div className="space-y-2.5 pt-1">
              {comments
                .filter((c) => !c.parentCommentId)
                .map((c) => {
                  const replies = comments.filter((r) => r.parentCommentId === c.id);
                  return (
                    <div key={c.id} className="space-y-2">
                      <div className="flex items-start gap-2.5">
                        <Avatar src={c.authorAvatar} name={c.authorName} size="xs" />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">{c.authorName}</span>
                              <span className="text-neutral-400 shrink-0">{formatRelativeTime(c.createdAt)}</span>
                            </div>
                            {firebaseUser?.uid === c.authorId && c.deletionStatus !== 'soft_deleted' && (
                              <button
                                type="button"
                                onClick={() => handleDeleteComment(c)}
                                aria-label="Delete comment"
                                className="p-1 text-neutral-400 hover:text-rose-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            )}
                          </div>
                          <p
                            className={`text-xs mt-0.5 break-words ${
                              c.deletionStatus === 'soft_deleted' || c.moderationStatus === 'removed'
                                ? 'italic text-neutral-400'
                                : 'text-neutral-700 dark:text-neutral-300'
                            }`}
                          >
                            {c.deletionStatus === 'soft_deleted' || c.moderationStatus === 'removed'
                              ? formatVisibleCommentText(c)
                              : renderFormattedText(c.content)}
                          </p>
                          {firebaseUser && c.deletionStatus !== 'soft_deleted' && (
                            <button
                              type="button"
                              onClick={() => setReplyingTo(c)}
                              className="mt-1 inline-flex items-center gap-1 text-[11px] font-medium text-neutral-500 hover:text-[#1877F2]"
                            >
                              <CornerDownRight className="w-3 h-3" /> Reply
                            </button>
                          )}
                        </div>
                      </div>
                      {replies.length > 0 && (
                        <div className="ml-8 pl-3 border-l border-neutral-200 dark:border-neutral-800 space-y-2">
                          {replies.map((rep) => (
                            <div key={rep.id} className="flex items-start gap-2">
                              <Avatar src={rep.authorAvatar} name={rep.authorName} size="xs" />
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center justify-between gap-2 text-xs">
                                  <div className="flex items-center gap-1.5 min-w-0">
                                    <span className="font-semibold text-neutral-900 dark:text-neutral-100 truncate">{rep.authorName}</span>
                                    <span className="text-neutral-400 shrink-0">{formatRelativeTime(rep.createdAt)}</span>
                                  </div>
                                  {firebaseUser?.uid === rep.authorId && rep.deletionStatus !== 'soft_deleted' && (
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteComment(rep)}
                                      aria-label="Delete reply"
                                      className="p-1 text-neutral-400 hover:text-rose-600"
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  )}
                                </div>
                                <p
                                  className={`text-xs mt-0.5 break-words ${
                                    rep.deletionStatus === 'soft_deleted' || rep.moderationStatus === 'removed'
                                      ? 'italic text-neutral-400'
                                      : 'text-neutral-700 dark:text-neutral-300'
                                  }`}
                                >
                                  {rep.deletionStatus === 'soft_deleted' || rep.moderationStatus === 'removed'
                                    ? formatVisibleCommentText(rep)
                                    : renderFormattedText(rep.content)}
                                </p>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              {comments.length >= commentLimit && (
                <button
                  type="button"
                  onClick={() => setCommentLimit((l) => l + 30)}
                  className="w-full py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-[11px] font-semibold text-[#1877F2] hover:bg-neutral-100 dark:hover:bg-neutral-900"
                >
                  Load more comments
                </button>
              )}
            </div>
          ) : (
            voiceComments.length === 0 && (
              <p className="text-xs text-neutral-500 text-center py-2">No comments yet. Start the conversation.</p>
            )
          )}
        </div>
      )}
    </article>

    <ShareToMessengerModal
      isOpen={shareModalOpen}
      payload={{
        targetType: 'post',
        targetId: post.id,
        authorId: post.authorId,
        authorName: post.authorName,
        authorUsername: post.authorUsername,
        content: currentContent,
        mediaUrl: post.mediaUrls?.[0] || '',
      }}
      onClose={() => setShareModalOpen(false)}
      onShared={() => setSharesCount((s) => s + 1)}
    />

    {post.type === 'video' && post.mediaUrls?.[0] && (
      <FullscreenVideoModal
        isOpen={fullscreenVideoOpen}
        post={post}
        videoUrl={post.mediaUrls[0]}
        currentReaction={userReaction}
        likesCount={likesCount}
        commentsCount={commentsCount}
        saved={saved}
        onReact={handleSelectReaction}
        onToggleSave={toggleSave}
        onOpenShare={() => {
          setFullscreenVideoOpen(false);
          handleOpenShare();
        }}
        onBoost={() => {
          setFullscreenVideoOpen(false);
          setBoostModalOpen(true);
        }}
        onClose={() => setFullscreenVideoOpen(false)}
      />
    )}

    <BoostAndPaymentModal
      isOpen={boostModalOpen}
      mode="boost_post"
      targetCollection="posts"
      targetId={post.id}
      targetTitle={currentContent.slice(0, 60) || 'BANA Post'}
      onClose={() => setBoostModalOpen(false)}
      onSubmitted={() => {
        setStatusMessage('Boost request submitted for Admin verification.');
        toast.success('Boost request submitted for Admin verification.');
      }}
    />

    <ConfirmDialog
      isOpen={confirmDeleteOpen}
      title="Delete this post?"
      description="This post will be permanently deleted from BANA and cannot be recovered."
      confirmLabel="Delete Post"
      loading={deletingPost}
      onConfirm={handleDeletePost}
      onCancel={() => setConfirmDeleteOpen(false)}
    />
  </>
  );
}
