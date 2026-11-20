# BANA — Prompt 03 Security & Integration Audit (static review)

**Testing limitation.** The review environment has no npm registry access. Dependencies could not be installed, so
`npm run lint`, `npm run build`, `npm run test:rules`, `npm run test:backend`, the Functions build, and every live
Firebase / browser test were **NOT run**. Changed TypeScript files were only syntax-parsed. Nothing here is claimed as tested beyond what is listed under "Checks actually run".

## Changes made in this phase
| File | Change | Why |
|---|---|---|
| `backend/src/middleware/auth.ts` | HS256 (test + Supabase) tokens without a numeric `exp` are now rejected | Such tokens previously never expired. The existing backend test mints tokens with `exp`, so it should be unaffected (not run) |
| `functions/src/index.ts` | `onLikeCreated` / `onLikeDeleted` skip `targetType: 'story'`, cast the id to string, and swallow NOT_FOUND | Story reactions were written to `postLikes` and the trigger tried to update `posts/{storyId}`, which does not exist, causing failed invocations/retries |
| `index.html` | Added light/dark `theme-color`, inline SVG favicon, `<noscript>` message | Missing favicon request / no-JS blank page. Existing meta and entry script preserved |
| `.env.example` | Firebase web fields are now empty (were real project identifiers) | Spec: no real credentials in the example. Empty values let `src/firebase.ts` fall back to the bundled web config, so copying the file as-is is safe |
| `docs/…` | This report | — |

Rules from Prompt 01 (poll vote, event RSVP counters) were re-read and left as they are. No other rule edits were made: the remaining rules are default-deny with ownership checks, field allow-lists on updates and server-timestamp checks, and I could not validate further edits without the emulator.

## Review results (code reading)
**Authentication / roles.** Client `AdminRoute` is only a UX gate. Privileged actions are enforced server-side by Firestore rules (`adminRoles` doc or `adminRole` custom claim) and by callable Functions (`assertAdminRole` reads `adminRoles`); the backend `requireAdminRole` verifies Firebase ID tokens against Google certificates. Users cannot self-promote: `users` updates forbid changing `isVerified`, `isCreator`, `accountStatus`; `adminRoles` writes are super-admin only. Registration requires `isVerified:false, isCreator:false, accountStatus:'active'`, zero counters.

**Data model coverage.** Every collection the client touches has a rule (checked by script in Prompt 01). Conversations/messages, notifications, saved, likes, comments, stories, reels, communities, events, marketplace, ads, monetization and admin collections are present. "Pages" as a separate entity does not exist in the code; none was added.

**Admin dashboard.** Overview KPIs come from Firestore counts/queries; no `Math.random` or hard-coded statistics were found.

**Counters.** `likesCount`, `commentsCount`, followers, view counts are maintained by Cloud Functions triggers. **They do nothing until Functions are deployed (Blaze plan).** On Spark, stored counts stay stale; the UI only adjusts the local viewer's number.

## Remaining weaknesses (not changed; decision or setup needed)
1. Super-admin email is hard-coded in rules, storage rules, Functions, `src/firebase.ts`, backend config. Move to a custom claim.
2. `users`, `usernames`, `adminSettings`, `events`, `monetizationPolicies` are publicly readable by design. **Never store secrets in `adminSettings`** (currently only toggles/limits: platform, calling, marketplace, monetization, paymentGateways, payoutProviders).
3. `notifications` create allows any signed-in user to notify any recipient (actorId must be self) → spam/phishing risk via `linkUrl`/`body`. Mitigation requires Functions-created notifications.
4. Storage: messenger attachments and group avatars are readable by any signed-in user with the URL; fixing needs Firestore-backed Storage rules (Blaze + IAM) — not attempted untested.
5. Firebase API key should be restricted by HTTP referrer; App Check not enabled (site key empty).
6. Dual stack (Firebase + Supabase SQL/RLS + Express backend + Cloudflare Worker): policies must be kept consistent if more than one is used.

## Manual Firebase Console steps
1. Authentication → Sign-in method → enable **Email/Password**; Settings → Authorized domains → add your hosting domain.
2. Deploy: `firebase deploy --only firestore:rules,firestore:indexes,storage` (storage needs a provisioned bucket → Blaze, or use the R2/B2 broker).
3. For counters, notifications and admin callables: upgrade to Blaze, then `firebase deploy --only functions`, and set `VITE_ENABLE_CLOUD_FUNCTIONS=true`, `VITE_FIREBASE_PLAN_MODE=blaze`.
4. Create the first admin: sign in with the bootstrap email (must be email-verified), open Admin → RBAC, assign roles; the `syncAdminClaimsOnRoleWrite` function then sets the custom claim (Functions required).
5. Google Cloud Console → APIs & Services → Credentials → restrict the browser API key to your domains.
6. App Check: register a reCAPTCHA v3 site, set `VITE_FIREBASE_APPCHECK_SITE_KEY`, enforce gradually.
7. Backend (Render): set `FIREBASE_PROJECT_ID`, `CORS_ALLOWED_ORIGINS`, `SUPER_ADMIN_EMAILS`; leave `BANA_TEST_AUTH_SECRET` unset in production (now also ignored when `NODE_ENV=production`).

## Checks actually run
- Syntax parse (TypeScript) of edited files: no syntax errors.
- Earlier static scripts (import resolution, collection-vs-rules coverage, secret scan): passed in Prompt 01; re-run not needed for this small diff.
- **Not run:** type-check, build, rules emulator, backend tests, Functions build, any live login/registration/password-reset, read/write, or admin-permission test.

## Files changed in this phase
`backend/src/middleware/auth.ts`, `functions/src/index.ts`, `index.html`, `.env.example`, `docs/PROMPT_03_SECURITY_AND_INTEGRATION_REPORT.md`.
(Earlier phases: `firestore.rules`, `src/components/feed/PostCard.tsx`, `src/components/layout/{AppShell,NotificationPopup}.tsx`, `src/pages/NotificationsPage.tsx`.)
