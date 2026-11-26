# BANA — API Documentation

BANA exposes three server-side surfaces. All are **optional**: the app runs on Firestore alone (Spark mode).
Request/response shapes below were read from the source; they were not exercised against a running server in this
export (the sandbox had no network to install dependencies).

1. **Realtime/Calling backend** (`backend/`, Express + `ws`) — HTTP under `/api/*`, WebSocket at `/ws`.
2. **Media broker** (`workers/bana-media-broker/`, Cloudflare Worker) — presigned storage URLs.
3. **Firebase Callable Functions** (`functions/`) — Blaze plan only.

The main data API is the Firebase client SDK against Firestore (see `DATABASE.md`), not a REST API.

## 1. Backend HTTP API

Base URL: `VITE_BACKEND_URL` (local `http://localhost:8788`, Render `https://<service>.onrender.com`).
All `/api/*` routes need `Authorization: Bearer <Firebase ID token>`. Errors are `{ "error": "message" }`.
JSON body limit: 1 MB. Rate limiting returns HTTP 429; `/api/calling` uses a stricter token limiter
(`TOKEN_RATE_LIMIT_PER_MIN`, default 30).

| Method & path | Auth | Purpose |
|---|---|---|
| `GET /health` | none | Liveness: `{status:"ok", service, uptimeSec, wsStats, timestamp}` |
| `GET /api/calling/ice-servers` | user | ICE/STUN/TURN config (ephemeral HMAC TURN credentials when `TURN_*` set) |
| `POST /api/calling/token` | user | Mint a provider token. Body: `providerId` (default `webrtc_builtin`), `roomName` (1–128 safe chars), `ttlSeconds` (default 3600). Paid providers (Agora, 100ms) return **403** without admin billing approval; unconfigured providers return 400 with a message |
| `POST /api/calling/rooms` | user | Create a group-call room. Body: `roomId`, `conversationId`, `providerId`. Returns **201** with room info; 400 on invalid ids |
| `GET /api/calling/rooms/:roomId` | user | Room snapshot; 404 if no active room |
| `POST /api/messages/relay` | user | Relay a message event to connected recipients (validates `conversationId`) |
| `POST /api/notifications/dispatch` | user | Dispatch a notification. Requires `recipientId` and `title` |
| `POST /api/uploads/validate` | user | Validate upload metadata (`fileName`, `mimeType`, `sizeBytes`) → `{valid:true,…}` or 400 `{valid:false,error}` |
| `GET /api/admin/status` | `super_admin`/`admin` | Provider configuration status |
| `POST /api/admin/providers/test` | `super_admin`/`admin` | Connectivity probe. Body: `category`, `providerKey` |
| `GET /api/admin/usage` | `super_admin`/`admin` | Usage and last 50 errors |

`/api/admin/*` first requires an admin-type role (`super_admin`, `admin`, `moderator`, `support_staff`,
`finance_manager`, `ad_manager`) or a configured Super Admin email, then a per-route role check.

### WebSocket `/ws`

Connect to `wss://<backend>/ws?token=<ID token>&name=<display name>`. Client → server message kinds:
`room:join`, `room:leave`, `signal:offer`, `signal:answer`, `signal:ice`, `room:media_state`, `screen:toggle`,
`speaker:level`, `participant:mute`, `participant:kick`, `room:end` (host controls), `chat:typing`,
`chat:delivered`, `chat:read`. Server → client events include `room:state`, `room:full`, `room:ended`,
`room:kicked`, `chat:presence`.

## 2. Media Broker Worker

Base URL: `VITE_MEDIA_BROKER_URL`. Verifies Firebase tokens (`FIREBASE_PROJECT_ID`) and applies `ALLOWED_ORIGINS`.

| Method & path | Purpose |
|---|---|
| `GET /health` | Liveness |
| `POST /api/media/probe` | Check provider connectivity |
| `POST /api/media/presign-upload` | Presigned PUT URL (SigV4) |
| `POST /api/media/presign-download` | Presigned GET URL |
| `POST /api/media/head` | Object metadata |
| `POST /api/media/backup-copy` | Copy an object between providers |
| `POST /api/media/list` | List objects |
| `DELETE /api/media/object` | Delete an object |

A Cron Trigger (`0 */6 * * *`) runs a provider readiness check.

## 3. Firebase Callable Functions (Blaze plan)

Called through the Firebase SDK (`httpsCallable`). Enabled in the UI only when `VITE_ENABLE_CLOUD_FUNCTIONS=true`.

- **Monetization:** `evaluateCreatorEligibility`, `submitMonetizationApplication`, `reviewMonetizationApplication`,
  `calculateCreatorCycleEarnings`, `requestCreatorPayout`, `processPayoutRequest`
- **Ads:** `reviewAdCampaign`
- **Admin/RBAC:** `assignAdminRole`, `syncMyAdminClaims`, `reviewVerificationRequest`
- **Marketplace/payments:** `getPaymentGatewayConfigStatus`, `createMarketplaceOrder`, `transitionOrderStatus`,
  `verifyOrRefundMarketplacePayment`
- **Calling:** `getWebRTCIceConfig`, `configureTurnMetadata`
- **Privacy:** `exportUserData`

Firestore triggers (counters, notifications, friendships, comments, reels, messages, calls, ad impressions/clicks,
`syncAdminClaimsOnRoleWrite`) and the scheduled `cleanupExpiredStories` (every 60 minutes) also live in
`functions/src/index.ts`.

## 4. Provider catalogs

`api-providers/{calling,messaging,notifications,storage}/providers.json` list the provider options shown in the
Admin → API Management center, with free/paid flags. See `api-providers/README.md`.
