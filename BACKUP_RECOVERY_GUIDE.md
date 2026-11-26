# BANA Backup, Integrity & One-Click Recovery Guide

This guide documents operational procedures in **Admin Panel → Storage & Recovery** and CLI tooling.

---

## 1. Automated Upload & Secondary Backup Pipeline

Every video, story, voice message, and image uploaded via `uploadToMultiCloudStorage` follows this lifecycle:

1. **Client Pre-Hash:** Web Crypto computes the exact `SHA-256` digest of the file before transfer.
2. **Pre-Registration:** A document is created in `mediaAssets` (`lifecycleStatus: 'uploading'`) with an in-memory duplicate upload guard.
3. **Direct Presigned PUT:** Browser uploads directly to Primary Storage (Cloudflare R2) via presigned URL from `bana-media-broker` with XHR progress & cancellation (`AbortController`).
4. **Backup Enqueueing:** A row is written to `backupJobs` (`status: 'pending'`, `maxAttempts: 3`, `expectedSha256`).
5. **Cross-Cloud Copy & Verify:** `processBackupJob()` instructs the Media Broker (`POST /api/media/backup-copy`) to read Primary bytes, verify SHA-256 equals `expectedSha256`, upload to Secondary Backup (Backblaze B2), and propagate `backupVideoUrl` back to `reels` / `storyBackups` / `mediaAssets`.
6. **Sole-Copy Protection:** Deleting a media asset while `retentionSettings/default.preventDeleteIfSoleCopy === true` is **blocked** if no completed secondary backup copy exists.

---

## 2. Story 24-Hour Expiration & Backup Archive

- **Public Feed Visibility:** `StoryCarousel.tsx` strictly filters out stories where `expiresAt <= now` or `status !== 'active'`.
- **Archival Record (`storyBackups`):** Every created story generates a corresponding archival entry in `storyBackups/{storyId}` retained for `storyRetentionDays` (default: **30 days**).
- **Owner Deletion Behavior:** When a user removes a story before 24 hours, the story disappears immediately from the public feed (`status: 'removed'`), while the archival reference in `storyBackups` remains intact (`deletedByOwnerAt`) until the admin purges expired records under Retention Settings.

---

## 3. Comment Hardening & Soft Deletion Recovery

- Comments include `clientMutationId` (duplicate double-submit guard), `moderationStatus`, and `deletionStatus`.
- User deletions mark `deletionStatus: 'soft_deleted'`, preserving text internally while rendering `[Comment deleted]` in the UI so nested replies remain intact.
- In **Admin → Storage & Recovery → Comment Database**, admins can filter **Soft Deleted** comments and **Restore** or **Permanently Purge** them with full entries in `backupAuditLogs`.

---

## 4. Database Manifest Export & CLI Verification

1. Open **Admin → Storage & Recovery → Database Export**.
2. Click **Generate & Download Manifest JSON**.
   - Excludes emails, phone numbers, password hashes, tokens, private keys, and secret fields (`excludedSensitiveFields` listed explicitly in the export).
   - Computes canonical `checksumSha256` across all exported collections and records a snapshot receipt in `databaseSnapshots`.
3. Validate exported JSON using either:
   - In-UI **Validate & Selective Restore** JSON picker, OR
   - Offline CLI:
     ```bash
     npm run backup:verify -- ./bana-db-manifest-2026-11-16.json
     ```
   - Migrate URL prefixes cleanly during provider cutover:
     ```bash
     npm run backup:verify -- ./manifest.json
     node scripts/migrate-media-refs.mjs ./manifest.json --from=https://cdn-old.example.com --to=https://cdn-new.example.com --provider=backblaze_b2 --write
     ```

---

## 5. One-Click Disaster Recovery Procedure (Primary Outage)

If Primary Storage (Cloudflare R2) becomes unreachable or corrupted:

1. Ensure Target Recovery Provider (e.g., **Backblaze B2** or a newly configured **Generic S3 / MinIO / Fresh R2 bucket**) is **Enabled** and passes **Live Probe** (`Connected`).
2. Open **Admin → Storage & Recovery → Recovery Center**.
3. Run **Dry Run First** (`dryRun: true`) to preview how many `mediaAssets` have verified `backupUrl` + `checksumSha256` copies eligible for restoration.
4. Click **Execute One-Click Live Recovery**:
   - Step A: Automatically exports a pre-recovery DB snapshot manifest to `databaseSnapshots`.
   - Step B: Copies each asset from Secondary Backup (`backupUrl`) to Target Primary Provider.
   - Step C: Verifies SHA-256 match post-transfer.
   - Step D: Atomically updates `mediaAssets`, `reels`, `posts`, `stories`, and `storyBackups` primary URLs **without deleting the secondary backup copy**.
   - Step E: Logs full summary in `recoveryOperations` and `backupAuditLogs`.
