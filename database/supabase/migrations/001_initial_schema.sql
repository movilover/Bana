-- ============================================================================
-- BANA Platform - Supabase PostgreSQL Migration 001
-- Initial Users, Social Metadata, Conversations & Participants Schema
-- Safe to run idempotently on Supabase PostgreSQL 15+
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Core Users Profile & Role Mirror
CREATE TABLE IF NOT EXISTS public.users (
  uid TEXT PRIMARY KEY,
  email TEXT UNIQUE,
  display_name TEXT NOT NULL DEFAULT 'BANA User',
  username TEXT UNIQUE,
  photo_url TEXT,
  bio TEXT DEFAULT '',
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  account_status TEXT NOT NULL DEFAULT 'active'
    CHECK (account_status IN ('active', 'suspended', 'restricted', 'deactivated')),
  admin_role TEXT
    CHECK (admin_role IS NULL OR admin_role IN (
      'super_admin', 'admin', 'moderator', 'support_staff', 'finance_manager', 'ad_manager'
    )),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_username ON public.users (username);
CREATE INDEX IF NOT EXISTS idx_users_status ON public.users (account_status);

-- 2. Conversations (1-to-1 and Group Messenger Threads)
CREATE TABLE IF NOT EXISTS public.conversations (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  is_group BOOLEAN NOT NULL DEFAULT FALSE,
  group_name TEXT,
  group_avatar TEXT,
  created_by TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
  last_message_text TEXT DEFAULT '',
  last_message_at TIMESTAMPTZ DEFAULT NOW(),
  last_message_sender_id TEXT REFERENCES public.users(uid) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON public.conversations (last_message_at DESC);

-- 3. Normalized Conversation Participants (Supports RLS isolation & per-user mute/archive)
CREATE TABLE IF NOT EXISTS public.conversation_participants (
  conversation_id TEXT NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  is_muted BOOLEAN NOT NULL DEFAULT FALSE,
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  is_blocked BOOLEAN NOT NULL DEFAULT FALSE,
  last_read_at TIMESTAMPTZ,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (conversation_id, user_uid)
);

CREATE INDEX IF NOT EXISTS idx_conv_participants_user
  ON public.conversation_participants (user_uid, conversation_id);

-- 4. Social Posts / Reels / Stories / Comments Metadata (Unified Portability Layer)
CREATE TABLE IF NOT EXISTS public.posts (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  author_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  content_type TEXT NOT NULL DEFAULT 'post' CHECK (content_type IN ('post', 'reel', 'video')),
  caption TEXT DEFAULT '',
  media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
  media_checksums JSONB NOT NULL DEFAULT '[]'::jsonb,
  storage_provider TEXT NOT NULL DEFAULT 'cloudflare_r2',
  visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'friends', 'private')),
  status TEXT NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'removed', 'archived')),
  likes_count INTEGER NOT NULL DEFAULT 0,
  comments_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_posts_feed ON public.posts (status, visibility, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stories (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  author_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video')),
  caption TEXT DEFAULT '',
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '24 hours'),
  is_archived BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stories_active ON public.stories (expires_at DESC);

CREATE TABLE IF NOT EXISTS public.comments (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  post_id TEXT NOT NULL REFERENCES public.posts(id) ON DELETE CASCADE,
  parent_comment_id TEXT REFERENCES public.comments(id) ON DELETE CASCADE,
  author_uid TEXT NOT NULL REFERENCES public.users(uid) ON DELETE CASCADE,
  body TEXT NOT NULL,
  deletion_status TEXT NOT NULL DEFAULT 'active' CHECK (deletion_status IN ('active', 'soft_deleted')),
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_post ON public.comments (post_id, deletion_status, created_at ASC);

-- Shared updated_at trigger function
CREATE OR REPLACE FUNCTION public.bana_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_users_updated ON public.users;
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.bana_set_updated_at();

DROP TRIGGER IF EXISTS trg_conversations_updated ON public.conversations;
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON public.conversations
  FOR EACH ROW EXECUTE FUNCTION public.bana_set_updated_at();

DROP TRIGGER IF EXISTS trg_posts_updated ON public.posts;
CREATE TRIGGER trg_posts_updated BEFORE UPDATE ON public.posts
  FOR EACH ROW EXECUTE FUNCTION public.bana_set_updated_at();

DROP TRIGGER IF EXISTS trg_comments_updated ON public.comments;
CREATE TRIGGER trg_comments_updated BEFORE UPDATE ON public.comments
  FOR EACH ROW EXECUTE FUNCTION public.bana_set_updated_at();
