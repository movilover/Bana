# Friend Suggestions — implementation report

Extends the existing friend system (`sendFriendRequest`, `cancelFriendRequest`, `friendRequests` rules, notifications) — no duplicate request system.

## Algorithm
Candidates come from bounded graph neighbourhoods (never a user-collection scan): friends-of-friends (sample of `maxFriendsSampled` friends),
community peers (3 communities x 15), people who follow you (40), profiles sharing interests (`array-contains-any`, 25), newest accounts (15, fallback).
Hard cap `maxCandidates` profile reads. Each candidate is dropped by exclusion rules, then scored:
`score = Σ weight[signal] x min(count, cap)`; verified/popularity only boost someone who already has a relationship signal.
A candidate with no enabled qualifying signal is never shown. Weights and signal on/off flags are admin-configured.

Exclusions: self, friends, outgoing pending, incoming pending, blocked by me, blocked me (per-pair check on finalists), dismissed,
suggestions opt-out, inactive/banned, `whoCanFriendRequest` = nobody, and followers / friends-of-friends policies the sender cannot satisfy.
Same-location counts only if both users show location. Private accounts show name/avatar only.
Data NOT used: messages, private posts, uploaded contacts.

## Collections / rules
- `friendSuggestionConfig/settings` — signed-in read; Admin/Super Admin write; every numeric field range-checked in rules.
- `friendSuggestionStats/{yyyymmdd}` — aggregate counters only; signed-in clients may add bounded increments; admins read.
- `users.suggestionsOptOut` (public mirror of settings `allowFriendSuggestions`) — owner-writable.
- Dismissals reuse `userSettings.dismissedSuggestionIds` (deduped, cap 300). No new index needed.

## Files
Created: `src/lib/friendSuggestionsCore.ts`, `friendSuggestions.ts`, `useFriendSuggestions.ts`, `src/components/social/FeedFriendSuggestions.tsx`,
`src/components/admin/AdminFriendSuggestionsSection.tsx`, `tests/verification/friend-suggestions.logic.test.mjs`, `tests/security/friendSuggestions.rules.test.mjs`.
Modified: `firestore.rules`, `socialGraph.ts` (fetchSuggestedUsers now delegates to the engine — old callers keep working), `DiscoverPage.tsx` (feed slots),
`AdminPage.tsx`, `adminRbac.ts`, `SettingsPage.tsx`, `AuthContext.tsx`, `types/bana.ts`, `PeopleYouMayKnow.tsx` (dismiss cap), `package.json`.

## Deploy
1. Deploy rules. 2. Admin → Friend Suggestions → review defaults and Save once (until then built-in defaults apply). No new indexes.


## Remediation update (privacy)
- Mutual-friend signals are read from `friendLinks`, which applies each friend's `whoCanViewFriends` / `isPrivateAccount` / block settings in Firestore Rules; hidden lists return nothing. Friends are sampled randomly (max `maxFriendsSampled`, 60 reads per list).
- Private accounts are suggested only with a connection signal (mutual friend or they follow the viewer).
- Dismissals: one document per person (`suggestionDismissals`), no 300-id cap; the legacy `userSettings.dismissedSuggestionIds` array is still honoured.
- `friendSuggestionStats/<yyyymmdd>_<uid>` are per-user, capped, client-reported (approximate) numbers.
- Not executed by the author: emulator tests (see TEST_RESULTS.md).
