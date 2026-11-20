import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BarChart3,
  CheckCircle2,
  CreditCard,
  ExternalLink,
  Image as ImageIcon,
  Layers,
  Megaphone,
  Pause,
  Play,
  Plus,
  Receipt,
  Search,
  ShieldAlert,
  ShieldCheck,
  Target,
  Trash2,
  Wallet,
} from 'lucide-react';
import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import {
  BANGLADESH_DISTRICTS,
  DISCOVERY_CATEGORIES,
  MARKET_CATEGORIES,
  type AdCampaign,
  type AdCampaignType,
  type AdClickRecord,
  type AdCreativeItem,
  type AdImpressionRecord,
  type AdObjective,
  type AdPaymentRecord,
  type AdPlacement,
  type AdvertiserAccount,
  type AdvertisingSettings,
  type DiscoveryCategory,
} from '@/src/types/bana';
import { AppShell } from '@/src/components/layout/AppShell';
import { ResilientImage } from '@/src/components/common/Avatar';
import { SponsoredAdCard } from '@/src/components/ads/SponsoredAdCard';
import {
  compressImageFile,
  formatRelativeTime,
  uploadMediaWithProgress,
} from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { CLOUD_FUNCTIONS_ENABLED } from '@/src/lib/firebasePlan';
import {
  computeCampaignAnalytics,
  DEFAULT_ADVERTISING_SETTINGS,
  fetchAdvertisingSettings,
  fetchOrCreateAdvertiserAccount,
} from '@/src/lib/ads';

type AdsTab =
  | 'overview'
  | 'create'
  | 'campaigns'
  | 'creatives'
  | 'audience'
  | 'budget'
  | 'performance'
  | 'billing'
  | 'payments';

const ADS_TABS: Array<{ id: AdsTab; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'overview', label: 'Overview', icon: Layers },
  { id: 'create', label: 'Create Campaign', icon: Plus },
  { id: 'campaigns', label: 'My Campaigns', icon: Megaphone },
  { id: 'creatives', label: 'Ad Creatives', icon: ImageIcon },
  { id: 'audience', label: 'Audience', icon: Target },
  { id: 'budget', label: 'Budget', icon: Wallet },
  { id: 'performance', label: 'Performance', icon: BarChart3 },
  { id: 'billing', label: 'Billing', icon: CreditCard },
  { id: 'payments', label: 'Payment History', icon: Receipt },
];

export function AdvertisePage() {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const rawTab = (searchParams.get('tab') || 'overview') as AdsTab;
  const activeTab: AdsTab = ADS_TABS.some((t) => t.id === rawTab) ? rawTab : 'overview';
  const setActiveTab = (tab: AdsTab) => setSearchParams({ tab });

  const [advertiser, setAdvertiser] = useState<AdvertiserAccount | null>(null);
  const [adSettings, setAdSettings] = useState<AdvertisingSettings>(DEFAULT_ADVERTISING_SETTINGS);
  const [campaigns, setCampaigns] = useState<AdCampaign[]>([]);
  const [creatives, setCreatives] = useState<AdCreativeItem[]>([]);
  const [impressions, setImpressions] = useState<AdImpressionRecord[]>([]);
  const [clicks, setClicks] = useState<AdClickRecord[]>([]);
  const [payments, setPayments] = useState<AdPaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [campaignFilter, setCampaignFilter] = useState('all');
  const [campaignSearch, setCampaignSearch] = useState('');

  // Create Campaign Builder State
  const [campaignName, setCampaignName] = useState('');
  const [campaignType, setCampaignType] = useState<AdCampaignType>('sponsored_post');
  const [objective, setObjective] = useState<AdObjective>('reach');
  const [headline, setHeadline] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [ctaLabel, setCtaLabel] = useState('Learn More');
  const [destinationUrl, setDestinationUrl] = useState('https://');
  const [placements, setPlacements] = useState<AdPlacement[]>(['home_feed']);
  const [categoryTag, setCategoryTag] = useState<string>('Business');
  const [selectedDistricts, setSelectedDistricts] = useState<string[]>(['All Districts']);
  const [language, setLanguage] = useState('English & Bengali');
  const [selectedInterests, setSelectedInterests] = useState<DiscoveryCategory[]>(['Technology', 'Business']);
  const [dailyBudget, setDailyBudget] = useState('15');
  const [totalBudget, setTotalBudget] = useState('150');
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const [creativeFile, setCreativeFile] = useState<File | null>(null);
  const [creativePreviewUrl, setCreativePreviewUrl] = useState('');
  const [selectedCreativeId, setSelectedCreativeId] = useState('');
  const [minorSafeAttested, setMinorSafeAttested] = useState(false);

  // Advertiser Billing Profile & Deposit Form
  const [bizName, setBizName] = useState('');
  const [bizEmail, setBizEmail] = useState('');
  const [bizWebsite, setBizWebsite] = useState('');
  const [bizCountry, setBizCountry] = useState('Bangladesh');
  const [depositAmountUsd, setDepositAmountUsd] = useState('50');
  const [depositMethod, setDepositMethod] = useState<'bkash' | 'nagad' | 'bank_transfer'>('bkash');
  const [depositTxRef, setDepositTxRef] = useState('');
  const [depositSender, setDepositSender] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadAdsData = async () => {
    if (!firebaseUser) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [settingsRes, advRes, campRes, creatRes, impRes, clkRes, payRes] = await Promise.all([
        fetchAdvertisingSettings(),
        fetchOrCreateAdvertiserAccount({
          uid: firebaseUser.uid,
          email: firebaseUser.email || '',
          displayName: profile?.displayName || firebaseUser.displayName || 'BANA Advertiser',
        }),
        getDocsWithIndexFallback<AdCampaign>(
          query(
            collection(db, 'adCampaigns'),
            where('advertiserId', '==', firebaseUser.uid),
            orderBy('createdAt', 'desc')
          ),
          query(collection(db, 'adCampaigns'), where('advertiserId', '==', firebaseUser.uid)),
          sortByCreatedAtDesc
        ),
        getDocsWithIndexFallback<AdCreativeItem>(
          query(
            collection(db, 'adCreatives'),
            where('advertiserId', '==', firebaseUser.uid),
            orderBy('createdAt', 'desc')
          ),
          query(collection(db, 'adCreatives'), where('advertiserId', '==', firebaseUser.uid)),
          sortByCreatedAtDesc
        ).catch(() => null),
        getDocsWithIndexFallback<AdImpressionRecord>(
          query(
            collection(db, 'adImpressions'),
            where('advertiserId', '==', firebaseUser.uid),
            orderBy('createdAt', 'desc'),
            limit(200)
          ),
          query(collection(db, 'adImpressions'), where('advertiserId', '==', firebaseUser.uid), limit(200)),
          sortByCreatedAtDesc
        ).catch(() => null),
        getDocsWithIndexFallback<AdClickRecord>(
          query(
            collection(db, 'adClicks'),
            where('advertiserId', '==', firebaseUser.uid),
            orderBy('createdAt', 'desc'),
            limit(200)
          ),
          query(collection(db, 'adClicks'), where('advertiserId', '==', firebaseUser.uid), limit(200)),
          sortByCreatedAtDesc
        ).catch(() => null),
        getDocsWithIndexFallback<AdPaymentRecord>(
          query(
            collection(db, 'adPayments'),
            where('advertiserId', '==', firebaseUser.uid),
            orderBy('createdAt', 'desc')
          ),
          query(collection(db, 'adPayments'), where('advertiserId', '==', firebaseUser.uid)),
          sortByCreatedAtDesc
        ).catch(() => null),
      ]);

      setAdSettings(settingsRes);
      setAdvertiser(advRes);
      setBizName(advRes.businessName || '');
      setBizEmail(advRes.contactEmail || firebaseUser.email || '');
      setBizWebsite(advRes.website || '');
      setBizCountry(advRes.country || 'Bangladesh');

      setCampaigns(campRes.items);
      if (creatRes) setCreatives(creatRes.items);
      if (impRes) setImpressions(impRes.items);
      if (clkRes) setClicks(clkRes.items);
      if (payRes) setPayments(payRes.items);
    } catch (err) {
      logFirestoreError(err, OperationType.LIST, 'adCampaigns');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAdsData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser?.uid]);

  const stats = useMemo(
    () => computeCampaignAnalytics(campaigns, impressions, clicks),
    [campaigns, impressions, clicks]
  );

  if (!firebaseUser) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
          <h1 className="font-display font-bold text-xl">BANA Advertisement Manager</h1>
          <p className="text-sm text-neutral-500">
            Sign in to create self-service sponsored posts, Reels, and Marketplace promotions on BANA.
          </p>
          <button
            type="button"
            onClick={() => openAuthModal('Sign in to open BANA Advertisement Manager.')}
            className="px-5 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold"
          >
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  const togglePlacement = (p: AdPlacement) => {
    setPlacements((prev) =>
      prev.includes(p) ? (prev.length > 1 ? prev.filter((x) => x !== p) : prev) : [...prev, p]
    );
  };

  const toggleInterest = (cat: DiscoveryCategory) => {
    setSelectedInterests((prev) => (prev.includes(cat) ? prev.filter((x) => x !== cat) : [...prev, cat]));
  };

  const toggleDistrict = (d: string) => {
    if (d === 'All Districts') {
      setSelectedDistricts(['All Districts']);
      return;
    }
    setSelectedDistricts((prev) => {
      const cleaned = prev.filter((x) => x !== 'All Districts');
      const next = cleaned.includes(d) ? cleaned.filter((x) => x !== d) : [...cleaned, d];
      return next.length > 0 ? next : ['All Districts'];
    });
  };

  const handleFileChange = (file: File | null) => {
    setCreativeFile(file);
    setSelectedCreativeId('');
    if (file) {
      setCreativePreviewUrl(URL.createObjectURL(file));
    } else {
      setCreativePreviewUrl('');
    }
  };

  const handleSubmitCampaign = async (e: React.FormEvent, asDraft = false) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (!minorSafeAttested) {
      setError('You must attest to BANA Advertising Safety & Minor-Protection guidelines.');
      return;
    }
    if (advertiser?.status === 'suspended' || advertiser?.status === 'restricted') {
      setError('Your advertiser account is currently restricted. Contact Finance/Admin support.');
      return;
    }
    const daily = Number(dailyBudget);
    const total = Number(totalBudget);
    if (daily < (adSettings.minDailyBudgetUsd || 5) || total < (adSettings.minTotalBudgetUsd || 10)) {
      setError(
        `Minimum budget requirements: $${adSettings.minDailyBudgetUsd || 5}/day and $${adSettings.minTotalBudgetUsd || 10} total.`
      );
      return;
    }
    if (total < daily) {
      setError('Total budget must be greater than or equal to the daily budget.');
      return;
    }

    setSubmitting(true);
    try {
      let creativeUrl = '';
      let creativeType: 'image' | 'video' = campaignType === 'sponsored_reel' || campaignType === 'sponsored_video' ? 'video' : 'image';
      let creativeId = selectedCreativeId;

      if (creativeFile) {
        creativeType = creativeFile.type.startsWith('video/') ? 'video' : 'image';
        const processed = creativeType === 'image' ? await compressImageFile(creativeFile, 1400) : creativeFile;
        creativeUrl = await uploadMediaWithProgress(
          `ads/${firebaseUser.uid}/ad_${Date.now()}_${processed.name}`,
          processed
        );

        const creatRef = await addDoc(collection(db, 'adCreatives'), {
          advertiserId: firebaseUser.uid,
          title: campaignName.trim(),
          headline: headline.trim(),
          bodyText: bodyText.trim(),
          ctaLabel: ctaLabel.trim() || 'Learn More',
          mediaUrl: creativeUrl,
          mediaType: creativeType,
          destinationUrl: destinationUrl.trim(),
          approvalStatus: 'pending',
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        creativeId = creatRef.id;
      } else if (selectedCreativeId) {
        const matched = creatives.find((cr) => cr.id === selectedCreativeId);
        if (matched) {
          creativeUrl = matched.mediaUrl;
          creativeType = matched.mediaType;
        }
      }

      await addDoc(collection(db, 'adCampaigns'), {
        advertiserId: firebaseUser.uid,
        advertiserName: advertiser?.businessName || profile?.displayName || 'BANA Advertiser',
        campaignName: campaignName.trim(),
        campaignType,
        objective,
        headline: headline.trim(),
        bodyText: bodyText.trim(),
        ctaLabel: ctaLabel.trim() || 'Learn More',
        creativeUrl,
        creativeType,
        creativeId: creativeId || '',
        destinationUrl: destinationUrl.trim(),
        placements,
        categoryTag,
        targeting: {
          districts: selectedDistricts,
          language,
          minAge: 18,
          interests: selectedInterests,
          categories: [categoryTag],
          minorExcluded: true,
        },
        dailyBudgetUsd: daily,
        totalBudgetUsd: total,
        startDate,
        endDate,
        status: asDraft ? 'draft' : 'pending_review',
        impressions: 0,
        reachCount: 0,
        clicks: 0,
        spentUsd: 0,
        minorSafeAttested: true,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      setMsg(
        asDraft
          ? 'Campaign saved as Draft.'
          : 'Campaign submitted for human Admin review before delivery.'
      );
      setCampaignName('');
      setHeadline('');
      setBodyText('');
      setCreativeFile(null);
      setCreativePreviewUrl('');
      await loadAdsData();
      setActiveTab('campaigns');
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleCampaignAction = async (
    camp: AdCampaign,
    nextStatus: 'paused' | 'active' | 'terminated' | 'pending_review'
  ) => {
    setError(null);
    try {
      const payload: Record<string, any> = {
        status: nextStatus,
        updatedAt: serverTimestamp(),
      };
      if (nextStatus === 'terminated') {
        payload.terminatedAt = serverTimestamp();
      }
      await updateDoc(doc(db, 'adCampaigns', camp.id), payload);
      setMsg(`Campaign "${camp.campaignName}" updated to ${nextStatus.replace('_', ' ')}.`);
      await loadAdsData();
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    }
  };

  const handleUpdateAdvertiserProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    setSubmitting(true);
    try {
      await updateDoc(doc(db, 'advertisers', firebaseUser.uid), {
        businessName: bizName.trim(),
        contactEmail: bizEmail.trim(),
        website: bizWebsite.trim(),
        country: bizCountry.trim(),
        updatedAt: serverTimestamp(),
      });
      setMsg('Advertiser business profile updated.');
      await loadAdsData();
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleSubmitAdDeposit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    const amt = Number(depositAmountUsd);
    if (!amt || amt < 5) {
      setError('Minimum advertiser billing deposit is $5.00 USD.');
      return;
    }
    if (depositTxRef.trim().length < 4) {
      setError('Enter a valid transaction reference ID from bKash, Nagad, or Bank Transfer.');
      return;
    }
    setSubmitting(true);
    try {
      await addDoc(collection(db, 'adPayments'), {
        advertiserId: firebaseUser.uid,
        amountUsd: Number(amt.toFixed(2)),
        currency: 'USD',
        method: depositMethod,
        transactionRef: depositTxRef.trim(),
        senderAccount: depositSender.trim(),
        providerVerified: false,
        status: 'awaiting_verification',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setDepositTxRef('');
      setDepositSender('');
      setMsg(
        `Billing deposit of $${amt.toFixed(2)} submitted for Finance verification. Wallet balance updates once verified by BANA Admin.`
      );
      await loadAdsData();
      setActiveTab('payments');
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const filteredCampaigns = campaigns.filter((c) => {
    const matchesStatus = campaignFilter === 'all' || c.status === campaignFilter;
    const matchesSearch =
      !campaignSearch.trim() ||
      c.campaignName.toLowerCase().includes(campaignSearch.toLowerCase()) ||
      c.headline.toLowerCase().includes(campaignSearch.toLowerCase());
    return matchesStatus && matchesSearch;
  });

  const livePreviewCampaign: AdCampaign = {
    id: 'preview_campaign',
    advertiserId: firebaseUser.uid,
    advertiserName: bizName || profile?.displayName || 'Your Business',
    campaignName: campaignName || 'Campaign Preview',
    campaignType,
    objective,
    headline: headline || 'Your Sponsored Headline Appears Here',
    bodyText: bodyText || 'Describe your offer clearly without misleading claims. Click below to learn more.',
    ctaLabel: ctaLabel || 'Learn More',
    creativeUrl:
      creativePreviewUrl ||
      creatives.find((c) => c.id === selectedCreativeId)?.mediaUrl ||
      '',
    creativeType:
      creativeFile?.type.startsWith('video/') ||
      campaignType === 'sponsored_reel' ||
      campaignType === 'sponsored_video'
        ? 'video'
        : 'image',
    destinationUrl: destinationUrl || 'https://bana.social',
    categoryTag,
    dailyBudgetUsd: Number(dailyBudget || 15),
    totalBudgetUsd: Number(totalBudget || 150),
    startDate,
    endDate,
    status: 'active',
    impressions: 0,
    clicks: 0,
    spentUsd: 0,
    minorSafeAttested: true,
  };

  const maxDailyImp = Math.max(10, ...stats.dailySeries.map((d) => d.impressions));

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top Bar */}
        <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#1877F2]">BANA Ads Manager</p>
            <h1 className="font-display font-extrabold text-2xl mt-0.5 text-neutral-950 dark:text-white">
              Self-Service Advertisement Platform
            </h1>
            <p className="text-xs text-neutral-500 mt-1">
              Every campaign undergoes human policy review before delivery. Minors are strictly excluded and no sensitive PII is used for targeting.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="text-right font-mono tabular-nums text-xs pr-3 border-r border-neutral-200 dark:border-neutral-800">
              <p className="text-neutral-500">Ad Wallet Balance</p>
              <p className="font-bold text-base text-emerald-600">
                ${Number(advertiser?.walletBalanceUsd || 0).toFixed(2)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setActiveTab('create')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold"
            >
              <Plus className="w-4 h-4" /> Create Campaign
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <nav className="flex items-center gap-1.5 overflow-x-auto pb-1 border-b border-neutral-200 dark:border-neutral-800">
          {ADS_TABS.map((t) => {
            const Icon = t.icon;
            const active = activeTab === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveTab(t.id)}
                className={`inline-flex items-center gap-1.5 px-3 py-2.5 text-xs font-semibold whitespace-nowrap border-b-2 transition-colors ${
                  active
                    ? 'border-[#1877F2] text-[#1877F2]'
                    : 'border-transparent text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                {t.label}
              </button>
            );
          })}
        </nav>

        {!CLOUD_FUNCTIONS_ENABLED && (
          <div className="rounded-[12px] border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2.5">
            <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
            <span>
              <strong>Spark Free Plan Mode:</strong> Instant payment gateway webhooks and automated CPM wallet deductions require Firebase Blaze Cloud Functions. Campaign creation, manual bKash/Nagad/Bank billing deposits, admin policy review, and delivery analytics remain active.
            </span>
          </div>
        )}

        {msg && (
          <div className="rounded-[12px] border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-3.5 text-xs text-emerald-700 dark:text-emerald-300">
            {msg}
          </div>
        )}
        {error && (
          <div className="rounded-[12px] border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3.5 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}

        {/* KPI Row on Overview & Performance */}
        {(activeTab === 'overview' || activeTab === 'performance') && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { label: 'Active Campaigns', val: String(stats.activeCount) },
              { label: 'Pending Review', val: String(stats.pendingCount) },
              { label: 'Verified Impressions', val: stats.totalImpressions.toLocaleString() },
              { label: 'Recorded Unique Reach', val: stats.totalReach > 0 ? stats.totalReach.toLocaleString() : '—' },
              { label: 'Clicks · CTR', val: `${stats.totalClicks} · ${stats.ctrPct}%` },
              { label: 'Verified Spend', val: `$${stats.totalSpendUsd.toFixed(2)}` },
            ].map((k) => (
              <div
                key={k.label}
                className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4"
              >
                <p className="text-xs text-neutral-500">{k.label}</p>
                <p className="font-mono font-bold text-xl mt-1 tabular-nums text-neutral-950 dark:text-white">
                  {k.val}
                </p>
              </div>
            ))}
          </div>
        )}
        {(activeTab === 'overview' || activeTab === 'performance') && (
          <p className="text-[11px] text-neutral-500">
            All figures above are recorded delivery events from BANA&apos;s servers (impressions, clicks, spend).
            Nothing here is estimated or projected. A dash means no data has been recorded yet.
          </p>
        )}

        {/* OVERVIEW */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/60 p-4 flex items-start gap-3 text-xs text-neutral-600 dark:text-neutral-300">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p>
                <strong>BANA Ad Safety Policy:</strong> Prohibited categories ({adSettings.blockedCategories.length > 0 ? adSettings.blockedCategories.join(', ') : 'weapons, tobacco, counterfeits, misleading financial schemes'}) are rejected. Ads run at platform pricing (${adSettings.defaultCpmUsd.toFixed(2)} CPM / ${adSettings.defaultCpcUsd.toFixed(2)} CPC) with session frequency caps of {adSettings.frequencyCapPerSession} impressions.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              <section className="lg:col-span-7 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="font-display font-bold text-base">Recent Campaigns</h2>
                  <button
                    type="button"
                    onClick={() => setActiveTab('campaigns')}
                    className="text-xs font-semibold text-[#1877F2] hover:underline"
                  >
                    Manage All ({campaigns.length})
                  </button>
                </div>
                {loading ? (
                  <p className="text-xs text-neutral-500">Loading campaigns...</p>
                ) : campaigns.length === 0 ? (
                  <div className="py-10 text-center space-y-2">
                    <Megaphone className="w-7 h-7 mx-auto text-neutral-400" />
                    <p className="text-xs text-neutral-500">Create your first sponsored campaign to reach BANA users.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {campaigns.slice(0, 5).map((c) => (
                      <div key={c.id} className="py-3 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0">
                          <p className="font-semibold truncate text-neutral-950 dark:text-white">
                            {c.campaignName}{' '}
                            <span className="font-mono font-normal text-[#1877F2]">
                              · {c.status.replace('_', ' ')}
                            </span>
                          </p>
                          <p className="text-[11px] text-neutral-500 truncate">
                            {c.headline} · {(c.placements || ['home_feed']).join(', ')}
                          </p>
                        </div>
                        <div className="text-right font-mono tabular-nums shrink-0">
                          <p>{c.impressions || 0} imp · {c.clicks || 0} clk</p>
                          <p className="text-neutral-500">${Number(c.spentUsd || 0).toFixed(2)} / ${c.totalBudgetUsd}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="lg:col-span-5 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
                <h2 className="font-display font-bold text-base">Advertiser Account Summary</h2>
                <div className="space-y-2 text-xs">
                  <div className="flex justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
                    <span className="text-neutral-500">Business Name</span>
                    <span className="font-semibold">{advertiser?.businessName || 'Unset'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
                    <span className="text-neutral-500">Account Standing</span>
                    <span className="font-mono uppercase text-emerald-600">{advertiser?.status || 'active'}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
                    <span className="text-neutral-500">Lifetime Deposits</span>
                    <span className="font-mono tabular-nums">${Number(advertiser?.lifetimeDepositUsd || 0).toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between py-1.5 border-b border-neutral-100 dark:border-neutral-800">
                    <span className="text-neutral-500">Lifetime Spend</span>
                    <span className="font-mono tabular-nums">${Number(advertiser?.lifetimeSpendUsd || 0).toFixed(2)}</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('billing')}
                  className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  Top Up Wallet & Billing Settings
                </button>
              </section>
            </div>
          </div>
        )}

        {/* CREATE CAMPAIGN BUILDER + LIVE PREVIEW */}
        {activeTab === 'create' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            <form
              onSubmit={(e) => handleSubmitCampaign(e, false)}
              className="lg:col-span-7 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4"
            >
              <h2 className="font-display font-bold text-lg">Build Sponsored Campaign</h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-neutral-500 block mb-1">Campaign Format</label>
                  <select
                    value={campaignType}
                    onChange={(e) => setCampaignType(e.target.value as AdCampaignType)}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                  >
                    <option value="sponsored_post">Sponsored Feed Post</option>
                    <option value="sponsored_reel">Sponsored Reel</option>
                    <option value="sponsored_video">Sponsored Video</option>
                    <option value="marketplace_promo">Marketplace Promotion</option>
                  </select>
                </div>
                <div>
                  <label className="text-[11px] text-neutral-500 block mb-1">Campaign Objective</label>
                  <select
                    value={objective}
                    onChange={(e) => setObjective(e.target.value as AdObjective)}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                  >
                    <option value="reach">Brand Reach</option>
                    <option value="traffic">Website / Store Traffic</option>
                    <option value="engagement">Post & Video Engagement</option>
                    <option value="catalog_sales">Marketplace Sales</option>
                  </select>
                </div>
              </div>

              <input
                type="text"
                required
                minLength={3}
                value={campaignName}
                onChange={(e) => setCampaignName(e.target.value)}
                placeholder="Internal Campaign Name"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-sm"
              />
              <input
                type="text"
                required
                value={headline}
                onChange={(e) => setHeadline(e.target.value)}
                placeholder="Public Ad Headline"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-sm"
              />
              <textarea
                rows={3}
                required
                value={bodyText}
                onChange={(e) => setBodyText(e.target.value)}
                placeholder="Primary Ad Copy"
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-sm"
              />

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <input
                  type="url"
                  required
                  value={destinationUrl}
                  onChange={(e) => setDestinationUrl(e.target.value)}
                  placeholder="Destination URL (https://...)"
                  className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                />
                <select
                  value={ctaLabel}
                  onChange={(e) => setCtaLabel(e.target.value)}
                  className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                >
                  <option value="Learn More">CTA: Learn More</option>
                  <option value="Shop Now">CTA: Shop Now</option>
                  <option value="Visit Store">CTA: Visit Store</option>
                  <option value="Watch Video">CTA: Watch Video</option>
                  <option value="Sign Up">CTA: Sign Up</option>
                </select>
              </div>

              {/* Placements */}
              <div>
                <p className="text-[11px] font-semibold text-neutral-500 mb-1.5">Ad Placements</p>
                <div className="flex flex-wrap gap-3 text-xs">
                  {(
                    [
                      { id: 'home_feed', label: 'Home Feed' },
                      { id: 'reels_feed', label: 'Reels Feed' },
                      { id: 'marketplace', label: 'Marketplace' },
                    ] as const
                  ).map((pl) => (
                    <label key={pl.id} className="inline-flex items-center gap-1.5">
                      <input
                        type="checkbox"
                        checked={placements.includes(pl.id)}
                        onChange={() => togglePlacement(pl.id)}
                      />
                      <span>{pl.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Audience Targeting (Non-PII, Adult-only) */}
              <div className="border-t border-neutral-100 dark:border-neutral-800 pt-3 space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold">Privacy-Safe Audience Targeting</p>
                  <span className="text-[11px] font-mono text-emerald-600">Age 18+ Mandatory · Minors Excluded</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] text-neutral-500 block mb-1">Ad Category</label>
                    <select
                      value={categoryTag}
                      onChange={(e) => setCategoryTag(e.target.value)}
                      className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                    >
                      {MARKET_CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-[11px] text-neutral-500 block mb-1">Preferred Language</label>
                    <input
                      type="text"
                      value={language}
                      onChange={(e) => setLanguage(e.target.value)}
                      className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                    />
                  </div>
                </div>

                <div>
                  <p className="text-[11px] text-neutral-500 mb-1">Regional Districts (Non-precise location)</p>
                  <div className="flex flex-wrap gap-1.5">
                    {BANGLADESH_DISTRICTS.slice(0, 10).map((d) => {
                      const active = selectedDistricts.includes(d);
                      return (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDistrict(d)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] ${
                            active
                              ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2] font-semibold'
                              : 'border-neutral-200 dark:border-neutral-800 text-neutral-500'
                          }`}
                        >
                          {d}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <p className="text-[11px] text-neutral-500 mb-1">Contextual Interests</p>
                  <div className="flex flex-wrap gap-1.5">
                    {DISCOVERY_CATEGORIES.map((cat) => {
                      const active = selectedInterests.includes(cat);
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => toggleInterest(cat)}
                          className={`px-2.5 py-1 rounded-lg border text-[11px] ${
                            active
                              ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2] font-semibold'
                              : 'border-neutral-200 dark:border-neutral-800 text-neutral-500'
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Budget & Schedule */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 border-t border-neutral-100 dark:border-neutral-800 pt-3">
                <div>
                  <label className="text-[11px] text-neutral-500">Daily (USD)</label>
                  <input
                    type="number"
                    min={adSettings.minDailyBudgetUsd || 5}
                    required
                    value={dailyBudget}
                    onChange={(e) => setDailyBudget(e.target.value)}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-500">Total (USD)</label>
                  <input
                    type="number"
                    min={adSettings.minTotalBudgetUsd || 10}
                    required
                    value={totalBudget}
                    onChange={(e) => setTotalBudget(e.target.value)}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-500">Start Date</label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-500">End Date</label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs font-mono"
                  />
                </div>
              </div>

              {/* Creative Upload or Reuse */}
              <div className="space-y-2 border-t border-neutral-100 dark:border-neutral-800 pt-3">
                <label className="block text-xs font-semibold">Upload Image / Video Creative</label>
                <input
                  type="file"
                  accept="image/*,video/mp4,video/webm"
                  onChange={(e) => handleFileChange(e.target.files?.[0] || null)}
                  className="text-xs"
                />
                {creatives.length > 0 && (
                  <select
                    value={selectedCreativeId}
                    onChange={(e) => {
                      setSelectedCreativeId(e.target.value);
                      setCreativeFile(null);
                      setCreativePreviewUrl('');
                    }}
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                  >
                    <option value="">Or reuse an existing creative from your library...</option>
                    {creatives.map((cr) => (
                      <option key={cr.id} value={cr.id}>
                        {cr.title || cr.headline} ({cr.approvalStatus})
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <label className="flex items-start gap-2 text-xs text-neutral-600 dark:text-neutral-300">
                <input
                  type="checkbox"
                  checked={minorSafeAttested}
                  onChange={(e) => setMinorSafeAttested(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  I confirm this campaign complies with BANA Advertising Policies, excludes prohibited goods, and never targets minors or sensitive personal attributes.
                </span>
              </label>

              <div className="flex flex-wrap justify-end gap-2 pt-2">
                <button
                  type="button"
                  disabled={submitting}
                  onClick={(e) => handleSubmitCampaign(e, true)}
                  className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold"
                >
                  Save as Draft
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50"
                >
                  {submitting ? 'Submitting...' : 'Submit for Admin Approval'}
                </button>
              </div>
            </form>

            {/* Live Preview Pane */}
            <aside className="lg:col-span-5 space-y-3 sticky top-20">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-neutral-500">Live Sponsored Ad Preview</span>
                <span className="font-mono text-[#1877F2]">{placements[0] || 'home_feed'}</span>
              </div>
              <SponsoredAdCard
                campaign={livePreviewCampaign}
                placement={placements[0] || 'home_feed'}
                variant={placements[0] === 'marketplace' ? 'marketplace' : 'feed'}
              />
            </aside>
          </div>
        )}

        {/* MY CAMPAIGNS */}
        {activeTab === 'campaigns' && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="relative flex-1 min-w-[220px] max-w-sm">
                <Search className="w-3.5 h-3.5 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={campaignSearch}
                  onChange={(e) => setCampaignSearch(e.target.value)}
                  placeholder="Search campaigns..."
                  className="w-full h-9 pl-9 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs"
                />
              </div>
              <select
                value={campaignFilter}
                onChange={(e) => setCampaignFilter(e.target.value)}
                className="h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                <option value="all">All Statuses</option>
                <option value="active">Active</option>
                <option value="pending_review">Pending Review</option>
                <option value="paused">Paused</option>
                <option value="draft">Draft</option>
                <option value="rejected">Rejected</option>
                <option value="completed">Completed</option>
                <option value="terminated">Terminated</option>
              </select>
            </div>

            {filteredCampaigns.length === 0 ? (
              <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-10 text-center text-xs text-neutral-500">
                No campaigns match your filters.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredCampaigns.map((c) => {
                  const pctSpent =
                    c.totalBudgetUsd > 0
                      ? Math.min(100, Math.round((Number(c.spentUsd || 0) / c.totalBudgetUsd) * 100))
                      : 0;
                  return (
                    <div
                      key={c.id}
                      className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex flex-col md:flex-row gap-4 justify-between"
                    >
                      <div className="flex gap-4 min-w-0">
                        {c.creativeUrl && (
                          <ResilientImage
                            src={c.creativeUrl}
                            alt={c.campaignName}
                            className="h-20 w-28 rounded-xl object-cover shrink-0"
                          />
                        )}
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <h3 className="font-display font-bold text-base truncate">{c.campaignName}</h3>
                            <span className="text-xs font-mono capitalize text-[#1877F2]">
                              · {c.status.replace('_', ' ')}
                            </span>
                            {c.campaignType && (
                              <span className="text-[11px] font-mono text-neutral-500">
                                · {c.campaignType.replace('_', ' ')}
                              </span>
                            )}
                          </div>
                          <p className="text-xs font-medium">{c.headline}</p>
                          <p className="text-[11px] text-neutral-500 font-mono tabular-nums">
                            ${c.dailyBudgetUsd}/day · ${Number(c.spentUsd || 0).toFixed(2)} / ${c.totalBudgetUsd} ({pctSpent}%) ·{' '}
                            {c.startDate} → {c.endDate}
                          </p>
                          <a
                            href={c.destinationUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:underline"
                          >
                            {c.destinationUrl} <ExternalLink className="w-3 h-3" />
                          </a>
                          {c.rejectionReason && (
                            <p className="text-xs text-red-600">Rejection Reason: {c.rejectionReason}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex md:flex-col items-end justify-between gap-2 shrink-0">
                        <div className="text-right font-mono text-xs tabular-nums space-y-0.5">
                          <p>{c.impressions || 0} impressions</p>
                          <p>{c.clicks || 0} clicks</p>
                          <p className="text-neutral-500">
                            CTR:{' '}
                            {c.impressions > 0 ? (((c.clicks || 0) / c.impressions) * 100).toFixed(2) : '0.00'}%
                          </p>
                        </div>

                        <div className="flex flex-wrap gap-1.5">
                          {(c.status === 'active' || c.status === 'paused') && (
                            <button
                              type="button"
                              onClick={() => handleCampaignAction(c, c.status === 'active' ? 'paused' : 'active')}
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 text-xs font-medium"
                            >
                              {c.status === 'active' ? <Pause className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                              {c.status === 'active' ? 'Pause' : 'Resume'}
                            </button>
                          )}
                          {(c.status === 'draft' || c.status === 'rejected') && (
                            <button
                              type="button"
                              onClick={() => handleCampaignAction(c, 'pending_review')}
                              className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-semibold"
                            >
                              Submit for Review
                            </button>
                          )}
                          {(c.status === 'active' || c.status === 'paused') && (
                            <button
                              type="button"
                              onClick={() => handleCampaignAction(c, 'terminated')}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 text-xs"
                            >
                              <Trash2 className="w-3.5 h-3.5" /> End
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* AD CREATIVES */}
        {activeTab === 'creatives' && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-base">Ad Creative Assets & Moderation Status</h2>
              <button
                type="button"
                onClick={() => setActiveTab('create')}
                className="text-xs font-semibold text-[#1877F2] hover:underline"
              >
                + Upload via Campaign Builder
              </button>
            </div>
            {creatives.length === 0 ? (
              <p className="text-xs text-neutral-500 py-8 text-center">
                No standalone creative library assets uploaded yet. Creatives uploaded during campaign creation appear here.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {creatives.map((cr) => (
                  <div
                    key={cr.id}
                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 overflow-hidden bg-neutral-50 dark:bg-neutral-950"
                  >
                    {cr.mediaUrl && (
                      <ResilientImage src={cr.mediaUrl} alt={cr.headline} className="w-full h-36 object-cover" />
                    )}
                    <div className="p-3 space-y-1 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold truncate">{cr.title || cr.headline}</span>
                        <span
                          className={`font-mono text-[11px] capitalize ${
                            cr.approvalStatus === 'approved'
                              ? 'text-emerald-600'
                              : cr.approvalStatus === 'rejected'
                              ? 'text-red-600'
                              : 'text-amber-600'
                          }`}
                        >
                          {cr.approvalStatus}
                        </span>
                      </div>
                      <p className="text-neutral-500 line-clamp-2">{cr.bodyText}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* AUDIENCE */}
        {activeTab === 'audience' && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
            <div className="flex items-start gap-3 text-xs">
              <ShieldCheck className="w-5 h-5 text-emerald-600 shrink-0" />
              <div>
                <h2 className="font-display font-bold text-base">Privacy-First Audience Safeguards</h2>
                <p className="text-neutral-500 mt-0.5">
                  BANA Ads Manager only supports coarse regional districts, preferred language, and contextual topic interests for 18+ adult accounts. Private messages, precise GPS, health/financial PII, and minor accounts are never exposed or targeted.
                </p>
              </div>
            </div>
            <div className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {campaigns.map((c) => (
                <div key={c.id} className="py-3 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <p className="font-semibold">{c.campaignName}</p>
                    <p className="text-neutral-500">
                      Regions: {(c.targeting?.districts || ['All Districts']).join(', ')} · Interests:{' '}
                      {(c.targeting?.interests || []).join(', ') || 'General'}
                    </p>
                  </div>
                  <span className="font-mono text-[11px] text-emerald-600">Age 18+ · Minor Excluded</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BUDGET */}
        {activeTab === 'budget' && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display font-bold text-base">Budget Pacing & Utilization</h2>
              <span className="font-mono text-xs tabular-nums text-neutral-500">
                Total Committed: ${stats.totalBudgetUsd.toFixed(2)} · Total Spent: ${stats.totalSpendUsd.toFixed(2)}
              </span>
            </div>
            <div className="space-y-4">
              {campaigns.map((c) => {
                const pct =
                  c.totalBudgetUsd > 0
                    ? Math.min(100, Math.round((Number(c.spentUsd || 0) / c.totalBudgetUsd) * 100))
                    : 0;
                return (
                  <div key={c.id} className="space-y-1.5 text-xs">
                    <div className="flex justify-between font-mono tabular-nums">
                      <span className="font-sans font-semibold">{c.campaignName}</span>
                      <span>
                        ${Number(c.spentUsd || 0).toFixed(2)} / ${c.totalBudgetUsd.toFixed(2)} ({pct}%)
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-neutral-100 dark:bg-neutral-800 overflow-hidden">
                      <div className="h-full bg-[#1877F2]" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PERFORMANCE */}
        {activeTab === 'performance' && (
          <div className="space-y-6">
            <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
              <h2 className="font-display font-bold text-base">Daily Impression & Click Trend</h2>
              {stats.dailySeries.length === 0 ? (
                <p className="text-xs text-neutral-500 py-8 text-center">
                  No verified ad impression or click events logged yet.
                </p>
              ) : (
                <div className="h-44 flex items-end gap-3 pt-4 border-t border-neutral-100 dark:border-neutral-800">
                  {stats.dailySeries.map((day) => (
                    <div key={day.date} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <span className="text-[10px] font-mono tabular-nums text-neutral-500">
                        {day.impressions}
                      </span>
                      <div
                        className="w-full max-w-[32px] rounded-t-md bg-[#1877F2]"
                        style={{ height: `${Math.max(8, Math.round((day.impressions / maxDailyImp) * 100))}%` }}
                      />
                      <span className="text-[10px] font-mono text-neutral-500">{day.date.slice(5)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* BILLING & TOP-UP */}
        {activeTab === 'billing' && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <form
              onSubmit={handleUpdateAdvertiserProfile}
              className="lg:col-span-6 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3.5"
            >
              <h2 className="font-display font-bold text-base">Advertiser Billing Profile</h2>
              <input
                type="text"
                required
                value={bizName}
                onChange={(e) => setBizName(e.target.value)}
                placeholder="Business / Brand Name"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
              <input
                type="email"
                required
                value={bizEmail}
                onChange={(e) => setBizEmail(e.target.value)}
                placeholder="Billing Contact Email"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
              <input
                type="url"
                value={bizWebsite}
                onChange={(e) => setBizWebsite(e.target.value)}
                placeholder="Business Website (optional)"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
              <input
                type="text"
                required
                value={bizCountry}
                onChange={(e) => setBizCountry(e.target.value)}
                placeholder="Billing Country"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
              <button
                type="submit"
                disabled={submitting}
                className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Save Business Details
              </button>
            </form>

            <form
              onSubmit={handleSubmitAdDeposit}
              className="lg:col-span-6 rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3.5"
            >
              <div>
                <h2 className="font-display font-bold text-base">Submit Ad Wallet Billing Deposit</h2>
                <p className="text-xs text-neutral-500 mt-0.5">
                  Instant external card charges are disabled until gateway keys are configured. Submit verified bKash, Nagad, or Bank Transfer references for Finance verification (no raw card data collected).
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[11px] text-neutral-500 block mb-1">Amount (USD)</label>
                  <input
                    type="number"
                    min={5}
                    step="0.01"
                    required
                    value={depositAmountUsd}
                    onChange={(e) => setDepositAmountUsd(e.target.value)}
                    className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="text-[11px] text-neutral-500 block mb-1">Method</label>
                  <select
                    value={depositMethod}
                    onChange={(e) => setDepositMethod(e.target.value as 'bkash' | 'nagad' | 'bank_transfer')}
                    className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
                  >
                    <option value="bkash">bKash</option>
                    <option value="nagad">Nagad</option>
                    <option value="bank_transfer">Bank Transfer</option>
                  </select>
                </div>
              </div>
              <input
                type="text"
                required
                value={depositTxRef}
                onChange={(e) => setDepositTxRef(e.target.value)}
                placeholder="Transaction Reference / TrxID"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs font-mono"
              />
              <input
                type="text"
                value={depositSender}
                onChange={(e) => setDepositSender(e.target.value)}
                placeholder="Sender Wallet or Bank Account Reference"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs font-mono"
              />
              <button
                type="submit"
                disabled={submitting}
                className="w-full h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50"
              >
                Submit Deposit for Finance Verification
              </button>
            </form>
          </div>
        )}

        {/* PAYMENT HISTORY */}
        {activeTab === 'payments' && (
          <div className="rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
            <h2 className="font-display font-bold text-base">Advertiser Billing & Payment History</h2>
            {payments.length === 0 ? (
              <p className="text-xs text-neutral-500 py-8 text-center">
                No advertiser billing deposits submitted yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-neutral-200 dark:border-neutral-800 text-neutral-500">
                    <tr>
                      <th className="py-2 pr-3 font-medium">Method</th>
                      <th className="py-2 pr-3 font-medium">Transaction Ref</th>
                      <th className="py-2 pr-3 font-medium">Status</th>
                      <th className="py-2 pr-3 font-medium">Date</th>
                      <th className="py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100 dark:divide-neutral-800">
                    {payments.map((p) => (
                      <tr key={p.id}>
                        <td className="py-2.5 pr-3 uppercase font-mono">{p.method.replace('_', ' ')}</td>
                        <td className="py-2.5 pr-3 font-mono">{p.transactionRef}</td>
                        <td className="py-2.5 pr-3 font-mono capitalize">
                          <span
                            className={
                              p.status === 'paid'
                                ? 'text-emerald-600'
                                : p.status === 'failed' || p.status === 'refunded'
                                ? 'text-red-600'
                                : 'text-amber-600'
                            }
                          >
                            {p.status.replace('_', ' ')}
                          </span>
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
        )}
      </div>
    </AppShell>
  );
}
