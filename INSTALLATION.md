# BANA — Installation Guide

This guide takes you from a freshly extracted ZIP to a running local copy of BANA.
Nothing here deploys anything or spends money. See `DEPLOYMENT.md` for hosting.

## 1. Prerequisites

| Tool | Version | Needed for |
|---|---|---|
| Node.js | 22 LTS (CI uses 22) | Frontend, backend, tests |
| npm | 10+ | Package install |
| Node.js 20 | only for `functions/` (`engines.node = 20`) | Firebase Cloud Functions (Blaze only) |
| Firebase CLI | latest (`npm i -g firebase-tools`) | Rules, indexes, hosting, emulators |
| Java JRE 11+ | for `npm run test:rules` | Firebase emulators |
| Wrangler | via `npx wrangler` | Optional Cloudflare media-broker worker |
| Supabase CLI | optional | Only if you use `database/supabase/` |

## 2. Extract

```bash
unzip BANA-FULL-PROJECT-prompt11.zip -d bana
cd bana
```

## 3. Install dependencies

BANA has four independent `package.json` files. Install only what you need.

```bash
npm install                                   # Frontend (User site + Admin + Super Admin SPA) and shared scripts
npm install --prefix backend --legacy-peer-deps   # Optional realtime/calling backend
npm install --prefix functions                # Optional Cloud Functions (needs Blaze to deploy)
npm install --prefix workers/bana-media-broker    # Optional Cloudflare Worker (if installed separately)
```

Use `npm ci` in CI or when you want the exact lockfile versions.

## 4. Configure environment

```bash
cp .env.example .env.local                    # Frontend
cp backend/.env.example backend/.env          # Backend (optional)
cp workers/bana-media-broker/.dev.vars.example workers/bana-media-broker/.dev.vars   # Worker (optional)
```

Every variable is explained in `ENVIRONMENT.md`. The frontend runs with all `VITE_*`
values empty because `src/firebase.ts` falls back to the bundled public Firebase web config.
Never commit `.env*`, `.dev.vars`, or service-account JSON files (the `.gitignore` blocks them).

## 5. Run locally

```bash
npm run dev                                   # http://localhost:3000
npm run --prefix backend dev                  # http://localhost:8788  (optional)
```

To make the frontend use the local backend, set `VITE_BACKEND_URL="http://localhost:8788"`
in `.env.local` and restart `npm run dev`. Leave it empty to use Firestore-only signaling.

## 6. Build

```bash
npm run lint                                  # tsc --noEmit
npm run build                                 # outputs dist/
npm run --prefix backend build                # outputs backend/dist/
npm run --prefix functions build              # outputs functions/lib/
```

## 7. Test

See `TESTING.md`. Short version: `npm run check` (lint + build + backend tests + storage tests)
and `npm run test:rules` (needs Java + Firebase emulators).

## 8. Verify the export package

```bash
npm run verify:export                         # required-file check + secret-pattern scan
```

## 9. Troubleshooting

| Symptom | Fix |
|---|---|
| `npm install` fails on peer deps in `backend/` | Use `--legacy-peer-deps` |
| Blank page after build on a sub-path host | Set Vite `base` (see `DEPLOYMENT.md` §Frontend) |
| 404 on refresh of `/admin` | Host needs SPA fallback to `index.html` (Firebase: already configured) |
| Login fails | Enable Auth providers in Firebase Console (see `DEPLOYMENT.md`) |
| `permission-denied` | Rules/indexes not deployed yet to the target project |
| Calls connect only on same network | TURN not configured (see `ENVIRONMENT.md` → TURN) |
