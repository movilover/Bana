// Prompt 12 — provider validation & safe selection tests.
// Run: npm run test:providers   (uses Node's built-in type stripping; no network, no Firebase)
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  validateEndpointUrl,
  validateStorageProviderConfig,
  validateApiProviderConfig,
} from '../../src/lib/providerValidation.ts';
import { selectPrimaryAndBackup } from '../../src/lib/storage/providerSelection.ts';

test('validateEndpointUrl: empty is allowed, https/wss allowed, plain http only for localhost', () => {
  assert.equal(validateEndpointUrl('', 'X'), null);
  assert.equal(validateEndpointUrl(undefined, 'X'), null);
  assert.equal(validateEndpointUrl('https://broker.example.workers.dev', 'X'), null);
  assert.equal(validateEndpointUrl('wss://live.example.com', 'X'), null);
  assert.equal(validateEndpointUrl('http://localhost:8788', 'X'), null);
  assert.notEqual(validateEndpointUrl('http://example.com', 'X'), null);
  assert.notEqual(validateEndpointUrl('not a url', 'X'), null);
  assert.notEqual(validateEndpointUrl('javascript:alert(1)', 'X'), null);
});

test('validateEndpointUrl: ICE server URIs (stun/turn) are accepted, so the default calling provider stays valid', () => {
  assert.equal(validateEndpointUrl('stun:stun.l.google.com:19302', 'X'), null);
  assert.equal(validateEndpointUrl('turn:turn.example.com:3478', 'X'), null);
  assert.equal(validateEndpointUrl('turns:turn.example.com:5349', 'X'), null);
  // The default built-in calling provider must still activate.
  const r = validateApiProviderConfig({
    name: 'Built-in WebRTC + Public STUN',
    requiresBillingApproval: false,
    billingApprovedByAdmin: false,
    endpointUrl: 'stun:stun.l.google.com:19302',
  });
  assert.equal(r.ok, true);
});

test('validateStorageProviderConfig: enabled paid provider without billing approval is rejected', () => {
  const r = validateStorageProviderConfig({
    label: 'Google Cloud Storage',
    enabled: true,
    requiresBilling: true,
    billingApproved: false,
    endpointUrl: 'https://storage.googleapis.com',
  });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /billing approval/);
});

test('validateStorageProviderConfig: approved paid provider and disabled paid provider are accepted', () => {
  const approved = validateStorageProviderConfig({
    label: 'GCS',
    enabled: true,
    requiresBilling: true,
    billingApproved: true,
    endpointUrl: 'https://storage.googleapis.com',
  });
  assert.equal(approved.ok, true);

  const disabled = validateStorageProviderConfig({
    label: 'GCS',
    enabled: false,
    requiresBilling: true,
    billingApproved: false,
    endpointUrl: '',
  });
  assert.equal(disabled.ok, true);
});

test('validateStorageProviderConfig: malformed or insecure URLs are rejected, empty enabled provider only warns', () => {
  const bad = validateStorageProviderConfig({
    label: 'R2',
    enabled: true,
    requiresBilling: false,
    workerBrokerUrl: 'http://evil.example.com',
  });
  assert.equal(bad.ok, false);

  const warnOnly = validateStorageProviderConfig({
    label: 'R2',
    enabled: true,
    requiresBilling: false,
    endpointUrl: '',
    workerBrokerUrl: '',
  });
  assert.equal(warnOnly.ok, true);
  assert.equal(warnOnly.warnings.length, 1);
});

test('validateApiProviderConfig: paid providers need billing approval before activation', () => {
  const unapproved = validateApiProviderConfig({
    name: 'Agora RTC',
    requiresBillingApproval: true,
    billingApprovedByAdmin: false,
    endpointUrl: '',
  });
  assert.equal(unapproved.ok, false);

  const approved = validateApiProviderConfig({
    name: 'Agora RTC',
    requiresBillingApproval: true,
    billingApprovedByAdmin: true,
    endpointUrl: '',
  });
  assert.equal(approved.ok, true);

  const free = validateApiProviderConfig({
    name: 'Built-in WebRTC',
    requiresBillingApproval: false,
    billingApprovedByAdmin: false,
    endpointUrl: 'https://turn.example.com',
  });
  assert.equal(free.ok, true);
});

const provider = (overrides) => ({
  providerId: 'x',
  label: 'x',
  role: 'optional',
  enabled: false,
  connectionStatus: 'not_configured',
  requiresBilling: false,
  billingApproved: false,
  freeQuotaGB: 0,
  estimatedUsedBytes: 0,
  ...overrides,
});

test('selectPrimaryAndBackup: default free providers select R2 as primary and B2 as backup', () => {
  const all = [
    provider({ providerId: 'cloudflare_r2', role: 'primary', enabled: true }),
    provider({ providerId: 'backblaze_b2', role: 'secondary_backup', enabled: true }),
    provider({ providerId: 'google_cloud_storage', role: 'optional', enabled: false, requiresBilling: true }),
  ];
  const { primary, backup } = selectPrimaryAndBackup(all);
  assert.equal(primary.providerId, 'cloudflare_r2');
  assert.equal(backup.providerId, 'backblaze_b2');
});

test('selectPrimaryAndBackup: an unapproved paid provider is never selected as primary (fallback fix)', () => {
  const all = [
    provider({ providerId: 'google_cloud_storage', role: 'primary', enabled: true, requiresBilling: true, billingApproved: false }),
    provider({ providerId: 'cloudflare_r2', role: 'optional', enabled: false }),
  ];
  const { primary } = selectPrimaryAndBackup(all);
  assert.equal(primary.providerId, 'cloudflare_r2');
});

test('selectPrimaryAndBackup: an unapproved paid provider is never selected as backup', () => {
  const all = [
    provider({ providerId: 'cloudflare_r2', role: 'primary', enabled: true }),
    provider({ providerId: 'google_cloud_storage', role: 'secondary_backup', enabled: true, requiresBilling: true, billingApproved: false }),
  ];
  const { backup } = selectPrimaryAndBackup(all);
  assert.equal(backup, null);
});

test('selectPrimaryAndBackup: throws instead of silently choosing a paid provider when nothing free exists', () => {
  const all = [
    provider({ providerId: 'google_cloud_storage', role: 'primary', enabled: true, requiresBilling: true, billingApproved: false }),
  ];
  assert.throws(() => selectPrimaryAndBackup(all), /No free or billing-approved storage provider/);
});

test('selectPrimaryAndBackup: an approved paid provider may be selected when explicitly configured as primary', () => {
  const all = [
    provider({ providerId: 'google_cloud_storage', role: 'primary', enabled: true, requiresBilling: true, billingApproved: true }),
    provider({ providerId: 'cloudflare_r2', role: 'optional', enabled: false }),
  ];
  const { primary } = selectPrimaryAndBackup(all);
  assert.equal(primary.providerId, 'google_cloud_storage');
});
