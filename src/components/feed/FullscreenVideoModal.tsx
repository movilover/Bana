import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  X,
  MessageCircle,
  Share2,
  Bookmark,
  Volume2,
  VolumeX,
  Mic,
  Send,
  Zap,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import {
  sortByCreatedAtAsc,
  sortByCreatedAtDesc,
  subscribeWithIndexFallback,
} from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import type {
  BanaPost,
  BanaComment,
  BanaVoiceComment,
  ReactionType,
} from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { VerifiedBadge } from '@/src/components/common/BanaLogo';
import { ReactionPickerButton } from '@/src/components/feed/ReactionBar';
import { VoicePlayer, VoiceRecorder } from '@/src/components/voice/VoiceRecorderAndPlayer';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import { createHardenedComment, formatVisibleCommentText } from '@/src/lib/comments';

export function FullscreenVideoModal({
  isOpen,
  post,
  videoUrl,
  currentReaction,
  likesCount,
  commentsCount,
  saved,
  onReact,
  onToggleSave,
  onOpenShare,
  onBoost,
  onClose,
}: {
  isOpen: boolean;
  post: BanaPost;
  videoUrl: string;
  currentReaction: ReactionType | null;
  likesCount: number;
  commentsCount: number;
  saved: boolean;
  onReact: (reaction: ReactionType) => void;
  onToggleSave: () => void;
  onOpenShare: () => void;
  onBoost?: () => void;
  onClose: () => void;
}) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const [muted, setMuted] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [comments, setComments] = useState<BanaComment[]>([]);
  const [voiceComments, setVoiceComments] = useState<BanaVoiceComment[]>([]);
  const [commentText, setCommentText] = useState('');
  const [showVoiceRec, setShowVoiceRec] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !drawerOpen) return;
    const unsubC = subscribeWithIndexFallback<BanaComment>({
      primaryQuery: query(collection(db, 'comments'), where('targetId', '==', post.id), orderBy('createdAt', 'asc'), limit(30)),
      fallbackQuery: query(collection(db, 'comments'), where('targetId', '==', post.id), limit(30)),
      comparator: sortByCreatedAtAsc,
      onData: (list) => setComments(list),
    });
    const unsubVc = subscribeWithIndexFallback<BanaVoiceComment>({
      primaryQuery: query(collection(db, 'voiceComments'), where('targetId', '==', post.id), orderBy('createdAt', 'desc'), limit(15)),
      fallbackQuery: query(collection(db, 'voiceComments'), where('targetId', '==', post.id), limit(15)),
      comparator: sortByCreatedAtDesc,
      onData: (list) => setVoiceComments(list),
    });
    return () => {
      unsubC();
      unsubVc();
    };
  }, [isOpen, drawerOpen, post.id]);

  if (!isOpen) return null;

  const isOwner = firebaseUser?.uid === post.authorId;

  const [activeSrc, setActiveSrc] = useState(videoUrl);

  useEffect(() => {
    setActiveSrc(videoUrl);
  }, [videoUrl]);

  const submitComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return openAuthModal('Sign in to comment on this video.');
    if (!commentText.trim()) return;
    const content = commentText.trim();
    setCommentText('');
    await createHardenedComment({
      targetType: 'post',
      targetId: post.id,
      authorId: firebaseUser.uid,
      authorUsername: profile.username,
      authorName: profile.displayName,
      authorAvatar: profile.avatarUrl || '',
      content,
    }).catch(() => {});
  };

  return (
    <div className="fixed inset-0 z-50 bg-black flex items-center justify-center">
      <div className="relative h-screen w-full max-w-[460px] bg-black flex items-center justify-center overflow-hidden">
        <video
          src={activeSrc}
          poster={post.thumbnailUrl || undefined}
          autoPlay
          loop
          muted={muted}
          playsInline
          controls={false}
          onError={() => {
            if (post.backupUrl && activeSrc !== post.backupUrl) {
              setActiveSrc(post.backupUrl);
            }
          }}
          onClick={(e) => {
            const v = e.currentTarget;
            if (v.paused) v.play().catch(() => {});
            else v.pause();
          }}
          className="w-full h-full object-cover cursor-pointer"
        />

        {/* Top Bar */}
        <div className="absolute top-4 inset-x-4 z-20 flex items-center justify-between text-white">
          <span className="text-xs font-semibold tracking-wide bg-black/50 backdrop-blur-sm px-3 py-1.5 rounded-full">
            BANA Full-Screen Video
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setMuted((m) => !m)}
              aria-label={muted ? 'Unmute' : 'Mute'}
              className="h-9 w-9 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center"
            >
              {muted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Exit full screen"
              className="h-9 w-9 rounded-full bg-black/55 backdrop-blur-sm flex items-center justify-center"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Right Overlay Controls */}
        <div className="absolute right-3 bottom-24 z-20 flex flex-col items-center gap-4 text-white">
          <ReactionPickerButton
            variant="overlay"
            currentReaction={currentReaction}
            totalCount={likesCount}
            onSelect={onReact}
          />

          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="flex flex-col items-center gap-1"
          >
            <span className="h-11 w-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <MessageCircle className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-mono font-semibold tabular-nums">{commentsCount}</span>
          </button>

          <button
            type="button"
            onClick={onOpenShare}
            className="flex flex-col items-center gap-1"
          >
            <span className="h-11 w-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center">
              <Share2 className="w-5 h-5" />
            </span>
            <span className="text-[11px] font-medium">Share</span>
          </button>

          <button
            type="button"
            onClick={onToggleSave}
            className="flex flex-col items-center gap-1"
          >
            <span
              className={`h-11 w-11 rounded-full bg-black/50 backdrop-blur-sm flex items-center justify-center ${
                saved ? 'text-[#1877F2]' : 'text-white'
              }`}
            >
              <Bookmark className={`w-5 h-5 ${saved ? 'fill-current' : ''}`} />
            </span>
            <span className="text-[11px] font-medium">Save</span>
          </button>

          {isOwner && onBoost && (
            <button
              type="button"
              onClick={onBoost}
              className="flex flex-col items-center gap-1"
            >
              <span className="h-11 w-11 rounded-full bg-[#1877F2] text-white flex items-center justify-center shadow-lg">
                <Zap className="w-5 h-5" />
              </span>
              <span className="text-[11px] font-medium">Boost</span>
            </button>
          )}
        </div>

        {/* Bottom Author & Caption Scrim */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-4 pr-16 bg-gradient-to-t from-black/85 via-black/45 to-transparent text-white space-y-1.5">
          <Link
            to={`/profile/${post.authorUsername}`}
            onClick={onClose}
            className="inline-flex items-center gap-2 font-semibold text-sm"
          >
            <Avatar src={post.authorAvatar} name={post.authorName} size="sm" />
            <span>{post.authorName}</span>
            {post.authorVerified && <VerifiedBadge size={14} />}
          </Link>
          {post.content && <p className="text-xs leading-relaxed line-clamp-3">{post.content}</p>}
        </div>

        {/* Slide-up Comments & Voice Comments Drawer */}
        {drawerOpen && (
          <div className="absolute inset-0 z-30 bg-black/50 flex items-end">
            <div className="w-full rounded-t-3xl bg-white dark:bg-neutral-950 text-neutral-950 dark:text-white max-h-[75vh] flex flex-col overflow-hidden">
              <div className="flex items-center justify-between px-4 py-3 border-b border-neutral-200 dark:border-neutral-800">
                <h4 className="font-display font-bold text-sm">Comments & Voice Notes</h4>
                <button type="button" onClick={() => setDrawerOpen(false)} className="p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {voiceComments.map((vc) => (
                  <div key={vc.id} className="space-y-1">
                    <p className="text-xs font-semibold">
                      {vc.authorName}{' '}
                      <span className="text-neutral-400 font-normal">· {formatRelativeTime(vc.createdAt)}</span>
                    </p>
                    <VoicePlayer
                      audioUrl={vc.audioUrl}
                      durationSeconds={vc.durationSeconds}
                      waveform={vc.waveform}
                    />
                  </div>
                ))}
                {comments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2.5">
                    <Avatar src={c.authorAvatar} name={c.authorName} size="xs" />
                    <div>
                      <p className="text-xs font-semibold">
                        {c.authorName}{' '}
                        <span className="text-neutral-400 font-normal">{formatRelativeTime(c.createdAt)}</span>
                      </p>
                      <p className="text-xs text-neutral-700 dark:text-neutral-300 mt-0.5">
                        {formatVisibleCommentText(c)}
                      </p>
                    </div>
                  </div>
                ))}
                {comments.length === 0 && voiceComments.length === 0 && (
                  <p className="text-xs text-neutral-500 text-center py-6">
                    No comments yet. Leave a text or voice reply below.
                  </p>
                )}
              </div>

              <div className="p-3 border-t border-neutral-200 dark:border-neutral-800 space-y-2">
                {firebaseUser && profile && showVoiceRec && (
                  <VoiceRecorder
                    uid={firebaseUser.uid}
                    storagePrefix="voice"
                    submitLabel="Post Voice"
                    onCancel={() => setShowVoiceRec(false)}
                    onUploaded={async (vp) => {
                      await addDoc(collection(db, 'voiceComments'), {
                        targetType: 'post',
                        targetId: post.id,
                        authorId: firebaseUser.uid,
                        authorUsername: profile.username,
                        authorName: profile.displayName,
                        authorAvatar: profile.avatarUrl || '',
                        ...vp,
                        createdAt: serverTimestamp(),
                      });
                      setShowVoiceRec(false);
                    }}
                  />
                )}
                <form onSubmit={submitComment} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={commentText}
                    onFocus={() => {
                      if (!firebaseUser) openAuthModal('Sign in to comment on this video.');
                    }}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Write a comment..."
                    className="flex-1 h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!firebaseUser) return openAuthModal('Sign in to send a voice comment.');
                      setShowVoiceRec((v) => !v);
                    }}
                    className="h-9 w-9 rounded-xl border border-neutral-200 dark:border-neutral-800 flex items-center justify-center"
                  >
                    <Mic className="w-4 h-4" />
                  </button>
                  <button type="submit" className="h-9 px-3 rounded-xl bg-[#1877F2] text-white text-xs">
                    <Send className="w-3.5 h-3.5" />
                  </button>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
