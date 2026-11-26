// Guards drift between videoDistributionCore.ts (client) and firestore.rules (database): same bounds, same derived-flag formulas.
//   node --experimental-strip-types --test tests/verification/video-rules-parity.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CONFIG_INT_BOUNDS, DEFAULT_DISTRIBUTION_CONFIG, WEIGHT_KEYS } from '../../src/lib/videoDistributionCore.ts';

// firestore.rules now lives in the separate BANA_SECURITY_FIREBASE_FILES package.
// Put both folders side by side (default) or set FIRESTORE_RULES_PATH. Without the rules file the parity checks are skipped, not passed.
const rulesPath = process.env.FIRESTORE_RULES_PATH || '../BANA_SECURITY_FIREBASE_FILES/firestore.rules';
const haveRules = fs.existsSync(rulesPath);
if (!haveRules) console.warn(`[parity] SKIPPED: rules file not found at ${rulesPath}`);
const rules = haveRules ? fs.readFileSync(rulesPath, 'utf8') : '';
const rulesTest = haveRules ? test : test.skip;

rulesTest('every config integer bound in the core appears with identical min/max in firestore.rules', () => {
  for (const [k, [lo, hi]] of Object.entries(CONFIG_INT_BOUNDS)) {
    assert.ok(rules.includes(`vdI(d, '${k}', ${lo}, ${hi})`), `rules missing/different bound for ${k} [${lo}, ${hi}]`);
  }
});

rulesTest('every ranking weight key is validated in rules', () => {
  for (const k of WEIGHT_KEYS) assert.ok(rules.includes(`vdW(d, '${k}')`), `rules missing weight ${k}`);
});

rulesTest('rules fall-back defaults equal the core defaults for the view definition', () => {
  const d = DEFAULT_DISTRIBUTION_CONFIG;
  assert.ok(rules.includes(`vdN('validMinWatchMs', ${d.validMinWatchMs})`));
  assert.ok(rules.includes(`vdN('validMinPercent', ${d.validMinPercent})`));
  assert.ok(rules.includes(`vdN('completionPercent', ${d.completionPercent})`));
  assert.ok(rules.includes(`vdN('skipMs', ${d.skipMs})`));
});

rulesTest('rules re-derive the same formulas as deriveViewEvent', () => {
  assert.ok(rules.includes('incoming().watchMs * 2 >= incoming().durationMs * 3')); // rewatched
  assert.ok(rules.includes('incoming().watchMs <= incoming().durationMs * 4')); // plausibility cap
  assert.ok(rules.includes("incoming().viewerId != incoming().authorId")); // own views never valid
  assert.ok(rules.includes("string(request.time.year()) + '-' + string(request.time.month()) + '-' + string(request.time.day())")); // = utcDayKey
});

rulesTest('legacy reelViews writer (Date.now() ids) is gone from the app', () => {
  const page = fs.readFileSync('src/pages/ReelsPage.tsx', 'utf8');
  assert.ok(!page.includes("'reelViews'"), 'ReelsPage must not write reelViews directly any more');
  assert.equal((rules.match(/match \/reelViews\//g) || []).length, 1, 'exactly one reelViews rule block');
});
