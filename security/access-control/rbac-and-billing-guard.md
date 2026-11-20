# RBAC Hierarchy, Privacy Safeguards & Paid Billing Guard

## 1. Admin Roles (`src/lib/adminRbac.ts`)

- `super_admin` — Full control across all modules including API Management, Storage & Recovery, Billing Approvals, and Role Assignments (default founder: `omor.faruk.sojol.2@gmail.com`).
- `admin` — Platform moderation, Calling service toggles, User management, and API Provider configuration (`manage_api_providers`).
- `moderator` — Content, Reels, Stories, Comments, and Report queue triage (cannot edit billing or API providers).
- `support_staff`, `finance_manager`, `ad_manager` — Strictly scoped to their operational queues.

## 2. Privacy Protection for Private Messages & Calls

- Moderators and Administrators **never** have unrestricted read queries over `conversations`, `messages`, or `calls` in either `firestore.rules` or Supabase RLS (`004_rls_and_storage_policies.sql`).
- Only user-submitted moderation reports and aggregated service metrics are visible inside the Admin panel.

## 3. Mandatory Admin Paid Billing Approval Gate

Paid providers (`agora`, `100ms`, `gcs`, `cloudflare_stream`) remain locked (`billingApprovedByAdmin: false`) by default:

1. Calling `POST /api/calling/token` for `agora` or `100ms` without `billingApprovedByAdmin: true` immediately returns `HTTP 403` with `requiresBillingApproval: true`.
2. In the Admin API Management UI, clicking **Approve Paid Billing** displays a confirmation modal explaining usage-based pricing before unlocking activation.
3. No secret credentials are ever stored in Firestore or frontend Vite env variables (`VITE_*`).
