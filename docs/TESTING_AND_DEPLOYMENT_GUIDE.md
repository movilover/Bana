# Testing and deployment guide (Prompt 01–03 remediation)

> **Status of the code:** the remediation was written without network access, a Firebase emulator or a browser. Nothing in this
> guide has been executed by the author except `npm run test:verification`, `node --check`, and `npm run validate:indexes`.
> Treat the project as **unverified** until `npm run check` and `npm run test:rules` are green on your machine.

Nothing here upgrades Firebase, enables billing or deploys anything automatically. Every deploy/migration command below is
something **you** type.

## 1. Prerequisites
| Tool | Version | Check |
|---|---|---|
| Node.js | 20+ (CI uses 24) | `node -v` |
| npm | bundled with Node | `npm -v` |
| Java (JRE/JDK) | **21+ recommended** (older Firebase CLIs accept 11+); required by the Firestore emulator | `java -version` |
| Firebase CLI | current | `npm install -g firebase-tools` then `firebase --version` |

`firebase login` is **not** needed to run the local emulators. It is only needed for deploys (section 6).

## 2. Install
```bash
npm install
```

## 3. `npm run check` (no emulator, no Java)
```bash
npm run check
```
Runs, in order: `lint` (`tsc --noEmit`) → `build` (`vite build`) → `validate:indexes` → `test:verification` (49 logic/parity tests) →
`test:backend` (installs `backend/` deps, builds it, runs the calling tests; **needs network**) → `test:storage`.
Run them one at a time if something fails, e.g. `npm run lint`, `npm run build`.
*Expected:* all green. If `lint` reports type errors, they are real (the author could not type-check against installed packages) — send them to me.

## 4. `npm run test:rules` (Firestore/Storage emulator)
```bash
npm run test:rules
```
First it runs `scripts/preflight-rules-tests.mjs`, which tells you exactly what is missing (Node, Firebase CLI, Java, dependencies).
Then `firebase emulators:exec --only firestore,storage` starts the emulators on **Firestore 8080 / Storage 9199**, runs the 12 test
files one after another and stops the emulators. Production is never contacted.

Environment variables: **none required.** `emulators:exec` sets `FIRESTORE_EMULATOR_HOST` / `FIREBASE_STORAGE_EMULATOR_HOST` for the
test processes; the tests default to `127.0.0.1:8080` if run by hand.

Run a single file while debugging:
```bash
firebase emulators:exec --only firestore "node tests/security/friendPrivacy.rules.test.mjs"
firebase emulators:exec --only firestore "node tests/security/paidVerification.rules.test.mjs"
```
Interactive emulator + UI (optional): `firebase emulators:start --only firestore,storage` → UI at http://127.0.0.1:4000.

**Expect failures on the first run.** The new tests (`friendPrivacy`, `userPrivacy`, `moderation`, `superAdmin`, and the added cases in
`paidVerification`, `videoDistribution`, `friendSuggestions`) were written against rules that were never compiled. Typical causes: a rules
syntax error (the emulator prints the line), a `getAfter/existsAfter` path typo, or a fixture missing a field. Send me the output.
Any original test that now fails is a regression I introduced — that is the most important result to report.

Full `npm run check` followed by rules tests: `npm run check:full`.

## 5. Indexes
```bash
npm run validate:indexes      # offline structure check (executed by the author: OK, 75 composite indexes)
```
This checks JSON structure, field rules and duplicates only. It cannot know whether every query has an index; if the app shows
`failed-precondition ... requires an index`, the browser console prints a link that creates it, or add it to `firestore.indexes.json`.
(The validator also caught a single-field index in your original upload that the CLI rejects; it was removed because Firestore builds
single-field indexes automatically.)

## 6. Deploying (manual, in this order) — Spark-safe
**Careful:** `.firebaserc` sets `default` to **`bana-a5770`, your production project**. Always pass `--project` explicitly. Rehearse on a
separate free Spark project first if you can (`firebase projects:create`, then `--project <staging-id>`).

1. Run sections 3–5 green. Take a manual export/copy of anything you cannot lose (Spark has no managed backups).
2. **Indexes first** (they take minutes to build):
   ```bash
   firebase login
   firebase deploy --only firestore:indexes --project <project-id>
   ```
   Wait until Console → Firestore → Indexes shows every index as **Enabled** (not *Building*).
3. **Rules and client together** (the new rules reject old clients' report ids and stats writes; the new client needs the new collections):
   ```bash
   npm run build
   firebase deploy --only firestore:rules,hosting --project <project-id>
   ```
   Do **not** deploy `functions` (needs Blaze). Do not run `firebase deploy` with no `--only`.
4. **Migrations (dry run first)** — see section 7.
5. Smoke test with two ordinary accounts and one admin: sign in, view a profile, add/cancel a friend, hide a creator, report a video,
   open Admin → Paid Verification / Smart Video / Roles.
6. Rollback: redeploy the previous rules/hosting (`MIGRATION_AND_ROLLBACK.md`).

## 7. Migrations (dry-run by default, never automatic)
Both scripts print what they WOULD do and change nothing unless you pass `--apply`:
```bash
node scripts/migrate-video-stats-public.mjs          # dry run
node scripts/migrate-user-private-fields.mjs         # dry run
```
They use the Firebase Admin SDK from your machine (free). Two ways to run them:
- **Rehearsal against the emulator (no credentials, no production):**
  `firebase emulators:start --only firestore` in one terminal, then in another:
  `FIRESTORE_EMULATOR_HOST=127.0.0.1:8080 GCLOUD_PROJECT=demo-bana node scripts/migrate-user-private-fields.mjs`
- **Production:** a service-account key kept **outside the repo**:
  `GOOGLE_APPLICATION_CREDENTIALS=/safe/path/key.json node scripts/migrate-user-private-fields.mjs` (read the dry-run output, then add `--apply`).
Install the Admin SDK first: `npm --prefix functions install`. Never commit a key (`.gitignore` already excludes `*serviceAccount*.json`).

## 8. Troubleshooting
| Symptom | Cause / fix |
|---|---|
| `test:rules cannot start: Firebase CLI not found` | `npm install -g firebase-tools` |
| `Could not spawn java -version` | Install Java 21+, reopen the terminal |
| `port 8080 is not open` / `already in use` | Stop whatever uses 8080/9199/9099/4000 or edit `firebase.json` ports |
| Emulator warns about a different project id | `firebase.json` has `singleProjectMode: true`; tests use their own project ids. If it errors instead of warning, set it to `false` for local testing |
| `failed-precondition: The query requires an index` | Deploy indexes (section 6.2) or open the link in the error |
| `permission-denied` in the app right after deploying rules | Hosting not deployed with the rules, or an old tab/PWA cache — hard refresh |
| Friend lists of old friendships look empty on other profiles | Expected until each user opens the app once (lazy `friendLinks` backfill) |
