# BANA — Deployment Guide

> **Nothing in this package deploys anything.** Every step below that touches a live account, database, DNS
> record or billing is marked **🔐 MANUAL** (needs your credentials/approval) or **💰 COST** (may cost money).
> Do not run those steps until you have decided to.

## 0. What you are deploying — and what talks to what

BANA is **one frontend build** (User Website + Admin Panel + Super Admin Panel, role-gated) plus optional services.

```
                      ┌────────────────────────────┐
 Browser ───────────► │ Static host: Firebase Hosting│  (dist/ — SPA, needs index.html fallback)
   │                  │ / Cloudflare Pages / Pages   │
   │                  └────────────────────────────┘
   ├──► Firebase Auth + Firestore + Storage   (required; rules/indexes you deploy)
   ├──► Realtime backend on Render (optional)  wss + /api/*   ← verifies Firebase ID tokens
   ├──► Media broker Cloudflare Worker (optional) ← presigned URLs → R2 / B2 / S3
   ├──► Cloud Functions (optional, Blaze)      ← payments, payouts, role claims
   └──► TURN server / LiveKit (optional)       ← reliable calls
```

| Piece | Can deploy separately? | Must talk to |
|---|---|---|
| Frontend (`dist/`) | Yes — any static host | Firebase; optional backend/worker via `VITE_*` URLs |
| Backend (`backend/`) | Yes — needs a Node host (**not** GitHub Pages) | Firebase (token verification), TURN/LiveKit, Supabase (optional); must allow the frontend origin via CORS |
| Worker (`workers/bana-media-broker`) | Yes | Storage providers; must allow the frontend origin |
| Functions (`functions/`) | Yes, with Firebase | Firestore |
| Supabase SQL | Optional | Backend (optional) |

GitHub Pages can host **only** the static frontend. It cannot run `backend/`.

## 1. Extract the project
```bash
unzip BANA-FULL-PROJECT-prompt11.zip -d bana && cd bana
```

## 2. Install dependencies
```bash
npm ci
npm ci --prefix backend       # if you will deploy the backend (use npm install --legacy-peer-deps if ci complains)
```

## 3. Configure environment variables
Copy `.env.example` → `.env.production.local` (git-ignored). Details: `ENVIRONMENT.md`.
For Spark (free) mode leave Functions disabled:
```env
VITE_FIREBASE_PLAN_MODE="spark"
VITE_ENABLE_CLOUD_FUNCTIONS="false"
VITE_BACKEND_URL=""            # fill after step 12
VITE_MEDIA_BROKER_URL=""       # fill after the worker is deployed
```
Before going live, replace the bootstrap Super Admin email in all files listed in `ENVIRONMENT.md` §6.

## 4. Configure the database — 🔐 MANUAL
Firestore (primary):
```bash
npx firebase login
npx firebase use <your-project-id>        # default in .firebaserc is bana-a5770
npx firebase deploy --only firestore:rules,firestore:indexes
```
Run `npm run test:rules` first (needs Java) and fix any failure. Optional Supabase: apply
`database/supabase/migrations/001…004` in order (see `DATABASE.md`).

## 5. Configure authentication — 🔐 MANUAL
Firebase Console → Authentication → enable the sign-in methods you use (Email/Password, Google).
Add your production domains under Authentication → Settings → Authorized domains. Optionally enable App Check
and restrict the web API key by referrer.

## 6. Configure storage — 🔐 MANUAL (💰 depends on plan/provider)
- Firebase Storage rules: `npx firebase deploy --only storage` (check current plan requirements for Cloud Storage).
- Multi-cloud: create R2/B2/S3 buckets, then follow `STORAGE_PROVIDER_SETUP.md`. Keys go into the worker with
  `npx wrangler secret put …` — never into `VITE_*`.

## 7. Configure API providers — 🔐 MANUAL
Built-in WebRTC + Firestore signaling needs nothing. Add TURN (`TURN_URLS`, `TURN_SHARED_SECRET`) for reliable
calls. LiveKit is optional. Agora/100ms stay blocked until an admin approves billing. Payment gateways
(Functions, Blaze) only if contracted.

## 8–10. Build the application
```bash
npm run lint && npm run build        # produces dist/ — contains User Website, Admin Panel and Super Admin Panel
npm run --prefix backend build       # backend/dist/
```
There are not three separate frontend builds; `/admin` inside `dist/` is the Admin/Super Admin Panel.

## 11. Deploy the frontend — 🔐 MANUAL
Choose one:

**Firebase Hosting** (`firebase.json` already has SPA rewrite, security headers, asset caching)
```bash
npx firebase deploy --only hosting
```
**Cloudflare Pages:** build command `npm run build`, output `dist`, copy `deployment/cloudflare-pages/_redirects`
into `public/` (or `dist/`) for SPA fallback.
**GitHub Pages:** run the manual `deployment/github/pages-deploy.yml` workflow (copy it into
`.github/workflows/`). It publishes `dist` and adds a `404.html` fallback. Use a custom domain or a root
(`user.github.io`) site: a project sub-path (`/repo/`) needs a Vite `base` and router `basename`, which are not
configured.

## 12. Deploy the backend (optional) — 🔐 MANUAL, 💰 free tier sleeps
Render → New → Blueprint → connect the repo; `render.yaml` sets root `backend`, build
`npm install && npm run build`, start `npm start`, health check `/health`. Set the `sync: false` variables in the
dashboard (see `ENVIRONMENT.md` §2) including `CORS_ALLOWED_ORIGINS` and **your own** `SUPER_ADMIN_EMAILS`.
Then set `VITE_BACKEND_URL` to the Render URL and rebuild/redeploy the frontend.
Render's free web service sleeps when idle (cold starts, dropped WebSockets); a paid instance is needed for
always-on calling signaling.

Worker (optional):
```bash
cd workers/bana-media-broker && npm install && npx wrangler login && npx wrangler deploy
```
Set `ALLOWED_ORIGINS` to your frontend origin(s) first.

Cloud Functions (optional, Blaze): `npm --prefix functions run build && npx firebase deploy --only functions`,
then set `VITE_ENABLE_CLOUD_FUNCTIONS="true"` and `VITE_FIREBASE_PLAN_MODE="blaze"`.

## 13. Connect the domain — 🔐 MANUAL
Add the custom domain in your host (Firebase Hosting / Cloudflare Pages / GitHub Pages), create the DNS records the
host shows you, wait for HTTPS issuance, then add the domain to Firebase Auth authorized domains and to
`CORS_ALLOWED_ORIGINS` / worker `ALLOWED_ORIGINS`. Changing DNS affects live traffic — do it deliberately.

## 14. Verify the deployed application
1. `GET https://<backend>/health` → `{"status":"ok",…}` (and worker `/health`).
2. Open the site, deep-link `/discover` and refresh — no 404.
3. Register/log in; confirm the Super Admin can open `/admin` and a normal user cannot.
4. Admin → API Management → Test Connection on `webrtc_builtin` and each configured provider.
5. Two devices: chat, voice note, 1-to-1 call (test across different networks to prove TURN), group call.
6. Browser console: no CORS or `permission-denied` errors.
7. Check the Firebase/Render/Cloudflare usage dashboards against the free-tier limits.

## Rollback
Firebase Hosting keeps release history (roll back in the console). Redeploy the previous Render commit. Keep a
copy of `firestore.rules` before every rules deployment.
