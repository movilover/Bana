# BANA Platform Security Architecture (`security/`)

This folder documents the end-to-end security controls enforced across BANA's client SPA, Cloud Firestore (`firestore.rules`), Firebase Storage (`storage.rules`), Express/WebSocket Backend (`backend/`), and Supabase PostgreSQL (`database/supabase/`).

## Contents

- `database-policies/firebase-vs-supabase-rls.md` — Cross-database isolation matrix ensuring user privacy for DMs, calls, group calls, and notifications.
- `access-control/rbac-and-billing-guard.md` — Super Admin & role hierarchy, Admin private-chat access boundaries, and mandatory paid API billing approval gates.
- `validation/backend-rate-limit-and-upload-rules.md` — JWT verification, sliding-window rate limits (`429 Retry-After`), security headers, resource ID sanitization, and upload MIME/executable blocking.
- `security-rules/firestore-calling-rules-summary.md` — Complete summary of Firestore rules governing `messages`, `calls`, `groupCalls`, `apiProviders`, `apiUsageRecords`, and `apiErrorLogs`.
