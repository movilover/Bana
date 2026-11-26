import React, { useEffect, useState } from 'react';
import { X, Zap, ShoppingBag, CheckCircle2, Clock, Users, CreditCard } from 'lucide-react';
import {
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  doc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import type { BoostPackage } from '@/src/types/bana';
import { formatCompactNumber } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';

export const DEFAULT_BOOST_PACKAGES: BoostPackage[] = [
  {
    id: 'starter-boost',
    name: 'Starter Reach Boost',
    packageType: 'boost_post',
    priceBdt: 350,
    priceUsd: 3,
    durationDays: 3,
    estimatedReach: 4500,
    listingSlots: 0,
    description: 'Promote your post or product across Discover feeds for 3 days.',
    isActive: true,
  },
  {
    id: 'pro-boost',
    name: 'Viral Creator & Shop Boost',
    packageType: 'boost_post',
    priceBdt: 950,
    priceUsd: 8,
    durationDays: 7,
    estimatedReach: 16000,
    listingSlots: 0,
    description: 'Priority placement in Smart Discovery and Marketplace highlights for 7 days.',
    isActive: true,
  },
  {
    id: 'seller-5-pack',
    name: 'Seller Plus (5 Extra Posts)',
    packageType: 'marketplace_slot',
    priceBdt: 400,
    priceUsd: 3.5,
    durationDays: 30,
    estimatedReach: 6000,
    listingSlots: 5,
    description: 'Unlock 5 additional Marketplace listings beyond your 3 free posts.',
    isActive: true,
  },
  {
    id: 'seller-unlimited',
    name: 'Merchant Pro (20 Posts + Boost)',
    packageType: 'marketplace_slot',
    priceBdt: 1200,
    priceUsd: 10,
    durationDays: 30,
    estimatedReach: 25000,
    listingSlots: 20,
    description: 'Unlock 20 Marketplace listings with priority seller visibility for 30 days.',
    isActive: true,
  },
];

export function BoostAndPaymentModal({
  isOpen,
  mode,
  targetCollection,
  targetId,
  targetTitle,
  reasonBanner,
  onClose,
  onSubmitted,
}: {
  isOpen: boolean;
  mode: 'boost_post' | 'marketplace_slot';
  targetCollection?: 'posts' | 'marketplaceListings';
  targetId?: string;
  targetTitle?: string;
  reasonBanner?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const { firebaseUser, profile } = useAuth();
  const [packages, setPackages] = useState<BoostPackage[]>([]);
  const [selectedPkgId, setSelectedPkgId] = useState<string>('');
  const [paymentMethod, setPaymentMethod] = useState<'bKash' | 'Nagad' | 'Bank Transfer'>('bKash');
  const [senderNumber, setSenderNumber] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [gateways, setGateways] = useState({
    bKashNumber: '01700-000000 (Merchant)',
    nagadNumber: '01800-000000 (Merchant)',
    bankDetails: 'BANA Digital Ltd · A/C 1204-889910-001 (Dhaka Bank)',
  });
  const [submitting, setSubmitting] = useState(false);
  const [submittedOk, setSubmittedOk] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSubmittedOk(false);
    setError(null);
    setSenderNumber('');
    setTransactionId('');

    Promise.all([
      getDocs(query(collection(db, 'boostPackages'), where('isActive', '==', true))).catch(() => null),
      getDoc(doc(db, 'adminSettings', 'paymentGateways')).catch(() => null),
    ]).then(([pkgSnap, gwSnap]) => {
      let list: BoostPackage[] = [];
      if (pkgSnap && !pkgSnap.empty) {
        list = pkgSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BoostPackage, 'id'>) }));
      } else {
        list = DEFAULT_BOOST_PACKAGES;
      }
      const modeFiltered = list.filter((p) => p.packageType === mode);
      const finalList = modeFiltered.length > 0 ? modeFiltered : list;
      setPackages(finalList);
      if (finalList.length > 0) setSelectedPkgId(finalList[0].id);

      if (gwSnap?.exists()) {
        const d = gwSnap.data();
        setGateways({
          bKashNumber: d.bKashNumber || '01700-000000 (Merchant)',
          nagadNumber: d.nagadNumber || '01800-000000 (Merchant)',
          bankDetails: d.bankDetails || 'BANA Digital Ltd · A/C 1204-889910-001 (Dhaka Bank)',
        });
      }
    });
  }, [isOpen, mode]);

  if (!isOpen || !firebaseUser || !profile) return null;

  const selectedPkg = packages.find((p) => p.id === selectedPkgId) || packages[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPkg || !transactionId.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addDoc(collection(db, 'paymentRequests'), {
        uid: firebaseUser.uid,
        username: profile.username,
        userName: profile.displayName,
        requestType: mode,
        ...(targetCollection ? { targetCollection } : {}),
        ...(targetId ? { targetId } : {}),
        ...(targetTitle ? { targetTitle } : {}),
        packageId: selectedPkg.id,
        packageName: selectedPkg.name,
        amountBdt: selectedPkg.priceBdt,
        amountUsd: selectedPkg.priceUsd,
        durationDays: selectedPkg.durationDays,
        estimatedReach: selectedPkg.estimatedReach,
        listingSlots: selectedPkg.listingSlots || 0,
        paymentMethod,
        senderNumber: senderNumber.trim(),
        transactionId: transactionId.trim(),
        status: 'pending',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      setSubmittedOk(true);
      onSubmitted?.();
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/55 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="w-full max-w-xl rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-200 dark:border-neutral-800">
          <div className="flex items-center gap-2">
            {mode === 'boost_post' ? (
              <Zap className="w-5 h-5 text-brand" />
            ) : (
              <ShoppingBag className="w-5 h-5 text-brand" />
            )}
            <div>
              <h2 className="font-display font-bold text-base">
                {mode === 'boost_post' ? 'Boost Content & Reach More Users' : 'Unlock Extra Marketplace Listings'}
              </h2>
              {targetTitle && (
                <p className="text-[11px] text-neutral-500 truncate max-w-xs">Target: {targetTitle}</p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 overflow-y-auto space-y-4">
          {reasonBanner && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-900 dark:text-amber-200">
              {reasonBanner}
            </div>
          )}

          {submittedOk ? (
            <div className="py-8 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 mx-auto text-emerald-600" />
              <h3 className="font-display font-bold text-lg">Payment Submitted for Admin Approval</h3>
              <p className="text-xs text-neutral-500 max-w-sm mx-auto">
                Transaction ID <strong className="font-mono">{transactionId}</strong> has been logged for{' '}
                <strong>{selectedPkg?.name}</strong>. Once approved in the Admin Panel, your boost or listing slots activate automatically.
              </p>
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
                  {error}
                </div>
              )}

              {/* Package Cards */}
              <div className="space-y-2">
                <label className="block text-xs font-semibold text-neutral-700 dark:text-neutral-300">
                  1. Select an Admin-Configured Package
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {packages.map((pkg) => {
                    const active = selectedPkg?.id === pkg.id;
                    return (
                      <button
                        key={pkg.id}
                        type="button"
                        onClick={() => setSelectedPkgId(pkg.id)}
                        className={`text-left rounded-[12px] border p-3.5 transition-all space-y-2 ${
                          active
                            ? 'border-brand bg-blue-50/50 dark:bg-blue-950/20 ring-1 ring-brand'
                            : 'border-neutral-200 dark:border-neutral-800 hover:border-neutral-300'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <span className="font-display font-bold text-xs text-neutral-950 dark:text-white">
                            {pkg.name}
                          </span>
                          <span className="font-mono font-bold text-xs text-brand shrink-0 tabular-nums">
                            ৳{pkg.priceBdt} / ${pkg.priceUsd}
                          </span>
                        </div>
                        <p className="text-[11px] text-neutral-500 line-clamp-2">{pkg.description}</p>
                        <div className="flex items-center gap-3 text-[11px] font-mono text-neutral-600 dark:text-neutral-400 tabular-nums pt-1">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {pkg.durationDays}d
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Users className="w-3 h-3" /> ~{formatCompactNumber(pkg.estimatedReach)} reach
                          </span>
                          {pkg.listingSlots > 0 && <span>+{pkg.listingSlots} posts</span>}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Payment Gateway Instructions */}
              <div className="rounded-xl bg-[#F0F2F5] dark:bg-neutral-900 p-3.5 space-y-2 text-xs">
                <p className="font-semibold flex items-center gap-1.5">
                  <CreditCard className="w-4 h-4 text-brand" /> 2. Send Payment & Enter Transaction ID
                </p>
                <div className="grid grid-cols-3 gap-2">
                  {(['bKash', 'Nagad', 'Bank Transfer'] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setPaymentMethod(m)}
                      className={`py-2 rounded-lg text-xs font-semibold border transition-colors ${
                        paymentMethod === m
                          ? 'bg-brand border-brand text-white'
                          : 'bg-white dark:bg-neutral-950 border-neutral-200 dark:border-neutral-800'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-neutral-600 dark:text-neutral-400 font-mono">
                  {paymentMethod === 'bKash' && `bKash Payment / Send Money: ${gateways.bKashNumber}`}
                  {paymentMethod === 'Nagad' && `Nagad Payment / Send Money: ${gateways.nagadNumber}`}
                  {paymentMethod === 'Bank Transfer' && `Bank Account: ${gateways.bankDetails}`}
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Sender Number / Account
                  </label>
                  <input
                    type="text"
                    required
                    value={senderNumber}
                    onChange={(e) => setSenderNumber(e.target.value)}
                    placeholder="e.g. 017XXXXXXXX"
                    className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs font-mono"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-medium text-neutral-600 dark:text-neutral-400 mb-1">
                    Transaction ID (TrxID)
                  </label>
                  <input
                    type="text"
                    required
                    minLength={4}
                    value={transactionId}
                    onChange={(e) => setTransactionId(e.target.value)}
                    placeholder="e.g. TXN9X82K10A"
                    className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs font-mono"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={submitting || !selectedPkg}
                className="w-full h-11 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold transition-colors disabled:opacity-50"
              >
                {submitting
                  ? 'Submitting Payment...'
                  : `Submit Payment Proof (৳${selectedPkg?.priceBdt || 0} / $${selectedPkg?.priceUsd || 0})`}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
