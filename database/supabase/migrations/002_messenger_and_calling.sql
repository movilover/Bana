-- ============================================================================
-- BANA Platform - Supabase PostgreSQL Migration 002
-- Messenger Messages, Reactions, 1-to-1 Calls, Group Calls & Notifications
-- ============================================================================

-- 1. Messenger Messages (Supports text, image, video, audio voice notes, files)
CREATE TABLE IF NOT EXISTS public.messages (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  sender_id TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  message_type TEXT NOT NULL DEFAULT 'text'
    CHECK (message_type IN ('text', 'image', 'video', 'audio', 'file', 'call')),
  text_content TEXT DEFAULT '',
  attachment_url TEXT,
  attachment_name TEXT,
  attachment_mime TEXT,
  attachment_size_bytes BIGINT,
  reply_to_message_id TEXT REFERENCES public.messages(id) ON DELETE SET NULL,
  delivered_to TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  read_by TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  deleted_for TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  unsent_for_everyone BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_created
  ON public.messages (conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.message_reactions (
  message_id TEXT NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (message_id, user_uid, emoji)
);

-- 2. 1-to-1 Audio / Video Calls
CREATE TABLE IF NOT EXISTS public.calls (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  caller_id TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  callee_id TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  call_type TEXT NOT NULL DEFAULT 'audio' CHECK (call_type IN ('audio', 'video')),
  status TEXT NOT NULL DEFAULT 'ringing'
    CHECK (status IN ('ringing', 'connected', 'on_hold', 'rejected', 'missed', 'ended')),
  screen_sharing_by TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
  provider_id TEXT NOT NULL DEFAULT 'webrtc_builtin',
  offer_sdp JSONB,
  answer_sdp JSONB,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  connected_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  duration_seconds INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_calls_participants
  ON public.calls (caller_id, callee_id, status, started_at DESC);

-- 3. Multi-Peer Group Call Rooms
CREATE TABLE IF NOT EXISTS public.group_calls (
  room_id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  host_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  call_type TEXT NOT NULL DEFAULT 'video' CHECK (call_type IN ('audio', 'video')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'ended')),
  max_participants INTEGER NOT NULL DEFAULT 8 CHECK (max_participants BETWEEN 2 AND 50),
  provider_id TEXT NOT NULL DEFAULT 'webrtc_builtin',
  invited_participant_ids TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  screen_sharing_by TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ended_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_group_calls_conv_status
  ON public.group_calls (conversation_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.group_call_participants (
  room_id TEXT NOT NULL REFERENCES public.group_calls(room_id) ON DELETE CASCADE,
  participant_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  display_name TEXT NOT NULL DEFAULT 'Participant',
  role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('host', 'participant')),
  mic_muted BOOLEAN NOT NULL DEFAULT FALSE,
  cam_off BOOLEAN NOT NULL DEFAULT FALSE,
  screen_sharing BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  PRIMARY KEY (room_id, participant_uid)
);

CREATE TABLE IF NOT EXISTS public.group_call_signals (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  room_id TEXT NOT NULL REFERENCES public.group_calls(room_id) ON DELETE CASCADE,
  from_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  to_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  signal_type TEXT NOT NULL CHECK (signal_type IN ('offer', 'answer', 'ice')),
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_group_signals_target
  ON public.group_call_signals (room_id, to_uid, created_at ASC);

-- 4. Real-Time User Notifications (Likes, Comments, Messages, Missed Calls)
CREATE TABLE IF NOT EXISTS public.notifications (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  recipient_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  actor_uid TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
  notification_type TEXT NOT NULL
    CHECK (notification_type IN ('like', 'comment', 'follow', 'message', 'call', 'system', 'moderation')),
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  link_path TEXT DEFAULT '/notifications',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_recipient
  ON public.notifications (recipient_uid, is_read, created_at DESC);

DROP TRIGGER IF EXISTS trg_messages_updated ON public.messages;
CREATE TRIGGER trg_messages_updated BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.bana_set_updated_at();

-- Enable Supabase Realtime Publication (safe idempotent guard)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.calls;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.group_calls;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.group_call_participants;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.group_call_signals;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;
