-- ============================================================================
-- BANA Platform - Supabase PostgreSQL Migration 003
-- API Providers Catalog, Usage Telemetry, Error Logs & Admin Audit Logs
-- ZERO SECRET FIELDS ALLOWED IN ANY COLUMN
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.api_providers (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN (
    'voice_video_calling',
    'group_calling',
    'screen_sharing',
    'realtime_messaging',
    'push_notifications',
    'file_media_storage',
    'video_processing'
  )),
  provider_key TEXT NOT NULL,
  name TEXT NOT NULL,
  tier TEXT NOT NULL CHECK (tier IN ('free', 'open_source', 'paid')),
  requires_billing_approval BOOLEAN NOT NULL DEFAULT FALSE,
  billing_approved_by_admin BOOLEAN NOT NULL DEFAULT FALSE,
  billing_approved_at TIMESTAMPTZ,
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  endpoint_url TEXT DEFAULT '',
  public_app_id TEXT DEFAULT '',
  region TEXT DEFAULT '',
  required_env_keys JSONB NOT NULL DEFAULT '[]'::jsonb,
  docs_note TEXT DEFAULT '',
  connection_status TEXT NOT NULL DEFAULT 'not_tested'
    CHECK (connection_status IN ('connected', 'unconfigured', 'degraded', 'error', 'not_tested')),
  config_status TEXT NOT NULL DEFAULT 'ready'
    CHECK (config_status IN ('ready', 'missing_credentials', 'pending_approval')),
  monthly_quota_label TEXT DEFAULT '',
  usage_count BIGINT NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  last_tested_at TIMESTAMPTZ,
  last_test_message TEXT,
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (category, provider_key)
);

CREATE TABLE IF NOT EXISTS public.api_usage_records (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  category TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  requests_count INTEGER NOT NULL DEFAULT 1,
  success_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  bandwidth_mb NUMERIC(12, 3) NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 4) NOT NULL DEFAULT 0,
  period_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_period
  ON public.api_usage_records (period_key, category, created_at DESC);

CREATE TABLE IF NOT EXISTS public.api_error_logs (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  category TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'error' CHECK (severity IN ('info', 'warning', 'error')),
  message TEXT NOT NULL,
  endpoint TEXT,
  actor_uid TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_error_logs_cat_created
  ON public.api_error_logs (category, created_at DESC);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id TEXT PRIMARY KEY DEFAULT encode(gen_random_bytes(12), 'hex'),
  actor_uid TEXT NOT NULL,
  actor_email TEXT,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_created ON public.audit_logs (created_at DESC);

DROP TRIGGER IF EXISTS trg_api_providers_updated ON public.api_providers;
CREATE TRIGGER trg_api_providers_updated BEFORE UPDATE ON public.api_providers
  FOR EACH ROW EXECUTE FUNCTION public.bana_set_updated_at();
