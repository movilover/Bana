# BANA — Database Guide

BANA has two data layers. **Firestore is the primary, working database.** The Supabase/PostgreSQL
schema is a *portable alternative/extension* that ships as SQL and is not wired as the main store
of the frontend.

## 1. Firestore (primary)

| File | Purpose |
|---|---|
| `firestore.rules` | Security rules (~86 KB, ~92 `match` blocks) |
| `firestore.indexes.json` | 68 composite indexes + field overrides |
| `firebase-blueprint.json` | Entity/collection blueprint used as design reference |
| `firebase.json` / `.firebaserc` | Rules, indexes, functions, hosting and emulator config (project `bana-a5770`) |

Main collection groups (from the rules file): users, usernames, userSettings, posts, postLikes, comments,
stories, storyViews, storyBackups, reels, reelViews, userFollows, friendships, friendRequests, followRequests,
userBlocks, userMutes, userRestrictions, conversations, messages, messageRequests, calls, groupCalls,
communities, communityMembers, events, notifications, marketplaceListings, stores, orders, orderItems,
shoppingCarts, wishlists, productReviews, sellerApplications, creatorApplications, creatorEarnings,
creatorPayouts, payoutRequests, adCampaigns, adCreatives, advertiserAccounts, adImpressions, adClicks,
adPayments, financialTransactions, adminRoles, adminSettings, adminAlertState, auditLogs, reports,
verificationRequests, apiProviders, apiUsageRecords, apiErrorLogs, storageProviders, mediaAssets,
backupJobs, databaseSnapshots, recoveryOperations, retentionSettings, and others. The rules file is the
source of truth for the complete list.

### Deploy rules and indexes (needs your Firebase login — manual step)

```bash
firebase login
firebase use <your-project-id>
firebase deploy --only firestore:rules,firestore:indexes,storage
```

Index builds can take minutes. Queries that need an index not yet built fail with `failed-precondition`.
Index coverage for every query was **not** verified (see `KNOWN_LIMITATIONS.md`).

### Local emulator

```bash
firebase emulators:start --only auth,firestore,storage     # ports 9099 / 8080 / 9199
npm run test:rules                                         # runs the rules test files
```

## 2. Cloud Storage for Firebase

`storage.rules` restricts uploads per path to the owner (`users/`, `posts/`, `reels/`, `stories/`, `voice/`,
`messages/{conversationId}/`, `groups/`, `market/`, `stores/`, `reviews/`, `communities/`, `ads/`,
`verifications/`) and denies everything else by default. Check current Firebase pricing/plan requirements for
Cloud Storage before relying on it; Google has changed which plans include default buckets.

## 3. Supabase / PostgreSQL (optional, portable)

Location: `database/supabase/`

| File | Contents |
|---|---|
| `migrations/001_initial_schema.sql` | Users, posts, comments, stories and base tables |
| `migrations/002_messenger_and_calling.sql` | Conversations, participants, messages, reactions, calls, group calls, signals |
| `migrations/003_api_providers_usage_logs.sql` | `api_providers`, `api_usage_records`, `api_error_logs`, `audit_logs` |
| `migrations/004_rls_and_storage_policies.sql` | Row Level Security enablement, policies, `bana-media` storage policies |
| `seed.sql` | Seed data |
| `../../deployment/supabase/config.toml` | Supabase CLI local config |

Tables created by the migrations: `users`, `posts`, `comments`, `stories`, `conversations`,
`conversation_participants`, `messages`, `message_reactions`, `notifications`, `calls`, `group_calls`,
`group_call_participants`, `group_call_signals`, `api_providers`, `api_usage_records`, `api_error_logs`,
`audit_logs` (17 tables; RLS enabled on 17; 33 `CREATE POLICY` statements in migration 004).

**Not covered by the SQL schema:** marketplace, communities, reels, monetization/ads/finance and admin RBAC
live only in Firestore today. Treat the SQL as a partial portability path, not a full migration target.

### Apply migrations (manual step — modifies a database)

```bash
supabase login
supabase link --project-ref <your-project-ref>
supabase db push            # applies database/supabase/migrations in order
```

Or paste each file, in numeric order, into the Supabase SQL editor. Review `seed.sql` before running it on
anything other than a development project. **These SQL files were not executed against a real PostgreSQL
instance during this export.**

## 4. Backups

See `BACKUP_RECOVERY_GUIDE.md` and `STORAGE_PROVIDER_SETUP.md`. `npm run backup:verify -- <file.json>`
validates an exported snapshot's SHA-256 manifest.
