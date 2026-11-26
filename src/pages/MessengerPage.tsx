import React, { useEffect, useRef, useState } from 'react';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Search,
  Send,
  Image as ImageIcon,
  Paperclip,
  Mic,
  Smile,
  MoreVertical,
  Plus,
  Sun,
  Moon,
  BellOff,
  Archive,
  Reply,
  Edit3,
  Trash2,
  Check,
  CheckCheck,
  Flag,
  Ban,
  Users,
  X,
  FileText,
  ArrowLeft,
  Phone,
  Video,
  Copy,
  Settings,
  Film,
  ExternalLink,
  ShieldAlert,
  ChevronUp,
  Music,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  addDoc,
  updateDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  serverTimestamp,
  arrayUnion,
  arrayRemove,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import {
  sortByCreatedAtDesc,
  subscribeWithIndexFallback,
  toMillis,
} from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTheme } from '@/src/contexts/ThemeContext';
import { useToast } from '@/src/contexts/ToastContext';
import { useCall } from '@/src/contexts/CallContext';
import type { BanaConversation, BanaMessage, BanaUser, ChatBubbleStyle } from '@/src/types/bana';
import { checkPairBlockedAndPrivacy } from '@/src/lib/webrtcCalling';
import { createSocialNotification } from '@/src/lib/socialGraph';
import { realtimeSocket } from '@/src/lib/calling/realtimeClient';
import { AppShell } from '@/src/components/layout/AppShell';
import { Avatar } from '@/src/components/common/Avatar';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import { ReportDialog } from '@/src/components/common/ReportDialog';
import { VoicePlayer, VoiceRecorder } from '@/src/components/voice/VoiceRecorderAndPlayer';
import { GroupManageModal } from '@/src/components/messenger/GroupManageModal';
import { CallHistoryView } from '@/src/components/messenger/CallHistoryView';
import {
  compressImageFile,
  formatRelativeTime,
  isSafeFileName,
  uploadMediaWithProgress,
} from '@/src/lib/mediaUtils';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';

const QUICK_REACTIONS = ['👍', '❤️', '😂', '😮', '🙏'];
const EDIT_WINDOW_MS = 15 * 60 * 1000;

type SidebarTab = 'all' | 'unread' | 'groups' | 'requests' | 'calls';

function getCreatedMs(val: any): number {
  if (!val) return Date.now();
  if (typeof val?.toMillis === 'function') return val.toMillis();
  if (typeof val?.seconds === 'number') return val.seconds * 1000;
  const parsed = new Date(val).getTime();
  return Number.isNaN(parsed) ? Date.now() : parsed;
}

export function MessengerPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { firebaseUser, profile, settings, platformSettings, updateLocalSettings } = useAuth();
  const { resolvedMessengerTheme, messengerTheme } = useTheme();
  const { startCall, startGroupCall, joinGroupCall, activeGroupRoomsByConversation } = useCall();
  const toast = useToast();

  const [conversations, setConversations] = useState<BanaConversation[]>([]);
  const [convLimit, setConvLimit] = useState(25);
  const [messages, setMessages] = useState<BanaMessage[]>([]);
  const [msgLimit, setMsgLimit] = useState(50);
  const [peerProfiles, setPeerProfiles] = useState<Record<string, BanaUser>>({});

  const [convSearch, setConvSearch] = useState('');
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [tab, setTab] = useState<SidebarTab>('all');
  const [showArchived, setShowArchived] = useState(false);

  const [textInput, setTextInput] = useState('');
  const [replyTo, setReplyTo] = useState<BanaMessage | null>(null);
  const [editingMsg, setEditingMsg] = useState<BanaMessage | null>(null);
  const [showVoice, setShowVoice] = useState(false);
  const [reactTargetId, setReactTargetId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [reportTarget, setReportTarget] = useState<
    { type: 'conversation' | 'message'; id: string; evidence?: string; conversationId: string } | null
  >(null);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [pairBlockStatus, setPairBlockStatus] = useState<'allowed' | 'blocked' | 'denied'>('allowed');
  const [pairBlockReason, setPairBlockReason] = useState<string | null>(null);

  // Confirmation dialogs
  const [confirmState, setConfirmState] = useState<{
    title: string;
    description: string;
    confirmLabel: string;
    action: () => Promise<void>;
  } | null>(null);

  // New conversation / group modal
  const [newChatOpen, setNewChatOpen] = useState(false);
  const [userSearch, setUserSearch] = useState('');
  const [userResults, setUserResults] = useState<BanaUser[]>([]);
  const [selectedUids, setSelectedUids] = useState<BanaUser[]>([]);
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');

  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const imageInputRef = useRef<HTMLInputElement | null>(null);
  const isInitialLoadRef = useRef(true);

  const isDarkChat = resolvedMessengerTheme === 'dark';
  const bubbleStyle: ChatBubbleStyle = settings?.chatBubbleStyle || 'classic';

  // Subscribe to conversations with pagination
  useEffect(() => {
    if (!firebaseUser) return;
    const primaryQ = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', firebaseUser.uid),
      orderBy('updatedAt', 'desc'),
      limit(convLimit)
    );
    const fallbackQ = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', firebaseUser.uid),
      limit(Math.max(convLimit, 40))
    );
    const unsub = subscribeWithIndexFallback<BanaConversation>({
      primaryQuery: primaryQ,
      fallbackQuery: fallbackQ,
      comparator: (a, b) => toMillis(b.updatedAt || b.createdAt) - toMillis(a.updatedAt || a.createdAt),
      onData: (rawList) => {
        const list = rawList.slice(0, convLimit);
        setConversations(list);

        // Fetch peer presence & privacy profiles for 1-to-1 conversations
        const peerIds = Array.from(
          new Set(
            list
              .filter((c) => !c.isGroup)
              .map((c) => c.participantIds.find((id) => id !== firebaseUser.uid))
              .filter((id): id is string => Boolean(id))
          )
        ).slice(0, 30);

        peerIds.forEach((uid) => {
          getDoc(doc(db, 'users', uid))
            .then((uSnap) => {
              if (uSnap.exists()) {
                setPeerProfiles((prev) => ({
                  ...prev,
                  [uid]: { uid: uSnap.id, ...(uSnap.data() as Omit<BanaUser, 'uid'>) },
                }));
              }
            })
            .catch(() => {});
        });
      },
      onError: (err) => logFirestoreError(err, OperationType.LIST, 'conversations'),
    });
    return () => unsub();
  }, [firebaseUser, convLimit]);

  const activeConv = conversations.find((c) => c.id === conversationId) || null;

  useEffect(() => {
    setMsgLimit(50);
    isInitialLoadRef.current = true;
    setReplyTo(null);
    setEditingMsg(null);
    setTextInput('');
    setShowVoice(false);
    setMenuOpen(false);
    setThreadSearchOpen(false);
    setThreadSearchQuery('');
  }, [conversationId]);

  // Check block/privacy status for active 1-to-1 thread
  useEffect(() => {
    if (!firebaseUser || !activeConv || activeConv.isGroup) {
      setPairBlockStatus('allowed');
      setPairBlockReason(null);
      return;
    }
    const otherId = activeConv.participantIds.find((id) => id !== firebaseUser.uid);
    if (!otherId) return;

    checkPairBlockedAndPrivacy(firebaseUser.uid, otherId, 'message')
      .then((res) => {
        if (res.status === 'blocked' || res.status === 'denied') {
          setPairBlockStatus(res.status);
          setPairBlockReason(res.reason || 'Messaging is restricted for this conversation.');
        } else {
          setPairBlockStatus('allowed');
          setPairBlockReason(null);
        }
      })
      .catch(() => {});
  }, [firebaseUser, activeConv?.id, activeConv?.isGroup, activeConv?.participantIds]);

  // Subscribe to latest messages (descending + reversed chronologically) with pagination
  useEffect(() => {
    if (!firebaseUser || !conversationId) {
      setMessages([]);
      return;
    }

    const primaryQ = query(
      collection(db, 'messages'),
      where('conversationId', '==', conversationId),
      orderBy('createdAt', 'desc'),
      limit(msgLimit)
    );
    const fallbackQ = query(
      collection(db, 'messages'),
      where('conversationId', '==', conversationId),
      limit(Math.max(msgLimit, 80))
    );
    const unsub = subscribeWithIndexFallback<BanaMessage>({
      primaryQuery: primaryQ,
      fallbackQuery: fallbackQ,
      comparator: sortByCreatedAtDesc,
      onData: (rawList) => {
        const list = rawList.slice(0, msgLimit).reverse();
        setMessages(list);
        if (isInitialLoadRef.current) {
          isInitialLoadRef.current = false;
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'auto' }), 50);
        } else {
          setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth' }), 60);
        }

        if (activeConv && (activeConv.unreadCounts?.[firebaseUser.uid] || 0) > 0) {
          updateDoc(doc(db, 'conversations', conversationId), {
            [`unreadCounts.${firebaseUser.uid}`]: 0,
          }).catch(() => {});
        }
        list.forEach((m) => {
          if (m.senderId !== firebaseUser.uid) {
            const updates: Record<string, any> = {};
            if (!(m.deliveredTo || []).includes(firebaseUser.uid)) {
              updates.deliveredTo = arrayUnion(firebaseUser.uid);
            }
            if (settings?.showReadReceipts !== false && !(m.readBy || []).includes(firebaseUser.uid)) {
              updates.readBy = arrayUnion(firebaseUser.uid);
            }
            if (Object.keys(updates).length > 0) {
              updateDoc(doc(db, 'messages', m.id), updates).catch(() => {});
            }
          }
        });
      },
      onError: (err) => logFirestoreError(err, OperationType.LIST, 'messages'),
    });
    return () => unsub();
  }, [conversationId, msgLimit, firebaseUser, activeConv, settings?.showReadReceipts]);

  // Search BANA users for new DM or group
  useEffect(() => {
    if (!newChatOpen) return;
    getDocs(query(collection(db, 'users'), limit(35)))
      .then((snap) => {
        const list = snap.docs
          .map((d) => ({ uid: d.id, ...(d.data() as Omit<BanaUser, 'uid'>) }))
          .filter((u) => u.uid !== firebaseUser?.uid);
        setUserResults(list);
      })
      .catch(() => {});
  }, [newChatOpen, firebaseUser]);

  if (!firebaseUser || !profile) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
          <h1 className="font-display font-bold text-xl">Sign in to BANA Messenger</h1>
          <p className="text-sm text-neutral-500">
            Access real-time chats, voice notes, group threads, and WebRTC audio & video calls.
          </p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-sm font-semibold"
          >
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  if (platformSettings.enableMessaging === false) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-3">
          <ShieldAlert className="w-10 h-10 text-amber-500 mx-auto" />
          <h1 className="font-display font-bold text-xl">Messenger Temporarily Paused</h1>
          <p className="text-sm text-neutral-500">
            BANA administrators have temporarily disabled Messenger for maintenance.
          </p>
        </div>
      </AppShell>
    );
  }

  const isUserOnline = (uid?: string) => {
    if (!uid) return false;
    const u = peerProfiles[uid];
    if (!u || u.showOnlineStatus === false) return false;
    return Boolean(u.lastActiveAt && Date.now() - Number(u.lastActiveAt) < 120000);
  };

  const getConvDisplay = (conv: BanaConversation) => {
    if (conv.isGroup) {
      return {
        name: conv.groupName || 'Group Chat',
        username: `${conv.participantIds.length} members`,
        avatar: conv.groupAvatar || '',
        online: false,
        otherId: undefined,
      };
    }
    const otherId = conv.participantIds.find((id) => id !== firebaseUser.uid) || firebaseUser.uid;
    const livePeer = peerProfiles[otherId];
    const meta = conv.participantMeta?.[otherId];
    return {
      name: livePeer?.displayName || meta?.displayName || 'BANA Member',
      username: livePeer?.username || meta?.username || '',
      avatar: livePeer?.avatarUrl || meta?.avatarUrl || '',
      online: isUserOnline(otherId),
      otherId,
    };
  };

  const handleStartCall = (callType: 'audio' | 'video') => {
    if (!activeConv) return;
    if (activeConv.isGroup) {
      startGroupCall({
        conversationId: activeConv.id,
        conversationName: activeConv.groupName || 'Group Call',
        callType,
        participantIds: activeConv.participantIds,
      });
      return;
    }
    const info = getConvDisplay(activeConv);
    if (!info.otherId) return;
    startCall({
      conversationId: activeConv.id,
      callType,
      callee: {
        uid: info.otherId,
        displayName: info.name,
        avatarUrl: info.avatar,
      },
    });
  };

  const toggleMessengerTheme = async (mode?: 'light' | 'dark' | 'match') => {
    const next = mode || (isDarkChat ? 'light' : 'dark');
    await updateLocalSettings({ messengerTheme: next }).catch(() => {});
  };

  const handleCreateConversation = async () => {
    if (selectedUids.length === 0) return;
    if (profile.messagingRestricted) {
      toast.error('Your account messaging access is restricted.');
      return;
    }

    const isGroup = selectedUids.length > 1 || Boolean(groupName.trim());
    const participantIds = [firebaseUser.uid, ...selectedUids.map((u) => u.uid)];

    if (!isGroup) {
      const target = selectedUids[0];
      const existing = conversations.find(
        (c) => !c.isGroup && c.participantIds.length === 2 && c.participantIds.includes(target.uid)
      );
      if (existing) {
        setNewChatOpen(false);
        setSelectedUids([]);
        navigate(`/messages/${existing.id}`);
        return;
      }

      const privacy = await checkPairBlockedAndPrivacy(firebaseUser.uid, target.uid, 'message');
      if (privacy.status === 'blocked' || privacy.status === 'denied') {
        toast.error(privacy.reason || 'You cannot message this user.');
        return;
      }

      const convRef = await addDoc(collection(db, 'conversations'), {
        participantIds,
        participantMeta: {
          [firebaseUser.uid]: {
            displayName: profile.displayName,
            username: profile.username,
            avatarUrl: profile.avatarUrl || '',
          },
          [target.uid]: {
            displayName: target.displayName,
            username: target.username,
            avatarUrl: target.avatarUrl || '',
          },
        },
        isGroup: false,
        lastMessageText: '',
        lastMessageSenderId: '',
        isRequest: privacy.status === 'request',
        ...(privacy.status === 'request' ? { requestRecipientId: target.uid } : {}),
        mutedBy: [],
        archivedBy: [],
        unreadCounts: {},
        typingUsers: {},
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setNewChatOpen(false);
      setSelectedUids([]);
      setGroupName('');
      setGroupDescription('');
      navigate(`/messages/${convRef.id}`);
      return;
    }

    // Group creation with adminIds initialized
    const participantMeta: Record<string, { displayName: string; username: string; avatarUrl?: string }> = {
      [firebaseUser.uid]: {
        displayName: profile.displayName,
        username: profile.username,
        avatarUrl: profile.avatarUrl || '',
      },
    };
    selectedUids.forEach((u) => {
      participantMeta[u.uid] = {
        displayName: u.displayName,
        username: u.username,
        avatarUrl: u.avatarUrl || '',
      };
    });

    const convRef = await addDoc(collection(db, 'conversations'), {
      participantIds,
      adminIds: [firebaseUser.uid],
      participantMeta,
      isGroup: true,
      groupName: groupName.trim() || selectedUids.map((u) => u.displayName.split(' ')[0]).join(', '),
      groupDescription: groupDescription.trim(),
      groupAvatar: '',
      lastMessageText: 'Created group chat',
      lastMessageSenderId: firebaseUser.uid,
      isRequest: false,
      mutedBy: [],
      archivedBy: [],
      unreadCounts: {},
      typingUsers: {},
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    setNewChatOpen(false);
    setSelectedUids([]);
    setGroupName('');
    setGroupDescription('');
    navigate(`/messages/${convRef.id}`);
  };

  const sendTypingPing = () => {
    if (!activeConv || pairBlockStatus !== 'allowed' || profile.messagingRestricted) return;
    updateDoc(doc(db, 'conversations', activeConv.id), {
      [`typingUsers.${firebaseUser.uid}`]: Date.now(),
    }).catch(() => {});
    realtimeSocket.send({
      type: 'chat:typing',
      conversationId: activeConv.id,
      targetUids: activeConv.participantIds,
      typing: true,
    });
  };

  const sendMessage = async (payload: {
    type: BanaMessage['type'];
    text?: string;
    mediaUrl?: string;
    fileName?: string;
    fileSize?: number;
    audioDuration?: number;
    audioWaveform?: number[];
  }) => {
    if (!activeConv) return;
    if (profile.messagingRestricted) {
      setErrorMsg('Your account messaging privileges are currently restricted by BANA Safety.');
      return;
    }
    if (pairBlockStatus !== 'allowed') {
      setErrorMsg(pairBlockReason || 'Messaging is blocked in this conversation.');
      return;
    }
    setErrorMsg(null);

    if (editingMsg && payload.type === 'text' && payload.text) {
      const createdMs = getCreatedMs(editingMsg.createdAt);
      if (Date.now() - createdMs > EDIT_WINDOW_MS) {
        setErrorMsg('Messages can only be edited within 15 minutes of sending.');
        setEditingMsg(null);
        setTextInput('');
        return;
      }
      await updateDoc(doc(db, 'messages', editingMsg.id), {
        text: payload.text,
        isEdited: true,
        updatedAt: serverTimestamp(),
      });
      setEditingMsg(null);
      setTextInput('');
      return;
    }

    const msgData: any = {
      conversationId: activeConv.id,
      senderId: firebaseUser.uid,
      type: payload.type,
      text: payload.text || '',
      mediaUrl: payload.mediaUrl || '',
      fileName: payload.fileName || '',
      fileSize: payload.fileSize || 0,
      audioDuration: payload.audioDuration || 0,
      ...(payload.audioWaveform ? { audioWaveform: payload.audioWaveform } : {}),
      replyToId: replyTo?.id || '',
      replyPreview: replyTo ? (replyTo.text || replyTo.type).slice(0, 100) : '',
      reactions: {},
      deliveredTo: [firebaseUser.uid],
      readBy: [firebaseUser.uid],
      isEdited: false,
      isDeleted: false,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    const msgDocRef = await addDoc(collection(db, 'messages'), msgData);

    const nextUnread: Record<string, number> = { ...(activeConv.unreadCounts || {}) };
    activeConv.participantIds.forEach((pid) => {
      if (pid !== firebaseUser.uid) {
        nextUnread[pid] = (nextUnread[pid] || 0) + 1;
      }
    });

    const summary =
      payload.type === 'text'
        ? payload.text!.slice(0, 80)
        : payload.type === 'voice'
        ? 'Sent a voice message'
        : payload.type === 'audio'
        ? `Sent audio: ${payload.fileName || 'track'}`
        : payload.type === 'image'
        ? 'Sent a photo'
        : payload.type === 'video'
        ? 'Sent a video'
        : `Sent file: ${payload.fileName}`;

    await updateDoc(doc(db, 'conversations', activeConv.id), {
      lastMessageText: summary,
      lastMessageSenderId: firebaseUser.uid,
      unreadCounts: nextUnread,
      [`typingUsers.${firebaseUser.uid}`]: 0,
      updatedAt: serverTimestamp(),
    });

    // Notify unmuted recipients in real-time BANA Notifications
    const mutedSet = new Set(activeConv.mutedBy || []);
    const recipientIds = activeConv.participantIds.filter(
      (pid) => pid !== firebaseUser.uid && !mutedSet.has(pid)
    );
    recipientIds.slice(0, 10).forEach((pid) => {
      void createSocialNotification({
        recipientId: pid,
        actor: {
          uid: firebaseUser.uid,
          displayName: profile.displayName,
          avatarUrl: profile.avatarUrl,
          username: profile.username,
        },
        type: 'message',
        title: activeConv.isGroup
          ? `${profile.displayName} in ${activeConv.groupName || 'Group'}`
          : `New message from ${profile.displayName}`,
        body: summary,
        linkUrl: `/messages/${activeConv.id}`,
        dedupeKey: `msg_${msgDocRef.id}_${pid}`,
      });
    });

    setTextInput('');
    setReplyTo(null);
  };

  const handleFileUpload = async (file: File, kind: 'image' | 'file') => {
    if (!activeConv || pairBlockStatus !== 'allowed' || profile.messagingRestricted) return;
    if (!isSafeFileName(file.name)) {
      setErrorMsg('Executable or script files are blocked in BANA Messenger.');
      return;
    }
    setUploading(true);
    setErrorMsg(null);
    try {
      const processed = kind === 'image' && file.type.startsWith('image/') ? await compressImageFile(file) : file;
      const msgType: BanaMessage['type'] = file.type.startsWith('image/')
        ? 'image'
        : file.type.startsWith('video/')
        ? 'video'
        : file.type.startsWith('audio/')
        ? 'audio'
        : 'file';
      const url = await uploadMediaWithProgress(
        `messages/${activeConv.id}/${firebaseUser.uid}/${Date.now()}_${processed.name}`,
        processed
      );
      await sendMessage({
        type: msgType,
        mediaUrl: url,
        fileName: processed.name,
        fileSize: processed.size,
      });
    } catch (err: any) {
      setErrorMsg(err?.message || 'Upload failed.');
    } finally {
      setUploading(false);
    }
  };

  const requestsCount = conversations.filter(
    (c) => Boolean(c.isRequest && c.requestRecipientId === firebaseUser.uid) && !(c.archivedBy || []).includes(firebaseUser.uid)
  ).length;

  const filteredConversations = conversations.filter((c) => {
    const isArchived = (c.archivedBy || []).includes(firebaseUser.uid);
    const isReq = Boolean(c.isRequest && c.requestRecipientId === firebaseUser.uid);
    const unread = c.unreadCounts?.[firebaseUser.uid] || 0;

    if (showArchived) {
      if (!isArchived) return false;
    } else {
      if (isArchived) return false;
      if (tab === 'requests') {
        if (!isReq) return false;
      } else {
        if (isReq) return false;
        if (tab === 'unread' && unread === 0) return false;
        if (tab === 'groups' && !c.isGroup) return false;
      }
    }

    if (convSearch.trim()) {
      const info = getConvDisplay(c);
      const q = convSearch.toLowerCase();
      return (
        info.name.toLowerCase().includes(q) ||
        info.username.toLowerCase().includes(q) ||
        (c.lastMessageText || '').toLowerCase().includes(q)
      );
    }
    return true;
  });

  const otherTyping =
    activeConv &&
    Object.entries(activeConv.typingUsers || {}).some(
      ([uid, ts]) => uid !== firebaseUser.uid && Date.now() - Number(ts) < 5000
    );

  const getBubbleClasses = (mine: boolean, isDeleted?: boolean) => {
    if (isDeleted) {
      return 'rounded-2xl border border-neutral-200 dark:border-neutral-800 italic text-neutral-400';
    }
    if (bubbleStyle === 'minimal') {
      return mine
        ? 'rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950'
        : isDarkChat
        ? 'rounded-xl bg-neutral-900 text-neutral-100 border border-neutral-800'
        : 'rounded-xl bg-neutral-100 text-neutral-950 border border-neutral-200';
    }
    if (bubbleStyle === 'soft') {
      return mine
        ? 'rounded-3xl bg-brand/12 text-[#0D47A1] dark:bg-brand/25 dark:text-blue-100 border border-brand/25'
        : isDarkChat
        ? 'rounded-3xl bg-neutral-900 text-neutral-100 border border-neutral-800'
        : 'rounded-3xl bg-[#F0F2F5] text-neutral-950';
    }
    // classic
    return mine
      ? 'rounded-2xl rounded-br-sm bg-brand text-white'
      : isDarkChat
      ? 'rounded-2xl rounded-bl-sm bg-neutral-900 text-neutral-100 border border-neutral-800'
      : 'rounded-2xl rounded-bl-sm bg-[#F0F2F5] text-neutral-950';
  };

  const activeInfo = activeConv ? getConvDisplay(activeConv) : null;

  return (
    <AppShell fullBleed>
      <div
        className={`h-[calc(100vh-7.5rem)] lg:h-[calc(100vh-3.5rem)] flex overflow-hidden transition-colors ${
          isDarkChat ? 'bg-neutral-950 text-neutral-100' : 'bg-white text-neutral-950'
        }`}
      >
        {/* Conversation Sidebar */}
        <aside
          className={`${
            conversationId ? 'hidden md:flex' : 'flex'
          } w-full md:w-84 lg:w-96 flex-col border-r ${
            isDarkChat ? 'border-neutral-800 bg-neutral-950' : 'border-neutral-200 bg-white'
          }`}
        >
          <div className={`p-4 border-b space-y-3 ${isDarkChat ? 'border-neutral-800' : 'border-neutral-200'}`}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <button
                  type="button"
                  onClick={() => navigate(`/profile/${profile.username}`)}
                  title="Your BANA profile"
                  className="shrink-0"
                >
                  <Avatar src={profile.avatarUrl} name={profile.displayName} size="sm" />
                </button>
                <div className="min-w-0">
                  <h1 className="font-display font-bold text-base leading-tight truncate">BANA Messenger</h1>
                  <p className="text-[11px] text-neutral-500 truncate">@{profile.username}</p>
                </div>
              </div>

              <div className="flex items-center gap-1 relative shrink-0">
                <button
                  type="button"
                  onClick={() => toggleMessengerTheme()}
                  title={`Messenger theme: ${messengerTheme}`}
                  aria-label="Toggle Messenger light or dark theme"
                  className={`h-9 w-9 rounded-xl border flex items-center justify-center ${
                    isDarkChat ? 'border-neutral-800 hover:bg-neutral-900' : 'border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  {isDarkChat ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                </button>

                <button
                  type="button"
                  onClick={() => setAppearanceOpen((v) => !v)}
                  title="Messenger appearance & privacy"
                  aria-label="Messenger customization settings"
                  className={`h-9 w-9 rounded-xl border flex items-center justify-center ${
                    isDarkChat ? 'border-neutral-800 hover:bg-neutral-900' : 'border-neutral-200 hover:bg-neutral-100'
                  }`}
                >
                  <Settings className="w-4 h-4" />
                </button>

                <button
                  type="button"
                  onClick={() => setNewChatOpen(true)}
                  aria-label="New conversation or group"
                  title="New chat or group"
                  className="h-9 w-9 rounded-xl bg-brand text-white flex items-center justify-center hover:bg-brand-hover"
                >
                  <Plus className="w-4 h-4" />
                </button>

                {appearanceOpen && (
                  <div
                    className={`absolute right-0 top-11 w-64 rounded-2xl border shadow-xl p-3.5 z-30 space-y-3 text-xs ${
                      isDarkChat
                        ? 'border-neutral-800 bg-neutral-900 text-neutral-100'
                        : 'border-neutral-200 bg-white text-neutral-950'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-display font-bold text-sm">Chat Customization</span>
                      <button type="button" onClick={() => setAppearanceOpen(false)}>
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[11px] text-neutral-500 font-medium">Messenger Theme</p>
                      <div className="grid grid-cols-3 gap-1">
                        {(['match', 'light', 'dark'] as const).map((m) => (
                          <button
                            key={m}
                            type="button"
                            onClick={() => toggleMessengerTheme(m)}
                            className={`py-1.5 rounded-lg capitalize font-semibold border ${
                              messengerTheme === m
                                ? 'border-brand bg-brand/10 text-brand'
                                : 'border-neutral-200 dark:border-neutral-800'
                            }`}
                          >
                            {m}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1">
                      <p className="text-[11px] text-neutral-500 font-medium">Bubble Style</p>
                      <div className="grid grid-cols-3 gap-1">
                        {(['classic', 'minimal', 'soft'] as ChatBubbleStyle[]).map((st) => (
                          <button
                            key={st}
                            type="button"
                            onClick={() => updateLocalSettings({ chatBubbleStyle: st })}
                            className={`py-1.5 rounded-lg capitalize font-semibold border ${
                              bubbleStyle === st
                                ? 'border-brand bg-brand/10 text-brand'
                                : 'border-neutral-200 dark:border-neutral-800'
                            }`}
                          >
                            {st}
                          </button>
                        ))}
                      </div>
                    </div>

                    <label className="flex items-center justify-between pt-1">
                      <span>Read Receipts</span>
                      <input
                        type="checkbox"
                        checked={settings?.showReadReceipts !== false}
                        onChange={(e) => updateLocalSettings({ showReadReceipts: e.target.checked })}
                        className="accent-brand"
                      />
                    </label>
                    <label className="flex items-center justify-between">
                      <span>Call & Sound Alerts</span>
                      <input
                        type="checkbox"
                        checked={settings?.messengerSoundEnabled !== false}
                        onChange={(e) => updateLocalSettings({ messengerSoundEnabled: e.target.checked })}
                        className="accent-brand"
                      />
                    </label>

                    <button
                      type="button"
                      onClick={() => {
                        setAppearanceOpen(false);
                        navigate('/settings');
                      }}
                      className="w-full py-2 rounded-xl bg-neutral-100 dark:bg-neutral-800 font-semibold hover:opacity-90"
                    >
                      All Calling & Privacy Settings
                    </button>
                  </div>
                )}
              </div>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="search"
                value={convSearch}
                onChange={(e) => setConvSearch(e.target.value)}
                placeholder="Search people, @username, chats..."
                className={`w-full h-9 pl-9 pr-3 rounded-xl border text-xs ${
                  isDarkChat
                    ? 'border-neutral-800 bg-neutral-900 text-white'
                    : 'border-neutral-200 bg-neutral-50 text-neutral-950'
                }`}
              />
            </div>

            <div className="grid grid-cols-5 gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'unread', label: 'Unread' },
                  { id: 'groups', label: 'Groups' },
                  { id: 'requests', label: requestsCount > 0 ? `Req (${requestsCount})` : 'Requests' },
                  { id: 'calls', label: 'Calls' },
                ] as { id: SidebarTab; label: string }[]
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setShowArchived(false);
                    setTab(t.id);
                  }}
                  className={`py-1.5 rounded-lg text-[11px] font-semibold truncate px-1 ${
                    !showArchived && tab === t.id
                      ? isDarkChat
                        ? 'bg-neutral-800 text-white'
                        : 'bg-white text-neutral-950 shadow-sm'
                      : 'text-neutral-500'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex items-center justify-between text-[11px] text-neutral-500 px-0.5">
              <span>{showArchived ? 'Viewing Archived Chats' : 'Inbox'}</span>
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className={`inline-flex items-center gap-1 font-medium hover:underline ${
                  showArchived ? 'text-brand' : ''
                }`}
              >
                <Archive className="w-3 h-3" />
                {showArchived ? 'Back to Chats' : 'Archived'}
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-900">
            {tab === 'calls' && !showArchived ? (
              <CallHistoryView onSelectConversation={(cid) => navigate(`/messages/${cid}`)} />
            ) : filteredConversations.length === 0 ? (
              <div className="p-8 text-center space-y-2">
                <p className="text-xs text-neutral-500">
                  {showArchived ? 'No archived conversations.' : `No conversations in ${tab}.`}
                </p>
                {!showArchived && (
                  <button
                    type="button"
                    onClick={() => setNewChatOpen(true)}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    Start a new chat
                  </button>
                )}
              </div>
            ) : (
              <>
                {filteredConversations.map((c) => {
                  const info = getConvDisplay(c);
                  const unread = c.unreadCounts?.[firebaseUser.uid] || 0;
                  const muted = (c.mutedBy || []).includes(firebaseUser.uid);
                  const active = c.id === conversationId;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => navigate(`/messages/${c.id}`)}
                      className={`w-full px-4 py-3 flex items-center gap-3 text-left transition-colors ${
                        active
                          ? isDarkChat
                            ? 'bg-neutral-900'
                            : 'bg-neutral-100'
                          : isDarkChat
                          ? 'hover:bg-neutral-900/60'
                          : 'hover:bg-neutral-50'
                      }`}
                    >
                      <div className="relative shrink-0">
                        <Avatar src={info.avatar} name={info.name} size="md" />
                        {info.online && (
                          <span
                            title="Online now"
                            className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-950"
                          />
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0 flex items-center gap-1.5">
                            <p className="text-sm font-semibold truncate">{info.name}</p>
                            {!c.isGroup && info.otherId && <LiveVerifiedBadge uid={info.otherId} size={13} />}
                            {muted && <BellOff className="w-3 h-3 text-neutral-400 shrink-0" />}
                          </div>
                          <span className="text-[11px] text-neutral-400 shrink-0">
                            {formatRelativeTime(c.updatedAt)}
                          </span>
                        </div>
                        {info.username && (
                          <p className="text-[11px] text-neutral-400 truncate">
                            {c.isGroup ? info.username : `@${info.username}`}
                          </p>
                        )}
                        <div className="flex items-center justify-between gap-2 mt-0.5">
                          <p
                            className={`text-xs truncate ${
                              unread > 0
                                ? isDarkChat
                                  ? 'font-semibold text-white'
                                  : 'font-semibold text-neutral-900'
                                : 'text-neutral-500'
                            }`}
                          >
                            {c.lastMessageText || 'No messages yet'}
                          </p>
                          {unread > 0 && (
                            <span className="h-5 min-w-[20px] px-1.5 rounded-full bg-brand text-white font-mono text-[10px] font-bold flex items-center justify-center shrink-0">
                              {unread}
                            </span>
                          )}
                        </div>
                      </div>
                    </button>
                  );
                })}
                {conversations.length >= convLimit && (
                  <div className="p-3 text-center">
                    <button
                      type="button"
                      onClick={() => setConvLimit((n) => n + 25)}
                      className="text-xs font-semibold text-brand hover:underline"
                    >
                      Load more conversations
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </aside>

        {/* Active Chat Thread */}
        <section className={`${conversationId ? 'flex' : 'hidden md:flex'} flex-1 flex-col min-w-0`}>
          {activeConv && activeInfo ? (
            <>
              {/* Chat Header */}
              <div
                className={`h-16 px-4 border-b flex items-center justify-between gap-3 ${
                  isDarkChat ? 'border-neutral-800 bg-neutral-950' : 'border-neutral-200 bg-white'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    type="button"
                    onClick={() => navigate('/messages')}
                    aria-label="Back to conversations"
                    className="md:hidden h-9 w-9 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>
                  <div
                    onClick={() => {
                      if (activeConv.isGroup) setGroupModalOpen(true);
                      else if (activeInfo.username) navigate(`/profile/${activeInfo.username}`);
                    }}
                    className="relative cursor-pointer shrink-0"
                  >
                    <Avatar src={activeInfo.avatar} name={activeInfo.name} size="md" />
                    {activeInfo.online && (
                      <span className="absolute bottom-0 right-0 h-3 w-3 rounded-full bg-emerald-500 ring-2 ring-white dark:ring-neutral-950" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display font-bold text-sm truncate flex items-center gap-1.5">
                      <span>{activeInfo.name}</span>
                      {!activeConv.isGroup && activeInfo.otherId && <LiveVerifiedBadge uid={activeInfo.otherId} size={13} />}
                      {!activeConv.isGroup && activeInfo.username && (
                        <span className="text-[11px] font-normal text-neutral-400 hidden sm:inline">
                          @{activeInfo.username}
                        </span>
                      )}
                    </h2>
                    <p className="text-[11px] text-neutral-500 truncate">
                      {otherTyping
                        ? 'Typing...'
                        : activeConv.isGroup
                        ? `${activeConv.participantIds.length} members · Tap info to manage`
                        : activeInfo.online
                        ? 'Active now'
                        : settings?.showOnlineStatus === false
                        ? 'Online status hidden'
                        : peerProfiles[activeInfo.otherId || '']?.lastActiveAt
                        ? `Active ${formatRelativeTime(new Date(Number(peerProfiles[activeInfo.otherId || '']?.lastActiveAt)))}`
                        : 'Offline'}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-1 relative">
                  <button
                    type="button"
                    onClick={() => {
                      setThreadSearchOpen((v) => !v);
                      if (threadSearchOpen) setThreadSearchQuery('');
                    }}
                    title="Search messages in conversation"
                    aria-label="Search in conversation"
                    className={`h-9 w-9 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-900 ${
                      threadSearchOpen ? 'text-brand' : ''
                    }`}
                  >
                    <Search className="w-4 h-4" />
                  </button>

                  {platformSettings.enableCalling !== false && (
                    <>
                      <button
                        type="button"
                        disabled={!activeConv.isGroup && pairBlockStatus !== 'allowed'}
                        onClick={() => handleStartCall('audio')}
                        title={activeConv.isGroup ? 'Start Group Voice Call' : 'Start WebRTC voice call'}
                        aria-label={activeConv.isGroup ? 'Start group voice call' : 'Start voice call'}
                        className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-900 text-brand disabled:opacity-40"
                      >
                        <Phone className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        disabled={!activeConv.isGroup && pairBlockStatus !== 'allowed'}
                        onClick={() => handleStartCall('video')}
                        title={activeConv.isGroup ? 'Start Group Video Call' : 'Start WebRTC video call'}
                        aria-label={activeConv.isGroup ? 'Start group video call' : 'Start video call'}
                        className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-900 text-brand disabled:opacity-40"
                      >
                        <Video className="w-4 h-4" />
                      </button>
                    </>
                  )}

                  {activeConv.isGroup && (
                    <button
                      type="button"
                      onClick={() => setGroupModalOpen(true)}
                      title="Manage group members & settings"
                      aria-label="Group info and members"
                      className="h-9 px-3 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold inline-flex items-center gap-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-900"
                    >
                      <Users className="w-4 h-4 text-brand" />
                      <span className="hidden sm:inline">Group Info</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-label="Conversation options"
                    className="h-9 w-9 rounded-full flex items-center justify-center hover:bg-neutral-100 dark:hover:bg-neutral-900"
                  >
                    <MoreVertical className="w-4 h-4" />
                  </button>
                  {menuOpen && (
                    <div
                      className={`absolute right-0 top-11 w-52 rounded-xl border shadow-xl py-1.5 z-20 text-xs ${
                        isDarkChat
                          ? 'border-neutral-800 bg-neutral-900 text-neutral-100'
                          : 'border-neutral-200 bg-white text-neutral-950'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={async () => {
                          const muted = (activeConv.mutedBy || []).includes(firebaseUser.uid);
                          await updateDoc(doc(db, 'conversations', activeConv.id), {
                            mutedBy: muted ? arrayRemove(firebaseUser.uid) : arrayUnion(firebaseUser.uid),
                          });
                          setMenuOpen(false);
                          toast.info(muted ? 'Notifications unmuted.' : 'Conversation muted.');
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <BellOff className="w-3.5 h-3.5" />
                        {(activeConv.mutedBy || []).includes(firebaseUser.uid) ? 'Unmute Chat' : 'Mute Chat'}
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const archived = (activeConv.archivedBy || []).includes(firebaseUser.uid);
                          await updateDoc(doc(db, 'conversations', activeConv.id), {
                            archivedBy: archived ? arrayRemove(firebaseUser.uid) : arrayUnion(firebaseUser.uid),
                          });
                          setMenuOpen(false);
                          navigate('/messages');
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Archive className="w-3.5 h-3.5" />
                        {(activeConv.archivedBy || []).includes(firebaseUser.uid) ? 'Unarchive Chat' : 'Archive Chat'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setMenuOpen(false);
                          setReportTarget({ type: 'conversation', id: activeConv.id, conversationId: activeConv.id });
                        }}
                        className="w-full px-3.5 py-2 text-left flex items-center gap-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Flag className="w-3.5 h-3.5" /> Report Abuse
                      </button>
                      {!activeConv.isGroup && activeInfo.otherId && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            const targetUid = activeInfo.otherId!;
                            setConfirmState({
                              title: `Block ${activeInfo.name}?`,
                              description:
                                'They will no longer be able to send you messages or start voice/video calls with you.',
                              confirmLabel: 'Block User',
                              action: async () => {
                                await setDoc(doc(db, 'userBlocks', `${firebaseUser.uid}_${targetUid}`), {
                                  blockerId: firebaseUser.uid,
                                  blockedUid: targetUid,
                                  createdAt: serverTimestamp(),
                                });
                                setPairBlockStatus('blocked');
                                setPairBlockReason('You blocked this user. Unblock them in Settings to interact.');
                                toast.info(`${activeInfo.name} has been blocked.`);
                              },
                            });
                          }}
                          className="w-full px-3.5 py-2 text-left flex items-center gap-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30"
                        >
                          <Ban className="w-3.5 h-3.5" /> Block User
                        </button>
                      )}
                    </div>
                  )}
                </div>
              </div>

              {/* Message Request Banner */}
              {activeConv.isRequest && activeConv.requestRecipientId === firebaseUser.uid && (
                <div className="px-4 py-3 bg-brand/8 dark:bg-brand/15 border-b border-brand/20 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-medium">
                    Message request from {activeInfo.name}. Accept to move into your Inbox, or decline/block.
                  </span>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        updateDoc(doc(db, 'conversations', activeConv.id), {
                          isRequest: false,
                          updatedAt: serverTimestamp(),
                        })
                      }
                      className="px-3 py-1.5 rounded-lg bg-brand text-white font-semibold"
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setConfirmState({
                          title: 'Decline Message Request',
                          description: 'This will archive the request out of your Requests tab.',
                          confirmLabel: 'Decline',
                          action: async () => {
                            await updateDoc(doc(db, 'conversations', activeConv.id), {
                              archivedBy: arrayUnion(firebaseUser.uid),
                            });
                            navigate('/messages');
                          },
                        })
                      }
                      className="px-3 py-1.5 rounded-lg border border-neutral-300 dark:border-neutral-700 font-semibold"
                    >
                      Decline
                    </button>
                    {activeInfo.otherId && (
                      <button
                        type="button"
                        onClick={() =>
                          setConfirmState({
                            title: `Block ${activeInfo.name}`,
                            description: 'Block this user and prevent future message requests or calls.',
                            confirmLabel: 'Block',
                            action: async () => {
                              await setDoc(doc(db, 'userBlocks', `${firebaseUser.uid}_${activeInfo.otherId}`), {
                                blockerId: firebaseUser.uid,
                                blockedUid: activeInfo.otherId,
                                createdAt: serverTimestamp(),
                              });
                              await updateDoc(doc(db, 'conversations', activeConv.id), {
                                archivedBy: arrayUnion(firebaseUser.uid),
                              });
                              navigate('/messages');
                            },
                          })
                        }
                        className="px-3 py-1.5 rounded-lg bg-red-600 text-white font-semibold"
                      >
                        Block
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Block / Restriction Banner */}
              {(pairBlockStatus !== 'allowed' || profile.messagingRestricted) && (
                <div className="px-4 py-2.5 bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900/50 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-2">
                  <span>
                    {profile.messagingRestricted
                      ? 'Your messaging privileges are currently restricted by BANA Safety.'
                      : pairBlockReason}
                  </span>
                  <button
                    type="button"
                    onClick={() => navigate('/settings')}
                    className="underline font-semibold shrink-0"
                  >
                    Privacy Settings
                  </button>
                </div>
              )}

              {/* In-Chat Message Search Bar */}
              {threadSearchOpen && (
                <div className="px-4 py-2 border-b border-neutral-200 dark:border-neutral-800 flex items-center gap-2">
                  <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                  <input
                    type="search"
                    value={threadSearchQuery}
                    onChange={(e) => setThreadSearchQuery(e.target.value)}
                    placeholder="Search inside this conversation..."
                    className="flex-1 bg-transparent text-xs focus:outline-none"
                  />
                  {threadSearchQuery && (
                    <button
                      type="button"
                      onClick={() => setThreadSearchQuery('')}
                      className="text-[11px] text-neutral-500 hover:underline"
                    >
                      Clear
                    </button>
                  )}
                </div>
              )}

              {/* Active Group Call Banner inside Thread */}
              {activeConv.isGroup && activeGroupRoomsByConversation[activeConv.id] && (
                <div className="px-4 py-2.5 bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-200 dark:border-emerald-900/50 flex items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2">
                    <Users className="w-4 h-4" />
                    Group {activeGroupRoomsByConversation[activeConv.id].callType} call active (
                    {activeGroupRoomsByConversation[activeConv.id].activeParticipantIds.length}/
                    {activeGroupRoomsByConversation[activeConv.id].maxParticipants} joined)
                  </span>
                  <button
                    type="button"
                    onClick={() => joinGroupCall(activeGroupRoomsByConversation[activeConv.id])}
                    className="px-3 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold"
                  >
                    Join Call
                  </button>
                </div>
              )}

              {/* Messages Stream */}
              <div className="flex-1 overflow-y-auto p-4 space-y-3">
                {messages.length >= msgLimit && (
                  <div className="text-center pb-2">
                    <button
                      type="button"
                      onClick={() => setMsgLimit((n) => n + 50)}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-neutral-200 dark:border-neutral-800 text-xs font-medium hover:bg-neutral-50 dark:hover:bg-neutral-900"
                    >
                      <ChevronUp className="w-3.5 h-3.5" /> Load older messages
                    </button>
                  </div>
                )}

                {messages
                  .filter((m) => {
                    if (!threadSearchQuery.trim()) return true;
                    const q = threadSearchQuery.toLowerCase();
                    return (
                      String(m.text || '').toLowerCase().includes(q) ||
                      String(m.fileName || '').toLowerCase().includes(q)
                    );
                  })
                  .map((m) => {
                  const mine = m.senderId === firebaseUser.uid;
                  const readCount = (m.readBy || []).length;
                  const deliveredCount = (m.deliveredTo || []).length;
                  const senderMeta = activeConv.participantMeta?.[m.senderId];
                  const canEdit =
                    mine &&
                    m.type === 'text' &&
                    !m.isDeleted &&
                    Date.now() - getCreatedMs(m.createdAt) <= EDIT_WINDOW_MS;

                  return (
                    <div key={m.id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'} group`}>
                      {activeConv.isGroup && !mine && senderMeta?.displayName && (
                        <span className="text-[11px] text-neutral-500 mb-0.5 px-1 inline-flex items-center gap-1">
                          {senderMeta.displayName}
                          <LiveVerifiedBadge uid={m.senderId} size={11} />
                        </span>
                      )}

                      {m.replyPreview && (
                        <div className="text-[11px] text-neutral-400 mb-1 px-2 border-l-2 border-brand">
                          Replying to: {m.replyPreview}
                        </div>
                      )}

                      <div className="flex items-end gap-1.5 max-w-[85%] sm:max-w-[70%]">
                        <div className={`px-3.5 py-2.5 text-sm space-y-1.5 ${getBubbleClasses(mine, m.isDeleted)}`}>
                          {m.isDeleted ? (
                            <p className="text-xs">Message deleted</p>
                          ) : (
                            <>
                              {m.type === 'image' && m.mediaUrl && (
                                <img loading="lazy"
                                  src={m.mediaUrl}
                                  alt={m.fileName || 'Attachment'}
                                  referrerPolicy="no-referrer"
                                  className="rounded-xl max-h-72 object-cover"
                                />
                              )}
                              {m.type === 'video' && m.mediaUrl && (
                                <video src={m.mediaUrl} controls className="rounded-xl max-h-72" />
                              )}
                              {m.type === 'voice' && m.mediaUrl && (
                                <VoicePlayer
                                  audioUrl={m.mediaUrl}
                                  durationSeconds={m.audioDuration || 10}
                                  waveform={m.audioWaveform}
                                />
                              )}
                              {m.type === 'audio' && m.mediaUrl && (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-1.5 text-xs font-medium">
                                    <Music className="w-3.5 h-3.5 shrink-0" />
                                    <span className="truncate">{m.fileName || 'Audio Track'}</span>
                                  </div>
                                  <audio src={m.mediaUrl} controls className="h-9 max-w-[240px]" />
                                </div>
                              )}
                              {m.type === 'file' && m.mediaUrl && (
                                <a
                                  href={m.mediaUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 underline text-xs"
                                >
                                  <FileText className="w-4 h-4 shrink-0" />
                                  {m.fileName || 'Download File'}
                                </a>
                              )}

                              {(m.type === 'shared_post' || m.type === 'shared_reel') && m.sharedSnapshot && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (m.type === 'shared_reel' && m.sharedTargetId) {
                                      navigate(`/reels?reel=${encodeURIComponent(m.sharedTargetId)}`);
                                    } else {
                                      navigate(`/profile/${m.sharedSnapshot!.authorUsername}`);
                                    }
                                  }}
                                  className={`w-full text-left rounded-xl p-2.5 border space-y-1.5 transition-opacity hover:opacity-95 ${
                                    mine
                                      ? 'bg-black/15 border-white/20 text-white'
                                      : 'bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800 text-neutral-900 dark:text-neutral-100'
                                  }`}
                                >
                                  <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                                    <span className="inline-flex items-center gap-1">
                                      {m.type === 'shared_reel' && <Film className="w-3.5 h-3.5" />}
                                      {m.sharedSnapshot.authorName} (@{m.sharedSnapshot.authorUsername})
                                    </span>
                                    <ExternalLink className="w-3 h-3 opacity-75 shrink-0" />
                                  </div>
                                  {m.sharedSnapshot.mediaUrl && (
                                    <img loading="lazy"
                                      src={m.sharedSnapshot.mediaUrl}
                                      alt="Shared preview"
                                      referrerPolicy="no-referrer"
                                      className="rounded-lg max-h-40 w-full object-cover"
                                    />
                                  )}
                                  {m.sharedSnapshot.content && (
                                    <p className="text-xs opacity-90 line-clamp-2">{m.sharedSnapshot.content}</p>
                                  )}
                                </button>
                              )}

                              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
                            </>
                          )}

                          <div
                            className={`flex items-center justify-end gap-1 text-[10px] ${
                              mine && bubbleStyle !== 'soft' ? 'text-white/75' : 'text-neutral-400'
                            }`}
                          >
                            {m.isEdited && <span>Edited ·</span>}
                            <span>{formatRelativeTime(m.createdAt)}</span>
                            {mine && (
                              readCount > 1 && settings?.showReadReceipts !== false ? (
                                <span title="Seen">
                                  <CheckCheck className={`w-3.5 h-3.5 ${bubbleStyle === 'classic' ? 'text-blue-200' : 'text-brand'}`} />
                                </span>
                              ) : deliveredCount > 1 ? (
                                <span title="Delivered">
                                  <CheckCheck className="w-3.5 h-3.5 opacity-80" />
                                </span>
                              ) : (
                                <span title="Sent">
                                  <Check className="w-3 h-3 opacity-80" />
                                </span>
                              )
                            )}
                          </div>
                        </div>

                        {!m.isDeleted && (
                          <div className="opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity flex items-center gap-0.5 shrink-0">
                            <button
                              type="button"
                              onClick={() => setReactTargetId(reactTargetId === m.id ? null : m.id)}
                              className="p-1 text-neutral-400 hover:text-brand"
                              title="React"
                            >
                              <Smile className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => setReplyTo(m)}
                              className="p-1 text-neutral-400 hover:text-brand"
                              title="Reply"
                            >
                              <Reply className="w-3.5 h-3.5" />
                            </button>
                            {m.text && (
                              <button
                                type="button"
                                onClick={() => {
                                  if (!navigator.clipboard?.writeText) {
                                    toast.error('Copying is not supported in this browser.');
                                    return;
                                  }
                                  navigator.clipboard
                                    .writeText(m.text || '')
                                    .then(() => toast.info('Message copied.'))
                                    .catch(() => toast.error('Could not copy the message.'));
                                }}
                                className="p-1 text-neutral-400 hover:text-brand"
                                title="Copy text"
                              >
                                <Copy className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {!mine && (
                              <button
                                type="button"
                                onClick={() =>
                                  setReportTarget({
                                    type: 'message',
                                    id: m.id,
                                    evidence: m.text || undefined,
                                    conversationId: activeConv.id,
                                  })
                                }
                                className="p-1 text-neutral-400 hover:text-amber-500"
                                title="Report message"
                                aria-label="Report message"
                              >
                                <Flag className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {canEdit && (
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingMsg(m);
                                  setTextInput(m.text || '');
                                }}
                                className="p-1 text-neutral-400 hover:text-brand"
                                title="Edit (within 15m)"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                              </button>
                            )}
                            {mine && (
                              <button
                                type="button"
                                onClick={() =>
                                  setConfirmState({
                                    title: 'Delete Message',
                                    description: 'Delete this message for everyone in the conversation?',
                                    confirmLabel: 'Delete',
                                    action: async () => {
                                      await updateDoc(doc(db, 'messages', m.id), {
                                        isDeleted: true,
                                        text: '',
                                        mediaUrl: '',
                                        updatedAt: serverTimestamp(),
                                      });
                                    },
                                  })
                                }
                                className="p-1 text-neutral-400 hover:text-red-500"
                                title="Delete message"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        )}
                      </div>

                      {reactTargetId === m.id && (
                        <div className="mt-1 flex items-center gap-1 rounded-full border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2 py-1 shadow">
                          {QUICK_REACTIONS.map((emoji) => (
                            <button
                              key={emoji}
                              type="button"
                              onClick={async () => {
                                const current = m.reactions?.[emoji] || [];
                                const updated = current.includes(firebaseUser.uid)
                                  ? current.filter((u) => u !== firebaseUser.uid)
                                  : [...current, firebaseUser.uid];
                                await updateDoc(doc(db, 'messages', m.id), {
                                  [`reactions.${emoji}`]: updated,
                                });
                                setReactTargetId(null);
                              }}
                              className="text-sm hover:scale-125 transition-transform px-0.5"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}

                      {m.reactions && Object.values(m.reactions).some((arr) => arr.length > 0) && (
                        <div className="flex items-center gap-1 mt-1 text-xs">
                          {Object.entries(m.reactions)
                            .filter(([, users]) => users.length > 0)
                            .map(([emoji, users]) => (
                              <span
                                key={emoji}
                                className="px-1.5 py-0.5 rounded-full bg-neutral-100 dark:bg-neutral-800 text-[11px]"
                              >
                                {emoji} {users.length}
                              </span>
                            ))}
                        </div>
                      )}
                    </div>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Input Footer */}
              <div className={`p-3 border-t space-y-2 ${isDarkChat ? 'border-neutral-800' : 'border-neutral-200'}`}>
                {errorMsg && <p className="text-xs text-red-500">{errorMsg}</p>}
                {(replyTo || editingMsg) && (
                  <div className="flex items-center justify-between text-xs px-3 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900">
                    <span className="truncate">
                      {editingMsg ? 'Editing message (15m window)' : `Replying to: ${replyTo?.text || replyTo?.type}`}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTo(null);
                        setEditingMsg(null);
                        setTextInput('');
                      }}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}

                {showVoice && pairBlockStatus === 'allowed' && !profile.messagingRestricted && (
                  <VoiceRecorder
                    uid={firebaseUser.uid}
                    storagePrefix={`messages/${activeConv.id}`}
                    submitLabel="Send Voice"
                    onCancel={() => setShowVoice(false)}
                    onUploaded={async (payload) => {
                      await sendMessage({
                        type: 'voice',
                        mediaUrl: payload.audioUrl,
                        audioDuration: payload.durationSeconds,
                        audioWaveform: payload.waveform,
                      });
                      setShowVoice(false);
                    }}
                  />
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!textInput.trim()) return;
                    sendMessage({ type: 'text', text: textInput.trim() });
                  }}
                  className="flex items-center gap-2"
                >
                  <input
                    ref={imageInputRef}
                    type="file"
                    accept="image/*,video/mp4,video/webm"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f, 'image');
                    }}
                  />
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".pdf,.txt,.zip,.doc,.docx,.mp3,.m4a,.wav,.ogg,audio/*"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) handleFileUpload(f, 'file');
                    }}
                  />

                  <button
                    type="button"
                    disabled={uploading || pairBlockStatus !== 'allowed' || profile.messagingRestricted}
                    onClick={() => imageInputRef.current?.click()}
                    className="h-10 w-10 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center shrink-0 disabled:opacity-40"
                    title="Share photo or video"
                  >
                    <ImageIcon className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={uploading || pairBlockStatus !== 'allowed' || profile.messagingRestricted}
                    onClick={() => fileInputRef.current?.click()}
                    className="h-10 w-10 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center shrink-0 disabled:opacity-40"
                    title="Share safe file"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    disabled={pairBlockStatus !== 'allowed' || profile.messagingRestricted}
                    onClick={() => setShowVoice((v) => !v)}
                    className="h-10 w-10 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center shrink-0 disabled:opacity-40"
                    title="Send voice message"
                  >
                    <Mic className="w-4 h-4" />
                  </button>

                  <input
                    type="text"
                    disabled={pairBlockStatus !== 'allowed' || profile.messagingRestricted}
                    value={textInput}
                    onChange={(e) => {
                      setTextInput(e.target.value);
                      sendTypingPing();
                    }}
                    placeholder={
                      pairBlockStatus !== 'allowed'
                        ? 'Messaging unavailable'
                        : uploading
                        ? 'Uploading attachment...'
                        : 'Write a message...'
                    }
                    className={`flex-1 h-10 rounded-xl border px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-brand disabled:opacity-50 ${
                      isDarkChat
                        ? 'border-neutral-800 bg-neutral-900 text-white'
                        : 'border-neutral-200 bg-neutral-50 text-neutral-950'
                    }`}
                  />

                  <button
                    type="submit"
                    disabled={!textInput.trim() || uploading || pairBlockStatus !== 'allowed' || profile.messagingRestricted}
                    className="h-10 px-4 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover disabled:opacity-50 inline-flex items-center gap-1.5"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </div>
            </>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-3">
              <div className="h-14 w-14 rounded-2xl bg-brand/10 text-brand flex items-center justify-center">
                <Users className="w-7 h-7" />
              </div>
              <h2 className="font-display font-bold text-lg">BANA Messenger</h2>
              <p className="text-xs text-neutral-500 max-w-xs">
                Real-time 1-to-1 and group chats, voice notes with speed controls, and peer-to-peer WebRTC audio & video calls.
              </p>
              <button
                type="button"
                onClick={() => setNewChatOpen(true)}
                className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold"
              >
                New Conversation
              </button>
            </div>
          )}
        </section>
      </div>

      {/* Group Management Modal */}
      <GroupManageModal
        isOpen={groupModalOpen}
        conversation={activeConv}
        onClose={() => setGroupModalOpen(false)}
        onLeftGroup={() => navigate('/messages')}
      />

      {/* New Chat / Group Modal */}
      {newChatOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display font-bold text-base">Start Chat or Group</h3>
              <button type="button" onClick={() => setNewChatOpen(false)}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <input
              type="text"
              value={userSearch}
              onChange={(e) => setUserSearch(e.target.value)}
              placeholder="Search users by name or @username..."
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
            />

            {selectedUids.length > 1 && (
              <div className="space-y-2">
                <input
                  type="text"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  placeholder="Group name (required or auto-named)"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
                />
                <input
                  type="text"
                  value={groupDescription}
                  onChange={(e) => setGroupDescription(e.target.value)}
                  placeholder="Group description (optional)"
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                />
              </div>
            )}

            <div className="max-h-60 overflow-y-auto space-y-1.5">
              {userResults
                .filter((u) =>
                  `${u.displayName} ${u.username}`.toLowerCase().includes(userSearch.toLowerCase())
                )
                .map((u) => {
                  const chosen = selectedUids.some((s) => s.uid === u.uid);
                  return (
                    <button
                      key={u.uid}
                      type="button"
                      onClick={() =>
                        setSelectedUids((prev) =>
                          chosen ? prev.filter((p) => p.uid !== u.uid) : [...prev, u]
                        )
                      }
                      className={`w-full p-2.5 rounded-xl flex items-center justify-between text-left border ${
                        chosen
                          ? 'border-brand bg-blue-50 dark:bg-blue-950/30'
                          : 'border-neutral-200 dark:border-neutral-800'
                      }`}
                    >
                      <div className="flex items-center gap-2.5">
                        <Avatar src={u.avatarUrl} name={u.displayName} size="sm" />
                        <div>
                          <p className="text-xs font-semibold flex items-center gap-1">{u.displayName}<LiveVerifiedBadge uid={u.uid} size={12} /></p>
                          <p className="text-[11px] text-neutral-500">@{u.username}</p>
                        </div>
                      </div>
                      {chosen && <Check className="w-4 h-4 text-brand" />}
                    </button>
                  );
                })}
            </div>

            <button
              type="button"
              disabled={selectedUids.length === 0}
              onClick={handleCreateConversation}
              className="w-full h-10 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-50"
            >
              {selectedUids.length > 1 ? 'Create Group Chat' : 'Open Conversation'}
            </button>
          </div>
        </div>
      )}

      <ReportDialog
        open={Boolean(reportTarget)}
        targetType={reportTarget?.type || 'conversation'}
        targetId={reportTarget?.id || ''}
        evidence={reportTarget?.evidence}
        context={{ conversationId: reportTarget?.conversationId }}
        title={reportTarget?.type === 'message' ? 'Report message' : 'Report conversation'}
        onClose={() => setReportTarget(null)}
      />

      <ConfirmDialog
        isOpen={Boolean(confirmState)}
        title={confirmState?.title || ''}
        description={confirmState?.description || ''}
        confirmLabel={confirmState?.confirmLabel || 'Confirm'}
        onConfirm={async () => {
          if (confirmState) {
            await confirmState.action();
            setConfirmState(null);
          }
        }}
        onCancel={() => setConfirmState(null)}
      />
    </AppShell>
  );
}
