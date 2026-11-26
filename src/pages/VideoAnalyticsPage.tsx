import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { BarChart3, ChevronLeft, Loader2 } from 'lucide-react';
import { collection, doc, documentId, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { AppShell } from '@/src/components/layout/AppShell';
import { useAuth } from '@/src/contexts/AuthContext';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import {
  computeMetrics, contentKeyFor, deriveStage, durationMsFromSeconds, getDistributionConfig, normalizeStats, reelToContent,
  type ContentLite, type DistributionConfig, type VideoStats,
} from '@/src/lib/videoDistribution';
import type { BanaReel } from '@/src/types/bana';

interface Row {
  key: string; type: 'reel' | 'post'; id: string; title: string; createdAt: any;
  stats: VideoStats; content: ContentLite; hasStats: boolean;
}

const card = 'rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm';
const fmtDur = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
};
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

/** Creator-only analytics. Every number comes from videoStats / the video's own counters; nothing is estimated or placeholder. */
export function VideoAnalyticsPage() {
  const { firebaseUser } = useAuth();
  const uid = firebaseUser?.uid;
  const [rows, setRows] = useState<Row[]>([]);
  const [config, setConfig] = useState<DistributionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!uid) return;
    let off = false;
    (async () => {
      try {
        setConfig(await getDistributionConfig());
        const [reelsSnap, postsSnap, statsSnap] = await Promise.all([
          getDocs(query(collection(db, 'reels'), where('authorId', '==', uid), limit(50))),
          getDocs(query(collection(db, 'posts'), where('authorId', '==', uid), where('type', '==', 'video'), limit(50))),
          getDocs(query(collection(db, 'videoStats'), where('ownerId', '==', uid), limit(100))),
        ]);
        const statsByKey = new Map(statsSnap.docs.map((d) => [d.id, normalizeStats(d.data())]));
        const out: Row[] = [];
        reelsSnap.docs.forEach((d) => {
          const r = { id: d.id, ...(d.data() as Omit<BanaReel, 'id'>) } as BanaReel;
          if (r.status === 'removed') return;
          const key = contentKeyFor('reel', r.id);
          out.push({ key, type: 'reel', id: r.id, title: r.title || r.caption || 'Untitled Reel', createdAt: r.createdAt,
            stats: statsByKey.get(key) || normalizeStats({}), hasStats: statsByKey.has(key), content: reelToContent(r) });
        });
        postsSnap.docs.forEach((d) => {
          const p: any = d.data();
          if (p.status === 'removed') return;
          const key = contentKeyFor('post', d.id);
          out.push({ key, type: 'post', id: d.id, title: String(p.content || 'Video post').slice(0, 80), createdAt: p.createdAt,
            stats: statsByKey.get(key) || normalizeStats({}), hasStats: statsByKey.has(key),
            content: { key, authorId: uid, createdMs: p.createdAt?.toMillis ? p.createdAt.toMillis() : Date.now(), durationMs: durationMsFromSeconds(p.videoDurationSeconds),
              likes: p.likesCount || 0, comments: p.commentsCount || 0, shares: p.sharesCount || 0, saves: p.savesCount || 0, processingReady: true } });
        });
        out.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
        if (!off) setRows(out);
      } catch {
        if (!off) setError(true);
      } finally {
        if (!off) setLoading(false);
      }
    })();
    return () => { off = true; };
  }, [uid]);

  const totals = useMemo(() => rows.reduce((t, r) => ({
    plays: t.plays + r.stats.plays, valid: t.valid + r.stats.validViews, unique: t.unique + r.stats.uniqueViewers, watch: t.watch + r.stats.watchTimeMs,
  }), { plays: 0, valid: 0, unique: 0, watch: 0 }), [rows]);

  return (
    <AppShell>
      <div className="max-w-4xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <Link to="/discover" className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white">
          <ChevronLeft className="w-3.5 h-3.5" /> Back
        </Link>
        <div className={`${card} p-5`}>
          <h1 className="font-display font-bold text-lg flex items-center gap-2"><BarChart3 className="w-5 h-5 text-brand" /> Video analytics</h1>
          <p className="text-xs text-neutral-500 mt-1">Only you can see these numbers for your own videos. Views by you are never counted.</p>
          {!loading && !error && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mt-4 text-center">
              {[['Total plays', totals.plays], ['Valid views', totals.valid], ['Unique viewers', totals.unique], ['Watch time', fmtDur(totals.watch)]].map(([k, v]) => (
                <div key={String(k)} className="rounded-lg bg-neutral-50 dark:bg-neutral-800/60 p-2.5"><p className="text-base font-bold">{v}</p><p className="text-[11px] text-neutral-500">{k}</p></div>
              ))}
            </div>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-neutral-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading your videos…</p>
        ) : error ? (
          <p className="text-sm text-red-600">Could not load analytics. Please try again.</p>
        ) : rows.length === 0 ? (
          <div className={`${card} p-6 text-sm text-neutral-600 dark:text-neutral-300`}>You have not published any videos yet.</div>
        ) : (
          <ul className="space-y-3">
            {rows.map((r) => {
              const m = computeMetrics(r.stats, r.content);
              const st = config ? deriveStage(r.stats, r.content, config, Date.now()) : null;
              const cells: Array<[string, string | number]> = [
                ['Total plays', r.stats.plays], ['Valid views', r.stats.validViews], ['Unique viewers', r.stats.uniqueViewers],
                ['Total watch time', fmtDur(r.stats.watchTimeMs)], ['Avg watch duration', r.stats.plays ? fmtDur(m.avgWatchMs) : '—'],
                ['Completion rate', r.stats.plays ? pct(m.completionRate) : '—'],
                ['Likes', r.content.likes], ['Comments', r.content.comments], ['Shares', r.content.shares], ['Saves', r.content.saves],
                ['Audience reach', r.stats.uniqueViewers],
              ];
              return (
                <li key={r.key} className={`${card} p-4`}>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold truncate">{r.title}</p>
                      <p className="text-[11px] text-neutral-500">{r.type === 'reel' ? 'Reel' : 'Video post'} · {formatRelativeTime(r.createdAt)}</p>
                    </div>
                    {st && (
                      <span className="rounded-full bg-blue-50 dark:bg-blue-950/40 text-brand dark:text-blue-300 text-[11px] font-semibold px-2.5 py-1">
                        {st.stage ? `Stage ${st.stage} · ` : ''}{st.status.replace('_', ' ')}
                      </span>
                    )}
                  </div>
                  {st && <p className="text-[11px] text-neutral-500 mt-1">{st.reason}</p>}
                  <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 mt-3">
                    {cells.map(([k, v]) => (
                      <div key={k}><dt className="text-[11px] text-neutral-500">{k}</dt><dd className="text-sm font-semibold tabular-nums">{v}</dd></div>
                    ))}
                  </dl>
                  {!r.hasStats && <p className="text-[11px] text-neutral-400 mt-2">No viewing data recorded yet.</p>}
                </li>
              );
            })}
          </ul>
        )}

        <details className={`${card} p-4 text-xs text-neutral-600 dark:text-neutral-300`}>
          <summary className="font-semibold cursor-pointer">How these numbers are defined</summary>
          <ul className="mt-2 space-y-1 list-disc pl-4">
            <li><b>Total plays</b>: accepted viewing sessions — at most one per viewer per day, so refreshing never adds plays.</li>
            <li><b>Valid views</b>: plays that reached the minimum watch rule set by BANA (not your own views).</li>
            <li><b>Unique viewers</b>: distinct accounts that ever watched; also your audience reach.</li>
            <li><b>Watch time / average</b>: total time spent playing; average is per play.</li>
            <li><b>Completion rate</b>: share of plays that reached the completion point. Rewatches are plays that looped.</li>
          </ul>
        </details>
      </div>
    </AppShell>
  );
}
