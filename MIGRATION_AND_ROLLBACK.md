# Migration and rollback

## M1 — videoStats split (public vs private)
- `videoStats/{key}` = PRIVATE creator analytics (owner + moderation admins). `videoStatsPublic/{key}` = ranking-only aggregates (no uniqueViewers, reports, moderation reason).
- Order: (1) deploy the NEW client + rules together; (2) run `scripts/migrate-video-stats-public.mjs` (dry run, then `--apply`); (3) verify with a signed-in non-owner that `videoStatsPublic` reads work and `videoStats` reads are denied.
- Until step 2 completes, legacy videos have no public stats and are treated as new content (Stage 1) by the ranker. Nothing breaks; legacy ranking history is temporarily ignored.
- Rollback: redeploy the previous rules + client (the private `videoStats` docs are untouched by the migration, so no data is lost). `videoStatsPublic` can stay or be deleted.
- Reports are intentionally no longer part of public ranking inputs (the old auto "reports >= N" check is inactive client-side; moderators decide via distribution status).

## M2 — video duration
- New video posts store `videoDurationSeconds`; reels already store `durationSeconds`. Legacy content without a duration is treated as "unknown" (0), never as 15s. No backfill is required; rules only enforce duration matching when a duration is stored.
- Rollback: none needed (additive field).

## M3 — verification audit
- No data migration. Existing `auditLogs` are unchanged. New paid-verification transitions create `auditLogs/<applicationId>_<status>` documents; `users.lastVerificationAuditId` is written only by Super Admin manual changes.

## M4 — friendLinks (friend-list privacy)
- New collection `friendLinks/<ownerUid>_<friendUid>` (one directed edge per owner). Other people's friend lists are read ONLY from here; rules apply the owner's `whoCanViewFriends`, `isPrivateAccount` and blocks. `friendships` pair docs are now participant-only.
- Accepting a request now writes request status + friendship + both links in ONE batch; unfriend deletes the pair and both links.
- Backfill is lazy: whenever a user's own friend list loads, any pair without links gets its two edges created (rules allow this because the user is a participant of the existing pair). Until a user has logged in once after deploy, their old friendships are not listed to other people (fails closed).
- Rollback: redeploy previous rules/client; `friendLinks` is additive and can stay or be deleted. Old `friendships` docs are untouched.
- Index: single-field `ownerUid` equality, no composite index needed.

## M5 — userPrivate (private account fields)
- `isMinor`, `accountRestrictionNote`, `messagingRestricted` move from public `users/{uid}` to `userPrivate/{uid}` (owner + admin readable only; owner cannot edit).
- Order: (1) deploy client + rules (client falls back to legacy public values); (2) `node scripts/migrate-user-private-fields.mjs` (dry run, then `--apply`); (3) verify a non-admin cannot read `userPrivate/<other>`.
- Rollback: redeploy previous rules/client; the script only deletes the three fields after copying them. To undo, copy values back from `userPrivate` before deleting it.
- Cloud Function `adminManageUserStatus` (if ever deployed) now writes `userPrivate`.

## M6 — friendSuggestionStats (per-user docs)
- New writes go to `friendSuggestionStats/<yyyymmdd>_<uid>`; legacy shared `<yyyymmdd>` docs stay admin-readable but are no longer client-writable. The admin card sums per-user docs per day (newest 1000 records). No migration needed; old totals simply stop growing. Index: single-field `day` descending.

## M7 — reports (deterministic ids)
- Rules now require report ids `<targetType>_<targetId>_<reporterUid>` (the format `ReportDialog` already used). Existing reports with other ids are untouched and remain readable/resolvable by staff. Old clients that still create random-id reports will be rejected, so deploy client and rules together. Rollback: redeploy previous rules.

## M8 — indexes
- `firestore.indexes.json` gained 7 composite indexes (paidVerificationApplications: status/method/createdAt; videoStats: distStatus/ownerId/reports + updatedAt). Deploy with `firebase deploy --only firestore:indexes` BEFORE using the admin filters; building takes minutes. Never run automatically.

## M9 — suggestion dismissals
- New `suggestionDismissals/<uid>_<target>` docs. Legacy `userSettings.dismissedSuggestionIds` is still read, so no migration is required. Rollback: ignore the new collection.

## M10 — Super Admin bootstrap
- No data migration. Follow `docs/SUPER_ADMIN_RECOVERY.md`. Nothing is retired automatically.

## Production migration policy
- None of these scripts or deployments were run by the author. Run dry-runs first, on a staging project if possible, take a Firestore export (`gcloud firestore export` needs Blaze; on Spark use a manual JSON export of the affected collections) before `--apply`.

## M11 — feedHides (hidden creators / dismissed posts)
- New `feedHides/<uid>_<creator|post>_<targetId>` documents; legacy `userSettings.hiddenCreatorIds` / `dismissedPostIds` are still READ and merged, so no migration is required and nothing reappears. New hides are written only to `feedHides`; "show again"/reset clear both places.
- Optional later cleanup (not provided, not needed): fold legacy arrays into `feedHides` and empty them.
- Needs the composite index `feedHides (uid ASC, createdAt DESC)` (in `firestore.indexes.json`) deployed first; without it the client falls back to the legacy arrays only (hides made on the new storage would not be re-loaded after a refresh).
- Rollback: redeploy the previous client/rules; hides made after this change live only in `feedHides` and would be ignored by the old client (they reappear), nothing is lost.

## Dry-run policy (confirmed)
`scripts/migrate-video-stats-public.mjs` and `scripts/migrate-user-private-fields.mjs` do nothing without `--apply`. Rehearse against the emulator first (`docs/TESTING_AND_DEPLOYMENT_GUIDE.md` §7). No script, deploy or migration was run by the author.
