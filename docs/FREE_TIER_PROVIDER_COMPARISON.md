# BANA — Free-Tier & Open-Source Provider Comparison (Prompt 12)

This document compares the providers BANA can use for each service. It separates three things:

- **Confirmed in code:** what the repository implements today (provider catalog, adapters, guards).
- **Published free tier (verify):** numbers the vendor publishes. They change often. Check the vendor's pricing page before launch.
- **Estimate:** a calculation from stated assumptions, not a measurement.

Nothing here is a promise of unlimited free service. A "free tier" always has a cap, and the cap can be reduced by the vendor.

---

## 1. Summary table

| Service | Current provider (active by default) | Recommended free / open-source option | Free-tier availability | Paid requirement | Main limitation | Status in code |
|---|---|---|---|---|---|---|
| Authentication | Firebase Auth (Email/Password, Google) | Keep Firebase Auth | Free up to 50k MAU (verify) | None on Spark | Phone auth needs Blaze | Implemented |
| Database | Cloud Firestore (Spark) | Keep Firestore; optional Supabase Postgres (`supabase_realtime`) | Firestore: daily read/write quotas (verify) | None on Spark | Daily quota ceiling | Implemented |
| Realtime messaging | Firestore listeners + Render WebSocket signaling | Keep Firestore; Supabase Realtime is an option | Firestore quota applies; Render free sleeps | Render paid instance for always-on WS | Cold starts and dropped sockets on free hosting | Implemented |
| Backend hosting | Render free web service (optional) | Render free; Cloudflare Workers (Media Broker) | Render: sleeps when idle (verify); Workers: 100k requests/day (verify) | Render paid instance to remove sleep | Free service sleeps; ephemeral disk | Implemented |
| Object storage (files, voice, docs) | Cloudflare R2 (primary) + Backblaze B2 (backup) | R2 + B2 | R2: 10 GB-month storage, $0 egress (verify); B2: 10 GB free storage (verify) | Only when storage exceeds free allowance | B2 download allowance is limited (verify) | Implemented (via Media Broker) |
| Image storage | Same as object storage; client-side resize/compress | R2 + B2 | Same as above | Same | No server-side image transforms are used | Implemented |
| Video storage | Browser progressive MP4/WebM in R2 | R2 (progressive); self-hosted FFmpeg HLS (optional) | Same as R2 | Cloudflare Stream is paid (guarded) | Original file size is served; no adaptive bitrate on progressive | Implemented; Stream guarded |
| Video transcoding | None by default (browser validation + poster) | Self-hosted FFmpeg worker (`ffmpeg_worker`, catalog only) | Self-hosted compute cost only | Server cost | Needs a VM you run | Catalog only |
| Notifications (in-app) | Firestore notifications + Browser Notification API | Keep | No platform fee | None | Only works while the app is open | Implemented |
| Push notifications | Inactive (`fcm`, `web_push_vapid` catalog entries) | FCM (free) or self-hosted VAPID | FCM: free, rate limits (verify) | Backend hosting for VAPID | Requires service worker and user permission | Catalog only |
| Authentication alternative | Firebase Auth | Supabase Auth (free tier, verify) | — | — | Migration effort | Not implemented |
| Voice/video calling | Built-in WebRTC (P2P) + Firestore/WS signaling | Built-in P2P for 1:1; LiveKit OSS for groups | P2P: no platform fee, uses participants' bandwidth | Only for SFU hosting or paid cloud | Mesh degrades beyond a few peers | Implemented |
| Group calling | Built-in mesh (recommended ≤ 8) | LiveKit OSS SFU (self-hosted) | LiveKit self-hosted: no license fee, your server cost | VPS | Needs server with public UDP | LiveKit path implemented, not default |
| STUN | Public STUN servers | Keep | Free (public, no SLA) | None | Not enough for many NATs | Implemented |
| TURN | Coturn (self-hosted, optional, `TURN_URLS`) | Coturn on a small VPS | VPS cost; relay traffic is billed by the host | VPS | Render free web services do not support TURN (UDP) | Optional, must be configured |
| Monitoring | Admin panel telemetry (Firestore `apiErrorLogs`, `backendUsage`) + backend `/health` | Uptime checker (free tier), Render logs | Varies (verify) | None for basic checks | Not a full observability stack | Partial |
| Backups | Manifest export + R2/B2 backup queue | Keep | Same as storage | Same | Manual restore procedure | Implemented |

---

## 2. Service-by-service notes

### Authentication
- **Firebase Auth** is the active provider. It is free for the supported sign-in methods within the MAU allowance (verify).
- **Supabase Auth** is an alternative with its own free allowance (verify). Switching would change user IDs and tokens across Firestore rules, the backend verifier, and storage rules. It is not recommended without a migration plan.

### Database
- **Firestore (Spark)** is active. Limits: 1 GiB stored, 50k reads/day, 20k writes/day, 20k deletes/day, 10 GiB/month egress (verify).
- **Supabase Postgres** (`supabase_realtime` in the catalog, `database/supabase/migrations/`) is an optional portable SQL path. It is not the active realtime provider. Free projects have a small database and can pause after inactivity (verify).

### Object, image and video storage
- **Cloudflare R2** is the primary store. Uploads are signed by the Media Broker Worker. R2 has no egress fee (verify), which matters for video.
- **Backblaze B2** is the backup copy, queued by `backupJobs`. Egress is limited on the free tier (verify), so B2 should be used for backup, not for serving.
- **Supabase Storage** is optional. Its free file-size limit is small (verify), so it is not suitable for reels.
- **Google Cloud Storage** is in the catalog as paid (`requiresBillingApproval: true`). It stays disabled unless the admin approves billing.
- **Cloudflare Stream** is paid (approximately $5 per 1,000 minutes stored, verify). It is disabled by default and needs `billingApproved` before it can be enabled.
- **Video processing:** R2 and B2 store and serve files. They do **not** transcode or create adaptive streams. BANA's progressive MP4/WebM path serves the uploaded file. An HLS path needs the self-hosted FFmpeg worker, which is not deployed by default.

### Notifications
- The active path is Firestore notifications with Browser Notifications. It is free but only works while the app is open.
- FCM and VAPID web push are in the catalog. Enabling either needs a service worker, user permission, and a backend that holds the server key. Neither is active.

### Calling and TURN
- See `docs/MESSENGER_CALLING_COST_ANALYSIS.md` for bandwidth, group limits, and cost.

### Backend hosting
- **Render free** runs the Express + WebSocket server. It sleeps after inactivity, so the first request is slow and live sockets can drop. It has an ephemeral disk and in-memory rate limits. Upgrade to a paid instance for always-on use (verify plan terms).
- **Cloudflare Workers** (Media Broker) is the better free option for signed upload URLs. Free plan request limits apply (verify).

---

## 3. Paid providers (inactive until approved)

| Provider | Category | Default state | Gate |
|---|---|---|---|
| Agora RTC (1:1 and group) | Calling | `enabled: false`, `requiresBillingApproval: true` | Admin billing approval, then activation |
| 100ms | Calling | `enabled: false`, `requiresBillingApproval: true` | Same |
| Google Cloud Storage | Storage | `enabled: false`, `requiresBilling: true` | `billingApproved` + enabled |
| Cloudflare Stream | Video | `enabled: false`, `requiresBilling: true` | `billingApproved` + enabled. (`VITE_ENABLE_CLOUDFLARE_STREAM` appears in `.env.example` but is not read by the code; the approval flag is the real guard.) |
| SSLCOMMERZ, bKash, Nagad, Stripe | Payments | Not active; keys absent | Contract and keys (outside this repo's free scope) |

Activation logic is in `handleActivateProvider` (`AdminApiManagementSection.tsx`) and `selectPrimaryAndBackup` (`src/lib/storage/providerSelection.ts`). Both refuse a paid provider that lacks approval.

---

## 4. Estimates (not measurements)

These are illustrative only. Replace them with real usage from the provider dashboards.

- **Video storage on R2 (free allowance 10 GB-month):** at a 25 MB average reel, the allowance holds about 400 reels before paid storage would apply (estimate, storage only; operations also count).
- **Firestore reads:** the 50,000 reads/day Spark cap supports roughly 2,000 active sessions per day if each does about 25 reads. This is an estimate, not a guarantee.

---

## 5. Where to change a provider

- Storage: **Admin → Storage & Recovery → Storage Providers** (role, enabled, endpoints, approvals).
- API categories (calling, messaging, notifications, storage, video): **Admin → API Management**, using **Activate**, **Test**, and **Rollback to previous** (new in Prompt 12).
- Environment: `.env.example` lists every variable and marks paid items.
