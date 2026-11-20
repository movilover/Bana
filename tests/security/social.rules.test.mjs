// Prompt 06 — social graph security rules. Requires the Firestore emulator:
//   firebase emulators:exec --only firestore "node tests/security/social.rules.test.mjs"
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const testEnv = await initializeTestEnvironment({
  projectId: 'bana-social-rules-test',
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

try {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    for (const u of ['alice', 'bob', 'carol']) await d.doc(`users/${u}`).set(user(u));
    await d.doc('users/closed').set(user('closed', { whoCanFriendRequest: 'nobody' }));
  });
  const alice = ctx('alice'), bob = ctx('bob'), carol = ctx('carol');

  await runTest('cannot create a friendship without an accepted request', async () => {
    await assertFails(alice.doc('friendships/alice_bob').set({ participants: ['alice', 'bob'], createdAt: ts() }));
  });
  await runTest('sender cannot accept own friend request', async () => {
    await assertSucceeds(alice.doc('friendRequests/alice_bob').set({ fromUid: 'alice', toUid: 'bob', status: 'pending', createdAt: ts(), updatedAt: ts() }));
    await assertFails(alice.doc('friendRequests/alice_bob').update({ status: 'accepted', updatedAt: ts() }));
  });
  await runTest('recipient accepts, then friendship (canonical id) succeeds', async () => {
    await assertSucceeds(bob.doc('friendRequests/alice_bob').update({ status: 'accepted', updatedAt: ts() }));
    await assertSucceeds(bob.doc('friendships/alice_bob').set({ participants: ['alice', 'bob'], createdAt: ts() }));
  });
  await runTest('friend request id must be from_to (no spoofed ids)', async () => {
    await assertFails(alice.doc('friendRequests/carol_bob').set({ fromUid: 'alice', toUid: 'bob', status: 'pending', createdAt: ts(), updatedAt: ts() }));
  });
  await runTest('friend request to user with policy nobody is rejected by backend', async () => {
    await assertFails(alice.doc('friendRequests/alice_closed').set({ fromUid: 'alice', toUid: 'closed', status: 'pending', createdAt: ts(), updatedAt: ts() }));
  });
  await runTest('duplicate follow records via alternate ids are rejected', async () => {
    await assertFails(alice.doc('userFollows/random_id').set({ followerId: 'alice', followingId: 'carol', createdAt: ts() }));
    await assertSucceeds(alice.doc('userFollows/alice_carol').set({ followerId: 'alice', followingId: 'carol', createdAt: ts() }));
  });
  await runTest('block id must be blocker_blocked; cannot create blocks between other users', async () => {
    await assertFails(alice.doc('userBlocks/bob_carol').set({ blockerId: 'alice', blockedUid: 'carol', createdAt: ts() }));
    await assertSucceeds(carol.doc('userBlocks/carol_alice').set({ blockerId: 'carol', blockedUid: 'alice', createdAt: ts() }));
  });
  await runTest('blocked user cannot follow or friend-request the blocker', async () => {
    await assertSucceeds(alice.doc('userFollows/alice_carol').delete());
    await assertFails(alice.doc('userFollows/alice_carol').set({ followerId: 'alice', followingId: 'carol', createdAt: ts() }));
    await assertFails(alice.doc('friendRequests/alice_carol').set({ fromUid: 'alice', toUid: 'carol', status: 'pending', createdAt: ts(), updatedAt: ts() }));
  });
  await runTest('blocked user cannot open a 1:1 conversation', async () => {
    await assertFails(alice.doc('conversations/c1').set({ participantIds: ['alice', 'carol'], isGroup: false, createdAt: ts() }));
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nSocial rules: ${results.length - failed.length}/${results.length} passed.`);
  assert.equal(failed.length, 0);
} finally {
  await testEnv.cleanup();
}
