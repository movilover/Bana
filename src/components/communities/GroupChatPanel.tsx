import React, { useEffect, useRef, useState } from 'react';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';
import { Link } from 'react-router-dom';
import {
  Send,
  Image as ImageIcon,
  Mic,
  ExternalLink,
  MessageCircle,
  Loader2,
  Smile,
} from 'lucide-react';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type {
  BanaCommunity,
  BanaConversation,
  BanaMessage,
  CommunityMemberRecord,
} from '@/src/types/bana';
import { ensureCommunityChatConversation } from '@/src/lib/communities';
import { compressImageFile, formatRelativeTime, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { VoicePlayer, VoiceRecorder } from '@/src/components/voice/VoiceRecorderAndPlayer';
import { Avatar } from '@/src/components/common/Avatar';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';
import { sortByCreatedAtDesc, subscribeWithIndexFallback } from '@/src/lib/firestoreQuery';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏'];

interface GroupChatPanelProps {
  community: BanaCommunity;
  members: CommunityMemberRecord[];
  isMember: boolean;
  isRestricted: boolean;
  onConversationLinked: (conversationId: string) => void;
}

export function GroupChatPanel({
  community,
  members,
  isMember,
  isRestricted,
  onConversationLinked,
}: GroupChatPanelProps) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [convId, setConvId] = useState<string | null>(community.chatConversationId || null);
  const [conversation, setConversation] = useState<BanaConversation | null>(null);
  const [messages, setMessages] = useState<BanaMessage[]>([]);
  const [textInput, setTextInput] = useState('');
  const [showVoice, setShowVoice] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [initializing, setInitializing] = useState(false);
  const [reactTargetId, setReactTargetId] = useState<string | null>(null);
  const [initError, setInitError] = useState<string | null>(null);

  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setConvId(community.chatConversationId || null);
  }, [community.chatConversationId]);

  useEffect(() => {
    if (!convId || !firebaseUser || !isMember) {
      setMessages([]);
      setConversation(null);
      return;
    }

    const unsubConv = onSnapshot(doc(db, 'conversations', convId), (snap) => {
      if (snap.exists()) {
        setConversation({ id: snap.id, ...(snap.data() as Omit<BanaConversation, 'id'>) });
      }
    });

    const primaryQ = query(
      collection(db, 'messages'),
      where('conversationId', '==', convId),
      orderBy('createdAt', 'desc'),
      limit(50)
    );
    const fallbackQ = query(
      collection(db, 'messages'),
      where('conversationId', '==', convId),
      limit(80)
    );
    const unsubMsg = subscribeWithIndexFallback<BanaMessage>({
      primaryQuery: primaryQ,
      fallbackQuery: fallbackQ,
      comparator: sortByCreatedAtDesc,
      onData: (rawList) => {
        const list = rawList.slice(0, 50).reverse();
        setMessages(list);
        setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
        list.forEach((m) => {
          if (m.senderId !== firebaseUser.uid && !(m.readBy || []).includes(firebaseUser.uid)) {
            updateDoc(doc(db, 'messages', m.id), {
              readBy: arrayUnion(firebaseUser.uid),
            }).catch(() => {});
          }
        });
      },
      onError: () => {},
    });

    return () => {
      unsubConv();
      unsubMsg();
    };
  }, [convId, firebaseUser, isMember]);

  const handleInitOrJoinChat = async () => {
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to participate in community chat.');
      return;
    }
    setInitializing(true);
    setInitError(null);
    try {
      const id = await ensureCommunityChatConversation({
        community,
        currentUser: profile,
        activeMembers: members,
      });
      setConvId(id);
      onConversationLinked(id);
    } catch (err) {
      setInitError(formatFirebaseErrorMessage(err));
    } finally {
      setInitializing(false);
    }
  };

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !convId || !textInput.trim() || isRestricted) return;
    const msg = textInput.trim();
    setTextInput('');
    await addDoc(collection(db, 'messages'), {
      conversationId: convId,
      senderId: firebaseUser.uid,
      type: 'text',
      text: msg,
      readBy: [firebaseUser.uid],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await updateDoc(doc(db, 'conversations', convId), {
      lastMessageText: msg.slice(0, 140),
      lastMessageSenderId: firebaseUser.uid,
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  };

  const handleImageSend = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !firebaseUser || !convId || isRestricted) return;
    setUploading(true);
    try {
      const compressed = await compressImageFile(file, 1400);
      const url = await uploadMediaWithProgress(
        `messages/${convId}/${firebaseUser.uid}/img_${Date.now()}_${compressed.name}`,
        compressed
      );
      await addDoc(collection(db, 'messages'), {
        conversationId: convId,
        senderId: firebaseUser.uid,
        type: 'image',
        mediaUrl: url,
        text: '',
        readBy: [firebaseUser.uid],
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await updateDoc(doc(db, 'conversations', convId), {
        lastMessageText: 'Sent an image',
        lastMessageSenderId: firebaseUser.uid,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const toggleReaction = async (msg: BanaMessage, emoji: string) => {
    if (!firebaseUser) return;
    const current = msg.reactions?.[emoji] || [];
    const next = current.includes(firebaseUser.uid)
      ? current.filter((u) => u !== firebaseUser.uid)
      : [...current, firebaseUser.uid];
    await updateDoc(doc(db, 'messages', msg.id), {
      [`reactions.${emoji}`]: next,
    }).catch(() => {});
    setReactTargetId(null);
  };

  if (!firebaseUser || !isMember) {
    return (
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center space-y-3">
        <MessageCircle className="w-8 h-8 mx-auto text-neutral-400" />
        <h3 className="font-display font-bold text-base">Members-Only Community Chat</h3>
        <p className="text-xs text-neutral-500 max-w-sm mx-auto">
          Join {community.name} to access real-time group messaging, photos, and voice notes powered by BANA Messenger.
        </p>
      </div>
    );
  }

  if (!convId || (conversation && !conversation.participantIds.includes(firebaseUser.uid))) {
    return (
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center space-y-4">
        <MessageCircle className="w-9 h-9 mx-auto text-brand" />
        <div className="space-y-1">
          <h3 className="font-display font-bold text-base">{community.name} Group Chat</h3>
          <p className="text-xs text-neutral-500 max-w-md mx-auto">
            {convId
              ? 'Sync your community membership into the group chat room.'
              : 'Launch the real-time BANA Messenger room for all active members of this community.'}
          </p>
          {initError && <p className="text-xs text-amber-600 pt-1">{initError}</p>}
        </div>
        <button
          type="button"
          disabled={initializing}
          onClick={handleInitOrJoinChat}
          className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
        >
          {initializing && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
          {convId ? 'Enter Group Chat' : 'Launch Group Chat Room'}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden flex flex-col h-[540px]">
      {/* Chat Header */}
      <div className="px-4 py-3 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
        <div>
          <h3 className="font-display font-bold text-sm">{community.name} Group Chat</h3>
          <p className="text-[11px] text-neutral-500">
            Powered by BANA Messenger · {conversation?.participantIds.length || members.length} participants
          </p>
        </div>
        <Link
          to={`/messages/${convId}`}
          className="inline-flex items-center gap-1 text-xs font-semibold text-brand hover:underline"
        >
          Open Full Messenger <ExternalLink className="w-3.5 h-3.5" />
        </Link>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50/50 dark:bg-neutral-950/40">
        {messages.length === 0 ? (
          <p className="text-xs text-neutral-500 text-center py-12">
            Start the conversation in {community.name}.
          </p>
        ) : (
          messages.map((m) => {
            const mine = m.senderId === firebaseUser.uid;
            const senderMeta = conversation?.participantMeta?.[m.senderId];
            const senderName = senderMeta?.displayName || 'Member';
            const reactionEntries = Object.entries(m.reactions || {}).filter(([, arr]) => arr.length > 0);

            return (
              <div key={m.id} className={`flex gap-2.5 ${mine ? 'justify-end' : 'justify-start'}`}>
                {!mine && <Avatar src={senderMeta?.avatarUrl} name={senderName} size="xs" />}
                <div className={`max-w-[78%] space-y-1 ${mine ? 'items-end flex flex-col' : ''}`}>
                  {!mine && (
                    <span className="text-[10px] font-medium text-neutral-500 inline-flex items-center gap-1">
                      {senderName}
                      <LiveVerifiedBadge uid={m.senderId} size={10} />
                    </span>
                  )}
                  <div className="group relative flex items-center gap-1.5">
                    <div
                      className={`rounded-2xl px-3.5 py-2 text-xs ${
                        mine
                          ? 'bg-brand text-white'
                          : 'bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100'
                      }`}
                    >
                      {m.type === 'image' && m.mediaUrl && (
                        <img loading="lazy"
                          src={m.mediaUrl}
                          alt="Chat attachment"
                          className="rounded-lg max-h-56 object-cover mb-1"
                        />
                      )}
                      {m.type === 'voice' && m.mediaUrl && (
                        <VoicePlayer
                          audioUrl={m.mediaUrl}
                          durationSeconds={m.audioDuration || 10}
                          waveform={m.audioWaveform}
                        />
                      )}
                      {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                    </div>
                    <button
                      type="button"
                      onClick={() => setReactTargetId((cur) => (cur === m.id ? null : m.id))}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-full text-neutral-400 hover:text-neutral-700"
                      aria-label="React to message"
                    >
                      <Smile className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {reactTargetId === m.id && (
                    <div className="flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 px-2 py-1 shadow-sm">
                      {QUICK_REACTIONS.map((emoji) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => toggleReaction(m, emoji)}
                          className="text-sm hover:scale-125 transition-transform"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}

                  {reactionEntries.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {reactionEntries.map(([emoji, arr]) => (
                        <button
                          key={emoji}
                          type="button"
                          onClick={() => toggleReaction(m, emoji)}
                          className="px-1.5 py-0.5 rounded-full bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-[10px]"
                        >
                          {emoji} {arr.length}
                        </button>
                      ))}
                    </div>
                  )}

                  <span className="text-[10px] text-neutral-400">{formatRelativeTime(m.createdAt)}</span>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Composer */}
      {isRestricted ? (
        <div className="p-3 border-t border-neutral-100 dark:border-neutral-800 text-center text-xs text-amber-600">
          Your posting and chat privileges are currently restricted in this community.
        </div>
      ) : (
        <div className="p-3 border-t border-neutral-100 dark:border-neutral-800 space-y-2">
          {showVoice && profile && (
            <VoiceRecorder
              uid={profile.uid}
              storagePrefix={`messages/${convId}`}
              submitLabel="Send Voice"
              onCancel={() => setShowVoice(false)}
              onUploaded={async ({ audioUrl, durationSeconds, waveform }) => {
                await addDoc(collection(db, 'messages'), {
                  conversationId: convId,
                  senderId: profile.uid,
                  type: 'voice',
                  mediaUrl: audioUrl,
                  audioDuration: durationSeconds,
                  audioWaveform: waveform,
                  readBy: [profile.uid],
                  createdAt: serverTimestamp(),
                  updatedAt: serverTimestamp(),
                });
                await updateDoc(doc(db, 'conversations', convId), {
                  lastMessageText: 'Sent a voice message',
                  lastMessageSenderId: profile.uid,
                  updatedAt: serverTimestamp(),
                }).catch(() => {});
                setShowVoice(false);
              }}
            />
          )}

          <form onSubmit={sendMessage} className="flex items-center gap-2">
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageSend}
              className="hidden"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => imageInputRef.current?.click()}
              className="p-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
              title="Send photo"
            >
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImageIcon className="w-4 h-4" />}
            </button>
            <button
              type="button"
              onClick={() => setShowVoice((v) => !v)}
              className={`p-2 rounded-xl border border-neutral-200 dark:border-neutral-800 ${
                showVoice ? 'text-brand border-brand' : 'text-neutral-500'
              }`}
              title="Record voice note"
            >
              <Mic className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={textInput}
              onChange={(e) => setTextInput(e.target.value)}
              placeholder={`Message ${community.name}...`}
              className="flex-1 h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3.5 text-xs"
            />
            <button
              type="submit"
              disabled={!textInput.trim()}
              className="h-10 px-4 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold inline-flex items-center gap-1.5 disabled:opacity-40"
            >
              <Send className="w-3.5 h-3.5" /> Send
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
