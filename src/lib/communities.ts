import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit,
  increment,
  serverTimestamp,
  arrayUnion,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import type {
  BanaCommunity,
  BanaEvent,
  BanaUser,
  CommunityMemberRecord,
  CommunityPostComment,
  CommunityPostItem,
  CommunityRequest,
  CommunityRole,
  PollOption,
} from '@/src/types/bana';

export function isStaffRole(role?: CommunityRole | string | null, isCreator = false): boolean {
  return isCreator || role === 'owner' || role === 'admin' || role === 'moderator';
}

export function isAdminRole(role?: CommunityRole | string | null, isCreator = false): boolean {
  return isCreator || role === 'owner' || role === 'admin';
}

export async function fetchCommunityMembers(communityId: string): Promise<CommunityMemberRecord[]> {
  const snap = await getDocs(
    query(collection(db, 'communityMembers'), where('communityId', '==', communityId), limit(100))
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityMemberRecord, 'id'>) }));
}

export async function fetchCommunityRequests(communityId: string): Promise<CommunityRequest[]> {
  const snap = await getDocs(
    query(
      collection(db, 'communityRequests'),
      where('communityId', '==', communityId),
      where('status', '==', 'pending'),
      limit(50)
    )
  ).catch(() => null);
  if (!snap) return [];
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityRequest, 'id'>) }));
}

export async function joinOrLeaveCommunity(params: {
  community: BanaCommunity;
  user: BanaUser;
  existingMembership?: CommunityMemberRecord | null;
}): Promise<'joined' | 'requested' | 'left'> {
  const memId = `${params.community.id}_${params.user.uid}`;
  const reqId = `join_${params.community.id}_${params.user.uid}`;

  if (params.existingMembership) {
    if (params.existingMembership.userId === params.community.creatorId) {
      throw new Error('Group Owner cannot leave without transferring ownership or deleting the group.');
    }
    await deleteDoc(doc(db, 'communityMembers', memId));
    if (params.existingMembership.status === 'active') {
      await updateDoc(doc(db, 'communities', params.community.id), {
        membersCount: increment(-1),
      }).catch(() => {});
    }
    // Sync Messenger group chat removal if provisioned
    if (params.community.chatConversationId) {
      const convRef = doc(db, 'conversations', params.community.chatConversationId);
      const convSnap = await getDoc(convRef).catch(() => null);
      if (convSnap?.exists()) {
        const pIds: string[] = Array.isArray(convSnap.data()?.participantIds)
          ? convSnap.data()!.participantIds
          : [];
        if (pIds.includes(params.user.uid) && pIds.length > 1) {
          await updateDoc(convRef, {
            participantIds: pIds.filter((id) => id !== params.user.uid),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
        }
      }
    }
    return 'left';
  }

  const needsApproval = params.community.privacy === 'private' || params.community.requiresApproval;
  if (needsApproval) {
    await setDoc(doc(db, 'communityRequests', reqId), {
      communityId: params.community.id,
      communityName: params.community.name,
      requestType: 'join_request',
      fromUid: params.user.uid,
      fromName: params.user.displayName,
      targetUid: params.user.uid,
      targetName: params.user.displayName,
      targetUsername: params.user.username,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await setDoc(doc(db, 'communityMembers', memId), {
      communityId: params.community.id,
      userId: params.user.uid,
      userName: params.user.displayName,
      userUsername: params.user.username,
      userAvatar: params.user.avatarUrl || '',
      role: 'member',
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await addDoc(collection(db, 'notifications'), {
      recipientId: params.community.creatorId,
      actorId: params.user.uid,
      actorName: params.user.displayName,
      actorAvatar: params.user.avatarUrl || '',
      type: 'community',
      title: 'Community Join Request',
      body: `${params.user.displayName} requested to join ${params.community.name}.`,
      linkUrl: `/communities/${params.community.id}`,
      dedupeKey: `com_join_req_${params.community.id}_${params.user.uid}`,
      isRead: false,
      createdAt: serverTimestamp(),
    }).catch(() => {});
    return 'requested';
  }

  await setDoc(doc(db, 'communityMembers', memId), {
    communityId: params.community.id,
    userId: params.user.uid,
    userName: params.user.displayName,
    userUsername: params.user.username,
    userAvatar: params.user.avatarUrl || '',
    role: 'member',
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  await updateDoc(doc(db, 'communities', params.community.id), {
    membersCount: increment(1),
  }).catch(() => {});
  return 'joined';
}

export async function inviteUserToCommunity(params: {
  community: BanaCommunity;
  inviter: BanaUser;
  targetUser: BanaUser;
}): Promise<void> {
  if (params.targetUser.uid === params.inviter.uid) return;
  const reqId = `inv_${params.community.id}_${params.targetUser.uid}`;
  await setDoc(doc(db, 'communityRequests', reqId), {
    communityId: params.community.id,
    communityName: params.community.name,
    requestType: 'invite',
    fromUid: params.inviter.uid,
    fromName: params.inviter.displayName,
    targetUid: params.targetUser.uid,
    targetName: params.targetUser.displayName,
    targetUsername: params.targetUser.username,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await addDoc(collection(db, 'notifications'), {
    recipientId: params.targetUser.uid,
    actorId: params.inviter.uid,
    actorName: params.inviter.displayName,
    actorAvatar: params.inviter.avatarUrl || '',
    type: 'community',
    title: 'Community Invitation',
    body: `${params.inviter.displayName} invited you to join ${params.community.name}.`,
    linkUrl: `/communities/${params.community.id}`,
    dedupeKey: `com_inv_${params.community.id}_${params.targetUser.uid}`,
    isRead: false,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function respondToJoinRequest(params: {
  community: BanaCommunity;
  memberUid: string;
  memberName?: string;
  memberUsername?: string;
  memberAvatar?: string;
  approve: boolean;
  actorUid: string;
}): Promise<void> {
  const memId = `${params.community.id}_${params.memberUid}`;
  const reqId = `join_${params.community.id}_${params.memberUid}`;

  if (params.approve) {
    await setDoc(
      doc(db, 'communityMembers', memId),
      {
        communityId: params.community.id,
        userId: params.memberUid,
        userName: params.memberName || 'Member',
        userUsername: params.memberUsername || 'member',
        userAvatar: params.memberAvatar || '',
        role: 'member',
        status: 'active',
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );
    await updateDoc(doc(db, 'communities', params.community.id), {
      membersCount: increment(1),
    }).catch(() => {});
    await updateDoc(doc(db, 'communityRequests', reqId), {
      status: 'approved',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
    await addDoc(collection(db, 'notifications'), {
      recipientId: params.memberUid,
      actorId: params.actorUid,
      actorName: params.community.name,
      actorAvatar: params.community.coverUrl || '',
      type: 'community',
      title: 'Membership Approved',
      body: `Your request to join ${params.community.name} was approved.`,
      linkUrl: `/communities/${params.community.id}`,
      dedupeKey: `com_acc_${params.community.id}_${params.memberUid}`,
      isRead: false,
      createdAt: serverTimestamp(),
    }).catch(() => {});
  } else {
    await deleteDoc(doc(db, 'communityMembers', memId)).catch(() => {});
    await updateDoc(doc(db, 'communityRequests', reqId), {
      status: 'declined',
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }
}

export async function updateCommunityMemberRoleOrStatus(params: {
  communityId: string;
  member: CommunityMemberRecord;
  role?: CommunityRole;
  status?: 'active' | 'restricted';
}) {
  const memRef = doc(db, 'communityMembers', params.member.id);
  await updateDoc(memRef, {
    ...(params.role ? { role: params.role } : {}),
    ...(params.status ? { status: params.status } : {}),
    updatedAt: serverTimestamp(),
  });
}

export async function removeCommunityMember(communityId: string, member: CommunityMemberRecord) {
  await deleteDoc(doc(db, 'communityMembers', member.id));
  if (member.status === 'active') {
    await updateDoc(doc(db, 'communities', communityId), {
      membersCount: increment(-1),
    }).catch(() => {});
  }
}

// =========================================================================
// Community Posts, Polls, Reactions & Nested Comments
// =========================================================================
export async function fetchCommunityPosts(communityId: string): Promise<CommunityPostItem[]> {
  const snap = await getDocs(
    query(collection(db, 'communities', communityId, 'posts'), orderBy('createdAt', 'desc'), limit(40))
  );
  return snap.docs
    .map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityPostItem, 'id'>) }))
    .filter((p) => p.status !== 'removed');
}

export async function createCommunityPost(params: {
  communityId: string;
  author: BanaUser;
  authorRole: CommunityRole;
  kind: 'post' | 'announcement' | 'poll';
  content: string;
  mediaUrls?: string[];
  mediaType?: 'image' | 'video' | 'none';
  pollQuestion?: string;
  pollOptions?: string[];
}): Promise<CommunityPostItem> {
  const formattedOptions: PollOption[] = (params.pollOptions || [])
    .map((label, idx) => ({ id: `opt_${idx}_${Date.now()}`, label: label.trim(), votes: 0 }))
    .filter((o) => o.label.length > 0);

  const docRef = await addDoc(collection(db, 'communities', params.communityId, 'posts'), {
    communityId: params.communityId,
    authorId: params.author.uid,
    authorName: params.author.displayName,
    authorUsername: params.author.username,
    authorAvatar: params.author.avatarUrl || '',
    authorVerified: Boolean(params.author.isVerified),
    authorRole: params.authorRole,
    kind: params.kind,
    content: params.content.trim(),
    mediaUrls: params.mediaUrls || [],
    mediaType: params.mediaType || 'none',
    pollQuestion: params.kind === 'poll' ? (params.pollQuestion || '').trim() : '',
    pollOptions: params.kind === 'poll' ? formattedOptions : [],
    pollVoters: {},
    isPinned: false,
    likesUserIds: [],
    likesCount: 0,
    commentsCount: 0,
    status: 'active',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  if (params.kind === 'announcement') {
    await updateDoc(doc(db, 'communities', params.communityId), {
      announcement: params.content.trim().slice(0, 480),
      updatedAt: serverTimestamp(),
    }).catch(() => {});
  }

  if (params.kind === 'announcement') {
    // Notify active members once each (dedupeKey per post+member), capped to keep client writes bounded.
    try {
      const members = await fetchCommunityMembers(params.communityId);
      const targets = members
        .filter((m) => m.userId !== params.author.uid && m.status === 'active')
        .slice(0, 100);
      await Promise.all(
        targets.map((m) =>
          addDoc(collection(db, 'notifications'), {
            recipientId: m.userId,
            actorId: params.author.uid,
            actorName: params.author.displayName,
            actorAvatar: params.author.avatarUrl || '',
            type: 'community',
            title: 'New group announcement',
            body: params.content.trim().slice(0, 120),
            linkUrl: `/communities?group=${params.communityId}`,
            dedupeKey: `com_ann_${docRef.id}_${m.userId}`,
            isRead: false,
            createdAt: serverTimestamp(),
          }).catch(() => {})
        )
      );
    } catch {
      /* notification fan-out is best-effort; the announcement itself is already published */
    }
  }

  const snap = await getDoc(docRef);
  return { id: snap.id, ...(snap.data() as Omit<CommunityPostItem, 'id'>) };
}

export async function toggleCommunityPostLike(communityId: string, post: CommunityPostItem, uid: string) {
  const existing = post.likesUserIds || [];
  const liked = existing.includes(uid);
  const nextIds = liked ? existing.filter((x) => x !== uid) : [...existing, uid];
  await updateDoc(doc(db, 'communities', communityId, 'posts', post.id), {
    likesUserIds: nextIds,
    likesCount: nextIds.length,
    updatedAt: serverTimestamp(),
  });
}

export async function voteCommunityPoll(
  communityId: string,
  post: CommunityPostItem,
  optionId: string,
  uid: string
) {
  if (post.pollVoters?.[uid]) return;
  const nextOptions = (post.pollOptions || []).map((o) =>
    o.id === optionId ? { ...o, votes: (o.votes || 0) + 1 } : o
  );
  const nextVoters = { ...(post.pollVoters || {}), [uid]: optionId };
  await updateDoc(doc(db, 'communities', communityId, 'posts', post.id), {
    pollOptions: nextOptions,
    pollVoters: nextVoters,
    updatedAt: serverTimestamp(),
  });
}

export async function fetchCommunityPostComments(
  communityId: string,
  postId: string
): Promise<CommunityPostComment[]> {
  const snap = await getDocs(
    query(
      collection(db, 'communities', communityId, 'posts', postId, 'comments'),
      orderBy('createdAt', 'asc'),
      limit(60)
    )
  );
  return snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CommunityPostComment, 'id'>) }));
}

export async function addCommunityPostComment(params: {
  communityId: string;
  postId: string;
  author: BanaUser;
  content: string;
  parentCommentId?: string;
  replyToUsername?: string;
}): Promise<CommunityPostComment> {
  const ref = await addDoc(
    collection(db, 'communities', params.communityId, 'posts', params.postId, 'comments'),
    {
      communityId: params.communityId,
      postId: params.postId,
      authorId: params.author.uid,
      authorName: params.author.displayName,
      authorUsername: params.author.username,
      authorAvatar: params.author.avatarUrl || '',
      content: params.content.trim().slice(0, 1500),
      ...(params.parentCommentId ? { parentCommentId: params.parentCommentId } : {}),
      ...(params.replyToUsername ? { replyToUsername: params.replyToUsername } : {}),
      createdAt: serverTimestamp(),
    }
  );
  await updateDoc(doc(db, 'communities', params.communityId, 'posts', params.postId), {
    commentsCount: increment(1),
    updatedAt: serverTimestamp(),
  }).catch(() => {});
  const snap = await getDoc(ref);
  return { id: snap.id, ...(snap.data() as Omit<CommunityPostComment, 'id'>) };
}

// =========================================================================
// Community Chat Integration (Reuses Messenger `conversations` + `messages`)
// =========================================================================
export async function ensureCommunityChatConversation(params: {
  community: BanaCommunity;
  currentUser: BanaUser;
  activeMembers: CommunityMemberRecord[];
}): Promise<string> {
  if (params.community.chatConversationId) {
    const convRef = doc(db, 'conversations', params.community.chatConversationId);
    const snap = await getDoc(convRef).catch(() => null);
    if (snap?.exists()) {
      const pIds: string[] = Array.isArray(snap.data()?.participantIds) ? snap.data()!.participantIds : [];
      if (!pIds.includes(params.currentUser.uid)) {
        // Admin adds member or member joins via group sync if admin is running it
        await updateDoc(convRef, {
          participantIds: arrayUnion(params.currentUser.uid),
          [`participantMeta.${params.currentUser.uid}`]: {
            displayName: params.currentUser.displayName,
            username: params.currentUser.username,
            avatarUrl: params.currentUser.avatarUrl || '',
          },
          updatedAt: serverTimestamp(),
        }).catch(() => {});
      }
      return snap.id;
    }
  }

  // Create a real BANA Messenger group conversation linked to this community
  const participantSet = new Set<string>([params.currentUser.uid, params.community.creatorId]);
  params.activeMembers
    .filter((m) => m.status === 'active')
    .slice(0, 48)
    .forEach((m) => participantSet.add(m.userId));

  const participantIds = Array.from(participantSet);
  if (participantIds.length < 2) {
    // Messenger rules require >= 2 participants in group conversations; wait until another member joins
    throw new Error('At least one additional community member is needed to start the Group Chat room.');
  }

  const adminIds = Array.from(
    new Set([
      params.community.creatorId,
      ...params.activeMembers
        .filter((m) => m.status === 'active' && (m.role === 'owner' || m.role === 'admin' || m.role === 'moderator'))
        .map((m) => m.userId),
    ])
  );

  const participantMeta: Record<string, { displayName: string; username: string; avatarUrl?: string }> = {
    [params.currentUser.uid]: {
      displayName: params.currentUser.displayName,
      username: params.currentUser.username,
      avatarUrl: params.currentUser.avatarUrl || '',
    },
  };
  params.activeMembers.forEach((m) => {
    if (!participantMeta[m.userId]) {
      participantMeta[m.userId] = {
        displayName: m.userName || 'Member',
        username: m.userUsername || 'member',
        avatarUrl: m.userAvatar || '',
      };
    }
  });

  const convRef = await addDoc(collection(db, 'conversations'), {
    participantIds,
    adminIds,
    participantMeta,
    isGroup: true,
    communityId: params.community.id,
    groupName: `${params.community.name} Chat`,
    groupDescription: `Official community chat for ${params.community.name}`,
    groupAvatar: params.community.avatarUrl || params.community.coverUrl || '',
    lastMessageText: `Welcome to ${params.community.name} community chat`,
    lastMessageSenderId: params.currentUser.uid,
    isRequest: false,
    unreadCounts: {},
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await updateDoc(doc(db, 'communities', params.community.id), {
    chatConversationId: convRef.id,
    updatedAt: serverTimestamp(),
  }).catch(() => {});

  return convRef.id;
}

// =========================================================================
// Community Events RSVP (Going / Interested)
// =========================================================================
export async function setEventRsvpStatus(params: {
  event: BanaEvent;
  uid: string;
  currentStatus?: 'going' | 'interested' | null;
  nextStatus: 'going' | 'interested';
}): Promise<'going' | 'interested' | null> {
  const regId = `${params.event.id}_${params.uid}`;
  const isToggleOff = params.currentStatus === params.nextStatus;

  if (isToggleOff) {
    await deleteDoc(doc(db, 'eventRegistrations', regId)).catch(() => {});
    await updateDoc(doc(db, 'events', params.event.id), {
      ...(params.nextStatus === 'going' ? { attendeesCount: increment(-1) } : { interestedCount: increment(-1) }),
    }).catch(() => {});
    return null;
  }

  if (params.nextStatus === 'going' && params.event.capacity > 0 && params.event.attendeesCount >= params.event.capacity) {
    throw new Error('This event has reached full capacity.');
  }

  await setDoc(doc(db, 'eventRegistrations', regId), {
    eventId: params.event.id,
    userId: params.uid,
    rsvpStatus: params.nextStatus,
    createdAt: serverTimestamp(),
  });

  const updates: Record<string, any> = {};
  if (params.nextStatus === 'going') {
    updates.attendeesCount = increment(1);
    if (params.currentStatus === 'interested') updates.interestedCount = increment(-1);
  } else {
    updates.interestedCount = increment(1);
    if (params.currentStatus === 'going') updates.attendeesCount = increment(-1);
  }
  await updateDoc(doc(db, 'events', params.event.id), updates).catch(() => {});
  return params.nextStatus;
}
