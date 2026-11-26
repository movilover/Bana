import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertTriangle,
  Award,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock,
  Clock3,
  DollarSign,
  Eye,
  FileText,
  Heart,
  Info,
  Layers,
  ShieldCheck,
  TrendingUp,
  Users,
  Wallet,
  XCircle,
} from 'lucide-react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import type {
  BanaPost,
  BanaReel,
  CreatorApplication,
  CreatorEarning,
  CreatorEligibilityRecord,
  CreatorPayoutProfile,
  EarningEvent,
  FinancialTransaction,
  MonetizationPolicy,
  PayoutRequest,
} from '@/src/types/bana';
import { AppShell } from '@/src/components/layout/AppShell';
import { formatCompactNumber, formatRelativeTime } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { CLOUD_FUNCTIONS_ENABLED } from '@/src/lib/firebasePlan';
import {
  computeEarningsSummary,
  DEFAULT_MONETIZATION_POLICY,
  evaluateCreatorEligibilityClientOrServer,
  fetchCreatorLedgerData,
  fetchMonetizationPolicy,
  respondOrAppealApplication,
  saveCreatorPayoutProfile,
  submitCreatorApplication,
  submitCreatorPayoutRequest,
} from '@/src/lib/monetization';
import studioBanner from '@/src/assets/images/bana_studio_banner_1794590890306.jpg';

type StudioTab =
  | 'overview'
  | 'earnings'
  | 'performance'
  | 'eligibility'
  | 'applications'
  | 'payments'
  | 'guidelines';

const STUDIO_TABS: Array<{ id: StudioTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: Layers },
  { id: 'earnings', label: 'Earnings', icon: DollarSign },
  { id: 'performance', label: 'Content Performance', icon: BarChart3 },
  { id: 'eligibility', label: 'Monetization Status', icon: ShieldCheck },
  { id: 'applications', label: 'Applications', icon: FileText },
  { id: 'payments', label: 'Payment History', icon: Wallet },
  { id: 'guidelines', label: 'Creator Guidelines', icon: BookOpen },
];

export function CreatorStudioPage() {
  const { firebaseUser, profile, settings, openAuthModal } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = (searchParams.get('tab') || 'overview') as StudioTab;
  const activeTab: StudioTab = STUDIO_TABS.some((t) => t.id === rawTab) ? rawTab : 'overview';

  const setActiveTab = (tab: StudioTab) => {
    setSearchParams({ tab });
  };

  const [posts, setPosts] = useState<BanaPost[]>([]);
  const [reels, setReels] = useState<BanaReel[]>([]);
  const [application, setApplication] = useState<CreatorApplication | null>(null);
  const [policy, setPolicy] = useState<MonetizationPolicy>(DEFAULT_MONETIZATION_POLICY);
  const [eligibility, setEligibility] = useState<CreatorEligibilityRecord | null>(null);
  const [events, setEvents] = useState<EarningEvent[]>([]);
  const [earnings, setEarnings] = useState<CreatorEarning[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [transactions, setTransactions] = useState<FinancialTransaction[]>([]);
  const [payoutProfile, setPayoutProfile] = useState<CreatorPayoutProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // Application form state
  const [country, setCountry] = useState('Bangladesh');
  const [payoutCategory, setPayoutCategory] = useState('bKash / Nagad / Bank Transfer');
  const [policiesAccepted, setPoliciesAccepted] = useState(false);
  const [originalContentAttested, setOriginalContentAttested] = useState(false);
  const [regionalComplianceAttested, setRegionalComplianceAttested] = useState(false);
  const [responseNote, setResponseNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Payout Profile form state (strictly non-card payout rails)
  const [profMethod, setProfMethod] = useState('bKash');
  const [profHolderName, setProfHolderName] = useState('');
  const [profIdentifier, setProfIdentifier] = useState('');
  const [profBankName, setProfBankName] = useState('');
  const [profBranchName, setProfBranchName] = useState('');
  const [profCountry, setProfCountry] = useState('Bangladesh');
  const [profTaxNote, setProfTaxNote] = useState('');

  // Payout request modal state
  const [payoutOpen, setPayoutOpen] = useState(false);
  const [payoutAmount, setPayoutAmount] = useState('10');
  const [payoutMethod, setPayoutMethod] = useState('bKash');
  const [payoutAccount, setPayoutAccount] = useState('');
  const [payoutHolder, setPayoutHolder] = useState('');

  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const loadStudioData = async () => {
    if (!firebaseUser || !profile) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [postsSnap, reelsSnap, appSnap, loadedPolicy, ledger] = await Promise.all([
        getDocs(query(collection(db, 'posts'), where('authorId', '==', firebaseUser.uid))),
        getDocs(query(collection(db, 'reels'), where('authorId', '==', firebaseUser.uid))),
        getDocs(query(collection(db, 'creatorApplications'), where('uid', '==', firebaseUser.uid))),
        fetchMonetizationPolicy(),
        fetchCreatorLedgerData(firebaseUser.uid),
      ]);

      const loadedPosts = postsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BanaPost, 'id'>) }));
      const loadedReels = reelsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BanaReel, 'id'>) }));

      let latestApp: CreatorApplication | null = null;
      if (!appSnap.empty) {
        const sorted = appSnap.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CreatorApplication, 'id'>) }))
          .sort((a, b) => {
            const ta = a.updatedAt?.toMillis?.() || a.createdAt?.toMillis?.() || 0;
            const tb = b.updatedAt?.toMillis?.() || b.createdAt?.toMillis?.() || 0;
            return tb - ta;
          });
        latestApp = sorted[0];
      }

      setPosts(loadedPosts);
      setReels(loadedReels);
      setApplication(latestApp);
      setPolicy(loadedPolicy);
      setEvents(ledger.events);
      setEarnings(ledger.earnings);
      setPayouts(ledger.payouts);
      setTransactions(ledger.transactions);
      setPayoutProfile(ledger.payoutProfile);

      if (loadedPolicy.payoutMethodsEnabled.length > 0) {
        setPayoutMethod(ledger.payoutProfile?.preferredMethod || loadedPolicy.payoutMethodsEnabled[0]);
        setProfMethod(ledger.payoutProfile?.preferredMethod || loadedPolicy.payoutMethodsEnabled[0]);
      }
      setPayoutAmount(String(loadedPolicy.minPayoutUsd || 10));

      if (ledger.payoutProfile) {
        setProfHolderName(ledger.payoutProfile.accountHolderName || '');
        setProfBankName(ledger.payoutProfile.bankName || '');
        setProfBranchName(ledger.payoutProfile.branchName || '');
        setProfCountry(ledger.payoutProfile.country || 'Bangladesh');
        setProfTaxNote(ledger.payoutProfile.taxResidencyNote || '');
        setPayoutHolder(ledger.payoutProfile.accountHolderName || '');
        setPayoutAccount(ledger.payoutProfile.accountIdentifierMasked || '');
      }

      const evalRec = await evaluateCreatorEligibilityClientOrServer({
        uid: firebaseUser.uid,
        profile,
        settings,
        firebaseUser,
        postsCount: loadedPosts.length,
        reelsCount: loadedReels.length,
        policy: loadedPolicy,
        application: latestApp,
      });
      setEligibility(evalRec);
    } catch (err) {
      logFirestoreError(err, OperationType.LIST, 'creatorStudio');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudioData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid, profile?.followersCount, profile?.isCreator]);

  // Prompt 08: follower growth computed from real follow records (new follows still active in the window).
  const [followerGrowth, setFollowerGrowth] = useState<{ d7: number; d30: number } | null>(null);
  useEffect(() => {
    const uid = firebaseUser?.uid;
    if (!uid) return;
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(collection(db, 'userFollows'), where('followingId', '==', uid)));
        const now = Date.now();
        let d7 = 0;
        let d30 = 0;
        snap.docs.forEach((d) => {
          const ts: any = (d.data() as any).createdAt;
          const ms = typeof ts?.toMillis === 'function' ? ts.toMillis() : ts?.seconds ? ts.seconds * 1000 : 0;
          if (!ms) return;
          if (now - ms <= 30 * 86400000) d30 += 1;
          if (now - ms <= 7 * 86400000) d7 += 1;
        });
        if (!cancelled) setFollowerGrowth({ d7, d30 });
      } catch {
        if (!cancelled) setFollowerGrowth(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser?.uid, profile?.followersCount]);

  const summary = useMemo(
    () => computeEarningsSummary(events, earnings, payouts),
    [events, earnings, payouts]
  );

  if (!firebaseUser || !profile) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
          <h1 className="font-display font-bold text-xl">BANA Creator Studio</h1>
          <p className="text-sm text-neutral-500">
            Sign in to inspect your real content performance, monetization eligibility, and creator payouts.
          </p>
          <button
            type="button"
            onClick={() => openAuthModal('Sign in to open BANA Creator Studio.')}
            className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold"
          >
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  // Live follower number (on Spark the stored counter is not maintained by Cloud Functions)
  const followers = eligibility?.followersCount ?? (profile.followersCount || 0);
  const totalVideoViews =
    reels.reduce((s, r) => s + Number(r.viewsCount || 0), 0) +
    posts.filter((p) => p.type === 'video').reduce((s, p) => s + Number(p.viewsCount || 0), 0);

  const totalQualifiedViews =
    summary.totalQualifiedViews ||
    reels.reduce((s, r: any) => s + Number(r.qualifiedViewsCount || 0), 0) +
      posts.reduce((s, p: any) => s + Number(p.qualifiedViewsCount || 0), 0);

  const totalWatchSecs =
    summary.totalWatchSeconds ||
    reels.reduce((s, r: any) => s + Number(r.totalWatchSeconds || 0), 0) +
      posts.reduce((s, p: any) => s + Number(p.totalWatchSeconds || 0), 0);

  const watchMinutes = Math.round(totalWatchSecs / 60);
  const watchTimeFormatted =
    watchMinutes >= 60 ? `${Math.floor(watchMinutes / 60)}h ${watchMinutes % 60}m` : `${watchMinutes}m`;

  const avgDurationSec = totalQualifiedViews > 0 ? Math.round(totalWatchSecs / totalQualifiedViews) : 0;

  const totalEngagements =
    posts.reduce((s, p) => s + (p.likesCount || 0) + (p.commentsCount || 0) + (p.sharesCount || 0), 0) +
    reels.reduce((s, r) => s + (r.likesCount || 0) + (r.commentsCount || 0) + (r.sharesCount || 0), 0);

  const followerProgressPct = Math.min(
    100,
    Math.round((followers / Math.max(1, policy.minFollowers)) * 100)
  );

  // Content Performance rows combining Reels and Video/Feed posts
  const performanceRows = [
    ...reels.map((r) => ({
      id: r.id,
      kind: 'Reel',
      title: r.title || r.caption || 'Untitled Reel',
      views: Number(r.viewsCount || 0),
      qualifiedViews: Number((r as any).qualifiedViewsCount || 0),
      watchSeconds: Number((r as any).totalWatchSeconds || 0),
      likes: Number(r.likesCount || 0),
      comments: Number(r.commentsCount || 0),
      shares: Number(r.sharesCount || 0),
      status: r.status,
      monetizationEligible: profile.isCreator && r.status === 'active' && r.visibility === 'public',
    })),
    ...posts.map((p) => ({
      id: p.id,
      kind: p.type === 'video' ? 'Video Post' : 'Post',
      title: p.content?.slice(0, 52) || `BANA ${p.type}`,
      views: Number(p.viewsCount || 0),
      qualifiedViews: Number((p as any).qualifiedViewsCount || 0),
      watchSeconds: Number((p as any).totalWatchSeconds || 0),
      likes: Number(p.likesCount || 0),
      comments: Number(p.commentsCount || 0),
      shares: Number(p.sharesCount || 0),
      status: p.status,
      monetizationEligible: profile.isCreator && p.status === 'published' && p.visibility === 'public',
    })),
  ].sort((a, b) => b.views + b.likes * 3 - (a.views + a.likes * 3));

  const chartItems = performanceRows.slice(0, 8);
  const maxChartVal = Math.max(10, ...chartItems.map((i) => i.views || i.likes * 4));

  const handleApplyMonetization = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionErr(null);
    setActionMsg(null);
    if (!policiesAccepted || !originalContentAttested || !regionalComplianceAttested) {
      setActionErr('Please confirm the BANA Creator Guidelines, original content and regional eligibility attestations.');
      return;
    }
    setSubmitting(true);
    try {
      await submitCreatorApplication({
        uid: firebaseUser.uid,
        username: profile.username,
        displayName: profile.displayName || profile.username,
        followerCountAtApply: followers,
        country,
        payoutCategory,
        originalContentAttested,
        policiesAccepted,
        regionalComplianceAttested,
      });
      setActionMsg('Monetization application submitted for administrator review.');
      await loadStudioData();
      setActiveTab('applications');
    } catch (err) {
      setActionErr(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleApplicationResponse = async (
    e: React.FormEvent,
    mode: 'appeal' | 'needs_info_response'
  ) => {
    e.preventDefault();
    if (!application || !responseNote.trim()) return;
    setActionErr(null);
    setActionMsg(null);
    setSubmitting(true);
    try {
      await respondOrAppealApplication({
        application,
        uid: firebaseUser.uid,
        mode,
        note: responseNote,
        country,
        payoutCategory,
      });
      setResponseNote('');
      setActionMsg(
        mode === 'appeal'
          ? 'Appeal submitted to BANA Creator Review.'
          : 'Requested information submitted and application returned to review queue.'
      );
      await loadStudioData();
    } catch (err) {
      setActionErr(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSavePayoutProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionErr(null);
    setActionMsg(null);
    if (!profHolderName.trim() || !profIdentifier.trim()) {
      setActionErr('Enter the payout account holder name and mobile wallet or bank account identifier.');
      return;
    }
    setSubmitting(true);
    try {
      const saved = await saveCreatorPayoutProfile({
        uid: firebaseUser.uid,
        preferredMethod: profMethod,
        accountHolderName: profHolderName,
        accountIdentifier: profIdentifier,
        bankName: profBankName,
        branchName: profBranchName,
        country: profCountry,
        taxResidencyNote: profTaxNote,
      });
      setPayoutProfile(saved);
      setProfIdentifier('');
      setActionMsg('Payout profile saved securely (sensitive digits masked; no card details stored).');
      await loadStudioData();
    } catch (err) {
      setActionErr(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRequestPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    setActionErr(null);
    setActionMsg(null);
    const amt = Number(payoutAmount);
    if (!profile.isCreator) {
      setActionErr('Active approved creator monetization status is required before requesting payouts.');
      return;
    }
    if (amt < policy.minPayoutUsd || amt > summary.availableBalanceUsd) {
      setActionErr(
        `Enter an amount between $${policy.minPayoutUsd.toFixed(2)} and your confirmed available balance of $${summary.availableBalanceUsd.toFixed(2)}.`
      );
      return;
    }
    if (!payoutAccount.trim()) {
      setActionErr('Enter a verified payout account destination.');
      return;
    }
    setSubmitting(true);
    try {
      await submitCreatorPayoutRequest({
        uid: firebaseUser.uid,
        amountUsd: amt,
        method: payoutMethod,
        accountLabel: payoutAccount.trim(),
        accountHolderName: payoutHolder.trim() || profile.displayName,
        country: profCountry || country,
      });
      setPayoutOpen(false);
      setActionMsg(
        `Payout request of $${amt.toFixed(2)} via ${payoutMethod} submitted for Finance verification.`
      );
      await loadStudioData();
    } catch (err) {
      setActionErr(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const eligibilityChecks = [
    {
      ok: followers >= policy.minFollowers,
      label: `Minimum ${policy.minFollowers.toLocaleString()} genuine followers`,
      detail: `${followers.toLocaleString()} / ${policy.minFollowers.toLocaleString()}`,
    },
    {
      ok: Boolean(eligibility?.isAdult),
      label: '18+ Legal Age Requirement',
      detail: eligibility?.isAdult ? 'Verified' : 'Requires 18+ account birth year',
    },
    {
      ok: Boolean(eligibility?.isEmailVerified),
      label: 'Verified Account Email',
      detail: eligibility?.isEmailVerified ? 'Verified' : 'Verify email in settings',
    },
    {
      ok: Boolean(eligibility?.hasOriginalContent),
      label: 'Original Content Published on BANA',
      detail: `${posts.length} posts · ${reels.length} reels`,
    },
    {
      ok: Boolean(eligibility?.isGoodStanding),
      label: 'Clean Policy & Community Standing',
      detail: profile.accountStatus === 'active' ? 'Good standing' : `Restricted (${profile.accountStatus})`,
    },
    {
      ok: Boolean(eligibility?.regionEligible),
      label: 'Regional Monetization Availability',
      detail: policy.eligibleRegions.join(', '),
    },
  ];

  const sourceTotals = earnings.reduce<Record<string, number>>((acc, e) => {
    const key = e.sourceType || 'ad_rev_share';
    acc[key] = (acc[key] || 0) + Number(e.amountUsd || 0);
    return acc;
  }, {});

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top Studio Banner */}
        <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm overflow-hidden grid grid-cols-1 lg:grid-cols-12">
          <div className="lg:col-span-8 p-6 flex flex-col justify-between space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-brand">BANA Creator Studio</p>
                <h1 className="font-display font-extrabold text-2xl sm:text-3xl mt-1 text-neutral-950 dark:text-white">
                  Creator Monetization & Analytics
                </h1>
                <p className="text-xs text-neutral-500 mt-1 max-w-2xl">
                  Track qualified views, watch time, policy-governed revenue share ({policy.creatorSharePct}% Creator /{' '}
                  {policy.platformSharePct}% Platform), eligibility review status, and verified payouts.
                </p>
              </div>
              <button
                type="button"
                onClick={() => navigate('/advertise')}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
              >
                Open Ads Manager
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 text-xs font-mono tabular-nums">
              <span>
                Program Status:{' '}
                <strong
                  className={
                    profile.isCreator
                      ? 'text-emerald-600'
                      : application?.status === 'suspended' || application?.status === 'rejected'
                      ? 'text-red-600'
                      : application?.status === 'needs_info'
                      ? 'text-amber-600'
                      : 'text-neutral-900 dark:text-white'
                  }
                >
                  {profile.isCreator
                    ? 'Active Monetized Creator'
                    : application
                    ? `Application ${application.status.replace('_', ' ')}`
                    : eligibility?.eligibleToApply
                    ? 'Eligible to Apply'
                    : 'Not Yet Monetized'}
                </strong>
              </span>
              <span className="text-neutral-300 dark:text-neutral-700">·</span>
              <span>Posts: {posts.length}</span>
              <span className="text-neutral-300 dark:text-neutral-700">·</span>
              <span>Reels: {reels.length}</span>
              <span className="text-neutral-300 dark:text-neutral-700">·</span>
              <span>Min Payout: ${policy.minPayoutUsd.toFixed(2)}</span>
            </div>
          </div>

          <div className="lg:col-span-4 h-44 lg:h-auto relative">
            <img loading="lazy"
              src={studioBanner}
              alt="BANA Creator Studio"
              className="w-full h-full object-cover"
            />
          </div>
        </div>

        {/* Section Tabs */}
        <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-neutral-200 dark:border-neutral-800">
          {STUDIO_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`inline-flex items-center gap-1.5 px-3.5 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-brand text-brand'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            );
          })}
        </nav>

        {!CLOUD_FUNCTIONS_ENABLED && (
          <div className="rounded-[12px] border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
            <Info className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Spark Free Plan Mode:</strong> Automated view-based CPM accrual requires upgrading to Firebase Blaze Cloud Functions. Monetization applications, payout profile management, payout requests, and admin-confirmed ledger settlements work normally.
            </span>
          </div>
        )}
        {actionMsg && (
          <div className="rounded-[12px] border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 text-xs text-emerald-700 dark:text-emerald-300">
            {actionMsg}
          </div>
        )}
        {actionErr && (
          <div className="rounded-[12px] border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300">
            {actionErr}
          </div>
        )}

        {/* KPI Summary Row (Always visible on Overview & Earnings) */}
        {(activeTab === 'overview' || activeTab === 'earnings') && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Followers', val: formatCompactNumber(followers), icon: Users },
              { label: 'Qualified Views', val: formatCompactNumber(totalQualifiedViews), icon: Eye },
              { label: 'Est. Watch Time', val: watchTimeFormatted, icon: Clock3 },
              { label: 'Engagements', val: formatCompactNumber(totalEngagements), icon: Heart },
              {
                label: 'Estimated Earnings',
                val: `$${summary.estimatedUsd.toFixed(2)}`,
                icon: TrendingUp,
              },
              {
                label: 'Available Balance',
                val: `$${summary.availableBalanceUsd.toFixed(2)}`,
                icon: DollarSign,
              },
            ].map((kpi) => {
              const Icon = kpi.icon;
              return (
                <div
                  key={kpi.label}
                  className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4"
                >
                  <div className="flex items-center justify-between text-xs text-neutral-500">
                    <span>{kpi.label}</span>
                    <Icon className="w-3.5 h-3.5 text-brand" />
                  </div>
                  <p className="font-mono font-bold text-xl mt-1.5 tabular-nums text-neutral-950 dark:text-white">
                    {kpi.val}
                  </p>
                </div>
              );
            })}
          </div>
        )}
        {(activeTab === 'overview' || activeTab === 'earnings') && (
          <p className="text-[11px] text-neutral-500">
            {followerGrowth
              ? `Follower growth: +${followerGrowth.d7} in the last 7 days · +${followerGrowth.d30} in the last 30 days (new follows that are still active; unfollows are not counted). `
              : 'Follower growth is unavailable right now. '}
            Earnings figures marked “Estimated” are not payable until confirmed on the BANA server.
          </p>
        )}

        {/* TAB 1: OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-7 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="font-display font-bold text-base">Top Content Views & Reach</h2>
                  <p className="text-xs text-neutral-500">
                    Derived from real published Reels & posts · Avg watch duration{' '}
                    <span className="font-mono tabular-nums">{avgDurationSec}s</span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('performance')}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Full Performance Table
                </button>
              </div>

              {chartItems.length === 0 ? (
                <p className="text-xs text-neutral-500 py-10 text-center">
                  Publish posts or Reels to track genuine views, watch time, and qualified view performance.
                </p>
              ) : (
                <div className="h-48 flex items-end gap-3 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                  {chartItems.map((item) => {
                    const val = item.views || item.likes * 4;
                    const pct = Math.max(8, Math.round((val / maxChartVal) * 100));
                    return (
                      <div key={item.id} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end min-w-0">
                        <span className="text-[10px] font-mono tabular-nums text-neutral-500">
                          {formatCompactNumber(val)}
                        </span>
                        <div
                          className="w-full max-w-[36px] rounded-t-md bg-brand transition-all"
                          style={{ height: `${pct}%` }}
                        />
                        <span className="text-[10px] text-neutral-500 truncate w-full text-center">
                          {item.kind}
                        </span>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            <section className="lg:col-span-5 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="font-display font-bold text-base">Eligibility Progress</h2>
                <button
                  type="button"
                  onClick={() => setActiveTab('eligibility')}
                  className="text-xs font-semibold text-brand hover:underline"
                >
                  Check Requirements
                </button>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span>Genuine Followers</span>
                  <span>
                    {followers.toLocaleString()} / {policy.minFollowers.toLocaleString()} ({followerProgressPct}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div
                    className="h-full bg-brand transition-all"
                    style={{ width: `${followerProgressPct}%` }}
                  />
                </div>
              </div>

              <div className="space-y-2 pt-1">
                {eligibilityChecks.slice(0, 5).map((c) => (
                  <div key={c.label} className="flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 min-w-0">
                      {c.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-neutral-400 shrink-0" />
                      )}
                      <span className="truncate">{c.label}</span>
                    </div>
                    <span className="font-mono text-[11px] text-neutral-500 shrink-0">{c.detail}</span>
                  </div>
                ))}
              </div>

              <div className="pt-3 border-t border-neutral-100 dark:border-neutral-800 flex items-center justify-between text-xs">
                <span className="text-neutral-500">Confirmed Withdrawable</span>
                <span className="font-mono font-bold text-sm tabular-nums text-emerald-600">
                  ${summary.availableBalanceUsd.toFixed(2)}
                </span>
              </div>
            </section>
          </div>
        )}

        {/* TAB 2: EARNINGS */}
        {activeTab === 'earnings' && (
          <div className="space-y-6">
            <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-4 flex items-start gap-3 text-xs text-neutral-600 dark:text-neutral-300">
              <Info className="w-4 h-4 text-brand shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-neutral-900 dark:text-white">
                  Estimated vs Confirmed Earnings Accounting
                </p>
                <p className="mt-0.5">
                  <strong>Estimated Earnings</strong> reflect provisional qualified-view signals computed under active
                  ad-pool policy ({policy.creatorSharePct}% Creator / {policy.platformSharePct}% Platform) and are not
                  withdrawable until reviewed. Only <strong>Confirmed</strong> and audited <strong>Adjusted</strong>{' '}
                  ledger credits entered into Creator Finance become part of your <strong>Available Balance</strong>.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { label: 'Estimated (Unsettled)', val: `$${summary.estimatedUsd.toFixed(2)}`, tone: 'text-amber-600' },
                { label: 'Confirmed Credits', val: `$${summary.confirmedUsd.toFixed(2)}`, tone: 'text-emerald-600' },
                { label: 'Pending Finance Entries', val: `$${summary.pendingEarningsUsd.toFixed(2)}`, tone: 'text-neutral-600 dark:text-neutral-300' },
                { label: 'Admin Adjustments', val: `${summary.adjustmentsUsd >= 0 ? '+' : ''}$${summary.adjustmentsUsd.toFixed(2)}`, tone: 'text-brand' },
              ].map((card) => (
                <div
                  key={card.label}
                  className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4"
                >
                  <p className="text-xs text-neutral-500">{card.label}</p>
                  <p className={`font-mono font-bold text-2xl mt-1 tabular-nums ${card.tone}`}>{card.val}</p>
                </div>
              ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <section className="lg:col-span-4 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
                <h2 className="font-display font-bold text-base">Revenue Sources</h2>
                {Object.keys(sourceTotals).length === 0 ? (
                  <p className="text-xs text-neutral-500">
                    No confirmed revenue entries yet. Once Creator Monetization is approved and ad-share cycles settle,
                    sources appear here.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {Object.entries(sourceTotals).map(([src, total]) => (
                      <div
                        key={src}
                        className="flex items-center justify-between text-xs py-2 border-b border-neutral-100 dark:border-neutral-800"
                      >
                        <span className="capitalize font-medium">{src.replace(/_/g, ' ')}</span>
                        <span className="font-mono font-bold tabular-nums">${total.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="lg:col-span-8 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-bold text-base">Confirmed & Adjusted Earnings Ledger</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('payments')}
                    className="text-xs font-semibold text-brand hover:underline"
                  >
                    Go to Payouts
                  </button>
                </div>

                {loading ? (
                  <p className="text-xs text-neutral-500">Loading ledger...</p>
                ) : earnings.length === 0 && events.length === 0 ? (
                  <p className="text-xs text-neutral-500 py-8 text-center">
                    No earning events or confirmed ledger credits recorded yet.
                  </p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Description</th>
                          <th className="py-2 pr-3 font-medium">Source</th>
                          <th className="py-2 pr-3 font-medium">Period</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {earnings.map((e) => (
                          <tr key={e.id}>
                            <td className="py-2.5 pr-3">
                              <p className="font-medium text-neutral-900 dark:text-white">{e.description}</p>
                              {e.adjustmentReason && e.adjustmentReason !== e.description && (
                                <p className="text-[11px] text-neutral-500">{e.adjustmentReason}</p>
                              )}
                            </td>
                            <td className="py-2.5 pr-3 capitalize">{e.sourceType.replace(/_/g, ' ')}</td>
                            <td className="py-2.5 pr-3 font-mono tabular-nums">{e.period}</td>
                            <td className="py-2.5 pr-3 font-mono capitalize">{e.status}</td>
                            <td
                              className={`py-2.5 text-right font-mono font-bold tabular-nums ${
                                e.amountUsd >= 0 ? 'text-emerald-600' : 'text-red-600'
                              }`}
                            >
                              {e.amountUsd >= 0 ? '+' : ''}${Number(e.amountUsd || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                        {events.slice(0, 10).map((ev) => (
                          <tr key={ev.id} className="text-neutral-500">
                            <td className="py-2.5 pr-3">
                              Qualified View Event · {ev.contentTitle || ev.contentType}
                            </td>
                            <td className="py-2.5 pr-3 capitalize">{ev.sourceType.replace(/_/g, ' ')}</td>
                            <td className="py-2.5 pr-3 font-mono tabular-nums">{ev.period}</td>
                            <td className="py-2.5 pr-3 font-mono capitalize text-amber-600">{ev.status}</td>
                            <td className="py-2.5 text-right font-mono tabular-nums">
                              ~${Number(ev.estimatedAmountUsd || 0).toFixed(4)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        )}

        {/* TAB 3: CONTENT PERFORMANCE */}
        {activeTab === 'performance' && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display font-bold text-base">Video & Post Performance</h2>
                <p className="text-xs text-neutral-500">
                  Qualified views require at least {policy.qualifiedViewMinSeconds}s of active playback and deduplicate repeat hourly views.
                </p>
              </div>
              <div className="text-xs font-mono tabular-nums text-neutral-500">
                Total Views: {totalVideoViews.toLocaleString()} · Qualified: {totalQualifiedViews.toLocaleString()} · Avg Watch: {avgDurationSec}s
              </div>
            </div>

            {performanceRows.length === 0 ? (
              <p className="text-xs text-neutral-500 py-10 text-center">
                No posts or Reels published yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Content</th>
                      <th className="py-2 pr-3 font-medium">Format</th>
                      <th className="py-2 pr-3 font-medium text-right">Views</th>
                      <th className="py-2 pr-3 font-medium text-right">Qualified</th>
                      <th className="py-2 pr-3 font-medium text-right">Watch Time</th>
                      <th className="py-2 pr-3 font-medium text-right">Likes</th>
                      <th className="py-2 pr-3 font-medium text-right">Comments</th>
                      <th className="py-2 pr-3 font-medium text-right">Shares</th>
                      <th className="py-2 font-medium text-right">Monetization</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {performanceRows.map((row) => (
                      <tr key={row.id}>
                        <td className="py-2.5 pr-3 font-medium max-w-xs truncate text-neutral-900 dark:text-white">
                          {row.title}
                        </td>
                        <td className="py-2.5 pr-3 text-neutral-500">{row.kind}</td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {row.views.toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {row.qualifiedViews.toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {Math.round(row.watchSeconds)}s
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {row.likes.toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {row.comments.toLocaleString()}
                        </td>
                        <td className="py-2.5 pr-3 text-right font-mono tabular-nums">
                          {row.shares.toLocaleString()}
                        </td>
                        <td className="py-2.5 text-right font-mono">
                          <span className={row.monetizationEligible ? 'text-emerald-600' : 'text-neutral-500'}>
                            {row.monetizationEligible ? 'Eligible' : 'Non-monetized'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: MONETIZATION STATUS & ELIGIBILITY */}
        {activeTab === 'eligibility' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <section className="lg:col-span-6 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <div>
                <h2 className="font-display font-bold text-lg">Monetization Eligibility Verification</h2>
                <p className="text-xs text-neutral-500 mt-1">
                  Reaching {policy.minFollowers.toLocaleString()} followers unlocks the application form. Monetization
                  is never activated automatically—every account undergoes policy, authenticity, and administrator verification.
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between text-xs font-mono tabular-nums">
                  <span>Follower Threshold Progress</span>
                  <span>
                    {followers.toLocaleString()} / {policy.minFollowers.toLocaleString()} ({followerProgressPct}%)
                  </span>
                </div>
                <div className="h-2.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                  <div className="h-full bg-brand" style={{ width: `${followerProgressPct}%` }} />
                </div>
              </div>

              <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                {eligibilityChecks.map((check) => (
                  <div key={check.label} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                    <div className="flex items-center gap-2.5">
                      {check.ok ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <XCircle className="w-4 h-4 text-neutral-400 shrink-0" />
                      )}
                      <span className={check.ok ? 'text-neutral-950 dark:text-white font-medium' : 'text-neutral-500'}>
                        {check.label}
                      </span>
                    </div>
                    <span className="font-mono text-[11px] text-neutral-500">{check.detail}</span>
                  </div>
                ))}
              </div>
            </section>

            <section className="lg:col-span-6 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <h2 className="font-display font-bold text-lg">Submit Monetization Application</h2>
              {profile.isCreator ? (
                <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-xs text-emerald-800 dark:text-emerald-200 space-y-1.5">
                  <p className="font-semibold flex items-center gap-1.5">
                    <Award className="w-4 h-4" /> Monetization Active
                  </p>
                  <p>
                    Your creator account has been approved by BANA Administration. You are earning under the{' '}
                    {policy.creatorSharePct}% / {policy.platformSharePct}% policy share.
                  </p>
                </div>
              ) : application && application.status !== 'rejected' ? (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4 text-xs space-y-2">
                  <p className="font-semibold">
                    Current Application Status:{' '}
                    <span className="font-mono uppercase text-brand">{application.status}</span>
                  </p>
                  <p className="text-neutral-500">
                    Manage your application, respond to reviewer requests, or inspect the review timeline in the
                    Applications tab.
                  </p>
                  <button
                    type="button"
                    onClick={() => setActiveTab('applications')}
                    className="px-3.5 py-2 rounded-xl bg-brand text-white font-semibold text-xs"
                  >
                    Open Applications Tab
                  </button>
                </div>
              ) : (
                <form onSubmit={handleApplyMonetization} className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="text-[11px] text-neutral-500 block mb-1">Country / Region</label>
                      <input
                        type="text"
                        required
                        value={country}
                        onChange={(e) => setCountry(e.target.value)}
                        className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                      />
                    </div>
                    <div>
                      <label className="text-[11px] text-neutral-500 block mb-1">Preferred Payout Rail</label>
                      <select
                        value={payoutCategory}
                        onChange={(e) => setPayoutCategory(e.target.value)}
                        className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                      >
                        {policy.payoutMethodsEnabled.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={originalContentAttested}
                      onChange={(e) => setOriginalContentAttested(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>I attest that my posts and Reels are original works created by me or properly licensed.</span>
                  </label>
                  <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={policiesAccepted}
                      onChange={(e) => setPoliciesAccepted(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>I have reviewed and accept the BANA Creator Monetization Guidelines and revenue terms.</span>
                  </label>
                  <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                    <input
                      type="checkbox"
                      checked={regionalComplianceAttested}
                      onChange={(e) => setRegionalComplianceAttested(e.target.checked)}
                      className="mt-0.5"
                    />
                    <span>I confirm regional eligibility and tax/identity compliance in my country of residence.</span>
                  </label>

                  <button
                    type="submit"
                    disabled={!eligibility?.eligibleToApply || submitting}
                    className="w-full h-10 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-45"
                  >
                    {submitting
                      ? 'Submitting Application...'
                      : eligibility?.eligibleToApply
                      ? 'Apply for Creator Monetization'
                      : 'Complete All Eligibility Checks to Apply'}
                  </button>
                </form>
              )}
            </section>
          </div>
        )}

        {/* TAB 5: APPLICATIONS & TIMELINE */}
        {activeTab === 'applications' && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="font-display font-bold text-lg">Monetization Applications & Review History</h2>
                <p className="text-xs text-neutral-500">
                  Track status changes, respond to reviewer information requests, or appeal a rejection.
                </p>
              </div>
              {!application && (
                <button
                  type="button"
                  onClick={() => setActiveTab('eligibility')}
                  className="px-3.5 py-2 rounded-xl bg-brand text-white text-xs font-semibold"
                >
                  Check Eligibility & Apply
                </button>
              )}
            </div>

            {!application ? (
              <p className="text-xs text-neutral-500 py-8 text-center">
                You have not submitted a Creator Monetization application yet.
              </p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4 space-y-2">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <span className="font-semibold">
                      Application #{application.id.slice(-8)} · {application.country} · {application.payoutCategory}
                    </span>
                    <span className="inline-flex items-center gap-1 font-mono font-bold uppercase text-brand">
                      <Clock className="w-3.5 h-3.5" /> {application.status.replace('_', ' ')}
                    </span>
                  </div>
                  {application.adminNote && (
                    <p className="text-xs text-neutral-700 dark:text-neutral-300">
                      Reviewer Note: {application.adminNote}
                    </p>
                  )}
                  {application.rejectionReason && (
                    <p className="text-xs text-red-600">Rejection Reason: {application.rejectionReason}</p>
                  )}
                </div>

                {(application.status === 'needs_info' || application.status === 'rejected') && (
                  <form
                    onSubmit={(e) =>
                      handleApplicationResponse(
                        e,
                        application.status === 'needs_info' ? 'needs_info_response' : 'appeal'
                      )
                    }
                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-4 space-y-3"
                  >
                    <h3 className="font-display font-bold text-sm">
                      {application.status === 'needs_info'
                        ? 'Submit Requested Information'
                        : 'Submit Reconsideration Appeal'}
                    </h3>
                    <textarea
                      rows={3}
                      required
                      value={responseNote}
                      onChange={(e) => setResponseNote(e.target.value)}
                      placeholder={
                        application.status === 'needs_info'
                          ? 'Provide the requested clarification or links...'
                          : 'Explain how you resolved the rejection issues...'
                      }
                      className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-xs"
                    />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold disabled:opacity-50"
                    >
                      {submitting
                        ? 'Sending...'
                        : application.status === 'needs_info'
                        ? 'Send Information & Resubmit'
                        : 'Submit Appeal'}
                    </button>
                  </form>
                )}

                {Array.isArray(application.history) && application.history.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold text-neutral-500">Review Timeline</h3>
                    <div className="divide-y divide-neutral-100 dark:divide-neutral-800 border border-neutral-200 dark:border-neutral-800 rounded-xl px-4">
                      {application.history.map((h, i) => (
                        <div key={i} className="py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
                          <div>
                            <span className="font-mono font-semibold uppercase">{h.status.replace('_', ' ')}</span>
                            {h.note && <span className="text-neutral-500"> · {h.note}</span>}
                          </div>
                          <span className="font-mono text-[11px] text-neutral-500">
                            {new Date(h.at).toLocaleString()}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* TAB 6: PAYMENT HISTORY & PAYOUT PROFILE */}
        {activeTab === 'payments' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Payout Profile (Strictly NO card numbers or CVV) */}
            <section className="lg:col-span-5 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <div>
                <h2 className="font-display font-bold text-base">Payout Profile</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Configure your verified mobile wallet or bank transfer destination. BANA never stores raw card numbers or CVV codes.
                </p>
              </div>

              {payoutProfile && (
                <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3.5 text-xs space-y-1">
                  <p className="font-semibold">
                    Saved Rail: {payoutProfile.preferredMethod} ({payoutProfile.accountIdentifierMasked})
                  </p>
                  <p className="text-neutral-500">
                    Holder: {payoutProfile.accountHolderName} · {payoutProfile.country}
                  </p>
                </div>
              )}

              <form onSubmit={handleSavePayoutProfile} className="space-y-3">
                <div className="grid grid-cols-2 gap-2.5">
                  <div>
                    <label className="text-[11px] text-neutral-500 block mb-1">Payout Method</label>
                    <select
                      value={profMethod}
                      onChange={(e) => setProfMethod(e.target.value)}
                      className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs"
                    >
                      {policy.payoutMethodsEnabled.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-neutral-500 block mb-1">Country</label>
                    <input
                      type="text"
                      required
                      value={profCountry}
                      onChange={(e) => setProfCountry(e.target.value)}
                      className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                    />
                  </div>
                </div>

                <input
                  type="text"
                  required
                  value={profHolderName}
                  onChange={(e) => setProfHolderName(e.target.value)}
                  placeholder="Account Holder Full Legal Name"
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                />
                <input
                  type="text"
                  required
                  value={profIdentifier}
                  onChange={(e) => setProfIdentifier(e.target.value)}
                  placeholder="bKash / Nagad Wallet Number or Bank Account Number"
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs font-mono"
                />

                {profMethod.toLowerCase().includes('bank') && (
                  <div className="grid grid-cols-2 gap-2.5">
                    <input
                      type="text"
                      value={profBankName}
                      onChange={(e) => setProfBankName(e.target.value)}
                      placeholder="Bank Name"
                      className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                    />
                    <input
                      type="text"
                      value={profBranchName}
                      onChange={(e) => setProfBranchName(e.target.value)}
                      placeholder="Branch / Routing"
                      className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                    />
                  </div>
                )}

                <input
                  type="text"
                  value={profTaxNote}
                  onChange={(e) => setProfTaxNote(e.target.value)}
                  placeholder="Optional Tax / TIN / NID Reference Note"
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                />

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 font-semibold text-xs hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  Save Payout Profile
                </button>
              </form>
            </section>

            {/* Payout Requests + Financial Ledger */}
            <section className="lg:col-span-7 space-y-6">
              <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h2 className="font-display font-bold text-base">Payout Requests & Settlements</h2>
                    <p className="text-xs text-neutral-500 font-mono tabular-nums">
                      Confirmed Available: ${summary.availableBalanceUsd.toFixed(2)} · Min Threshold: $
                      {policy.minPayoutUsd.toFixed(2)} · Settled: ${summary.paidOutUsd.toFixed(2)}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={!profile.isCreator || summary.availableBalanceUsd < policy.minPayoutUsd}
                    onClick={() => setPayoutOpen(true)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-45"
                  >
                    <Wallet className="w-3.5 h-3.5" /> Request Payout
                  </button>
                </div>

                {!profile.isCreator && (
                  <div className="rounded-xl bg-neutral-50 dark:bg-neutral-950 p-3 text-xs text-neutral-500 flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                    <span>
                      Payout requests require active approved Creator Monetization status and confirmed balance above $
                      {policy.minPayoutUsd.toFixed(2)}.
                    </span>
                  </div>
                )}

                {payouts.length === 0 ? (
                  <p className="text-xs text-neutral-500 py-6 text-center">No payout requests submitted yet.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs">
                      <thead className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                        <tr>
                          <th className="py-2 pr-3 font-medium">Method / Destination</th>
                          <th className="py-2 pr-3 font-medium">Status</th>
                          <th className="py-2 pr-3 font-medium">Ref / Note</th>
                          <th className="py-2 pr-3 font-medium">Requested</th>
                          <th className="py-2 text-right font-medium">Amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                        {payouts.map((p) => (
                          <tr key={p.id}>
                            <td className="py-2.5 pr-3">
                              <p className="font-medium">{p.method}</p>
                              <p className="text-[11px] font-mono text-neutral-500">{p.accountLabel}</p>
                            </td>
                            <td className="py-2.5 pr-3 font-mono capitalize">
                              <span
                                className={
                                  p.status === 'paid' || p.status === 'completed'
                                    ? 'text-emerald-600'
                                    : p.status === 'rejected'
                                    ? 'text-red-600'
                                    : 'text-amber-600'
                                }
                              >
                                {p.status}
                              </span>
                            </td>
                            <td className="py-2.5 pr-3 text-[11px] text-neutral-500">
                              {p.transactionRef || p.adminNote || 'Pending review'}
                            </td>
                            <td className="py-2.5 pr-3 font-mono text-[11px] text-neutral-500">
                              {formatRelativeTime(p.createdAt)}
                            </td>
                            <td className="py-2.5 text-right font-mono font-bold tabular-nums">
                              ${Number(p.amountUsd || 0).toFixed(2)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
                <h2 className="font-display font-bold text-base">Immutable Financial Ledger</h2>
                {transactions.length === 0 ? (
                  <p className="text-xs text-neutral-500">No immutable financial ledger entries posted yet.</p>
                ) : (
                  <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {transactions.slice(0, 15).map((tx) => (
                      <div key={tx.id} className="py-2.5 flex items-center justify-between gap-3 text-xs">
                        <div>
                          <p className="font-medium">{tx.description}</p>
                          <p className="text-[11px] font-mono text-neutral-500">
                            {tx.txType} · {formatRelativeTime(tx.createdAt)}
                          </p>
                        </div>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            tx.direction === 'credit' ? 'text-emerald-600' : 'text-neutral-900 dark:text-white'
                          }`}
                        >
                          {tx.direction === 'credit' ? '+' : '-'}${Number(tx.amountUsd || 0).toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>
          </div>
        )}

        {/* TAB 7: CREATOR GUIDELINES */}
        {activeTab === 'guidelines' && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-4">
            <h2 className="font-display font-bold text-lg">BANA Creator Monetization Guidelines</h2>
            <p className="text-xs text-neutral-600 dark:text-neutral-300 leading-relaxed">{policy.policySummary}</p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {[
                {
                  title: '1. Genuine Followers & Engagement',
                  body: 'Artificial follower inflation, view bots, or self-viewing loops are filtered out before earnings confirmation and can lead to monetization suspension.',
                },
                {
                  title: '2. Originality & Intellectual Property',
                  body: 'Only original videos, Reels, commentary, or properly licensed content qualify for revenue sharing. Reposted third-party compilations are ineligible.',
                },
                {
                  title: '3. Policy-Governed Revenue Share',
                  body: `Current active revenue split is ${policy.creatorSharePct}% Creator / ${policy.platformSharePct}% Platform under monetization policy '${policy.id}'. Payout threshold is $${policy.minPayoutUsd.toFixed(2)}.`,
                },
                {
                  title: '4. Payout Security & Review',
                  body: 'Withdrawals are checked against confirmed ledger entries and settled via verified mobile banking or bank transfer rails. Raw card details are never collected.',
                },
              ].map((g) => (
                <div
                  key={g.title}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-4 space-y-1.5"
                >
                  <h3 className="font-display font-bold text-sm">{g.title}</h3>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 leading-relaxed">{g.body}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Request Payout Modal */}
      {payoutOpen && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <form
            onSubmit={handleRequestPayout}
            className="w-full max-w-md rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-3.5"
          >
            <h3 className="font-display font-bold text-lg">Request Creator Payout</h3>
            <p className="text-xs text-neutral-500">
              Confirmed Available:{' '}
              <span className="font-mono font-semibold tabular-nums">${summary.availableBalanceUsd.toFixed(2)}</span>{' '}
              (Min: ${policy.minPayoutUsd.toFixed(2)}).
            </p>
            <input
              type="number"
              min={policy.minPayoutUsd}
              max={summary.availableBalanceUsd}
              step="0.01"
              required
              value={payoutAmount}
              onChange={(e) => setPayoutAmount(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
            />
            <select
              value={payoutMethod}
              onChange={(e) => setPayoutMethod(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
            >
              {policy.payoutMethodsEnabled.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              required
              value={payoutHolder}
              onChange={(e) => setPayoutHolder(e.target.value)}
              placeholder="Account Holder Name"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
            />
            <input
              type="text"
              required
              value={payoutAccount}
              onChange={(e) => setPayoutAccount(e.target.value)}
              placeholder="bKash / Nagad Number or Masked Bank Account"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
            />
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setPayoutOpen(false)}
                className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Submit Payout Request'}
              </button>
            </div>
          </form>
        </div>
      )}
    </AppShell>
  );
}
