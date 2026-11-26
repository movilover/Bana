# BANA — Project Structure

BANA is a **single Vite + React 19 SPA** that serves the User Website, the Admin Panel and the Super Admin
Panel from one build. The panels are role-gated routes/modules inside that app, not separate builds.
Splitting them into three deployables would change routing, auth and build config and was deliberately **not**
done, to preserve the working architecture (see `KNOWN_LIMITATIONS.md`).

## Where each part lives

| Part | Location |
|---|---|
| User Website | `src/pages/*` (Discover, Reels, Communities, Market, Messenger, Notifications, Saved, Creator Studio, Advertise, Profile, Settings, Auth), `src/components/{feed,reels,social,marketplace,communities,messenger,monetization,ads,create,auth,voice}` |
| Layout & routing | `src/App.tsx` (React Router; `ProtectedRoute`, `AdminRoute`, `FeatureRoute`), `src/components/layout/*` |
| Admin / Super Admin Panel | `src/pages/AdminPage.tsx` at `/admin`; modules in `src/components/admin/*` (Overview, Users, Content, Reports, Verifications, Market & Community, Monetization/Ads/Finance, Messenger & Calling, API Management, Storage & Recovery, Platform Settings, RBAC, Logs & Notifications, Alerts) |
| Role & permission logic | `src/lib/adminRbac.ts` (module/action matrix), `src/lib/adminAlerts.ts`; Super Admin = `super_admin` role |
| Auth integration | `src/contexts/AuthContext.tsx`, `src/pages/AuthPages.tsx`, `src/components/auth/*`, `src/firebase.ts` |
| Shared | `src/components/common`, `src/contexts`, `src/lib`, `src/types`, `src/assets`, `src/index.css` |
| Storage / backup engine | `src/lib/storage/*` (providers, adapters, SigV4, checksum, backup, recovery) |
| Calling client | `src/lib/calling/*`, `src/lib/webrtcCalling.ts`, `src/contexts/CallContext.tsx` |
| Backend | `backend/` (Express + WebSocket) |
| Cloud Functions | `functions/` (Blaze plan) |
| Media broker worker | `workers/bana-media-broker/` |
| Database & rules | `firestore.rules`, `firestore.indexes.json`, `storage.rules`, `firebase-blueprint.json`, `database/supabase/` |
| Security docs | `security/` |
| Provider catalogs | `api-providers/` |
| Deployment config | `firebase.json`, `.firebaserc`, `render.yaml`, `deployment/{github,render,supabase,cloudflare-pages}`, `.github/workflows/ci-and-deploy.yml` |
| Tests | `tests/{calling,security,storage}` |
| Scripts | `scripts/` (`create-release-zip.mjs`, `backup-manifest-cli.mjs`, `migrate-media-refs.mjs`, `verify-export.mjs`) |
| Docs | Root `*.md` guides and `docs/` (architecture blueprint, per-prompt reports) |

## Entry points

| Target | Entry | Build output |
|---|---|---|
| Frontend | `index.html` → `src/main.tsx` → `src/App.tsx` | `dist/` |
| Backend | `backend/src/server.ts` | `backend/dist/server.js` |
| Functions | `functions/src/index.ts` | `functions/lib/index.js` |
| Worker | `workers/bana-media-broker/src/index.ts` | deployed by Wrangler |

## Dependency boundaries

- Frontend → Firebase (Auth/Firestore/Storage/Functions) directly; optionally → backend (`VITE_BACKEND_URL`) and
  media broker (`VITE_MEDIA_BROKER_URL`).
- Backend, Functions and Worker do **not** import from `src/`; each has its own `package.json`.
- `tsconfig.json` excludes `functions`, `workers`, `backend` from the frontend type-check.

## Repository-level generated files (not committed)

`dist/`, `backend/dist/`, `functions/lib/`, `node_modules/`, `BANA-*.zip` — all git-ignored.
