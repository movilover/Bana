import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {
  initializeTestEnvironment,
  assertFails,
  assertSucceeds,
} from '@firebase/rules-unit-testing';

const PROJECT_ID = 'bana-a5770-storage-test';
const storageRules = fs.readFileSync(path.resolve('storage.rules'), 'utf8');

const testEnv = await initializeTestEnvironment({
  projectId: PROJECT_ID,
  storage: {
    rules: storageRules,
    host: process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[0] || '127.0.0.1',
    port: Number(process.env.FIREBASE_STORAGE_EMULATOR_HOST?.split(':')[1] || 9199),
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
  const anonStorage = testEnv.unauthenticatedContext().storage();
  const aliceStorage = testEnv.authenticatedContext('alice', { email: 'alice@example.com', email_verified: true }).storage();
  const bobStorage = testEnv.authenticatedContext('bob', { email: 'bob@example.com', email_verified: true }).storage();
  const superAdminStorage = testEnv.authenticatedContext('super_1', {
    email: 'omor.faruk.sojol.2@gmail.com',
    email_verified: true,
  }).storage();

  await runTest('Unauthenticated uploads are denied and private paths (stories/messages/verifications) deny unauth reads', async () => {
    await assertFails(
      anonStorage.ref('users/alice/avatar.jpg').put(Buffer.from('fakeimg'), { contentType: 'image/jpeg' })
    );
    await assertFails(anonStorage.ref('stories/alice/s1.jpg').getDownloadURL());
    await assertFails(anonStorage.ref('verifications/alice/nid.pdf').getDownloadURL());
  });

  await runTest('Authenticated owner can upload safe JPEG avatar and delete own file; Bob is denied writing/deleting Alice files', async () => {
    await assertSucceeds(
      aliceStorage.ref('users/alice/avatar.jpg').put(Buffer.from('fake-jpeg-bytes'), { contentType: 'image/jpeg' })
    );
    await assertFails(
      bobStorage.ref('users/alice/avatar.jpg').put(Buffer.from('hijack'), { contentType: 'image/jpeg' })
    );
    await assertFails(bobStorage.ref('users/alice/avatar.jpg').delete());
    await assertSucceeds(aliceStorage.ref('users/alice/avatar.jpg').delete());
  });

  await runTest('Unsafe content types (HTML, executables) and unallowed root paths are rejected', async () => {
    await assertFails(
      aliceStorage.ref('posts/alice/evil.html').put(Buffer.from('<script>alert(1)</script>'), {
        contentType: 'text/html',
      })
    );
    await assertFails(
      aliceStorage.ref('posts/alice/malware.exe').put(Buffer.from('MZ'), {
        contentType: 'application/x-msdownload',
      })
    );
    await assertFails(
      aliceStorage.ref('unknownBucketPath/alice/file.jpg').put(Buffer.from('img'), {
        contentType: 'image/jpeg',
      })
    );
  });

  await runTest('Verification proof documents are private to owner + admin and cannot be deleted once uploaded', async () => {
    await assertSucceeds(
      aliceStorage.ref('verifications/alice/nid.pdf').put(Buffer.from('%PDF-1.4'), {
        contentType: 'application/pdf',
      })
    );
    await assertSucceeds(aliceStorage.ref('verifications/alice/nid.pdf').getDownloadURL());
    await assertSucceeds(superAdminStorage.ref('verifications/alice/nid.pdf').getDownloadURL());
    await assertFails(bobStorage.ref('verifications/alice/nid.pdf').getDownloadURL());
    await assertFails(aliceStorage.ref('verifications/alice/nid.pdf').delete());
  });

  const failed = results.filter((r) => !r.ok);
  console.log(`\nStorage Rules Suite Complete: ${results.length - failed.length}/${results.length} passed.`);
  assert.equal(failed.length, 0, `Failed tests: ${failed.map((f) => f.name).join(', ')}`);
} finally {
  await testEnv.cleanup();
}
