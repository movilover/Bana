# Test results (honest record — final)

**The project is NOT verified.** `npm run lint`, `npm run build`, `npm run test:rules` (Firestore/Storage emulator), browser/E2E and
mobile/desktop checks were **not executed**. Nothing is marked passed unless it was actually run.

Author environment: no network; no `node_modules`; Java 21 *is* installed, but the Firebase CLI and the Firestore emulator jar are not,
and they cannot be downloaded without network (an earlier version of this file wrongly said Java was missing); no browser.

## Actually executed (exact results)
| Check | Command | Result |
|---|---|---|
| Logic + rules-parity tests | `npm run test:verification` | **49 tests, 49 pass, 0 fail** |
| Syntax of every test and script | `node --check` on 24 files (`tests/security`, `tests/verification`, `scripts`) | **0 failures** |
| Index file structure | `npm run validate:indexes` | **OK: 75 composite indexes, no duplicates** (it first found and I removed 1 invalid single-field index that was already in your upload) |
| TypeScript, syntax only (global compiler, dependencies NOT installed) | `tsc --noEmit` filtered to TS1xxx | **0 syntax errors.** This says nothing about type errors; real `npm run lint` is needed |
| Rules structure | brace/parenthesis balance of `firestore.rules` | **balanced** (not a substitute for the rules compiler) |
| Secret scan | grep for private keys | **none found** (the Firebase *web* API key in `src/firebase.ts` is public config) |
| Preflight script behaviour | `node scripts/preflight-rules-tests.mjs` | Works as designed here: reports "Firebase CLI not found" and "Dependencies missing" |

## NOT executed
| Check | Why | Who must run it |
|---|---|---|
| `npm run lint` | dependencies not installed | you |
| `npm run build` | dependencies not installed | you |
| `npm run test:backend`, `npm run test:storage` | need `npm install` / network | you |
| `npm run test:rules` — original assertions (the 104 mentioned in the first audit, plus everything else in `tests/security`) | no Firebase CLI / emulator | you |
| `npm run test:rules` — every test added by the remediation | same | you |
| Browser, mobile and desktop UI, E2E, console errors, feature regression | no browser | you |

## Emulator tests written but not run (46 new cases + 1 rewritten)
| File | New cases | Covers |
|---|---|---|
| `paidVerification.rules.test.mjs` | 5 | moderator/support cannot verify; atomic audit; forged audit; Super Admin manual grant |
| `videoDistribution.rules.test.mjs` | 6 | private vs public stats; public field limits; moderation pairing; duration vs parent |
| `friendSuggestions.rules.test.mjs` | 1 (+1 rewritten) | per-document dismissals (new); per-user stats and caps (rewritten) |
| `friendPrivacy.rules.test.mjs` | 12 | friendships participant-only; friendLinks visibility matrix; atomic accept; unfriend |
| `userPrivacy.rules.test.mjs` | 7 | public profile read; `userPrivate`; no private fields on public docs; `feedHides`; role escalation |
| `moderation.rules.test.mjs` | 8 | deterministic reports; duplicates; staff edits; atomic report+feedback; hide/hide_creator; moderation pairing |
| `superAdmin.rules.test.mjs` | 7 | escalation attempts; look-alike/unverified e-mail; lock-out protection; retirement and recovery |

(An earlier message said "about 60 new cases"; the correct count is the 46 new + 1 rewritten above.)
Expect some to fail on the first run — they were written against rules that were never compiled. Likely causes: a rules syntax error,
a `getAfter/existsAfter` path typo, a missing fixture field. Any *original* test that now fails is a regression I introduced.

## How to run (details: `docs/TESTING_AND_DEPLOYMENT_GUIDE.md`)
```bash
npm install
npm run check          # lint, build, index check, logic tests, backend, storage
npm run test:rules     # needs Java + firebase-tools; preflight tells you what is missing
npm run check:full     # both
```
