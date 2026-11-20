import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Send, Mic, Heart, Flag, Trash2, CornerDownRight } from 'lucide-react';
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
  const [likedCommentIds, setLikedCommentIds] = useState<Record<string, boolean>>({});
  const [commentInput, setCommentInput] = useState('');
  const [replyTo, setReplyTo] = useState<BanaComment | null>(null);
  const [showVoiceRec, setShowVoiceRec] = useState(false);

  useEffect(() => {
    if (!reel) return;
    setReplyTo(null);
    setShowVoiceRec(false);
    setCommentInput('');

    const unsubC = subscribeWithIndexFallback<BanaComment>({
      primaryQuery: query(collection(db, 'comments'), where('targetId', '==', reel.id), orderBy('createdAt', 'asc'), limit(commentLimit)),
      fallbackQuery: query(collection(db, 'comments'), where('targetId', '==', reel.id), limit(commentLimit)),
      comparator: sortByCreatedAtAsc,
      onData: (list) => {
        setComments(list);

        if (firebaseUser) {
          Promise.all(
            list.slice(0, 30).map(async (c) => {
              const s = await getDoc(doc(db, 'commentLikes', `${c.id}_${firebaseUser.uid}`)).catch(() => null);
              return [c.id, Boolean(s?.exists())] as const;
            })
          ).then((pairs) => {
            const map: Record<string, boolean> = {};
            pairs.forEach(([id, liked]) => {
              map[id] = liked;
            });
            setLikedCommentIds(map);
          });
        }
      },
      onError: () => {},
    });

    const unsubVc = subscribeWithIndexFallback<BanaVoiceComment>({
      primaryQuery: query(collection(db, 'voiceComments'), where('targetId', '==', reel.id), orderBy('createdAt', 'desc'), limit(15)),
      fallbackQuery: query(collection(db, 'voiceComments'), where('targetId', '==', reel.id), limit(15)),
      comparator: sortByCreatedAtDesc,
      onData: (list) => setVoiceComments(list),
      onError: () => {},
    });

    return () => {
      unsubC();
      unsubVc();
    };
  }, [reel, firebaseUser, commentLimit]);

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

  const toggleCommentLike = async (c: BanaComment) => {
    if (!firebaseUser) {
      openAuthModal('Sign in to like comments.');
      return;
    }
    const likeId = `${c.id}_${firebaseUser.uid}`;
    const ref = doc(db, 'commentLikes', likeId);
    const currentlyLiked = Boolean(likedCommentIds[c.id]);

    setLikedCommentIds((prev) => ({ ...prev, [c.id]: !currentlyLiked }));
    setComments((prev) =>
      prev.map((item) =>
        item.id === c.id
          ? { ...item, likesCount: Math.max(0, (item.likesCount || 0) + (currentlyLiked ? -1 : 1)) }
          : item
      )
    );

    try {
      if (currentlyLiked) {
        await deleteDoc(ref);
        await updateDoc(doc(db, 'comments', c.id), { likesCount: increment(-1) }).catch(() => {});
      } else {
        await setDoc(ref, {
          userId: firebaseUser.uid,
          commentId: c.id,
          createdAt: serverTimestamp(),
        });
        await updateDoc(doc(db, 'comments', c.id), { likesCount: increment(1) }).catch(() => {});
      }
    } catch {
      setLikedCommentIds((prev) => ({ ...prev, [c.id]: currentlyLiked }));
    }
  };

  const handleReportComment = async (targetType: 'comment' | 'voice_comment', targetId: string) => {
    if (!firebaseUser) {
      openAuthModal('Sign in to report comments.');
      return;
    }
    await addDoc(collection(db, 'reports'), {
      reporterId: firebaseUser.uid,
      targetType,
      targetId,
      reason: 'Comment moderation review',
      details: `Reported on Reel ${reel.id}`,
      status: 'pending',
      createdAt: serverTimestamp(),
    })
      .then(() => toast.info('Comment reported for moderation review.'))
      .catch(() => toast.error('Could not submit report.'));
  };

  const renderCommentRow = (c: BanaComment, isReply = false) => {
    const isOwner = firebaseUser?.uid === c.authorId;
    const isLiked = Boolean(likedCommentIds[c.id]);
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
              <span className="text-[#1877F2] font-medium mr-1">@{c.replyToUsername}</span>
            )}
            {formatVisibleCommentText(c)}
          </p>

          <div className="flex items-center gap-4 mt-1.5 text-[11px] text-neutral-500">
            <button
              type="button"
              onClick={() => toggleCommentLike(c)}
              className={`inline-flex items-center gap-1 font-medium ${
                isLiked ? 'text-rose-600' : 'hover:text-neutral-900 dark:hover:text-white'
              }`}
            >
              <Heart className={`w-3 h-3 ${isLiked ? 'fill-current' : ''}`} />
              <span className="tabular-nums">{c.likesCount || 0}</span>
            </button>
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
              Comments ({comments.length + voiceComments.length})
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
                  className="w-full py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold text-[#1877F2] hover:bg-neutral-50 dark:hover:bg-neutral-900"
                >
                  Load more comments
                </button>
              )}
            </div>
          )}

          {comments.length === 0 && voiceComments.length === 0 && (
            <p className="text-xs text-neutral-500 text-center py-10">
              No comments yet on this Reel. Start the conversation with text or voice.
            </p>
          )}
        </div>

        <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2 pb-safe bg-white dark:bg-neutral-950">
          {replyTo && (
            <div className="flex items-center justify-between px-3 py-1.5 rounded-lg bg-[#1877F2]/10 text-[#1877F2] text-[11px] font-medium">
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
                  ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2]'
                  : 'border-neutral-200 dark:border-neutral-800'
              }`}
            >
              <Mic className="w-4 h-4" />
            </button>
            <button
              type="submit"
              aria-label="Post comment"
              className="min-h-[44px] px-4 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold flex items-center justify-center transition-colors"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </aside>
    </div>
  );
}
