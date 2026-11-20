-- ============================================================================
-- BANA Platform - Supabase PostgreSQL Migration 004
-- Strict Row Level Security (RLS) & Storage Bucket Access Policies
-- ============================================================================

-- Helper: Check if authenticated Supabase user holds an active BANA Admin role
CREATE OR REPLACE FUNCTION public.bana_is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.uid = auth.uid()::text
      AND u.account_status = 'active'
      AND u.admin_role IN ('super_admin', 'admin', 'moderator', 'support_staff', 'finance_manager', 'ad_manager')
  );
$$;

-- Helper: Check if authenticated user belongs to a conversation
CREATE OR REPLACE FUNCTION public.bana_is_conversation_member(conv_id TEXT)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.conversation_participants cp
    WHERE cp.conversation_id = conv_id
      AND cp.user_uid = auth.uid()::text
  );
$$;

-- Enable RLS across all application tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conversation_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_calls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_call_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.group_call_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_usage_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_error_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Users policies
DROP POLICY IF EXISTS users_read_public ON public.users;
CREATE POLICY users_read_public ON public.users
  FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS users_update_self ON public.users;
CREATE POLICY users_update_self ON public.users
  FOR UPDATE USING (auth.uid()::text = uid);

DROP POLICY IF EXISTS users_admin_manage ON public.users;
CREATE POLICY users_admin_manage ON public.users
  FOR ALL USING (public.bana_is_admin());

-- Conversations & Participants (Strict Participant Isolation; Admins CANNOT spy on private chats)
DROP POLICY IF EXISTS conv_member_select ON public.conversations;
CREATE POLICY conv_member_select ON public.conversations
  FOR SELECT USING (public.bana_is_conversation_member(id));

DROP POLICY IF EXISTS conv_member_insert ON public.conversations;
CREATE POLICY conv_member_insert ON public.conversations
  FOR INSERT WITH CHECK (auth.uid()::text = created_by);

DROP POLICY IF EXISTS conv_participants_select ON public.conversation_participants;
CREATE POLICY conv_participants_select ON public.conversation_participants
  FOR SELECT USING (public.bana_is_conversation_member(conversation_id));

DROP POLICY IF EXISTS conv_participants_update_self ON public.conversation_participants;
CREATE POLICY conv_participants_update_self ON public.conversation_participants
  FOR UPDATE USING (auth.uid()::text = user_uid);

-- Messages & Reactions (Strict Conversation Participant Isolation)
DROP POLICY IF EXISTS messages_member_select ON public.messages;
CREATE POLICY messages_member_select ON public.messages
  FOR SELECT USING (public.bana_is_conversation_member(conversation_id));

DROP POLICY IF EXISTS messages_member_insert ON public.messages;
CREATE POLICY messages_member_insert ON public.messages
  FOR INSERT WITH CHECK (
    auth.uid()::text = sender_id
    AND public.bana_is_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS messages_member_update_receipts ON public.messages;
CREATE POLICY messages_member_update_receipts ON public.messages
  FOR UPDATE USING (public.bana_is_conversation_member(conversation_id));

DROP POLICY IF EXISTS reactions_member_all ON public.message_reactions;
CREATE POLICY reactions_member_all ON public.message_reactions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.messages m
      WHERE m.id = message_id AND public.bana_is_conversation_member(m.conversation_id)
    )
  );

-- 1-to-1 Calls
DROP POLICY IF EXISTS calls_participant_all ON public.calls;
CREATE POLICY calls_participant_all ON public.calls
  FOR ALL USING (auth.uid()::text IN (caller_id, callee_id));

-- Group Calls & Mesh Signaling (Participant & Host Isolation)
DROP POLICY IF EXISTS group_calls_member_select ON public.group_calls;
CREATE POLICY group_calls_member_select ON public.group_calls
  FOR SELECT USING (
    auth.uid()::text = host_uid
    OR auth.uid()::text = ANY(invited_participant_ids)
    OR public.bana_is_conversation_member(conversation_id)
  );

DROP POLICY IF EXISTS group_calls_host_insert ON public.group_calls;
CREATE POLICY group_calls_host_insert ON public.group_calls
  FOR INSERT WITH CHECK (auth.uid()::text = host_uid);

DROP POLICY IF EXISTS group_calls_host_or_invitee_update ON public.group_calls;
CREATE POLICY group_calls_host_or_invitee_update ON public.group_calls
  FOR UPDATE USING (
    auth.uid()::text = host_uid
    OR auth.uid()::text = ANY(invited_participant_ids)
  );

DROP POLICY IF EXISTS group_participants_access ON public.group_call_participants;
CREATE POLICY group_participants_access ON public.group_call_participants
  FOR ALL USING (
    auth.uid()::text = participant_uid
    OR EXISTS (
      SELECT 1 FROM public.group_calls gc
      WHERE gc.room_id = room_id AND (gc.host_uid = auth.uid()::text OR auth.uid()::text = ANY(gc.invited_participant_ids))
    )
  );

DROP POLICY IF EXISTS group_signals_access ON public.group_call_signals;
CREATE POLICY group_signals_access ON public.group_call_signals
  FOR ALL USING (auth.uid()::text IN (from_uid, to_uid));

-- Notifications (Private to Recipient)
DROP POLICY IF EXISTS notifications_owner_all ON public.notifications;
CREATE POLICY notifications_owner_all ON public.notifications
  FOR ALL USING (auth.uid()::text = recipient_uid);

DROP POLICY IF EXISTS notifications_actor_insert ON public.notifications;
CREATE POLICY notifications_actor_insert ON public.notifications
  FOR INSERT WITH CHECK (auth.uid()::text = actor_uid);

-- Posts / Stories / Comments
DROP POLICY IF EXISTS posts_public_or_owner ON public.posts;
CREATE POLICY posts_public_or_owner ON public.posts
  FOR SELECT USING (
    (status = 'published' AND visibility = 'public')
    OR auth.uid()::text = author_uid
    OR public.bana_is_admin()
  );

DROP POLICY IF EXISTS posts_owner_write ON public.posts;
CREATE POLICY posts_owner_write ON public.posts
  FOR ALL USING (auth.uid()::text = author_uid OR public.bana_is_admin());

DROP POLICY IF EXISTS stories_active_read ON public.stories;
CREATE POLICY stories_active_read ON public.stories
  FOR SELECT USING (expires_at > NOW() OR auth.uid()::text = author_uid OR public.bana_is_admin());

DROP POLICY IF EXISTS stories_owner_write ON public.stories;
CREATE POLICY stories_owner_write ON public.stories
  FOR ALL USING (auth.uid()::text = author_uid OR public.bana_is_admin());

DROP POLICY IF EXISTS comments_read_active ON public.comments;
CREATE POLICY comments_read_active ON public.comments
  FOR SELECT USING (deletion_status = 'active' OR auth.uid()::text = author_uid OR public.bana_is_admin());

DROP POLICY IF EXISTS comments_owner_write ON public.comments;
CREATE POLICY comments_owner_write ON public.comments
  FOR ALL USING (auth.uid()::text = author_uid OR public.bana_is_admin());

-- Admin API Management & Logs (Read config active state for signed-in users, write strictly Admin)
DROP POLICY IF EXISTS api_providers_read_signed_in ON public.api_providers;
CREATE POLICY api_providers_read_signed_in ON public.api_providers
  FOR SELECT USING (auth.role() = 'authenticated' OR public.bana_is_admin());

DROP POLICY IF EXISTS api_providers_admin_write ON public.api_providers;
CREATE POLICY api_providers_admin_write ON public.api_providers
  FOR ALL USING (public.bana_is_admin());

DROP POLICY IF EXISTS api_usage_admin_only ON public.api_usage_records;
CREATE POLICY api_usage_admin_only ON public.api_usage_records
  FOR ALL USING (public.bana_is_admin());

DROP POLICY IF EXISTS api_error_logs_admin_only ON public.api_error_logs;
CREATE POLICY api_error_logs_admin_only ON public.api_error_logs
  FOR ALL USING (public.bana_is_admin());

DROP POLICY IF EXISTS audit_logs_admin_only ON public.audit_logs;
CREATE POLICY audit_logs_admin_only ON public.audit_logs
  FOR ALL USING (public.bana_is_admin());

-- ============================================================================
-- Supabase Storage Buckets & RLS Policies (bana-media & messenger-attachments)
-- ============================================================================
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'buckets') THEN
    INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    VALUES
      ('bana-media', 'bana-media', TRUE, 104857600, ARRAY['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','audio/webm','audio/mpeg','audio/mp4']),
      ('messenger-attachments', 'messenger-attachments', FALSE, 52428800, ARRAY['image/jpeg','image/png','image/webp','video/mp4','video/webm','audio/webm','audio/mpeg','audio/mp4','application/pdf'])
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'storage' AND table_name = 'objects') THEN
    DROP POLICY IF EXISTS "bana_media_public_read" ON storage.objects;
    CREATE POLICY "bana_media_public_read" ON storage.objects
      FOR SELECT USING (bucket_id = 'bana-media');

    DROP POLICY IF EXISTS "bana_media_user_upload" ON storage.objects;
    CREATE POLICY "bana_media_user_upload" ON storage.objects
      FOR INSERT WITH CHECK (
        bucket_id IN ('bana-media', 'messenger-attachments')
        AND auth.role() = 'authenticated'
        AND (storage.foldername(name))[1] = auth.uid()::text
      );

    DROP POLICY IF EXISTS "bana_media_user_delete" ON storage.objects;
    CREATE POLICY "bana_media_user_delete" ON storage.objects
      FOR DELETE USING (
        bucket_id IN ('bana-media', 'messenger-attachments')
        AND (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
