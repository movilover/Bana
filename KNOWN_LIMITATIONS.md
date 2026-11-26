# BANA — Known Limitations

Be honest with yourself about these before launch. Items are grouped by cause.

## A. Verification gaps in this export

1. **No build or test was run for Prompt 11.** The packaging environment had no network access, so
   `npm install` could not fetch packages. `npm run lint`, `npm run build`, backend build, backend/storage
   tests and rules tests were therefore **not executed here**. Prompt 10 reported them passing; run
   `npm run check` yourself after `npm install`. Static checks that *were* done: 653 local imports in 136
   source files resolve, referenced image assets exist, JSON config files parse, rules braces balance,
   no duplicate files, secret pattern scan.
2. Firestore/Storage rules have never been run against the emulator.
3. Browser/E2E testing (auth, posts, messenger, calls, admin, responsive layouts) has not been done.
4. Firestore index coverage for every query is unverified; some screens may need extra indexes.
5. SQL migrations were not executed on a real PostgreSQL/Supabase instance.
6. No dependency audit, load test or penetration test.

## B. Architecture

1. User Website, Admin Panel and Super Admin Panel are **one SPA build**. They cannot be deployed separately
   without refactoring (separate entry points, routing and shared-code packaging).
2. The Supabase schema covers messaging/calling/provider logging only; marketplace, communities, reels,
   monetization and RBAC data exist only in Firestore.
3. `vite.config.ts` includes a dev-server-only `/downloads` plugin for release ZIPs; it is inert in production builds.

## C. Hard-coded project values

The bootstrap Super Admin email and Firebase project `bana-a5770` (with its public web config) appear in rules,
code, docs and config (full list in `ENVIRONMENT.md` §6). Replace them before using a different account/project.
A retirement path for the bootstrap e-mail exists (Admin → Roles → "Super Admin bootstrap", `docs/SUPER_ADMIN_RECOVERY.md`)
but it is **not** retired by default.

**CORS (corrected — earlier text here said the worker ships as `*`, which was wrong):**
- `workers/bana-media-broker/wrangler.toml` ships an explicit allow-list
  (`https://bana-a5770.web.app, https://bana-a5770.firebaseapp.com, http://localhost:3000`); the code default is the same two
  production origins. `*` is honoured only if you put it in `ALLOWED_ORIGINS` yourself — do not.
- The Node backend reads `CORS_ALLOWED_ORIGINS` (default `http://localhost:3000,https://bana-a5770.web.app`). It is only needed
  when you run the optional backend; set your own exact origins in production. Same `*` caveat.

## D. Hosting and plan limits (verify current numbers on each provider's pricing page)

| Service | Constraint to expect |
|---|---|
| GitHub Pages | Static files only; cannot run the backend; usage limits apply; needs SPA fallback handling (`404.html` trick or `deployment/github/pages-deploy.yml`) |
| Firebase Spark | No Cloud Functions (needs Blaze); Firestore/Storage have daily quotas; Cloud Storage plan requirements have changed — check before relying on it. Payments, server-side payouts, claims sync and Function triggers do not run on Spark |
| Render free web service | Sleeps after inactivity, so the first request (and live WebSocket sessions) are slow or dropped; limited monthly instance hours; ephemeral filesystem; in-memory room/rate-limit state is lost on restart and not shared across instances |
| Supabase free | Small database/storage quotas; free projects can be paused after inactivity; per-file upload limit |
| Cloudflare Workers/R2, Backblaze B2 | Free tiers have request/storage caps; R2/B2 setup requires an account (card may be requested) |
| WebRTC | STUN alone fails behind symmetric NAT/corporate firewalls; reliable calls need a TURN server (Coturn on a VPS you pay for) or a paid SFU provider. Mesh group calls degrade above a handful of participants |
| Paid providers (Agora, 100ms, SSLCommerz, bKash, Nagad, Stripe) | Not active by default; need contracts and keys |

Do not assume "free unlimited hosting" for any of the above.

## E. Functional gaps

- No automated creator payouts: payouts are admin-recorded manual transfers.
- Push notifications need VAPID keys and a deployed backend.
- No Content-Security-Policy header yet.
- Main JS chunks are large (Firebase ≈ 628 kB, admin ≈ 293 kB per the Prompt 10 build report) and unprofiled.

## F. Prompt 01–03 remediation — remaining limitations (honest list)
**Verification status of the remediation itself**
- The remediation was authored without network access / Firebase emulator. `npm run lint`, `npm run build`, `npm run test:rules` (original assertions and all new ones) were **not executed** by the author. Executed: the 49 logic/parity tests (`npm run test:verification`, pass), `node --check` on all tests/scripts, `npm run validate:indexes`, a syntax-only TypeScript pass. **The project is not verified.** Run `npm install && npm run check && npm run test:rules` (exact steps: `docs/TESTING_AND_DEPLOYMENT_GUIDE.md`) and fix what fails.
- No browser/E2E/mobile/desktop UI testing was performed.

**Hard limits of Firebase Spark (cannot be fixed without a trusted server)**
- `watchMs`, plays and every video counter are **client-reported**. Rules bound them (one event per viewer/video/day, plausible
  ranges, duration must match the stored parent duration) but cannot prove playback. Never use them for payouts/monetization decisions.
- `friendSuggestionStats` and `videoStats(Public)` counters are client-written and bounded; treat as approximate.
- Ranking runs on the client, so ranking aggregates (`videoStatsPublic`: plays, valid views, watch time, completions, rewatches,
  skips, not-interested, hides, distStatus) are readable by signed-in users. Private analytics (unique viewers, reports,
  moderation reason) are owner/admin-only.
- Reports are de-duplicated per reporter/target and never restrict content automatically, but a coordinated group of real accounts
  can still file many reports; a moderator must review. There is no per-reporter daily quota (rules cannot count).
- Public profiles (`users`) remain readable by anyone, including guests, because guest Discover/profile viewing is a product
  feature. Only profile-level public data is stored there; private fields live in `userPrivate`.

**Data model transitions that need your action (all dry-run by default; nothing runs automatically)**
- Run `scripts/migrate-video-stats-public.mjs` and `scripts/migrate-user-private-fields.mjs` (dry-run first) after deploying; see `MIGRATION_AND_ROLLBACK.md`.
- Friend lists of existing friendships appear on other people's profiles only after each user has opened the app once
  (lazy `friendLinks` backfill). Fails closed (hidden), never open.
- Deploy `firestore.indexes.json` before using the new admin filters and the hides list (`docs/TESTING_AND_DEPLOYMENT_GUIDE.md` §6). Your original index file contained one single-field index the Firebase CLI rejects; it was removed.
- `.firebaserc` `default` is your production project; always pass `--project` when deploying.

**Verified badge placement (decided, with reasons)**
- Live badge (`LiveVerifiedBadge`, server-authoritative, one shared listener per user, 5-minute one-shot fallback when many) is now shown wherever a *person's* name is shown: Search, Profile dropdown, People You May Know, Profile friend/follower lists and labels, Messenger (1:1 list row, 1:1 header, group sender names, new-chat picker), Communities (member list, invite list, group chat sender names), Stories (viewer header), Product detail (seller).
- **Not shown in Notifications:** the person's name is inside a composed sentence/title (and many notices are system messages), so a badge cannot be attached to the right words without redesigning the notification model.
- **Not shown in Storefront:** the badge means "this *account* is verified"; a store name is not an account, and the page shows no owner name. Showing it next to the store name would imply the *store* is verified.
- Client-written `authorVerified` copies on posts/reels/messages still exist for legacy reasons; the UI ignores them. Group-chat and story-tray avatars/labels where only a first name is shown were not changed.

**Hidden creators / dismissed posts (corrected statement)**
- The earlier report called these arrays "capped". They were actually **unbounded** arrays inside the single `userSettings` document (rewritten in full on every change, limited only by Firestore's 1 MiB document size). They now live in `feedHides/<uid>_<kind>_<id>` (one document each, owner-only, newest 3000 read per session, cached). Existing array values are still read and merged, so nothing reappears; "show again" and "reset recommendations" clear both. Guests (not signed in) still use localStorage as before.
- A user with more than 3000 hides would see only the newest 3000 applied; this is an intentional read bound to protect the Spark read quota.

**Not implemented — personal watch-history and community/page-follow ranking signals**
- Neither signal exists in the ranking. The only "history" in use is a local, on-device list of recently shown videos (to avoid repeats); it is not uploaded and is not a preference signal.
- They were deliberately **not** added because they require reading or storing personal behavioural data (what a person watched; which communities/pages they belong to — memberships can be private). That needs, at minimum: an explicit opt-in switch in Settings (default OFF), a clear explanation of what is used, owner-only storage with a "clear my history" action, no use of private or secret communities, no access to messages or unrelated private content, and rules tests for all of it. Until then no private data is accessed for ranking.
- Existing consent-free signals that remain: follows, declared interests, category weights, public engagement counters, not-interested/hide feedback, and the optional browser-language hint.

**Other open items**
- Video language is a script-based heuristic (Bengali vs Latin) on captions/titles and a mild optional ranking hint only.
- The admin Smart Video list shows rows without a stored duration as "unknown"; duration-dependent suspicion checks are skipped for them.
