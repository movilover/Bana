# BANA — Firebase Setup, Deployment, Admin & Testing Guide

## 1. Prerequisites
- Node.js 20+
- Firebase CLI (`npm install -g firebase-tools`)
- Firebase project `bana-a5770`

## 2. Local Installation
```bash
npm install
cd functions && npm install && cd ..
```

Copy `.env.example` to `.env` and populate any optional keys (App Check site key, etc.).

Run the development server on port 3000:
```bash
npm run dev
```

## 3. Enable Required Firebase Services in Console (`bana-a5770`) — Spark Plan
1. **Authentication -> Sign-in method**:
   - Enable **Email/Password**
   - Enable **Google**
   - Add your authorized domains (including localhost and your Hosting domain) under **Authentication -> Settings -> Authorized domains**
2. **Firestore Database**:
   - Ensure Firestore is created in Native mode
3. **Firebase Storage (Optional / Legacy Spark Bucket)**:
   - Initialize the default Storage bucket (`bana-a5770.firebasestorage.app`). *Note: newer Google Cloud Storage buckets may require upgrading Firebase to Blaze; BANA surfaces clear upload error guidance if Storage is not enabled.*
4. **Firebase App Check (Recommended for Production)**:
   - Register the web app with reCAPTCHA v3 / Enterprise and set `VITE_FIREBASE_APPCHECK_SITE_KEY` in `.env`

See [`docs/SPARK_ARCHITECTURE_AND_BLAZE_MIGRATION.md`](./SPARK_ARCHITECTURE_AND_BLAZE_MIGRATION.md) for the complete Spark Free Plan quota optimization architecture and zero-rewrite Blaze upgrade steps.

## 4. Deploy Rules, Indexes & Hosting (Spark Free Plan)
```bash
firebase login
firebase use bana-a5770

# Deploy Firestore rules, indexes, and Storage rules (works on Spark!)
firebase deploy --only firestore:rules,firestore:indexes,storage

# Run local Firestore & Storage security rules test suite (requires Java JRE + Firebase Emulator)
npm run test:rules

# Build frontend and deploy to Firebase Hosting (works on Spark!)
npm run build
firebase deploy --only hosting

# OPTIONAL (Future Blaze Upgrade Only): Deploy Cloud Functions after linking billing
# firebase deploy --only functions
```

## 5. Admin Account Setup
1. Sign in to BANA using the bootstrapped Super Admin email (`omor.faruk.sojol.2@gmail.com`) via Google Sign-In or verified Email/Password.
2. Navigate to `/admin` -> **Admin Roles** to assign additional administrators (`super_admin`, `moderator`, `finance_manager`, `content_manager`, `support_manager`).
3. Configure supported Bangladesh local payout methods (e.g., bKash, Nagad, Rocket, Bank Transfer after provider verification) under `/admin` -> **App Settings**.

## 6. End-to-End Testing Checklist
- [ ] **Authentication**: Register with email/password, verify email prompt, login with Google popup, password reset email.
- [ ] **Discover & Stories**: Upload a story (image/video), view story carousel, create text/photo/gallery/video/poll/voice posts, sort by Recommended/Following/Latest/Popular, cursor-based Load More.
- [ ] **Reels**: Upload vertical video, verify 9:16 snap scroll, auto-play/pause on visibility & scroll, double-tap like, mute toggle, comments drawer with voice comments.
- [ ] **Voice Comments**: Click Record, grant microphone permission, preview, cancel or upload to Storage, play waveform audio.
- [ ] **Messenger**: Switch Messenger theme independently from app theme (Light/Dark), create conversation, send text/image/file/voice message, react, reply, edit, delete, toggle online status & read receipts.
- [ ] **Communities**: Create community with Bangladesh district tag, join/leave, post announcement & poll, review member approvals.
- [ ] **BANA Market**: Publish listing with photos, filter by category/price/location, save product, contact seller via Messenger, manage Seller Dashboard.
- [ ] **Creator Studio & Monetization**: Check 1,000-follower threshold gate, submit application when eligible, test Admin approval, inspect verified earnings & payout request.
- [ ] **Advertisement Manager**: Create campaign with creative & minor-safety attestation, verify Admin approval required before Active status.
- [ ] **Admin Control Panel**: Test all 21 modules, verify non-admin users are blocked from `/admin` and Firestore admin writes.
