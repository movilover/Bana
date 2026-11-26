# BANA — Firebase Spark Free Plan Architecture & Future Blaze Upgrade Guide

## 1. Current Architecture Decision: Spark (Free) Plan ONLY

BANA (`bana-a5770`) is architected to run **strictly on the Firebase Spark (No-Cost) Plan** without linking any Cloud Billing account or activating paid Google Cloud services.

Central plan flags live in:
- `.env.example` (`VITE_FIREBASE_PLAN_MODE="spark"`, `VITE_ENABLE_CLOUD_FUNCTIONS="false"`)
- `src/lib/firebasePlan.ts` (`FIREBASE_PLAN_MODE`, `CLOUD_FUNCTIONS_ENABLED`, `SPARK_QUOTAS`, `invokeCloudFunction()`)

When `CLOUD_FUNCTIONS_ENABLED === false` (the Spark default), BANA **never** sends failing HTTPS requests to `cloudfunctions.net`. Instead, optional callable hooks immediately delegate to rule-enforced Firestore client transactions and admin review queues.

---

## 2. Official Firebase Spark (No-Cost) Quotas

| Firebase Service | Spark Free Quota / Limit | Notes & Technical Limits for BANA |
|---|---|---|
| **Firebase Authentication** | **50,000 MAU** free (Email/Password, Google, Apple, etc.) | Phone/SMS auth requires Blaze; BANA uses Email/Password + Google only. |
| **Cloud Firestore** | **50,000 reads/day**, **20,000 writes/day**, **20,000 deletes/day**, **1 GiB stored**, **10 GiB/month egress** | Enforced daily; excess traffic returns `resource-exhausted` (`Quota exceeded`). |
| **Firebase Hosting** | **10 GB storage**, **360 MB/day** data transfer, custom domains & SSL free | Fully compatible with BANA React/Vite SPA (`npm run build` -> `dist/`). |
| **Firebase Storage** | Legacy Spark buckets capped at **5 GB stored / 1 GB/day download** in US regions | **Important limitation**: Newer Firebase projects often require upgrading to Blaze before creating a Cloud Storage bucket. BANA handles `storage/bucket-not-found` and quota errors gracefully. |
| **Cloud Functions** | **Not available on Spark** (requires Blaze billing account for Cloud Build / Artifact Registry / deployment) | Kept intact in `functions/` for future upgrade; disabled cleanly at runtime via `CLOUD_FUNCTIONS_ENABLED`. |
| **Realtime Database** | Not used by BANA (Spark limit: 100 concurrent connections, 1 GB stored) | All realtime features use Cloud Firestore + WebRTC P2P. |

---

## 3. Client-Side Spark Free Quota Optimizations Applied

1. **Permanent Listener Consolidation (`src/contexts/AuthContext.tsx`)**:
   - Reduced permanent `onSnapshot` listeners per signed-in session from 5 down to **2** (`notifications` unread counter `limit(30)` and `conversations` unread badge `limit(30)`).
   - Converted `adminSettings/platform` from a permanent `onSnapshot` listener into a `getDoc` read cached in `sessionStorage` for 5 minutes.
   - Converted `userBlocks` and `userRestrictions` to one-time `getDocs` hydration updated on demand via `refreshSocialFilters()`.
2. **Stories Caching & View Deduplication (`src/components/feed/StoryCarousel.tsx`)**:
   - Switched from a permanent `onSnapshot` listener to `getDocsWithIndexFallback` (`limit(20)`) with a 60-second `sessionStorage` cache.
   - Deduplicated `storyViews` + `viewsCount` writes so re-opening already-viewed stories consumes 0 extra Firestore writes.
3. **Bounded Reels & View Deduplication (`src/pages/ReelsPage.tsx`)**:
   - Lowered initial Reels fetch from `40` to **`15`** with explicit **"Load More Reels"** pagination.
   - Deduplicated `reelViews` writes per browser session using `sessionStorage` (`bana_rv_<reelId>`).
   - Restricted Spark video preloading to `auto` on active slide, `metadata` on `distance === 1`, and `none` beyond distance 1.
4. **Comment Listener Bounds (`PostCard.tsx`, `FullscreenVideoModal.tsx`, `ReelCommentsPanel.tsx`)**:
   - Added `.limit(30)` on `comments` and `.limit(15)` on `voiceComments` listeners.
5. **Admin Panel Read Reduction (`src/pages/AdminPage.tsx`)**:
   - Reduced bulk initial collection fetches from `150–200` down to `30–80` recent rows per collection while keeping exact total KPI counts via `getCountFromServer()`.
6. **Zero Wasted Function Round-Trips (`src/lib/firebasePlan.ts`)**:
   - Replaced all direct `httpsCallable(functions, ...)` calls across auth, monetization, ads, marketplace, calling, and 8 admin modules with `invokeCloudFunction()`.

---

## 4. Service & Feature Classification Under Spark Only

### A. Works Directly on Spark
- Email/Password + Google Authentication, password reset, email verification.
- User profiles, privacy settings, block/restrict, follow/friend requests & friendships.
- Home social feed (text, polls, links, voice/image posts), comments, nested replies, reactions, saved posts, feed filters, cursor Load More.
- Discover search, Stories viewer, Messenger 1-on-1 & group chat, typing/read receipts, WebRTC 1-on-1 audio/video calling (STUN P2P via `stun:stun.l.google.com:19302`).
- Communities & District Groups (feed, polls, events, RSVPs, group chat, moderation).
- Marketplace browsing, search/filters, wishlist, persisted cart, **Cash on Delivery (COD)** and **Manual bKash/Nagad TrxID** transactional checkout (`runTransaction`), seller order management, verified-buyer product reviews.
- Creator Studio eligibility checks, monetization applications, payout profile saving, manual payout requests, and Admin-confirmed ledger settlements.
- Self-Service Ad campaign creation, manual bKash/Nagad/Bank billing deposits, Admin review, and rule-validated impression/click logging.
- All 21 Super Admin Control Panel modules using Firestore RBAC (`adminRoles` + bootstrapped email).

### B. Works Within Spark Quota Limits (Monitor Usage)
- Daily active user reads/writes against **50k reads / 20k writes** (`onSnapshot` restricted to active Messenger chats, comments drawer, and 2 shell counters).
- Firebase Hosting traffic (**360 MB/day**) & legacy Storage bandwidth (**5 GB**).
- Reels & media uploads (UI advises keeping Reels videos `<= 35 MB` on Spark to preserve quota; Storage rule hard limit remains `150 MB`).
- Admin overview & directory tables inspect the latest `50–80` documents per query plus exact collection counts.

### C. Requires Future Firebase Blaze Upgrade
- Deploying `functions/` (Cloud Functions v2 / Gen 2):
  - `syncMyAdminClaims` & `assignAdminRole` server-side Firebase Auth Custom Claims minting (`admin.auth().setCustomUserClaims()`).
  - Automated server-side `recordQualifiedContentView` & CPM earnings accrual calculations.
  - Automated `trackAdDeliveryEvent` server-side wallet deductions & campaign spend atomic increments.
  - Server-side `createMarketplaceOrder` / `transitionOrderStatus` / `processPayoutRequest` / `reviewAdPayment` trusted execution.
  - Newer Firebase Storage bucket provisioning if Google Cloud requires billing enabled on `bana-a5770`.
  - Phone/SMS OTP Authentication & Cloud Scheduler automated cleanups (e.g., expired 24h stories).

### D. Requires External Third-Party Services / Gateways
- **Instant Card & Mobile Wallet Gateways** (Stripe, SSLCommerz, bKash PGW API, Nagad API webhooks) — requires merchant accounts + API secrets configured in Blaze Functions (`STRIPE_SECRET_KEY`, `SSLCOMMERZ_STORE_ID`, etc.).
- **Dedicated TURN Relay Server** (Metered Global TURN, Twilio Network Traversal, or self-hosted Coturn) — needed for symmetric NAT/strict firewall WebRTC calls where free public STUN cannot traverse peer NAT; requires ephemeral credential generation in `getWebRTCIceConfig`.

---

## 5. Future Zero-Rewrite Upgrade to Firebase Blaze

When you decide to upgrade `bana-a5770` from Spark to Blaze in the future:

1. **Upgrade Plan in Firebase Console**:
   - Open Firebase Console -> `bana-a5770` -> Usage and billing -> **Modify plan -> Blaze (Pay as you go)** and set a monthly **Google Cloud Budget Alert** (e.g., `$5` / `$10`).
2. **Deploy Cloud Functions**:
   ```bash
   cd functions && npm install && npm run build && cd ..
   firebase deploy --only functions
   ```
3. **Flip the Two Client Plan Flags** in `.env` (or hosting build env):
   ```env
   VITE_FIREBASE_PLAN_MODE="blaze"
   VITE_ENABLE_CLOUD_FUNCTIONS="true"
   ```
4. **(Optional) Configure Payment & TURN Secrets**:
   - Store `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `SSLCOMMERZ_STORE_ID`, `SSLCOMMERZ_STORE_PASS`, or `TURN_SHARED_SECRET` / `TURN_URLS` in Google Cloud Secret Manager (`firebase functions:secrets:set ...`).
5. **Rebuild & Deploy Hosting**:
   ```bash
   npm run build
   firebase deploy --only hosting,firestore:rules,firestore:indexes,storage
   ```

Zero frontend component or database schema rewrites are required—`invokeCloudFunction()` automatically transitions from Spark adapters to server-authoritative Cloud Functions!
