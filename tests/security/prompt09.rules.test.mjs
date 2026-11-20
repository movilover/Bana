// Prompt 09 — Super Admin Control Panel: RBAC scoping, audit-log schema, role-grant schema, alert state.
// Requires the Firestore emulator:
//   firebase emulators:exec --only firestore "node tests/security/prompt09.rules.test.mjs"
// NOTE: written against the same harness as prompt07_08.rules.test.mjs. It was NOT executed in the
// environment where it was authored (no network / emulator available) — run it before release.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import firebase from 'firebase/compat/app';
import 'firebase/compat/firestore';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';

const rules = fs.readFileSync(path.resolve('firestore.rules'), 'utf8');
const ts = () => firebase.firestore.FieldValue.serverTimestamp();
const testEnv = await initializeTestEnvironment({
  projectId: 'bana-p09-rules-test',
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
const ctx = (uid, email) => testEnv.authenticatedContext(uid, { email_verified: true, email: email || `${uid}@t.io` }).firestore();
const user = (uid) => ({
  uid, username: `${uid}_x`, displayName: uid, isVerified: false, isCreator: false,
  accountStatus: 'active', followersCount: 0, followingCount: 0, createdAt: new Date(),
});

try {
  await testEnv.withSecurityRulesDisabled(async (c) => {
    const d = c.firestore();
    for (const [uid, role] of [['mod', 'moderator'], ['sup', 'support_staff'], ['fin', 'finance_manager'], ['adm', 'admin'], ['ads', 'ad_manager']]) {
      await d.doc(`adminRoles/${uid}`).set({ uid, email: `${uid}@t.io`, role, assignedBy: 'super_1', createdAt: new Date() });
    }
    await d.doc('users/victim').set(user('victim'));
  });

  const mod = ctx('mod'), sup = ctx('sup'), fin = ctx('fin'), ads = ctx('ads'), adm = ctx('adm');
  const regular = ctx('victim');
  const superDb = ctx('super_1', 'omor.faruk.sojol.2@gmail.com');

  await runTest('moderator may change account standing fields only', async () => {
    await assertSucceeds(mod.doc('users/victim').update({ accountStatus: 'suspended', accountRestrictionNote: 'spam', updatedAt: ts() }));
    await assertFails(mod.doc('users/victim').update({ displayName: 'Hacked' }));
    await assertFails(mod.doc('users/victim').update({ isCreator: true }));
    await assertFails(mod.doc('users/victim').update({ followersCount: 99999 }));
  });
  await runTest('support_staff may review verification but not suspend accounts', async () => {
    await assertSucceeds(sup.doc('users/victim').update({ isVerified: true, verificationType: 'identity', updatedAt: ts() }));
    await assertFails(sup.doc('users/victim').update({ accountStatus: 'banned' }));
  });
  await runTest('finance_manager may toggle creator/quota flags but not account standing', async () => {
    await assertSucceeds(fin.doc('users/victim').update({ isCreator: true, updatedAt: ts() }));
    await assertFails(fin.doc('users/victim').update({ accountStatus: 'banned' }));
    await assertFails(fin.doc('users/victim').update({ isVerified: true }));
  });
  await runTest('ad_manager cannot edit user documents at all', async () => {
    await assertFails(ads.doc('users/victim').update({ accountStatus: 'suspended' }));
    await assertFails(ads.doc('users/victim').update({ isCreator: true }));
  });

  const log = (uid, extra = {}) => ({
    actorUid: uid, actorEmail: `${uid}@t.io`, actorRole: 'moderator', action: 'suspend_user',
    targetType: 'user', targetId: 'victim', summary: 'Suspended for spam', result: 'success', createdAt: ts(), ...extra,
  });
  await runTest('audit log: valid append succeeds, immutable afterwards', async () => {
    const ref = mod.collection('auditLogs').doc('a1');
    await assertSucceeds(ref.set(log('mod')));
    await assertFails(ref.update({ summary: 'tampered' }));
    await assertFails(ref.delete());
  });
  await runTest('audit log: rejects spoofed actor, unknown fields, bad result, oversize summary', async () => {
    await assertFails(mod.collection('auditLogs').doc('a2').set(log('sup')));
    await assertFails(mod.collection('auditLogs').doc('a3').set(log('mod', { password: 'x' })));
    await assertFails(mod.collection('auditLogs').doc('a4').set(log('mod', { result: 'maybe' })));
    await assertFails(mod.collection('auditLogs').doc('a5').set(log('mod', { summary: 'x'.repeat(501) })));
    await assertFails(regular.collection('auditLogs').doc('a6').set(log('victim')));
  });

  await runTest('adminRoles: only super admin, only known roles, no extra fields, no self-delete', async () => {
    const grant = (role, extra = {}) => ({ uid: 'newbie', email: 'n@t.io', role, assignedBy: 'super_1', createdAt: ts(), updatedAt: ts(), ...extra });
    await assertSucceeds(superDb.doc('adminRoles/newbie').set(grant('moderator')));
    await assertFails(superDb.doc('adminRoles/newbie2').set(grant('godmode', { uid: 'newbie2' })));
    await assertFails(superDb.doc('adminRoles/newbie3').set(grant('admin', { uid: 'newbie3', isOwner: true })));
    await assertFails(adm.doc('adminRoles/newbie4').set(grant('admin', { uid: 'newbie4', assignedBy: 'adm' })));
    await assertFails(superDb.doc('adminRoles/super_1').delete());
    await assertSucceeds(superDb.doc('adminRoles/newbie').delete());
  });

  await runTest('adminAlertState: owner staff only, schema-locked, no listing', async () => {
    const ack = (uid) => ({ uid, acknowledged: { reports: 3 }, updatedAt: ts() });
    await assertSucceeds(mod.doc('adminAlertState/mod').set(ack('mod')));
    await assertFails(mod.doc('adminAlertState/sup').set(ack('sup')));
    await assertFails(regular.doc('adminAlertState/victim').set(ack('victim')));
    await assertFails(mod.doc('adminAlertState/mod').set({ ...ack('mod'), extra: 1 }));
    await assertFails(mod.collection('adminAlertState').get());
    await assertSucceeds(mod.doc('adminAlertState/mod').get());
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nPrompt 09 rules: ${results.length - failed.length}/${results.length} passed.`);
  assert.equal(failed.length, 0);
} finally {
  await testEnv.cleanup();
}
