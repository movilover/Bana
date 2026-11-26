# অডিটে পাওয়া সমস্যা ও কী ঠিক করা হয়েছে

| # | সমস্যা | সমাধান | ফাইল |
|---|---|---|---|
| B1 | Paid billing gate ক্লায়েন্ট থেকে bypass | অনুমোদন এখন সার্ভার env `APPROVED_PAID_PROVIDERS` থেকে; request-এর ফ্ল্যাগ উপেক্ষিত; rules-এ paid provider অনুমোদন শুধু Super Admin ও অননুমোদিত paid provider active করা নিষিদ্ধ; spoof regression টেস্ট যোগ | `backend/src/config.ts`, `routes/calling.ts`, `routes/admin.ts`, `firestore.rules`, `tests/calling/*` |
| H1 | Account deletion অসম্পূর্ণ | পোস্ট, রিল, স্টোরি, লাইক, ফলো, ব্লক, username, প্রোফাইল মোছা; সাম্প্রতিক লগইন যাচাই আগে; Blaze-এ `deleteMyAccountData` function; data export-এ রিল, ফলো, কমেন্ট যোগ | `src/lib/accountDeletion.ts`, `SettingsPage.tsx`, `functions/src/index.ts`, `firestore.rules` |
| H2 | Spark-এ follower counter বাড়ে না | `getCountFromServer` দিয়ে আসল সংখ্যা; প্রোফাইল, Creator Studio ও eligibility এটি ব্যবহার করে | `src/lib/socialCounts.ts`, `monetization.ts`, `ProfilePage.tsx`, `CreatorStudioPage.tsx` |
| H3 | Bootstrap admin ইমেইল স্থায়ী | `adminBootstrap/state.disabled` kill-switch; Functions-এ verified email বাধ্যতামূলক | `firestore.rules`, `functions/src/index.ts` |
| H4 | Order total ক্লায়েন্ট-নিয়ন্ত্রিত | rules-এ total = subtotal + delivery, প্রথম আইটেমের দাম listing-এর সাথে মিল, আকার সীমা | `firestore.rules` |
| M1 | Region চেক hardcoded `true` | policy.eligibleRegions-এর বিপরীতে আসল চেক; attestation ডিফল্ট বন্ধ | `monetization.ts`, `CreatorStudioPage.tsx` |
| M2 | Worker CORS `*` | শুধু নির্দিষ্ট origin | `workers/bana-media-broker/*` |
| M6 | Node সংস্করণ অসামঞ্জস্য | CI ও Pages workflow Node 24 | `.github/workflows/*` |
| — | GitHub Pages সাবপাথ/deep link | `base` + router `basename` + `404.html` ফলব্যাক | `vite.config.ts`, `App.tsx`, `deploy-pages.yml` |

## ইচ্ছাকৃতভাবে বদলানো হয়নি
- `users` কালেকশন সবার জন্য পাঠযোগ্য (M3): Discover/প্রোফাইল ফিচারের জন্য দরকার। (Remediation: `isMinor`, moderation note ও `messagingRestricted` এখন `userPrivate`-এ, public profile-এ নয়।)
- Content-Security-Policy (M4): GitHub Pages header সেট করতে দেয় না, meta CSP পরীক্ষা ছাড়া ঝুঁকিপূর্ণ।
- In-memory rate limit (M5): একক Render instance-এ ঠিক আছে।
- অন্য সব ফিচার/ফাংশন অপরিবর্তিত।

## Prompt 01–03 remediation (see REMEDIATION_AUDIT_REPORT.md for evidence and status of every finding)
Code written and statically checked; **rules/lint/build tests not executed by the author** (see TEST_RESULTS.md).
- Verification: moderators/support staff can no longer set `users.isVerified`; Super Admin manual grants and paid-workflow transitions are atomic with their audit records (`existsAfter/getAfter`).
- Video: real duration saved (`videoDurationSeconds`), no assumed 15s, event duration validated against the parent, `videoStats` split into private + `videoStatsPublic`.
- Feedback/reports: `not_interested`, `hide`, `hide_creator`, `report` saved for normal videos and reels; one report per reporter/target; report + counter atomic; report counts never restrict content; moderators can hold a video and resolving a report reconciles distribution status.
- Privacy: `friendships` participant-only, friend lists via `friendLinks` honouring `whoCanViewFriends` / `isPrivateAccount` / blocks, private fields in `userPrivate`, per-user suggestion stats, per-document suggestion dismissals.
- Admin: server-side status/method/date filters, search and cursor pagination for Paid Verification and Smart Video; video picker instead of typing keys.
- Super Admin: bootstrap retirement path with lock-out protection and recovery procedure (bootstrap NOT removed).
