# BANA — Prompt 06: Profiles, Friends, Followers, Privacy, Blocking, Verification

## 1. Audit summary
Already present and kept: profile page (cover/avatar/bio/location/website, tabs, connections modal with followers/following/friends/mutual/requests), friend + follow request flows with notifications (deduped by `dedupeKey`), People You May Know (mutual friends + shared interests, add/follow/dismiss), privacy settings (account privacy, who can follow/friend-request/message/call/see posts/comment/view lists), block/unblock/restrict, verification request modal and admin review with audit log.

## 2. Problems found and fixed (all enforced in `firestore.rules`, not just the UI)
| # | Severity | Problem | Fix |
|---|---|---|---|
| 1 | **High** | A user could create `friendships/{pair}` for any user: the rule only checked that *a* request existed, not that it was accepted | Friendship now requires an **accepted** request, canonical id (`smaller_larger`), sorted participants, and no block |
| 2 | **High** | The *sender* of a friend request could set it to `accepted` themselves | Only the recipient may accept/decline |
| 3 | **High** | `userBlocks` ids were not tied to the blocker: user A could create `B_C` and block two other users from each other | Block id must be `blocker_blocked`, no self-block |
| 4 | Medium | Duplicate follow / follow-request / friend-request records possible through arbitrary document ids | Ids must be `from_to`; client is idempotent (no duplicate pending request or follow) |
| 5 | Medium | "Who can send friend requests" was enforced only in the browser | Rules now reject requests to `nobody` and (for `followers`) require the target to follow the sender; already-friends rejected. `friends_of_friends` cannot be evaluated cheaply in rules and remains client-checked (documented limitation) |
| 6 | Medium | Blocked users could create a 1:1 conversation or send messages by calling the backend directly | Conversation create and message create now reject when the 1:1 pair is blocked |
| 7 | Medium | Posts with `followers`/`friends` visibility were unreadable even by authorized followers/friends | Read rule now allows author, followers (follow record) and friends (friendship), never blocked users |
| 8 | Medium | A declined/stale friend request could never be re-sent (update denied) | Client removes the stale request first, then creates a new one |
| 9 | Medium | Verification review silently fell back to a client-side write on **any** error, including "permission denied" | Fallback only when Cloud Functions are unavailable; real errors are shown. Support-staff roles can no longer set `approved` (only moderators/admins can) |

## 3. Changed files
- `firestore.rules`
- `src/lib/socialGraph.ts`
- `src/components/admin/AdminVerificationsSection.tsx`
- `tests/security/social.rules.test.mjs` (new, 9 emulator tests)
- `package.json` (`test:rules` now includes the new suite)
- `docs/PROMPT_06_SOCIAL_REPORT.md` (new), `README.md`
`index.html` and entry files were reviewed; no change needed.

## 4. Testing — what actually ran
Sandbox had no network, so dependencies could not be installed and the Firebase emulator (needs Java) was unavailable.
- Ran: esbuild parse of all changed TypeScript/JS files (pass); brace/parenthesis balance of `firestore.rules` (see command output).
- **Not run:** `tsc`, `vite build`, the Firestore emulator suite (including the 9 new tests), and any browser test. Nothing here is a verified pass of the new rules. **Run `npm install && npm run lint && npm run build && npm run test:rules` before deploying, and deploy rules with `firebase deploy --only firestore:rules`.** Rules syntax is only fully validated by the emulator/deploy.

## 5. Remaining limitations / manual setup
- **Counters** (`followersCount`, `followingCount`, `friendsCount`) are maintained by Cloud Functions (Blaze). Without them the profile falls back to counting loaded lists (friends) but stored counters can lag.
- `users` documents are publicly readable; hidden-field privacy (`showPersonalInfo`, `showLocation`) is applied in the UI. Truly private data must live in `userSettings` (owner/admin only). Do not put private data in `users`.
- Profile posts tab for other people still queries public posts only (conservative); followers/friends-only posts are readable by authorized users per rules but are not yet listed there.
- Restrict (soft-block) is enforced in the client; only blocking is enforced in rules.
- Verification approval via the Spark fallback is client-side but gated by rules to moderator/admin roles.
