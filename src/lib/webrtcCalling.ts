import {
  addDoc,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { auth, db } from '@/src/firebase';
import { invokeCloudFunction } from '@/src/lib/firebasePlan';
import { getBackendBaseUrl } from '@/src/lib/calling/callingProvider';
import { createSocialNotification } from '@/src/lib/socialGraph';
import {
  getDocsWithIndexFallback,
  sortByCreatedAtDesc,
  subscribeWithIndexFallback,
} from '@/src/lib/firestoreQuery';
import type { BanaUser } from '@/src/types/bana';
import type {
  CallRecord,
  CallType,
  CallingConfigSnapshot,
  CallingProviderId,
  GroupCallParticipant,
  GroupCallRecord,
  GroupCallSignal,
  IceCandidateRecord,
} from '@/src/types/calling';

/**
 * BANA WebRTC Calling Engine
 *
 * Design guarantees:
 * 1. Firestore (`calls/{callId}` and `calls/{callId}/candidates`) carries ONLY
 *    signaling metadata (SDP offers/answers, ICE candidates, call state).
 *    Audio and video media streams NEVER pass through Firestore.
 * 2. TURN credentials are NEVER stored in frontend code. Public STUN servers come
 *    from `adminSettings/calling`, and optional ephemeral TURN HMAC credentials are
 *    minted server-side via `getWebRTCIceConfig` Cloud Function.
 */

export const DEFAULT_STUN_SERVERS = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
];

export const CALL_RING_TIMEOUT_MS = 45000;

export async function fetchCallingConfig(): Promise<CallingConfigSnapshot> {
  try {
    const snap = await getDoc(doc(db, 'adminSettings', 'calling'));
    if (snap.exists()) {
      const data = snap.data();
      return {
        webrtcEnabled: data.webrtcEnabled !== false,
        allowVoiceCalls: data.allowVoiceCalls !== false,
        allowVideoCalls: data.allowVideoCalls !== false,
        allowGroupCalls: data.allowGroupCalls !== false,
        allowScreenSharing: data.allowScreenSharing !== false,
        maxGroupCallParticipants: Math.max(2, Math.min(50, Number(data.maxGroupCallParticipants || 8))),
        activeCallingProvider: (data.activeCallingProvider || 'webrtc_builtin') as CallingProviderId,
        stunServers:
          Array.isArray(data.stunServers) && data.stunServers.length > 0
            ? data.stunServers
            : DEFAULT_STUN_SERVERS,
        turnRelayHint: data.turnRelayHint || '',
        turnProvider: data.turnProvider || 'none',
        maxCallDurationMinutes: Number(data.maxCallDurationMinutes || 60),
      };
    }
  } catch {
    // Fallback to STUN defaults when rules are pending
  }
  return {
    webrtcEnabled: true,
    allowVoiceCalls: true,
    allowVideoCalls: true,
    allowGroupCalls: true,
    allowScreenSharing: true,
    maxGroupCallParticipants: 8,
    activeCallingProvider: 'webrtc_builtin',
    stunServers: DEFAULT_STUN_SERVERS,
    turnRelayHint: '',
    turnProvider: 'none',
    maxCallDurationMinutes: 60,
  };
}

export async function fetchEffectiveIceServers(
  fallbackConfig: CallingConfigSnapshot
): Promise<{ iceServers: RTCIceServer[]; turnConfigured: boolean }> {
  const backendUrl = getBackendBaseUrl();
  if (backendUrl && auth.currentUser) {
    try {
      const token = await auth.currentUser.getIdToken();
      const resp = await fetch(`${backendUrl}/api/calling/ice-servers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
          return {
            iceServers: data.iceServers,
            turnConfigured: Boolean(data.turnConfigured),
          };
        }
      }
    } catch {
      // Fallback gracefully
    }
  }

  try {
    const data = await invokeCloudFunction<unknown, { iceServers?: RTCIceServer[]; turnConfigured?: boolean }>(
      'getWebRTCIceConfig'
    );
    if (Array.isArray(data?.iceServers) && data.iceServers.length > 0) {
      return {
        iceServers: data.iceServers,
        turnConfigured: Boolean(data.turnConfigured),
      };
    }
  } catch {
    // Functions may not be deployed yet; safely fall back to configured STUN servers
  }
  return {
    iceServers: fallbackConfig.stunServers.map((urls) => ({ urls })),
    turnConfigured: false,
  };
}

export async function acquireLocalCallMedia(
  callType: CallType,
  facingMode: 'user' | 'environment' = 'user'
): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    throw new Error('Your browser or current context does not support WebRTC media capture.');
  }
  try {
    return await navigator.mediaDevices.getUserMedia({
      audio: true,
      video:
        callType === 'video'
          ? { facingMode, width: { ideal: 1280 }, height: { ideal: 720 } }
          : false,
    });
  } catch (err: any) {
    if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
      throw new Error(
        callType === 'video'
          ? 'Microphone and camera permissions were denied. Allow access in browser settings to place a video call.'
          : 'Microphone permission was denied. Allow access in browser settings to place a voice call.'
      );
    }
    if (err?.name === 'NotFoundError' || err?.name === 'DevicesNotFoundError') {
      throw new Error(
        callType === 'video'
          ? 'No microphone or camera hardware detected on this device.'
          : 'No microphone hardware detected on this device.'
      );
    }
    if (err?.name === 'NotReadableError') {
      throw new Error('Microphone or camera is currently in use by another application.');
    }
    throw new Error(err?.message || 'Unable to access microphone/camera for calling.');
  }
}

export function createConfiguredPeerConnection(iceServers: RTCIceServer[]): RTCPeerConnection {
  if (typeof RTCPeerConnection === 'undefined') {
    throw new Error('WebRTC RTCPeerConnection is not supported in this browser.');
  }
  return new RTCPeerConnection({
    iceServers,
    iceCandidatePoolSize: 4,
  });
}

export async function checkPairBlockedAndPrivacy(
  myUid: string,
  otherUid: string,
  intent: 'message' | 'call'
): Promise<{
  status: 'allowed' | 'request' | 'blocked' | 'denied';
  reason?: string;
  otherUser?: BanaUser;
}> {
  if (!myUid || !otherUid || myUid === otherUid) {
    return { status: 'denied', reason: 'Invalid recipient.' };
  }

  const [myBlockSnap, theirBlockSnap, otherUserSnap] = await Promise.all([
    getDoc(doc(db, 'userBlocks', `${myUid}_${otherUid}`)).catch(() => null),
    getDoc(doc(db, 'userBlocks', `${otherUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'users', otherUid)).catch(() => null),
  ]);

  if (myBlockSnap?.exists()) {
    return { status: 'blocked', reason: 'You blocked this user. Unblock them in Settings to interact.' };
  }
  if (theirBlockSnap?.exists()) {
    return { status: 'blocked', reason: 'You cannot contact this user because messaging is restricted.' };
  }

  const otherUser = otherUserSnap?.exists()
    ? ({ uid: otherUserSnap.id, ...(otherUserSnap.data() as Omit<BanaUser, 'uid'>) })
    : undefined;

  if (otherUser?.accountStatus === 'banned' || otherUser?.accountStatus === 'suspended') {
    return { status: 'denied', reason: 'This account is currently unavailable.' };
  }
  if (otherUser?.messagingRestricted) {
    return { status: 'denied', reason: 'This user’s messaging access is currently restricted.' };
  }

  const policy =
    intent === 'call'
      ? otherUser?.whoCanCall || 'everyone'
      : otherUser?.whoCanMessage || 'everyone';

  if (policy === 'nobody') {
    return {
      status: 'denied',
      reason:
        intent === 'call'
          ? 'This user does not accept incoming calls.'
          : 'This user has disabled incoming direct messages.',
      otherUser,
    };
  }

  if (policy === 'followers') {
    const followSnap = await getDoc(doc(db, 'userFollows', `${myUid}_${otherUid}`)).catch(() => null);
    if (!followSnap?.exists()) {
      if (intent === 'call') {
        return { status: 'denied', reason: 'Only followers can call this user.', otherUser };
      }
      return { status: 'request', otherUser };
    }
  }

  if (intent === 'call' || intent === 'message') {
    const restrictedSnap = await getDoc(doc(db, 'userRestrictions', `${otherUid}_${myUid}`)).catch(() => null);
    if (restrictedSnap?.exists()) {
      if (intent === 'call') {
        return { status: 'denied', reason: 'You cannot place calls to this user.', otherUser };
      }
      return { status: 'request', otherUser };
    }
  }

  if (policy === 'friends') {
    const pairId = [myUid, otherUid].sort().join('_');
    const [friendshipSnap, f1, f2] = await Promise.all([
      getDoc(doc(db, 'friendships', pairId)).catch(() => null),
      getDoc(doc(db, 'userFollows', `${myUid}_${otherUid}`)).catch(() => null),
      getDoc(doc(db, 'userFollows', `${otherUid}_${myUid}`)).catch(() => null),
    ]);
    const isFriend = Boolean(friendshipSnap?.exists()) || Boolean(f1?.exists() && f2?.exists());
    if (!isFriend) {
      if (intent === 'call') {
        return { status: 'denied', reason: 'Only friends can call this user.', otherUser };
      }
      return { status: 'request', otherUser };
    }
  }

  return { status: 'allowed', otherUser };
}

export async function initiateWebRTCCall(params: {
  conversationId: string;
  callType: CallType;
  caller: { uid: string; displayName: string; avatarUrl?: string };
  callee: { uid: string; displayName: string; avatarUrl?: string };
  localStream: MediaStream;
  iceServers: RTCIceServer[];
}): Promise<{ callId: string; pc: RTCPeerConnection }> {
  const pc = createConfiguredPeerConnection(params.iceServers);
  params.localStream.getTracks().forEach((track) => pc.addTrack(track, params.localStream));

  const offer = await pc.createOffer({
    offerToReceiveAudio: true,
    offerToReceiveVideo: params.callType === 'video',
  });
  await pc.setLocalDescription(offer);

  const callRef = await addDoc(collection(db, 'calls'), {
    conversationId: params.conversationId,
    callType: params.callType,
    callerId: params.caller.uid,
    callerName: params.caller.displayName,
    callerAvatar: params.caller.avatarUrl || '',
    calleeId: params.callee.uid,
    calleeName: params.callee.displayName,
    calleeAvatar: params.callee.avatarUrl || '',
    status: 'calling',
    offer: {
      type: offer.type,
      sdp: offer.sdp || '',
    },
    expiresAtMs: Date.now() + CALL_RING_TIMEOUT_MS,
    hiddenBy: [],
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      addDoc(collection(db, 'calls', callRef.id, 'candidates'), {
        senderId: params.caller.uid,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? null,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  };

  return { callId: callRef.id, pc };
}

export async function answerWebRTCCall(params: {
  call: CallRecord;
  uid: string;
  localStream: MediaStream;
  iceServers: RTCIceServer[];
}): Promise<RTCPeerConnection> {
  if (!params.call.offer?.sdp) {
    throw new Error('Missing caller SDP offer for this call.');
  }
  const pc = createConfiguredPeerConnection(params.iceServers);
  params.localStream.getTracks().forEach((track) => pc.addTrack(track, params.localStream));

  await pc.setRemoteDescription(
    new RTCSessionDescription({ type: params.call.offer.type, sdp: params.call.offer.sdp })
  );
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  await updateDoc(doc(db, 'calls', params.call.id), {
    status: 'connected',
    answer: {
      type: answer.type,
      sdp: answer.sdp || '',
    },
    startedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  pc.onicecandidate = (event) => {
    if (event.candidate) {
      addDoc(collection(db, 'calls', params.call.id, 'candidates'), {
        senderId: params.uid,
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? null,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? null,
        createdAt: serverTimestamp(),
      }).catch(() => {});
    }
  };

  return pc;
}

export async function triggerIceRestart(callId: string, pc: RTCPeerConnection): Promise<void> {
  const offer = await pc.createOffer({ iceRestart: true });
  await pc.setLocalDescription(offer);
  await updateDoc(doc(db, 'calls', callId), {
    status: 'reconnecting',
    offer: {
      type: offer.type,
      sdp: offer.sdp || '',
    },
    updatedAt: serverTimestamp(),
  });
}

export async function updateCallStatus(
  callId: string,
  status: CallRecord['status'],
  extra?: { endReason?: string; durationSeconds?: number }
) {
  await updateDoc(doc(db, 'calls', callId), {
    status,
    ...(extra?.endReason ? { endReason: extra.endReason } : {}),
    ...(typeof extra?.durationSeconds === 'number' ? { durationSeconds: extra.durationSeconds } : {}),
    ...(status === 'ended' || status === 'rejected' || status === 'missed' || status === 'failed'
      ? { endedAt: serverTimestamp() }
      : {}),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

export function subscribeIncomingCalls(
  uid: string,
  onCall: (call: CallRecord | null) => void
) {
  const primaryQ = query(
    collection(db, 'calls'),
    where('calleeId', '==', uid),
    where('status', '==', 'calling'),
    orderBy('createdAt', 'desc'),
    limit(1)
  );
  const fallbackQ = query(
    collection(db, 'calls'),
    where('calleeId', '==', uid),
    where('status', '==', 'calling'),
    limit(10)
  );
  return subscribeWithIndexFallback<CallRecord>({
    primaryQuery: primaryQ,
    fallbackQuery: fallbackQ,
    comparator: sortByCreatedAtDesc,
    onData: (list) => {
      if (list.length === 0) {
        onCall(null);
      } else {
        const rec = list[0];
        if (rec.expiresAtMs && Date.now() > rec.expiresAtMs + 5000) {
          updateCallStatus(rec.id, 'missed', { endReason: 'expired' });
          onCall(null);
          return;
        }
        onCall(rec);
      }
    },
    onError: () => onCall(null),
  });
}

export function subscribeCallSignaling(
  callId: string,
  selfUid: string,
  pc: RTCPeerConnection | null,
  initialOfferSdp: string | undefined,
  onCallUpdated: (call: CallRecord) => void
) {
  const seenCandidates = new Set<string>();
  let lastAppliedAnswerSdp = '';
  let lastAppliedOfferSdp = initialOfferSdp || '';

  const unsubDoc = onSnapshot(doc(db, 'calls', callId), async (snap) => {
    if (!snap.exists()) return;
    const data = { id: snap.id, ...(snap.data() as Omit<CallRecord, 'id'>) };

    if (pc && data.callerId === selfUid && data.answer?.sdp && data.answer.sdp !== lastAppliedAnswerSdp) {
      lastAppliedAnswerSdp = data.answer.sdp;
      await pc
        .setRemoteDescription(new RTCSessionDescription({ type: data.answer.type, sdp: data.answer.sdp }))
        .catch(() => {});
    }

    // Callee responds to an ICE-restart offer from caller
    if (
      pc &&
      data.calleeId === selfUid &&
      data.status === 'reconnecting' &&
      data.offer?.sdp &&
      data.offer.sdp !== lastAppliedOfferSdp
    ) {
      lastAppliedOfferSdp = data.offer.sdp;
      try {
        await pc.setRemoteDescription(
          new RTCSessionDescription({ type: data.offer.type, sdp: data.offer.sdp })
        );
        const freshAnswer = await pc.createAnswer();
        await pc.setLocalDescription(freshAnswer);
        await updateDoc(doc(db, 'calls', callId), {
          status: 'connected',
          answer: { type: freshAnswer.type, sdp: freshAnswer.sdp || '' },
          updatedAt: serverTimestamp(),
        });
      } catch {
        // Handled by connectionState change listener
      }
    }

    onCallUpdated(data);
  });

  const unsubCandidates = onSnapshot(
    query(collection(db, 'calls', callId, 'candidates'), orderBy('createdAt', 'asc'), limit(120)),
    (snap) => {
      if (!pc) return;
      snap.docs.forEach((d) => {
        if (seenCandidates.has(d.id)) return;
        const c = d.data() as Omit<IceCandidateRecord, 'id'>;
        if (c.senderId === selfUid) return;
        seenCandidates.add(d.id);
        pc.addIceCandidate(
          new RTCIceCandidate({
            candidate: c.candidate,
            sdpMid: c.sdpMid ?? undefined,
            sdpMLineIndex: c.sdpMLineIndex ?? undefined,
          })
        ).catch(() => {});
      });
    }
  );

  return () => {
    unsubDoc();
    unsubCandidates();
  };
}

export async function fetchConversationCallHistory(conversationId: string): Promise<CallRecord[]> {
  try {
    const { items } = await getDocsWithIndexFallback<CallRecord>(
      query(
        collection(db, 'calls'),
        where('conversationId', '==', conversationId),
        orderBy('createdAt', 'desc'),
        limit(15)
      ),
      query(collection(db, 'calls'), where('conversationId', '==', conversationId), limit(30)),
      sortByCreatedAtDesc
    );
    return items.slice(0, 15);
  } catch {
    return [];
  }
}

export async function fetchUserCallHistory(uid: string, limitCount = 40): Promise<CallRecord[]> {
  try {
    const [outRes, inRes] = await Promise.all([
      getDocsWithIndexFallback<CallRecord>(
        query(collection(db, 'calls'), where('callerId', '==', uid), orderBy('createdAt', 'desc'), limit(limitCount)),
        query(collection(db, 'calls'), where('callerId', '==', uid), limit(limitCount)),
        sortByCreatedAtDesc
      ),
      getDocsWithIndexFallback<CallRecord>(
        query(collection(db, 'calls'), where('calleeId', '==', uid), orderBy('createdAt', 'desc'), limit(limitCount)),
        query(collection(db, 'calls'), where('calleeId', '==', uid), limit(limitCount)),
        sortByCreatedAtDesc
      ),
    ]);
    const map = new Map<string, CallRecord>();
    [...outRes.items, ...inRes.items].forEach((rec) => {
      if (!Array.isArray(rec.hiddenBy) || !rec.hiddenBy.includes(uid)) {
        map.set(rec.id, rec);
      }
    });
    return Array.from(map.values()).sort((a, b) => {
      const ta = a.createdAt?.toMillis ? a.createdAt.toMillis() : Number(a.expiresAtMs || 0);
      const tb = b.createdAt?.toMillis ? b.createdAt.toMillis() : Number(b.expiresAtMs || 0);
      return tb - ta;
    });
  } catch {
    return [];
  }
}

export async function hideCallFromHistory(callId: string, uid: string): Promise<void> {
  await updateDoc(doc(db, 'calls', callId), {
    hiddenBy: arrayUnion(uid),
  });
}

export async function dispatchMissedCallNotification(params: {
  recipientId: string;
  caller: { uid: string; displayName: string; avatarUrl?: string };
  callType: CallType;
  conversationId: string;
  callId: string;
}) {
  await createSocialNotification({
    recipientId: params.recipientId,
    actor: params.caller,
    type: 'call',
    title: `Missed ${params.callType === 'video' ? 'video' : 'voice'} call`,
    body: `${params.caller.displayName} tried to call you on BANA Messenger.`,
    linkUrl: `/messages/${params.conversationId}`,
    dedupeKey: `missed_call_${params.callId}_${params.recipientId}`,
  });
}

// =========================================================
// Group Calling Room Signaling (Firestore + Optional WebSocket)
// =========================================================
export async function createGroupCallRoom(params: {
  conversationId: string;
  conversationName: string;
  callType: CallType;
  providerId: CallingProviderId;
  host: { uid: string; displayName: string; username?: string; avatarUrl?: string };
  invitedParticipantIds: string[];
  maxParticipants: number;
}): Promise<GroupCallRecord> {
  const roomRef = await addDoc(collection(db, 'groupCalls'), {
    conversationId: params.conversationId,
    conversationName: params.conversationName,
    callType: params.callType,
    providerId: params.providerId,
    hostId: params.host.uid,
    hostName: params.host.displayName,
    invitedParticipantIds: params.invitedParticipantIds.slice(0, 50),
    activeParticipantIds: [params.host.uid],
    maxParticipants: Math.max(2, Math.min(50, params.maxParticipants)),
    status: 'active',
    startedAt: serverTimestamp(),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(db, 'groupCalls', roomRef.id, 'participants', params.host.uid), {
    uid: params.host.uid,
    displayName: params.host.displayName,
    username: params.host.username || '',
    avatarUrl: params.host.avatarUrl || '',
    role: 'host',
    micMuted: false,
    camOff: params.callType === 'audio',
    screenSharing: false,
    speaking: false,
    joinedAtMs: Date.now(),
  });

  return {
    id: roomRef.id,
    conversationId: params.conversationId,
    conversationName: params.conversationName,
    callType: params.callType,
    providerId: params.providerId,
    hostId: params.host.uid,
    hostName: params.host.displayName,
    invitedParticipantIds: params.invitedParticipantIds,
    activeParticipantIds: [params.host.uid],
    maxParticipants: params.maxParticipants,
    status: 'active',
  };
}

export async function joinGroupCallRoomDoc(params: {
  roomId: string;
  user: { uid: string; displayName: string; username?: string; avatarUrl?: string };
  callType: CallType;
}) {
  await updateDoc(doc(db, 'groupCalls', params.roomId), {
    activeParticipantIds: arrayUnion(params.user.uid),
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'groupCalls', params.roomId, 'participants', params.user.uid), {
    uid: params.user.uid,
    displayName: params.user.displayName,
    username: params.user.username || '',
    avatarUrl: params.user.avatarUrl || '',
    role: 'participant',
    micMuted: false,
    camOff: params.callType === 'audio',
    screenSharing: false,
    speaking: false,
    joinedAtMs: Date.now(),
  });
}

export async function leaveGroupCallRoomDoc(roomId: string, uid: string) {
  await updateDoc(doc(db, 'groupCalls', roomId), {
    activeParticipantIds: arrayRemove(uid),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
  await deleteDoc(doc(db, 'groupCalls', roomId, 'participants', uid)).catch(() => {});
}

export async function endGroupCallRoomDoc(roomId: string, endReason = 'host_ended') {
  await updateDoc(doc(db, 'groupCalls', roomId), {
    status: 'ended',
    endReason,
    endedAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
}

export async function updateGroupParticipantState(
  roomId: string,
  targetUid: string,
  patch: Partial<GroupCallParticipant>
) {
  await updateDoc(doc(db, 'groupCalls', roomId, 'participants', targetUid), patch as any).catch(() => {});
}

export async function kickGroupParticipantDoc(roomId: string, targetUid: string) {
  await leaveGroupCallRoomDoc(roomId, targetUid);
}

export async function sendGroupSignalDoc(
  roomId: string,
  signal: Omit<GroupCallSignal, 'id' | 'createdAt'>
) {
  await addDoc(collection(db, 'groupCalls', roomId, 'signals'), {
    ...signal,
    createdAt: serverTimestamp(),
  });
}

export function subscribeIncomingGroupCalls(
  uid: string,
  onRooms: (rooms: GroupCallRecord[]) => void
) {
  const primaryQ = query(
    collection(db, 'groupCalls'),
    where('invitedParticipantIds', 'array-contains', uid),
    where('status', '==', 'active'),
    orderBy('createdAt', 'desc'),
    limit(10)
  );
  const fallbackQ = query(
    collection(db, 'groupCalls'),
    where('invitedParticipantIds', 'array-contains', uid),
    where('status', '==', 'active'),
    limit(15)
  );
  return subscribeWithIndexFallback<GroupCallRecord>({
    primaryQuery: primaryQ,
    fallbackQuery: fallbackQ,
    comparator: sortByCreatedAtDesc,
    onData: onRooms,
    onError: () => onRooms([]),
  });
}

export function subscribeGroupCallRoom(
  roomId: string,
  uid: string,
  handlers: {
    onRoom: (room: GroupCallRecord | null) => void;
    onParticipants: (participants: GroupCallParticipant[]) => void;
    onSignal: (signal: GroupCallSignal) => void;
  }
) {
  const seenSignals = new Set<string>();

  const unsubRoom = onSnapshot(doc(db, 'groupCalls', roomId), (snap) => {
    if (!snap.exists()) {
      handlers.onRoom(null);
      return;
    }
    handlers.onRoom({ id: snap.id, ...(snap.data() as Omit<GroupCallRecord, 'id'>) });
  });

  const unsubParts = onSnapshot(collection(db, 'groupCalls', roomId, 'participants'), (snap) => {
    const list = snap.docs.map((d) => d.data() as GroupCallParticipant);
    handlers.onParticipants(list);
  });

  const unsubSignals = onSnapshot(
    query(
      collection(db, 'groupCalls', roomId, 'signals'),
      where('toUid', '==', uid),
      orderBy('createdAt', 'asc'),
      limit(200)
    ),
    (snap) => {
      snap.docs.forEach((d) => {
        if (seenSignals.has(d.id)) return;
        seenSignals.add(d.id);
        handlers.onSignal({ id: d.id, ...(d.data() as Omit<GroupCallSignal, 'id'>) });
      });
    },
    () => {
      // Fallback query without orderBy if index still deploying
    }
  );

  return () => {
    unsubRoom();
    unsubParts();
    unsubSignals();
  };
}

