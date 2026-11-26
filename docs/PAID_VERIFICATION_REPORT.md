# Paid Profile Verification — implementation report

Manual-payment verification (bKash / Nagad / Rocket) built into the existing BANA project. No payment gateway is
integrated and no payment is ever simulated: a transaction ID is an unverified claim until an authorized administrator approves it.

## Architecture
BANA's database is Firestore, so "migrations / RLS" = collection schemas + `firestore.rules` (the `database/supabase` SQL
folder is a separate scaffold and was not touched).

| Collection | Purpose | Who can write |
|---|---|---|
| `verificationConfig/settings` | enabled flag, fee, currency, per-method enabled/number/type/instructions | Super Admin only |
| `paidVerificationApplications/{id}` | one doc per payment claim, permanent history | user creates `payment_pending` only; admin/finance transition |
| `verificationStatus/{uid}` | the user's current-status pointer | user (start/restart claim), admin/finance (advance) |
| `paymentClaims/{method__TXNID}` | uniqueness lock for duplicate protection | user (with the claim), Super Admin may release |

Status flow: `payment_pending → under_review → verified | rejected`, `verified → revoked`.
Approve / revoke write application + status + `users/{uid}.isVerified` in ONE batch; rules verify all three agree via `getAfter`.

## Enforced in rules (not just UI)
Fee equals configured fee · method enabled · system enabled · txn ID `^[A-Z0-9]{6,40}$` · duplicate txn blocked by lock doc ·
one open application per user · users cannot self-verify or edit claims · payment fields immutable · rejection/revocation need a reason ·
no self-approval · only Super Admin / Admin / Finance can approve (moderators & support cannot) · applications are never deletable.

## Files created
`src/types/paidVerification.ts`, `src/lib/paidVerificationCore.ts` (pure logic), `src/lib/paidVerification.ts`,
`src/lib/verifiedStatus.ts`, `src/components/common/LiveVerifiedBadge.tsx`, `src/components/verification/VerificationStatusPill.tsx`,
`src/pages/VerificationPage.tsx`, `src/components/admin/AdminPaidVerificationSection.tsx`,
`tests/verification/paid-verification.logic.test.mjs`, `tests/security/paidVerification.rules.test.mjs`, this file.

## Files modified
`firestore.rules`, `package.json` (scripts), `src/App.tsx` (route `/verification`), `src/pages/ProfilePage.tsx` ("Get Verified" now links to the page; live badge),
`src/pages/AdminPage.tsx` + `src/lib/adminRbac.ts` (new module/actions), `src/types/bana.ts` (`verificationType` += `'paid'`),
`src/components/common/BanaLogo.tsx` (a11y label), `PostCard.tsx`, `FullscreenVideoModal.tsx`, `ReelsPage.tsx`, `ReelCommentsPanel.tsx` (live badge).

## Before it works (deployment)
1. Publish rules: `npx firebase-tools deploy --only firestore:rules` (or the existing "Deploy Firebase security rules" workflow).
2. Sign in as Super Admin → Admin → **Paid Verification → Payment settings**: set fee, numbers, instructions, enable methods, then enable the system.
   Until then the user page shows "not available" (nothing is hard-coded).
3. No new composite indexes are required.


## Remediation update (authorization and audit)
- Only the paid workflow (finance/admin) or a Super Admin manual action may change `users.isVerified`; moderators/support staff cannot (rules, Cloud Function and UI). Users cannot verify themselves.
- Every transition (`under_review`, `verified`, `rejected`, `revoked`) is committed in ONE batch with its audit record `auditLogs/<applicationId>_<status>`; rules require it via `existsAfter/getAfter` (actor, target, action, time). Super Admin manual grants/revokes use `lastVerificationAuditId` the same way.
- Admin list: server-side status/method/date filters, search (username prefix, txn id, number, user id) and cursor pagination.
- Not executed by the author: emulator tests (see TEST_RESULTS.md).
