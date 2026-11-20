import React, { useEffect, useState } from 'react';
import { X, Search, Send, Check, Repeat2, Link2, Share2 } from 'lucide-react';
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  addDoc,
  updateDoc,
  doc,
  serverTimestamp,
  increment,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { BanaUser } from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { checkPairBlockedAndPrivacy } from '@/src/lib/webrtcCalling';

export interface SharePayload {
  targetType: 'post' | 'reel';
  targetId: string;
  authorId: string;
  authorName: string;
  authorUsername: string;
  content: string;
  mediaUrl?: string;
}

export function ShareToMessengerModal({
  isOpen,
  payload,
  onClose,
  onShared,
}: {
  isOpen: boolean;
  payload: SharePayload | null;
  onClose: () => void;
  onShared?: () => void;
}) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();
  const [users, setUsers] = useState<BanaUser[]>([]);
  const [search, setSearch] = useState('');
  const [note, setNote] = useState('');
  const [sentIds, setSentIds] = useState<string[]>([]);
  const [sendingUid, setSendingUid] = useState<string | null>(null);
  const [reposted, setReposted] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setSentIds([]);
    setReposted(false);
    setCopied(false);
    setNote('');

    if (!firebaseUser) {
      setUsers([]);
      return;
    }

    getDocs(query(collection(db, 'users'), limit(30)))
      .then((snap) => {
        setUsers(
          snap.docs
            .map((d) => ({ uid: d.id, ...(d.data() as Omit<BanaUser, 'uid'>) }))
            .filter((u) => u.uid !== firebaseUser.uid)
        );
      })
      .catch(() => {});
  }, [isOpen, firebaseUser]);

  if (!isOpen || !payload) return null;

  const shareUrl =
    payload.targetType === 'reel'
      ? `${window.location.origin}/reels?reel=${encodeURIComponent(payload.targetId)}`
      : `${window.location.origin}/profile/${payload.authorUsername}`;

  const filteredUsers = users.filter((u) => {
    if (!search.trim()) return true;
    const hay = `${u.displayName} ${u.username}`.toLowerCase();
    return hay.includes(search.toLowerCase());
  });

  const handleSendToFriend = async (friend: BanaUser) => {
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to send this in BANA Messenger.');
      return;
    }
    if (profile.messagingRestricted) {
      toast.error('Your account messaging privileges are currently restricted.');
      return;
    }
    if (sendingUid || sentIds.includes(friend.uid)) return;
    setSendingUid(friend.uid);
    try {
      const privacy = await checkPairBlockedAndPrivacy(firebaseUser.uid, friend.uid, 'message');
      if (privacy.status === 'blocked' || privacy.status === 'denied') {
        toast.error(privacy.reason || 'You cannot message this user.');
        setSendingUid(null);
        return;
      }

      const existingSnap = await getDocs(
        query(collection(db, 'conversations'), where('participantIds', 'array-contains', firebaseUser.uid))
      );
      const existing = existingSnap.docs.find((d) => {
        const data = d.data();
        return !data.isGroup && Array.isArray(data.participantIds) && data.participantIds.includes(friend.uid);
      });

      const summaryText = `Shared a ${payload.targetType === 'reel' ? 'Reel' : 'post'}`;
      let convId = existing?.id;
      if (!convId) {
        const convRef = await addDoc(collection(db, 'conversations'), {
          participantIds: [firebaseUser.uid, friend.uid],
          participantMeta: {
            [firebaseUser.uid]: {
              displayName: profile.displayName,
              username: profile.username,
              avatarUrl: profile.avatarUrl || '',
            },
            [friend.uid]: {
              displayName: friend.displayName,
              username: friend.username,
              avatarUrl: friend.avatarUrl || '',
            },
          },
          isGroup: false,
          lastMessageText: summaryText,
          lastMessageSenderId: firebaseUser.uid,
          isRequest: privacy.status === 'request',
          ...(privacy.status === 'request' ? { requestRecipientId: friend.uid } : {}),
          unreadCounts: { [friend.uid]: 1 },
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        convId = convRef.id;
      } else {
        await updateDoc(doc(db, 'conversations', convId), {
          lastMessageText: summaryText,
          lastMessageSenderId: firebaseUser.uid,
          [`unreadCounts.${friend.uid}`]: increment(1),
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }

      await addDoc(collection(db, 'messages'), {
        conversationId: convId,
        senderId: firebaseUser.uid,
        type: payload.targetType === 'reel' ? 'shared_reel' : 'shared_post',
        text: note.trim(),
        sharedTargetId: payload.targetId,
        sharedSnapshot: {
          targetType: payload.targetType,
          authorName: payload.authorName,
          authorUsername: payload.authorUsername,
          content: payload.content.slice(0, 220),
          mediaUrl: payload.mediaUrl || '',
        },
        readBy: [firebaseUser.uid],
        isEdited: false,
        isDeleted: false,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setSentIds((prev) => [...prev, friend.uid]);
      onShared?.();
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, 'messages');
    } finally {
      setSendingUid(null);
    }
  };

  const handleRepostToFeed = async () => {
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to share this to your BANA feed.');
      return;
    }
    if (reposted) return;
    try {
      await addDoc(collection(db, 'posts'), {
        authorId: firebaseUser.uid,
        authorUsername: profile.username,
        authorName: profile.displayName,
        authorAvatar: profile.avatarUrl || '',
        authorVerified: Boolean(profile.isVerified),
        type: 'shared',
        content: note.trim(),
        sharedPostId: payload.targetId,
        sharedPostSnapshot: {
          authorName: payload.authorName,
          authorUsername: payload.authorUsername,
          content: payload.content.slice(0, 280),
          mediaUrl: payload.mediaUrl || '',
        },
        visibility: 'public',
        status: 'published',
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setReposted(true);
      onShared?.();
    } catch (err) {
      logFirestoreError(err, OperationType.CREATE, 'posts');
    }
  };

  const handleCopyLink = () => {
    navigator.clipboard?.writeText(shareUrl);
    setCopied(true);
  };

  const handleNativeShare = async () => {
    if (!navigator.share) {
      handleCopyLink();
      return;
    }
    try {
      await navigator.share({
        title: `${payload.authorName} on BANA`,
        text: payload.content || `Check out @${payload.authorUsername} on BANA`,
        url: shareUrl,
      });
      onShared?.();
    } catch {
      // User dismissed native share sheet
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl sm:rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden max-h-[88vh] flex flex-col">
        <div className="flex items-center justify-between px-4 py-3.5 border-b border-neutral-200 dark:border-neutral-800">
          <h3 className="font-display font-bold text-base text-neutral-950 dark:text-white">
            Share to Messenger & Feed
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share modal"
            className="h-8 w-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-3 border-b border-neutral-100 dark:border-neutral-800">
          {/* Preview snippet */}
          <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-900 p-3 text-xs space-y-1">
            <p className="font-semibold text-neutral-900 dark:text-neutral-100">
              {payload.authorName} <span className="text-neutral-500 font-normal">@{payload.authorUsername}</span>
            </p>
            {payload.content && (
              <p className="text-neutral-600 dark:text-neutral-400 line-clamp-2">{payload.content}</p>
            )}
          </div>

          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Write a message to include..."
            className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
          />

          <div className="grid grid-cols-3 gap-2">
            <button
              type="button"
              onClick={handleRepostToFeed}
              disabled={reposted}
              className={`h-9 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-1.5 transition-colors ${
                reposted
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
              }`}
            >
              {reposted ? <Check className="w-3.5 h-3.5" /> : <Repeat2 className="w-3.5 h-3.5" />}
              {reposted ? 'Shared' : 'To Feed'}
            </button>
            <button
              type="button"
              onClick={handleCopyLink}
              className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              {copied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Link2 className="w-3.5 h-3.5" />}
              {copied ? 'Copied' : 'Copy Link'}
            </button>
            <button
              type="button"
              onClick={handleNativeShare}
              className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-neutral-50 dark:hover:bg-neutral-900"
            >
              <Share2 className="w-3.5 h-3.5" />
              Share App
            </button>
          </div>
        </div>

        {/* Friends / Users in Messenger */}
        <div className="p-4 flex-1 overflow-y-auto space-y-3">
          {!firebaseUser ? (
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 text-center space-y-2">
              <p className="text-xs text-neutral-600 dark:text-neutral-400">
                Sign in to send directly to friends in BANA Messenger or repost to your feed.
              </p>
              <button
                type="button"
                onClick={() => openAuthModal('Sign in to share directly in BANA Messenger.')}
                className="px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold"
              >
                Sign In
              </button>
            </div>
          ) : (
            <>
              <div className="relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Send directly to a friend in BANA Messenger..."
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                {filteredUsers.length === 0 ? (
                  <p className="text-xs text-neutral-500 text-center py-4">No matching friends found.</p>
                ) : (
              filteredUsers.map((u) => {
                const isSent = sentIds.includes(u.uid);
                const isSending = sendingUid === u.uid;
                return (
                  <div
                    key={u.uid}
                    className="flex items-center justify-between gap-2 p-2 rounded-xl hover:bg-neutral-50 dark:hover:bg-neutral-900"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                      <div className="min-w-0">
                        <p className="text-xs font-semibold truncate">{u.displayName}</p>
                        <p className="text-[11px] text-neutral-500 truncate">@{u.username}</p>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={isSent || isSending}
                      onClick={() => handleSendToFriend(u)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold inline-flex items-center gap-1 shrink-0 transition-colors ${
                        isSent
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                          : 'bg-[#1877F2] hover:bg-[#166FE5] text-white'
                      }`}
                    >
                      {isSent ? (
                        <>
                          <Check className="w-3.5 h-3.5" /> Sent
                        </>
                      ) : (
                        <>
                          <Send className="w-3 h-3" /> {isSending ? 'Sending...' : 'Send'}
                        </>
                      )}
                    </button>
                  </div>
                );
              })
            )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
