// Pure-logic tests for Paid Profile Verification (no Firebase needed).
//   node --experimental-strip-types --test tests/verification/paid-verification.logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTransactionId, buildTransactionKey, normalizeSenderNumber, validateSubmission,
  resolveUserState, canSubmitNewClaim, normalizeConfig, formatMoney, maskNumber,
} from '../../src/lib/paidVerificationCore.ts';

// Test fixture only — the app itself contains no hard-coded fee or number.
const cfg = normalizeConfig({
  enabled: true, feeAmount: 500, currency: 'BDT',
  methods: {
    bkash: { enabled: true, number: '01700000000', accountType: 'personal' },
    nagad: { enabled: false, number: '01800000000' },
    rocket: { enabled: true, number: '018000000009' },
  },
});
const ok = { method: 'bkash', transactionId: 'abc 123xyz', senderNumber: '017-1234-5678', amount: '500', reference: '' };

test('transaction IDs normalize to the exact form firestore.rules requires (^[A-Z0-9]{6,40}$)', () => {
  assert.equal(normalizeTransactionId(' ab c123 xyz '), 'ABC123XYZ');
  assert.equal(buildTransactionKey('bkash', 'abc123xyz'), 'bkash__ABC123XYZ');
  // same ID typed differently => same lock key (duplicate protection cannot be dodged by case/spacing)
  assert.equal(buildTransactionKey('nagad', 'x1y2z3a4'), buildTransactionKey('nagad', ' X1Y2 Z3a4 '));
  // same ID on a different method is a different lock
  assert.notEqual(buildTransactionKey('bkash', 'ABC12345'), buildTransactionKey('rocket', 'ABC12345'));
});

test('valid submission passes', () => assert.deepEqual(validateSubmission(ok, cfg), {}));

test('system disabled / unconfigured blocks submission', () => {
  assert.ok(validateSubmission(ok, null).form);
  assert.ok(validateSubmission(ok, { ...cfg, enabled: false }).form);
  assert.equal(normalizeConfig(undefined).enabled, false);
  assert.equal(normalizeConfig(undefined).feeAmount, 0); // no invented default price
});

test('disabled or missing method rejected', () => {
  assert.ok(validateSubmission({ ...ok, method: 'nagad' }, cfg).method);
  assert.ok(validateSubmission({ ...ok, method: '' }, cfg).method);
  assert.ok(validateSubmission({ ...ok, method: 'paypal' }, cfg).method);
});

test('transaction ID validation', () => {
  for (const bad of ['', 'ab', '12345', 'ABC-1234', 'A'.repeat(41), "ABC123'; DROP"]) {
    assert.ok(validateSubmission({ ...ok, transactionId: bad }, cfg).transactionId, `should reject ${bad}`);
  }
});

test('amount must equal the configured fee exactly', () => {
  for (const bad of ['', '0', '-500', '499', '501', 'abc', 'NaN']) {
    assert.ok(validateSubmission({ ...ok, amount: bad }, cfg).amount, `should reject ${bad}`);
  }
  assert.deepEqual(validateSubmission({ ...ok, amount: 500 }, cfg), {});
});

test('sender number validation', () => {
  assert.equal(normalizeSenderNumber('017-1234 5678'), '01712345678');
  for (const bad of ['', '123', 'abcdefghijk', '0'.repeat(16)]) {
    assert.ok(validateSubmission({ ...ok, senderNumber: bad }, cfg).senderNumber, `should reject ${bad}`);
  }
  assert.deepEqual(validateSubmission({ ...ok, method: 'rocket', senderNumber: '018000000009' }, cfg), {});
});

test('reference length capped', () => assert.ok(validateSubmission({ ...ok, reference: 'x'.repeat(301) }, cfg).reference));

test('user-visible state: only profile.isVerified (server flag) can show Verified', () => {
  assert.equal(resolveUserState(null, false), 'not_verified');
  assert.equal(resolveUserState({ uid: 'u', status: 'payment_pending', applicationId: 'a' }, false), 'payment_pending');
  assert.equal(resolveUserState({ uid: 'u', status: 'under_review', applicationId: 'a' }, false), 'under_review');
  assert.equal(resolveUserState({ uid: 'u', status: 'rejected', applicationId: 'a' }, false), 'rejected');
  assert.equal(resolveUserState({ uid: 'u', status: 'revoked', applicationId: 'a' }, false), 'not_verified');
  assert.equal(resolveUserState(null, true), 'verified');
  // status pointer claims verified but the server profile flag says no => NOT verified
  assert.equal(resolveUserState({ uid: 'u', status: 'verified', applicationId: 'a' }, false), 'not_verified');
});

test('who may submit a new claim', () => {
  assert.equal(canSubmitNewClaim('not_verified'), true);
  assert.equal(canSubmitNewClaim('rejected'), true);
  for (const s of ['payment_pending', 'under_review', 'verified']) assert.equal(canSubmitNewClaim(s), false);
});

test('formatting helpers', () => {
  assert.equal(formatMoney(500, 'BDT'), '৳500');
  assert.equal(formatMoney(99.5, 'USD'), '99.50 USD');
  assert.equal(maskNumber('01712345678'), '••••••••678');
});
