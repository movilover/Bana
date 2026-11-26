# BANA — Environment Variables

Rules that apply everywhere:

- Only `*.example` files are committed. Real values live in your host's secret store.
- `VITE_*` variables are compiled into the public JavaScript bundle. **Never put a secret in a `VITE_*` variable.**
- Firebase *web* config values (`apiKey`, `appId`, …) are public identifiers, not secrets; access is enforced by security rules.

## 1. Frontend (`.env.local` / host build variables)

| Variable | Required | Purpose |
|---|---|---|
| `APP_URL` | optional | Public URL of the app |
| `VITE_FIREBASE_API_KEY`, `_AUTH_DOMAIN`, `_PROJECT_ID`, `_STORAGE_BUCKET`, `_MESSAGING_SENDER_ID`, `_APP_ID`, `_MEASUREMENT_ID` | optional | Point the app at a different Firebase project. Empty = bundled `bana-a5770` web config |
| `VITE_FIREBASE_DATABASE_ID` | optional | Named Firestore database; empty = `(default)` |
| `VITE_FIREBASE_APPCHECK_SITE_KEY` | optional | reCAPTCHA v3 site key for App Check |
| `VITE_FIREBASE_PLAN_MODE` | optional | `spark` (default) or `blaze` |
| `VITE_ENABLE_CLOUD_FUNCTIONS` | optional | `false` (default); set `true` only after `functions/` is deployed |
| `VITE_ENABLE_CLOUDFLARE_STREAM` | optional | `false` (default) |
| `VITE_MEDIA_BROKER_URL` | optional | URL of the Cloudflare media-broker worker |
| `VITE_BACKEND_URL` | optional | URL of the Express/WebSocket backend; empty = Firestore signaling |
| `VITE_CALLING_PROVIDER` | optional | Default `webrtc_builtin` |

## 2. Backend (`backend/.env`, or Render environment)

| Variable | Secret | Purpose |
|---|---|---|
| `PORT` | no | Listen port (Render injects its own; `render.yaml` sets 10000) |
| `NODE_ENV` | no | `production` in hosting |
| `CORS_ALLOWED_ORIGINS` | no (but set it in production) | Comma-separated exact origins of your frontend(s). Default: `http://localhost:3000,https://bana-a5770.web.app`. Never use `*` in production |
| `FIREBASE_PROJECT_ID` | no | Used to verify Firebase ID tokens |
| `SUPER_ADMIN_EMAILS` | no | Comma-separated bootstrap Super Admin emails. **Set your own.** |
| `RATE_LIMIT_MAX_PER_MIN`, `TOKEN_RATE_LIMIT_PER_MIN` | no | Rate limits (code defaults apply when unset) |
| `BANA_TEST_AUTH_SECRET` | yes | Test-only HMAC token secret. **Do not set in production** |
| `TURN_URLS`, `TURN_SHARED_SECRET` | secret | Coturn REST credentials |
| `LIVEKIT_WS_URL`, `LIVEKIT_HTTP_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET` | key + secret | LiveKit SFU (optional) |
| `AGORA_APP_ID`, `AGORA_APP_CERTIFICATE` | secret | Paid; blocked until an admin approves billing |
| `HMS_ACCESS_KEY`, `HMS_APP_SECRET`, `HMS_TEMPLATE_ID` | secret | Paid (100ms); same billing gate |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | no | Optional Supabase integration |
| `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET` | **secret** | Server-side only, bypasses RLS |
| `SUPABASE_STORAGE_BUCKET` | no | Default `bana-media` |
| `MEDIA_BROKER_URL` | no | Worker URL |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | private key secret | Web Push |

## 3. Cloudflare Worker (`workers/bana-media-broker`)

Non-secret `[vars]` live in `wrangler.toml`. Secrets are set with `npx wrangler secret put NAME`
(or `.dev.vars` for local `wrangler dev` only).

| Group | Variables |
|---|---|
| General | `FIREBASE_PROJECT_ID`, `ALLOWED_ORIGINS` (**change from `*` for production**) |
| Cloudflare R2 | `R2_ENDPOINT`, `R2_BUCKET`, `R2_REGION`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_PUBLIC_BASE_URL` |
| Backblaze B2 | `B2_ENDPOINT`, `B2_BUCKET`, `B2_REGION`, `B2_KEY_ID`, `B2_APPLICATION_KEY`, `B2_PUBLIC_BASE_URL` |
| Google Cloud Storage (optional) | `GCS_*` (endpoint, bucket, region, access key id, secret, public base URL) |
| Supabase Storage S3 (optional) | `SUPABASE_*` (endpoint, bucket, region, access key id, secret, public base URL) |
| Generic S3 (optional) | `GENERIC_S3_*` |

## 4. Cloud Functions (Blaze plan only)

Read by `functions/src/index.ts` from the function runtime environment: `SSLCOMMERZ_STORE_ID`,
`SSLCOMMERZ_STORE_PASS`, `BKASH_APP_KEY`, `BKASH_APP_SECRET`, `NAGAD_MERCHANT_ID`, `NAGAD_PRIVATE_KEY`,
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `TURN_URLS`, `TURN_SHARED_SECRET`.
Set only the providers you actually contract with. Without them BANA records manual settlements.

## 5. GitHub Actions

| Name | Type | Used by |
|---|---|---|
| `ENABLE_FIREBASE_DEPLOY` | repository **variable** (`true`) | Opt-in switch for the Hosting deploy job (off by default) |
| `VITE_BACKEND_URL`, `VITE_MEDIA_BROKER_URL` | repository variables | Build-time frontend values |
| `FIREBASE_SERVICE_ACCOUNT` | repository **secret** | Firebase Hosting deploy |

## 6. Hard-coded values to review before going public

| Where | Value | Action |
|---|---|---|
| `firestore.rules`, `storage.rules` | Bootstrap Super Admin email | Replace with your own (rules cannot read env vars) |
| `src/firebase.ts`, `functions/src/index.ts`, `workers/bana-media-broker/src/index.ts`, `backend/src/config.ts` | Same email constant/default | Replace consistently |
| `render.yaml`, `backend/.env.example`, docs | Same email | Replace |
| `workers/bana-media-broker/wrangler.toml` | `ALLOWED_ORIGINS = "*"` | Restrict to your frontend origins |
| `.firebaserc`, `src/firebase.ts` | Project `bana-a5770` and its web config | Replace if you use a different Firebase project |
