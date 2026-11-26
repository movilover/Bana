# BANA — Complete Product Blueprint & Implementation Architecture

**Tagline:** Discover More. Connect Better.  
**Firebase Project:** `bana-a5770`  

---

## 0. Existing Project Audit & Gap Resolution
An inspection of the existing BANA codebase (`src/`, `functions/`, `firestore.rules`, `storage.rules`) confirmed:
- **Working Baseline Preserved**: Firebase SDK initialization, Auth (`Email/Password`, `Google`, `Reset`, `Verification`), `ThemeContext` (Light / Dark / System + independent Messenger theme), `AppShell`, `CreateModal`, `VoiceRecorderAndPlayer`, `ReelsPage`, `MessengerPage`, `MarketplacePage`, `NotificationsPage`, `CreatorStudioPage`, `AdvertisePage`, `ProfilePage`, `SettingsPage`, and 21-module `AdminPage` all compile cleanly (`vite build` and `tsc --noEmit`).
- **Identified Gaps Addressed in This Upgrade**:
  1. **Smart Discovery Home (`DiscoverPage.tsx`)**: Added explicit interest personalization across all 9 recommendation categories, non-sensitive engagement ranking, Trending Reels strip, Community & Local Discoveries, Business Highlights, Recommended Creators, and recommendation controls (`Show more`, `Show less`, `Not interested`, `Hide creator`, `Report content`, `Reset recommendations`).
  2. **Comment Replies & Mentions (`PostCard.tsx`)**: Added threaded comment replies (`parentCommentId`) and interactive hashtag/mention highlighting.
  3. **Reels Controls (`ReelsPage.tsx`)**: Added network-aware Adaptive Quality selector (`Auto`, `Data Saver`, `HD`) and direct Report Content action.
  4. **Local Events & Event Registration (`CommunitiesPage.tsx`, `firestore.rules`, `firebase-blueprint.json`)**: Added `events` and `eventRegistrations` collections with event creation, Bangladesh district filtering, and live RSVP registration.
  5. **Tagline Alignment**: Updated brand copy to **Discover More. Connect Better.**

---

## 1. Product Structure
BANA is structured around **Smart Discovery** as the primary home experience, surrounded by dedicated, uncluttered functional workspaces:
- **Smart Discovery (`/discover`)**: Personalized interests, horizontal Stories, Trending Reels, Community & Local Discoveries, Business Highlights, Recommended Creators, and ranked Feed.
- **BANA Reels (`/reels`)**: Independent 9:16 vertical short-video stream.
- **Communities & Local Events (`/communities`)**: Interest groups, Bangladesh district hubs, polls, announcements, and RSVP local events.
- **BANA Market (`/market`)**: Dedicated commerce marketplace with Seller Dashboard and Messenger handoff.
- **BANA Messenger (`/messages`)**: Real-time 1:1 & group messaging with independent Light/Dark theming.
- **Notifications (`/notifications`)**: Real-time deduplicated activity center.
- **Creator Studio (`/creator-studio`)**: Verified analytics, 1,000-follower monetization gate, earnings ledger, and payout requests.
- **Ads Manager (`/advertise`)**: Self-service campaign builder with mandatory admin review and minor-safety protection.
- **Admin Control Panel (`/admin`)**: Server-verified RBAC console across 21 operational modules.

---

## 2. UI/UX Specifications
- **Visual Language**: Pure white (`#FFFFFF`) primary canvas in Light Mode, deep neutral obsidian (`#0A0A0C`) in Dark Mode, high-contrast neutral typography, subtle 1px hairline borders (`neutral-200` / `neutral-800`), and Indigo (`#4F46E5`) high-intent action accent.
- **Typography**: `Plus Jakarta Sans` (display/headers), `DM Sans` (body prose), `JetBrains Mono` with `tabular-nums` (counters, analytics, currency, timestamps).
- **Anti-Clutter Rules**: Single-elevation cards (no nested card sandwiches), clean unboxed metadata separated by `·`, minimum 44px mobile touch targets, and aggregate mobile sticky surfaces kept under 15% of viewport height.

---

## 3. Navigation Architecture
- **Desktop (`lg+`)**: Fixed 252px left navigation rail (8 core sections + Ads Manager + Settings + Admin when authorized + prominent `Create` CTA) paired with a sticky 56px top bar (Global Search, Messenger, Notifications, Profile).
- **Mobile (`<lg`)**: Compact 56px sticky top bar + fixed 64px bottom navigation (`Discover`, `Reels`, `Create`, `Communities`, `Market`).

---

## 4. Component Architecture
- `src/components/layout/AppShell.tsx` — Adaptive shell, global search, verification/rules status banner, mobile bottom bar.
- `src/components/create/CreateModal.tsx` — Unified composer for Text, Multi-Photo (Canvas-compressed), Video (thumbnail-extracted), Reel, 24h Story, Poll, and Voice posts.
- `src/components/feed/StoryCarousel.tsx` — Ephemeral 24h story rail & full-screen story viewer.
- `src/components/feed/PostCard.tsx` — Rich feed card with gallery carousel, poll voting, threaded comment replies, voice comments, recommendation menu (`Show more`, `Show less`, `Not interested`, `Hide creator`, `Report`).
- `src/components/voice/VoiceRecorderAndPlayer.tsx` — Lazy-permission `MediaRecorder` capture and waveform audio playback.
- `src/components/common/` — `BanaLogo`, `Avatar`, `ResilientImage`, `ErrorBoundary`.

---

## 5. Page & Route Structure
| Route | Access | Purpose |
| :--- | :--- | :--- |
| `/discover` | Public / Personalized | Smart Discovery home feed & recommendation modules |
| `/reels` | Public / Interactive | Full-screen 9:16 vertical video player |
| `/communities` | Public / Members | Communities + Local Events & RSVP |
| `/market` | Public / Sellers | BANA Marketplace & Seller Dashboard |
| `/messages`, `/messages/:conversationId` | Authenticated | Real-time Messenger with independent theme |
| `/notifications` | Authenticated | Real-time activity & studio alerts |
| `/creator-studio` | Authenticated | Creator analytics, monetization gate & payouts |
| `/advertise` | Authenticated | Self-service Ads Manager |
| `/profile/:username` | Public / Privacy-aware | Profile, posts, reels, photos, saved items |
| `/settings` | Authenticated | Themes, privacy, safety, data export, deletion |
| `/login`, `/register`, `/forgot-password` | Public | Firebase Authentication flows |
| `/admin` | Admin RBAC | 21-module operations & moderation dashboard |

---

## 6. Firestore Schema
Core collections defined in `firebase-blueprint.json`:
- `users/{uid}` (public profile only; no PII) & `userSettings/{uid}` (PII, `birthYear`, `interests`, `interestWeights`, `dismissedPostIds`, `hiddenCreatorIds`, `themeMode`, `messengerTheme`, privacy controls)
- Social graph: `userFollows`, `friendRequests`, `userBlocks`, `userMutes`
- Content: `posts`, `postLikes`, `savedPosts`, `comments` (with `parentCommentId`), `voiceComments`, `stories`, `storyViews`, `reels`, `reelViews`
- Messaging: `conversations`, `messages`, `messageRequests`
- Communities & Events: `communities`, `communityMembers`, `events`, `eventRegistrations`
- Commerce & Alerts: `marketplaceListings`, `notifications`
- Monetization & Ads: `creatorApplications`, `creatorEarnings`, `payoutRequests`, `advertiserAccounts`, `adCampaigns`, `adImpressions`, `adClicks`
- Governance: `reports`, `adminSettings`, `adminRoles`, `auditLogs`

---

## 7. Storage Architecture
Scoped path ownership in `storage.rules`:
- `/users/{uid}/*` (avatars & covers, images <= 15MB)
- `/posts/{uid}/*` (images, videos <= 150MB, voice posts <= 15MB)
- `/reels/{uid}/*` (vertical videos & thumbnails)
- `/stories/{uid}/*` (24h media)
- `/voice/{uid}/*` (voice comments <= 15MB)
- `/messages/{conversationId}/{uid}/*` (images, video, audio, safe documents <= 25MB)
- `/market/{uid}/*`, `/communities/{uid}/*`, `/ads/{uid}/*`
- Executable/script extensions (`.exe`, `.bat`, `.sh`, `.js`, `.apk`, etc.) are rejected both client-side and by MIME rules.

---

## 8. Cloud Functions Architecture (`functions/src/index.ts`)
- `submitMonetizationApplication`: Enforces 1,000+ followers, 18+ age, and active standing server-side.
- `reviewMonetizationApplication`: Admin approval/rejection transaction + audit log + deduplicated notification.
- `calculateCreatorCycleEarnings`: Server-side calculation of verified Reel views and engagement using `adminSettings` RPM rates.
- `requestCreatorPayout` & `processPayoutRequest`: Balance validation against verified `creatorEarnings` minus reserved payouts, checking Admin-enabled payout providers (including verified Bangladesh local wallets).
- `reviewAdCampaign`: Admin creative approval workflow.
- Triggers (`onFollowCreated/Deleted`, `onLikeCreated/Deleted`) & `cleanupExpiredStories` scheduler + `exportUserData` callable.

---

## 9. Security Rules Plan (`firestore.rules` & `storage.rules`)
- Default-deny catch-all at root.
- Verified email/Google sign-in required for content creation (`isVerified()`).
- Strict ownership checks (`authorId == request.auth.uid`), field-level `affectedKeys().hasOnly(...)` guards, immutable counters/approval flags, and participant isolation on `conversations`/`messages`.
- Bootstrapped Super Admin (`omor.faruk.sojol.2@gmail.com` with `email_verified == true`) plus `adminRoles/{uid}` RBAC lookup.

---

## 10. Monetization Workflow
1. Creator tracks progress toward **1,000 followers** in Creator Studio.
2. Reaching 1,000 followers unlocks the **Apply** button (alongside 18+ age, verified email, original content, and clean standing).
3. Application enters `pending` -> Admin reviews in `/admin` -> `approved` (grants `isCreator: true`) or `rejected` (with reason + Appeal option).
4. Verified earnings accrue via server-side Cloud Functions (`creatorEarnings`); users cannot edit balances or fabricate views.
5. Creators request withdrawals via Admin-configured payout providers (e.g., Bank Transfer, verified Bangladesh local wallets).

---

## 11. Advertisement Workflow
1. Advertiser creates campaign with creative, destination URL, daily/total budget, schedule, and mandatory **minor-safe & prohibited-goods attestation**.
2. Campaign enters `draft` or `pending_review` (cannot self-activate).
3. Admin reviews in `/admin` -> `active` or `rejected`.
4. Active ads render only to eligible non-minor accounts, tracking `adImpressions` and `adClicks`.

---

## 12. Admin Permissions
Five server-verified roles in `adminRoles/{uid}`:
- `super_admin`: Full access including role assignment & platform settings.
- `moderator`: Reports, posts, reels, comments, communities, marketplace moderation.
- `finance_manager`: Monetization approvals, creator earnings calculation, payout processing.
- `content_manager`: Posts, reels, videos, categories, ad creative reviews.
- `support_manager`: User standing reviews & support reports.

---

## 13. Performance Strategy
- Cursor-based Firestore pagination (`limit` + `startAfter`).
- Client-side Canvas image compression and video thumbnail generation before upload.
- Lazy-loaded images (`loading="lazy"`) and IntersectionObserver-controlled Reels playback (`preload="auto"` only for active slide, `visibilitychange` background pause, network-aware quality selector).
- Proper cleanup of all `onSnapshot` listeners and `MediaRecorder` streams.

---

## 14. Testing Strategy
- TypeScript static checking (`npm run lint`) and production bundle build (`npm run build`).
- End-to-end verification checklist in `docs/SETUP_AND_DEPLOYMENT.md` covering Auth, Smart Discovery personalization & controls, Reels playback, Voice Comments, Messenger dual themes, Market, Communities & Events, Creator Studio, Ads, and Admin RBAC.

---

## 15. Deployment Strategy
1. Enable Email/Password + Google Auth and Authorized Domains in Firebase Console (`bana-a5770`).
2. Deploy rules, indexes, and Storage rules: `firebase deploy --only firestore:rules,firestore:indexes,storage`.
3. Install & deploy Cloud Functions: `cd functions && npm install && cd .. && firebase deploy --only functions`.
4. Build & deploy frontend: `npm run build && firebase deploy --only hosting`.
