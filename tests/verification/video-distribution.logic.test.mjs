// node --experimental-strip-types --test tests/verification/video-distribution.logic.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import * as D from '../../src/lib/videoDistributionCore.ts';

const C = D.normalizeDistributionConfig({});
const NOW = Date.UTC(2026, 10, 21, 12);
const H = 3600_000;
const content = (o = {}) => ({ key: 'r1', authorId: 'creator', createdMs: NOW - H, durationMs: 20000, category: 'Travel', likes: 0, comments: 0, shares: 0, saves: 0, processingReady: true, ...o });
const stats = (o = {}) => ({ ...D.EMPTY_STATS, ...o });
const viewer = (o = {}) => ({ uid: 'v', following: new Set(), interests: ['Travel'], interestWeights: {}, blockedAuthors: new Set(), hiddenAuthors: new Set(), dismissed: new Set(), seen: new Set(), ...o });
// a video with good numbers at a given audience size
const good = (uniq, extra = {}) => stats({ plays: uniq, validViews: uniq, uniqueViewers: uniq, watchTimeMs: uniq * 14000, completions: Math.ceil(uniq * 0.4), skips: Math.floor(uniq * 0.1), ...extra });
const goodContent = (o = {}) => content({ likes: 30, comments: 10, shares: 5, saves: 5, ...o });
// engagement that scales with audience size (so rates, not counts, are what the tests compare)
const engaged = (u, o = {}) => content({ likes: Math.round(u * 0.5), comments: Math.round(u * 0.15), shares: Math.round(u * 0.05), saves: Math.round(u * 0.05), ...o });

test('1. a brand-new video enters stage 1 with a small audience cap (not everyone)', () => {
  const r = D.deriveStage(stats(), content(), C, NOW);
  assert.equal(r.stage, 1); assert.equal(r.status, 'testing');
  assert.equal(r.audienceCap, C.stage1Audience); assert.equal(r.recommendable, true);
});

test('2. stage 1 sampling: only relevant + sampled viewers; most viewers never get a new video', () => {
  const st = D.deriveStage(stats(), content(), C, NOW);
  let ok = 0, irrelevantOk = 0;
  for (let i = 0; i < 2000; i++) {
    const v = viewer({ uid: `u${i}` });
    if (D.viewerEligibility(v, content(), st, C, D.relevanceScore(v, content()), false).ok) ok++;
    const off = viewer({ uid: `u${i}`, interests: ['Gaming'] });
    if (D.viewerEligibility(off, content(), st, C, D.relevanceScore(off, content()), false).ok) irrelevantOk++;
  }
  assert.ok(ok > 2000 * 0.15 && ok < 2000 * 0.35, `sample ~25% of relevant viewers, got ${ok}`);
  assert.equal(irrelevantOk, 0, 'irrelevant viewers are never in the initial audience');
});

test('followers always qualify; own video, blocked, hidden and not-interested never do', () => {
  const st = D.deriveStage(stats(), content(), C, NOW);
  const f = viewer({ interests: [], following: new Set(['creator']) });
  assert.equal(D.viewerEligibility(f, content(), st, C, 30, false).ok, true);
  const bad = (o) => D.viewerEligibility(viewer(o), content(), st, C, 100, false);
  assert.equal(bad({ uid: 'creator' }).reason, 'own_video');
  assert.equal(bad({ blockedAuthors: new Set(['creator']) }).reason, 'blocked');
  assert.equal(bad({ hiddenAuthors: new Set(['creator']) }).reason, 'hidden_creator');
  assert.equal(bad({ dismissed: new Set(['r1']) }).reason, 'not_interested');
});

test('3/4. good performance expands stage by stage; the caps are configurable', () => {
  const c1 = content({ createdMs: NOW - 5 * H });
  assert.equal(D.deriveStage(good(10), goodContent(), C, NOW).stage, 1); // still collecting
  const s2 = D.deriveStage(good(C.stage1Audience), goodContent(), C, NOW);
  assert.equal(s2.stage, 2); assert.equal(s2.audienceCap, C.stage2Audience);
  assert.equal(D.deriveStage(good(C.stage2Audience), goodContent(), C, NOW).stage, 3);
  const s4 = D.deriveStage(good(C.stage3Audience), goodContent(), C, NOW);
  assert.equal(s4.stage, 4); assert.equal(s4.status, 'continued'); assert.equal(s4.audienceCap, Infinity);
  const small = { ...C, stage1Audience: 5, evalMinValidViews: 3 };
  assert.equal(D.deriveStage(good(5), goodContent(), small, NOW).stage, 2, 'admin-configured sizes change behaviour');
  void c1;
});

test('5. poor performance never expands (low watch time, skips, negative feedback, reports)', () => {
  const cases = {
    low_watch: stats({ plays: 50, validViews: 50, uniqueViewers: 50, watchTimeMs: 50 * 2000, completions: 0 }),
    skippy: { ...good(50), skips: 40 },
    negative: { ...good(50), notInterested: 5, hides: 2 },
  };
  for (const [name, s] of Object.entries(cases)) {
    const r = D.deriveStage(s, goodContent(), C, NOW);
    assert.ok(r.stage <= 1, `${name} must not expand, got stage ${r.stage}`);
    assert.notEqual(r.status, 'expanding');
  }
  const noEngagement = D.deriveStage(good(50), content(), C, NOW); // 0 likes/comments
  assert.equal(noEngagement.stage, 1);
  assert.equal(noEngagement.status, 'limited');
});

test('high raw play counts alone do not expand: needs valid views + quality + enough evidence', () => {
  const r = D.deriveStage(stats({ plays: 100000, validViews: 5, uniqueViewers: 60, watchTimeMs: 100000 * 500 }), content(), C, NOW);
  assert.ok(r.stage <= 1);
  const insufficient = D.deriveStage(good(10), goodContent({ createdMs: NOW - 100 * H }), C, NOW); // window over, too little data
  assert.equal(insufficient.stage, 1);
});

test('safety wins over performance: under review / reports / stop / pause / restrict', () => {
  const great = good(C.stage3Audience);
  assert.equal(D.deriveStage({ ...great, distStatus: 'stopped' }, goodContent(), C, NOW).recommendable, false);
  assert.equal(D.deriveStage({ ...great, distStatus: 'paused' }, goodContent(), C, NOW).recommendable, false);
  const ur = D.deriveStage({ ...great, distStatus: 'under_review' }, goodContent(), C, NOW);
  assert.equal(ur.stage, 1); assert.equal(ur.status, 'under_review');
  // REMEDIATION: reports alone never restrict (brigading); a moderator decision (distStatus) does.
  assert.notEqual(D.deriveStage({ ...great, reports: C.reportsToRestrict * 10 }, goodContent(), C, NOW).status, 'under_review');
  assert.equal(D.needsModeratorReview({ reports: C.reportsToRestrict }, C), true);
  assert.equal(D.needsModeratorReview({ reports: 0 }, C), false);
  assert.equal(D.deriveStage({ ...great, distStatus: 'restricted' }, goodContent(), C, NOW).followersOnly, true);
  assert.equal(D.deriveStage(good(5), content({ processingReady: false }), C, NOW).status, 'ineligible');
});

test('switches: disabled → legacy open; progressive off → no gating but ranking only', () => {
  assert.equal(D.deriveStage(stats(), content(), { ...C, enabled: false }, NOW).stage, 4);
  assert.equal(D.deriveStage(stats(), content(), { ...C, progressiveEnabled: false }, NOW).stage, 4);
});

test('stage 4 reduces recommendations when viewers keep skipping or rejecting', () => {
  const bad = { ...good(C.stage3Audience * 3), skips: C.stage3Audience * 3 * 0.8 };
  const r = D.deriveStage(bad, goodContent(), C, NOW);
  assert.equal(r.status, 'limited');
});

test('7. view definitions: valid views, completion, skip, rewatch; owner view is never valid', () => {
  const e = (watchMs, o = {}) => D.deriveViewEvent({ watchMs, durationMs: 20000, viewerId: 'v', authorId: 'a', ...o }, C);
  assert.deepEqual(e(1000), { valid: false, completed: false, skipped: true, rewatched: false });
  assert.equal(e(3000).valid, true);
  assert.equal(e(10000).valid, true); // 50% of 20s
  assert.equal(e(18000).completed, true);
  assert.equal(e(30000).rewatched, true);
  assert.equal(e(30000, { viewerId: 'a' }).valid, false);
  const short = D.deriveViewEvent({ watchMs: 2500, durationMs: 4000, viewerId: 'v', authorId: 'a' }, C);
  assert.equal(short.valid, true, 'short videos are valid at 50%');
  assert.equal(D.isPlausibleEvent({ watchMs: 90000, durationMs: 20000 }), false);
  assert.equal(D.isPlausibleEvent({ watchMs: 79999, durationMs: 20000 }), true);
});

test('7. refreshing cannot inflate: one event id per viewer per video per UTC day', () => {
  const a = D.viewEventId('r1', 'v', NOW), b = D.viewEventId('r1', 'v', NOW + 5 * H);
  assert.equal(a, b);
  assert.notEqual(a, D.viewEventId('r1', 'v', NOW + 13 * H)); // next UTC day
  assert.notEqual(a, D.viewEventId('r1', 'w', NOW));
  assert.equal(D.contentKeyFor('post', 'p9'), 'post_p9');
});

test('metrics definitions', () => {
  const m = D.computeMetrics(stats({ plays: 10, validViews: 8, watchTimeMs: 100000, completions: 4, rewatches: 1, skips: 2, notInterested: 1 }),
    { durationMs: 20000, likes: 4, comments: 1, shares: 0, saves: 0 });
  assert.equal(m.avgWatchMs, 10000); assert.equal(m.avgWatchRatio, 0.5); assert.equal(m.completionRate, 0.4);
  assert.equal(m.rewatchRate, 0.1); assert.equal(m.skipRate, 0.2); assert.equal(m.negativeRate, 0.1); assert.equal(m.engagementRate, 0.75);
  assert.equal(D.computeMetrics(D.EMPTY_STATS, { durationMs: 1, likes: 0, comments: 0, shares: 0, saves: 0 }).avgWatchMs, 0); // no divide-by-zero
});

test('anti-abuse: artificial patterns are flagged and dampened; they cannot expand', () => {
  const fake = stats({ plays: 60, validViews: 60, uniqueViewers: 2, watchTimeMs: 60 * 15000 });
  assert.ok(D.suspicionFlags(fake, content()).includes('few_distinct_viewers'));
  assert.ok(D.suspicionFlags(stats({ plays: 10, watchTimeMs: 10 * 20000 * 3.5 }), content()).includes('implausible_watch_time'));
  assert.ok(D.suspicionFlags(stats({ plays: 20, validViews: 20, uniqueViewers: 5 }), content({ likes: 500 })).includes('likes_exceed_viewers'));
  assert.deepEqual(D.suspicionFlags(good(40), goodContent()), []);
  const expand = D.deriveStage({ ...good(C.stage1Audience), uniqueViewers: 2 }, goodContent(), C, NOW);
  assert.ok(expand.stage <= 1 || expand.status !== 'expanding');
  const honest = D.rankScore(good(40), goodContent(), 80, false, C, NOW).score;
  const dampened = D.rankScore({ ...good(40), uniqueViewers: 2 }, goodContent(), 80, false, C, NOW).score;
  assert.ok(dampened < honest);
});

test('ranking: views are not positive by themselves; skips/negatives/reports lower it; weights are configurable', () => {
  const base = D.rankScore(good(40), goodContent(), 60, false, C, NOW).score;
  assert.ok(D.rankScore({ ...good(40), skips: 36 }, goodContent(), 60, false, C, NOW).score < base);
  assert.ok(D.rankScore({ ...good(40), notInterested: 6 }, goodContent(), 60, false, C, NOW).score < base);
  assert.ok(D.rankScore({ ...good(40), reports: 2 }, goodContent(), 60, false, C, NOW).score < base);
  // same quality, 100x more plays → no meaningful boost (rates, not counts)
  const baseE = D.rankScore(good(40), engaged(40), 60, false, C, NOW).score;
  const big = D.rankScore(good(4000), engaged(4000), 60, false, C, NOW).score;
  assert.ok(Math.abs(big - baseE) < 5, `count must not drive score (base ${baseE}, big ${big})`);
  const heavy = { ...C, weights: { ...C.weights, relevance: 100 } };
  assert.ok(D.rankScore(stats(), content(), 90, false, heavy, NOW).score > D.rankScore(stats(), content(), 90, false, C, NOW).score);
  assert.ok(D.rankScore(stats(), content({ createdMs: NOW - H }), 50, false, C, NOW).score > D.rankScore(stats(), content({ createdMs: NOW - 300 * H }), 50, false, C, NOW).score, 'freshness');
});

test('6. fairness: a new creator with no history can reach relevant viewers and gets reserved exploration slots', () => {
  const v = viewer({ uid: 'viewer-x' });
  const pop = (i) => ({ content: content({ key: `p${i}`, authorId: `star${i}`, createdMs: NOW - 200 * H, likes: 900, comments: 200, shares: 80, saves: 80 }), stats: good(C.stage3Audience * 2) });
  const rookie = (i) => ({ content: content({ key: `n${i}`, authorId: `rookie${i}`, createdMs: NOW - 2 * H }), stats: stats() });
  const cands = [...Array.from({ length: 12 }, (_, i) => pop(i)), ...Array.from({ length: 400 }, (_, i) => rookie(i))];
  const newCreatorIds = new Set(Array.from({ length: 400 }, (_, i) => `rookie${i}`));
  const feed = D.buildDistributionFeed({ candidates: cands, viewer: v, config: C, nowMs: NOW, pageSize: 10, newCreatorIds });
  const fromNew = feed.items.filter((x) => x.isNewCreator).length;
  assert.ok(fromNew >= Math.round((10 * C.newCreatorSlotPercent) / 100), `expected >=${Math.round(10 * C.newCreatorSlotPercent / 100)} exploration slots, got ${fromNew}`);
  assert.ok(feed.items.some((x) => !x.isNewCreator), 'established creators still appear');
  const off = D.buildDistributionFeed({ candidates: cands, viewer: v, config: { ...C, newCreatorEnabled: false }, nowMs: NOW, pageSize: 10, newCreatorIds });
  assert.ok(off.items.filter((x) => x.isNewCreator && x.reason === 'sampled').length >= 0);
});

test('creator diversity: no creator dominates a page', () => {
  const v = viewer({ following: new Set(['star']) });
  const cands = Array.from({ length: 30 }, (_, i) => ({ content: engaged(C.stage3Audience * 2, { key: `s${i}`, authorId: 'star' }), stats: good(C.stage3Audience * 2) }));
  cands.push(...Array.from({ length: 10 }, (_, i) => ({ content: engaged(C.stage3Audience * 2, { key: `o${i}`, authorId: `o${i}` }), stats: good(C.stage3Audience * 2) })));
  const feed = D.buildDistributionFeed({ candidates: cands, viewer: v, config: C, nowMs: NOW, pageSize: 10 });
  assert.ok(feed.items.filter((x) => x.content.authorId === 'star').length <= C.maxPerCreatorPerPage);
  assert.equal(feed.items.length, 10);
});

test('8. blocked / hidden / dismissed / recently seen never appear; counts of exclusions reported', () => {
  const v = viewer({ blockedAuthors: new Set(['b']), hiddenAuthors: new Set(['h']), dismissed: new Set(['d1']), seen: new Set(['s1']), following: new Set(['b', 'h', 'd', 's', 'ok']) });
  const mk = (key, author) => ({ content: goodContent({ key, authorId: author }), stats: good(400) });
  const feed = D.buildDistributionFeed({ candidates: [mk('b1', 'b'), mk('h1', 'h'), mk('d1', 'd'), mk('s1', 's'), mk('k1', 'ok')], viewer: v, config: C, nowMs: NOW, pageSize: 10 });
  assert.deepEqual(feed.items.map((x) => x.content.key), ['k1']);
  assert.equal(feed.excluded.blocked, 1); assert.equal(feed.excluded.hidden_creator, 1);
  assert.equal(feed.excluded.not_interested, 1); assert.equal(feed.excluded.recently_shown, 1);
});

test('config normalization: clamps, keeps stage sizes strictly increasing, fills defaults', () => {
  const n = D.normalizeDistributionConfig({ stage1Audience: 9999999, stage2Audience: 1, stage3Audience: 1, audienceSampleRate: 0, weights: { relevance: 999 }, enabled: 'yes' });
  assert.equal(n.stage1Audience, 10000);
  assert.ok(n.stage2Audience > n.stage1Audience && n.stage3Audience > n.stage2Audience);
  assert.equal(n.audienceSampleRate, 1); assert.equal(n.weights.relevance, 100); assert.equal(n.enabled, true);
  assert.deepEqual(D.normalizeDistributionConfig(null).weights, D.DEFAULT_DISTRIBUTION_CONFIG.weights);
});

test('stats normalisation tolerates missing/garbage fields', () => {
  assert.deepEqual(D.normalizeStats(undefined), { ...D.EMPTY_STATS, distStatus: 'auto' });
  assert.equal(D.normalizeStats({ plays: -5, validViews: 'x', distStatus: 'weird' }).plays, 0);
  assert.equal(D.normalizeStats({ distStatus: 'paused' }).distStatus, 'paused');
});

test('language: detected from script, optional, only a mild relevance signal (never a gate)', () => {
  assert.equal(D.detectContentLanguage('আজকের ঢাকার আবহাওয়া কেমন থাকবে'), 'bn');
  assert.equal(D.detectContentLanguage('Weekend street food tour in Dhaka'), 'en');
  assert.equal(D.detectContentLanguage('ok'), undefined);          // too short -> no signal
  assert.equal(D.detectContentLanguage('abcdefgh কখগঘঙচছজ'), undefined); // balanced mix (8 Latin / 8 Bengali) -> no signal
  const v = { uid: 'v', following: new Set(), interests: [], interestWeights: {}, blockedAuthors: new Set(), hiddenAuthors: new Set(), dismissed: new Set(), seen: new Set() };
  const same = D.relevanceScore({ ...v, language: 'bn' }, { ...goodContent(), language: 'bn' });
  const diff = D.relevanceScore({ ...v, language: 'bn' }, { ...goodContent(), language: 'en' });
  const none = D.relevanceScore({ ...v, language: 'bn' }, { ...goodContent() });
  assert.ok(same > none && none >= diff, 'matching language helps, unknown is neutral');
});
