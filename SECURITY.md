# BANA — Security Guide

This describes the security controls that exist in the code and the actions you must take. It is not a
penetration-test report and does not claim the platform is "secure".

## 1. Secrets handling

- No real credentials are in this package. A scan for private keys, service-account JSON, `sk_live_`/`sk_test_`
  patterns and the project's own secret patterns is run by `npm run verify:export`.
- `.gitignore` excludes `.env*` (except `.env.example`), `.dev.vars`, service-account/Admin SDK JSON, `*.pem`,
  `*.key`, build output and ZIPs.
- `scripts/create-release-zip.mjs` aborts the release if secret patterns are found.
- **Public by design:** the Firebase web config in `src/firebase.ts` (API key, app ID, project ID). It
  identifies the project; protection comes from Firestore/Storage rules, Auth settings and App Check. Restrict
  the API key by HTTP referrer in Google Cloud Console and enable App Check for production.
- **Never** expose in `VITE_*`: Supabase service-role/JWT secrets, TURN/LiveKit/Agora/100ms secrets, R2/B2/S3
  keys, VAPID private key, payment secrets.

## 2. Authentication and roles

- Firebase Authentication on the client; the backend verifies Firebase RS256 ID tokens (project from
  `FIREBASE_PROJECT_ID`), Supabase HS256 JWTs, and test HMAC tokens (test only).
- Admin roles live in `adminRoles/{uid}` and are mirrored to custom claims by Cloud Functions when deployed.
  Frontend module access uses `src/lib/adminRbac.ts`; Firestore rules enforce server-side.
- Bootstrap Super Admin is an email constant in the rules and code. **Replace it with your own before production**
  (list in `ENVIRONMENT.md` §6).

## 3. Rules and policies

| Layer | File | Notes |
|---|---|---|
| Firestore | `firestore.rules` | Per-collection ownership, role and validation checks |
| Cloud Storage | `storage.rules` | Owner-scoped paths, default deny |
| PostgreSQL | `database/supabase/migrations/004_rls_and_storage_policies.sql` | RLS on 17 tables, bucket policies |
| Backend | `backend/src/middleware/*` | Auth, RBAC, sliding-window rate limiting, request validation, 1 MB JSON body limit |
| Docs | `security/` | Access-control, policy comparison and validation notes |

**Verification status:** rules were syntax-balanced by a brace check only. They have **not** been run against
the emulator in this export (`npm run test:rules` needs Java + Firebase emulators + network). Run it before
deploying and fix failures first.

## 4. Network controls to configure

- Backend `CORS_ALLOWED_ORIGINS`: exact production origins only.
- Worker `ALLOWED_ORIGINS`: change from `*` to your origins.
- Firebase Hosting already sends `X-Content-Type-Options`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy`,
  and `Permissions-Policy` (camera/mic/display-capture limited to self). No Content-Security-Policy is set; add
  one after testing, because the app loads Google Fonts and Firebase endpoints.
- Use HTTPS everywhere; WebRTC and `getUserMedia` require a secure context.

## 5. Paid-provider guard

Agora and 100ms token minting returns HTTP 403 unless an admin sets `billingApprovedByAdmin`. Nothing paid is
activated by default.

## 6. Deployment secret requirements

| Secret | Where to store |
|---|---|
| Firebase deploy credentials | GitHub secret `FIREBASE_SERVICE_ACCOUNT` or interactive `firebase login` |
| Backend env (TURN, LiveKit, Supabase service role, VAPID…) | Render environment (mark `sync: false`) |
| Worker storage keys | `wrangler secret put` |
| Payment keys | Functions runtime environment (Blaze) |

## 7. Pre-launch checklist

1. Replace bootstrap Super Admin email everywhere; sign in and confirm the role works.
2. Run `npm run test:rules` and fix failures; deploy rules, indexes and storage rules.
3. Restrict the Firebase API key; enable App Check; enable only the Auth providers you need.
4. Set production CORS origins; restrict worker `ALLOWED_ORIGINS`.
5. Run `npm audit` for each package (not done in this export).
6. Add a CSP and review third-party scripts.
7. Rotate any credential that was ever pasted into a chat, ticket or commit.

Report vulnerabilities privately to the repository owner; do not open public issues for them.
