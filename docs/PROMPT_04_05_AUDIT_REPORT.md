# BANA — Prompt 04 (Reels) & Prompt 05 (Messenger / Calling) Audit and Fix Report

Scope: verify the Prompt 03 ZIP against the Prompt 04 and Prompt 05 requirements, fix what was missing, and report honestly what was and was not verified.

## 1. Audit result

### Already implemented (kept untouched)
Reels: full-screen snap feed, one active video (others paused, distant slides `preload=none`), tab-hidden pause, progress/seek bar, buffering + slow-network hint, error + retry + backup-mirror fallback, comments/replies/voice comments, share-to-Messenger, follow, upload with validation (type/size/duration), progress, thumbnail and captions, multi-provider storage, honest "no transcoding" notice.
Messenger/Calling: private + group chat, replies, edit (15 min), delete, reactions, voice notes, attachments, unread counts, presence, block/privacy checks, 1:1 audio/video WebRTC, group rooms (mesh, optional LiveKit), screen sharing (stops on browser `ended`), camera switch, mute, ICE restart, missed-call notifications, call history, provider abstraction (WebRTC/LiveKit/Agora/100ms), paid-provider admin gate, admin calling settings. Admin cannot read private conversations (Firestore rules).

### Gaps found and fixed in this round
| # | Requirement | Problem found | Fix |
|---|---|---|---|
| 1 | P04 §9 Report reason selection | Reel report sent a hard-coded reason instantly, no choice, duplicates possible | New `ReportDialog` (reason list, optional details, error states). One report per user+target is enforced by a deterministic document id, so duplicates are rejected by the backend |
| 2 | P04 §3 Like/Save/Follow correctness | Writes swallowed errors (`.catch(()=>{})`) and still showed success; double taps could double-count | Awaited writes, rollback of optimistic UI on failure, in-flight guards, error toasts |
| 3 | P04 §6 Playback speed | Missing | Speed selector (0.5x–2x) in the Reel menu, reset per reel, re-applied after source switch |
| 4 | P04 §10 Admin Reels review | No playback preview / details / report history | New `AdminReelReviewModal` (real playback of stored file, metadata, creator, report list, Remove/Restore through the existing authorized `adminModerateContent` path). "Review" button added in Content → Reels and in Reports for reel/video reports |
| 5 | P05 §11/§12 Abuse reporting | Messenger only had a one-click conversation report with a fixed reason; no message-level report | Conversation report uses `ReportDialog`; per-message "Report message" added. Only the single message text the reporter chooses to submit is shared (`evidence`); admins still cannot read the conversation |
| 6 | Copy-link/message feedback | Showed "copied" even if clipboard failed | Success only after the clipboard promise resolves; error otherwise |
| 7 | Security | `reports` create rule did not validate shape | Rule now requires `reason` (2–120 chars) and caps `details`/`evidence` at 500 chars |

## 2. Changed files
- `src/components/common/ReportDialog.tsx` (new)
- `src/components/admin/AdminReelReviewModal.tsx` (new)
- `src/pages/ReelsPage.tsx`
- `src/pages/MessengerPage.tsx`
- `src/components/admin/AdminContentSection.tsx`
- `src/components/admin/AdminReportsSection.tsx`
- `src/components/admin/AdminMessengerCallingSection.tsx`
- `firestore.rules`
- `docs/PROMPT_04_05_AUDIT_REPORT.md` (this file)
`index.html` was reviewed and needs no change.

## 3. What was actually verified (be aware of the limits)
The sandbox used for this round had **no network access**, so `npm install` was impossible.
- Verified: every `.ts`/`.tsx` file under `src/`, `backend/src/`, `functions/src/`, `workers/` parses cleanly with esbuild (0 failures); imported helpers/APIs used by the new code were checked to exist.
- **Not run:** `tsc --noEmit`, `vite build`, `npm run test:backend`, `npm run test:storage`, Firestore rules emulator tests, and any browser/device test (Android, iPhone, tablet, real calls, real camera/microphone, real uploads). Run on your machine:
  `npm install && npm run lint && npm run build`, then `npm run test:backend` and `npm run test:rules`.
- Nothing in this report claims runtime verification of calling or video playback.

## 4. Remaining limitations / external setup
- **Reel counters need Cloud Functions.** Like, view and comment counters are written only by Cloud Functions (`onLikeCreated`, `onReelViewCreated`, `onCommentCreated`) because clients are intentionally not allowed to write counters. On the default Spark mode (functions disabled) the UI updates optimistically but stored counters will not change until Functions are deployed (Blaze plan). Deploy `functions/` and set `VITE_ENABLE_CLOUD_FUNCTIONS=true`.
- **No transcoding / adaptive streaming.** Ordinary object storage (R2/B2/S3) does not transcode. Quality choices appear only when variants or an HLS manifest exist; otherwise the UI says so. Cloudflare Stream/other transcoders are paid and require explicit approval.
- **Group calls** use mesh WebRTC (practical limit is about 6–8 participants; the admin setting caps it). Larger rooms need a LiveKit SFU you host or LiveKit Cloud (free tier limits apply). Agora/100ms remain blocked until the administrator approves billing.
- **TURN is required** for users behind symmetric NAT/corporate firewalls; configure Coturn (`backend/.env.example`). WebRTC is not reliable on every network without it.
- Screen sharing requires a supporting desktop browser; mobile browsers generally do not support it.
- Provider secrets live only in `backend/` environment variables; nothing secret is in frontend source or `.env.example`.
