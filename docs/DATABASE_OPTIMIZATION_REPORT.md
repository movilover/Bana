# BANA — Database Optimization Report (Prompt 12)

Scope: Cloud Firestore (primary database), plus the optional Supabase/Postgres path.

The counts below come from a static scan of the Prompt 11 source tree. They show where operations are written in code. They are not measured production traffic. Measure real usage in the Firebase Usage tab before making quota decisions.

## 1. Static code scan

| Pattern | Count in `src/` | Reading |
|---|---|---|
| `getDoc(` | 90 | Single-document reads, mostly on demand |
| `getDocs(` | 76 | Collection reads |
| `limit(` | 150 | Most queries are bounded |
| `getDocsWithIndexFallback(` | 57 | Shared helper with an index-error fallback (`src/lib/firestoreQuery.ts`) |
| `startAfter(` | 2 | Cursor pagination is rare |
| `getCountFromServer(` | 3 | Count aggregations (used by admin overview) |
| `onSnapshot(` | 10, in 4 files | Live listeners: `AuthContext` (unread counters), `GroupChatPanel`, `webrtcCalling` (signaling), `firestoreQuery` helper |
| `readSessionCache(` / `writeSessionCache(` | 7 / 8 | Session-level TTL cache (`src/lib/firebasePlan.ts`) |
| `setInterval(` | 8 | Mostly UI timers and call statistics; one Firestore write timer (see W1) |
| Composite indexes in `firestore.indexes.json` | 68 | Covers the multi-field queries used by feed, reels, marketplace, messenger, and admin |

## 2. What is already optimized

1. **Permanent listeners kept to a minimum.** Only the notification and conversation unread counters stay live for the whole session (`limit(30)` each). Blocks and restrictions are loaded once and refreshed on demand.
2. **Bounded first pages.** Stories use `limit(20)`; reels start at 15 with "Load more"; unread counters use `limit(30)`.
3. **Session caching.** Platform settings are cached for 5 minutes and stories for 60 seconds, which avoids repeat reads on navigation.
4. **Write de-duplication.** Story views and reel views are written once per browser session.
5. **Admin counts** use `getCountFromServer`, which is billed per 1,000 matched documents rather than per document (verify current Firestore billing terms).

## 3. Write-cost hot spot (found in this audit, not changed)

| # | Finding | Quantified impact | Why it was not changed in Prompt 12 | Recommended fix |
|---|---|---|---|---|
| **W1** | `AuthContext` writes `users/{uid}` (`lastActiveAt`, `showOnlineStatus`, `updatedAt`) once on sign-in and then **every 60 seconds** for every open signed-in tab (`setInterval(ping, 60000)`) | Up to about **1,440 writes per open tab per day**. The Spark cap is **20,000 writes per day**, which is consumed by about 14 tabs open all day. Typical sessions use far fewer, but growth will hit the cap | Online status shows "active" only if `lastActiveAt` is less than **120 seconds** old (`MessengerPage.tsx`). Lengthening the interval would make users look offline. The fix changes a visible feature, so it needs a product decision | (a) Stop writing while `document.visibilityState === 'hidden'`; (b) write only when the value changed by more than a threshold; (c) move presence to Firebase Realtime Database `onDisconnect`, which is free on Spark for small connection counts (verify) |

**Owner decision needed:** choose (a), (b) or (c) for W1. Until then, watch the daily write count in the Firebase Usage tab.

## 4. Other gaps (documented, not changed)

| # | Gap | Impact | Recommended next step |
|---|---|---|---|
| G1 | Only 2 `startAfter` cursors exist, so most lists show one bounded page and older items are unreachable | Functional gap; raising `limit` would add reads | Add cursor pagination to feed, marketplace and admin lists, reusing `firestoreQuery.ts` |
| G2 | Some screens may load the same profile document separately (to verify per screen) | Extra reads per navigation | Route profile reads through one cached helper |
| G3 | `getDocs` appears 76 times; repeated loads on remount are not all cached | Extra reads on tab switching | Add `readSessionCache` with a short TTL to the most-visited lists |
| G4 | Admin overview counts use `getCountFromServer` (3 uses) on every open | Admin-only; small | Cache counts for a few minutes in `sessionStorage` |
| G5 | Image lazy loading was missing on most `<img>` tags (1 of 26 had it) | Bandwidth, not Firestore | **Fixed in Prompt 12:** `loading="lazy"` added to 17 feed, profile, marketplace, messenger, community, admin, and avatar images |
| G6 | `apiProviderActive` and `storageProviders` are read on each admin page open | One read per open; small | Cache with the session cache if reads rise |

## 5. Data integrity and retention

- **No records were deleted or rewritten** by Prompt 12.
- **One new optional field:** `apiProviderActive.previousActiveProviderId`, written when an admin switches the active API provider. Older documents without it still work.
- **Storage provider config** writes now pass `validateStorageProviderConfig()` first. Invalid URLs, or an enabled paid provider without billing approval, are rejected before the write.
- **Retention:** story expiry (24 hours) and backup-archive retention are governed by `DEFAULT_RETENTION_POLICY` and `BACKUP_RECOVERY_GUIDE.md`. Prompt 12 does not add automatic purges.

## 6. Security notes

- No Firestore rule was changed. `apiProviderActive` writes still require `isFullAdmin()` and `hasNoSecretFields()`.
- The new `previousActiveProviderId` value is a provider ID, not a secret.

## 7. Operating guidance for Spark quotas

- Check the Firebase **Usage** tab daily during launch week. Reads (50,000/day), writes (20,000/day) and deletes (20,000/day) each have their own cap.
- Writes are the most likely limit to hit first because of W1. Resolve W1 before a public launch.
- If reads approach 70% of the daily cap, review G1 and G3 first.

## 8. Optional Supabase / Postgres path

`database/supabase/migrations/` holds the SQL schema for the optional Postgres path (`supabase_realtime` in the provider catalog). It is not the active database. If enabled: index join keys, use `LIMIT` on every list, and keep Row Level Security on (`004_rls_and_storage_policies.sql`).
