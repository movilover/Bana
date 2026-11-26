// node --experimental-strip-types --test tests/verification/friend-suggestions.logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SUGGESTION_CONFIG, normalizeSuggestionConfig, pickFeedSlots, exclusionReason, scoreCandidate, locationsMatch, dedupeByUid, SIGNAL_KEYS,
} from '../../src/lib/friendSuggestionsCore.ts';

const cfg = () => normalizeSuggestionConfig({});
const sig = (o = {}) => ({ mutualCount: 0, sharedCommunities: 0, sharedInterests: [], sameLocation: false, followsYou: false, recentlyJoined: false, ...o });
const ctx = (o = {}) => ({
  myUid: 'me', friends: new Set(), outgoingPending: new Set(), incomingPending: new Set(), blockedByMe: new Set(), dismissed: new Set(), ...o,
});
const user = (o = {}) => ({ uid: 'u1', accountStatus: 'active', ...o });

test('exclusions: self, friends, pending (both directions), blocked, dismissed', () => {
  assert.equal(exclusionReason(user({ uid: 'me' }), ctx(), sig()), 'self');
  assert.equal(exclusionReason(user(), ctx({ friends: new Set(['u1']) }), sig()), 'friend');
  assert.equal(exclusionReason(user(), ctx({ outgoingPending: new Set(['u1']) }), sig()), 'outgoing_pending');
  assert.equal(exclusionReason(user(), ctx({ incomingPending: new Set(['u1']) }), sig()), 'incoming_pending');
  assert.equal(exclusionReason(user(), ctx({ blockedByMe: new Set(['u1']) }), sig()), 'blocked');
  assert.equal(exclusionReason(user(), ctx({ dismissed: new Set(['u1']) }), sig()), 'dismissed');
  assert.equal(exclusionReason(user(), ctx(), sig()), null);
});

test('privacy: opted-out, inactive/banned and "nobody" users are never suggested', () => {
  assert.equal(exclusionReason(user({ suggestionsOptOut: true }), ctx(), sig()), 'opted_out');
  assert.equal(exclusionReason(user({ accountStatus: 'banned' }), ctx(), sig()), 'inactive');
  assert.equal(exclusionReason(user({ accountStatus: undefined }), ctx(), sig()), 'inactive');
  assert.equal(exclusionReason(user({ whoCanFriendRequest: 'nobody' }), ctx(), sig({ mutualCount: 5 })), 'not_accepting_requests');
});

test('never suggest someone whose request policy would reject us', () => {
  assert.equal(exclusionReason(user({ whoCanFriendRequest: 'followers' }), ctx(), sig()), 'requires_follower');
  assert.equal(exclusionReason(user({ whoCanFriendRequest: 'followers' }), ctx(), sig({ followsYou: true })), null);
  assert.equal(exclusionReason(user({ whoCanFriendRequest: 'friends_of_friends' }), ctx(), sig()), 'requires_mutual');
  assert.equal(exclusionReason(user({ whoCanFriendRequest: 'friends_of_friends' }), ctx(), sig({ mutualCount: 1 })), null);
});

test('scoring uses configurable weights; more mutual friends rank higher', () => {
  const c = cfg();
  const a = scoreCandidate(user(), sig({ mutualCount: 3 }), c);
  const b = scoreCandidate(user(), sig({ mutualCount: 1 }), c);
  assert.ok(a.score > b.score);
  const heavy = { ...c, weights: { ...c.weights, sharedInterests: 100, mutualFriends: 1 } };
  const interests = scoreCandidate(user(), sig({ sharedInterests: ['Travel'] }), heavy);
  const mutual = scoreCandidate(user(), sig({ mutualCount: 1 }), heavy);
  assert.ok(interests.score > mutual.score, 'changing weights changes ranking');
});

test('disabled signals contribute nothing and cannot qualify a candidate', () => {
  const c = cfg();
  const off = { ...c, signals: { ...c.signals, mutualFriends: false } };
  const r = scoreCandidate(user(), sig({ mutualCount: 9 }), off);
  assert.equal(r.qualifies, false);
  assert.equal(r.score, 0);
  const zeroW = { ...c, weights: { ...c.weights, mutualFriends: 0 } };
  assert.equal(scoreCandidate(user(), sig({ mutualCount: 9 }), zeroW).qualifies, false);
});

test('verified / popularity only boost — they never create a suggestion by themselves', () => {
  const r = scoreCandidate(user({ isVerified: true, followersCount: 100000 }), sig(), cfg());
  assert.equal(r.qualifies, false);
  assert.equal(r.score, 0);
  const withSignal = scoreCandidate(user({ isVerified: true, followersCount: 100000 }), sig({ mutualCount: 1 }), cfg());
  const without = scoreCandidate(user(), sig({ mutualCount: 1 }), cfg());
  assert.ok(withSignal.score > without.score);
});

test('reason text reflects the strongest qualifying signal', () => {
  assert.equal(scoreCandidate(user(), sig({ mutualCount: 2 }), cfg()).reason, '2 mutual friends');
  assert.equal(scoreCandidate(user(), sig({ mutualCount: 1 }), cfg()).reason, '1 mutual friend');
  assert.equal(scoreCandidate(user(), sig({ followsYou: true }), cfg()).reason, 'Follows you');
  assert.equal(scoreCandidate(user(), sig({ sharedInterests: ['Travel'] }), cfg()).reason, 'Shares Travel');
});

test('location is matched only when both sides share it publicly', () => {
  assert.equal(locationsMatch({ uid: 'a', location: 'Dhaka' }, { uid: 'b', location: ' dhaka ' }), true);
  assert.equal(locationsMatch({ uid: 'a', location: 'Dhaka' }, { uid: 'b', location: 'Dhaka', showLocation: false }), false);
  assert.equal(locationsMatch({ uid: 'a', location: 'Dhaka', showLocation: false }, { uid: 'b', location: 'Dhaka' }), false);
  assert.equal(locationsMatch({ uid: 'a' }, { uid: 'b', location: 'Dhaka' }), false);
});

test('feed placement: not after every post, honours first/every/max', () => {
  const c = cfg(); // first after 4, every 10, max 3
  assert.deepEqual(pickFeedSlots(40, c), [3, 13, 23]);
  assert.deepEqual(pickFeedSlots(3, c), []); // short feed → no suggestions
  assert.deepEqual(pickFeedSlots(10, c), [3]);
  assert.deepEqual(pickFeedSlots(40, { ...c, feedEnabled: false }), []);
  assert.deepEqual(pickFeedSlots(40, { ...c, enabled: false }), []);
  assert.deepEqual(pickFeedSlots(40, { ...c, maxSlots: 0 }), []);
  const slots = pickFeedSlots(100, { ...c, feedEveryN: 3, maxSlots: 10 });
  for (let i = 1; i < slots.length; i++) assert.ok(slots[i] - slots[i - 1] >= 3, 'never back-to-back');
});

test('config normalization clamps unsafe values and fills gaps', () => {
  const n = normalizeSuggestionConfig({ feedEveryN: 0, cardsPerSlot: 999, maxSlots: -4, weights: { mutualFriends: 5000, sameLocation: 'x' }, signals: { followsYou: false } });
  assert.equal(n.feedEveryN, 3);
  assert.equal(n.cardsPerSlot, 12);
  assert.equal(n.maxSlots, 0);
  assert.equal(n.weights.mutualFriends, 100);
  assert.equal(n.weights.sameLocation, DEFAULT_SUGGESTION_CONFIG.weights.sameLocation);
  assert.equal(n.signals.followsYou, false);
  assert.equal(n.signals.mutualFriends, true);
  for (const k of SIGNAL_KEYS) assert.ok(Number.isInteger(n.weights[k]));
  assert.deepEqual(normalizeSuggestionConfig(null).weights, DEFAULT_SUGGESTION_CONFIG.weights);
  assert.equal(normalizeSuggestionConfig({ enabled: false }).enabled, false);
});

test('dedupe keeps the highest-ranked entry and caps length', () => {
  const items = [{ user: { uid: 'a' }, n: 1 }, { user: { uid: 'b' }, n: 2 }, { user: { uid: 'a' }, n: 3 }, { user: { uid: 'c' }, n: 4 }];
  assert.deepEqual(dedupeByUid(items, 10).map((i) => i.user.uid), ['a', 'b', 'c']);
  assert.equal(dedupeByUid(items, 2).length, 2);
  assert.equal(dedupeByUid(items, 10)[0].n, 1);
});

test('end-to-end ranking over a small synthetic graph (test fixtures only)', () => {
  const c = cfg();
  const c1 = ctx({ friends: new Set(['f1']), blockedByMe: new Set(['blocked']), dismissed: new Set(['dis']), outgoingPending: new Set(['pend']) });
  const pool = [
    [user({ uid: 'f1' }), sig({ mutualCount: 4 })], [user({ uid: 'blocked' }), sig({ mutualCount: 4 })], [user({ uid: 'dis' }), sig({ mutualCount: 4 })],
    [user({ uid: 'pend' }), sig({ mutualCount: 4 })], [user({ uid: 'optout', suggestionsOptOut: true }), sig({ mutualCount: 4 })],
    [user({ uid: 'good1' }), sig({ mutualCount: 3 })], [user({ uid: 'good2' }), sig({ sharedInterests: ['Travel'] })], [user({ uid: 'nosignal' }), sig()],
  ];
  const out = pool
    .filter(([u, s]) => !exclusionReason(u, c1, s))
    .map(([u, s]) => ({ user: u, ...scoreCandidate(u, s, c) }))
    .filter((r) => r.qualifies)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.user.uid);
  assert.deepEqual(out, ['good1', 'good2']);
});

test('privacy: private accounts are only suggested with a real connection signal (mutual friend or follows you)', () => {
  assert.equal(exclusionReason(user({ isPrivateAccount: true }), ctx(), sig({ mutualCount: 0, followsYou: false })), 'private_account');
  assert.equal(exclusionReason(user({ isPrivateAccount: true }), ctx(), sig({ mutualCount: 2 })), null);
  assert.equal(exclusionReason(user({ isPrivateAccount: true }), ctx(), sig({ followsYou: true })), null);
  assert.equal(exclusionReason(user({ isPrivateAccount: false }), ctx(), sig()), null);
});
