# BANA — Prompt 07 / 08 Compliance Audit, Fixes & Testing Report

Base: `BANA-FULL-PROJECT-prompt06.zip`. Scope: verify Prompt 07 (Marketplace, Sellers, Communities) and
Prompt 08 (Creator Monetization, Advertisement Manager) against the code and fix what did not match.
Nothing was rebuilt; existing features were preserved.

## 1. What already matched (verified by reading code, not re-implemented)
Marketplace listings/categories/search, cart + wishlist, server-validated orders (`createMarketplaceOrder`),
order status + tracking code, verified-purchase reviews with one review per order, seller dashboard,
groups (public/private, join approval, roles owner/admin/moderator/member, posts, polls, comments, events,
group chat), creator eligibility + application + review, earnings ledger, ad campaigns with schedule /
budget / frequency-cap / blocked-category / adult-only delivery filtering, "Sponsored" labelling,
admin sections for all of the above.

## 2. Gaps found and fixed
| # | Prompt | Gap | Fix |
|---|---|---|---|
| 1 | 07 §3 | Anyone verified could open a store instantly (no seller application) | `sellerApplications` workflow: apply → pending → staff approve/reject with note → notification. Rules block store creation without an approved application and force `storeId == uid`. UI: `SellerApplicationPanel`. Admin tab "Seller Applications". |
| 2 | 07 §6/§10 | No admin review moderation | Admin "Review Moderation" tab: hide/restore (never delete), note, audit log; product **and** store rating aggregates recomputed from visible reviews only. |
| 3 | 07 §8 | Any active member could create an `announcement` or pre-pinned group post (rule gap) | Rules: announcements staff-only, `isPinned` must be false on create. |
| 4 | 07 §9 | Group announcements notified nobody | Active members (cap 100) notified once each via `dedupeKey`. |
| 5 | 07 §11 | "Report Group" used a fixed reason; posts could not be reported; admin could only press "Resolve" | `CommunityReportDialog` (reasons, details, duplicate-proof deterministic report id), per-post report button, admin decisions: Remove post (soft-remove, explicit decision) / Resolve / Dismiss with note, audit-logged. |
| 6 | 07 §4 | Store `ratingAvg/reviewsCount/totalSales` writable by any verified user without limit | Rules cap each write to +1 step (residual risk below). |
| 7 | 08 §6 | Policy changes were an unversioned overwrite with a generic audit line; admin form lacked regions, terms, content requirements, payout methods, ad placements | Versioned policies + immutable `policyChangeHistory` (before/after diff computed from the stored doc inside a transaction, mandatory reason). Full form for both monetization and ad policy. Historical earnings/ledger are never rewritten. |
| 8 | 08 §2 | Region requirement was not enforced (`regionEligible = list.length > 0`) | Server rejects applications from countries not in `eligibleRegions` ("Global"/empty = everywhere) and when the program is disabled. |
| 9 | 08 §13 | **Payout race**: balance check and payout write were separate steps → concurrent requests could over-reserve | One Firestore transaction (per-user lock doc) reads confirmed earnings + reserved payouts and writes the payout, ledger entry and mirror; amounts compared in integer cents. |
| 10 | 08 §7 | **Payout state machine missing**: `paid` could be turned into `rejected` (balance released again); gateway env var skipped the reference check; manual references were labelled `provider_verified` | Transitions enforced inside the transaction (`paid`/`rejected` are terminal); `paid` always requires a settlement reference; `rejected` requires a reason; manual settlements are recorded as `manual_recorded` (no provider is integrated, so nothing is ever labelled provider-verified). |
| 11 | 08 §5/§13 | **Spark fallback let any verified user create a payout request of any amount** (rules only required `amount > 0`); admin fallback could re-pay / reverse | Client fallbacks removed; rules: `allow create: if false` on `payoutRequests` and `creatorPayouts`. Payouts need the Cloud Functions backend. |
| 12 | 08 §10 | Ad "Reach" silently fell back to impressions (an estimate shown as a verified metric) | Reach shows only recorded values (dash if none); analytics page states all figures are recorded events, nothing estimated. |
| 13 | 08 §4 | Creator Studio had no follower growth | 7/30-day new-follow counts from real `userFollows` records (unfollows not counted — stated in UI). |

## 3. Changed files
New: `src/components/marketplace/SellerApplicationPanel.tsx`, `src/components/communities/CommunityReportDialog.tsx`,
`tests/security/prompt07_08.rules.test.mjs`, `docs/PROMPT_07_08_REPORT.md`.
Modified: `firestore.rules`, `functions/src/index.ts`, `src/types/bana.ts`, `src/lib/marketplace.ts`,
`src/lib/monetization.ts`, `src/lib/ads.ts`, `src/lib/communities.ts`,
`src/components/marketplace/SellerDashboard.tsx`, `src/components/communities/CommunityDetailView.tsx`,
`src/components/admin/AdminMarketCommunitySection.tsx`, `src/components/admin/AdminMonetizationAdsFinanceSection.tsx`,
`src/pages/AdminPage.tsx`, `src/pages/AdvertisePage.tsx`, `src/pages/CreatorStudioPage.tsx`, `.env.example`, `README.md`.
`index.html` and routing were not changed (no new routes were needed).

## 4. Testing — what was and was NOT run
Actually executed here:
- `tsc --noEmit` (frontend), `tsc --noEmit` (functions), `tsc` (backend): clean.
- `vite build`: succeeds.
- `npm run test:backend`: 10/10 pass.
- `firestore.rules` delimiter balance check: balanced.

NOT executed (be explicit):
- **Firestore rules were not run against the emulator** (emulator cannot be downloaded in the authoring
  sandbox). `tests/security/prompt07_08.rules.test.mjs` covers the new rules but has never been run.
  Run `npm run test:rules` (and add the new file to the script) before deploying rules.
- No Cloud Function was executed (needs Firebase project / emulator). The payout transaction and state
  machine compile but are untested at runtime.
- No browser/UI click-through was performed; UI was verified by type-check and build only.
- No real payment, payout or ad-billing provider was exercised.

## 5. External setup / limitations
- **Payments:** card/wallet checkout needs `SSLCOMMERZ_*`, `BKASH_*`, `NAGAD_*` or `STRIPE_*` secrets in the
  Functions environment (see `.env.example`). Without them only COD / manual mobile-banking references work, and
  nothing is shown as paid without backend confirmation.
- **Payouts:** no automated provider is integrated. Finance records manual transfers with a mandatory reference.
  Requires Cloud Functions (Blaze). On Spark, creators see a clear "needs server" error; no client write path exists.
- **Ads billing:** advertiser deposits are verified manually by Finance; approval alone never spends money.
- **Spark-mode residual risks (not fixed):** with Cloud Functions off, the client fallbacks for
  order status / store counters / `adminAdjustOrConfirmCreatorEarnings`-style paths still rely on rules rather than
  server logic. The +1 cap bounds, but does not eliminate, counter abuse. Enable Functions for full integrity.
- Group-wide "Community settings" and "Marketplace settings" screens beyond the existing policy/gateway forms were
  not added; existing settings remain.
- Seller application gates **storefronts** only. Quick "Sell Item" classified listings (free quota) still need no
  store, as in Prompt 06; tell me if you want those gated too.
- `payoutLocks/{uid}` is a new server-only collection (no client rules → denied by default).
