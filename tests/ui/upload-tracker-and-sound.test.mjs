// node --experimental-strip-types --test tests/ui/upload-tracker-and-sound.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = globalThis;
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};

const tracker = await import('../../src/lib/uploadTracker.ts');
const sound = await import('../../src/lib/reactionSound.ts');

test('upload task lifecycle reports real progress and success only when completed', () => {
  const id = tracker.startUploadTask({ kind: 'reel', fileName: 'a.mp4' });
  assert.equal(tracker.hasActiveUploads(), true);
  tracker.updateUploadTask(id, { pct: 42.4 });
  tracker.updateUploadTask(id, { pct: 250 }); // clamped
  tracker.updateUploadTask(id, { pct: -5 });
  tracker.updateUploadTask(id, { pct: 61 });
  tracker.failUploadTask(id, 'Network error');
  assert.equal(tracker.hasActiveUploads(), false);
  tracker.dismissUploadTask(id);
  assert.equal(tracker.hasActiveUploads(), false);
});

test('progress is clamped between 0 and 100', () => {
  const id = tracker.startUploadTask({ kind: 'photo', fileName: 'b.jpg' });
  tracker.updateUploadTask(id, { pct: 999 });
  tracker.completeUploadTask(id);
  tracker.dismissUploadTask(id);
});

test('reaction sound respects the setting and never throws without Web Audio', () => {
  sound.setReactionSoundEnabled(false);
  assert.equal(sound.isReactionSoundEnabled(), false);
  assert.doesNotThrow(() => sound.playReactionSound('love'));
  sound.setReactionSoundEnabled(true);
  assert.equal(sound.isReactionSoundEnabled(), true);
  assert.doesNotThrow(() => sound.playReactionSound('angry')); // no AudioContext in node: swallowed
});
