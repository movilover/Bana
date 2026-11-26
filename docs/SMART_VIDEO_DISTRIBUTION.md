# Smart Video Distribution

Applies to Reels and regular video posts. Built on the existing Firestore project; no new paid service, no Cloud Functions required (Spark-safe).

## Metric definitions (authoritative)
| Metric | Definition |
|---|---|
| **Total plays** | Accepted viewing sessions (client-reported; see limits). Max **one per viewer per video per UTC day** (deterministic event id `<video>_<uid>_<Y-M-D>`), so refreshes/replays the same day never add plays. |
| **Valid views** | A play whose `watchMs >= validMinWatchMs` **or** `watchMs >= validMinPercent% of duration`, and the viewer is not the author. The *flag* is re-derived by `firestore.rules` from the submitted numbers; the numbers themselves (`watchMs`) are client-reported and are NOT proof of real playback. |
| **Unique viewers** | Distinct accounts that have ever played the video (`videoViewers/{video}_{uid}` marker, created once). Also the "audience reach". |
| **Watch time** | Sum of `watchMs` over accepted plays (measured only while the video is playing, tab visible, slide active; capped at 4x duration per event). |
| **Average watch duration** | Watch time / total plays. |
| **Completion rate** | Plays with `watchMs >= completionPercent% of duration` / total plays. |
| **Rewatch rate** | Plays with `watchMs >= 1.5 x duration` (looped) / total plays. |
| **Skip rate** | Plays that ended before `skipMs` without completing / total plays. |
| **Negative rate** | (Not interested + Hide) feedback / total plays. `hide_creator` is a personal preference (stored, applied through the viewer's hidden-creator list) with no aggregate counter. |
Thresholds (`validMinWatchMs`, `validMinPercent`, `completionPercent`, `skipMs`) are admin-configurable; rules fall back to the same defaults if no config exists (a test checks parity).

## Distribution stages (derived, deterministic)
Every client computes the same stage from the public aggregate counters + admin config (`deriveStage`):
1. **Stage 1 – initial test**: cap `stage1Audience` unique viewers. Only followers plus *relevant, sampled* viewers (`audienceSampleRate`, stable hash per video+viewer; relevance >= `stageMinRelevance`, halved for new creators).
2. **Evaluation**: when the cap is reached (or `evalWindowHours` passed) AND `evalMinValidViews` collected, thresholds are checked: avg watch %, completion %, engagement per valid view, skip %, negative %, suspicion flags. (Report counts are NOT a gate: reports are review signals and can be brigaded.) Not enough data → **no expansion**.
3. **Stage 2 / 3**: pass → next audience cap (`stage2Audience`, `stage3Audience`), same evaluation again.
4. **Stage 4 – continued**: open, ranking-driven; automatically **reduced** ("limited") if skip/negative rates exceed limits.
A failed evaluation never expands; the video stays "limited" at its current cap. **Safety overrides performance**: admin `stopped`/`paused` → not recommended; `under_review` (set only by a moderator decision, e.g. "Hold video" on a report) → never beyond stage 1; `restricted` → followers only.
Stage/status is *derived*, so a new upload "enters stage 1" the moment it exists (no stats doc is needed until the first view).

## Ranking
`score = Σ weight x signal` using rates, not counts, with smoothing toward a neutral prior (`priorStrength`) so tiny samples don't swing results and new videos aren't punished for having no data:
relevance (interests, category weights, follows, language when present), avg watch ratio, completion, rewatch, engagement per valid view (likes+2 comments+3 shares+3 saves), freshness (half-life), following; minus skip rate, negative feedback, report pressure. Views alone are never a positive signal. Suspicious videos get a 0.5 trust multiplier on quality signals and cannot expand.
Feed assembly (`buildDistributionFeed`): stage → eligibility (blocked, hidden creator, not-interested, own video, recently shown) → score → **new-creator exploration slots** (`newCreatorSlotPercent`, ranked by relevance+freshness, not popularity) → **creator diversity** (`maxPerCreatorPerPage` hard cap + discount). If fewer than 6 videos remain, it backfills only with videos skipped for ordinary audience gating (never safety/block/hide/not-interested).

## Data model
| Collection | Purpose | Notes |
|---|---|---|
| `videoDistributionConfig/settings` | all thresholds/weights/switches | signed-in read; Admin/Super Admin write; every bound validated in rules |
| `reelViews/{video}_{uid}_{day}` | one event per viewer/day (existing collection reused) | rules re-derive valid/completed/skipped/rewatched |
| `videoViewers/{video}_{uid}` | unique-viewer marker | create-once |
| `videoFeedback/{video}_{uid}_{kind}` | not_interested / hide / hide_creator / report, once each | create-once; a `report` signal only commits together with the real `reports/<type>_<id>_<uid>` doc |
| `videoStats/{video}` | **PRIVATE** creator analytics: all counters incl. `uniqueViewers`, `reports`, moderation reason/actor | owner + moderation admins only (queries must filter `ownerId`) |
| `videoStatsPublic/{video}` | **PUBLIC** ranking aggregates only (plays, validViews, watchTimeMs, completions, rewatches, skips, notInterested, hides, distStatus) | written in the same batch as the private doc with identical delta validation; status changes bound to the private doc |
| `videoDistributionLog/{id}` | append-only moderation log | moderators |
Video key: reel id, or `post_<postId>`. Existing `reports` collection is reused; a `report` feedback signal is written atomically with the report. Admin filters (status/creator/date) need the composite indexes in `firestore.indexes.json`.

## Admin (Admin → Smart Video Distribution)
Filters (status incl. "needs review", creator @username, date range), cursor pagination (50 per page) and a click-to-select video picker. Settings (Admin/Super Admin): master + progressive + exploration switches, view definitions, stage sizes, thresholds, quality minimums, weights, diversity, pool sizes/cache. Activity & performance, Flagged (suspicion flags / reports / non-auto status), per-video Pause / Stop / Under review / Restricted / Resume (Moderators too; reason required; written to `videoDistributionLog` and the audit log).

## Creator analytics (`/analytics/videos`)
Per video: plays, valid views, unique viewers, watch time, avg watch duration, completion rate, likes, comments, shares, saves, audience reach, stage. Real data only; zero rows say "No viewing data recorded yet".

## Free-tier (Spark) limits — please read
- **No server process**: integrity relies on database rules. A determined user with many real accounts can still fabricate watch time (bounded: one event/account/video/day, <=4x duration). Suspicion heuristics dampen/flag, they cannot prove fraud.
- **Ranking aggregates (`videoStatsPublic`) are readable by signed-in clients** because ranking runs on the client. Private creator analytics (`videoStats`) are now owner/admin-only in the rules. Fully hiding the ranking aggregates needs server-side ranking (Blaze).
- **Reads**: one recommended-Reels load ~ recent window (existing) + stats (<= pool size) + <=15 top-pool reels + <=25 author profiles (cached 30 min) ≈ 100-150 reads, cached 5 min. Spark allows 50,000 reads/day, i.e. roughly 300-500 such loads/day across ALL users. Tune `recentPoolSize`, `topPoolSize`, `feedCacheMinutes`.
- **Writes**: each qualifying view = 4 writes (event, optional marker, private stats, public stats). Spark allows 20,000 writes/day.
- `viewsCount` on the reel document is still only maintained by the existing Cloud Function (Blaze). On Spark use the stats counters.
- Distribution is *recommendation*, not access control: videos remain visible via profile, direct link and the Following tab.

## Optional Blaze hardening plan (not enabled)
1. Cloud Function on `reelViews` create: recompute flags, update `videoStats`, rate-limit per user/IP, reject implausible patterns.
2. Scheduled function (every 15 min) to persist stage transitions + history and compute per-viewer candidate sets.
3. Replace `videoStatsPublic` with a server-computed public rank score.
Requires switching `VITE_FIREBASE_PLAN_MODE=blaze` and enabling billing — **not done automatically**.

## Duration, language and signals (remediation)
- Real duration: reels store `durationSeconds`, video posts store `videoDurationSeconds` (measured from the file at upload). Legacy content without a duration is "unknown" (0): duration-dependent checks are skipped, never replaced by an assumed length. Rules require a submitted `durationMs` to match the stored duration (±1.5 s) when one exists.
- Language: `language` ('bn' | 'en') is detected from caption/title script at upload when clear; the viewer language comes from the browser UI language (read locally, never stored). It is a small optional relevance hint, never a gate.
- Not implemented: personal watch-history and community/page-follow signals. They need an explicit user opt-in and owner-only storage before any private behavioural data may be used; none is accessed today (see `KNOWN_LIMITATIONS.md`). The only history in use is an on-device list of recently shown videos to avoid repeats.
- Personal hiding (hidden creators / dismissed videos) is stored one document per hide (`feedHides`) and merged with the legacy settings arrays.
