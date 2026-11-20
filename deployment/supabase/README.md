# Supabase Database, RLS & Realtime Setup Guide

Run these migrations against any free or paid Supabase project cleanly without modifying BANA's Firebase Spark workflow.

## Option A — Supabase SQL Editor (Zero CLI Required)

Open your Supabase Dashboard → **SQL Editor** and run in order:

1. `database/supabase/migrations/001_initial_schema.sql`
2. `database/supabase/migrations/002_messenger_and_calling.sql`
3. `database/supabase/migrations/003_api_providers_usage_logs.sql`
4. `database/supabase/migrations/004_rls_and_storage_policies.sql`
5. `database/supabase/seed.sql`

## Option B — Supabase CLI

```bash
npx supabase login
npx supabase link --project-ref <YOUR_PROJECT_REF>
# Copy database/supabase/migrations/* into supabase/migrations/ or run:
psql "$SUPABASE_DB_URL" -f database/supabase/migrations/001_initial_schema.sql
psql "$SUPABASE_DB_URL" -f database/supabase/migrations/002_messenger_and_calling.sql
psql "$SUPABASE_DB_URL" -f database/supabase/migrations/003_api_providers_usage_logs.sql
psql "$SUPABASE_DB_URL" -f database/supabase/migrations/004_rls_and_storage_policies.sql
psql "$SUPABASE_DB_URL" -f database/supabase/seed.sql
```

## Authentication & Backend Sync

1. In Supabase **Authentication → Providers**, enable Email/Password and Google OAuth.
2. Copy **Project URL**, **anon public key**, **service_role key**, and **JWT Secret** into Render (`backend/` environment variables) — NEVER into frontend `.env` files.
3. Verify connectivity inside BANA **Admin Control Panel → API Management → Realtime Messaging / File & Media Storage → Test Connection**.
