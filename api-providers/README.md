# BANA Modular API Provider Registry (`api-providers/`)

BANA uses a **provider-independent architecture** across 7 independent operational categories managed inside **Admin Control Panel → API Management** (`/admin`):

1. `voice_video_calling` — 1-to-1 Audio & Video calling (`webrtc_builtin`, `livekit_oss`, `agora`, `100ms`)
2. `group_calling` — Multi-participant room calling (`webrtc_builtin` mesh, `livekit_oss` SFU, `agora`)
3. `screen_sharing` — Screen/window/tab capture (`browser_webrtc`, `livekit_screen`)
4. `realtime_messaging` — Messaging delivery, presence, typing (`firestore_ws`, `supabase_realtime`)
5. `push_notifications` — Incoming calls & unread DM alerts (`inapp_browser`, `web_push_vapid`, `fcm`)
6. `file_media_storage` — Attachments, voice notes, video/photo storage (`cloudflare_r2`, `backblaze_b2`, `supabase_storage`, `gcs`)
7. `video_processing` — Video playback/encoding (`browser_progressive`, `ffmpeg_worker`, `cloudflare_stream`)

## Security & Zero-Surprise Billing Principles

- **Zero Secrets in Frontend or Firestore**: Secret keys (`AGORA_APP_CERTIFICATE`, `HMS_APP_SECRET`, `LIVEKIT_API_SECRET`, `TURN_SHARED_SECRET`, `R2_SECRET_ACCESS_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `VAPID_PRIVATE_KEY`) MUST ONLY live in backend environment variables (Render dashboard / `backend/.env` / Cloudflare `wrangler secret`).
- **Firestore Enforcement**: `firestore.rules` explicitly blocks writing any secret field name (`secretKey`, `apiSecret`, `appCertificate`, `serviceRoleKey`, `privateKey`, etc.) into `apiProviders` documents.
- **Explicit Billing Guard**: Paid providers (`agora`, `100ms`, `gcs`, `cloudflare_stream`) cannot be activated or issue session tokens unless an authorized Admin explicitly sets `billingApprovedByAdmin: true`.
- **Live Connectivity Tests Only**: Selecting "Test Connection" calls `POST /api/admin/providers/test` on `backend/`, performing real STUN/TURN configuration checks, LiveKit HTTP probes, Supabase REST queries, or Cloudflare Worker health checks — never mocked "Connected" responses.
