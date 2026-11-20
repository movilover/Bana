# BANA — Prompt 01 Audit Report (static review)

**Scope & honesty note.** This audit was a *static* review of the uploaded `BANA-FULL-PROJECT.zip`
(~185 files, ~48k lines). The review environment had **no access to the npm registry**, so dependencies
could not be installed and **`npm run lint`, `npm run build`, the rules-emulator tests, the backend tests and
any browser/mobile testing were NOT run**. Nothing below is claimed as "tested" unless stated.

## What was actually checked
| Check | Result |
|---|---|
| Frontend import resolution (`@/…` and relative) across `src/`, `tests/`, `scripts/` | **0 broken imports** (backend `.js` specifiers resolve to `.ts` — normal for NodeNext/ESM) |
| Firestore collections used by client vs. `firestore.rules` | **All 78 collections used by the client have rules** (default-deny catch-all present) |
| Secret scan (private keys, service-account JSON, AWS/Stripe keys) | **None found.** Only the public Firebase *web* config appears (see Findings) |
| Routes in `App.tsx` | discover, reels, communities (+events tab), market, messages, notifications, saved, creator-studio, advertise, profile, settings, login/register/forgot, admin — protected/admin/feature-flag wrappers present |
| Syntax check of edited TypeScript (`auth.ts`) | No syntax errors (type-check not run) |

## Feature status (from code inspection — NOT runtime-verified)
Legend: **Wired** = real Firestore/Storage reads+writes found in code and covered by rules; *unverified at runtime*.

| Requirement | Status |
|---|---|
| Home feed / Smart Discovery (`DiscoverPage`) | Wired |
| Registration / login / forgot password | Wired (email+password; email verification gates posting/events via rules) |
| Profiles, friends & follow (`socialGraph.ts`, `friendRequests`, `userFollows`, `followRequests`) | Wired |
| Posts with images/videos, polls | Wired; media upload depends on storage provider config (see below) |
| Stories (24h, views, replies, backups) | Wired |
| Reels + full-screen video | Wired |
| Likes / comments / saved | Wired |
| Shares | Share-to-Messenger + native `navigator.share` wired; **no public share counter found** |
| Voice comments / voice messages | Wired (MediaRecorder + `voiceComments`, audio storage rules) |
| Messenger, notifications | Wired (also WebRTC calling, beyond Prompt 01) |
| Communities / groups | Wired |
| Marketplace | Wired |
| Events | Wired, but lives at `/communities?tab=events` (no dedicated `/events` route) |
| Creator Studio, Advertising, Monetization applications | Wired (large pages; runtime behaviour unverified) |
| Admin dashboard | Wired; served at `/admin` inside the same SPA (not a separate admin site) |

## Findings and what was changed
**Fixed in this archive**
1. `backend/src/middleware/auth.ts` — operator-precedence bug: `a || b ? 'admin' : undefined` granted `'admin'` to any Supabase JWT carrying *any* `app_metadata.adminRole` and dropped the real role. Now uses the actual role string, or `admin` only for `service_role`.
2. `backend/src/middleware/auth.ts` — the HS256 test-token path is now disabled when `NODE_ENV=production`, even if `BANA_TEST_AUTH_SECRET` is set.
3. `firestore.rules` (`posts`) — poll voting previously let any signed-in user rewrite `pollOptions`/`pollVoters` freely. Now: option count must be unchanged, one vote per user, and only the caller's own `pollVoters` key may be added.
4. `firestore.rules` (`events`) — any signed-in user could set `attendeesCount`/`interestedCount` to arbitrary values. Now: active accounts only, ±1 per counter, never negative.

> Items 3–4 are **untested** (no emulator available). Run `npm run test:rules` and manually test poll voting and event RSVP before deploying.

**Found but NOT changed (needs your decision / external setup)**
- **Hard-coded super-admin email** in `firestore.rules`, `storage.rules`, `functions/src/index.ts`, `src/firebase.ts`, `backend/src/config.ts`. Works, but better moved to a custom claim (`adminRole`) set once via Admin SDK.
- **Firebase web config** (apiKey etc.) is committed in `.env.example` and as fallbacks in `src/firebase.ts`. These are public identifiers, not secrets, but restrict the API key by HTTP referrer in Google Cloud and enable **App Check** (code supports it; `VITE_FIREBASE_APPCHECK_SITE_KEY` is empty).
- **`users` and `usernames` are world-readable** (`allow get, list: if true`). Email is stored in private `userSettings`, so no email leak found, but any public profile field is enumerable.
- **Storage:** messenger attachments and group avatars are readable by *any* signed-in user who has the URL (not scoped to conversation members).
- **Event RSVP / counters** swallow errors with `.catch(() => {})` in `src/lib/communities.ts`, so a failed counter update is silent.
- **Firebase Storage requires the Blaze plan.** The project defaults to Spark mode and routes media through the optional Cloudflare R2/B2 broker (`workers/bana-media-broker`). Until `VITE_MEDIA_BROKER_URL` (or Blaze + Storage) is configured, uploads will not work.
- **Cloud Functions** (`functions/`) are disabled by default (`VITE_ENABLE_CLOUD_FUNCTIONS=false`) and need Blaze to deploy; counters/moderation that rely on them won't run on Spark.
- Backend tokens without an `exp` claim (Supabase/test paths) are accepted without expiry — recommend requiring `exp`.
- Architecture drift: the original plan was React + Firebase; the project also contains Supabase SQL, an Express/WebSocket backend and a Cloudflare Worker. Rules/RLS must be kept in sync if both are used.
- `package.json` still named `react-example`; `@google/genai`, `motion`, `express`, `dotenv` appear unused by `src/` (left alone — changing deps would desync the lockfile without an install).

## Needs external configuration
Deploy `firestore.rules`, `firestore.indexes.json`, `storage.rules`; set `VITE_*` env vars; enable Email/Password auth; (optional) App Check key, Media Broker Worker URL, Render backend, Supabase.

## Tests actually completed
- Import-resolution script (frontend): passed.
- Collection-vs-rules coverage script: passed.
- Secret pattern scan: passed.
- TS syntax check of edited file: passed.
- **Not completed:** type-check, production build, rules emulator tests, backend tests, console/browser/mobile checks.
