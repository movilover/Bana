import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  where,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import type {
  BanaUser,
  BanaNotification,
  FollowRequestRecord,
  FriendRequestRecord,
  FriendshipRecord,
} from '@/src/types/bana';

export type FriendStatus = 'none' | 'sent_pending' | 'received_pending' | 'friends';
export type FollowRequestStatus = 'none' | 'sent_pending' | 'received_pending';

export interface SocialRelationship {
  isFollowing: boolean;
  followsMe: boolean;
  followRequestStatus: FollowRequestStatus;
  friendStatus: FriendStatus;
  isBlockedByMe: boolean;
  amIBlocked: boolean;
  isRestrictedByMe: boolean;
  amIRestricted: boolean;
}

export interface SuggestedUserItem {
  user: BanaUser;
  score: number;
  mutualFriendsCount: number;
  sharedInterests: string[];
  reason: string;
}

export function getFriendshipPairId(uidA: string, uidB: string): string {
  return [uidA, uidB].sort().join('_');
}

export async function createSocialNotification(params: {
  recipientId: string;
  actor: { uid: string; displayName: string; avatarUrl?: string; username?: string };
  type: BanaNotification['type'];
  title: string;
  body: string;
  linkUrl: string;
  dedupeKey: string;
}): Promise<void> {
  if (!params.recipientId || params.recipientId === params.actor.uid) return;
  await addDoc(collection(db, 'notifications'), {
    recipientId: params.recipientId,
    actorId: params.actor.uid,
    actorName: params.actor.displayName || 'Someone',
    actorAvatar: params.actor.avatarUrl || '',
    type: params.type,
    title: params.title,
    body: params.body,
    linkUrl: params.linkUrl,
    dedupeKey: params.dedupeKey,
    isRead: false,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function checkPairBlocked(uidA: string, uidB: string): Promise<{ blockedByMe: boolean; amIBlocked: boolean }> {
  if (!uidA || !uidB || uidA === uidB) return { blockedByMe: false, amIBlocked: false };
  const [byMe, byOther] = await Promise.all([
    getDoc(doc(db, 'userBlocks', `${uidA}_${uidB}`)).catch(() => null),
    getDoc(doc(db, 'userBlocks', `${uidB}_${uidA}`)).catch(() => null),
  ]);
  return {
    blockedByMe: Boolean(byMe?.exists()),
    amIBlocked: Boolean(byOther?.exists()),
  };
}

export async function getSocialRelationship(myUid: string, targetUid: string): Promise<SocialRelationship> {
  if (!myUid || !targetUid || myUid === targetUid) {
    return {
      isFollowing: false,
      followsMe: false,
      followRequestStatus: 'none',
      friendStatus: 'none',
      isBlockedByMe: false,
      amIBlocked: false,
      isRestrictedByMe: false,
      amIRestricted: false,
    };
  }

  const pairId = getFriendshipPairId(myUid, targetUid);
  const [
    followingSnap,
    followsMeSnap,
    sentFollowReqSnap,
    recFollowReqSnap,
    sentFriendReqSnap,
    recFriendReqSnap,
    friendshipSnap,
    blockByMeSnap,
    blockByOtherSnap,
    restrictByMeSnap,
    restrictByOtherSnap,
  ] = await Promise.all([
    getDoc(doc(db, 'userFollows', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'userFollows', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'followRequests', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'followRequests', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'friendRequests', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'friendRequests', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'friendships', pairId)).catch(() => null),
    getDoc(doc(db, 'userBlocks', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'userBlocks', `${targetUid}_${myUid}`)).catch(() => null),
    getDoc(doc(db, 'userRestrictions', `${myUid}_${targetUid}`)).catch(() => null),
    getDoc(doc(db, 'userRestrictions', `${targetUid}_${myUid}`)).catch(() => null),
  ]);

  let followRequestStatus: FollowRequestStatus = 'none';
  if (!followingSnap?.exists()) {
    if (sentFollowReqSnap?.exists() && sentFollowReqSnap.data()?.status === 'pending') {
      followRequestStatus = 'sent_pending';
    } else if (recFollowReqSnap?.exists() && recFollowReqSnap.data()?.status === 'pending') {
      followRequestStatus = 'received_pending';
    }
  }

  let friendStatus: FriendStatus = 'none';
  if (friendshipSnap?.exists()) {
    friendStatus = 'friends';
  } else if (
    (sentFriendReqSnap?.exists() && sentFriendReqSnap.data()?.status === 'accepted') ||
    (recFriendReqSnap?.exists() && recFriendReqSnap.data()?.status === 'accepted')
  ) {
    friendStatus = 'friends';
  } else if (sentFriendReqSnap?.exists() && sentFriendReqSnap.data()?.status === 'pending') {
    friendStatus = 'sent_pending';
  } else if (recFriendReqSnap?.exists() && recFriendReqSnap.data()?.status === 'pending') {
    friendStatus = 'received_pending';
  }

  return {
    isFollowing: Boolean(followingSnap?.exists()),
    followsMe: Boolean(followsMeSnap?.exists()),
    followRequestStatus,
    friendStatus,
    isBlockedByMe: Boolean(blockByMeSnap?.exists()),
    amIBlocked: Boolean(blockByOtherSnap?.exists()),
    isRestrictedByMe: Boolean(restrictByMeSnap?.exists()),
    amIRestricted: Boolean(restrictByOtherSnap?.exists()),
  };
}

export async function followOrRequestUser(
  me: BanaUser,
  targetUser: BanaUser
): Promise<'following' | 'requested'> {
  if (me.uid === targetUser.uid) throw new Error('You cannot follow your own account.');
  const { blockedByMe, amIBlocked } = await checkPairBlocked(me.uid, targetUser.uid);
  if (blockedByMe || amIBlocked) {
    throw new Error('Cannot follow this account due to block settings.');
  }

  const requiresApproval = Boolean(targetUser.isPrivateAccount || targetUser.whoCanFollow === 'approval');
  if (requiresApproval) {
    const reqId = `${me.uid}_${targetUser.uid}`;
    const existingReq = await getDoc(doc(db, 'followRequests', reqId)).catch(() => null);
    if (existingReq?.exists()) {
      if (existingReq.data()?.status === 'pending') return 'requested';
      await deleteDoc(doc(db, 'followRequests', reqId));
    }
    await setDoc(doc(db, 'followRequests', reqId), {
      fromUid: me.uid,
      toUid: targetUser.uid,
      status: 'pending',
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    await createSocialNotification({
      recipientId: targetUser.uid,
      actor: me,
      type: 'follow_request',
      title: 'Follow Request',
      body: `${me.displayName} requested to follow you.`,
      linkUrl: `/profile/${me.username || me.uid}`,
      dedupeKey: `follow_req_${me.uid}_${targetUser.uid}`,
    });
    return 'requested';
  }

  const followId = `${me.uid}_${targetUser.uid}`;
  const alreadyFollowing = await getDoc(doc(db, 'userFollows', followId)).catch(() => null);
  if (alreadyFollowing?.exists()) return 'following';
  await setDoc(doc(db, 'userFollows', followId), {
    followerId: me.uid,
    followingId: targetUser.uid,
    createdAt: serverTimestamp(),
  });
  await createSocialNotification({
    recipientId: targetUser.uid,
    actor: me,
    type: 'follow',
    title: 'New Follower',
    body: `${me.displayName} started following you on BANA.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `follow_${me.uid}_${targetUser.uid}`,
  });
  return 'following';
}

export async function cancelFollowRequest(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'followRequests', `${myUid}_${targetUid}`));
}

export async function unfollowUser(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'userFollows', `${myUid}_${targetUid}`));
}

export async function removeFollower(myUid: string, followerUid: string): Promise<void> {
  await deleteDoc(doc(db, 'userFollows', `${followerUid}_${myUid}`));
}

export async function acceptFollowRequest(me: BanaUser, requesterUid: string): Promise<void> {
  const reqRef = doc(db, 'followRequests', `${requesterUid}_${me.uid}`);
  await updateDoc(reqRef, {
    status: 'accepted',
    updatedAt: serverTimestamp(),
  });
  await setDoc(doc(db, 'userFollows', `${requesterUid}_${me.uid}`), {
    followerId: requesterUid,
    followingId: me.uid,
    createdAt: serverTimestamp(),
  });
  await createSocialNotification({
    recipientId: requesterUid,
    actor: me,
    type: 'follow_accepted',
    title: 'Follow Request Accepted',
    body: `${me.displayName} accepted your follow request.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `follow_acc_${me.uid}_${requesterUid}`,
  });
}

export async function declineFollowRequest(myUid: string, requesterUid: string): Promise<void> {
  await updateDoc(doc(db, 'followRequests', `${requesterUid}_${myUid}`), {
    status: 'declined',
    updatedAt: serverTimestamp(),
  });
}

export async function canSendFriendRequestToUser(myUid: string, targetUser: BanaUser): Promise<{ allowed: boolean; reason?: string }> {
  if (myUid === targetUser.uid) return { allowed: false, reason: 'Cannot send a friend request to yourself.' };
  const { blockedByMe, amIBlocked } = await checkPairBlocked(myUid, targetUser.uid);
  if (blockedByMe || amIBlocked) return { allowed: false, reason: 'Cannot connect due to block settings.' };

  const policy = targetUser.whoCanFriendRequest || 'everyone';
  if (policy === 'nobody') {
    return { allowed: false, reason: 'This user is not accepting friend requests.' };
  }
  if (policy === 'followers') {
    const fSnap = await getDoc(doc(db, 'userFollows', `${targetUser.uid}_${myUid}`)).catch(() => null);
    if (!fSnap?.exists()) {
      return { allowed: false, reason: 'Only accounts this user follows can send friend requests.' };
    }
  }
  if (policy === 'friends_of_friends') {
    const mutual = await getMutualFriendIds(myUid, targetUser.uid);
    if (mutual.length === 0) {
      return { allowed: false, reason: 'Only friends of friends can send friend requests to this user.' };
    }
  }
  return { allowed: true };
}

export async function sendFriendRequest(me: BanaUser, targetUser: BanaUser): Promise<void> {
  const check = await canSendFriendRequestToUser(me.uid, targetUser);
  if (!check.allowed) throw new Error(check.reason || 'Friend request not permitted.');

  // Check if reverse pending request already exists; if so, auto-accept
  const reverseRef = doc(db, 'friendRequests', `${targetUser.uid}_${me.uid}`);
  const reverseSnap = await getDoc(reverseRef).catch(() => null);
  if (reverseSnap?.exists() && reverseSnap.data()?.status === 'pending') {
    await acceptFriendRequest(me, targetUser.uid);
    return;
  }

  // Idempotent + re-send support: a pending request is never duplicated, and a previously
  // declined/stale request is removed first (only the recipient can update a request).
  const ownRef = doc(db, 'friendRequests', `${me.uid}_${targetUser.uid}`);
  const ownSnap = await getDoc(ownRef).catch(() => null);
  if (ownSnap?.exists()) {
    if (ownSnap.data()?.status === 'pending') return;
    await deleteDoc(ownRef);
  }

  await setDoc(ownRef, {
    fromUid: me.uid,
    toUid: targetUser.uid,
    status: 'pending',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  await createSocialNotification({
    recipientId: targetUser.uid,
    actor: me,
    type: 'friend_request',
    title: 'New Friend Request',
    body: `${me.displayName} sent you a friend request.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `friend_req_${me.uid}_${targetUser.uid}`,
  });
}

export async function cancelFriendRequest(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'friendRequests', `${myUid}_${targetUid}`));
}

export async function acceptFriendRequest(me: BanaUser, requesterUid: string): Promise<void> {
  const pairId = getFriendshipPairId(me.uid, requesterUid);
  const reqRef = doc(db, 'friendRequests', `${requesterUid}_${me.uid}`);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) throw new Error('This friend request is no longer available.');
  if (reqSnap.data()?.status !== 'pending' && reqSnap.data()?.status !== 'accepted') {
    throw new Error('This friend request is no longer pending.');
  }

  await updateDoc(reqRef, {
    status: 'accepted',
    updatedAt: serverTimestamp(),
  });

  await setDoc(doc(db, 'friendships', pairId), {
    participants: [me.uid, requesterUid].sort(),
    createdAt: serverTimestamp(),
  });

  await createSocialNotification({
    recipientId: requesterUid,
    actor: me,
    type: 'friend_accepted',
    title: 'Friend Request Accepted',
    body: `${me.displayName} accepted your friend request.`,
    linkUrl: `/profile/${me.username || me.uid}`,
    dedupeKey: `friend_acc_${me.uid}_${requesterUid}`,
  });
}

export async function declineFriendRequest(myUid: string, requesterUid: string): Promise<void> {
  await updateDoc(doc(db, 'friendRequests', `${requesterUid}_${myUid}`), {
    status: 'declined',
    updatedAt: serverTimestamp(),
  });
}

export async function unfriendUser(myUid: string, targetUid: string): Promise<void> {
  const pairId = getFriendshipPairId(myUid, targetUid);
  await Promise.all([
    deleteDoc(doc(db, 'friendships', pairId)).catch(() => {}),
    deleteDoc(doc(db, 'friendRequests', `${myUid}_${targetUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'friendRequests', `${targetUid}_${myUid}`)).catch(() => {}),
  ]);
}

export async function blockUser(myUid: string, targetUid: string): Promise<void> {
  if (myUid === targetUid) return;
  await Promise.all([
    setDoc(doc(db, 'userBlocks', `${myUid}_${targetUid}`), {
      blockerId: myUid,
      blockedUid: targetUid,
      createdAt: serverTimestamp(),
    }),
    deleteDoc(doc(db, 'userFollows', `${myUid}_${targetUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'userFollows', `${targetUid}_${myUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'followRequests', `${myUid}_${targetUid}`)).catch(() => {}),
    deleteDoc(doc(db, 'followRequests', `${targetUid}_${myUid}`)).catch(() => {}),
    unfriendUser(myUid, targetUid).catch(() => {}),
  ]);
}

export async function unblockUser(myUid: string, targetUid: string): Promise<void> {
  await deleteDoc(doc(db, 'userBlocks', `${myUid}_${targetUid}`));
}

export async function toggleRestrictUser(myUid: string, targetUid: string, currentlyRestricted: boolean): Promise<boolean> {
  const ref = doc(db, 'userRestrictions', `${myUid}_${targetUid}`);
  if (currentlyRestricted) {
    await deleteDoc(ref);
    return false;
  }
  await setDoc(ref, {
    restrictorId: myUid,
    restrictedUid: targetUid,
    createdAt: serverTimestamp(),
  });
  return true;
}

export async function getUserFriendIds(uid: string): Promise<string[]> {
  if (!uid) return [];
  const [friendSnap, recAccepted, sentAccepted] = await Promise.all([
    getDocs(query(collection(db, 'friendships'), where('participants', 'array-contains', uid), limit(200))).catch(() => null),
    getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'accepted'), limit(200))).catch(() => null),
    getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'accepted'), limit(200))).catch(() => null),
  ]);

  const ids = new Set<string>();
  friendSnap?.docs.forEach((d) => {
    const participants: string[] = Array.isArray(d.data().participants) ? d.data().participants : [];
    participants.forEach((p) => {
      if (p !== uid) ids.add(p);
    });
  });
  recAccepted?.docs.forEach((d) => {
    const f = d.data().fromUid;
    if (f && f !== uid) ids.add(f);
  });
  sentAccepted?.docs.forEach((d) => {
    const t = d.data().toUid;
    if (t && t !== uid) ids.add(t);
  });
  return Array.from(ids);
}

export async function getMutualFriendIds(uidA: string, uidB: string): Promise<string[]> {
  if (!uidA || !uidB || uidA === uidB) return [];
  const [friendsA, friendsB] = await Promise.all([getUserFriendIds(uidA), getUserFriendIds(uidB)]);
  const setB = new Set(friendsB);
  return friendsA.filter((id) => setB.has(id));
}

export async function fetchUsersByIds(uids: string[]): Promise<BanaUser[]> {
  if (uids.length === 0) return [];
  const unique = Array.from(new Set(uids)).slice(0, 60);
  const snaps = await Promise.all(unique.map((id) => getDoc(doc(db, 'users', id)).catch(() => null)));
  return snaps
    .filter((s): s is NonNullable<typeof s> => Boolean(s?.exists()))
    .map((s) => s.data() as BanaUser)
    .filter((u) => u.accountStatus !== 'banned');
}

export async function recordDailyProfileView(profileUid: string, viewerUid: string): Promise<void> {
  if (!profileUid || !viewerUid || profileUid === viewerUid) return;
  const now = new Date();
  const dayKey = now.toISOString().slice(0, 10);
  const docId = `${profileUid}_${viewerUid}_${dayKey.replace(/-/g, '')}`;
  const ref = doc(db, 'profileViews', docId);
  const snap = await getDoc(ref).catch(() => null);
  if (snap && snap.exists()) return;
  await setDoc(ref, {
    profileUid,
    viewerUid,
    dayKey,
    createdAt: serverTimestamp(),
  }).catch(() => {});
}

export async function fetchPendingSocialRequests(myUid: string): Promise<{
  incomingFriends: Array<{ req: FriendRequestRecord; user: BanaUser }>;
  sentFriends: Array<{ req: FriendRequestRecord; user: BanaUser }>;
  incomingFollows: Array<{ req: FollowRequestRecord; user: BanaUser }>;
}> {
  const [incFriendSnap, sentFriendSnap, incFollowSnap] = await Promise.all([
    getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', myUid), where('status', '==', 'pending'), limit(50))).catch(() => null),
    getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', myUid), where('status', '==', 'pending'), limit(50))).catch(() => null),
    getDocs(query(collection(db, 'followRequests'), where('toUid', '==', myUid), where('status', '==', 'pending'), limit(50))).catch(() => null),
  ]);

  const incFriends = incFriendSnap?.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequestRecord, 'id'>) })) || [];
  const sentFriends = sentFriendSnap?.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FriendRequestRecord, 'id'>) })) || [];
  const incFollows = incFollowSnap?.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FollowRequestRecord, 'id'>) })) || [];

  const allUids = [
    ...incFriends.map((r) => r.fromUid),
    ...sentFriends.map((r) => r.toUid),
    ...incFollows.map((r) => r.fromUid),
  ];
  const users = await fetchUsersByIds(allUids);
  const userMap = new Map(users.map((u) => [u.uid, u]));

  return {
    incomingFriends: incFriends.flatMap((req) => (userMap.has(req.fromUid) ? [{ req, user: userMap.get(req.fromUid)! }] : [])),
    sentFriends: sentFriends.flatMap((req) => (userMap.has(req.toUid) ? [{ req, user: userMap.get(req.toUid)! }] : [])),
    incomingFollows: incFollows.flatMap((req) => (userMap.has(req.fromUid) ? [{ req, user: userMap.get(req.fromUid)! }] : [])),
  };
}

export async function fetchSuggestedUsers(opts: {
  myProfile: BanaUser | null;
  blockedUids?: string[];
  dismissedUids?: string[];
  limitCount?: number;
}): Promise<SuggestedUserItem[]> {
  const { myProfile, blockedUids = [], dismissedUids = [], limitCount = 8 } = opts;
  const myUid = myProfile?.uid || '';

  const [candidatesSnap, myFollowsSnap, myFriendIds, myCommSnap] = await Promise.all([
    getDocs(query(collection(db, 'users'), where('accountStatus', '==', 'active'), limit(60))).catch(() => null),
    myUid
      ? getDocs(query(collection(db, 'userFollows'), where('followerId', '==', myUid), limit(200))).catch(() => null)
      : Promise.resolve(null),
    myUid ? getUserFriendIds(myUid) : Promise.resolve([]),
    myUid
      ? getDocs(query(collection(db, 'communityMembers'), where('userId', '==', myUid), limit(25))).catch(() => null)
      : Promise.resolve(null),
  ]);

  const followingSet = new Set(myFollowsSnap?.docs.map((d) => d.data().followingId) || []);
  const friendSet = new Set(myFriendIds);
  const excludedSet = new Set<string>([...blockedUids, ...dismissedUids]);
  if (myUid) excludedSet.add(myUid);

  const myInterests = new Set(myProfile?.interests || []);
  const myCommunities = new Set(myCommSnap?.docs.map((d) => d.data().communityId) || []);

  // Look up friends-of-friends if signed in (sample up to 6 friends)
  const friendOfFriendCounts = new Map<string, number>();
  if (myUid && myFriendIds.length > 0) {
    const sampleFriends = myFriendIds.slice(0, 6);
    const fofLists = await Promise.all(sampleFriends.map((fid) => getUserFriendIds(fid)));
    fofLists.forEach((list) => {
      list.forEach((candidateUid) => {
        if (candidateUid !== myUid && !friendSet.has(candidateUid)) {
          friendOfFriendCounts.set(candidateUid, (friendOfFriendCounts.get(candidateUid) || 0) + 1);
        }
      });
    });
  }

  // Shared community peers (sample up to 3 communities)
  const sharedCommunityUids = new Set<string>();
  if (myUid && myCommunities.size > 0) {
    const sampleComms = Array.from(myCommunities).slice(0, 3);
    const memberSnaps = await Promise.all(
      sampleComms.map((cid) =>
        getDocs(query(collection(db, 'communityMembers'), where('communityId', '==', cid), limit(15))).catch(() => null)
      )
    );
    memberSnaps.forEach((snap) => {
      snap?.docs.forEach((d) => {
        const uid = d.data().userId;
        if (uid && uid !== myUid) sharedCommunityUids.add(uid);
      });
    });
  }

  const rawCandidates = (candidatesSnap?.docs.map((d) => d.data() as BanaUser) || []).filter(
    (u) =>
      u.uid &&
      !excludedSet.has(u.uid) &&
      !followingSet.has(u.uid) &&
      !friendSet.has(u.uid) &&
      u.accountStatus === 'active'
  );

  const scored: SuggestedUserItem[] = rawCandidates.map((u) => {
    const mutualCount = friendOfFriendCounts.get(u.uid) || 0;
    const sharedInterests = (u.interests || []).filter((i) => myInterests.has(i));
    const sameLocation =
      myProfile?.location && u.location && u.location.toLowerCase() === myProfile.location.toLowerCase();
    const inSharedCommunity = sharedCommunityUids.has(u.uid);

    let score = 0;
    score += mutualCount * 25;
    score += sharedInterests.length * 12;
    if (inSharedCommunity) score += 15;
    if (sameLocation) score += 8;
    if (u.isVerified) score += 6;
    score += Math.min(10, Math.log10(Math.max(1, u.followersCount || 1)) * 3);

    let reason = 'Active on BANA';
    if (mutualCount > 0) {
      reason = `${mutualCount} mutual friend${mutualCount > 1 ? 's' : ''}`;
    } else if (sharedInterests.length > 0) {
      reason = `Shares ${sharedInterests[0]}`;
    } else if (inSharedCommunity) {
      reason = 'In your community';
    } else if (sameLocation) {
      reason = `Near ${u.location}`;
    } else if (u.isCreator) {
      reason = u.creatorCategory ? `${u.creatorCategory} Creator` : 'Featured Creator';
    }

    return {
      user: u,
      score,
      mutualFriendsCount: mutualCount,
      sharedInterests,
      reason,
    };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limitCount);
}
