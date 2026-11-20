-- ============================================================================
-- BANA Platform - Idempotent Supabase Seed Data (Zero Secrets)
-- Populates default API Provider Registry matching src/types/apiManagement.ts
-- ============================================================================

INSERT INTO public.api_providers (
  id, category, provider_key, name, tier,
  requires_billing_approval, billing_approved_by_admin,
  enabled, is_active, endpoint_url, required_env_keys,
  docs_note, connection_status, config_status, monthly_quota_label
) VALUES
  (
    'voice_video_calling__webrtc_builtin', 'voice_video_calling', 'webrtc_builtin',
    'Built-in WebRTC + Public STUN / Self-Hosted Coturn TURN', 'free',
    FALSE, TRUE, TRUE, TRUE, 'stun:stun.l.google.com:19302',
    '["TURN_SHARED_SECRET (optional)","TURN_URLS (optional)"]'::jsonb,
    'Zero paid APIs required. P2P audio/video via STUN + optional self-hosted Coturn TURN.',
    'connected', 'ready', 'Unlimited peer-to-peer'
  ),
  (
    'voice_video_calling__livekit_oss', 'voice_video_calling', 'livekit_oss',
    'LiveKit Open-Source SFU (Self-Hosted or Cloud Free Tier)', 'open_source',
    FALSE, TRUE, TRUE, FALSE, '',
    '["LIVEKIT_WS_URL","LIVEKIT_API_KEY","LIVEKIT_API_SECRET"]'::jsonb,
    'Open-source SFU media server. Tokens minted securely inside backend/.',
    'not_tested', 'missing_credentials', 'Unlimited self-hosted / 50GB free cloud'
  ),
  (
    'voice_video_calling__agora', 'voice_video_calling', 'agora',
    'Agora RTC', 'paid',
    TRUE, FALSE, FALSE, FALSE, '',
    '["AGORA_APP_ID","AGORA_APP_CERTIFICATE"]'::jsonb,
    'Managed global RTC (10k free min/month, paid overage). Requires explicit Admin approval.',
    'unconfigured', 'pending_approval', '10,000 free min / paid overage'
  ),
  (
    'voice_video_calling__100ms', 'voice_video_calling', '100ms',
    '100ms Live Video API', 'paid',
    TRUE, FALSE, FALSE, FALSE, '',
    '["HMS_ACCESS_KEY","HMS_APP_SECRET","HMS_TEMPLATE_ID"]'::jsonb,
    'Managed WebRTC SFU room API. Requires explicit Admin approval.',
    'unconfigured', 'pending_approval', '10,000 free min / paid overage'
  ),
  (
    'group_calling__webrtc_builtin', 'group_calling', 'webrtc_builtin',
    'Built-in WebRTC Multi-Peer Mesh + WebSocket Relay', 'free',
    FALSE, TRUE, TRUE, TRUE, '',
    '["VITE_BACKEND_URL (optional WebSocket)"]'::jsonb,
    'Zero paid services. Ideal for small groups (2–8 participants). Configurable limit.',
    'connected', 'ready', 'Up to 8 mesh peers recommended'
  ),
  (
    'group_calling__livekit_oss', 'group_calling', 'livekit_oss',
    'LiveKit Open-Source SFU Group Rooms', 'open_source',
    FALSE, TRUE, TRUE, FALSE, '',
    '["LIVEKIT_WS_URL","LIVEKIT_API_KEY","LIVEKIT_API_SECRET"]'::jsonb,
    'Scales group calls beyond mesh limits using Selective Forwarding Unit.',
    'not_tested', 'missing_credentials', 'Up to 50+ room participants'
  ),
  (
    'screen_sharing__browser_webrtc', 'screen_sharing', 'browser_webrtc',
    'Native Browser getDisplayMedia() + WebRTC Track Replace', 'free',
    FALSE, TRUE, TRUE, TRUE, '',
    '[]'::jsonb,
    'Standard W3C Screen Capture API for tab, window, and screen sharing.',
    'connected', 'ready', 'Unlimited free'
  ),
  (
    'realtime_messaging__firestore_ws', 'realtime_messaging', 'firestore_ws',
    'Firestore Realtime + Render WebSocket Signaling Bridge', 'free',
    FALSE, TRUE, TRUE, TRUE, '',
    '["VITE_BACKEND_URL (optional WebSocket relay)"]'::jsonb,
    'Persistent Firestore chats paired with low-latency Express/ws presence & typing.',
    'connected', 'ready', 'Spark 50k reads/day + Render Free WS'
  ),
  (
    'realtime_messaging__supabase_realtime', 'realtime_messaging', 'supabase_realtime',
    'Supabase PostgreSQL + Realtime Channels', 'open_source',
    FALSE, TRUE, TRUE, FALSE, '',
    '["SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_SERVICE_ROLE_KEY"]'::jsonb,
    'PostgreSQL Realtime CDC + Row Level Security via database/supabase migrations.',
    'not_tested', 'missing_credentials', 'Supabase Free 500MB DB / 200 conc.'
  ),
  (
    'push_notifications__inapp_browser', 'push_notifications', 'inapp_browser',
    'Firestore Real-Time Notifications + Browser Web Notifications API', 'free',
    FALSE, TRUE, TRUE, TRUE, '',
    '[]'::jsonb,
    'Zero paid services. Real-time in-app inbox + desktop notification alerts when permitted.',
    'connected', 'ready', 'Unlimited free'
  ),
  (
    'push_notifications__web_push_vapid', 'push_notifications', 'web_push_vapid',
    'Standard Web Push (VAPID via backend/)', 'open_source',
    FALSE, TRUE, TRUE, FALSE, '',
    '["VAPID_PUBLIC_KEY","VAPID_PRIVATE_KEY","VAPID_SUBJECT"]'::jsonb,
    'Open-standard W3C Push API with zero vendor lock-in.',
    'not_tested', 'missing_credentials', 'Free via browser push services'
  ),
  (
    'file_media_storage__cloudflare_r2', 'file_media_storage', 'cloudflare_r2',
    'Cloudflare R2 (via Media Broker / Backend)', 'free',
    FALSE, TRUE, TRUE, TRUE, '',
    '["VITE_MEDIA_BROKER_URL","R2_ACCESS_KEY_ID","R2_SECRET_ACCESS_KEY"]'::jsonb,
    '10 GB/month free storage with zero egress fees. Presigned uploads via Worker/Backend.',
    'not_tested', 'ready', '10 GB free storage, $0 egress'
  ),
  (
    'file_media_storage__supabase_storage', 'file_media_storage', 'supabase_storage',
    'Supabase Storage Buckets', 'open_source',
    FALSE, TRUE, TRUE, FALSE, '',
    '["SUPABASE_URL","SUPABASE_ANON_KEY","SUPABASE_STORAGE_BUCKET"]'::jsonb,
    'Open-source object storage with bucket RLS policies in database/supabase.',
    'not_tested', 'missing_credentials', '1 GB free Supabase tier'
  ),
  (
    'video_processing__browser_progressive', 'video_processing', 'browser_progressive',
    'Direct Progressive MP4 / WebM + Client Poster Extraction', 'free',
    FALSE, TRUE, TRUE, TRUE, '',
    '[]'::jsonb,
    'Zero transcoding spend. Validates codecs and extracts poster frames client-side.',
    'connected', 'ready', 'Unlimited free'
  ),
  (
    'video_processing__cloudflare_stream', 'video_processing', 'cloudflare_stream',
    'Cloudflare Stream (Paid Upgrade)', 'paid',
    TRUE, FALSE, FALSE, FALSE, '',
    '["CF_ACCOUNT_ID","CF_STREAM_API_TOKEN"]'::jsonb,
    'Managed HLS encoding ($5/1,000 min). Blocked unless Admin explicitly approves.',
    'unconfigured', 'pending_approval', '$5 / 1,000 min stored'
  )
ON CONFLICT (id) DO NOTHING;
