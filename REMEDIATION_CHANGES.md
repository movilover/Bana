# Changes in this checkpoint
- `firestore.rules`: removed legacy `canReviewVerification()` isVerified branch; added Super Admin branch bound to an audit record (`lastVerificationAuditId`); `pvAuditOk()` required on every paid-verification application transition; `auditLogs` create restricted for reserved action prefixes; `vdDurationMatchesParent()` added to `vdEventOk`.
- `src/lib/paidVerification.ts`: audit record staged in the same batch (`stageAudit`); new `grantVerificationManually`; `revokeProfileOnly` now atomic with its audit record. Function signatures take an `AuditCtx` instead of an audit callback.
- `src/components/admin/AdminPaidVerificationSection.tsx`, `AdminVerificationsSection.tsx`, `src/pages/AdminPage.tsx`: pass actor info; legacy approve is Super Admin only.
- `functions/src/index.ts`: `reviewVerificationRequest` approval requires super_admin.
- `src/lib/videoUtils.ts`, `CreateModal.tsx`, `src/types/bana.ts`: `videoDurationSeconds` saved for video posts.
- `src/lib/videoDistributionCore.ts`, `videoDistribution.ts`, `VideoAnalyticsPage.tsx`, `AdminSmartVideoSection.tsx`: no assumed 15s; 0 = unknown.
- `tests/security/paidVerification.rules.test.mjs`: audit docs added to batches; 5 new tests for D/E (written, NOT executed).

## Checkpoint 2 — videoStats privacy
- Rules: `videoStats` private (owner/mod-admin); new `videoStatsPublic` + `vdPublicModOk`.
- `videoDistribution.ts`: views/feedback write private + public in one batch; reports stay private; ranking reads `videoStatsPublic` (stats map + top pool).
- `AdminSmartVideoSection.tsx`: status change writes private + public atomically.
- Tests: 5 new cases in `videoDistribution.rules.test.mjs` (not executed). Migration: `scripts/migrate-video-stats-public.mjs`.

## Checkpoint 3 — users / friendships / friend suggestions
- Rules: `friendships` participant-only; `friendLinks` + `friendListVisibleTo()`; `userPrivate`; users create rejects private fields; staff user-standing branch limited to `accountStatus`; per-user `friendSuggestionStats`; extra Super-Admin-only verification path already from checkpoint 1.
- `socialGraph.ts`: atomic accept (request + friendship + 2 links), unfriend removes links, `getUserFriendIds(uid, max)` (own list from pair docs + lazy link backfill; others only via `friendLinks`).
- `friendSuggestions.ts`: random bounded friend sample (limit 60 per list), per-user stats writer; `friendSuggestionsCore.ts`: private accounts need a connection signal.
- `AuthContext.tsx`: merges `userPrivate` into `profile` (legacy fallback); new users get `userPrivate` instead of public `isMinor`.
- Admin: `AdminPage.tsx` merges `userPrivate`; `AdminUsersSection.tsx` / `AdminMessengerCallingSection.tsx` write private fields to `userPrivate`; Verify/Unverify is Super Admin + atomic audit; `AdminFriendSuggestionsSection.tsx` sums per-user stats (labelled approximate).
- `functions/src/index.ts`: `adminManageUserStatus` writes `userPrivate`. `accountDeletion.ts`: erases friendLinks and stats docs.
- Tests added: `friendPrivacy.rules.test.mjs`, `userPrivacy.rules.test.mjs`; updated `friendSuggestions.rules.test.mjs`; +1 logic test. Scripts: `migrate-user-private-fields.mjs`.

## Checkpoint 4 — feedback, reports, language, badges, admin, bootstrap, dismissals, docs
- New: `src/lib/reports.ts`, `src/lib/videoModeration.ts`, `src/lib/suggestionDismissals.ts`, `docs/SUPER_ADMIN_RECOVERY.md`, tests `moderation.rules.test.mjs`, `superAdmin.rules.test.mjs`.
- `PostCard.tsx`: video feedback (not_interested / hide / hide_creator / report) + shared report submit; `ReportDialog.tsx`, `ReelsPage.tsx`, `ReelCommentsPanel.tsx`, `ProfilePage.tsx`: all report creators use `submitReport` (deterministic id).
- `videoDistributionCore.ts`: report counts no longer gate; `needsModeratorReview`; `detectContentLanguage`, `viewerLanguageFromBrowser`. `videoDistribution.ts`: `stageVideoFeedback`, language in adapters.
- `AdminReportsSection.tsx`: Hold video + distribution reconcile. `AdminSmartVideoSection.tsx` / `AdminPaidVerificationSection.tsx`: filters, search, cursor pagination, picker. `firestore.indexes.json`: 7 composite indexes.
- `AdminRbacSection.tsx`: Super Admin bootstrap panel. Rules: adminBootstrap/adminRoles safeguards.
- Badges: SearchPopup, ProfileDropdown, PeopleYouMayKnow, ProfilePage use `LiveVerifiedBadge` / `useLiveVerified`.
- Docs: KNOWN_LIMITATIONS (CORS corrected), FIXES_APPLIED, SMART_VIDEO_DISTRIBUTION, ENVIRONMENT, FRIEND_SUGGESTIONS_REPORT, PAID_VERIFICATION_REPORT, README.

## Checkpoint 5 — badges, hides, tooling, docs
- Badges: `LiveVerifiedBadge` added in `MessengerPage.tsx` (list, header, group sender, picker), `CommunityDetailView.tsx`, `GroupChatPanel.tsx`, `StoryCarousel.tsx`, `ProductDetailPage.tsx`. Notifications and Storefront intentionally excluded (reasons in KNOWN_LIMITATIONS).
- Hides: new `src/lib/feedHides.ts` (`useFeedHides`), `feedHides` rules + index + account-deletion cleanup; `DiscoverPage.tsx`, `ReelsPage.tsx`, `ProfilePage.tsx` use it (legacy arrays still merged; guests unchanged). New rules test case in `userPrivacy.rules.test.mjs`.
- Tooling: `scripts/validate-indexes.mjs` (found and removed a pre-existing invalid single-field index), `scripts/preflight-rules-tests.mjs`; `package.json`: `validate:indexes`, `check` now includes index + logic tests, `check:full`, `test:rules` runs the preflight first.
- Docs: `docs/TESTING_AND_DEPLOYMENT_GUIDE.md`, `REMEDIATION_AUDIT_REPORT.md` (28 findings re-classified), `KNOWN_LIMITATIONS.md`, `TEST_RESULTS.md`, TESTING/INSTALLATION/README pointers.
