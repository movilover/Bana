# Database Isolation Matrix: Firestore Rules vs Supabase RLS

BANA protects private user data identically whether running on Firebase Spark (Firestore) or Supabase PostgreSQL (`database/supabase/migrations/004_rls_and_storage_policies.sql`).

| Collection / Table | Read Access | Write / Mutate Access | Admin Access |
|---|---|---|---|
| `conversations` / `messages` | Only conversation participants (`auth.uid in participants`) | Only sender inside `participants` (receipts `deliveredTo`/`readBy` updatable by participants) | **BLOCKED** for private chat inspection (privacy safeguard) |
| `calls` (1-to-1) | `callerId == uid \|\| calleeId == uid` | Only caller or callee | Audit telemetry only (no audio/video inspection) |
| `groupCalls` + `participants` + `signals` | Host, `invitedParticipantIds`, or `participants` members | Host creates/ends/kicks; participants manage own row & targeted `fromUid/toUid` signals | Service-level toggle via `platformSettings/calling` |
| `notifications` | `recipientUid == uid` | Actor creates notifications; recipient marks read/deletes | System announcements only |
| `apiProviders` & `apiProviderActive` | Signed-in authenticated users (non-secret metadata only) | Authorized Admins (`super_admin`, `admin`); **secret field names blocked by rule** | Full non-secret configuration & live test probes |
| `apiUsageRecords` & `apiErrorLogs` | Admins only | Backend / Admin audit updates | Full read + triage |
