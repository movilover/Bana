# BANA — Discover More. Connect Better.

**Project ID:** `bana-a5770`  
**Operating Mode:** Dual-Mode Architecture — works 100% Free on **Firebase Spark Plan** (`VITE_FIREBASE_PLAN_MODE="spark"`) AND supports seamless upgrade with **Standalone Node/Express + WebSocket Backend (`backend/`) on Render** + **Supabase PostgreSQL / Realtime (`database/supabase/`)**

---

## Core Architecture Overview

- **Frontend User & Admin SPA (`src/`):** React 19 + TypeScript + Vite 8 + Tailwind CSS v4
  - **Social Platform:** Smart Discovery Feed, Stories (24h TTL + backup archive), Reels Vertical Video Player, Communities & Groups, Marketplace & Storefronts, Creator Studio & Monetization, Advertise Manager.
  - **BANA Messenger (`src/pages/MessengerPage.tsx`):** Direct 1-to-1 & Group Chats, voice note (`audio`) recording/playback, image/video/file attachments, emoji reactions, reply threads, unsend/delete, typing indicators, explicit `deliveredTo` vs `readBy` receipts, in-thread search, message requests/blocking, and real-time `notifications`.
  - **Audio, Video, Group & Screen-Sharing Calling (`src/contexts/CallContext.tsx`, `src/components/messenger/GlobalCallOverlay.tsx`):**
    - 1-to-1 HD Audio/Video calling via WebRTC (`STUN` + optional Coturn HMAC `TURN`)
    - Multi-Peer Group Call Rooms (Mesh WebRTC + optional LiveKit Open-Source SFU routing), Host Mute/Kick/End-Room controls, and Active Speaker ring indicator (`AnalyserNode`)
    - Screen Sharing (`navigator.mediaDevices.getDisplayMedia()` + RTP sender track replacement)
    - Call Waiting Queue (`on_hold` toggle / Accept incoming / Busy reject)
    - Live `RTCPeerConnection.getStats()` network quality meter & adaptive video bitrate scaling
  - **Super Admin Control Panel (`src/pages/AdminPage.tsx`):**
    - User, Content, Reels, Moderation, Reports, Commerce, Monetization, Ads, Calling Service Controls (`allowGroupCalls`, `allowScreenSharing`, `maxGroupCallParticipants`), **Storage & Disaster Recovery Center**, and **API Management Center** across 7 independent provider categories with Paid Billing Approval Gate.
- **Standalone Realtime & Calling Backend (`backend/`):** Express 4 + `ws` WebSocket Server (`backend/src/server.ts`)
  - Verifies Firebase RS256 ID tokens, Supabase HS256 JWTs, and test HMAC tokens
  - Native LiveKit v2 JWT AccessToken minting, Coturn HMAC-SHA1 ephemeral TURN credentials, 100ms v2 JWT signing, and Agora billing-guard enforcement
  - Real-time `/ws` signaling hub (`room:join`, `signal:offer`/`answer`/`ice`, `screen:toggle`, host `participant:mute`/`kick`, `chat:typing`/`delivered`/`read`, heartbeat)
  - Real provider connectivity probes, usage tracking, error logs, sliding-window HTTP `429` rate limits, and upload hardening
- **Multi-Cloud Storage & Recovery (`src/lib/storage/`, `workers/bana-media-broker/`):** Cloudflare R2 Primary, Backblaze B2 Backup, Supabase Storage, Generic S3, optional GCS/Cloudflare Stream, SHA-256 manifests, and One-Click Recovery.
- **Portable PostgreSQL Schema (`database/supabase/`):** Complete SQL migrations (`001`–`004`) + seed (`seed.sql`) with strict `auth.uid()` Row Level Security (RLS), Storage bucket policies, and Realtime triggers.

---

## Calling & Realtime Provider Cost Matrix (Free vs Open-Source vs Paid)

| Provider | Tier | Pricing & Quotas | Billing Gate Required? | Notes |
|---|---|---|---|---|
| **Built-in WebRTC + Google STUN + Firestore / `/ws`** | **Free** | Unlimited P2P calls & signaling within Firebase Spark / Render Free limits | No | Default active mode. Zero API billing required. |
| **Built-in WebRTC + Self-Hosted Coturn TURN** | **Free / Infra Only** | Coturn software is MIT-free; relies on relay VPS bandwidth | No | Handles strict symmetric NAT/corporate firewalls using ephemeral HMAC-SHA1 credentials. |
| **LiveKit Open-Source SFU** | **Open Source** | Unlimited self-hosted Docker/VPS; LiveKit Cloud offers free dev tier (50 GB bandwidth) | No | Best for >8 participant Group Video rooms without Mesh CPU overhead. |
| **Agora RTC / 100ms Live** | **Paid** | ~10,000 free mins/month then pay-per-minute ($0.99–$3.99 / 1k min) | **YES (Admin Lock)** | Blocked (`HTTP 403`) unless Admin explicitly enables `billingApprovedByAdmin`. |
| **Supabase Free Tier** | **Free / Open Source** | 500 MB PostgreSQL, 1 GB Storage, 200 concurrent Realtime connections | No | Full SQL + RLS portability in `database/supabase/`. |
| **Cloudflare R2 + Backblaze B2** | **Free Tier** | 10 GB/mo free R2 ($0 egress) + 10 GB free B2 backup | No | Presigned transfers via `workers/bana-media-broker/`. |

---

## Quick Start (Local Development)

### 1. Frontend Web App (Port 3000)

```bash
npm install
cp .env.example .env.local
npm run dev
```

### 2. Optional: Standalone Calling & WebSocket Backend (Port 8788)

```bash
cd backend
npm install --legacy-peer-deps
cp .env.example .env
npm run dev
```

Set `VITE_BACKEND_URL="http://localhost:8788"` in root `.env.local` to enable Render/Express WebSocket signaling & token endpoints (leave blank to run purely via Firebase Spark Firestore signaling).

---

## Verification, Testing & Downloadable ZIP Exports

| Command | Purpose |
|---|---|
| `npm run lint` | TypeScript full project verification (`tsc --noEmit`) |
| `npm run build` | Production Vite SPA build check |
| `npm run --prefix backend build` | Compile standalone Express + WebSocket backend (`backend/dist/`) |
| `npm run test:backend` | Run real HTTP + WebSocket E2E tests (auth, RBAC, LiveKit/TURN JWT, rate limiter, 2-peer signaling) |
| `npm run test:storage` | Run multi-provider S3 HTTP E2E storage, range streaming, backup & recovery tests |
| `npm run backup:verify -- <file.json>` | Validate & SHA-256 verify an exported DB JSON snapshot |
| `npm run release:zip` | Build all 5 secret-free downloadable ZIP packages (`BANA-*.zip`) |
| `npm run test:rules` | Run Firebase Firestore/Storage rules emulator tests (requires Java JRE + Firebase Emulator) |

### 5 Generated Downloadable Archives (`npm run release:zip`)

1. `BANA-FULL-PROJECT.zip` — Complete repository (Frontend, Admin, Backend, Workers, Supabase SQL, Security, CI/CD, Docs)
2. `BANA-USER-WEBSITE.zip` — User-facing SPA source & Vite config
3. `BANA-ADMIN-PANEL.zip` — Admin Control Panel, RBAC, Calling/API Management & Storage Recovery UI modules
4. `BANA-BACKEND.zip` — Standalone `backend/` server, Cloudflare `workers/`, `render.yaml`, and `.github/workflows/`
5. `BANA-SECURITY.zip` — `firestore.rules`, `storage.rules`, `firestore.indexes.json`, `database/supabase/`, `security/`, and `tests/security/`

---

## Documentation Index

| Document | Contents |
|---|---|
| `INSTALLATION.md` | Prerequisites, install, run, build, troubleshooting |
| `DEPLOYMENT.md` | 14-step deployment guide (manual/cost steps marked), architecture, rollback |
| `ENVIRONMENT.md` | Every environment variable, secrets vs public, hard-coded values to replace |
| `DATABASE.md` | Firestore, Storage, Supabase SQL, indexes, emulator |
| `SECURITY.md` | Secrets handling, rules, auth, pre-launch checklist |
| `API_DOCUMENTATION.md` | Backend HTTP/WebSocket API, media broker, callable functions |
| `TESTING.md` | Test commands, coverage, Prompt 11 verification status |
| `PROJECT_STRUCTURE.md` | Where every part lives, entry points, dependency boundaries |
| `KNOWN_LIMITATIONS.md` | Verification gaps, architecture limits, hosting/plan limits |
| `STORAGE_PROVIDER_SETUP.md`, `BACKUP_RECOVERY_GUIDE.md`, `FIREBASE_SPARK_COMPATIBILITY.md` | Storage, backup and Spark/Blaze details |

> The User Website, Admin Panel and Super Admin Panel are one Vite build (`/admin` is role-gated). See `PROJECT_STRUCTURE.md`.

**Release:** `1.0.0-rc1` — Prompt 11 export. See `docs/PROMPT_11_REPORT.md` for the build/test report and file structure.
Run `npm run verify:export` to check required files and scan for secrets.

---

**Latest audit (Prompts 04 & 05):** see `docs/PROMPT_04_05_AUDIT_REPORT.md` for fixes, verification limits and remaining external setup.

**Latest audit (Prompt 06 — social graph):** see `docs/PROMPT_06_SOCIAL_REPORT.md`.

**Latest audit (Prompts 07 & 08 — marketplace, communities, monetization, ads):** see `docs/PROMPT_07_08_REPORT.md`.


## Prompt 09 — Super Admin Control Panel
See `docs/PROMPT_09_REPORT.md` for the audit, security changes, and the list of checks that still must be run locally (`npm run lint`, `npm run build`, `npm run test:rules`, `npm run test:backend`).


## Prompt 11 — Export & Deployment Preparation
See `docs/PROMPT_11_REPORT.md`. No live deployment was performed.

**Prompt 12 — Firebase Spark optimization & cost control:** see `docs/PROMPT_12_REPORT.md` for the requirement audit, changes, verification limits, and remaining items.

| Cost and architecture docs (Prompt 12) | Covers |
|---|---|
| `FIREBASE_SPARK_COMPATIBILITY.md` | Which Firebase products work on Spark, quotas, and what needs Blaze |
| `docs/FREE_TIER_PROVIDER_COMPARISON.md` | Free and open-source options per service, with paid gates |
| `docs/STORAGE_ARCHITECTURE_REPORT.md` | R2 / B2 layout, storage paths and limits from `storage.rules`, media cost controls |
| `docs/DATABASE_OPTIMIZATION_REPORT.md` | Firestore access patterns, the presence-write hot spot, and optimization backlog |
| `docs/MESSENGER_CALLING_COST_ANALYSIS.md` | Messaging and call bandwidth, TURN and SFU costs |
| `docs/COST_CONTROL.md` | What can cost money, safeguards, owner checklist, how to turn features off |

Paid services stay inactive until an administrator approves them. Nothing in this repository upgrades Firebase billing.
