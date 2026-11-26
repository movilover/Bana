import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ShoppingBag,
  ShoppingCart,
  Plus,
  Search,
  MapPin,
  Bookmark,
  MessageSquare,
  Store,
  Package,
  Star,
  Zap,
  Sparkles,
  TrendingUp,
  Clock,
  XCircle,
  Truck,
} from 'lucide-react';
import { collection, query, orderBy, limit, getDocs, where } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  DEFAULT_PRODUCT_CATEGORIES,
  FREE_MARKETPLACE_POST_LIMIT,
  type AdCampaign,
  type BanaMarketListing,
  type BanaStore,
  type CartItem,
  type MarketplaceOrder,
  type ProductCategoryItem,
} from '@/src/types/bana';
import {
  fetchActiveStores,
  fetchMyStore,
  fetchProductCategories,
  fetchWishlistIds,
  getRecentlyViewedIds,
  loadUserCart,
  readGuestCart,
  saveUserCart,
  startOrOpenSellerChat,
  toggleProductWishlist,
  updateMarketplaceOrderStatus,
} from '@/src/lib/marketplace';
import { AppShell } from '@/src/components/layout/AppShell';
import { ResilientImage } from '@/src/components/common/Avatar';
import { BoostAndPaymentModal } from '@/src/components/monetization/BoostAndPaymentModal';
import { CartDrawer } from '@/src/components/marketplace/CartDrawer';
import { ListingFormModal } from '@/src/components/marketplace/ListingFormModal';
import { SellerDashboard } from '@/src/components/marketplace/SellerDashboard';
import { SponsoredAdCard } from '@/src/components/ads/SponsoredAdCard';
import { fetchEligibleAdsForPlacement } from '@/src/lib/ads';
import { formatFirebaseErrorMessage, logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';

type MarketTab = 'browse' | 'wishlist' | 'orders' | 'seller';

export function MarketplacePage() {
  const { firebaseUser, profile, settings, openAuthModal } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const tabParam = searchParams.get('tab');
  const activeTab: MarketTab =
    tabParam === 'seller' || tabParam === 'orders' || tabParam === 'wishlist' ? tabParam : 'browse';

  const setActiveTab = (next: MarketTab) => {
    if ((next === 'seller' || next === 'orders' || next === 'wishlist') && !firebaseUser) {
      openAuthModal(
        next === 'seller'
          ? 'Sign in to access your Seller Store & Dashboard.'
          : next === 'orders'
          ? 'Sign in to track your Marketplace orders.'
          : 'Sign in to view your saved Wishlist.'
      );
      return;
    }
    setSearchParams(next === 'browse' ? {} : { tab: next });
  };

  const [listings, setListings] = useState<BanaMarketListing[]>([]);
  const [categories, setCategories] = useState<ProductCategoryItem[]>(DEFAULT_PRODUCT_CATEGORIES);
  const [stores, setStores] = useState<BanaStore[]>([]);
  const [myStore, setMyStore] = useState<BanaStore | null>(null);
  const [wishlistIds, setWishlistIds] = useState<string[]>([]);
  const [myOrders, setMyOrders] = useState<MarketplaceOrder[]>([]);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [subcategoryFilter, setSubcategoryFilter] = useState<string>('All');
  const [conditionFilter, setConditionFilter] = useState<string>('All');
  const [sellerFilter, setSellerFilter] = useState<string>('All');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'top_rated'>('newest');

  // Modals / Drawers
  const [cartOpen, setCartOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [editingListing, setEditingListing] = useState<BanaMarketListing | null>(null);
  const [boostModal, setBoostModal] = useState<{
    mode: 'boost_post' | 'marketplace_slot';
    targetId?: string;
    targetTitle?: string;
    reasonBanner?: string;
  } | null>(null);

  const loadAll = async () => {
    setLoading(true);
    try {
      const [listSnap, cats, activeStores] = await Promise.all([
        getDocs(query(collection(db, 'marketplaceListings'), orderBy('createdAt', 'desc'), limit(80))),
        fetchProductCategories(false),
        fetchActiveStores(16),
      ]);

      setListings(listSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BanaMarketListing, 'id'>) })));
      setCategories(cats);
      setStores(activeStores);
      setRecentIds(getRecentlyViewedIds());

      if (firebaseUser) {
        const [wish, userCart, storeDoc, ordRes] = await Promise.all([
          fetchWishlistIds(firebaseUser.uid),
          loadUserCart(firebaseUser.uid),
          fetchMyStore(firebaseUser.uid),
          getDocsWithIndexFallback<MarketplaceOrder>(
            query(
              collection(db, 'orders'),
              where('buyerId', '==', firebaseUser.uid),
              orderBy('createdAt', 'desc'),
              limit(40)
            ),
            query(collection(db, 'orders'), where('buyerId', '==', firebaseUser.uid), limit(40)),
            sortByCreatedAtDesc
          ).catch(() => null),
        ]);
        setWishlistIds(wish);
        setCart(userCart);
        setMyStore(storeDoc);
        if (ordRes) {
          setMyOrders(ordRes.items);
        }
      } else {
        setCart(readGuestCart());
        setWishlistIds([]);
        setMyStore(null);
        setMyOrders([]);
      }
    } catch (err) {
      logFirestoreError(err, OperationType.LIST, 'marketplaceListings');
    } finally {
      setLoading(false);
    }
  };

  const [marketAd, setMarketAd] = useState<AdCampaign | null>(null);

  useEffect(() => {
    loadAll();
    const isAdult = !profile?.isMinor && (!settings?.birthYear || new Date().getFullYear() - settings.birthYear >= 18);
    fetchEligibleAdsForPlacement('marketplace', {
      isAdult,
      categoryFilter: categoryFilter !== 'All' ? categoryFilter : undefined,
      viewerUid: firebaseUser?.uid,
    })
      .then((ads) => setMarketAd(ads[0] || null))
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, categoryFilter]);

  const myListings = firebaseUser ? listings.filter((l) => l.sellerId === firebaseUser.uid) : [];
  const totalAllowedListings = FREE_MARKETPLACE_POST_LIMIT + (profile?.paidListingQuota || 0);

  const openCreateModal = (item?: BanaMarketListing) => {
    if (!firebaseUser) return openAuthModal('Sign in to list a product on BANA Marketplace.');
    if (!item && myListings.length >= totalAllowedListings) {
      setBoostModal({
        mode: 'marketplace_slot',
        reasonBanner: `You have reached your ${totalAllowedListings} listing quota (${FREE_MARKETPLACE_POST_LIMIT} free posts included). Select a Seller Package to unlock additional listings.`,
      });
      return;
    }
    setEditingListing(item || null);
    setFormOpen(true);
  };

  const persistCart = async (next: CartItem[]) => {
    setCart(next);
    await saveUserCart(firebaseUser?.uid, next).catch(() => {});
  };

  const handleAddToCart = async (item: BanaMarketListing) => {
    if (firebaseUser && item.sellerId === firebaseUser.uid) {
      toast.info('You cannot add your own product to your cart.');
      return;
    }
    const maxStock = typeof item.quantity === 'number' ? item.quantity : 1;
    if (item.status !== 'active' || maxStock <= 0) {
      toast.error('This product is currently out of stock.');
      return;
    }
    const existing = cart.find((c) => c.productId === item.id);
    const nextQty = Math.min(maxStock, (existing?.quantity || 0) + 1);
    const entry: CartItem = {
      productId: item.id,
      sellerId: item.sellerId,
      storeId: item.storeId || '',
      storeName: item.storeName || item.sellerName,
      title: item.title,
      price: item.price,
      currency: item.currency,
      deliveryFee: Number(item.deliveryFee || 0),
      quantity: nextQty,
      imageUrl: item.imageUrls?.[0] || '',
      maxStock,
    };
    const next = existing ? cart.map((c) => (c.productId === item.id ? entry : c)) : [...cart, entry];
    await persistCart(next);
    toast.success(`Added "${item.title}" to cart.`);
  };

  const handleToggleWishlist = async (item: BanaMarketListing) => {
    if (!firebaseUser) return openAuthModal('Sign in to save items to your Wishlist.');
    const currently = wishlistIds.includes(item.id);
    setWishlistIds((prev) => (currently ? prev.filter((x) => x !== item.id) : [...prev, item.id]));
    await toggleProductWishlist(firebaseUser.uid, item.id, currently);
  };

  const handleContactSeller = async (item: BanaMarketListing) => {
    if (!firebaseUser || !profile) {
      return openAuthModal(`Sign in to chat with ${item.sellerName}.`);
    }
    if (item.sellerId === firebaseUser.uid) return;
    const convId = await startOrOpenSellerChat({
      buyer: profile,
      sellerId: item.sellerId,
      sellerName: item.sellerName,
      sellerUsername: item.sellerUsername,
      sellerAvatar: item.sellerAvatar,
      initialMessage: `Hi ${item.sellerName}, is "${item.title}" (${item.currency} ${item.price.toLocaleString()}) available?`,
    });
    navigate(`/messages/${convId}`);
  };

  const activeCatalog = listings.filter((l) => l.status === 'active');
  const selectedCatObj = categories.find((c) => c.name === categoryFilter);

  const filtered = activeCatalog
    .filter((l) => {
      if (activeTab === 'wishlist' && !wishlistIds.includes(l.id)) return false;
      if (categoryFilter !== 'All' && l.category !== categoryFilter) return false;
      if (subcategoryFilter !== 'All' && l.subcategory !== subcategoryFilter) return false;
      if (conditionFilter !== 'All' && l.condition !== conditionFilter) return false;
      if (sellerFilter !== 'All' && l.sellerId !== sellerFilter) return false;
      if (minPrice !== '' && l.price < Number(minPrice)) return false;
      if (maxPrice !== '' && l.price > Number(maxPrice)) return false;
      if (search.trim()) {
        const hay = `${l.title} ${l.description} ${l.location} ${l.category} ${l.subcategory || ''} ${l.storeName || ''}`.toLowerCase();
        if (!hay.includes(search.toLowerCase())) return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (sortBy === 'price_asc') return a.price - b.price;
      if (sortBy === 'price_desc') return b.price - a.price;
      if (sortBy === 'top_rated') return (b.ratingAvg || 0) - (a.ratingAvg || 0);
      if (a.isBoosted && !b.isBoosted) return -1;
      if (!a.isBoosted && b.isBoosted) return 1;
      return 0;
    });

  // Real data-driven discovery slices (no fake placeholders or fabricated numbers)
  const hasActiveFilter =
    Boolean(search.trim()) ||
    categoryFilter !== 'All' ||
    subcategoryFilter !== 'All' ||
    conditionFilter !== 'All' ||
    sellerFilter !== 'All' ||
    minPrice !== '' ||
    maxPrice !== '';

  const trendingProducts = [...activeCatalog]
    .sort(
      (a, b) =>
        (b.soldCount || 0) * 5 +
        (b.savesCount || 0) * 2 +
        (b.viewsCount || 0) -
        ((a.soldCount || 0) * 5 + (a.savesCount || 0) * 2 + (a.viewsCount || 0))
    )
    .slice(0, 4);

  const interestKeywords = (profile?.interests || []).map((i) => i.toLowerCase());
  const recommendedProducts = [...activeCatalog]
    .sort((a, b) => {
      const aMatch =
        interestKeywords.some((kw) => `${a.category} ${a.title}`.toLowerCase().includes(kw)) || a.isBoosted
          ? 1
          : 0;
      const bMatch =
        interestKeywords.some((kw) => `${b.category} ${b.title}`.toLowerCase().includes(kw)) || b.isBoosted
          ? 1
          : 0;
      if (bMatch !== aMatch) return bMatch - aMatch;
      return (b.ratingAvg || 0) - (a.ratingAvg || 0);
    })
    .slice(0, 4);

  const recentlyViewedProducts = recentIds
    .map((id) => activeCatalog.find((l) => l.id === id))
    .filter((item): item is BanaMarketListing => Boolean(item))
    .slice(0, 4);

  const renderProductCard = (item: BanaMarketListing) => {
    const isMine = firebaseUser?.uid === item.sellerId;
    const isWished = wishlistIds.includes(item.id);
    const stock = typeof item.quantity === 'number' ? item.quantity : 1;

    return (
      <div
        key={item.id}
        className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm hover:shadow-md transition-shadow overflow-hidden flex flex-col"
      >
        <Link
          to={`/market/product/${item.id}`}
          className="relative aspect-[4/3] w-full bg-neutral-100 dark:bg-neutral-950 overflow-hidden block"
        >
          <ResilientImage
            src={item.imageUrls?.[0]}
            alt={item.title}
            fallbackLabel={item.category}
            className="w-full h-full object-cover hover:scale-[1.02] transition-transform"
          />
          {!isMine && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                handleToggleWishlist(item);
              }}
              aria-label="Toggle wishlist"
              className={`absolute top-2.5 right-2.5 h-8 w-8 rounded-full bg-white/90 dark:bg-neutral-950/90 flex items-center justify-center shadow-sm ${
                isWished ? 'text-brand' : 'text-neutral-500 hover:text-neutral-900'
              }`}
            >
              <Bookmark className={`w-4 h-4 ${isWished ? 'fill-current' : ''}`} />
            </button>
          )}
        </Link>

        <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-mono font-bold text-base tabular-nums text-neutral-950 dark:text-white">
                {item.currency} {item.price.toLocaleString()}
              </p>
              {(item.reviewsCount || 0) > 0 && (
                <span className="inline-flex items-center gap-0.5 text-[11px] font-mono text-neutral-600 dark:text-neutral-300">
                  <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                  {item.ratingAvg}
                </span>
              )}
            </div>
            <Link
              to={`/market/product/${item.id}`}
              className="font-display font-semibold text-sm line-clamp-1 hover:underline mt-0.5 block"
            >
              {item.title}
            </Link>
            <p className="text-xs text-neutral-500 mt-1 flex items-center gap-1 truncate">
              <MapPin className="w-3 h-3 shrink-0" />
              <span>{item.location}</span>
              <span>·</span>
              <span>{item.category}</span>
              {item.isBoosted && (
                <>
                  <span>·</span>
                  <span className="text-brand font-semibold">Featured</span>
                </>
              )}
            </p>
            {item.storeName && item.storeId && (
              <Link
                to={`/market/store/${item.storeId}`}
                className="text-[11px] text-brand hover:underline mt-0.5 inline-flex items-center gap-1 truncate"
              >
                <Store className="w-3 h-3" /> {item.storeName}
              </Link>
            )}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-neutral-100 dark:border-neutral-800">
            {isMine ? (
              <Link
                to="/market?tab=seller"
                className="w-full h-8 rounded-lg border border-neutral-200 dark:border-neutral-700 text-xs font-medium flex items-center justify-center hover:bg-neutral-50 dark:hover:bg-neutral-800"
              >
                Manage in Seller Hub
              </Link>
            ) : (
              <>
                <button
                  type="button"
                  disabled={stock <= 0}
                  onClick={() => handleAddToCart(item)}
                  className="flex-1 h-8 rounded-lg bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-40"
                >
                  {stock > 0 ? 'Add to Cart' : 'Out of Stock'}
                </button>
                <button
                  type="button"
                  onClick={() => handleContactSeller(item)}
                  aria-label="Chat with seller"
                  className="h-8 w-8 rounded-lg border border-neutral-200 dark:border-neutral-700 flex items-center justify-center text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-800"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        {/* Top Marketplace Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div>
            <h1 className="font-display font-extrabold text-2xl tracking-tight">BANA Marketplace</h1>
            <p className="text-xs text-neutral-500">
              Shop curated products, verified stores, and direct local commerce across Bangladesh.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
              {(
                [
                  { id: 'browse', label: 'Browse' },
                  { id: 'wishlist', label: `Wishlist (${wishlistIds.length})` },
                  { id: 'orders', label: `Orders (${myOrders.length})` },
                  { id: 'seller', label: 'Seller Hub' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setActiveTab(t.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                    activeTab === t.id
                      ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                      : 'text-neutral-500'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => setCartOpen(true)}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <ShoppingCart className="w-4 h-4 text-brand" />
              <span>Cart</span>
              <span className="font-mono px-1.5 py-0.5 rounded bg-brand/10 text-brand tabular-nums">
                {cart.reduce((s, i) => s + i.quantity, 0)}
              </span>
            </button>

            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold transition-colors"
            >
              <Plus className="w-4 h-4" /> Sell Item
            </button>
          </div>
        </div>

        {/* Seller Quota Bar */}
        {firebaseUser && activeTab === 'seller' && (
          <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
            <span className="text-neutral-600 dark:text-neutral-300 tabular-nums">
              Seller Quota: <strong>{myListings.length}</strong> / <strong>{totalAllowedListings}</strong> listings used ({FREE_MARKETPLACE_POST_LIMIT} free
              {profile?.paidListingQuota ? ` + ${profile.paidListingQuota} unlocked` : ''})
            </span>
            <button
              type="button"
              onClick={() =>
                setBoostModal({
                  mode: 'marketplace_slot',
                  reasonBanner: 'Unlock extra Marketplace listings or upgrade your store visibility.',
                })
              }
              className="inline-flex items-center gap-1 font-semibold text-brand hover:underline"
            >
              <Zap className="w-3.5 h-3.5" /> Unlock More Slots
            </button>
          </div>
        )}

        {activeTab === 'seller' && firebaseUser ? (
          <SellerDashboard
            myListings={myListings}
            myStore={myStore}
            onStoreSaved={(s) => setMyStore(s)}
            onOpenNewListing={() => openCreateModal()}
            onEditListing={(item) => openCreateModal(item)}
            onBoostListing={(item) =>
              setBoostModal({
                mode: 'boost_post',
                targetId: item.id,
                targetTitle: item.title,
              })
            }
            onRefreshListings={loadAll}
          />
        ) : activeTab === 'orders' && firebaseUser ? (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-lg">My Purchases & Order Tracking</h2>
              <button
                type="button"
                onClick={() => setActiveTab('browse')}
                className="text-xs font-semibold text-brand hover:underline"
              >
                Continue Shopping
              </button>
            </div>
            {myOrders.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-12 text-center space-y-3">
                <Package className="w-8 h-8 mx-auto text-neutral-400" />
                <h3 className="font-display font-bold text-base">No marketplace orders yet</h3>
                <p className="text-xs text-neutral-500">
                  Your orders, delivery tracking, and verified purchase reviews will appear here.
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                {myOrders.map((ord) => (
                  <div
                    key={ord.id}
                    className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 border-b border-neutral-100 dark:border-neutral-800 pb-3">
                      <div>
                        <p className="font-mono font-bold text-xs">Order #{ord.id.slice(-10)}</p>
                        <p className="text-xs text-neutral-500">
                          Seller: <strong>{ord.storeName || ord.sellerName}</strong> · {ord.deliveryOption}
                          {ord.trackingCode ? ` · Tracking: ${ord.trackingCode}` : ''}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-mono font-bold text-sm tabular-nums">
                          {ord.currency} {ord.totalAmount.toLocaleString()}
                        </p>
                        <p className="text-[11px] capitalize text-neutral-500">
                          Status: <strong className="text-neutral-900 dark:text-white">{ord.status}</strong> · Pay:{' '}
                          <strong>{ord.paymentStatus.replace('_', ' ')}</strong>
                        </p>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {(ord.itemsSnapshot || []).map((line, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 text-xs">
                          <Link
                            to={`/market/product/${line.productId}`}
                            className="flex items-center gap-2.5 hover:underline min-w-0"
                          >
                            <div className="h-10 w-10 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-950 shrink-0">
                              <ResilientImage
                                src={line.imageUrl}
                                alt={line.title}
                                className="w-full h-full object-cover"
                              />
                            </div>
                            <span className="truncate">
                              {line.title} × <span className="font-mono">{line.quantity}</span>
                            </span>
                          </Link>
                          <div className="flex items-center gap-3 shrink-0">
                            <span className="font-mono tabular-nums">
                              {ord.currency} {line.lineTotal.toLocaleString()}
                            </span>
                            {ord.status === 'delivered' && (
                              <Link
                                to={`/market/product/${line.productId}`}
                                className="text-brand font-semibold hover:underline"
                              >
                                Write Review
                              </Link>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>

                    {['pending', 'confirmed'].includes(ord.status) && (
                      <div className="pt-2 border-t border-neutral-100 dark:border-neutral-800 flex justify-end">
                        <button
                          type="button"
                          onClick={async () => {
                            if (!profile) return;
                            try {
                              await updateMarketplaceOrderStatus({
                                order: ord,
                                actorUid: firebaseUser.uid,
                                actorName: profile.displayName,
                                nextStatus: 'cancelled',
                                note: 'Cancelled by buyer',
                              });
                              toast.success('Order cancelled and stock restored.');
                              loadAll();
                            } catch (err) {
                              toast.error(formatFirebaseErrorMessage(err));
                            }
                          }}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:underline"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Cancel Order
                        </button>
                      </div>
                    )}
                    {ord.status === 'shipped' && (
                      <p className="text-[11px] text-blue-600 dark:text-blue-400 flex items-center gap-1.5">
                        <Truck className="w-3.5 h-3.5" /> On the way to {ord.shippingAddress?.district}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Dynamic Category Strip */}
            <div className="flex items-center gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                onClick={() => {
                  setCategoryFilter('All');
                  setSubcategoryFilter('All');
                }}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition-colors ${
                  categoryFilter === 'All'
                    ? 'bg-neutral-950 text-white border-neutral-950 dark:bg-white dark:text-neutral-950'
                    : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300'
                }`}
              >
                All Categories
              </button>
              {categories.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => {
                    setCategoryFilter(cat.name);
                    setSubcategoryFilter('All');
                  }}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap border transition-colors ${
                    categoryFilter === cat.name
                      ? 'bg-brand text-white border-brand'
                      : 'bg-white dark:bg-neutral-900 border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300'
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {selectedCatObj && selectedCatObj.subcategories.length > 0 && (
              <div className="flex items-center gap-1.5 overflow-x-auto">
                <button
                  type="button"
                  onClick={() => setSubcategoryFilter('All')}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${
                    subcategoryFilter === 'All'
                      ? 'bg-neutral-900 text-white dark:bg-white dark:text-neutral-900'
                      : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400'
                  }`}
                >
                  All {selectedCatObj.name}
                </button>
                {selectedCatObj.subcategories.map((sub) => (
                  <button
                    key={sub}
                    type="button"
                    onClick={() => setSubcategoryFilter(sub)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium ${
                      subcategoryFilter === sub
                        ? 'bg-brand/15 text-brand font-semibold'
                        : 'bg-neutral-100 dark:bg-neutral-900 text-neutral-600 dark:text-neutral-400'
                    }`}
                  >
                    {sub}
                  </button>
                ))}
              </div>
            )}

            {/* Search & Multi-Facet Filter Bar */}
            <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5">
              <div className="sm:col-span-4 relative">
                <Search className="w-4 h-4 text-neutral-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search products, brands, stores..."
                  className="w-full h-10 pl-9 pr-3 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs"
                />
              </div>
              <select
                value={conditionFilter}
                onChange={(e) => setConditionFilter(e.target.value)}
                className="sm:col-span-2 h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                <option value="All">Any Condition</option>
                <option value="New">New</option>
                <option value="Like New">Like New</option>
                <option value="Used">Used</option>
                <option value="Refurbished">Refurbished</option>
              </select>
              <select
                value={sellerFilter}
                onChange={(e) => setSellerFilter(e.target.value)}
                className="sm:col-span-2 h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
              >
                <option value="All">All Stores</option>
                {stores.map((s) => (
                  <option key={s.id} value={s.ownerId}>
                    {s.name}
                  </option>
                ))}
              </select>
              <div className="sm:col-span-2 grid grid-cols-2 gap-1.5">
                <input
                  type="number"
                  min={0}
                  value={minPrice}
                  onChange={(e) => setMinPrice(e.target.value)}
                  placeholder="Min ৳"
                  className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 text-xs font-mono"
                />
                <input
                  type="number"
                  min={0}
                  value={maxPrice}
                  onChange={(e) => setMaxPrice(e.target.value)}
                  placeholder="Max ৳"
                  className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-2.5 text-xs font-mono"
                />
              </div>
              <select
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as any)}
                className="sm:col-span-2 h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs font-medium"
              >
                <option value="newest">Sort: Newest</option>
                <option value="price_asc">Price: Low to High</option>
                <option value="price_desc">Price: High to Low</option>
                <option value="top_rated">Top Rated</option>
              </select>
            </div>

            {loading ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {[1, 2, 3, 4].map((k) => (
                  <div key={k} className="h-72 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
                ))}
              </div>
            ) : activeTab === 'browse' && !hasActiveFilter ? (
              <div className="space-y-8">
                {/* Popular Stores Strip */}
                {stores.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="font-display font-bold text-base flex items-center gap-2">
                      <Store className="w-4 h-4 text-brand" /> Popular Seller Stores
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
                      {stores.slice(0, 4).map((s) => (
                        <Link
                          key={s.id}
                          to={`/market/store/${s.id}`}
                          className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-3.5 flex items-center gap-3 hover:shadow-sm transition-shadow"
                        >
                          <div className="h-11 w-11 rounded-xl overflow-hidden bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center shrink-0">
                            {s.logoUrl ? (
                              <img loading="lazy" src={s.logoUrl} alt={s.name} className="w-full h-full object-cover" />
                            ) : (
                              <Store className="w-5 h-5 text-brand" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-display font-bold text-xs truncate">{s.name}</p>
                            <p className="text-[11px] text-neutral-500 truncate">
                              {s.district} · ★ {s.ratingAvg || 0} · {s.totalSales || 0} sales
                            </p>
                          </div>
                        </Link>
                      ))}
                    </div>
                  </section>
                )}

                {marketAd && (
                  <section>
                    <SponsoredAdCard
                      campaign={marketAd}
                      placement="marketplace"
                      variant="marketplace"
                      onDismiss={() => setMarketAd(null)}
                    />
                  </section>
                )}

                {recentlyViewedProducts.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="font-display font-bold text-base flex items-center gap-2">
                      <Clock className="w-4 h-4 text-neutral-500" /> Recently Viewed
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                      {recentlyViewedProducts.map(renderProductCard)}
                    </div>
                  </section>
                )}

                {recommendedProducts.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="font-display font-bold text-base flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-brand" /> Recommended For You
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                      {recommendedProducts.map(renderProductCard)}
                    </div>
                  </section>
                )}

                {trendingProducts.length > 0 && (
                  <section className="space-y-3">
                    <h2 className="font-display font-bold text-base flex items-center gap-2">
                      <TrendingUp className="w-4 h-4 text-emerald-600" /> Trending Products
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                      {trendingProducts.map(renderProductCard)}
                    </div>
                  </section>
                )}

                <section className="space-y-3">
                  <h2 className="font-display font-bold text-base">
                    All New Arrivals ({filtered.length})
                  </h2>
                  {filtered.length === 0 ? (
                    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-12 text-center space-y-3 bg-white dark:bg-neutral-900">
                      <ShoppingBag className="w-8 h-8 mx-auto text-neutral-400" />
                      <h3 className="font-display font-bold text-base">No active marketplace listings yet</h3>
                      <p className="text-xs text-neutral-500">
                        Be the first to open a store and publish a product on BANA Marketplace.
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                      {filtered.map(renderProductCard)}
                    </div>
                  )}
                </section>
              </div>
            ) : filtered.length === 0 ? (
              <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-12 text-center space-y-3 bg-white dark:bg-neutral-900">
                <ShoppingBag className="w-8 h-8 mx-auto text-neutral-400" />
                <h3 className="font-display font-bold text-base">
                  {activeTab === 'wishlist' ? 'Your wishlist is empty' : 'No matching products'}
                </h3>
                <p className="text-xs text-neutral-500">
                  {activeTab === 'wishlist'
                    ? 'Tap the bookmark icon on any product to save it for later.'
                    : 'Try adjusting your search keywords, price range, or category filter.'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
                {filtered.map(renderProductCard)}
              </div>
            )}
          </>
        )}
      </div>

      <CartDrawer
        isOpen={cartOpen}
        items={cart}
        onClose={() => setCartOpen(false)}
        onUpdateQty={(pid, nextQty) =>
          persistCart(cart.map((c) => (c.productId === pid ? { ...c, quantity: nextQty } : c)))
        }
        onRemoveItem={(pid) => persistCart(cart.filter((c) => c.productId !== pid))}
        onOrderSuccess={() => loadAll()}
      />

      <ListingFormModal
        isOpen={formOpen}
        editingListing={editingListing}
        categories={categories}
        sellerStore={myStore}
        onClose={() => setFormOpen(false)}
        onSaved={() => loadAll()}
      />

      <BoostAndPaymentModal
        isOpen={Boolean(boostModal)}
        mode={boostModal?.mode || 'marketplace_slot'}
        targetCollection={boostModal?.targetId ? 'marketplaceListings' : undefined}
        targetId={boostModal?.targetId}
        targetTitle={boostModal?.targetTitle}
        reasonBanner={boostModal?.reasonBanner}
        onClose={() => setBoostModal(null)}
        onSubmitted={() => loadAll()}
      />
    </AppShell>
  );
}
