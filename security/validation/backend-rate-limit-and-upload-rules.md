# Backend Validation, Authentication & Rate Limiting (`backend/`)

## 1. Multi-Provider JWT Authentication (`backend/src/middleware/auth.ts`)

Every `/api/*` endpoint (except `GET /health`) and every `/ws` WebSocket upgrade requires a valid Bearer JWT:

- **Firebase Auth RS256 ID Tokens**: Verified against Google's X509 signing certificates (`securetoken@system.gserviceaccount.com`), enforcing `aud === FIREBASE_PROJECT_ID`, `iss`, and `exp`/`nbf` bounds.
- **Supabase Auth HS256 JWTs**: Verified with constant-time `crypto.timingSafeEqual` against `SUPABASE_JWT_SECRET`.
- **Automated Test Tokens**: Only accepted when an explicit `BANA_TEST_AUTH_SECRET` env var is supplied inside test suites.

## 2. Rate Limiting (`backend/src/middleware/rateLimit.ts`)

- Global API routes: `120 requests / minute` per authenticated UID (or IP fallback).
- Calling token & ICE routes (`/api/calling/*`): `30 requests / minute` per authenticated UID.
- Exceeding limits returns `HTTP 429 Too Many Requests` with standard `Retry-After` and `X-RateLimit-Remaining` headers.

## 3. Security Headers & Upload Hardening (`backend/src/middleware/validate.ts`)

- Enforces `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, and strict CORS origin allowlisting (`CORS_ALLOWED_ORIGINS`).
- Validates `roomId` / `conversationId` resource identifiers against safe alphanumeric patterns.
- Blocks dangerous extensions (`.exe`, `.sh`, `.bat`, `.js`, `.html`, `.svg`, etc.) and enforces `100 MB` max size and MIME allowlisting on `/api/uploads/presign-check`.
