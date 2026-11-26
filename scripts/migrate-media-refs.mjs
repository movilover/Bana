#!/usr/bin/env node
/**
 * BANA Media Reference Migration Helper CLI
 * Rewrites primary media base URL prefixes & provider metadata inside a validated
 * `bana-manifest-v1` export file and recomputes the manifest SHA-256 checksum.
 *
 * Usage:
 *   node scripts/migrate-media-refs.mjs <manifest.json> --from=<oldBaseUrl> --to=<newBaseUrl> --provider=<newProviderId> [--write]
 */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { verifyManifestObject } from './backup-manifest-cli.mjs';

function parseArgs(argv) {
  const args = { file: '', from: '', to: '', provider: '', write: false };
  for (const a of argv) {
    if (a === '--write') args.write = true;
    else if (a.startsWith('--from=')) args.from = a.slice(7).replace(/\/+$/, '');
    else if (a.startsWith('--to=')) args.to = a.slice(5).replace(/\/+$/, '');
    else if (a.startsWith('--provider=')) args.provider = a.slice(11);
    else if (!args.file) args.file = a;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.file || !args.from || !args.to) {
  console.error(
    'Usage: node scripts/migrate-media-refs.mjs <manifest.json> --from=<oldBaseUrl> --to=<newBaseUrl> [--provider=<newProviderId>] [--write]'
  );
  process.exit(1);
}

const abs = path.resolve(process.cwd(), args.file);
const manifest = JSON.parse(fs.readFileSync(abs, 'utf8'));
const check = verifyManifestObject(manifest);
if (!check.valid) {
  console.error('Refusing to migrate invalid or tampered manifest:', check.errors);
  process.exit(2);
}

let updatedCount = 0;
const rewriteUrl = (u) => {
  if (typeof u !== 'string' || !u.startsWith(args.from)) return u;
  updatedCount += 1;
  return args.to + u.slice(args.from.length);
};

for (const asset of manifest.collections.mediaAssets || []) {
  asset.primaryUrl = rewriteUrl(asset.primaryUrl);
  if (args.provider && asset.primaryUrl?.startsWith(args.to)) {
    asset.primaryProvider = args.provider;
  }
}
for (const reel of manifest.collections.reels || []) {
  reel.videoUrl = rewriteUrl(reel.videoUrl);
  reel.thumbnailUrl = rewriteUrl(reel.thumbnailUrl);
  if (args.provider && reel.videoUrl?.startsWith(args.to)) {
    reel.storageProvider = args.provider;
  }
}
for (const story of manifest.collections.stories || []) {
  story.mediaUrl = rewriteUrl(story.mediaUrl);
}
for (const sb of manifest.collections.storyBackups || []) {
  sb.primaryUrl = rewriteUrl(sb.primaryUrl);
}

const canonicalPayload = JSON.stringify({
  schemaVersion: manifest.schemaVersion,
  platform: manifest.platform,
  projectId: manifest.projectId,
  exportedAtIso: manifest.exportedAtIso,
  collections: manifest.collections,
});
manifest.checksumSha256 = crypto.createHash('sha256').update(canonicalPayload).digest('hex');

console.log(
  JSON.stringify(
    {
      mode: args.write ? 'written' : 'dry_run',
      rewrittenReferences: updatedCount,
      newChecksumSha256: manifest.checksumSha256,
    },
    null,
    2
  )
);

if (args.write) {
  fs.writeFileSync(abs, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
}
