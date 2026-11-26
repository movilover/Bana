# Security rules report (checkpoint 4)
Reviewed in `firestore.rules`. Rules were NOT executed in an emulator (unavailable); everything below is by code review plus new tests that still have to be run.

| Area | Rule state | Status |
|------|-----------|--------|
| users.isVerified | Only paid workflow (finance/admin, tied to verificationStatus + audit) or Super Admin (tied to audit via `lastVerificationAuditId`). Moderator/support branch removed | Changed, untested |
| Paid verification audit | `pvAuditOk()` requires `auditLogs/<appId>_<status>` in the same commit with matching actor/target/action/createdAt | Changed, untested |
| auditLogs | append-only; reserved prefixes (`paid_verification_*`, `verification_manual_*`) restricted by role | Changed, untested |
| reelViews | `durationMs` must match stored parent duration (+/-1.5s) when known | Changed, untested; `watchMs` remains client-reported |
| videoStats | owner / mod-admin read only; list requires ownerId filter | Changed, untested |
| videoStatsPublic | signed-in read; minimal fields; same delta validation; status changes bound to private doc | New, untested |
| users | `get, list: if true` kept on purpose (guest profile discovery); private fields removed from the doc; create rejects private fields; staff can only set `accountStatus` there | Changed, untested |
| userPrivate | owner + admin read; owner create-once, no edit; moderators edit restriction fields only | New, untested |
| friendships | participant-only get/list; create uses `existsAfter/getAfter` so accept can be one atomic batch | Changed, untested |
| friendLinks | owner-setting aware (`friendListVisibleTo`): everyone/friends/only_me, private account, blocks; create bound to an existing friendship | New, untested |
| friendSuggestionStats | per-user docs, own-doc only, absolute + per-write caps; legacy shared docs closed | Changed, untested (data stays approximate) |
| Bootstrap Super Admin email | still in rules + Functions | UNCHANGED (kill switch exists) |
| reports | id must be `<targetType>_<targetId>_<reporterUid>`; staff may resolve but not rewrite reporter/target/reason/details/evidence/createdAt | Changed, untested |
| videoFeedback | accepts `hide_creator`; `report` requires the real report doc in the same commit (`existsAfter`) | Changed, untested |
| suggestionDismissals | owner-only, deterministic id, create/delete only | New, untested |
| adminBootstrap | disabling requires the actor's own delegated `super_admin` record | Changed, untested |
| adminRoles | no self-demotion (Super Admin cannot lower their own role) | Changed, untested |
| Super Admin bootstrap e-mail | still active (by design until you retire it) | UNCHANGED |

Reminder: Firestore rules are not filters. Every list query used by the client constrains the field the rule checks (`ownerId`, `uid`, `participants`, `ownerUid`).
| feedHides | owner-only, deterministic id, kind enum, no self-hide, create/delete only | New, untested |
