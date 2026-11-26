# Firebase Spark Free Plan Compatibility Report

**Project:** BANA (`bana-a5770`)
**Current mode:** `VITE_FIREBASE_PLAN_MODE="spark"`, `VITE_ENABLE_CLOUD_FUNCTIONS="false"` → `CLOUD_FUNCTIONS_ENABLED = false`
**Updated:** Prompt 12 (Spark optimization & cost control)

> **Verification status.** Quota numbers below are the values BANA's code already assumes (`SPARK_QUOTAS` in `src/lib/firebasePlan.ts`) plus Firebase's published Spark limits as understood at the time of writing. Google changes plan terms without notice. Before relying on any number, check the Firebase pricing page and the project's **Usage and billing** page. Items marked **(verify)** are provider-dependent.
>
> BANA never upgrades the billing plan automatically. This document does not change any billing setting.

---

## 1. Service-by-service audit

| Firebase / Google service | Used by BANA? | Works on Spark? | Needs Blaze? | Quotas / limits (Spark) | Limitations for BANA | Alternative in use or available |
|---|---|---|---|---|---|---|
| **Firebase Authentication** | Yes (Email/Password, Google) | Yes | No (phone SMS requires Blaze) | 50,000 MAU free (verify) | Phone/SMS sign-in is not used | — |
| **Cloud Firestore** | Yes (primary database) | Yes | No | 1 GiB stored; 50k reads/day; 20k writes/day; 20k deletes/day; 10 GiB/month egress | Daily quotas are the main constraint. Exceeding them returns `resource-exhausted` | Session caches, bounded `limit()`, consolidated listeners (see `DATABASE_OPTIMIZATION_REPORT.md`) |
| **Firebase Hosting** | Yes (static SPA, if deployed there) | Yes | No | 10 GB stored; 360 MB/day transfer | Large media must not be served from Hosting | GitHub Pages or Cloudflare Pages also work for the static SPA |
| **Cloud Storage for Firebase** (`*.firebasestorage.app`) | Rules exist; **not used for new uploads** | Provider-dependent | **Creating a new default bucket can require Blaze** (verify) | Legacy buckets: about 5 GB stored and 1 GB/day download (verify) | Relying on it for new media would block Spark deployments | All active uploads go through R2 / B2 via the Media Broker (Cloudflare Worker) |
| **Cloud Functions** (`functions/`) | Dormant | **No** (deployment needs Blaze) | **Yes** | — | Disabled at runtime by `CLOUD_FUNCTIONS_ENABLED`; no failing HTTPS calls are sent | `workers/bana-media-broker` (Cloudflare Workers free tier) for presigning and backup copies |
| **Firebase Cloud Messaging (FCM)** | Catalog entry only (`fcm`, `isActive: false`) | Yes | No | Free (rate limits apply) | Not active; the in-app notification path is used | In-app Firestore notifications + Browser Notification API (active) |
| **Realtime Database** | No | Yes (limited) | No | 100 simultaneous connections; 1 GB stored (verify) | Not used — BANA uses Firestore for realtime | Firestore `onSnapshot` (10 listeners in 4 files) |
| **Firebase App Check** | Initialized (`initializeAppCheck`, 2 references) | Yes | No | Free (verify) | Requires a reCAPTCHA site key in the environment | — |
| **Google Analytics (GA4) via `getAnalytics`** | Yes (2 references) | Yes | No | Free | Analytics only; no paid features used | — |
| **Firestore managed export / scheduled backups** | No | **No** (exports need a Cloud Storage bucket, which needs billing) | Yes | — | Not used | BANA's own manifest export (`scripts/backup-manifest-cli.mjs`) + R2/B2 backup queue |
| **Firebase Remote Config / Performance / Crashlytics** | No | Yes | No | Free tiers (verify) | Not used | — |
| **Cloudflare Stream** (not Firebase) | Catalog only (`cloudflare_stream`, paid) | N/A | Not applicable; paid | About $5 per 1,000 minutes stored (verify) | Guarded by `requiresBilling` and `billingApproved`; disabled by default | Browser progressive MP4/WebM (active) |
| **Google Cloud Storage** (not Firebase) | Catalog only (paid) | No free use without billing | Billing account required | 5 GB-month US free tier only with billing linked (verify) | Blocked by `requiresBilling: true, billingApproved: false` | Cloudflare R2 (primary), Backblaze B2 (backup) |

---

## 2. What Spark can and cannot do for BANA

**Works on Spark without a billing account:** sign-in, Firestore reads and writes within quota, Firestore realtime listeners, static hosting, FCM (if enabled later), App Check, and Analytics.

**Does not work on Spark:** Cloud Functions deployment, new Cloud Storage buckets (provider-dependent), managed Firestore exports to Cloud Storage, phone-number auth, and any Google Cloud product that needs billing.

**BANA's approach:** Keep Firestore as the database and Firebase Auth as the identity provider. Move media to R2 / B2 through the Worker broker. Keep privileged operations on the Render backend or the Worker, never in the browser.

---

## 3. Client-side Spark optimizations already in the codebase

These were introduced in earlier prompts and are confirmed present in the Prompt 11 ZIP.

1. **Listener consolidation** (`src/contexts/AuthContext.tsx`): permanent listeners reduced to notification and conversation unread counters (`limit(30)` each). `adminSettings/platform` is read once and cached in `sessionStorage`. `userBlocks` and `userRestrictions` are loaded on demand.
2. **Stories:** `getDocsWithIndexFallback` with `limit(20)` and a 60-second session cache; story-view writes are de-duplicated.
3. **Reels:** initial fetch lowered to 15 with "Load more"; view writes de-duplicated per browser session; video preloading restricted by distance from the active slide.
4. **Media:** images are compressed client-side (max width 1600 px, JPEG quality 0.82); video is limited to 150 MB and 180 seconds at upload.
5. **Plan guard:** `invokeCloudFunction()` throws a local `CloudFunctionsDisabledError` on Spark instead of calling a non-existent endpoint.

---

## 4. Future upgrade path (optional, manual)

Moving to Blaze is **not** automatic and is **not** part of this export.

1. Upgrade the Firebase project manually in the Firebase Console, after the owner decides to pay.
2. Set `VITE_FIREBASE_PLAN_MODE="blaze"` and `VITE_ENABLE_CLOUD_FUNCTIONS="true"`, then deploy `functions/`.
3. Keep R2 + B2 active so egress stays at $0 for media.
4. Approve any paid storage or API provider individually in **Admin → Storage & Recovery** or **Admin → API Management**.

See `docs/SPARK_ARCHITECTURE_AND_BLAZE_MIGRATION.md` for the architecture detail and `docs/COST_CONTROL.md` for the approval rules.
