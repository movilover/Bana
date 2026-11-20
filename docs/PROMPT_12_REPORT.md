# Prompt 12 — Firebase Spark Optimization & Cost Control Report

## 1. Was Prompt 12 applied to the Prompt 11 ZIP?

**Not fully.** The Prompt 11 ZIP already had groundwork from earlier prompts:

- Spark plan gate (`CLOUD_FUNCTIONS_ENABLED`, `invokeCloudFunction`, `SPARK_QUOTAS`).
- Paid providers shipped disabled with `requiresBilling` and approval flags.
- Multi-provider catalogs, one active provider per category, connection tests.
- Storage: R2 primary, B2 backup, Media Broker, quota alerts at 70/85/95%.
- Client-side image compression, video limits, and Spark listener consolidation.
- A short Spark compatibility note.

**Missing or incomplete before this session:**

- Configuration validation and rollback for providers.
- A storage fallback that could select an unapproved paid provider.
- Misleading "Unlimited free" quota labels.
- Lazy loading on most images.
- Reports: free-tier provider comparison, storage architecture, database optimization, messenger/calling cost, cost control, and this report.
- A unified admin service overview.

This session closed the code gaps that could be closed without a product decision or a live test, and wrote the missing reports. The remaining items are in §5.

---

## 2. Requirement audit

Status key: **Done** = implemented and verified in code. **Fixed now** = was missing or wrong, changed in Prompt 12. **Partial** = some of it exists, rest documented. **Deferred** = not done, reason given.

| § | Requirement | Before | Now | Evidence |
|---|---|---|---|---|
| 2 | Spark compatibility per service | Partial (8 services) | **Fixed now** (complete table) | `FIREBASE_SPARK_COMPATIBILITY.md` |
| 3 | Free / open-source alternatives evaluated | Missing | **Fixed now** | `docs/FREE_TIER_PROVIDER_COMPARISON.md` |
| 4 | Multiple configured providers per service | Done | Done | `api-providers/*.json`, `providerCatalog.ts`, `apiManagement.ts` |
| 4 | One selected active provider | Done | Done | `apiProviderActive`, storage `role: primary` |
| 4 | Provider status | Done | Done | `connectionStatus`, `configStatus` |
| 4 | Connection testing | Done | Done | Test buttons; storage probe |
| 4 | Configuration validation | Missing | **Fixed now** | `src/lib/providerValidation.ts`, used on storage save and API activation |
| 4 | Safe switching | Partial | Done | Confirmation dialog, audit entry, billing guard |
| 4 | Rollback where supported | Missing | **Fixed now** (API categories). Storage: **Deferred** | `handleRollbackProvider`, `previousActiveProviderId` |
| 4 | Usage and quota information | Partial | Partial | Estimated counters and labels. No live provider usage fetch (labelled as estimate) |
| 5 | Storage evaluation (R2, B2, Supabase, GCS, S3) | Done | Done (documented) | `docs/STORAGE_ARCHITECTURE_REPORT.md`, `STORAGE_PROVIDER_SETUP.md` |
| 5 | No claim of automatic transcoding or adaptive streaming | Done | Done | Stated in storage report and comparison |
| 6 | Image size, format, thumbnails | Done | Done | 1600 px, JPEG 0.82; video poster extraction |
| 6 | Video upload validation and metadata | Done | Done | 150 MB and 180 s limits in `videoUtils.ts` and `storage.rules` |
| 6 | Lazy loading | Partial (1 of 26 images) | **Fixed now** (17 more images) | `loading="lazy"` on feed, profile, marketplace, messenger, community, admin, avatar |
| 6 | Duplicate uploads | Partial (in-flight only) | Partial | Documented gap: no cross-session checksum lookup |
| 6 | Media caching and unnecessary downloads | Partial | Partial | Session caches; reel preload control |
| 7 | Query patterns, pagination, indexes | Partial | Partial | 68 composite indexes; 2 cursors (documented gap G1) |
| 7 | Realtime subscriptions | Done | Done | 10 listeners in 4 files |
| 7 | Unnecessary writes | Partial | Partial, **hot spot W1 found** | Presence heartbeat writes every 60 s per tab (see §5) |
| 7 | Database optimization report | Missing | **Fixed now** | `docs/DATABASE_OPTIMIZATION_REPORT.md` |
| 8 | Backend hosting, sleep, limits | Done | Done (documented) | `DEPLOYMENT.md` §12, `KNOWN_LIMITATIONS.md`, `COST_CONTROL.md` |
| 8 | Do not move privileged operations to frontend | Done | Done | Unchanged |
| 9 | Messenger and calling cost analysis | Missing | **Fixed now** | `docs/MESSENGER_CALLING_COST_ANALYSIS.md` |
| 9 | Do not claim calling or TURN is free | Violated in labels | **Fixed now** | 8 quota labels rewritten |
| 10 | Admin: active provider, free/paid status, config, errors | Mostly done | Partial | Existing API section shows these; storage section shows quota alerts |
| 10 | Unified service management overview | Missing | **Deferred** | Needs a UI design decision; see §5 |
| 10 | No fabricated usage | Done | Done | Labels say "Est." |
| 11 | No automatic Blaze upgrade | Done | Done | No billing code paths |
| 11 | No automatic paid activation | Done | Done | `enabled: false` defaults |
| 11 | No silent switch to paid | Partial | **Fixed now** | Storage fallback `all[0]` removed; covered by tests |
| 11 | Warnings and approval before paid activation | Done | Done | Approval dialogs, validator |
| 11 | Documentation of possible charges | Partial | **Fixed now** | `docs/COST_CONTROL.md` |
| 12 | Performance and free-tier optimization | Partial | Partial | Lazy loading added; W1 and G1–G3 documented |
| 13 | Integration with User, Admin, Super Admin | Done | Done | One Vite SPA (see `PROJECT_STRUCTURE.md`); no entry-file changes needed |
| 14 | Security unchanged | Done | Done | No rules changed; validators read no secrets |
| 15 | Deliverables 1–16 | Partial | See §7 | |
| 16 | Final architecture table | Missing | **Fixed now** | §8 below |
| 17 | Safety rules | Done | Done | No billing, no deploy, no data deletion |

---

## 3. Files changed in Prompt 12

### Code

| File | Change | Behavior effect |
|---|---|---|
| `src/lib/providerValidation.ts` | **New.** Pure validators for endpoint URLs, storage configs, and API configs | Used on save and activation only |
| `src/lib/storage/providerSelection.ts` | **New.** `selectPrimaryAndBackup()` | Paid providers are eligible only when approved; throws if no eligible provider exists |
| `src/lib/storage/storageManager.ts` | Uses the two modules above. Selection moved out, same priority order | Upload path unchanged for free providers. Invalid config is rejected on save |
| `src/components/admin/AdminApiManagementSection.tsx` | Validator on activation; records previous active provider; adds **Rollback to previous** button | Activation still asks for confirmation; rollback goes through the same checks |
| `src/types/apiManagement.ts` | 8 quota labels made accurate; `previousActiveProviderId` field added to the type | Labels only |
| `ProfilePage`, `MessengerPage`, `PeopleYouMayKnow`, `MarketplacePage`, `StoryCarousel`, `GroupChatPanel`, `CommunityDetailView`, `AdminContentSection`, `CreatorStudioPage`, `SellerDashboard`, `StorefrontPage`, `Avatar` | `loading="lazy"` added to `<img>` tags (attribute only) | No logic change |
| `package.json` | One script added: `test:providers` | None |

### Tests

| File | Coverage |
|---|---|
| `tests/providers/provider-validation.test.mjs` | 11 tests: URL rules (including ICE `stun:`/`turn:` URIs), paid-provider approval for storage and API, provider selection including the fallback fix |

### Documentation

| File | Status |
|---|---|
| `FIREBASE_SPARK_COMPATIBILITY.md` | Rewritten (complete service table) |
| `docs/FREE_TIER_PROVIDER_COMPARISON.md` | New |
| `docs/STORAGE_ARCHITECTURE_REPORT.md` | New; storage paths checked against `storage.rules` |
| `docs/DATABASE_OPTIMIZATION_REPORT.md` | New; counts from a static scan |
| `docs/MESSENGER_CALLING_COST_ANALYSIS.md` | New |
| `docs/COST_CONTROL.md` | New |
| `docs/PROMPT_12_REPORT.md` | This file |
| `TESTING.md`, `README.md` | Prompt 12 section and index entries added |

---

## 4. Verification

| Check | Result |
|---|---|
| `node --experimental-strip-types --test tests/providers/provider-validation.test.mjs` | **11 of 11 pass** (run in the build sandbox) |
| Syntax parse (esbuild) of the 14 changed TS and TSX files | **All pass** |
| Strict type check of the two new pure modules | **No errors** (checked against the Prompt 11 baseline error list) |
| Full `tsc` against the project | Not a clean run. The sandbox has no `react`, `firebase`, or `lucide-react` type packages, so the baseline has about 11,300 errors. Prompt 12 adds 8 errors in `AdminApiManagementSection.tsx` (11,338 → 11,346), all of the same kind (implicit `any` from missing React types). No new logic-type error was found |
| `npm run build`, `lint`, `test:backend`, `test:storage`, `test:rules` | **Not run**: npm network access is blocked in this environment |
| Browser test of rollback, lazy loading, and admin flows | **Not run** |
| Diff against the Prompt 11 ZIP | Only the files in §3 changed; other functions are unchanged |

**Regression caught in review and fixed:** the first version of the endpoint validator rejected `stun:` ICE URIs, which would have blocked activation of the default calling provider. ICE schemes are now allowed and covered by a test.

**What this means:** the code changes are small, syntax-checked, and unit-tested for the logic they add. They are not yet built or run in a browser. Run the local commands in §6 before deploying.

---

## 5. Remaining items (not done, with reasons)

| # | Item | Why not done in Prompt 12 | Recommended next step |
|---|---|---|---|
| R1 | **Presence write hot spot (W1):** `AuthContext` writes `lastActiveAt` every 60 s per open tab | Online status uses a 120-second window; changing the rate changes a visible feature | Owner decision: stop writing when the tab is hidden, write on change only, or move presence to Realtime Database |
| R2 | Storage provider rollback | Storage role changes go through the storage config form; a safe rollback needs its own history field and UI | Add a `previousRole` record like the API one |
| R3 | Unified service overview in admin | Needs a UI design; a new page would touch the admin shell | Build after the owner confirms the layout |
| R4 | Cursor pagination (G1) | Changes list behavior across several screens | Add per screen with tests |
| R5 | Cross-session duplicate detection | Needs a checksum lookup before every upload | Add with an index on `mediaAssets.checksumSha256` |
| R6 | Stored quota labels in Firestore | Existing `apiProviders` documents keep their saved label until re-saved | Re-save the affected providers once, or add a one-time migration |
| R7 | Live provider usage | Each provider has a different usage API; none is wired | Add per provider with credentials kept server-side |
| R8 | Vendor free-tier numbers | They change without notice | Verify each "verify" item before public claims |

**Carried over from Prompt 11 (still open):**

- The bootstrap super admin email is hard-coded in rules, code, `render.yaml`, docs, and tests.
- The Worker's `ALLOWED_ORIGINS` is `"*"` in `wrangler.toml`.
- The public Firebase web config is bundled (public identifier; restrict the key and enable App Check).

---

## 6. Manual steps for the owner

Run locally, in order:

1. `npm ci`
2. `npm run lint`
3. `npm run build`
4. `npm run test:providers`
5. `npm run test:storage`
6. `npm run test:backend`
7. `npm run test:rules` (needs Firebase emulators)

Then:

- Keep Firebase on **Spark**. Do not link billing.
- Check the Firebase Usage tab daily during launch week. Writes (see R1) are the first limit to watch.
- Decide on R1 before public launch.
- Replace the hard-coded admin email and restrict the Worker's origins.
- Set Cloudflare Worker secrets (`wrangler secret put`) for R2 and B2.
- Re-save any API provider whose quota label is outdated (R6).
- Verify every vendor number marked "verify" in the docs.

No live deployment, billing change, or data change was made in Prompt 12.

---

## 7. Deliverables checklist

| # | Deliverable | Status |
|---|---|---|
| 1 | User Website source | Included in ZIP; changes listed in §3 |
| 2 | Admin Panel source | Included; rollback and validation added |
| 3 | Super Admin Panel source | Same build as Admin (see `PROJECT_STRUCTURE.md`) |
| 4 | Backend source | Unchanged in Prompt 12 |
| 5 | Firebase Spark compatibility report | `FIREBASE_SPARK_COMPATIBILITY.md` |
| 6 | Free-tier provider comparison | `docs/FREE_TIER_PROVIDER_COMPARISON.md` |
| 7 | Updated provider configuration modules | `providerValidation.ts`, `providerSelection.ts`, `apiManagement.ts` |
| 8 | Storage architecture report | `docs/STORAGE_ARCHITECTURE_REPORT.md` |
| 9 | Database optimization report | `docs/DATABASE_OPTIMIZATION_REPORT.md` |
| 10 | Messenger and calling cost analysis | `docs/MESSENGER_CALLING_COST_ANALYSIS.md` |
| 11 | Cost-control documentation | `docs/COST_CONTROL.md` |
| 12 | Updated entry and index files | `README.md` index |
| 13 | `.env.example` without secrets | Unchanged; no secrets present |
| 14 | Deployment documentation | `DEPLOYMENT.md` unchanged; cost and Spark notes are in the new docs |
| 15 | Testing report | §4 of this file and `TESTING.md` |
| 16 | Complete ZIP | `BANA-FULL-PROJECT-prompt12.zip` |

---

## 8. Final architecture table

Confirmed = in code or published by the vendor (verify dates). Estimate = calculated from stated assumptions.

| Service | Current provider | Recommended provider | Free-tier availability | Paid requirement | Limitations | Required configuration | Implementation status |
|---|---|---|---|---|---|---|---|
| Authentication | Firebase Auth | Same | Free up to 50k MAU (verify) | None on Spark | No phone auth on Spark | Authorized domains, providers | Implemented |
| Database | Cloud Firestore (Spark) | Same | Daily read/write/delete caps (verify) | None on Spark | Daily caps; W1 write hot spot | Rules and indexes deployed | Implemented |
| Realtime messaging | Firestore listeners | Same | Within Firestore caps | None | Free hosting sleeps | None extra | Implemented |
| Backend hosting | Render free (optional) | Render free, or paid for always-on | Sleeps when idle (verify) | Paid instance | Cold starts, ephemeral disk | Render service and env | Implemented, optional |
| Media broker | Cloudflare Worker | Same | Request caps (verify) | Above caps | Origins set to `*` (R-carried) | `wrangler secret put` | Implemented |
| File and image storage | Cloudflare R2 | Same | 10 GB-month, $0 egress (verify) | Above allowance | No transcoding | Bucket, token, Worker | Implemented |
| Backup storage | Backblaze B2 | Same | 10 GB free (verify) | Above allowance | Download limits (verify) | Bucket, application key | Implemented |
| Video storage | R2 progressive | Same; HLS optional | As R2 | Stream is paid | No adaptive bitrate | None extra | Implemented (progressive) |
| Push notifications | In-app + Browser Notifications | Same; FCM later | In-app free | None | Needs app open | None | Implemented; FCM catalog only |
| 1:1 calling | Built-in WebRTC | Same, plus Coturn if needed | No platform fee | VPS for TURN | Fails on some networks without TURN | `TURN_URLS`, `TURN_SHARED_SECRET` | Implemented; TURN optional |
| Group calling | Mesh, default 8 | LiveKit OSS | Software free; server cost | VPS | Mesh uploads grow with N | LiveKit env | Mesh implemented; LiveKit optional |
| Monitoring | Admin telemetry, backend `/health` | Uptime checker + Render logs | Varies (verify) | None for basics | Not full observability | Manual setup | Partial |
| Backups | Manifest + R2/B2 queue | Same | As storage | As storage | Manual restore | Storage configured | Implemented |
| Paid providers (Agora, 100ms, GCS, Stream, payments) | Disabled | Not recommended until approved | Published free minutes (verify) | Billing approval | Require approval | Keys server-side only | Guarded, inactive |

---

*Status of this report: code changes verified only as described in §4. No live test, deployment, or billing change was performed.*
