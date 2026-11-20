#!/usr/bin/env node
/**
 * BANA Database Manifest Verifier CLI
 * Validates exported `bana-manifest-v1` JSON files:
 *  - Verifies schemaVersion & required structure
 *  - Scans recursively for any accidentally leaked secret keys
 *  - Recomputes canonical SHA-256 checksum & compares against `checksumSha256`
 *
 * Usage:
 *   node scripts/backup-manifest-cli.mjs <path-to-manifest.json>
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SECRET_KEYS = new Set([
  'secretAccessKey',
  'accessKeyId',
  'privateKey',
  'passwordHash',
  'serviceAccountJson',
  'refreshToken',
  'idToken',
]);

function scanForSecrets(value, currentPath = '') {
  const hits = [];
  if (Array.isArray(value)) {
    value.forEach((item, idx) => {
      hits.push(...scanForSecrets(item, `${currentPath}[${idx}]`));
    });
  } else if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEYS.has(k) && v !== null && v !== undefined && String(v).trim() !== '') {
        hits.push(`${currentPath}.${k}`);
      }
      hits.push(...scanForSecrets(v, `${currentPath}.${k}`));
    }
  }
  return hits;
}

export function verifyManifestObject(parsed) {
  const errors = [];
  if (!parsed || parsed.schemaVersion !== 'bana-manifest-v1' || !parsed.collections) {
    errors.push('Invalid or missing schemaVersion (expected bana-manifest-v1).');
  }

  const secretHits = scanForSecrets(parsed);
  if (secretHits.length > 0) {
    errors.push(`Detected restricted credential fields in manifest: ${secretHits.join(', ')}`);
  }

  const canonicalPayload = JSON.stringify({
    schemaVersion: parsed?.schemaVersion,
    platform: parsed?.platform,
    projectId: parsed?.projectId,
    exportedAtIso: parsed?.exportedAtIso,
    collections: parsed?.collections,
  });

  const computedSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');
  const expectedSha256 = String(parsed?.checksumSha256 || '').toLowerCase();
  if (!expectedSha256 || computedSha256 !== expectedSha256) {
    errors.push(
      `SHA-256 mismatch: expected ${expectedSha256 || '(missing)'}, computed ${computedSha256}.`
    );
  }

  const counts = {};
  if (parsed?.collections && typeof parsed.collections === 'object') {
    for (const [col, rows] of Object.entries(parsed.collections)) {
      counts[col] = Array.isArray(rows) ? rows.length : 0;
    }
  }

  return {
    valid: errors.length === 0,
    computedSha256,
    secretHits,
    counts,
    errors,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node scripts/backup-manifest-cli.mjs <path-to-manifest.json>');
    process.exit(1);
  }

  const abs = path.resolve(process.cwd(), target);
  if (!fs.existsSync(abs)) {
    console.error(`File not found: ${abs}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(abs, 'utf8');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`Invalid JSON: ${err.message}`);
    process.exit(1);
  }

  const res = verifyManifestObject(parsed);
  console.log(JSON.stringify(res, null, 2));
  if (!res.valid) {
    process.exit(2);
  }
}
