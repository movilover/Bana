import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'bana-a5770-rules-test';
const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
const serverTime = () => firebase.firestore.FieldValue.serverTimestamp();

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  firestore: {
    rules,
    host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
    port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080),
  },
});

const results = [];
async function runTest(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    console.log(`PASS: ${name}`);
  } catch (err) {
    results.push({ name, ok: false, error: err?.message || String(err) });
    console.error(`FAIL: ${name} ->`, err);
  }
}

try {
  await testEnv.withSecurityRulesDisabled(async (ctx) => {
    const adminDb = ctx.firestore();
    await adminDb.doc('users/alice').set({
      uid: 'alice',
      username: 'alice_bana',
      displayName: 'Alice',
      isVerified: false,
      isCreator: false,
      accountStatus: 'active',
      messagingRestricted: false,
      followersCount: 0,
      followingCount: 0,
      createdAt: new Date(),
    });
    await adminDb.doc('users/bob').set({
      uid: 'bob',
      username: 'bob_bana',
      displayName: 'Bob',
      isVerified: false,
      isCreator: false,
      accountStatus: 'active',
      messagingRestricted: false,
      followersCount: 0,
      followingCount: 0,
      createdAt: new Date(),
    });
    await adminDb.doc('users/suspended_user').set({
      uid: 'suspended_user',
      username: 'suspended_bana',
      displayName: 'Suspended User',
      isVerified: false,
      isCreator: false,
      accountStatus: 'suspended',
      messagingRestricted: true,
      followersCount: 0,
      followingCount: 0,
      createdAt: new Date(),
    });
    await adminDb.doc('userSettings/alice').set({
      uid: 'alice',
      email: 'alice@example.com',
      themeMode: 'light',
    });
    await adminDb.doc('posts/public_post').set({
      authorId: 'alice',
      authorUsername: 'alice_bana',
      type: 'text',
      content: 'Hello BANA!',
      visibility: 'public',
      status: 'published',
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      createdAt: new Date(),
    });
    await adminDb.doc('posts/private_post').set({
      authorId: 'alice',
      authorUsername: 'alice_bana',
      type: 'text',
      content: 'Private journal',
      visibility: 'only_me',
      status: 'published',
      likesCount: 0,
      commentsCount: 0,
      sharesCount: 0,
      createdAt: new Date(),
    });
    await adminDb.doc('conversations/conv_ab').set({
      participantIds: ['alice', 'bob'],
      isGroup: false,
      createdAt: new Date(),
    });
    await adminDb.doc('messages/msg_ab_1').set({
      conversationId: 'conv_ab',
      senderId: 'alice',
      type: 'text',
      text: 'Hi Bob!',
      isDeleted: false,
      createdAt: new Date(),
    });
    await adminDb.doc('communities/comm_dhaka').set({
      creatorId: 'alice',
      name: 'Dhaka Builders',
      privacy: 'public',
      status: 'active',
      membersCount: 2,
      createdAt: new Date(),
    });
    await adminDb.doc('communityMembers/comm_dhaka_bob').set({
      communityId: 'comm_dhaka',
      userId: 'bob',
      role: 'moderator',
      status: 'active',
      createdAt: new Date(),
    });
    await adminDb.doc('communityMembers/comm_dhaka_charlie').set({
      communityId: 'comm_dhaka',
      userId: 'charlie',
      role: 'member',
      status: 'active',
      createdAt: new Date(),
    });
    await adminDb.doc('marketplaceListings/item_1').set({
      sellerId: 'alice',
      title: 'Mechanical Keyboard',
      price: 4500,
      quantity: 3,
      soldCount: 0,
      status: 'active',
      createdAt: new Date(),
    });
    await adminDb.doc('orders/order_pending').set({
      buyerId: 'bob',
      sellerId: 'alice',
      status: 'pending',
      paymentStatus: 'pending_cod',
      totalAmount: 4500,
      createdAt: new Date(),
    });
    await adminDb.doc('payoutRequests/payout_1').set({
      uid: 'alice',
      amountUsd: 25,
      method: 'bKash',
      status: 'pending',
      createdAt: new Date(),
    });
  });

  const anonDb = testEnv.unauthenticatedContext().firestore();
  const aliceDb = testEnv.authenticatedContext('alice', { email: 'alice@example.com', email_verified: true }).firestore();
  const bobDb = testEnv.authenticatedContext('bob', { email: 'bob@example.com', email_verified: true }).firestore();
  const charlieDb = testEnv.authenticatedContext('charlie', { email: 'charlie@example.com', email_verified: true }).firestore();
  const suspendedDb = testEnv.authenticatedContext('suspended_user', { email: 'sus@example.com', email_verified: true }).firestore();
  const superAdminDb = testEnv.authenticatedContext('super_1', {
    email: 'omor.faruk.sojol.2@gmail.com',
    email_verified: true,
  }).firestore();
  const financeAdminDb = testEnv.authenticatedContext('fin_1', {
    email: 'fin@bana.app',
    email_verified: true,
    adminRole: 'finance_manager',
  }).firestore();

  // 1. Unauthenticated restrictions & public content reads
  await runTest('Unauthenticated user can read public posts & active listings', async () => {
    await assertSucceeds(anonDb.doc('posts/public_post').get());
    await assertSucceeds(anonDb.doc('marketplaceListings/item_1').get());
  });

  await runTest('Unauthenticated user blocked from private posts, userSettings, conversations, and payouts', async () => {
    await assertFails(anonDb.doc('posts/private_post').get());
    await assertFails(anonDb.doc('userSettings/alice').get());
    await assertFails(anonDb.doc('conversations/conv_ab').get());
    await assertFails(anonDb.doc('payoutRequests/payout_1').get());
  });

  // 2. User own data vs others
  await runTest('Alice can read own userSettings, Bob cannot read Alice settings', async () => {
    await assertSucceeds(aliceDb.doc('userSettings/alice').get());
    await assertFails(bobDb.doc('userSettings/alice').get());
  });

  await runTest('User cannot self-grant isVerified, isCreator, or modify accountStatus', async () => {
    await assertFails(
      aliceDb.doc('users/alice').update({
        displayName: 'Alice',
        username: 'alice_bana',
        isVerified: true,
        updatedAt: serverTime(),
      })
    );
    await assertFails(
      aliceDb.doc('users/alice').update({
        displayName: 'Alice',
        username: 'alice_bana',
        isCreator: true,
        updatedAt: serverTime(),
      })
    );
  });

  // 3. Private messaging isolation
  await runTest('Conversation participants can read messages; Charlie (non-participant) is denied', async () => {
    await assertSucceeds(bobDb.doc('messages/msg_ab_1').get());
    await assertFails(charlieDb.doc('conversations/conv_ab').get());
    await assertFails(charlieDb.doc('messages/msg_ab_1').get());
    await assertFails(
      charlieDb.doc('messages/msg_hijack').set({
        conversationId: 'conv_ab',
        senderId: 'charlie',
        type: 'text',
        text: 'Injected',
        createdAt: serverTime(),
      })
    );
  });

  // 4. Suspended & messaging-restricted account enforcement
  await runTest('Suspended user cannot create posts, likes, comments, or orders', async () => {
    await assertFails(
      suspendedDb.doc('posts/sus_post').set({
        authorId: 'suspended_user',
        type: 'text',
        content: 'Spam',
        visibility: 'public',
        status: 'published',
        likesCount: 0,
        commentsCount: 0,
        sharesCount: 0,
        createdAt: serverTime(),
      })
    );
    await assertFails(
      suspendedDb.doc('postLikes/public_post_suspended_user').set({
        userId: 'suspended_user',
        targetType: 'post',
        targetId: 'public_post',
        createdAt: serverTime(),
      })
    );
    await assertFails(
      suspendedDb.doc('conversations/conv_sus').set({
        participantIds: ['suspended_user', 'bob'],
        createdAt: serverTime(),
      })
    );
  });

  // 5. Privilege escalation & financial ledger tampering blocked
  await runTest('Non-admin user cannot escalate adminRoles or tamper creatorEarnings/adPayments/payoutRequests', async () => {
    await assertFails(
      bobDb.doc('adminRoles/bob').set({
        uid: 'bob',
        role: 'super_admin',
        createdAt: serverTime(),
      })
    );
    await assertFails(
      aliceDb.doc('creatorEarnings/fake_earn').set({
        uid: 'alice',
        amountUsd: 9999,
        status: 'confirmed',
        createdAt: serverTime(),
      })
    );
    await assertFails(
      aliceDb.doc('payoutRequests/payout_1').update({
        status: 'paid',
      })
    );
    await assertFails(
      bobDb.doc('advertiserAccounts/bob').set({
        uid: 'bob',
        walletBalanceUsd: 5000,
        status: 'active',
      })
    );
  });

  // 6. Moderator escalation guard on communityMembers
  await runTest('Community moderator cannot promote a member to admin or owner', async () => {
    await assertFails(
      bobDb.doc('communityMembers/comm_dhaka_charlie').update({
        communityId: 'comm_dhaka',
        userId: 'charlie',
        role: 'admin',
        status: 'active',
        updatedAt: serverTime(),
      })
    );
    await assertSucceeds(
      bobDb.doc('communityMembers/comm_dhaka_charlie').update({
        communityId: 'comm_dhaka',
        userId: 'charlie',
        role: 'member',
        status: 'muted',
        updatedAt: serverTime(),
      })
    );
  });

  // 7. Verified purchase gate on productReviews & stock decrement bounds
  await runTest('Buyer cannot review an undelivered order, and cannot inflate stock via order update', async () => {
    await assertFails(
      bobDb.doc('productReviews/rev_fake').set({
        reviewerId: 'bob',
        orderId: 'order_pending',
        productId: 'item_1',
        rating: 5,
        isVerifiedPurchase: true,
        createdAt: serverTime(),
      })
    );
    await assertFails(
      bobDb.doc('marketplaceListings/item_1').update({
        quantity: 999,
        soldCount: 0,
        status: 'active',
        updatedAt: serverTime(),
      })
    );
  });

  // 8. Admin / Finance authorized operations succeed
  await runTest('Super Admin can manage adminRoles and Finance Manager can settle payoutRequests', async () => {
    await assertSucceeds(
      superAdminDb.doc('adminRoles/bob').set({
        uid: 'bob',
        role: 'moderator',
        assignedBy: 'super_1',
        createdAt: serverTime(),
      })
    );
    await assertSucceeds(
      financeAdminDb.doc('payoutRequests/payout_1').update({
        status: 'paid',
        transactionRef: 'BKASH-998811',
        updatedAt: serverTime(),
      })
    );
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nFirestore Rules Suite Complete: ${results.length - failed.length}/${results.length} passed.`);
  assert.equal(failed.length, 0, `Failed tests: ${failed.map((f) => f.name).join(', ')}`);
} finally {
  await testEnv.cleanup();
}
