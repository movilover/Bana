// Prompt 07/08 additions — seller applications, store gating, announcements, policy history.
// Requires the Firestore emulator:
//   firebase emulators:exec --only firestore "node tests/security/prompt07_08.rules.test.mjs"
// NOTE: written against the same harness as social.rules.test.mjs. It was NOT executed in the
// environment where it was authored (emulator download not possible there) — run it before release.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const testEnv = await initializeTestEnvironment({
  projectId: 'bana-p0708-rules-test',
  firestore: {
    rules,
    host: process.env.FIRESTORE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
    port: Number(process.env.FIRESTORE_EMULATOR_HOST?.split(':')[1] || 8080),
  },
});

const results = [];
async function runTest(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS: ${name}`); }
  catch (e) { results.push({ name, ok: false }); console.error(`FAIL: ${name}`, e); }
}
const user = (uid, extra = {}) => ({
  uid, username: `${uid}_x`, displayName: uid, isVerified: false, isCreator: false,
  accountStatus: 'active', followersCount: 0, followingCount: 0, createdAt: new Date(), ...extra,
});
const ctx = (uid) => testEnv.authenticatedContext(uid, { email_verified: true, email: `${uid}@t.io` }).firestore();
const app = (uid, extra = {}) => ({
  uid, username: `${uid}_x`, displayName: uid, storeName: 'My Shop', storeDescription: 'Handmade goods and more',
  district: 'Dhaka', productCategories: ['Fashion'], businessType: 'individual',
  acceptedSellerPolicy: true, status: 'pending', createdAt: ts(), updatedAt: ts(), ...extra,
});
const store = (uid) => ({
  ownerId: uid, ownerUsername: `${uid}_x`, ownerName: uid, name: 'My Shop', slug: 'my-shop', description: 'd',
  district: 'Dhaka', contactPreference: 'messenger', ratingAvg: 0, reviewsCount: 0, totalSales: 0,
  status: 'active', createdAt: ts(), updatedAt: ts(),
});

try {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    for (const u of ['seller', 'other', 'mod', 'fin', 'member', 'staff']) await d.doc(`users/${u}`).set(user(u));
    await d.doc('adminRoles/mod').set({ role: 'moderator' });
    await d.doc('adminRoles/fin').set({ role: 'finance_manager' });
    await d.doc('communities/g1').set({ name: 'G', privacy: 'public', creatorId: 'staff', status: 'active' });
    await d.doc('communityMembers/g1_staff').set({ communityId: 'g1', userId: 'staff', role: 'owner', status: 'active' });
    await d.doc('communityMembers/g1_member').set({ communityId: 'g1', userId: 'member', role: 'member', status: 'active' });
  });
  const seller = ctx('seller'), other = ctx('other'), mod = ctx('mod'), fin = ctx('fin'), member = ctx('member'), staff = ctx('staff');

  await runTest('cannot create a store without an approved seller application', async () => {
    await assertFails(seller.doc('stores/seller').set(store('seller')));
  });
  await runTest('user can submit own pending seller application', async () => {
    await assertSucceeds(seller.doc('sellerApplications/seller').set(app('seller')));
  });
  await runTest('user cannot self-approve or create an already-approved application', async () => {
    await assertFails(other.doc('sellerApplications/other').set(app('other', { status: 'approved' })));
    await assertFails(seller.doc('sellerApplications/seller').update({ status: 'approved', updatedAt: ts() }));
  });
  await runTest('user cannot apply on behalf of someone else', async () => {
    await assertFails(other.doc('sellerApplications/seller2').set(app('seller2')));
  });
  await runTest('store creation still blocked while application is pending', async () => {
    await assertFails(seller.doc('stores/seller').set(store('seller')));
  });
  await runTest('staff can approve; owner can then create store with own uid as id', async () => {
    await assertSucceeds(mod.doc('sellerApplications/seller').update({ status: 'approved', reviewedBy: 'mod', updatedAt: ts() }));
    await assertFails(seller.doc('stores/random-store-id').set(store('seller')));
    await assertSucceeds(seller.doc('stores/seller').set(store('seller')));
  });
  await runTest('a user cannot read another user\'s seller application', async () => {
    await assertFails(other.doc('sellerApplications/seller').get());
    await assertSucceeds(mod.doc('sellerApplications/seller').get());
  });
  await runTest('store counters can only move one step per write', async () => {
    await assertSucceeds(other.doc('stores/seller').update({ totalSales: 1, updatedAt: ts() }));
    await assertFails(other.doc('stores/seller').update({ totalSales: 500, updatedAt: ts() }));
  });
  await runTest('policy history: finance may append, nobody may edit or delete', async () => {
    const rec = { policyType: 'monetization', policyId: 'default', version: 1, changedBy: 'fin', changedFields: ['minFollowers'], before: {}, after: {}, reason: 'test', createdAt: ts() };
    await assertSucceeds(fin.doc('policyChangeHistory/h1').set(rec));
    await assertFails(fin.doc('policyChangeHistory/h1').update({ reason: 'tampered' }));
    await assertFails(fin.doc('policyChangeHistory/h1').delete());
    await assertFails(seller.doc('policyChangeHistory/h2').set({ ...rec, changedBy: 'seller' }));
  });
  await runTest('clients can never create payout documents (server-only, balance validated by Functions)', async () => {
    const payout = { uid: 'seller', amountUsd: 9999, method: 'bKash', status: 'pending', createdAt: ts() };
    await assertFails(seller.doc('payoutRequests/px1').set(payout));
    await assertFails(seller.doc('creatorPayouts/px1').set(payout));
  });
  await runTest('ordinary member cannot post an announcement or a pre-pinned post', async () => {
    const post = (extra) => ({ communityId: 'g1', authorId: 'member', kind: 'post', status: 'active', content: 'hi', createdAt: ts(), ...extra });
    await assertSucceeds(member.doc('communities/g1/posts/p1').set(post({})));
    await assertFails(member.doc('communities/g1/posts/p2').set(post({ kind: 'announcement' })));
    await assertFails(member.doc('communities/g1/posts/p3').set(post({ isPinned: true })));
  });
  await runTest('group owner can post an announcement', async () => {
    await assertSucceeds(staff.doc('communities/g1/posts/p4').set({ communityId: 'g1', authorId: 'staff', kind: 'announcement', status: 'active', content: 'news', createdAt: ts() }));
  });
  await runTest('community reports: one per reporter+target (duplicate rejected)', async () => {
    const r = { reporterId: 'member', targetType: 'community_post', targetId: 'p1', communityId: 'g1', reason: 'Spam or misleading', details: '', status: 'pending', createdAt: ts() };
    await assertSucceeds(member.doc('marketplaceReports/community_post_p1_member').set(r));
    await assertFails(member.doc('marketplaceReports/community_post_p1_member').set(r));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPrompt 07/08 rules: ${results.length - failed.length}/${results.length} passed.`);
  assert.equal(failed.length, 0);
} finally {
  await testEnv.cleanup();
}
