# BANA Prompt 01–03 — Remediation Audit Report (final classification)

Source: `BANA-DEPLOY-READY-smart-video-distribution.zip`. Every finding was checked against the real files.

**Classification used** (one per finding):
- **FIXED** — implemented in code, with tests written. *Not verified by execution unless stated* (see "Verification" below).
- **PARTIALLY FIXED** — part implemented; the rest is deliberately kept or not done, reason given.
- **UNRESOLVED** — not implemented.
- **ACCEPTED INFRASTRUCTURE LIMITATION** — cannot be solved securely on Firebase Spark without a trusted server; mitigated and documented.

## Verification (read this first)
The author had no network, no `node_modules`, no Firebase emulator and no browser. **`npm run lint`, `npm run build`, `npm run test:rules`, browser/E2E and mobile/desktop testing were NOT executed.**
Only `npm run test:verification` (logic + rules-parity tests, 49 cases), `node --check` on all tests/scripts, a syntax-only TypeScript pass, rules brace balance and index/JSON validation were executed.
So every "FIXED" below means *written and statically checked*, not *proven*. Nothing here is marked production-ready.

## Findings (28 rows: 22 tracked in earlier checkpoints + 3 newly found [F4, IDX1, CHK1] + 3 explicitly tracked open items [W1, W2, T1])

| # | Finding | Evidence (path) | Classification | Notes |
|---|---------|-----------------|----------------|-------|
| D1 | Moderator / support_staff could set `users.isVerified` | `firestore.rules` `isScopedStaffUserUpdate()`; `functions/src/index.ts` `reviewVerificationRequest`; `AdminVerificationsSection.tsx` | **FIXED** | Only paid workflow or Super Admin + audit record |
| D2 | *(new)* `AdminUsersSection` Verify/Unverify wrote `isVerified` directly | `src/components/admin/AdminUsersSection.tsx` | **FIXED** | Super Admin only, atomic with audit |
| E1 | Audit log written after the batch commit | `src/lib/paidVerification.ts` | **FIXED** | Same batch; rules require it via `existsAfter/getAfter` |
| E2 | Any admin could forge audit entries | `auditLogs` rule | **FIXED** | Reserved action prefixes restricted by role |
| B1 | `durationMs` not validated against the video | `vdEventOk` | **FIXED** | Must match stored duration (±1.5 s) when stored; legacy videos keep the generic bound |
| B2 | Normal video posts never stored a duration | `CreateModal.tsx` | **FIXED** | `videoDurationSeconds` |
| B3 | `watchMs` is client-controlled | Spark has no trusted server | **ACCEPTED INFRASTRUCTURE LIMITATION** | Labelled client-reported/approximate; not for monetization |
| V1 | Hardcoded 15 s duration | `videoDistribution.ts`, `VideoAnalyticsPage.tsx`, `AdminSmartVideoSection.tsx` | **FIXED** | Unknown = 0; duration checks skipped, not guessed. Admin list rows have no duration (shown as unknown) |
| A1 | `videoStats` readable by every signed-in user | `match /videoStats/{key}` | **PARTIALLY FIXED** | Private analytics now owner/admin-only; ranking aggregates stay readable (client-side ranking) — see L2 |
| C1 | `users` readable without sign-in | `match /users/{userId}` | **PARTIALLY FIXED** | Public read kept on purpose (guest profiles/Discover are a product feature); private fields moved to `userPrivate` |
| C2 | `friendships` readable by any signed-in user | `match /friendships/{pairId}` | **FIXED** | Participant-only; lists via `friendLinks` |
| C3 | `whoCanViewFriends` enforced only in the UI | rules | **FIXED** | `friendListVisibleTo()` (everyone/friends/only_me, private account, blocks) |
| F1 | `friendSuggestionStats` client-writable and inflatable | rules `fsStat*` | **ACCEPTED INFRASTRUCTURE LIMITATION** (mitigated) | Per-user docs, own-doc only, absolute + per-write caps; still client-reported |
| F2 | friends-of-friends read other users' friend lists | `friendSuggestions.ts` | **FIXED** | Reads go through `friendLinks`, which honours the owner's privacy settings |
| F3 | Dismissed-suggestion array capped at 300 | `useFriendSuggestions.ts` | **FIXED** | `suggestionDismissals` per-document; legacy array still read |
| F4 | *(new)* Hidden-creator / dismissed-post arrays **unbounded** inside `userSettings` (previous report wrongly called them "capped") | `DiscoverPage.tsx`, `ReelsPage.tsx`, `ProfilePage.tsx` | **FIXED** | `feedHides` per-document; legacy arrays still read; guests unchanged (localStorage) |
| V2 | No feedback on normal video posts; no `hide_creator` | `PostCard.tsx`, rules | **FIXED** | not_interested / hide / hide_creator / report saved |
| V3 | Report brigading, non-atomic counters, auto-restriction, no distribution sync | `videoDistributionCore.ts`, `AdminReportsSection.tsx`, 3 creators with random ids | **FIXED** (residual → L3) | Deterministic ids, atomic report+counter, no automatic restriction, "Hold video", resolution reconciles status |
| V4 | `reelToContent` had no language | `videoDistribution.ts` | **FIXED** | Script-based detection; optional mild hint. Logic test executed and passes |
| H1 | Verified badge inconsistent | many components | **FIXED** (with reasoned exclusions) | Live badge now in Search, Profile dropdown, People You May Know, Profile lists, **Messenger, Communities, Stories, Product seller**. **Not added** to Notifications (the name is inside a composed sentence/title, many are system notices) and Storefront (the badge belongs to a person's account, not a store; no owner name is shown there). Legacy client-written `authorVerified` copies still exist; the UI ignores them |
| AD1 | Admin lists capped at 300 / 150 | `AdminPaidVerificationSection.tsx`, `AdminSmartVideoSection.tsx` | **FIXED** | Server-side filters, search, cursor pagination, picker |
| S1 | Hardcoded bootstrap Super Admin e-mail | `firestore.rules` `isBootstrappedSuperAdmin()` | **PARTIALLY FIXED** | E-mail deliberately **not removed** (you asked to keep it until a replacement is tested). Replacement path, lock-out protection and recovery doc added; replacement tests not executed |
| DOC | Documentation contradictions (CORS etc.) | `KNOWN_LIMITATIONS.md` etc. | **FIXED** | Worker ships an explicit allow-list, not `*` |
| IDX1 | *(new)* `firestore.indexes.json` contained a single-field index (pre-existing in your upload) that the CLI rejects | index `backupAuditLogs` | **FIXED** | Removed (single-field indexes are automatic); validator added |
| CHK1 | *(new)* `npm run check` ran neither the logic tests nor the index check; `test:rules` failed cryptically without CLI/Java | `package.json` | **FIXED** | `check` now includes them; preflight added |
| W1 | Personal watch-history ranking signal | — | **UNRESOLVED** | Not implemented. Needs an explicit opt-in design (see L4). No private-data access was added |
| W2 | Community / page-follow ranking signal | — | **UNRESOLVED** | Not implemented, same reason (memberships can be private) |
| T1 | Lint, build, emulator rules tests, E2E not executed | — | **UNRESOLVED** (needs your machine) | Commands in `docs/TESTING_AND_DEPLOYMENT_GUIDE.md` |

## Tally (counted from the table by script)
- Findings listed: **28**.
- FIXED: **20** — D1, D2, E1, E2, B1, B2, V1, C2, C3, F2, F3, F4, V2, V3, V4, H1, AD1, DOC, IDX1, CHK1 (V3 and H1 have documented residuals).
- PARTIALLY FIXED: **3** — A1, C1, S1 (all deliberate; reasons in the table).
- ACCEPTED INFRASTRUCTURE LIMITATION: **2** — B3, F1.
- UNRESOLVED: **3** — W1, W2 (not implemented), T1 (verification still needs to be run on your machine).
- NOT REPRODUCIBLE: 0. ALREADY FIXED before this work: 0 (H1 was partly done).
- "FIXED" means written and statically checked, **not** proven by the emulator, build or browser.

## Residual limitations referenced above
- **L2** Ranking aggregates in `videoStatsPublic` are readable by signed-in users (ranking is client-side on Spark).
- **L3** No per-reporter quota is possible in rules; many real accounts can still file reports. Moderators decide; counts never auto-restrict.
- **L4** Watch-history / community-follow signals: see `KNOWN_LIMITATIONS.md` §F for the consent requirements before they can be built.
