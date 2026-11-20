import * as crypto from 'crypto';
import * as admin from 'firebase-admin';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';

admin.initializeApp();
const db = admin.firestore();

const BOOTSTRAPPED_ADMIN_EMAIL = 'omor.faruk.sojol.2@gmail.com';
const MIN_MONETIZATION_FOLLOWERS = 1000;

async function assertAdminRole(uid: string, email: string | undefined, allowedRoles: string[]): Promise<string> {
  if (email && email.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL) {
    // SECURITY: bootstrap Super Admin needs a VERIFIED e-mail and must not be switched off
    // (adminBootstrap/state.disabled === true). Otherwise fall through to the adminRoles check below.
    const [bootstrapState, authUser] = await Promise.all([
      db.collection('adminBootstrap').doc('state').get(),
      admin.auth().getUser(uid),
    ]);
    if (authUser.emailVerified && bootstrapState.data()?.disabled !== true) {
      return 'super_admin';
    }
  }
  const roleSnap = await db.collection('adminRoles').doc(uid).get();
  if (!roleSnap.exists) {
    throw new HttpsError('permission-denied', 'Administrator privileges required.');
  }
  const role = String(roleSnap.data()?.role || '');
  if (!allowedRoles.includes(role) && role !== 'super_admin') {
    throw new HttpsError('permission-denied', `Role ${role} is not authorized for this action.`);
  }
  return role;
}

async function writeAuditLog(params: {
  actorUid: string;
  actorEmail?: string;
  action: string;
  targetType: string;
  targetId: string;
  summary: string;
}) {
  await db.collection('auditLogs').add({
    ...params,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function createDeduplicatedNotification(params: {
  recipientId: string;
  actorId: string;
  actorName: string;
  actorAvatar: string;
  type: string;
  title: string;
  body: string;
  linkUrl: string;
  dedupeKey: string;
}) {
  if (params.recipientId === params.actorId) return;
  const existing = await db
    .collection('notifications')
    .where('recipientId', '==', params.recipientId)
    .where('dedupeKey', '==', params.dedupeKey)
    .limit(1)
    .get();
  if (!existing.empty) return;

  await db.collection('notifications').add({
    ...params,
    isRead: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function assertRateLimit(uid: string, actionKey: string, maxPerMinute: number) {
  const ref = db.collection('rateLimits').doc(`${uid}_${actionKey}`);
  const now = Date.now();
  const windowMs = 60 * 1000;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const data = snap.exists ? snap.data()! : { count: 0, windowStart: now };
    const withinWindow = now - Number(data.windowStart || 0) < windowMs;
    const nextCount = withinWindow ? Number(data.count || 0) + 1 : 1;

    if (nextCount > maxPerMinute) {
      throw new HttpsError('resource-exhausted', 'Too many requests. Please wait a minute before retrying.');
    }

    tx.set(ref, {
      uid,
      actionKey,
      count: nextCount,
      windowStart: withinWindow ? data.windowStart : now,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });
}

// =========================================================================
// 1. Monetization Eligibility Check & Application Submission
// =========================================================================
/** Region gate: an empty list or "Global" means everywhere; otherwise the applicant's country must be listed (case-insensitive, names or ISO codes). */
function isRegionAllowed(country: string, regions: string[]): boolean {
  const list = (regions || []).map((r) => String(r).trim().toLowerCase()).filter(Boolean);
  if (list.length === 0 || list.includes('global')) return true;
  return list.includes(String(country || '').trim().toLowerCase());
}

async function loadMonetizationPolicyServer() {
  const [polSnap, legacySnap] = await Promise.all([
    db.collection('monetizationPolicies').doc('default').get(),
    db.collection('adminSettings').doc('monetization').get(),
  ]);
  const pol = polSnap.exists ? polSnap.data() || {} : {};
  const legacy = legacySnap.exists ? legacySnap.data() || {} : {};
  return {
    monetizationEnabled: pol.monetizationEnabled !== false,
    creatorSharePct: Number(pol.creatorSharePct ?? 55),
    platformSharePct: Number(pol.platformSharePct ?? 45),
    minFollowers: Number(pol.minFollowers ?? MIN_MONETIZATION_FOLLOWERS),
    minPayoutUsd: Number(pol.minPayoutUsd ?? legacy.minWithdrawalUsd ?? 10),
    qualifiedViewMinSeconds: Number(pol.qualifiedViewMinSeconds ?? 5),
    requireEmailVerified: pol.requireEmailVerified !== false,
    requireOriginalContent: pol.requireOriginalContent !== false,
    requireAdultAge: pol.requireAdultAge !== false,
    eligibleRegions: Array.isArray(pol.eligibleRegions) ? pol.eligibleRegions : ['Bangladesh', 'Global'],
    policyVersion: Number(pol.policyVersion || 0),
    adPoolCpmUsd: Number(pol.adPoolCpmUsd ?? legacy.videoRpmUsd ?? 1.25),
  };
}

export const evaluateCreatorEligibility = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const uid = request.auth.uid;
  await assertRateLimit(uid, 'eval_eligibility', 15);

  const [userSnap, settingsSnap, postsSnap, reelsSnap, appSnap, existingEligSnap, policy] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('userSettings').doc(uid).get(),
    db.collection('posts').where('authorId', '==', uid).limit(5).get(),
    db.collection('reels').where('authorId', '==', uid).limit(5).get(),
    db.collection('creatorApplications').where('uid', '==', uid).orderBy('createdAt', 'desc').limit(1).get().catch(() =>
      db.collection('creatorApplications').where('uid', '==', uid).limit(1).get()
    ),
    db.collection('creatorEligibility').doc(uid).get(),
    loadMonetizationPolicyServer(),
  ]);

  if (!userSnap.exists) throw new HttpsError('not-found', 'User profile not found.');
  const user = userSnap.data()!;
  const settings = settingsSnap.data() || {};
  const followersCount = Number(user.followersCount || 0);
  const currentYear = new Date().getFullYear();
  const birthYear = Number(settings.birthYear || 0);
  const isAdult = !user.isMinor && (birthYear > 0 ? currentYear - birthYear >= 18 : false);
  const isEmailVerified = Boolean(
    request.auth.token.email_verified || request.auth.token.firebase?.sign_in_provider === 'google.com'
  );
  const hasOriginalContent = postsSnap.size + reelsSnap.size >= 1;
  const isGoodStanding = user.accountStatus === 'active';
  const regionEligible = policy.eligibleRegions.length > 0;
  const policyCompliant = isGoodStanding && hasOriginalContent;

  const latestApp = appSnap.empty ? null : appSnap.docs[0].data();
  const outstandingRequirements: string[] = [];
  if (followersCount < policy.minFollowers) {
    outstandingRequirements.push(`Reach ${policy.minFollowers.toLocaleString()} followers (current: ${followersCount.toLocaleString()})`);
  }
  if (policy.requireAdultAge && !isAdult) {
    outstandingRequirements.push('Confirm legal adult age (18+) in account settings');
  }
  if (policy.requireEmailVerified && !isEmailVerified) {
    outstandingRequirements.push('Verify your account email address');
  }
  if (policy.requireOriginalContent && !hasOriginalContent) {
    outstandingRequirements.push('Publish at least one original post or Reel');
  }
  if (!isGoodStanding) {
    outstandingRequirements.push('Resolve active account standing restrictions');
  }

  let monetizationStatus = 'not_eligible';
  if (existingEligSnap.exists && existingEligSnap.data()?.monetizationStatus === 'suspended') {
    monetizationStatus = 'suspended';
  } else if (user.isCreator && latestApp?.status === 'approved') {
    monetizationStatus = 'approved';
  } else if (latestApp?.status === 'suspended') {
    monetizationStatus = 'suspended';
  } else if (latestApp?.status === 'pending' || latestApp?.status === 'appealed') {
    monetizationStatus = 'pending';
  } else if (latestApp?.status === 'needs_info') {
    monetizationStatus = 'needs_info';
  } else if (latestApp?.status === 'rejected') {
    monetizationStatus = 'rejected';
  } else if (outstandingRequirements.length === 0) {
    // IMPORTANT: Never auto-activate monetization solely because follower threshold is met!
    monetizationStatus = 'eligible';
  }

  const record = {
    uid,
    followersCount,
    requiredFollowers: policy.minFollowers,
    isAdult,
    isEmailVerified,
    hasOriginalContent,
    isGoodStanding,
    regionEligible,
    policyCompliant,
    eligibleToApply: outstandingRequirements.length === 0 && !['approved', 'pending', 'suspended'].includes(monetizationStatus),
    monetizationStatus,
    outstandingRequirements,
    checkedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('creatorEligibility').doc(uid).set(record, { merge: true });
  return record;
});

export const submitMonetizationApplication = onCall({ enforceAppCheck: false }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const uid = request.auth.uid;
  await assertRateLimit(uid, 'submit_monetization', 5);
  const [userSnap, settingsSnap, postsSnap, reelsSnap, policy] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('userSettings').doc(uid).get(),
    db.collection('posts').where('authorId', '==', uid).limit(3).get(),
    db.collection('reels').where('authorId', '==', uid).limit(3).get(),
    loadMonetizationPolicyServer(),
  ]);

  if (!userSnap.exists) {
    throw new HttpsError('not-found', 'User profile not found.');
  }

  const user = userSnap.data()!;
  const settings = settingsSnap.data() || {};
  const followersCount = Number(user.followersCount || 0);
  const currentYear = new Date().getFullYear();
  const birthYear = Number(settings.birthYear || 0);
  const isAdult = !user.isMinor && birthYear > 0 && currentYear - birthYear >= 18;
  const isEmailVerified = Boolean(
    request.auth.token.email_verified || request.auth.token.firebase?.sign_in_provider === 'google.com'
  );

  if (!policy.monetizationEnabled) {
    throw new HttpsError('failed-precondition', 'Creator monetization applications are currently paused by administrators.');
  }
  if (followersCount < policy.minFollowers) {
    throw new HttpsError(
      'failed-precondition',
      `Minimum ${policy.minFollowers} followers required to apply (current: ${followersCount}).`
    );
  }
  if (policy.requireAdultAge && !isAdult) {
    throw new HttpsError('failed-precondition', 'Creators must meet the minimum legal age requirement (18+).');
  }
  if (policy.requireEmailVerified && !isEmailVerified) {
    throw new HttpsError('failed-precondition', 'Email verification is required before applying.');
  }
  if (user.accountStatus !== 'active') {
    throw new HttpsError('failed-precondition', 'Account must be in good standing.');
  }
  if (policy.requireOriginalContent && postsSnap.size + reelsSnap.size < 1) {
    throw new HttpsError('failed-precondition', 'Publish original content on BANA before applying.');
  }

  const activeSnap = await db
    .collection('creatorApplications')
    .where('uid', '==', uid)
    .where('status', 'in', ['pending', 'approved', 'suspended'])
    .limit(1)
    .get();

  if (!activeSnap.empty) {
    throw new HttpsError('already-exists', 'An active, approved, or suspended monetization record already exists.');
  }

  const {
    country = 'Bangladesh',
    payoutCategory = 'bKash / Nagad / Bank Transfer',
    originalContentAttested = true,
    policiesAccepted = true,
    regionalComplianceAttested = true,
  } = request.data || {};

  if (!originalContentAttested || !policiesAccepted) {
    throw new HttpsError('invalid-argument', 'You must accept Creator Guidelines and attest original content ownership.');
  }

  const policyForRegion = await loadMonetizationPolicyServer();
  if (!policyForRegion.monetizationEnabled) {
    throw new HttpsError('failed-precondition', 'The creator monetization program is currently not accepting applications.');
  }
  if (!isRegionAllowed(String(country), policyForRegion.eligibleRegions)) {
    throw new HttpsError('failed-precondition', `The monetization program is not available in "${String(country).slice(0, 60)}" yet.`);
  }

  const appRef = await db.collection('creatorApplications').add({
    uid,
    username: user.username,
    displayName: user.displayName || user.username,
    followerCountAtApply: followersCount,
    country: String(country).slice(0, 60),
    payoutCategory: String(payoutCategory).slice(0, 80),
    originalContentAttested: true,
    policiesAccepted: true,
    regionalComplianceAttested: Boolean(regionalComplianceAttested),
    status: 'pending',
    history: [
      {
        status: 'pending',
        note: 'Creator submitted monetization application',
        actorUid: uid,
        at: new Date().toISOString(),
      },
    ],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await db.collection('creatorEligibility').doc(uid).set(
    {
      uid,
      monetizationStatus: 'pending',
      eligibleToApply: false,
      checkedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return { applicationId: appRef.id, status: 'pending' };
});

// =========================================================================
// 2. Admin: Review Creator Monetization Application (Approve / Reject / Needs Info / Suspend / Restore)
// =========================================================================
export const reviewMonetizationApplication = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'finance_manager']);

  const { applicationId, decision, rejectionReason = '', adminNote = '' } = request.data || {};
  if (!applicationId || !['approved', 'rejected', 'needs_info', 'suspended', 'restored'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Valid applicationId and decision required.');
  }

  const appRef = db.collection('creatorApplications').doc(applicationId);
  const appSnap = await appRef.get();
  if (!appSnap.exists) throw new HttpsError('not-found', 'Application not found.');
  const appData = appSnap.data()!;
  const note = String(adminNote || rejectionReason || '').slice(0, 500);
  const targetStatus = decision === 'restored' ? 'approved' : decision;
  const existingHistory = Array.isArray(appData.history) ? appData.history : [];
  const nextHistory = [
    ...existingHistory,
    {
      status: decision,
      note,
      actorUid: request.auth.uid,
      at: new Date().toISOString(),
    },
  ];

  await db.runTransaction(async (tx) => {
    tx.update(appRef, {
      status: targetStatus,
      rejectionReason: decision === 'rejected' ? note : '',
      adminNote: note,
      reviewedBy: request.auth!.uid,
      history: nextHistory,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(db.collection('users').doc(appData.uid), {
      isCreator: targetStatus === 'approved',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(
      db.collection('creatorEligibility').doc(appData.uid),
      {
        uid: appData.uid,
        monetizationStatus: targetStatus,
        eligibleToApply: targetStatus === 'rejected',
        checkedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: `monetization_${decision}`,
    targetType: 'creatorApplication',
    targetId: applicationId,
    summary: `Monetization application for @${appData.username || appData.uid} marked ${decision}${note ? ` (${note})` : ''}.`,
  });

  await createDeduplicatedNotification({
    recipientId: appData.uid,
    actorId: request.auth.uid,
    actorName: 'BANA Creator Review',
    actorAvatar: '',
    type: 'monetization',
    title:
      decision === 'approved'
        ? 'Creator Monetization Approved'
        : decision === 'restored'
        ? 'Creator Monetization Restored'
        : decision === 'suspended'
        ? 'Creator Monetization Suspended'
        : decision === 'needs_info'
        ? 'Additional Info Requested for Monetization'
        : 'Monetization Application Update',
    body:
      decision === 'approved' || decision === 'restored'
        ? 'Your BANA Creator monetization account is active.'
        : note || `Application status updated to ${decision}. Open Creator Studio for details.`,
    linkUrl: '/creator-studio',
    dedupeKey: `monetization_${applicationId}_${decision}_${nextHistory.length}`,
  });

  return { ok: true, decision: targetStatus };
});

// =========================================================================
// 3. Server-Side Verified Earnings Calculation Engine
// =========================================================================
export const calculateCreatorCycleEarnings = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'finance_manager']);

  const { targetUid, period } = request.data || {};
  if (!targetUid || !period) throw new HttpsError('invalid-argument', 'targetUid and period required.');

  const userSnap = await db.collection('users').doc(targetUid).get();
  if (!userSnap.exists || !userSnap.data()?.isCreator) {
    throw new HttpsError('failed-precondition', 'Target user is not an approved creator.');
  }

  const configSnap = await db.collection('adminSettings').doc('monetization').get();
  const config = configSnap.data() || { videoRpmUsd: 1.25, engagementRateUsd: 0.002 };

  const reelsSnap = await db.collection('reels').where('authorId', '==', targetUid).get();
  let totalVerifiedViews = 0;
  let totalLikes = 0;
  reelsSnap.forEach((doc) => {
    totalVerifiedViews += Number(doc.data().viewsCount || 0);
    totalLikes += Number(doc.data().likesCount || 0);
  });

  const videoRevenue = Number(((totalVerifiedViews / 1000) * Number(config.videoRpmUsd || 1.25)).toFixed(2));
  const engagementRevenue = Number((totalLikes * Number(config.engagementRateUsd || 0.002)).toFixed(2));
  const totalAmount = Number((videoRevenue + engagementRevenue).toFixed(2));

  if (totalAmount <= 0) {
    return { created: false, amountUsd: 0 };
  }

  const earningRef = await db.collection('creatorEarnings').add({
    uid: targetUid,
    sourceType: 'video_views',
    amountUsd: totalAmount,
    status: 'approved',
    period: String(period),
    description: `Verified reel views (${totalVerifiedViews}) & engagement (${totalLikes})`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: 'earnings_calculated',
    targetType: 'creatorEarning',
    targetId: earningRef.id,
    summary: `Issued $${totalAmount} verified earnings for ${targetUid} (${period}).`,
  });

  return { created: true, earningId: earningRef.id, amountUsd: totalAmount };
});

// =========================================================================
// 4. Payout Request & Finance Approval (with Immutable Ledger)
// =========================================================================
export const requestCreatorPayout = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const uid = request.auth.uid;
  await assertRateLimit(uid, 'request_payout', 5);
  const { amountUsd, method, accountLabel, accountHolderName = '', country = 'Bangladesh' } = request.data || {};
  const amount = Number(amountUsd);

  const policy = await loadMonetizationPolicyServer();
  const minPayout = policy.minPayoutUsd || 10;

  if (!amount || amount < minPayout) {
    throw new HttpsError('invalid-argument', `Minimum payout threshold is $${minPayout.toFixed(2)}.`);
  }

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists || !userSnap.data()?.isCreator) {
    throw new HttpsError('failed-precondition', 'Approved creator monetization status required before requesting payouts.');
  }

  const settingsSnap = await db.collection('adminSettings').doc('payoutProviders').get();
  const enabledMethods: string[] = settingsSnap.data()?.enabledMethods || ['bKash', 'Nagad', 'Bank Transfer'];
  if (!enabledMethods.includes(String(method))) {
    throw new HttpsError('failed-precondition', 'Selected payout method is not currently enabled by BANA administrators.');
  }

  const payoutRef = db.collection('payoutRequests').doc();
  const lockRef = db.collection('payoutLocks').doc(uid);
  const cents = Math.round(amount * 100);

  // Balance check and payout creation happen in ONE transaction. The per-user lock document is
  // written inside it, so two concurrent requests conflict and the loser retries against fresh data.
  await db.runTransaction(async (tx) => {
    tx.get(lockRef); // read first so concurrent transactions contend on this document
    const earningsSnap = await tx.get(
      db.collection('creatorEarnings').where('uid', '==', uid).where('status', 'in', ['approved', 'confirmed', 'adjusted'])
    );
    let availableCents = 0;
    earningsSnap.forEach((d) => {
      availableCents += Math.round(Number(d.data().amountUsd || 0) * 100);
    });
    const existingPayouts = await tx.get(
      db.collection('payoutRequests').where('uid', '==', uid).where('status', 'in', ['pending', 'approved', 'processing', 'completed', 'paid'])
    );
    let reservedCents = 0;
    existingPayouts.forEach((d) => {
      reservedCents += Math.round(Number(d.data().amountUsd || 0) * 100);
    });
    if (availableCents - reservedCents < cents) {
      throw new HttpsError('failed-precondition', 'Insufficient confirmed balance for requested payout.');
    }

    const payload = {
      uid,
      amountUsd: cents / 100,
      method: String(method).slice(0, 60),
      accountLabel: String(accountLabel || '').slice(0, 140),
      accountHolderName: String(accountHolderName || '').slice(0, 100),
      country: String(country).slice(0, 60),
      status: 'pending',
      providerStatus: 'manual_review',
      policyVersion: Number((policy as any).policyVersion || 0),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    tx.set(lockRef, { uid, lastRequestAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true });
    tx.set(payoutRef, payload);
    tx.set(db.collection('creatorPayouts').doc(payoutRef.id), payload);
    tx.set(db.collection('financialTransactions').doc(), {
      uid,
      txType: 'payout_requested',
      direction: 'debit',
      amountUsd: cents / 100,
      currency: 'USD',
      referenceType: 'payoutRequest',
      referenceId: payoutRef.id,
      description: `Payout requested via ${String(method).slice(0, 60)} (${String(accountLabel || '').slice(0, 60)})`,
      actorUid: uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  return { payoutId: payoutRef.id, status: 'pending' };
});

export const processPayoutRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'finance_manager']);

  const { payoutId, status, adminNote = '', transactionRef = '' } = request.data || {};
  if (!payoutId || !['approved', 'processing', 'completed', 'paid', 'rejected'].includes(status)) {
    throw new HttpsError('invalid-argument', 'Invalid payout status.');
  }

  const payoutRef = db.collection('payoutRequests').doc(String(payoutId));
  const mirrorRef = db.collection('creatorPayouts').doc(String(payoutId));
  const finalStatus = status === 'completed' ? 'paid' : status;
  const ref = String(transactionRef || '').trim();
  const note = String(adminNote || '').trim();

  // "Paid" is only recorded with an explicit settlement reference (provider transaction id or an
  // authorized manual transfer reference). No payout provider is integrated, so nothing here is ever
  // labelled "provider_verified"; manual settlements are recorded as manual_recorded.
  if (finalStatus === 'paid' && ref.length < 3) {
    throw new HttpsError('failed-precondition', 'A settlement/transfer reference (min 3 characters) is required to mark a payout as paid.');
  }
  if (finalStatus === 'rejected' && note.length < 3) {
    throw new HttpsError('invalid-argument', 'A rejection reason is required.');
  }

  const ALLOWED: Record<string, string[]> = {
    pending: ['approved', 'processing', 'paid', 'rejected'],
    approved: ['processing', 'paid', 'rejected'],
    processing: ['paid', 'rejected'],
    paid: [],
    completed: [],
    rejected: [],
    failed: [],
  };

  const existing = await db.runTransaction(async (tx) => {
    const snap = await tx.get(payoutRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Payout request not found.');
    const cur = snap.data()!;
    const allowedNext = ALLOWED[String(cur.status)] || [];
    if (!allowedNext.includes(finalStatus)) {
      throw new HttpsError('failed-precondition', `Cannot change a payout from "${cur.status}" to "${finalStatus}".`);
    }
    const updateData = {
      status: finalStatus,
      providerStatus: finalStatus === 'paid' ? 'manual_recorded' : cur.providerStatus || 'manual_review',
      transactionRef: ref ? ref.slice(0, 120) : String(cur.transactionRef || ''),
      adminNote: note.slice(0, 300),
      reviewedBy: request.auth!.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    tx.update(payoutRef, updateData);
    tx.set(mirrorRef, { ...cur, ...updateData }, { merge: true });

    if (finalStatus === 'paid') {
      tx.set(db.collection('financialTransactions').doc(), {
        uid: cur.uid,
        txType: 'payout_completed',
        direction: 'debit',
        amountUsd: Number(cur.amountUsd || 0),
        currency: 'USD',
        referenceType: 'payoutRequest',
        referenceId: String(payoutId),
        description: `Payout recorded as settled via ${cur.method} (Ref: ${ref})`,
        actorUid: request.auth!.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else if (finalStatus === 'rejected') {
      tx.set(db.collection('financialTransactions').doc(), {
        uid: cur.uid,
        txType: 'payout_reversed',
        direction: 'credit',
        amountUsd: Number(cur.amountUsd || 0),
        currency: 'USD',
        referenceType: 'payoutRequest',
        referenceId: String(payoutId),
        description: `Payout request rejected & balance released (${note})`,
        actorUid: request.auth!.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    return cur;
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: `payout_${finalStatus}`,
    targetType: 'payoutRequest',
    targetId: String(payoutId),
    summary: `Payout ${payoutId} updated to ${finalStatus}${transactionRef ? ` (Ref ${transactionRef})` : ''}.`,
  });

  await createDeduplicatedNotification({
    recipientId: existing.uid,
    actorId: request.auth.uid,
    actorName: 'BANA Creator Finance',
    actorAvatar: '',
    type: 'monetization',
    title: finalStatus === 'paid' ? 'Creator Payout Completed' : `Payout Request ${finalStatus}`,
    body: `Your payout request of $${Number(existing.amountUsd || 0).toFixed(2)} via ${existing.method} is now ${finalStatus}.`,
    linkUrl: '/creator-studio?tab=payments',
    dedupeKey: `payout_${payoutId}_${finalStatus}`,
  });

  return { ok: true, status: finalStatus };
});

// =========================================================================
// 5. Advertisement Approval Workflow
// =========================================================================
export const reviewAdCampaign = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'admin', 'ad_manager', 'content_manager', 'moderator', 'finance_manager']);

  const { campaignId, decision, rejectionReason = '' } = request.data || {};
  if (!campaignId || !['approved', 'active', 'rejected', 'terminated', 'paused'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Valid campaignId and decision required.');
  }

  const ref = db.collection('adCampaigns').doc(campaignId);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Campaign not found.');
  const camp = snap.data()!;

  await ref.update({
    status: decision,
    rejectionReason: decision === 'rejected' ? String(rejectionReason).slice(0, 400) : '',
    approvedBy: decision === 'active' || decision === 'approved' ? request.auth.uid : camp.approvedBy || '',
    terminatedAt: decision === 'terminated' ? admin.firestore.FieldValue.serverTimestamp() : camp.terminatedAt || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: `ad_campaign_${decision}`,
    targetType: 'adCampaign',
    targetId: campaignId,
    summary: `Campaign ${camp.campaignName || campaignId} marked ${decision}.`,
  });

  await createDeduplicatedNotification({
    recipientId: camp.advertiserId,
    actorId: request.auth.uid,
    actorName: 'BANA Ad Review',
    actorAvatar: '',
    type: 'ad',
    title: `Ad Campaign ${String(decision).toUpperCase()}`,
    body:
      decision === 'rejected'
        ? `Campaign "${camp.campaignName}" was rejected: ${rejectionReason || 'Policy review failed'}`
        : `Campaign "${camp.campaignName}" is now ${decision}.`,
    linkUrl: '/advertise',
    dedupeKey: `ad_review_${campaignId}_${decision}`,
  });

  return { ok: true, status: decision };
});

// =========================================================================
// 6. Real-Time Social Triggers (Atomic Counters + Deduplicated Notifications)
// =========================================================================
export const onFollowCreated = onDocumentCreated('userFollows/{followId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const { followerId, followingId } = data;
  await Promise.all([
    db.collection('users').doc(followerId).update({ followingCount: admin.firestore.FieldValue.increment(1) }),
    db.collection('users').doc(followingId).update({ followersCount: admin.firestore.FieldValue.increment(1) }),
  ]);
  const followerSnap = await db.collection('users').doc(followerId).get();
  const follower = followerSnap.data() || {};
  await createDeduplicatedNotification({
    recipientId: followingId,
    actorId: followerId,
    actorName: follower.displayName || 'Someone',
    actorAvatar: follower.avatarUrl || '',
    type: 'follow',
    title: 'New Follower',
    body: `${follower.displayName || 'A user'} started following you on BANA.`,
    linkUrl: `/profile/${follower.username || followerId}`,
    dedupeKey: `follow_${followerId}_${followingId}`,
  });
});

export const onFollowDeleted = onDocumentDeleted('userFollows/{followId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  const { followerId, followingId } = data;
  await Promise.all([
    db.collection('users').doc(followerId).update({ followingCount: admin.firestore.FieldValue.increment(-1) }),
    db.collection('users').doc(followingId).update({ followersCount: admin.firestore.FieldValue.increment(-1) }),
  ]);
});

export const onLikeCreated = onDocumentCreated('postLikes/{likeId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  // Story reactions have no likesCount counter; skipping avoids NOT_FOUND retries on posts/{storyId}.
  if (data.targetType === 'story') return;
  const col = data.targetType === 'reel' ? 'reels' : 'posts';
  await db.collection(col).doc(String(data.targetId)).update({
    likesCount: admin.firestore.FieldValue.increment(1),
  }).catch(() => {});
});

export const onLikeDeleted = onDocumentDeleted('postLikes/{likeId}', async (event) => {
  const data = event.data?.data();
  if (!data) return;
  // Story reactions have no likesCount counter; skipping avoids NOT_FOUND retries on posts/{storyId}.
  if (data.targetType === 'story') return;
  const col = data.targetType === 'reel' ? 'reels' : 'posts';
  await db.collection(col).doc(String(data.targetId)).update({
    likesCount: admin.firestore.FieldValue.increment(-1),
  }).catch(() => {});
});

export const onAdImpressionCreated = onDocumentCreated('adImpressions/{impId}', async (event) => {
  const data = event.data?.data();
  if (!data?.campaignId) return;
  await db.collection('adCampaigns').doc(String(data.campaignId)).update({
    impressions: admin.firestore.FieldValue.increment(1),
  });
});

export const onAdClickCreated = onDocumentCreated('adClicks/{clickId}', async (event) => {
  const data = event.data?.data();
  if (!data?.campaignId) return;
  await db.collection('adCampaigns').doc(String(data.campaignId)).update({
    clicks: admin.firestore.FieldValue.increment(1),
  });
});

// =========================================================================
// 7. Scheduled Cleanup (Expired 24h Stories)
// =========================================================================
export const cleanupExpiredStories = onSchedule('every 60 minutes', async () => {
  const now = admin.firestore.Timestamp.now();
  const expired = await db.collection('stories').where('expiresAt', '<=', now).limit(200).get();
  const batch = db.batch();
  expired.docs.forEach((doc) => batch.delete(doc.ref));
  if (!expired.empty) {
    await batch.commit();
  }
});

// =========================================================================
// 8. Privacy: User Data Export & Account Deletion
// =========================================================================
export const exportUserData = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const uid = request.auth.uid;
  await assertRateLimit(uid, 'export_data', 3);
  const [userDoc, settingsDoc, postsSnap, reelsSnap] = await Promise.all([
    db.collection('users').doc(uid).get(),
    db.collection('userSettings').doc(uid).get(),
    db.collection('posts').where('authorId', '==', uid).get(),
    db.collection('reels').where('authorId', '==', uid).get(),
  ]);
  return {
    exportedAt: new Date().toISOString(),
    profile: userDoc.data() || null,
    settings: settingsDoc.data() || null,
    posts: postsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
    reels: reelsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
  };
});

// Full server-side erasure (Blaze). Removes everything the user authored, including content that client
// security rules do not let the client delete (comments, messages). The client deletes the Auth user afterwards.
export const deleteMyAccountData = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const uid = request.auth.uid;
  await assertRateLimit(uid, 'delete_account_data', 2);
  const targets: Array<[string, string]> = [
    ['posts', 'authorId'], ['reels', 'authorId'], ['stories', 'authorId'], ['comments', 'authorId'],
    ['messages', 'senderId'], ['postLikes', 'userId'], ['savedPosts', 'userId'],
    ['userFollows', 'followerId'], ['userFollows', 'followingId'],
    ['followRequests', 'fromUid'], ['followRequests', 'toUid'],
    ['friendRequests', 'fromUid'], ['friendRequests', 'toUid'],
    ['userBlocks', 'blockerId'], ['notifications', 'recipientId'], ['usernames', 'uid'],
  ];
  let deleted = 0;
  for (const [col, field] of targets) {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const snap = await db.collection(col).where(field, '==', uid).limit(400).get();
      if (snap.empty) break;
      const batch = db.batch();
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit();
      deleted += snap.size;
      if (snap.size < 400) break;
    }
  }
  const pairs = await db.collection('friendships').where('participants', 'array-contains', uid).get();
  if (!pairs.empty) {
    const batch = db.batch();
    pairs.docs.forEach((d) => batch.delete(d.ref));
    await batch.commit();
    deleted += pairs.size;
  }
  await db.collection('userSettings').doc(uid).delete().catch(() => undefined);
  await db.collection('users').doc(uid).delete().catch(() => undefined);
  return { ok: true, deleted };
});

// =========================================================================
// 9. Firebase Auth Custom Claims Sync & Admin RBAC Enforcement
// =========================================================================
const VALID_ADMIN_ROLES = [
  'super_admin',
  'admin',
  'moderator',
  'support_staff',
  'finance_manager',
  'ad_manager',
  'content_manager',
  'support_manager',
];

export const syncAdminClaimsOnRoleWrite = onDocumentWritten('adminRoles/{uid}', async (event) => {
  const uid = event.params.uid;
  const afterData = event.data?.after.exists ? event.data.after.data() : null;
  const role = afterData?.role ? String(afterData.role) : null;

  const userRecord = await admin.auth().getUser(uid).catch(() => null);
  if (!userRecord) return;

  const existingClaims = userRecord.customClaims || {};
  if (role && VALID_ADMIN_ROLES.includes(role)) {
    await admin.auth().setCustomUserClaims(uid, { ...existingClaims, adminRole: role });
  } else {
    const nextClaims = { ...existingClaims };
    delete nextClaims.adminRole;
    await admin.auth().setCustomUserClaims(uid, nextClaims);
  }
});

export const assignAdminRole = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin']);

  const { targetUid, email = '', role } = request.data || {};
  if (!targetUid || typeof targetUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid targetUid is required.');
  }

  if (role === null || role === 'revoke') {
    await db.collection('adminRoles').doc(targetUid).delete();
    const userRecord = await admin.auth().getUser(targetUid).catch(() => null);
    if (userRecord) {
      const nextClaims = { ...(userRecord.customClaims || {}) };
      delete nextClaims.adminRole;
      await admin.auth().setCustomUserClaims(targetUid, nextClaims);
    }
    await writeAuditLog({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email,
      action: 'revoke_admin_role',
      targetType: 'adminRole',
      targetId: targetUid,
      summary: `Revoked admin role & custom claim for ${targetUid}.`,
    });
    return { ok: true, role: null };
  }

  if (!VALID_ADMIN_ROLES.includes(String(role))) {
    throw new HttpsError('invalid-argument', 'Invalid admin role specified.');
  }

  await db.collection('adminRoles').doc(targetUid).set({
    uid: targetUid,
    email: String(email).slice(0, 120),
    role: String(role),
    assignedBy: request.auth.uid,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const userRecord = await admin.auth().getUser(targetUid).catch(() => null);
  if (userRecord) {
    await admin.auth().setCustomUserClaims(targetUid, {
      ...(userRecord.customClaims || {}),
      adminRole: String(role),
    });
  }

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: 'assign_admin_role',
    targetType: 'adminRole',
    targetId: targetUid,
    summary: `Assigned ${role} role & custom claim to ${targetUid}.`,
  });

  return { ok: true, role: String(role) };
});

export const syncMyAdminClaims = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const uid = request.auth.uid;
  const email = request.auth.token.email?.toLowerCase();
  const isVerifiedEmail = Boolean(request.auth.token.email_verified);

  let resolvedRole: string | null = null;
  if (email === BOOTSTRAPPED_ADMIN_EMAIL && isVerifiedEmail) {
    resolvedRole = 'super_admin';
  } else {
    const roleSnap = await db.collection('adminRoles').doc(uid).get();
    if (roleSnap.exists) {
      const r = String(roleSnap.data()?.role || '');
      if (VALID_ADMIN_ROLES.includes(r)) resolvedRole = r;
    }
  }

  const userRecord = await admin.auth().getUser(uid);
  const nextClaims = { ...(userRecord.customClaims || {}) };
  if (resolvedRole) {
    nextClaims.adminRole = resolvedRole;
  } else {
    delete nextClaims.adminRole;
  }
  await admin.auth().setCustomUserClaims(uid, nextClaims);

  return { adminRole: resolvedRole };
});

// =========================================================================
// 10. Comment Counter Triggers
// =========================================================================
export const onCommentCreated = onDocumentCreated('comments/{commentId}', async (event) => {
  const data = event.data?.data();
  if (!data?.targetId) return;
  const col = data.targetType === 'reel' ? 'reels' : 'posts';
  await db.collection(col).doc(String(data.targetId)).update({
    commentsCount: admin.firestore.FieldValue.increment(1),
  }).catch(() => {});
});

export const onCommentDeleted = onDocumentDeleted('comments/{commentId}', async (event) => {
  const data = event.data?.data();
  if (!data?.targetId) return;
  const col = data.targetType === 'reel' ? 'reels' : 'posts';
  await db.collection(col).doc(String(data.targetId)).update({
    commentsCount: admin.firestore.FieldValue.increment(-1),
  }).catch(() => {});
});

export const onReelViewCreated = onDocumentCreated('reelViews/{viewId}', async (event) => {
  const data = event.data?.data();
  if (!data?.reelId) return;
  await db.collection('reels').doc(String(data.reelId)).update({
    viewsCount: admin.firestore.FieldValue.increment(1),
  }).catch(() => {});
});

// =========================================================================
// 11. WebRTC Ephemeral TURN Credentials & Messenger / Calling Triggers
// =========================================================================
export const getWebRTCIceConfig = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertRateLimit(request.auth.uid, 'webrtc_ice', 30);

  const callingSnap = await db.collection('adminSettings').doc('calling').get();
  const cfg = callingSnap.exists ? callingSnap.data() || {} : {};
  const stunUrls: string[] =
    Array.isArray(cfg.stunServers) && cfg.stunServers.length > 0
      ? cfg.stunServers
      : ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'];

  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: stunUrls },
  ];

  // Server-side secret ONLY: configured in Firebase Secret Manager / process.env
  const turnSecret = process.env.TURN_SHARED_SECRET || '';
  const turnUrlsRaw = process.env.TURN_URLS || '';
  let turnConfigured = false;

  if (turnSecret && turnUrlsRaw) {
    const turnUrls = turnUrlsRaw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    if (turnUrls.length > 0) {
      const ttlSeconds = 3600;
      const unixExpiry = Math.floor(Date.now() / 1000) + ttlSeconds;
      const username = `${unixExpiry}:${request.auth.uid}`;
      const credential = crypto.createHmac('sha1', turnSecret).update(username).digest('base64');
      iceServers.push({
        urls: turnUrls,
        username,
        credential,
      });
      turnConfigured = true;
    }
  }

  return {
    iceServers,
    turnConfigured,
    maxCallDurationMinutes: Number(cfg.maxCallDurationMinutes || 60),
  };
});

export const configureTurnMetadata = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin']);

  const {
    webrtcEnabled = true,
    allowVoiceCalls = true,
    allowVideoCalls = true,
    stunServers = ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'],
    turnRelayHint = '',
    turnProvider = 'none',
    maxCallDurationMinutes = 60,
  } = request.data || {};

  const sanitizedStun = Array.isArray(stunServers)
    ? stunServers.map((s: any) => String(s).trim()).filter((s: string) => s.startsWith('stun:'))
    : ['stun:stun.l.google.com:19302'];

  await db.collection('adminSettings').doc('calling').set(
    {
      webrtcEnabled: Boolean(webrtcEnabled),
      allowVoiceCalls: Boolean(allowVoiceCalls),
      allowVideoCalls: Boolean(allowVideoCalls),
      stunServers: sanitizedStun.length > 0 ? sanitizedStun : ['stun:stun.l.google.com:19302'],
      turnRelayHint: String(turnRelayHint || '').slice(0, 200),
      turnProvider: ['none', 'coturn', 'metered', 'twilio'].includes(String(turnProvider))
        ? String(turnProvider)
        : 'none',
      maxCallDurationMinutes: Math.max(5, Math.min(240, Number(maxCallDurationMinutes) || 60)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: 'update_calling_settings',
    targetType: 'adminSettings',
    targetId: 'calling',
    summary: `Updated calling settings (provider=${turnProvider}, maxMinutes=${maxCallDurationMinutes}).`,
  });

  return { ok: true };
});

export const onMessageCreated = onDocumentCreated('messages/{messageId}', async (event) => {
  const msg = event.data?.data();
  if (!msg?.conversationId || !msg?.senderId) return;

  const convSnap = await db.collection('conversations').doc(String(msg.conversationId)).get();
  if (!convSnap.exists) return;
  const conv = convSnap.data() || {};
  const participants: string[] = Array.isArray(conv.participantIds) ? conv.participantIds : [];
  const mutedBy: string[] = Array.isArray(conv.mutedBy) ? conv.mutedBy : [];
  const senderMeta = conv.participantMeta?.[msg.senderId] || {};
  const senderName = senderMeta.displayName || 'BANA Member';

  const targets = participants.filter((pid) => pid !== msg.senderId && !mutedBy.includes(pid));
  if (targets.length === 0) return;

  const tokenSnaps = await Promise.all(
    targets.slice(0, 20).map((uid) => db.collection('fcmTokens').where('uid', '==', uid).limit(5).get())
  );
  const tokens: string[] = [];
  tokenSnaps.forEach((s) => s.docs.forEach((d) => {
    const t = d.data()?.token;
    if (typeof t === 'string' && t) tokens.push(t);
  }));

  if (tokens.length > 0) {
    const body =
      msg.type === 'text'
        ? String(msg.text || '').slice(0, 100)
        : msg.type === 'voice'
        ? 'Sent a voice message'
        : msg.type === 'shared_reel'
        ? 'Shared a BANA Reel'
        : msg.type === 'shared_post'
        ? 'Shared a BANA Post'
        : `Sent ${msg.type}`;
    await admin
      .messaging()
      .sendEachForMulticast({
        tokens,
        notification: {
          title: conv.isGroup ? `${conv.groupName || 'Group Chat'}: ${senderName}` : senderName,
          body,
        },
        data: {
          type: 'message',
          conversationId: String(msg.conversationId),
        },
      })
      .catch(() => {});
  }
});

export const onCallCreated = onDocumentCreated('calls/{callId}', async (event) => {
  const call = event.data?.data();
  if (!call?.calleeId || !call?.callerId) return;

  const tokenSnap = await db.collection('fcmTokens').where('uid', '==', call.calleeId).limit(5).get();
  const tokens = tokenSnap.docs.map((d) => d.data()?.token).filter((t): t is string => typeof t === 'string' && Boolean(t));

  if (tokens.length > 0) {
    await admin
      .messaging()
      .sendEachForMulticast({
        tokens,
        notification: {
          title: `Incoming ${call.callType === 'video' ? 'Video' : 'Voice'} Call`,
          body: `${call.callerName || 'Someone'} is calling you on BANA Messenger`,
        },
        data: {
          type: 'incoming_call',
          callId: event.params.callId,
          callType: String(call.callType || 'audio'),
          conversationId: String(call.conversationId || ''),
        },
      })
      .catch(() => {});
  }
});

// =========================================================================
// 12. Phase 06: Friendships, Follow Requests & Verification Triggers
// =========================================================================
export const onFriendshipCreated = onDocumentCreated('friendships/{pairId}', async (event) => {
  const data = event.data?.data();
  const participants: string[] = Array.isArray(data?.participants) ? data.participants : [];
  if (participants.length !== 2) return;

  await Promise.all(
    participants.map((uid) =>
      db.collection('users').doc(uid).update({
        friendsCount: admin.firestore.FieldValue.increment(1),
      }).catch(() => {})
    )
  );
});

export const onFriendshipDeleted = onDocumentDeleted('friendships/{pairId}', async (event) => {
  const data = event.data?.data();
  const participants: string[] = Array.isArray(data?.participants) ? data.participants : [];
  if (participants.length !== 2) return;

  await Promise.all(
    participants.map((uid) =>
      db.collection('users').doc(uid).update({
        friendsCount: admin.firestore.FieldValue.increment(-1),
      }).catch(() => {})
    )
  );
});

export const onFriendRequestCreated = onDocumentCreated('friendRequests/{requestId}', async (event) => {
  const data = event.data?.data();
  if (!data?.fromUid || !data?.toUid) return;

  const senderSnap = await db.collection('users').doc(String(data.fromUid)).get();
  const sender = senderSnap.data() || {};
  await createDeduplicatedNotification({
    recipientId: String(data.toUid),
    actorId: String(data.fromUid),
    actorName: sender.displayName || 'Someone',
    actorAvatar: sender.avatarUrl || '',
    type: 'friend_request',
    title: 'New Friend Request',
    body: `${sender.displayName || 'A BANA user'} sent you a friend request.`,
    linkUrl: `/profile/${sender.username || data.fromUid}`,
    dedupeKey: `friend_req_${data.fromUid}_${data.toUid}`,
  });
});

export const onFollowRequestCreated = onDocumentCreated('followRequests/{requestId}', async (event) => {
  const data = event.data?.data();
  if (!data?.fromUid || !data?.toUid) return;

  const senderSnap = await db.collection('users').doc(String(data.fromUid)).get();
  const sender = senderSnap.data() || {};
  await createDeduplicatedNotification({
    recipientId: String(data.toUid),
    actorId: String(data.fromUid),
    actorName: sender.displayName || 'Someone',
    actorAvatar: sender.avatarUrl || '',
    type: 'follow_request',
    title: 'Follow Request',
    body: `${sender.displayName || 'A user'} requested to follow your account.`,
    linkUrl: `/profile/${sender.username || data.fromUid}`,
    dedupeKey: `follow_req_${data.fromUid}_${data.toUid}`,
  });
});

export const onFollowRequestUpdated = onDocumentUpdated('followRequests/{requestId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;
  if (before.status === 'pending' && after.status === 'accepted') {
    const followId = `${after.fromUid}_${after.toUid}`;
    const followRef = db.collection('userFollows').doc(followId);
    const existing = await followRef.get();
    if (!existing.exists) {
      await followRef.set({
        followerId: after.fromUid,
        followingId: after.toUid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
    const targetSnap = await db.collection('users').doc(String(after.toUid)).get();
    const target = targetSnap.data() || {};
    await createDeduplicatedNotification({
      recipientId: String(after.fromUid),
      actorId: String(after.toUid),
      actorName: target.displayName || 'Someone',
      actorAvatar: target.avatarUrl || '',
      type: 'follow_accepted',
      title: 'Follow Request Accepted',
      body: `${target.displayName || 'User'} accepted your follow request.`,
      linkUrl: `/profile/${target.username || after.toUid}`,
      dedupeKey: `follow_acc_${after.toUid}_${after.fromUid}`,
    });
  }
});

export const reviewVerificationRequest = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'admin', 'moderator', 'support_staff', 'support_manager']);

  const { requestId, decision, adminNote = '' } = request.data || {};
  if (!requestId || !['approved', 'rejected', 'needs_info'].includes(decision)) {
    throw new HttpsError('invalid-argument', 'Valid requestId and decision (approved|rejected|needs_info) required.');
  }

  const reqRef = db.collection('verificationRequests').doc(String(requestId));
  const reqSnap = await reqRef.get();
  if (!reqSnap.exists) throw new HttpsError('not-found', 'Verification request not found.');
  const reqData = reqSnap.data()!;
  const note = String(adminNote || '').slice(0, 500);
  const existingHistory = Array.isArray(reqData.history) ? reqData.history : [];
  const nextHistory = [
    ...existingHistory,
    {
      status: decision,
      note,
      actorUid: request.auth.uid,
      at: new Date().toISOString(),
    },
  ];

  await db.runTransaction(async (tx) => {
    tx.update(reqRef, {
      status: decision,
      adminNote: note,
      reviewedBy: request.auth!.uid,
      history: nextHistory,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (decision === 'approved') {
      tx.update(db.collection('users').doc(String(reqData.uid)), {
        isVerified: true,
        verificationType: reqData.type === 'organization' ? 'organization' : 'identity',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: `verification_${decision}`,
    targetType: 'verificationRequest',
    targetId: String(requestId),
    summary: `Verification request for ${reqData.fullName || reqData.uid} marked ${decision}.`,
  });

  await createDeduplicatedNotification({
    recipientId: String(reqData.uid),
    actorId: request.auth.uid,
    actorName: 'BANA Verification',
    actorAvatar: '',
    type: 'verification',
    title:
      decision === 'approved'
        ? 'Account Verified'
        : decision === 'needs_info'
        ? 'More Info Needed for Verification'
        : 'Verification Request Update',
    body:
      decision === 'approved'
        ? 'Congratulations! Your BANA account is now verified.'
        : decision === 'needs_info'
        ? `Verification needs additional info: ${note || 'Please update your submission.'}`
        : `Your verification request was not approved: ${note || 'Review criteria and try again.'}`,
    linkUrl: `/profile/${reqData.username || reqData.uid}`,
    dedupeKey: `verify_${requestId}_${decision}_${nextHistory.length}`,
  });

  return { ok: true, decision };
});

// =========================================================================
// 13. Phase 07: Marketplace Orders, Inventory, Payments & Refund Workflows
// =========================================================================
export const getPaymentGatewayConfigStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const gwSnap = await db.collection('adminSettings').doc('paymentGateways').get();
  const cfg = gwSnap.exists ? gwSnap.data() || {} : {};

  return {
    codEnabled: cfg.codEnabled !== false,
    manualMobileBankingEnabled: cfg.manualMobileBankingEnabled !== false,
    sslcommerzConfigured: Boolean(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASS),
    bkashGatewayConfigured: Boolean(process.env.BKASH_APP_KEY && process.env.BKASH_APP_SECRET),
    nagadGatewayConfigured: Boolean(process.env.NAGAD_MERCHANT_ID && process.env.NAGAD_PRIVATE_KEY),
    stripeConfigured: Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET),
    requiredEnvKeys: [
      'SSLCOMMERZ_STORE_ID',
      'SSLCOMMERZ_STORE_PASS',
      'BKASH_APP_KEY',
      'BKASH_APP_SECRET',
      'NAGAD_MERCHANT_ID',
      'NAGAD_PRIVATE_KEY',
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
    ],
  };
});

export const createMarketplaceOrder = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const buyerId = request.auth.uid;
  await assertRateLimit(buyerId, 'marketplace_order', 12);

  const {
    idempotencyKey,
    items,
    shippingAddress,
    paymentMethod = 'cod',
    deliveryOption = 'Standard Courier',
    paymentRef = '',
    senderAccount = '',
  } = request.data || {};

  const cleanKey = String(idempotencyKey || '').trim();
  if (!cleanKey || cleanKey.length < 8 || cleanKey.length > 120) {
    throw new HttpsError('invalid-argument', 'Valid idempotencyKey is required to prevent duplicate orders.');
  }
  if (!Array.isArray(items) || items.length === 0 || items.length > 30) {
    throw new HttpsError('invalid-argument', 'Cart must contain between 1 and 30 items.');
  }
  if (!['cod', 'bkash', 'nagad', 'card_gateway'].includes(String(paymentMethod))) {
    throw new HttpsError('invalid-argument', 'Unsupported payment method.');
  }
  if (
    paymentMethod === 'card_gateway' &&
    !(process.env.SSLCOMMERZ_STORE_ID && process.env.SSLCOMMERZ_STORE_PASS) &&
    !process.env.STRIPE_SECRET_KEY
  ) {
    throw new HttpsError(
      'failed-precondition',
      'Online card/gateway payment credentials are not configured on the server yet. Use Cash on Delivery (COD) or bKash/Nagad verification.'
    );
  }
  if (
    (paymentMethod === 'bkash' || paymentMethod === 'nagad') &&
    String(paymentRef || '').trim().length < 4
  ) {
    throw new HttpsError('invalid-argument', 'Valid mobile banking Transaction ID is required.');
  }

  const addr = shippingAddress || {};
  const fullName = String(addr.fullName || '').trim().slice(0, 100);
  const phone = String(addr.phone || '').trim().slice(0, 40);
  const district = String(addr.district || '').trim().slice(0, 60);
  const addressLine = String(addr.addressLine || '').trim().slice(0, 240);
  if (!fullName || !phone || !district || !addressLine) {
    throw new HttpsError('invalid-argument', 'Complete shipping address (name, phone, district, address) is required.');
  }

  // Idempotency deduplication check
  const existingOrdersSnap = await db
    .collection('orders')
    .where('buyerId', '==', buyerId)
    .where('idempotencyKey', '==', cleanKey)
    .limit(20)
    .get();
  if (!existingOrdersSnap.empty) {
    return {
      ok: true,
      deduplicated: true,
      orderIds: existingOrdersSnap.docs.map((d) => d.id),
    };
  }

  const buyerSnap = await db.collection('users').doc(buyerId).get();
  const buyer = buyerSnap.data() || {};

  // Aggregate duplicate productId entries safely
  const qtyByProduct = new Map<string, number>();
  for (const row of items) {
    const pid = String(row?.productId || '').trim();
    const qty = Math.floor(Number(row?.quantity || 0));
    if (!pid || qty <= 0 || qty > 50) {
      throw new HttpsError('invalid-argument', 'Invalid product or quantity in cart.');
    }
    qtyByProduct.set(pid, (qtyByProduct.get(pid) || 0) + qty);
  }

  const productIds = Array.from(qtyByProduct.keys());
  const checkoutGroupId = `chk_${Date.now()}_${buyerId.slice(0, 6)}`;
  const createdOrderIds: string[] = [];
  const sellerNotifications: Array<{
    sellerId: string;
    orderId: string;
    totalAmount: number;
    currency: string;
  }> = [];

  await db.runTransaction(async (tx) => {
    const productSnaps = await Promise.all(
      productIds.map((pid) => tx.get(db.collection('marketplaceListings').doc(pid)))
    );

    const storeIds = new Set<string>();
    productSnaps.forEach((snap) => {
      const data = snap.data();
      if (data?.storeId) storeIds.add(String(data.storeId));
    });
    const storeSnaps = await Promise.all(
      Array.from(storeIds).map((sid) => tx.get(db.collection('stores').doc(sid)))
    );
    const storeMap = new Map<string, any>();
    storeSnaps.forEach((s) => {
      if (s.exists) storeMap.set(s.id, { id: s.id, ...s.data() });
    });

    interface ValidatedLine {
      productId: string;
      sellerId: string;
      sellerName: string;
      sellerUsername: string;
      storeId: string;
      storeName: string;
      title: string;
      imageUrl: string;
      unitPrice: number;
      deliveryFee: number;
      currency: string;
      requestedQty: number;
      currentQty: number;
    }

    const bySeller = new Map<string, ValidatedLine[]>();

    for (let i = 0; i < productSnaps.length; i++) {
      const snap = productSnaps[i];
      const pid = productIds[i];
      if (!snap.exists) {
        throw new HttpsError('not-found', `Product ${pid} no longer exists.`);
      }
      const prod = snap.data()!;
      const requestedQty = qtyByProduct.get(pid) || 0;
      const availableQty = typeof prod.quantity === 'number' ? prod.quantity : prod.status === 'active' ? 1 : 0;

      if (prod.status !== 'active') {
        throw new HttpsError('failed-precondition', `"${prod.title}" is no longer available for purchase.`);
      }
      if (prod.sellerId === buyerId) {
        throw new HttpsError('failed-precondition', `You cannot purchase your own listing ("${prod.title}").`);
      }
      if (availableQty < requestedQty) {
        throw new HttpsError('failed-precondition', `Insufficient stock for "${prod.title}" (remaining: ${availableQty}).`);
      }
      if (prod.storeId && storeMap.has(String(prod.storeId))) {
        const st = storeMap.get(String(prod.storeId));
        if (st.status !== 'active') {
          throw new HttpsError('failed-precondition', `Store "${st.name}" is currently restricted.`);
        }
      }

      const line: ValidatedLine = {
        productId: pid,
        sellerId: String(prod.sellerId),
        sellerName: String(prod.sellerName || 'Seller'),
        sellerUsername: String(prod.sellerUsername || 'seller'),
        storeId: String(prod.storeId || ''),
        storeName: String(prod.storeName || ''),
        title: String(prod.title || 'Product'),
        imageUrl: Array.isArray(prod.imageUrls) && prod.imageUrls[0] ? String(prod.imageUrls[0]) : '',
        unitPrice: Math.max(0, Number(prod.price || 0)),
        deliveryFee: Math.max(0, Number(prod.deliveryFee || 0)),
        currency: String(prod.currency || 'BDT'),
        requestedQty,
        currentQty: availableQty,
      };

      const existingGroup = bySeller.get(line.sellerId) || [];
      existingGroup.push(line);
      bySeller.set(line.sellerId, existingGroup);
    }

    // Create one authoritative order per seller & decrement inventory atomically
    let sellerIndex = 0;
    for (const [sellerId, lines] of bySeller.entries()) {
      sellerIndex++;
      const orderRef = db.collection('orders').doc(`${cleanKey}_s${sellerIndex}`.slice(0, 120));
      const subtotal = lines.reduce((sum, l) => sum + l.unitPrice * l.requestedQty, 0);
      const deliveryFee =
        deliveryOption === 'Local Pickup'
          ? 0
          : lines.reduce((maxFee, l) => Math.max(maxFee, l.deliveryFee), 0);
      const totalAmount = subtotal + deliveryFee;
      const currency = lines[0].currency;
      const paymentStatus = paymentMethod === 'cod' ? 'pending_cod' : 'awaiting_verification';

      tx.set(orderRef, {
        checkoutGroupId,
        idempotencyKey: cleanKey,
        buyerId,
        buyerName: String(buyer.displayName || 'Buyer'),
        buyerUsername: String(buyer.username || 'buyer'),
        sellerId,
        sellerName: lines[0].sellerName,
        sellerUsername: lines[0].sellerUsername,
        storeId: lines[0].storeId || '',
        storeName: lines[0].storeName || '',
        itemsSnapshot: lines.map((l) => ({
          productId: l.productId,
          title: l.title,
          imageUrl: l.imageUrl,
          unitPrice: l.unitPrice,
          quantity: l.requestedQty,
          lineTotal: l.unitPrice * l.requestedQty,
        })),
        itemProductIds: lines.map((l) => l.productId),
        subtotal,
        deliveryFee,
        totalAmount,
        currency,
        deliveryOption: String(deliveryOption || 'Standard Courier').slice(0, 60),
        shippingAddress: {
          fullName,
          phone,
          district,
          addressLine,
          postalCode: String(addr.postalCode || '').trim().slice(0, 20),
          notes: String(addr.notes || '').trim().slice(0, 300),
        },
        paymentMethod,
        paymentStatus,
        paymentRef: String(paymentRef || '').trim().slice(0, 120),
        status: 'pending',
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      lines.forEach((l, idx) => {
        const itemRef = db.collection('orderItems').doc(`${orderRef.id}_${idx}`);
        tx.set(itemRef, {
          orderId: orderRef.id,
          buyerId,
          sellerId,
          storeId: l.storeId || '',
          productId: l.productId,
          title: l.title,
          imageUrl: l.imageUrl,
          unitPrice: l.unitPrice,
          quantity: l.requestedQty,
          lineTotal: l.unitPrice * l.requestedQty,
          currency,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        const nextQty = Math.max(0, l.currentQty - l.requestedQty);
        tx.update(db.collection('marketplaceListings').doc(l.productId), {
          quantity: nextQty,
          soldCount: admin.firestore.FieldValue.increment(l.requestedQty),
          status: nextQty === 0 ? 'out_of_stock' : 'active',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      });

      const paymentDocRef = db.collection('payments').doc(`pay_${orderRef.id}`);
      tx.set(paymentDocRef, {
        orderId: orderRef.id,
        buyerId,
        sellerId,
        amount: totalAmount,
        currency,
        method: paymentMethod,
        transactionRef: String(paymentRef || (paymentMethod === 'cod' ? `COD-${orderRef.id.slice(-8)}` : '')).slice(0, 120),
        senderAccount: String(senderAccount || '').slice(0, 80),
        providerVerified: false,
        status: paymentStatus,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      createdOrderIds.push(orderRef.id);
      sellerNotifications.push({ sellerId, orderId: orderRef.id, totalAmount, currency });
    }

    // Clear ordered items from buyer's persisted cart
    const cartRef = db.collection('shoppingCarts').doc(buyerId);
    const cartSnap = await tx.get(cartRef);
    if (cartSnap.exists) {
      const currentItems: any[] = Array.isArray(cartSnap.data()?.items) ? cartSnap.data()!.items : [];
      const remaining = currentItems.filter((ci) => !qtyByProduct.has(String(ci.productId)));
      tx.set(
        cartRef,
        {
          uid: buyerId,
          items: remaining,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
  });

  await Promise.all(
    sellerNotifications.map((n) =>
      createDeduplicatedNotification({
        recipientId: n.sellerId,
        actorId: buyerId,
        actorName: String(buyer.displayName || 'Customer'),
        actorAvatar: String(buyer.avatarUrl || ''),
        type: 'marketplace',
        title: 'New Marketplace Order',
        body: `${buyer.displayName || 'A customer'} placed an order for ${n.currency} ${n.totalAmount.toLocaleString()}.`,
        linkUrl: `/market?tab=seller`,
        dedupeKey: `order_new_${n.orderId}`,
      })
    )
  );

  return { ok: true, deduplicated: false, orderIds: createdOrderIds };
});

export const transitionOrderStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  const actorUid = request.auth.uid;
  const { orderId, nextStatus, trackingCode = '', note = '' } = request.data || {};
  const validStatuses = ['confirmed', 'processing', 'shipped', 'delivered', 'cancelled'];
  if (!orderId || !validStatuses.includes(String(nextStatus))) {
    throw new HttpsError('invalid-argument', 'Valid orderId and nextStatus required.');
  }

  const orderRef = db.collection('orders').doc(String(orderId));
  let orderMeta: any = null;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Order not found.');
    const ord = snap.data()!;
    orderMeta = ord;

    const isBuyer = ord.buyerId === actorUid;
    const isSeller = ord.sellerId === actorUid;
    if (!isBuyer && !isSeller) {
      await assertAdminRole(actorUid, request.auth!.token.email, ['super_admin', 'finance_manager']);
    }

    const current = String(ord.status);
    if (isBuyer && !isSeller) {
      if (nextStatus !== 'cancelled' || !['pending', 'confirmed'].includes(current)) {
        throw new HttpsError('permission-denied', 'Buyers can only cancel pending or newly confirmed orders.');
      }
    } else if (isSeller) {
      const allowedTransitions: Record<string, string[]> = {
        pending: ['confirmed', 'cancelled'],
        confirmed: ['processing', 'cancelled'],
        processing: ['shipped', 'cancelled'],
        shipped: ['delivered'],
      };
      if (!(allowedTransitions[current] || []).includes(String(nextStatus))) {
        throw new HttpsError('failed-precondition', `Invalid status transition from ${current} to ${nextStatus}.`);
      }
    }

    const updatePayload: Record<string, any> = {
      status: String(nextStatus),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (trackingCode) updatePayload.trackingCode = String(trackingCode).trim().slice(0, 100);
    if (nextStatus === 'cancelled') {
      updatePayload.cancelReason = String(note || 'Cancelled').slice(0, 300);
    } else if (note) {
      updatePayload.sellerNote = String(note).slice(0, 300);
    }

    tx.update(orderRef, updatePayload);

    // Restore stock when cancelled before shipment
    if (nextStatus === 'cancelled' && ['pending', 'confirmed', 'processing'].includes(current)) {
      const lines: any[] = Array.isArray(ord.itemsSnapshot) ? ord.itemsSnapshot : [];
      for (const line of lines) {
        if (!line.productId) continue;
        const pRef = db.collection('marketplaceListings').doc(String(line.productId));
        const pSnap = await tx.get(pRef);
        if (pSnap.exists) {
          const pData = pSnap.data()!;
          const restored = Number(pData.quantity || 0) + Number(line.quantity || 1);
          tx.update(pRef, {
            quantity: restored,
            soldCount: Math.max(0, Number(pData.soldCount || 0) - Number(line.quantity || 1)),
            status: pData.status === 'out_of_stock' ? 'active' : pData.status,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
        }
      }
    }

    if (nextStatus === 'delivered' && ord.storeId) {
      tx.update(db.collection('stores').doc(String(ord.storeId)), {
        totalSales: admin.firestore.FieldValue.increment(1),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  if (orderMeta) {
    const recipientId = actorUid === orderMeta.buyerId ? orderMeta.sellerId : orderMeta.buyerId;
    await createDeduplicatedNotification({
      recipientId: String(recipientId),
      actorId: actorUid,
      actorName: actorUid === orderMeta.buyerId ? orderMeta.buyerName : orderMeta.sellerName,
      actorAvatar: '',
      type: 'marketplace',
      title: `Order ${String(nextStatus).toUpperCase()}`,
      body: `Order #${String(orderId).slice(-6)} is now ${nextStatus}.`,
      linkUrl: actorUid === orderMeta.buyerId ? '/market?tab=seller' : '/market?tab=orders',
      dedupeKey: `order_${orderId}_${nextStatus}`,
    });
  }

  return { ok: true, status: nextStatus };
});

export const verifyOrRefundMarketplacePayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'finance_manager']);

  const { paymentId, decision, reason = '' } = request.data || {};
  if (!paymentId || !['paid', 'failed', 'refunded'].includes(String(decision))) {
    throw new HttpsError('invalid-argument', 'Valid paymentId and decision (paid|failed|refunded) required.');
  }

  const payRef = db.collection('payments').doc(String(paymentId));
  let payData: any = null;

  await db.runTransaction(async (tx) => {
    const paySnap = await tx.get(payRef);
    if (!paySnap.exists) throw new HttpsError('not-found', 'Payment record not found.');
    payData = paySnap.data()!;

    tx.update(payRef, {
      status: String(decision),
      providerVerified: decision === 'paid',
      refundReason: decision === 'refunded' ? String(reason || '').slice(0, 300) : '',
      reviewedBy: request.auth!.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (payData.orderId) {
      const orderRef = db.collection('orders').doc(String(payData.orderId));
      const orderUpdate: Record<string, any> = {
        paymentStatus: String(decision),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (decision === 'refunded') {
        orderUpdate.status = 'refunded';
      }
      tx.update(orderRef, orderUpdate);
    }
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: `marketplace_payment_${decision}`,
    targetType: 'payment',
    targetId: String(paymentId),
    summary: `Marketplace payment ${paymentId} marked ${decision}${reason ? ` (${reason})` : ''}.`,
  });

  if (payData?.buyerId) {
    await createDeduplicatedNotification({
      recipientId: String(payData.buyerId),
      actorId: request.auth.uid,
      actorName: 'BANA Finance',
      actorAvatar: '',
      type: 'marketplace',
      title: decision === 'paid' ? 'Payment Verified' : decision === 'refunded' ? 'Order Refunded' : 'Payment Failed',
      body: `Payment for order #${String(payData.orderId || '').slice(-6)} marked ${decision}.`,
      linkUrl: '/market?tab=orders',
      dedupeKey: `pay_${paymentId}_${decision}`,
    });
  }

  return { ok: true, status: decision };
});

// =========================================================================
// 14. Phase 08: Qualified Views, Finance Adjustments, Ad Delivery & Billing
// =========================================================================
export const recordQualifiedContentView = onCall(async (request) => {
  const viewerId = request.auth?.uid || '';
  const { contentType = 'reel', contentId, watchSeconds = 5, sessionKey = '' } = request.data || {};
  if (!contentId || !['reel', 'video', 'post'].includes(String(contentType))) {
    throw new HttpsError('invalid-argument', 'Valid contentType and contentId required.');
  }
  const watchSec = Math.max(0, Math.min(3600, Number(watchSeconds || 0)));
  if (viewerId) {
    await assertRateLimit(viewerId, 'qualified_view', 40);
  }

  const policy = await loadMonetizationPolicyServer();
  if (watchSec < policy.qualifiedViewMinSeconds) {
    return { counted: false, reason: 'below_watch_threshold' };
  }

  const hourBucket = new Date().toISOString().slice(0, 13);
  const viewerKey = viewerId || String(sessionKey || 'anon').slice(0, 48);
  if (!viewerKey || viewerKey === 'anon') {
    return { counted: false, reason: 'missing_session' };
  }
  const dedupeId = `${contentType}_${contentId}_${viewerKey}_${hourBucket}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 120);
  const eventRef = db.collection('earningEvents').doc(dedupeId);

  const colName = contentType === 'reel' ? 'reels' : 'posts';
  const contentRef = db.collection(colName).doc(String(contentId));

  let counted = false;
  await db.runTransaction(async (tx) => {
    const existingEvent = await tx.get(eventRef);
    if (existingEvent.exists) return;

    const contentSnap = await tx.get(contentRef);
    if (!contentSnap.exists) return;
    const contentData = contentSnap.data()!;
    const authorId = String(contentData.authorId || '');
    if (!authorId || authorId === viewerId) return; // Never monetize self-views

    const authorSnap = await tx.get(db.collection('users').doc(authorId));
    const author = authorSnap.data() || {};
    const isApprovedCreator = Boolean(author.isCreator) && author.accountStatus === 'active';

    // Estimated micro-share strictly from admin-configured policy pool share (only when approved creator)
    const grossViewPoolUsd = Number(policy.adPoolCpmUsd || 0) / 1000;
    const estimatedUsd =
      isApprovedCreator && policy.monetizationEnabled
        ? Number(((grossViewPoolUsd * policy.creatorSharePct) / 100).toFixed(6))
        : 0;

    tx.set(eventRef, {
      uid: authorId,
      contentType,
      contentId: String(contentId),
      contentTitle: String(contentData.title || contentData.caption || contentData.content || '').slice(0, 120),
      sourceType: contentType === 'reel' ? 'reels_ads' : 'video_ads',
      qualifiedViews: 1,
      watchSeconds: watchSec,
      estimatedAmountUsd: estimatedUsd,
      confirmedAmountUsd: 0,
      status: 'estimated',
      dedupeKey: dedupeId,
      period: new Date().toISOString().slice(0, 7),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.update(contentRef, {
      qualifiedViewsCount: admin.firestore.FieldValue.increment(1),
      totalWatchSeconds: admin.firestore.FieldValue.increment(watchSec),
    });
    counted = true;
  });

  return { counted };
});

export const adminAdjustOrConfirmCreatorEarnings = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'finance_manager']);

  const { targetUid, amountUsd, actionType = 'confirm', sourceType = 'ad_rev_share', period = '', reason = '' } =
    request.data || {};
  const amount = Number(amountUsd);
  if (!targetUid || Number.isNaN(amount) || amount === 0) {
    throw new HttpsError('invalid-argument', 'Valid targetUid and non-zero amountUsd required.');
  }
  if (!String(reason || '').trim()) {
    throw new HttpsError('invalid-argument', 'An audit reason is required for all financial entries.');
  }
  if (!['confirm', 'adjustment'].includes(String(actionType))) {
    throw new HttpsError('invalid-argument', 'actionType must be confirm or adjustment.');
  }

  const userSnap = await db.collection('users').doc(String(targetUid)).get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'Creator not found.');

  const cleanPeriod = String(period || new Date().toISOString().slice(0, 7)).slice(0, 30);
  const rounded = Number(amount.toFixed(2));
  const earningRef = db.collection('creatorEarnings').doc();

  await db.runTransaction(async (tx) => {
    tx.set(earningRef, {
      uid: String(targetUid),
      sourceType: actionType === 'adjustment' ? 'adjustment' : String(sourceType),
      amountUsd: rounded,
      status: actionType === 'adjustment' ? 'adjusted' : 'confirmed',
      period: cleanPeriod,
      description: String(reason).slice(0, 300),
      adjustmentReason: String(reason).slice(0, 300),
      adjustedBy: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    tx.set(db.collection('financialTransactions').doc(), {
      uid: String(targetUid),
      txType: actionType === 'adjustment' ? 'earning_adjustment' : 'earning_confirmed',
      direction: rounded >= 0 ? 'credit' : 'debit',
      amountUsd: Math.abs(rounded),
      currency: 'USD',
      referenceType: 'creatorEarning',
      referenceId: earningRef.id,
      description: String(reason).slice(0, 300),
      actorUid: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: actionType === 'adjustment' ? 'creator_balance_adjusted' : 'creator_earnings_confirmed',
    targetType: 'creatorEarning',
    targetId: earningRef.id,
    summary: `Issued ${rounded >= 0 ? '+' : ''}$${rounded.toFixed(2)} for ${targetUid}: ${String(reason).slice(0, 120)}`,
  });

  await createDeduplicatedNotification({
    recipientId: String(targetUid),
    actorId: request.auth.uid,
    actorName: 'BANA Creator Finance',
    actorAvatar: '',
    type: 'monetization',
    title: actionType === 'adjustment' ? 'Creator Balance Adjustment' : 'Creator Earnings Confirmed',
    body: `An entry of $${rounded.toFixed(2)} was posted to your Creator Studio ledger: ${String(reason).slice(0, 120)}`,
    linkUrl: '/creator-studio?tab=earnings',
    dedupeKey: `earning_${earningRef.id}`,
  });

  return { ok: true, earningId: earningRef.id, amountUsd: rounded };
});

export const trackAdDeliveryEvent = onCall(async (request) => {
  const viewerId = request.auth?.uid || '';
  const { campaignId, placement = 'home_feed', eventType = 'impression', sessionKey = '' } = request.data || {};
  if (!campaignId || !['impression', 'click'].includes(String(eventType))) {
    throw new HttpsError('invalid-argument', 'Valid campaignId and eventType required.');
  }
  if (!['home_feed', 'reels_feed', 'marketplace'].includes(String(placement))) {
    throw new HttpsError('invalid-argument', 'Invalid placement.');
  }
  if (viewerId) {
    await assertRateLimit(viewerId, `ad_${eventType}`, 60);
  }

  // Minor safeguard check
  if (viewerId) {
    const [uSnap, sSnap] = await Promise.all([
      db.collection('users').doc(viewerId).get(),
      db.collection('userSettings').doc(viewerId).get(),
    ]);
    const u = uSnap.data() || {};
    const s = sSnap.data() || {};
    const birthYear = Number(s.birthYear || 0);
    const isMinor = Boolean(u.isMinor) || (birthYear > 0 && new Date().getFullYear() - birthYear < 18);
    if (isMinor) {
      return { recorded: false, reason: 'minor_excluded' };
    }
  }

  const adSettSnap = await db.collection('advertisingSettings').doc('default').get();
  const adSett = adSettSnap.exists ? adSettSnap.data() || {} : {};
  if (adSett.adsEnabled === false) {
    return { recorded: false, reason: 'ads_disabled' };
  }

  const dayKey = new Date().toISOString().slice(0, 10);
  const viewerKey = viewerId || String(sessionKey || '').slice(0, 48);
  if (!viewerKey) {
    return { recorded: false, reason: 'missing_viewer_key' };
  }

  const targetCol = eventType === 'click' ? 'adClicks' : 'adImpressions';
  const docId = `${campaignId}_${placement}_${viewerKey}_${dayKey}_${eventType}`
    .replace(/[^a-zA-Z0-9_\-]/g, '_')
    .slice(0, 120);
  const eventRef = db.collection(targetCol).doc(docId);
  const campRef = db.collection('adCampaigns').doc(String(campaignId));

  let recorded = false;
  await db.runTransaction(async (tx) => {
    const [evSnap, campSnap] = await Promise.all([tx.get(eventRef), tx.get(campRef)]);
    if (!campSnap.exists) return;
    if (eventType === 'impression' && evSnap.exists) return; // Deduplicate impression per user/day/placement

    const camp = campSnap.data()!;
    if (camp.status !== 'active') return;
    if (camp.startDate && dayKey < String(camp.startDate)) return;
    if (camp.endDate && dayKey > String(camp.endDate)) return;

    const totalBudget = Number(camp.totalBudgetUsd || 0);
    const currentSpent = Number(camp.spentUsd || 0);
    const dailyBudget = Number(camp.dailyBudgetUsd || totalBudget);
    const currentDailySpent = camp.dailySpendDate === dayKey ? Number(camp.dailySpentUsd || 0) : 0;

    if (currentSpent >= totalBudget) {
      tx.update(campRef, { status: 'completed', updatedAt: admin.firestore.FieldValue.serverTimestamp() });
      return;
    }

    const baseUnitCharge =
      eventType === 'click'
        ? Number(adSett.defaultCpcUsd ?? 0.08)
        : Number(adSett.defaultCpmUsd ?? 2.5) / 1000;
    const remainingTotal = Math.max(0, totalBudget - currentSpent);
    const remainingDaily = Math.max(0, dailyBudget - currentDailySpent);
    const charge = Number(Math.min(baseUnitCharge, remainingTotal, remainingDaily).toFixed(4));

    const writeDocRef = eventType === 'click' ? db.collection('adClicks').doc() : eventRef;
    tx.set(writeDocRef, {
      campaignId: String(campaignId),
      advertiserId: String(camp.advertiserId || ''),
      placement: String(placement),
      viewerId: viewerId || 'guest',
      sessionKey: String(sessionKey || '').slice(0, 60),
      costChargedUsd: charge,
      dayKey,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    const nextSpent = Number((currentSpent + charge).toFixed(4));
    const nextDailySpent = Number((currentDailySpent + charge).toFixed(4));
    const nextStatus = nextSpent >= totalBudget ? 'completed' : 'active';

    const campUpdate: Record<string, any> = {
      spentUsd: nextSpent,
      dailySpendDate: dayKey,
      dailySpentUsd: nextDailySpent,
      status: nextStatus,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (eventType === 'impression') {
      campUpdate.impressions = admin.firestore.FieldValue.increment(1);
      if (!evSnap.exists) {
        campUpdate.reachCount = admin.firestore.FieldValue.increment(1);
      }
    } else {
      campUpdate.clicks = admin.firestore.FieldValue.increment(1);
    }
    tx.update(campRef, campUpdate);

    if (charge > 0 && camp.advertiserId) {
      tx.set(
        db.collection('advertisers').doc(String(camp.advertiserId)),
        {
          lifetimeSpendUsd: admin.firestore.FieldValue.increment(charge),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    recorded = true;
  });

  return { recorded };
});

export const reviewAdPayment = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'finance_manager']);

  const { paymentId, decision, note = '' } = request.data || {};
  if (!paymentId || !['paid', 'failed', 'refunded'].includes(String(decision))) {
    throw new HttpsError('invalid-argument', 'Valid paymentId and decision (paid|failed|refunded) required.');
  }

  const payRef = db.collection('adPayments').doc(String(paymentId));
  let advUid = '';
  let amount = 0;

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(payRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ad payment record not found.');
    const data = snap.data()!;
    advUid = String(data.advertiserId || '');
    amount = Number(data.amountUsd || 0);

    tx.update(payRef, {
      status: String(decision),
      providerVerified: decision === 'paid',
      reviewedBy: request.auth!.uid,
      note: String(note || '').slice(0, 300),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (decision === 'paid' && data.status !== 'paid' && advUid && amount > 0) {
      tx.set(
        db.collection('advertisers').doc(advUid),
        {
          walletBalanceUsd: admin.firestore.FieldValue.increment(amount),
          lifetimeDepositUsd: admin.firestore.FieldValue.increment(amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(db.collection('financialTransactions').doc(), {
        uid: advUid,
        txType: 'ad_deposit',
        direction: 'credit',
        amountUsd: amount,
        currency: 'USD',
        referenceType: 'adPayment',
        referenceId: String(paymentId),
        description: `Verified advertiser billing deposit ($${amount.toFixed(2)} via ${data.method})`,
        actorUid: request.auth!.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } else if (decision === 'refunded' && data.status === 'paid' && advUid && amount > 0) {
      tx.set(
        db.collection('advertisers').doc(advUid),
        {
          walletBalanceUsd: admin.firestore.FieldValue.increment(-amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
      tx.set(db.collection('financialTransactions').doc(), {
        uid: advUid,
        txType: 'ad_refund',
        direction: 'debit',
        amountUsd: amount,
        currency: 'USD',
        referenceType: 'adPayment',
        referenceId: String(paymentId),
        description: `Advertiser payment refunded: ${String(note || 'Finance review').slice(0, 200)}`,
        actorUid: request.auth!.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: `ad_payment_${decision}`,
    targetType: 'adPayment',
    targetId: String(paymentId),
    summary: `Ad payment ${paymentId} ($${amount.toFixed(2)}) marked ${decision}.`,
  });

  if (advUid) {
    await createDeduplicatedNotification({
      recipientId: advUid,
      actorId: request.auth.uid,
      actorName: 'BANA Ad Billing',
      actorAvatar: '',
      type: 'ad',
      title: decision === 'paid' ? 'Ad Billing Deposit Verified' : `Ad Payment ${String(decision).toUpperCase()}`,
      body: `Your $${amount.toFixed(2)} advertising deposit status is now ${decision}.`,
      linkUrl: '/advertise?tab=billing',
      dedupeKey: `ad_pay_${paymentId}_${decision}`,
    });
  }

  return { ok: true, status: decision };
});

// =========================================================================
// 15. Phase 09: Super Admin User, Content, Community & Financial Controls
// =========================================================================
export const adminManageUserStatus = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'admin', 'moderator']);

  const { targetUid, accountStatus, messagingRestricted, reason = '' } = request.data || {};
  if (!targetUid || typeof targetUid !== 'string') {
    throw new HttpsError('invalid-argument', 'Valid targetUid is required.');
  }
  if (targetUid === request.auth.uid) {
    throw new HttpsError('failed-precondition', 'You cannot suspend or ban your own admin account.');
  }

  const userRef = db.collection('users').doc(targetUid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) throw new HttpsError('not-found', 'User not found.');
  const targetUser = userSnap.data()!;

  const updates: Record<string, any> = {
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (accountStatus && ['active', 'suspended', 'banned'].includes(String(accountStatus))) {
    updates.accountStatus = String(accountStatus);
    updates.accountRestrictionNote =
      accountStatus === 'active' ? '' : String(reason || `Account set to ${accountStatus} by administration.`).slice(0, 400);
  }
  if (typeof messagingRestricted === 'boolean') {
    updates.messagingRestricted = messagingRestricted;
  }

  await userRef.update(updates);

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: 'admin_manage_user_status',
    targetType: 'user',
    targetId: targetUid,
    summary: `Updated @${targetUser.username || targetUid} (status=${updates.accountStatus || targetUser.accountStatus}, msgRestricted=${String(updates.messagingRestricted ?? targetUser.messagingRestricted)})${reason ? `: ${String(reason).slice(0, 120)}` : ''}`,
  });

  await createDeduplicatedNotification({
    recipientId: targetUid,
    actorId: request.auth.uid,
    actorName: 'BANA Trust & Safety',
    actorAvatar: '',
    type: 'monetization',
    title: updates.accountStatus === 'active' ? 'Account Standing Restored' : 'Account Standing Update',
    body: updates.accountRestrictionNote || 'Your BANA account standing was updated by moderation.',
    linkUrl: '/settings',
    dedupeKey: `acct_status_${targetUid}_${updates.accountStatus || 'msg'}_${Date.now()}`,
  });

  return { ok: true };
});

export const adminModerateContent = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'admin', 'moderator', 'content_manager']);

  const { collectionName, docId, action, reportId = '', reportCollection = 'reports', reason = '' } = request.data || {};
  const allowedCols = ['posts', 'reels', 'stories', 'comments', 'voiceComments', 'marketplaceListings', 'communities'];
  if (!allowedCols.includes(String(collectionName)) || !docId) {
    throw new HttpsError('invalid-argument', 'Valid collectionName and docId are required.');
  }
  if (!['remove', 'restore', 'delete'].includes(String(action))) {
    throw new HttpsError('invalid-argument', 'Action must be remove, restore, or delete.');
  }

  const ref = db.collection(String(collectionName)).doc(String(docId));
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Content item not found.');

  if (action === 'delete') {
    await ref.delete();
  } else {
    const nextStatus =
      action === 'remove'
        ? collectionName === 'communities'
          ? 'suspended'
          : 'removed'
        : collectionName === 'posts'
        ? 'published'
        : 'active';
    await ref.update({
      status: nextStatus,
      moderationReason: action === 'remove' ? String(reason || 'Removed by moderation').slice(0, 300) : '',
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  if (reportId && ['reports', 'marketplaceReports'].includes(String(reportCollection))) {
    await db
      .collection(String(reportCollection))
      .doc(String(reportId))
      .update({
        status: 'resolved',
        resolutionNote: String(reason || `Target ${action}d`).slice(0, 300),
        reviewedBy: request.auth.uid,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      })
      .catch(() => {});
  }

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: `moderate_${action}_${collectionName}`,
    targetType: String(collectionName),
    targetId: String(docId),
    summary: `Executed ${action} on ${collectionName}/${docId}${reason ? ` (${String(reason).slice(0, 120)})` : ''}`,
  });

  return { ok: true };
});

export const adminTransferCommunityOwnership = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'admin', 'moderator']);

  const { communityId, newOwnerUid, reason = '' } = request.data || {};
  if (!communityId || !newOwnerUid) {
    throw new HttpsError('invalid-argument', 'communityId and newOwnerUid are required.');
  }

  const commRef = db.collection('communities').doc(String(communityId));
  const userRef = db.collection('users').doc(String(newOwnerUid));
  let previousOwnerId = '';
  let communityName = '';

  await db.runTransaction(async (tx) => {
    const [commSnap, newOwnerSnap] = await Promise.all([tx.get(commRef), tx.get(userRef)]);
    if (!commSnap.exists) throw new HttpsError('not-found', 'Community not found.');
    if (!newOwnerSnap.exists) throw new HttpsError('not-found', 'New owner user account not found.');

    const comm = commSnap.data()!;
    const newOwner = newOwnerSnap.data()!;
    previousOwnerId = String(comm.creatorId || '');
    communityName = String(comm.name || communityId);

    tx.update(commRef, {
      creatorId: String(newOwnerUid),
      creatorName: String(newOwner.displayName || 'Owner'),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    if (previousOwnerId && previousOwnerId !== newOwnerUid) {
      const prevMemberRef = db.collection('communityMembers').doc(`${communityId}_${previousOwnerId}`);
      const prevSnap = await tx.get(prevMemberRef);
      if (prevSnap.exists) {
        tx.update(prevMemberRef, {
          role: 'admin',
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
    }

    const nextMemberRef = db.collection('communityMembers').doc(`${communityId}_${newOwnerUid}`);
    tx.set(
      nextMemberRef,
      {
        communityId: String(communityId),
        userId: String(newOwnerUid),
        userName: String(newOwner.displayName || ''),
        userUsername: String(newOwner.username || ''),
        userAvatar: String(newOwner.avatarUrl || ''),
        role: 'owner',
        status: 'active',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: 'transfer_community_ownership',
    targetType: 'communities',
    targetId: String(communityId),
    summary: `Transferred ownership of "${communityName}" from ${previousOwnerId} to ${newOwnerUid}${reason ? ` (${String(reason).slice(0, 120)})` : ''}`,
  });

  await createDeduplicatedNotification({
    recipientId: String(newOwnerUid),
    actorId: request.auth.uid,
    actorName: 'BANA Communities',
    actorAvatar: '',
    type: 'community',
    title: 'Community Ownership Assigned',
    body: `You are now the verified owner of "${communityName}".`,
    linkUrl: `/communities`,
    dedupeKey: `comm_owner_${communityId}_${newOwnerUid}_${Date.now()}`,
  });

  return { ok: true };
});

export const adminResolveFinancialRefund = onCall(async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Authentication required.');
  await assertAdminRole(request.auth.uid, request.auth.token.email, ['super_admin', 'finance_manager']);

  const { targetType, targetId, reason = '' } = request.data || {};
  if (!targetId || !['marketplace_order', 'ad_payment'].includes(String(targetType))) {
    throw new HttpsError('invalid-argument', 'Valid targetType (marketplace_order|ad_payment) and targetId required.');
  }

  const cleanReason = String(reason || 'Dispute settled & refunded by Finance Administration').slice(0, 300);

  if (targetType === 'marketplace_order') {
    const orderRef = db.collection('orders').doc(String(targetId));
    const payRef = db.collection('payments').doc(`pay_${targetId}`);
    let buyerId = '';
    let amount = 0;
    let currency = 'BDT';

    await db.runTransaction(async (tx) => {
      const [ordSnap, paySnap] = await Promise.all([tx.get(orderRef), tx.get(payRef)]);
      if (!ordSnap.exists) throw new HttpsError('not-found', 'Order not found.');
      const ord = ordSnap.data()!;
      buyerId = String(ord.buyerId || '');
      amount = Number(ord.totalAmount || 0);
      currency = String(ord.currency || 'BDT');

      tx.update(orderRef, {
        status: 'refunded',
        paymentStatus: 'refunded',
        cancelReason: cleanReason,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      if (paySnap.exists) {
        tx.update(payRef, {
          status: 'refunded',
          refundReason: cleanReason,
          reviewedBy: request.auth!.uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      }
      tx.set(db.collection('financialTransactions').doc(), {
        uid: buyerId || request.auth!.uid,
        txType: 'marketplace_refund',
        direction: 'debit',
        amountUsd: amount,
        currency,
        referenceType: 'order',
        referenceId: String(targetId),
        description: `Order #${String(targetId).slice(-8)} refunded (${cleanReason})`,
        actorUid: request.auth!.uid,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });

    await writeAuditLog({
      actorUid: request.auth.uid,
      actorEmail: request.auth.token.email,
      action: 'admin_marketplace_refund',
      targetType: 'orders',
      targetId: String(targetId),
      summary: `Settled dispute & issued refund for order ${targetId}: ${cleanReason}`,
    });
    return { ok: true };
  }

  // ad_payment refund
  const adPayRef = db.collection('adPayments').doc(String(targetId));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(adPayRef);
    if (!snap.exists) throw new HttpsError('not-found', 'Ad payment not found.');
    const ap = snap.data()!;
    const amount = Number(ap.amountUsd || 0);
    const advId = String(ap.advertiserId || '');

    tx.update(adPayRef, {
      status: 'refunded',
      note: cleanReason,
      reviewedBy: request.auth!.uid,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    if (ap.status === 'paid' && advId && amount > 0) {
      tx.set(
        db.collection('advertisers').doc(advId),
        {
          walletBalanceUsd: admin.firestore.FieldValue.increment(-amount),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }
    tx.set(db.collection('financialTransactions').doc(), {
      uid: advId || request.auth!.uid,
      txType: 'ad_refund',
      direction: 'debit',
      amountUsd: amount,
      currency: 'USD',
      referenceType: 'adPayment',
      referenceId: String(targetId),
      description: `Ad billing refunded (${cleanReason})`,
      actorUid: request.auth!.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  });

  await writeAuditLog({
    actorUid: request.auth.uid,
    actorEmail: request.auth.token.email,
    action: 'admin_ad_refund',
    targetType: 'adPayments',
    targetId: String(targetId),
    summary: `Refunded ad payment ${targetId}: ${cleanReason}`,
  });

  return { ok: true };
});


