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
Worker `ALLOWED_ORIGINS` ships as `*`.

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
