# BANA Verification & Testing Runbook (`TESTING.md`)

---

## 1. Automated Verification Commands

Run all commands from project root:

```bash
# 1. Frontend TypeScript static verification
npm run lint

# 2. Production Vite SPA bundle compilation
npm run build

# 3. Standalone Express + WebSocket backend compilation
npm run --prefix backend build

# 4. Real Backend HTTP + LiveKit/TURN Token + Billing Guard + 2-Client WebSocket E2E Suite
npm run test:backend

# 5. Multi-Cloud S3 Storage, Range Streaming, Backup, Story TTL & Manifest E2E Suite
npm run test:storage

# 6. Secret-Free Multi-Bundle ZIP Packaging & Secret Scanner
npm run release:zip
```

---

## 2. Automated E2E Coverage Breakdown

### `npm run test:backend` (`tests/calling/backend-and-providers.test.mjs`)
- Binds compiled `backend/dist/server.js` to a real local ephemeral TCP port (`127.0.0.1:0`).
- Verifies unauthenticated `HTTP 401` and non-admin `HTTP 403` RBAC enforcement.
- Verifies Super Admin `/api/admin/status` inspection without exposing secret key values.
- Verifies Coturn ephemeral `HMAC-SHA1` TURN credentials generated on `/api/calling/ice-servers`.
- Verifies LiveKit Open-Source SFU v2 `HS256` JWT minting (`video.roomJoin`, `video.room`, signature match).
- Verifies Paid Billing Approval Gate (`agora` & `100ms` return `HTTP 403` when `billingApprovedByAdmin !== true`, and `HTTP 400` if approved without real credentials).
- Verifies `/api/admin/providers/test` real connectivity checks (`webrtc_builtin` -> `connected`, unconfigured providers -> `unconfigured`).
- Opens two real `ws` WebSocket clients (`alice` & `bob`) against `/ws` and tests:
  - Unauthenticated `/ws` upgrade rejection (`401`)
  - Group room join/state sync (`room:join`, `room:state`, `room:participant_joined`)
  - SDP Offer/ICE candidate relay (`signal:offer`, `signal:ice`)
  - Screen-sharing toggle broadcast (`screen:toggle`)
  - Host-only mute/kick authorization vs non-host `error` rejection
  - Messenger typing indicator relay (`chat:typing`)
- Verifies sliding-window HTTP rate limiter (`HTTP 429` + `Retry-After` header).
- Verifies presence & non-empty integrity of `database/supabase/migrations/001`–`004` + `seed.sql`.

---

## 3. Manual Interactive Testing Checklist (Browser / Cross-Device)

Because WebRTC camera/microphone/screen hardware streams and cross-origin OAuth/Firestore rules require real browser sessions and deployed credentials:

1. **Messenger 1-to-1 & Group Chats (`/messages`)**:
   - Send text, emoji, photo, video, and voice note recording (`type: 'audio'`).
   - Confirm gray double-check (`deliveredTo`) transitions to blue double-check (`readBy`) when opened by recipient.
   - Verify in-thread message search filters matching bubbles cleanly.
2. **1-to-1 Audio / Video & Call Waiting**:
   - Start a call between User A and User B, toggle mic, camera, and screen share (`getDisplayMedia`).
   - Have User C call User A while A is in a call with B -> verify Call Waiting Hold & Accept / Busy Reject flow.
3. **Group Calling**:
   - Open a Group conversation, click Group Video Call, join from 2+ browser tabs, verify tile grid, Active Speaker highlight ring, and Host Mute/Remove/End Room actions.
4. **Firebase Rules Emulator (Outside Restricted Containers)**:
   - On a workstation with Java JRE installed, run `npm run test:rules` to validate `firestore.rules` and `storage.rules`.

---

## 4. Prompt 11 export verification status

| Check | Result |
|---|---|
| `npm install` / `npm ci` | **Not run** — packaging sandbox had no network access |
| `npm run lint`, `npm run build`, backend build | **Not run** in Prompt 11 (reported passing in Prompt 10) |
| `npm run test:backend`, `npm run test:storage`, `npm run test:rules` | **Not run** in Prompt 11 |
| Local import resolution (653 imports, 136 files) | Pass — 0 unresolved |
| Referenced image assets present | Pass (3/3) |
| JSON configs parse (firebase, indexes, blueprint, provider catalogs, package.json files) | Pass |
| `firestore.rules` / `storage.rules` brace balance | Pass (syntax sanity only, **not** a rules test) |
| Duplicate-file check | Pass — none |
| `npm run verify:export` (required files + secret patterns) | See the build report delivered with the ZIP |

Run on your own machine: `npm install && npm run check`, then `npm run test:rules` (Java required).

## 5. Prompt 12 verification status

| Check | Result |
|---|---|
| `npm run test:providers` (11 tests: URL rules, ICE URIs, paid-provider approval, storage selection fallback fix) | **Pass** in the build sandbox (Node 22, type stripping, no network) |
| Syntax parse of the 14 changed TS and TSX files (esbuild) | **Pass** |
| Strict type check of the new pure modules `providerValidation.ts` and `providerSelection.ts` | **Pass** (no errors) |
| Full `tsc` against the project | **Not a clean run**: dependencies are not installed in the sandbox. Prompt 12 adds 8 errors in `AdminApiManagementSection.tsx`, all of the missing-React-types kind. Re-run locally with `npm ci && npm run lint` |
| `npm run build`, `npm run test:backend`, `npm run test:storage`, `npm run test:rules` | **Not run** (no network for npm; rules need the Firebase emulator) |
| Browser test: rollback button, provider validation messages, lazy-loaded images | **Not run** |
| Diff against the Prompt 11 ZIP | Only the files listed in `docs/PROMPT_12_REPORT.md` §3 changed |

Run on your own machine, in this order: `npm ci`, `npm run lint`, `npm run build`, `npm run test:providers`, `npm run test:storage`, `npm run test:backend`, `npm run test:rules`.

Manual checks to perform in the Admin panel:

1. **API Management → Voice & Video Calling:** activate a second free provider, confirm the **Rollback to previous** button appears, press it, and confirm the first provider is active again.
2. **API Management:** try to activate a paid provider with billing not approved. The message must say to approve billing first.
3. **Storage & Recovery:** enable a paid provider without approval. Saving must fail with the billing message.
4. **Feed, profile, messenger, marketplace:** images should load as you scroll (lazy loading); no layout shift.


## Remediation (Prompt 01–03) test commands
See `docs/TESTING_AND_DEPLOYMENT_GUIDE.md` for exact setup. Summary: `npm install` → `npm run check` (lint, build, index check, logic tests, backend, storage) → `npm run test:rules` (needs Java + Firebase CLI; preflight explains what is missing) → `npm run check:full` for both. The rules tests added by the remediation were authored without an emulator and have not been run by the author.
