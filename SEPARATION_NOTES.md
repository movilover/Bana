# BANA User Website (BANA_USER_WEBSITE_ONLY)

Independent User Website project. The Admin Panel and the Firebase security files were separated out; this package changed nothing else in business logic.

**Removed (now in other packages):** `src/pages/AdminPage.tsx`, `src/components/admin/*` (20), `src/lib/adminAlerts.ts`, `src/lib/adminRbac.ts`,
`src/lib/storage/databaseBackup.ts`, `src/lib/storage/recoveryEngine.ts`, `src/lib/videoModeration.ts` (all reachable only from the admin page);
`firestore.rules`, `storage.rules`, `firestore.indexes.json`, `functions/`, `tests/security/`, `security/`, rules scripts and migrations, `deploy-firebase-rules.yml` (-> Security package);
`scripts/create-release-zip.mjs` + `release:zip` (obsolete multi-bundle script).

**Edited:** `App.tsx` (no `/admin` route), `AppShell.tsx` + `ProfileDropdown.tsx` (admin link opens the separate Admin site when `VITE_ADMIN_URL` is set, admins only),
`package.json` scripts, `firebase.json` (Hosting block only), `scripts/verify-export.mjs` (required-file list), `.github/workflows/*`, `.env.example` (+`VITE_ADMIN_URL`),
`tests/verification/video-rules-parity.test.mjs` (reads rules from `../BANA_SECURITY_FIREBASE_FILES/firestore.rules` or `FIRESTORE_RULES_PATH`; skipped, not passed, when missing).

**Kept here on purpose:** `backend/` (Render), `workers/`, `render.yaml`, `database/`, `deployment/`, `api-providers/` (not assigned by the four-package layout; they serve the user site).
The original project docs (*.md) are unchanged and may still mention the old `/admin` route.

Update workflow: edit here -> `npm ci && npm run lint && npm run build` -> push. Rules/indexes: see the Security package. Shared values: its `COORDINATION.md`.

**CORS reminder:** the Render backend (`CORS_ALLOWED_ORIGINS`) and the media broker worker (`ALLOWED_ORIGINS` in `workers/bana-media-broker/wrangler.toml` / Cloudflare vars) each keep their own origin list; both must include the Admin site's origin.
