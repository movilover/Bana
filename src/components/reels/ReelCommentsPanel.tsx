import { submitReport } from '@/src/lib/reports';
import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Send, Mic, Heart, Flag, Trash2, CornerDownRight } from 'lucide-react';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import {
  sortByCreatedAtAsc,
  sortByCreatedAtDesc,
  subscribeWithIndexFallback,
} from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { BanaComment, BanaReel, BanaVoiceComment } from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { CommentSkeleton, ErrorNotice } from '@/src/components/common/Skeletons';
import { ReactionPickerButton } from '@/src/components/feed/ReactionBar';
import { useMyCommentReactions, writeCommentReaction } from '@/src/lib/commentReactions';
import type { ReactionType } from '@/src/types/bana';
import { VoicePlayer, VoiceRecorder } from '@/src/components/voice/VoiceRecorderAndPlayer';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import {
  createHardenedComment,
  formatVisibleCommentText,
  softDeleteComment,
} from '@/src/lib/comments';

interface ReelCommentsPanelProps {
  reel: BanaReel | null;
  onClose: () => void;
}

export function ReelCommentsPanel({ reel, onClose }: ReelCommentsPanelProps) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [comments, setComments] = useState<BanaComment[]>([]);
  const [commentLimit, setCommentLimit] = useState(30);
  const [voiceComments, setVoiceComments] = useState<BanaVoiceComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const { mine: myReactions, set: setMyReaction } = useMyCommentReactions(
    firebaseUser?.uid,
    comments.map((c) => c.id)
  );
  const reactBusy = React.useRef<Set<string>>(new Set());
  const [commentInput, setCommentInput] = useState('');
  const [replyTo, setReplyTo] = useState<BanaComment | null>(null);
  const [showVoiceRec, setShowVoiceRec] = useState(false);

  useEffect(() => {
    if (!reel) return;
    setReplyTo(null);
    setShowVoiceRec(false);
    setCommentInput('');
    setCommentsLoading(true);
    setCommentsError(null);
    const loadTimer = window.setTimeout(() => {
      setCommentsLoading(false);
      setCommentsError('Comments are taking too long to load. Check your connection and retry.');
    }, 15000);

    const unsubC = subscribeWithIndexFallback<BanaComment>({
      primaryQuery: query(collection(db, 'comments'), where('targetId', '==', reel.id), orderBy('createdAt', 'asc'), limit(commentLimit)),
      fallbackQuery: query(collection(db, 'comments'), where('targetId', '==', reel.id), limit(commentLimit)),
      comparator: sortByCreatedAtAsc,
      onData: (list) => {
        window.clearTimeout(loadTimer);
        setComments(list);
        setCommentsLoading(false);
        setCommentsError(null);
      },
      onError: () => {
        window.clearTimeout(loadTimer);
        setCommentsLoading(false);
        setCommentsError('Comments could not be loaded right now.');
      },
    });

    const unsubVc = subscribeWithIndexFallback<BanaVoiceComment>({
      primaryQuery: query(collection(db, 'voiceComments'), where('targetId', '==', reel.id), orderBy('createdAt', 'desc'), limit(15)),
      fallbackQuery: query(collection(db, 'voiceComments'), where('targetId', '==', reel.id), limit(15)),
      comparator: sortByCreatedAtDesc,
      onData: (list) => setVoiceComments(list),
      onError: () => {},
    });

    return () => {
      window.clearTimeout(loadTimer);
      unsubC();
      unsubVc();
    };
  }, [reel, commentLimit, reloadKey]);

  if (!reel) return null;

  const topComments = comments.filter((c) => !c.parentCommentId);
  const repliesByParent = comments.reduce<Record<string, BanaComment[]>>((acc, c) => {
    if (c.parentCommentId) {
      acc[c.parentCommentId] = acc[c.parentCommentId] || [];
      acc[c.parentCommentId].push(c);
    }
    return acc;
  }, {});

  const handleSendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to comment on this Reel.');
      return;
    }
    if (!commentInput.trim()) return;
    const text = commentInput.trim();
    const parent = replyTo;
    setCommentInput('');
    setReplyTo(null);

    try {
      await createHardenedComment({
        targetType: 'reel',
        targetId: reel.id,
        authorId: firebaseUser.uid,
        authorUsername: profile.username,
        authorName: profile.displayName,
        authorAvatar: profile.avatarUrl || '',
        content: text,
        parentCommentId: parent?.id,
        replyToUsername: parent?.authorUsername,
      });
    } catch (err: any) {
      if (err?.message !== 'Duplicate submission ignored.') {
        toast.error('Failed to post comment. Ensure your email is verified.');
      }
    }
  };

  const handleCommentReaction = async (c: BanaComment, reaction: ReactionType) => {
    if (!firebaseUser) {
      openAuthModal('Sign in to react to comments.');
      return;
    }
    if (reactBusy.current.has(c.id)) return;
    reactBusy.current.add(c.id);
    const previous = myReactions[c.id] ?? null;
    const next = previous === reaction ? null : reaction;
    const delta = !previous && next ? 1 : previous && !next ? -1 : 0;
    setMyReaction(c.id, next);
    setComments((prev) =>
      prev.map((item) => (item.id === c.id ? { ...item, likesCount: Math.max(0, (item.likesCount || 0) + delta) } : item))
    );
    try {
      await writeCommentReaction({ commentId: c.id, uid: firebaseUser.uid, previous, next });
    } catch {
      setMyReaction(c.id, previous);
      setComments((prev) =>
        prev.map((item) => (item.id === c.id ? { ...item, likesCount: Math.max(0, (item.likesCount || 0) - delta) } : item))
      );
      toast.error('Could not update your reaction. Please try again.');
    } finally {
      reactBusy.current.delete(c.id);
    }
  };

  const handleReportComment = async (targetType: 'comment' | 'voice_comment', targetId: string) => {
    if (!firebaseUser) {
      openAuthModal('Sign in to report comments.');
      return;
    }
    await submitReport({
      reporterId: firebaseUser.uid, targetType, targetId, reason: 'Comment moderation review', details: `Reported on Reel ${reel.id}`,
    })
      .then((o) => (o === 'duplicate' ? toast.info('You already reported this comment.') : toast.info('Comment reported for moderation review.')))
      .catch(() => toast.error('Could not submit report.'));
  };

  const renderCommentRow = (c: BanaComment, isReply = false) => {
    const isOwner = firebaseUser?.uid === c.authorId;
    return (
      <div key={c.id} className={`flex items-start gap-2.5 ${isReply ? 'pl-8 pt-2' : ''}`}>
        <Link to={`/profile/${c.authorUsername}`} className="shrink-0">
          <Avatar src={c.authorAvatar} name={c.authorName} size="xs" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0 text-xs">
              <Link to={`/profile/${c.authorUsername}`} className="font-semibold truncate hover:underline">
                {c.authorName}
              </Link>
              <LiveVerifiedBadge uid={c.authorId} size={12} />
              <span className="text-[11px] text-neutral-400 shrink-0">{formatRelativeTime(c.createdAt)}</span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {isOwner && c.deletionStatus !== 'soft_deleted' ? (
                <button
                  type="button"
                  onClick={() =>
                    softDeleteComment(
                      c,
                      firebaseUser!.uid,
                      comments.some((r) => r.parentCommentId === c.id)
                    )
                      .then(() => toast.info('Comment removed (recoverable by moderators).'))
                      .catch(() => toast.error('Could not delete comment.'))
                  }
                  aria-label="Delete own comment"
                  className="p-1 text-neutral-400 hover:text-rose-600"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => handleReportComment('comment', c.id)}
                  aria-label="Report comment"
                  className="p-1 text-neutral-400 hover:text-amber-600"
                >
                  <Flag className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>

          <p
            className={`text-xs mt-0.5 break-words ${
              c.deletionStatus === 'soft_deleted' || c.moderationStatus === 'removed'
                ? 'italic text-neutral-400'
                : 'text-neutral-700 dark:text-neutral-300'
            }`}
          >
            {c.replyToUsername && c.deletionStatus !== 'soft_deleted' && (
              <span className="text-brand font-medium mr-1">@{c.replyToUsername}</span>
            )}
            {formatVisibleCommentText(c)}
          </p>

          <div className="flex items-center gap-4 mt-1.5 text-[11px] text-neutral-500">
            {c.deletionStatus !== 'soft_deleted' && (
              <ReactionPickerButton
                variant="inline"
                currentReaction={myReactions[c.id] ?? null}
                totalCount={c.likesCount || 0}
                onSelect={(r) => handleCommentReaction(c, r)}
              />
            )}
            {!isReply && c.deletionStatus !== 'soft_deleted' && (
              <button
                type="button"
                onClick={() => setReplyTo(c)}
                className="inline-flex items-center gap-1 font-medium hover:text-neutral-900 dark:hover:text-white"
              >
                <CornerDownRight className="w-3 h-3" /> Reply
              </button>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className="fixed inset-0 z-40 bg-black/55 backdrop-blur-xs flex items-end lg:static lg:inset-auto lg:z-auto lg:bg-transparent lg:backdrop-blur-none lg:flex lg:items-stretch shrink-0"
      onClick={onClose}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full max-h-[82vh] rounded-t-3xl lg:rounded-2xl lg:w-[390px] lg:max-h-[calc(100vh-2rem)] bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Mobile Drag Handle */}
        <div className="lg:hidden w-10 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-700 mx-auto mt-2.5 shrink-0" />

        <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
          <div className="min-w-0">
            <h3 className="font-display font-bold text-sm truncate">
              Comments ({comments.filter((c) => c.deletionStatus !== 'soft_deleted').length + voiceComments.length})
            </h3>
            <p className="text-[11px] text-neutral-500 truncate">@{reel.authorUsername}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close comments"
            className="min-h-[44px] min-w-[44px] rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {voiceComments.length > 0 && (
            <div className="space-y-2.5">
              <p className="text-[11px] font-semibold text-neutral-500">Voice Comments ({voiceComments.length})</p>
              {voiceComments.map((vc) => (
                <div key={vc.id} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <Link to={`/profile/${vc.authorUsername}`} className="font-semibold hover:underline">
                      {vc.authorName}
                    </Link>
                    <span className="text-[11px] text-neutral-400">{formatRelativeTime(vc.createdAt)}</span>
                  </div>
                  <VoicePlayer
                    audioUrl={vc.audioUrl}
                    durationSeconds={vc.durationSeconds}
                    waveform={vc.waveform}
                    canDelete={firebaseUser?.uid === vc.authorId}
                    onDelete={() =>
                      deleteDoc(doc(db, 'voiceComments', vc.id))
                        .then(() => toast.info('Voice comment deleted.'))
                        .catch(() => toast.error('Could not delete voice comment.'))
                    }
                    onReport={() => handleReportComment('voice_comment', vc.id)}
                  />
                </div>
              ))}
            </div>
          )}

          {topComments.length > 0 && (
            <div className="space-y-3.5">
              {topComments.map((c) => (
                <div key={c.id} className="space-y-1">
                  {renderCommentRow(c, false)}
                  {(repliesByParent[c.id] || []).map((reply) => renderCommentRow(reply, true))}
                </div>
              ))}
              {comments.length >= commentLimit && (
                <button
                  type="button"
                  onClick={() => setCommentLimit((l) => l + 30)}
                  className="w-full py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-brand hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  Load more comments
                </button>
              )}
            </div>
          )}

          {commentsLoading && comments.length === 0 && <CommentSkeleton rows={4} />}
          {commentsError && comments.length === 0 && (
            <ErrorNotice message={commentsError} onRetry={() => setReloadKey((n) => n + 1)} />
          )}

          {!commentsLoading && !commentsError && comments.length === 0 && voiceComments.length === 0 && (
            <p className="text-xs text-neutral-500 text-center py-10">
              No comments yet on this Reel. Start the conversation with text or voice.
            </p>
          )}
        </div>

        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2 pb-safe bg-white dark:bg-neutral-950">
          {replyTo && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-brand/10 text-brand text-[11px] font-medium">
              <span>Replying to @{replyTo.authorUsername}</span>
              <button type="button" onClick={() => setReplyTo(null)} aria-label="Cancel reply">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )}

          {firebaseUser && profile && showVoiceRec && (
            <VoiceRecorder
              uid={firebaseUser.uid}
              storagePrefix="voice"
              submitLabel="Post Voice"
              onCancel={() => setShowVoiceRec(false)}
              onUploaded={async (payload) => {
                await addDoc(collection(db, 'voiceComments'), {
                  targetType: 'reel',
                  targetId: reel.id,
                  authorId: firebaseUser.uid,
                  authorUsername: profile.username,
                  authorName: profile.displayName,
                  authorAvatar: profile.avatarUrl || '',
                  ...payload,
                  createdAt: serverTimestamp(),
                });
                toast.success('Voice comment posted.');
                setShowVoiceRec(false);
              }}
            />
          )}

          <form onSubmit={handleSendComment} className="flex items-center gap-2">
            <input
              type="text"
              value={commentInput}
              onFocus={() => {
                if (!firebaseUser) openAuthModal('Sign in to comment on this Reel.');
              }}
              onChange={(e) => setCommentInput(e.target.value)}
              placeholder={replyTo ? `Reply to @${replyTo.authorUsername}...` : 'Add a comment...'}
              className="flex-1 min-h-[44px] rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
            />
            <button
              type="button"
              onClick={() => {
                if (!firebaseUser) return openAuthModal('Sign in to record a voice comment.');
                setShowVoiceRec((v) => !v);
              }}
              aria-label="Record voice comment"
              className={`min-h-[44px] min-w-[44px] rounded-xl border flex items-center justify-center transition-colors ${
                showVoiceRec
                  ? 'border-brand bg-brand/10 text-brand'
                  : 'border-neutral-200 dark:border-neutral-800'
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>
            <button
              type="submit"
              aria-label="Post comment"
              className="min-h-[44px] px-4 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold flex items-center justify-center transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
