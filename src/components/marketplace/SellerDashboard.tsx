import React, { useEffect, useState } from 'react';
import {
  Store,
  Plus,
  Edit3,
  Trash2,
  Zap,
  Package,
  ShoppingBag,
  CheckCircle2,
  Truck,
  XCircle,
  ExternalLink,
  Upload,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  collection,
  deleteDoc,
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
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  BANGLADESH_DISTRICTS,
  type BanaMarketListing,
  type BanaStore,
  type MarketplaceOrder,
  type OrderStatus,
  type SellerApplication,
} from '@/src/types/bana';
import { fetchMySellerApplication, saveSellerStore, updateMarketplaceOrderStatus } from '@/src/lib/marketplace';
import { SellerApplicationPanel } from '@/src/components/marketplace/SellerApplicationPanel';
import { compressImageFile, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { ResilientImage } from '@/src/components/common/Avatar';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';

interface SellerDashboardProps {
  myListings: BanaMarketListing[];
  myStore: BanaStore | null;
  onStoreSaved: (store: BanaStore) => void;
  onOpenNewListing: () => void;
  onEditListing: (item: BanaMarketListing) => void;
  onBoostListing: (item: BanaMarketListing) => void;
  onRefreshListings: () => void;
}

export function SellerDashboard({
  myListings,
  myStore,
  onStoreSaved,
  onOpenNewListing,
  onEditListing,
  onBoostListing,
  onRefreshListings,
}: SellerDashboardProps) {
  const { firebaseUser, profile } = useAuth();
  const toast = useToast();

  const [section, setSection] = useState<'overview' | 'orders' | 'store'>('overview');
  const [orders, setOrders] = useState<MarketplaceOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(true);
  const [trackingByOrder, setTrackingByOrder] = useState<Record<string, string>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<BanaMarketListing | null>(null);

  // Store customization form state
  const [storeName, setStoreName] = useState('');
  const [storeDesc, setStoreDesc] = useState('');
  const [storeDistrict, setStoreDistrict] = useState('Dhaka');
  const [contactPref, setContactPref] = useState<'messenger' | 'phone' | 'both'>('messenger');
  const [contactPhone, setContactPhone] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [coverFile, setCoverFile] = useState<File | null>(null);
  const [savingStore, setSavingStore] = useState(false);
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [appLoaded, setAppLoaded] = useState(false);

  // Prompt 07: users without a store must have an approved seller application first.
  useEffect(() => {
    let cancelled = false;
    if (myStore || !firebaseUser) {
      setAppLoaded(true);
      return;
    }
    fetchMySellerApplication(firebaseUser.uid).then((a) => {
      if (!cancelled) {
        setApplication(a);
        setAppLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [myStore, firebaseUser]);

  useEffect(() => {
    if (myStore) {
      setStoreName(myStore.name);
      setStoreDesc(myStore.description);
      setStoreDistrict(myStore.district || 'Dhaka');
      setContactPref(myStore.contactPreference || 'messenger');
      setContactPhone(myStore.contactPhone || '');
      setContactEmail(myStore.contactEmail || '');
    } else if (profile) {
      setStoreName(`${profile.displayName}'s Store`);
      setStoreDesc('');
      setStoreDistrict(
        profile.location && BANGLADESH_DISTRICTS.includes(profile.location) ? profile.location : 'Dhaka'
      );
    }
  }, [myStore, profile]);

  const loadSellerOrders = async () => {
    if (!firebaseUser) return;
    setLoadingOrders(true);
    try {
      const { items } = await getDocsWithIndexFallback<MarketplaceOrder>(
        query(
          collection(db, 'orders'),
          where('sellerId', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc'),
          limit(60)
        ),
        query(collection(db, 'orders'), where('sellerId', '==', firebaseUser.uid), limit(60)),
        sortByCreatedAtDesc
      );
      setOrders(items);
    } catch {
      setOrders([]);
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    loadSellerOrders();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser]);

  const handleSaveStore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    if (storeName.trim().length < 2) {
      toast.error('Store name must be at least 2 characters.');
      return;
    }
    setSavingStore(true);
    try {
      let logoUrl = myStore?.logoUrl;
      let coverUrl = myStore?.coverUrl;
      if (logoFile) {
        const comp = await compressImageFile(logoFile, 600);
        logoUrl = await uploadMediaWithProgress(
          `stores/${firebaseUser.uid}/logo_${Date.now()}_${comp.name}`,
          comp
        );
      }
      if (coverFile) {
        const comp = await compressImageFile(coverFile, 1600);
        coverUrl = await uploadMediaWithProgress(
          `stores/${firebaseUser.uid}/cover_${Date.now()}_${comp.name}`,
          comp
        );
      }
      const saved = await saveSellerStore(
        profile,
        {
          name: storeName,
          description: storeDesc,
          district: storeDistrict,
          contactPreference: contactPref,
          contactPhone,
          contactEmail,
          logoUrl,
          coverUrl,
        },
        myStore
      );
      setLogoFile(null);
      setCoverFile(null);
      onStoreSaved(saved);
      toast.success(myStore ? 'Store profile updated.' : 'Seller store created!');
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setSavingStore(false);
    }
  };

  const handleOrderTransition = async (order: MarketplaceOrder, nextStatus: OrderStatus) => {
    if (!firebaseUser || !profile) return;
    setBusyOrderId(order.id);
    try {
      await updateMarketplaceOrderStatus({
        order,
        actorUid: firebaseUser.uid,
        actorName: profile.displayName,
        nextStatus,
        trackingCode: trackingByOrder[order.id] || '',
      });
      toast.success(`Order marked as ${nextStatus}.`);
      loadSellerOrders();
      onRefreshListings();
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setBusyOrderId(null);
    }
  };

  const activeListings = myListings.filter((l) => l.status === 'active').length;
  const pendingOrders = orders.filter((o) => ['pending', 'confirmed', 'processing'].includes(o.status)).length;
  const completedOrders = orders.filter((o) => o.status === 'delivered').length;
  const cancelledOrders = orders.filter((o) => o.status === 'cancelled').length;
  const totalSalesAmount = orders
    .filter((o) => o.status === 'delivered')
    .reduce((sum, o) => sum + Number(o.totalAmount || 0), 0);

  return (
    <div className="space-y-6">
      {/* Store Banner / Header */}
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3.5">
          <div className="h-12 w-12 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
            {myStore?.logoUrl ? (
              <img loading="lazy" src={myStore.logoUrl} alt={myStore.name} className="w-full h-full object-cover" />
            ) : (
              <Store className="w-6 h-6 text-[#1877F2]" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="font-display font-bold text-lg">
                {myStore ? myStore.name : 'Seller Workspace'}
              </h2>
              {myStore?.status && myStore.status !== 'active' && (
                <span className="px-2 py-0.5 rounded-md bg-red-50 dark:bg-red-950/40 text-red-600 text-[11px] font-semibold capitalize">
                  {myStore.status}
                </span>
              )}
            </div>
            <p className="text-xs text-neutral-500">
              {myStore
                ? `${myStore.district} · Rating ${myStore.ratingAvg || 0} (${myStore.reviewsCount || 0} reviews)`
                : 'Set up your storefront profile to build buyer trust across BANA Marketplace.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {myStore && (
            <Link
              to={`/market/store/${myStore.id}`}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <ExternalLink className="w-3.5 h-3.5" /> View Storefront
            </Link>
          )}
          <button
            type="button"
            onClick={onOpenNewListing}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold"
          >
            <Plus className="w-4 h-4" /> Add Product
          </button>
        </div>
      </div>

      {/* Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        {[
          { label: 'Total Products', val: myListings.length },
          { label: 'Active Listings', val: activeListings },
          { label: 'Pending Orders', val: pendingOrders },
          { label: 'Completed Orders', val: completedOrders },
          { label: 'Cancelled Orders', val: cancelledOrders },
          { label: 'Delivered Sales', val: `BDT ${totalSalesAmount.toLocaleString()}` },
        ].map((stat) => (
          <div
            key={stat.label}
            className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5"
          >
            <p className="text-[11px] text-neutral-500">{stat.label}</p>
            <p className="font-mono font-bold text-lg mt-1 tabular-nums">{stat.val}</p>
          </div>
        ))}
      </div>

      {/* Sub-navigation */}
      <div className="inline-flex p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
        {(
          [
            { id: 'overview', label: `Inventory (${myListings.length})` },
            { id: 'orders', label: `Incoming Orders (${orders.length})` },
            { id: 'store', label: myStore ? 'Store Settings' : 'Create Storefront' },
          ] as const
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setSection(t.id)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              section === t.id
                ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                : 'text-neutral-500'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {section === 'overview' && (
        <div className="space-y-3">
          {myListings.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-10 text-center space-y-3 bg-white dark:bg-neutral-900">
              <Package className="w-8 h-8 mx-auto text-neutral-400" />
              <h3 className="font-display font-bold text-base">No products in your store yet</h3>
              <button
                type="button"
                onClick={onOpenNewListing}
                className="px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold"
              >
                Create First Product
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {myListings.map((item) => (
                <div
                  key={item.id}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 flex gap-3.5"
                >
                  <Link
                    to={`/market/product/${item.id}`}
                    className="h-24 w-24 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-950 shrink-0"
                  >
                    <ResilientImage
                      src={item.imageUrls?.[0]}
                      alt={item.title}
                      fallbackLabel={item.category}
                      className="w-full h-full object-cover"
                    />
                  </Link>
                  <div className="flex-1 min-w-0 flex flex-col justify-between">
                    <div>
                      <div className="flex items-start justify-between gap-2">
                        <Link
                          to={`/market/product/${item.id}`}
                          className="font-display font-semibold text-sm line-clamp-1 hover:underline"
                        >
                          {item.title}
                        </Link>
                        <span
                          className={`text-[10px] font-semibold px-2 py-0.5 rounded-md capitalize shrink-0 ${
                            item.status === 'active'
                              ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : item.status === 'draft'
                              ? 'bg-neutral-100 text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300'
                              : 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {item.status.replace('_', ' ')}
                        </span>
                      </div>
                      <p className="font-mono font-bold text-xs mt-1 tabular-nums">
                        {item.currency} {item.price.toLocaleString()} · Stock:{' '}
                        {typeof item.quantity === 'number' ? item.quantity : 1} · Sold: {item.soldCount || 0}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-2">
                      <button
                        type="button"
                        onClick={() => onEditListing(item)}
                        className="inline-flex items-center gap-1 text-xs font-medium text-neutral-700 dark:text-neutral-200 hover:underline"
                      >
                        <Edit3 className="w-3.5 h-3.5" /> Edit
                      </button>
                      {item.status === 'draft' && (
                        <button
                          type="button"
                          onClick={async () => {
                            await updateDoc(doc(db, 'marketplaceListings', item.id), {
                              status: 'active',
                              updatedAt: serverTimestamp(),
                            });
                            toast.success('Listing published.');
                            onRefreshListings();
                          }}
                          className="text-xs font-semibold text-emerald-600 hover:underline"
                        >
                          Publish
                        </button>
                      )}
                      {item.status === 'active' && !item.isBoosted && (
                        <button
                          type="button"
                          onClick={() => onBoostListing(item)}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-[#1877F2] hover:underline"
                        >
                          <Zap className="w-3.5 h-3.5" /> Boost
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(item)}
                        className="inline-flex items-center gap-1 text-xs text-red-600 hover:underline ml-auto"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {section === 'orders' && (
        <div className="space-y-3">
          {loadingOrders ? (
            <div className="h-40 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
          ) : orders.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-10 text-center space-y-2 bg-white dark:bg-neutral-900">
              <ShoppingBag className="w-8 h-8 mx-auto text-neutral-400" />
              <h3 className="font-display font-bold text-base">No incoming orders yet</h3>
              <p className="text-xs text-neutral-500">
                When buyers purchase from your store, orders appear here for confirmation and dispatch.
              </p>
            </div>
          ) : (
            orders.map((ord) => (
              <div
                key={ord.id}
                className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-3">
                  <div>
                    <p className="text-xs font-mono font-bold">Order #{ord.id.slice(-10)}</p>
                    <p className="text-xs text-neutral-500">
                      Buyer: <strong>{ord.buyerName}</strong> (@{ord.buyerUsername}) ·{' '}
                      {ord.shippingAddress?.district} · {ord.shippingAddress?.phone}
                    </p>
                    <p className="text-[11px] text-neutral-500 mt-0.5">
                      Address: {ord.shippingAddress?.addressLine} ({ord.deliveryOption})
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono font-bold text-sm tabular-nums">
                      {ord.currency} {ord.totalAmount.toLocaleString()}
                    </p>
                    <p className="text-[11px] text-neutral-500 capitalize">
                      Order: <strong>{ord.status}</strong> · Pay: <strong>{ord.paymentStatus.replace('_', ' ')}</strong>
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  {(ord.itemsSnapshot || []).map((line, i) => (
                    <div key={i} className="flex items-center justify-between text-xs">
                      <span>
                        {line.title} × <span className="font-mono">{line.quantity}</span>
                      </span>
                      <span className="font-mono tabular-nums">
                        {ord.currency} {line.lineTotal.toLocaleString()}
                      </span>
                    </div>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                  {ord.status === 'pending' && (
                    <button
                      type="button"
                      disabled={busyOrderId === ord.id}
                      onClick={() => handleOrderTransition(ord, 'confirmed')}
                      className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Confirm Order
                    </button>
                  )}
                  {ord.status === 'confirmed' && (
                    <button
                      type="button"
                      disabled={busyOrderId === ord.id}
                      onClick={() => handleOrderTransition(ord, 'processing')}
                      className="px-3 py-1.5 rounded-lg bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-xs font-semibold"
                    >
                      Mark Processing
                    </button>
                  )}
                  {(ord.status === 'confirmed' || ord.status === 'processing') && (
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={trackingByOrder[ord.id] || ''}
                        onChange={(e) =>
                          setTrackingByOrder((prev) => ({ ...prev, [ord.id]: e.target.value }))
                        }
                        placeholder="Courier tracking code"
                        className="h-8 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-950 px-2.5 text-xs font-mono"
                      />
                      <button
                        type="button"
                        disabled={busyOrderId === ord.id}
                        onClick={() => handleOrderTransition(ord, 'shipped')}
                        className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white text-xs font-semibold inline-flex items-center gap-1"
                      >
                        <Truck className="w-3.5 h-3.5" /> Mark Shipped
                      </button>
                    </div>
                  )}
                  {ord.status === 'shipped' && (
                    <button
                      type="button"
                      disabled={busyOrderId === ord.id}
                      onClick={() => handleOrderTransition(ord, 'delivered')}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold inline-flex items-center gap-1"
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" /> Mark Delivered
                    </button>
                  )}
                  {['pending', 'confirmed', 'processing'].includes(ord.status) && (
                    <button
                      type="button"
                      disabled={busyOrderId === ord.id}
                      onClick={() => handleOrderTransition(ord, 'cancelled')}
                      className="px-3 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 text-xs font-semibold inline-flex items-center gap-1 ml-auto"
                    >
                      <XCircle className="w-3.5 h-3.5" /> Cancel & Restock
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {section === 'store' && !myStore && appLoaded && profile && application?.status !== 'approved' && (
        <SellerApplicationPanel profile={profile} application={application} onSubmitted={setApplication} />
      )}

      {section === 'store' && !myStore && !appLoaded && (
        <div className="flex items-center gap-2 text-xs text-neutral-500">
          <Loader2 className="w-4 h-4 animate-spin" /> Checking seller application…
        </div>
      )}

      {section === 'store' && (myStore || application?.status === 'approved') && (
        <form
          onSubmit={handleSaveStore}
          className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4 max-w-2xl"
        >
          <h3 className="font-display font-bold text-base">
            {myStore ? 'Customize Storefront Profile' : 'Create Your Seller Storefront'}
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Store Name</label>
              <input
                type="text"
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Primary District</label>
              <select
                value={storeDistrict}
                onChange={(e) => setStoreDistrict(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-xs"
              >
                {BANGLADESH_DISTRICTS.filter((d) => d !== 'All Districts').map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Store Description & Shipping Policy</label>
            <textarea
              rows={3}
              required
              value={storeDesc}
              onChange={(e) => setStoreDesc(e.target.value)}
              placeholder="Tell buyers what you sell, dispatch timelines, and return policies..."
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-xs"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Contact Preference</label>
              <select
                value={contactPref}
                onChange={(e) => setContactPref(e.target.value as any)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-xs"
              >
                <option value="messenger">BANA Messenger</option>
                <option value="phone">Phone</option>
                <option value="both">Messenger & Phone</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Contact Phone</label>
              <input
                type="tel"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                placeholder="+8801..."
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Business Email</label>
              <input
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                placeholder="shop@example.com"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs cursor-pointer flex items-center gap-2">
              <Upload className="w-4 h-4 text-neutral-500" />
              <span className="truncate">{logoFile ? logoFile.name : 'Upload Store Logo (optional)'}</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setLogoFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
            <label className="rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 p-3 text-xs cursor-pointer flex items-center gap-2">
              <Upload className="w-4 h-4 text-neutral-500" />
              <span className="truncate">{coverFile ? coverFile.name : 'Upload Store Cover (optional)'}</span>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setCoverFile(e.target.files?.[0] || null)}
                className="hidden"
              />
            </label>
          </div>

          <button
            type="submit"
            disabled={savingStore}
            className="px-5 h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold inline-flex items-center gap-2 disabled:opacity-50"
          >
            {savingStore && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {myStore ? 'Save Store Changes' : 'Launch Seller Store'}
          </button>
        </form>
      )}

      <ConfirmDialog
        isOpen={Boolean(deleteTarget)}
        title="Delete Product Listing"
        description={`Are you sure you want to permanently remove "${deleteTarget?.title}"?`}
        confirmLabel="Delete Listing"
        variant="danger"
        onCancel={() => setDeleteTarget(null)}
        onConfirm={async () => {
          if (!deleteTarget) return;
          await deleteDoc(doc(db, 'marketplaceListings', deleteTarget.id));
          setDeleteTarget(null);
          toast.success('Listing deleted.');
          onRefreshListings();
        }}
      />
    </div>
  );
}
