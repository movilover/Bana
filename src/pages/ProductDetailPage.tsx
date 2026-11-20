import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bookmark,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Flag,
  MapPin,
  MessageSquare,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
  ThumbsUp,
  Truck,
  Upload,
} from 'lucide-react';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type {
  BanaMarketListing,
  BanaStore,
  CartItem,
  MarketplaceOrder,
  ProductReview,
} from '@/src/types/bana';
import {
  fetchEligibleReviewOrder,
  fetchProductReviews,
  fetchWishlistIds,
  loadUserCart,
  readGuestCart,
  saveUserCart,
  startOrOpenSellerChat,
  submitMarketplaceReport,
  submitVerifiedProductReview,
  toggleProductWishlist,
  toggleReviewHelpful,
  trackRecentlyViewedProduct,
} from '@/src/lib/marketplace';
import { AppShell } from '@/src/components/layout/AppShell';
import { Avatar, ResilientImage } from '@/src/components/common/Avatar';
import { CartDrawer } from '@/src/components/marketplace/CartDrawer';
import { compressImageFile, formatRelativeTime, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';

export function ProductDetailPage() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [product, setProduct] = useState<BanaMarketListing | null>(null);
  const [store, setStore] = useState<BanaStore | null>(null);
  const [related, setRelated] = useState<BanaMarketListing[]>([]);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [eligibleOrder, setEligibleOrder] = useState<MarketplaceOrder | null>(null);
  const [loading, setLoading] = useState(true);

  const [galleryIdx, setGalleryIdx] = useState(0);
  const [qty, setQty] = useState(1);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);
  const [isWished, setIsWished] = useState(false);

  // Review form state
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewFiles, setReviewFiles] = useState<File[]>([]);
  const [submittingReview, setSubmittingReview] = useState(false);

  // Report modal state
  const [reportTarget, setReportTarget] = useState<{
    type: 'product' | 'review';
    id: string;
    label: string;
  } | null>(null);
  const [reportReason, setReportReason] = useState('Misleading product details');
  const [reportDetails, setReportDetails] = useState('');

  useEffect(() => {
    if (!productId) return;
    let active = true;
    setLoading(true);
    setGalleryIdx(0);
    setQty(1);

    (async () => {
      try {
        const snap = await getDoc(doc(db, 'marketplaceListings', productId));
        if (!active) return;
        if (!snap.exists()) {
          setProduct(null);
          setLoading(false);
          return;
        }
        const prod = { id: snap.id, ...(snap.data() as Omit<BanaMarketListing, 'id'>) };
        setProduct(prod);
        trackRecentlyViewedProduct(prod.id);
        updateDoc(doc(db, 'marketplaceListings', prod.id), { viewsCount: increment(1) }).catch(() => {});

        const [revs, relSnap, storeSnap] = await Promise.all([
          fetchProductReviews(prod.id),
          getDocs(
            query(
              collection(db, 'marketplaceListings'),
              where('category', '==', prod.category),
              where('status', '==', 'active'),
              limit(8)
            )
          ).catch(() => null),
          prod.storeId ? getDoc(doc(db, 'stores', prod.storeId)).catch(() => null) : Promise.resolve(null),
        ]);

        if (!active) return;
        setReviews(revs);
        if (storeSnap?.exists()) {
          setStore({ id: storeSnap.id, ...(storeSnap.data() as Omit<BanaStore, 'id'>) });
        } else {
          setStore(null);
        }
        if (relSnap) {
          setRelated(
            relSnap.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<BanaMarketListing, 'id'>) }))
              .filter((r) => r.id !== prod.id)
              .slice(0, 4)
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [productId]);

  useEffect(() => {
    if (!firebaseUser) {
      setCart(readGuestCart());
      setIsWished(false);
      setEligibleOrder(null);
      return;
    }
    loadUserCart(firebaseUser.uid).then(setCart).catch(() => {});
    if (productId) {
      fetchWishlistIds(firebaseUser.uid)
        .then((ids) => setIsWished(ids.includes(productId)))
        .catch(() => {});
      fetchEligibleReviewOrder(firebaseUser.uid, productId)
        .then(setEligibleOrder)
        .catch(() => {});
    }
  }, [firebaseUser, productId]);

  const maxStock =
    product && typeof product.quantity === 'number'
      ? product.quantity
      : product?.status === 'active'
      ? 1
      : 0;
  const inStock = product?.status === 'active' && maxStock > 0;
  const isOwner = Boolean(firebaseUser && product && firebaseUser.uid === product.sellerId);

  const persistCart = async (next: CartItem[]) => {
    setCart(next);
    await saveUserCart(firebaseUser?.uid, next).catch(() => {});
  };

  const addCurrentToCart = async (openDrawer: boolean) => {
    if (!product || !inStock) return;
    if (isOwner) {
      toast.info('You cannot purchase your own listing.');
      return;
    }
    const existing = cart.find((c) => c.productId === product.id);
    const nextQty = Math.min(maxStock, (existing?.quantity || 0) + qty);
    const entry: CartItem = {
      productId: product.id,
      sellerId: product.sellerId,
      storeId: product.storeId || '',
      storeName: product.storeName || store?.name || product.sellerName,
      title: product.title,
      price: product.price,
      currency: product.currency,
      deliveryFee: Number(product.deliveryFee || 0),
      quantity: nextQty,
      imageUrl: product.imageUrls?.[0] || '',
      maxStock,
    };
    const next = existing
      ? cart.map((c) => (c.productId === product.id ? entry : c))
      : [...cart, entry];
    await persistCart(next);
    if (openDrawer) {
      setCartOpen(true);
    } else {
      toast.success('Added to your BANA cart.');
    }
  };

  const handleToggleWishlist = async () => {
    if (!firebaseUser || !product) {
      openAuthModal('Sign in to save items to your Wishlist.');
      return;
    }
    const next = await toggleProductWishlist(firebaseUser.uid, product.id, isWished);
    setIsWished(next);
    toast.success(next ? 'Saved to Wishlist.' : 'Removed from Wishlist.');
  };

  const handleChatSeller = async () => {
    if (!product) return;
    if (!firebaseUser || !profile) {
      openAuthModal(`Sign in to chat with ${product.sellerName}.`);
      return;
    }
    if (isOwner) return;
    const convId = await startOrOpenSellerChat({
      buyer: profile,
      sellerId: product.sellerId,
      sellerName: product.sellerName,
      sellerUsername: product.sellerUsername,
      sellerAvatar: product.sellerAvatar,
      initialMessage: `Hi ${product.sellerName}, I'm interested in "${product.title}" (${product.currency} ${product.price.toLocaleString()}).`,
    });
    navigate(`/messages/${convId}`);
  };

  const handleReviewSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile || !eligibleOrder || !product) return;
    if (reviewComment.trim().length < 5) {
      toast.error('Please write a brief review (at least 5 characters).');
      return;
    }
    setSubmittingReview(true);
    try {
      const imageUrls: string[] = [];
      for (let i = 0; i < reviewFiles.length; i++) {
        const comp = await compressImageFile(reviewFiles[i], 1200);
        const url = await uploadMediaWithProgress(
          `reviews/${firebaseUser.uid}/rev_${Date.now()}_${i}_${comp.name}`,
          comp
        );
        imageUrls.push(url);
      }
      const created = await submitVerifiedProductReview({
        reviewer: profile,
        order: eligibleOrder,
        product,
        rating: reviewRating,
        comment: reviewComment,
        imageUrls,
      });
      setReviews((prev) => [created, ...prev]);
      setEligibleOrder(null);
      setReviewComment('');
      setReviewFiles([]);
      toast.success('Verified purchase review published.');
    } catch (err) {
      toast.error(formatFirebaseErrorMessage(err));
    } finally {
      setSubmittingReview(false);
    }
  };

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            <div className="lg:col-span-7 aspect-square rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
            <div className="lg:col-span-5 h-96 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (!product) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
          <ShoppingBag className="w-10 h-10 mx-auto text-neutral-400" />
          <h1 className="font-display font-bold text-xl">Product not found</h1>
          <p className="text-xs text-neutral-500">
            This listing may have been removed or is no longer available.
          </p>
          <Link
            to="/market"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Marketplace
          </Link>
        </div>
      </AppShell>
    );
  }

  const images = product.imageUrls?.length ? product.imageUrls : [];

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 pb-24 lg:pb-10 space-y-10">
        {/* Top Breadcrumb + Cart Trigger */}
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2 text-xs text-neutral-500 min-w-0">
            <Link to="/market" className="inline-flex items-center gap-1 font-semibold text-neutral-800 dark:text-neutral-200 hover:underline">
              <ArrowLeft className="w-3.5 h-3.5" /> Marketplace
            </Link>
            <span>/</span>
            <span className="truncate">{product.category}</span>
            {product.subcategory && (
              <>
                <span>/</span>
                <span className="truncate">{product.subcategory}</span>
              </>
            )}
          </div>

          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
          >
            <ShoppingCart className="w-4 h-4 text-[#1877F2]" />
            <span>Cart</span>
            <span className="font-mono px-1.5 py-0.5 rounded bg-[#1877F2]/10 text-[#1877F2] tabular-nums">
              {cart.reduce((s, i) => s + i.quantity, 0)}
            </span>
          </button>
        </div>

        {/* Main PDP Two-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left: Media Gallery */}
          <div className="lg:col-span-7 space-y-3">
            <div className="relative aspect-[4/3] sm:aspect-square rounded-2xl overflow-hidden border border-neutral-200 dark:border-neutral-800 bg-neutral-100 dark:bg-neutral-950">
              <ResilientImage
                src={images[galleryIdx]}
                alt={product.title}
                fallbackLabel={product.category}
                className="w-full h-full object-cover"
              />
              {images.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={() => setGalleryIdx((i) => (i > 0 ? i - 1 : images.length - 1))}
                    aria-label="Previous image"
                    className="absolute left-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setGalleryIdx((i) => (i + 1) % images.length)}
                    aria-label="Next image"
                    className="absolute right-3 top-1/2 -translate-y-1/2 h-9 w-9 rounded-full bg-black/60 text-white flex items-center justify-center hover:bg-black/80"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </>
              )}
            </div>

            {images.length > 1 && (
              <div className="grid grid-cols-6 gap-2">
                {images.map((url, idx) => (
                  <button
                    key={url + idx}
                    type="button"
                    onClick={() => setGalleryIdx(idx)}
                    className={`aspect-square rounded-xl overflow-hidden border-2 transition-colors ${
                      galleryIdx === idx
                        ? 'border-[#1877F2]'
                        : 'border-transparent opacity-75 hover:opacity-100'
                    }`}
                  >
                    <img src={url} alt={`${product.title} view ${idx + 1}`} className="w-full h-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: Sticky Purchase Module */}
          <div className="lg:col-span-5 lg:sticky lg:top-20 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-5 shadow-sm">
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2 text-xs text-neutral-500">
                <span>
                  {product.category}
                  {product.subcategory ? ` · ${product.subcategory}` : ''} · {product.condition}
                </span>
                <span
                  className={`font-semibold ${
                    inStock ? 'text-emerald-600' : 'text-red-600'
                  }`}
                >
                  {inStock ? `In stock (${maxStock})` : product.status === 'draft' ? 'Draft' : 'Out of stock'}
                </span>
              </div>

              <h1 className="font-display font-extrabold text-2xl leading-tight text-neutral-950 dark:text-white">
                {product.title}
              </h1>

              <div className="flex items-center gap-3 pt-1">
                <p className="font-mono font-bold text-2xl tabular-nums text-neutral-950 dark:text-white">
                  {product.currency} {product.price.toLocaleString()}
                </p>
                {(product.reviewsCount || 0) > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 dark:text-neutral-300">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span className="font-mono tabular-nums">{product.ratingAvg}</span>
                    <span>({product.reviewsCount})</span>
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-2 py-3 border-y border-neutral-100 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300">
              <p className="flex items-center gap-2">
                <MapPin className="w-4 h-4 text-neutral-400 shrink-0" />
                <span>Ships from {product.location}</span>
              </p>
              <p className="flex items-center gap-2">
                <Truck className="w-4 h-4 text-neutral-400 shrink-0" />
                <span>
                  {(product.deliveryOptions || ['Standard Courier', 'Local Pickup']).join(', ')} ·{' '}
                  {Number(product.deliveryFee || 0) > 0
                    ? `Delivery fee ${product.currency} ${product.deliveryFee}`
                    : 'Free delivery'}
                </span>
              </p>
              <p className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>COD or verified bKash/Nagad · Authoritative order confirmation</span>
              </p>
            </div>

            {/* Purchase Controls */}
            {!isOwner && (
              <div className="space-y-3">
                {inStock && (
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
                      Quantity
                    </span>
                    <div className="inline-flex items-center rounded-xl border border-neutral-200 dark:border-neutral-700">
                      <button
                        type="button"
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>
                      <span className="px-4 text-xs font-mono font-bold tabular-nums">{qty}</span>
                      <button
                        type="button"
                        onClick={() => setQty((q) => Math.min(maxStock, q + 1))}
                        className="p-2 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    disabled={!inStock}
                    onClick={() => addCurrentToCart(false)}
                    className="h-11 rounded-xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-40"
                  >
                    Add to Cart
                  </button>
                  <button
                    type="button"
                    disabled={!inStock}
                    onClick={() => addCurrentToCart(true)}
                    className="h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-40"
                  >
                    Buy Now
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <button
                    type="button"
                    onClick={handleChatSeller}
                    className="h-10 rounded-xl bg-neutral-100 dark:bg-neutral-800 text-xs font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-neutral-200 dark:hover:bg-neutral-700"
                  >
                    <MessageSquare className="w-3.5 h-3.5 text-[#1877F2]" /> Chat with Seller
                  </button>
                  <button
                    type="button"
                    onClick={handleToggleWishlist}
                    className={`h-10 rounded-xl border text-xs font-semibold inline-flex items-center justify-center gap-1.5 ${
                      isWished
                        ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]'
                        : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300'
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${isWished ? 'fill-current' : ''}`} />
                    {isWished ? 'Wishlisted' : 'Save Wishlist'}
                  </button>
                </div>
              </div>
            )}

            {/* Seller & Store Card */}
            <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-950 p-3.5 space-y-2.5">
              {store ? (
                <Link
                  to={`/market/store/${store.id}`}
                  className="flex items-center justify-between gap-3 group"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="h-10 w-10 rounded-lg overflow-hidden bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center shrink-0">
                      {store.logoUrl ? (
                        <img src={store.logoUrl} alt={store.name} className="w-full h-full object-cover" />
                      ) : (
                        <Store className="w-5 h-5 text-[#1877F2]" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-bold truncate group-hover:underline">{store.name}</p>
                      <p className="text-[11px] text-neutral-500">
                        {store.district} · {store.totalSales || 0} sales · ★ {store.ratingAvg || 0}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-semibold text-[#1877F2] shrink-0">Visit Store</span>
                </Link>
              ) : (
                <Link to={`/profile/${product.sellerUsername}`} className="flex items-center gap-2.5">
                  <Avatar src={product.sellerAvatar} name={product.sellerName} size="sm" />
                  <div>
                    <p className="text-xs font-bold hover:underline">{product.sellerName}</p>
                    <p className="text-[11px] text-neutral-500">@{product.sellerUsername}</p>
                  </div>
                </Link>
              )}
            </div>

            <div>
              <h3 className="text-xs font-bold uppercase tracking-wide text-neutral-500 mb-1.5">
                Product Description
              </h3>
              <p className="text-sm text-neutral-700 dark:text-neutral-300 whitespace-pre-wrap leading-relaxed">
                {product.description}
              </p>
            </div>

            {!isOwner && (
              <button
                type="button"
                onClick={() => {
                  if (!firebaseUser) return openAuthModal('Sign in to report this product.');
                  setReportTarget({ type: 'product', id: product.id, label: product.title });
                }}
                className="inline-flex items-center gap-1.5 text-xs text-neutral-500 hover:text-red-600"
              >
                <Flag className="w-3.5 h-3.5" /> Report this listing
              </button>
            )}
          </div>
        </div>

        {/* Verified Purchase Reviews */}
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-100 dark:border-neutral-800 pb-4">
            <div>
              <h2 className="font-display font-bold text-lg">
                Verified Customer Reviews ({reviews.length})
              </h2>
              <p className="text-xs text-neutral-500">
                Only buyers with a confirmed delivered order can submit a review.
              </p>
            </div>
            {(product.reviewsCount || 0) > 0 && (
              <div className="flex items-center gap-2">
                <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
                <span className="font-mono font-bold text-xl tabular-nums">{product.ratingAvg}</span>
                <span className="text-xs text-neutral-500">/ 5.0</span>
              </div>
            )}
          </div>

          {eligibleOrder && (
            <form
              onSubmit={handleReviewSubmit}
              className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20 p-4 space-y-3"
            >
              <div className="flex items-center justify-between">
                <p className="text-xs font-bold flex items-center gap-1.5 text-[#1877F2]">
                  <CheckCircle2 className="w-4 h-4" /> Write a Verified Purchase Review (Order #
                  {eligibleOrder.id.slice(-8)})
                </p>
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setReviewRating(star)}
                      aria-label={`Rate ${star} stars`}
                      className="p-0.5"
                    >
                      <Star
                        className={`w-4 h-4 ${
                          star <= reviewRating
                            ? 'fill-amber-400 text-amber-400'
                            : 'text-neutral-300 dark:text-neutral-700'
                        }`}
                      />
                    </button>
                  ))}
                </div>
              </div>
              <textarea
                rows={3}
                required
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder="Share quality, fit, delivery speed, and seller communication..."
                className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-3 text-xs"
              />
              <div className="flex flex-wrap items-center justify-between gap-3">
                <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 text-xs cursor-pointer">
                  <Upload className="w-3.5 h-3.5" />
                  <span>
                    {reviewFiles.length > 0
                      ? `${reviewFiles.length} photo(s) selected`
                      : 'Add review photos (max 3)'}
                  </span>
                  <input
                    type="file"
                    multiple
                    accept="image/*"
                    onChange={(e) => setReviewFiles(Array.from(e.target.files || []).slice(0, 3))}
                    className="hidden"
                  />
                </label>
                <button
                  type="submit"
                  disabled={submittingReview}
                  className="px-4 py-2 rounded-xl bg-[#1877F2] text-white text-xs font-semibold disabled:opacity-50"
                >
                  {submittingReview ? 'Submitting...' : 'Publish Review'}
                </button>
              </div>
            </form>
          )}

          {reviews.length === 0 ? (
            <p className="text-xs text-neutral-500 py-4 text-center">
              No verified reviews yet for this product.
            </p>
          ) : (
            <div className="space-y-4">
              {reviews.map((rev) => {
                const votedHelpful = Boolean(firebaseUser && (rev.helpfulUserIds || []).includes(firebaseUser.uid));
                return (
                  <div
                    key={rev.id}
                    className="border-b border-neutral-100 dark:border-neutral-800 pb-4 last:border-0 last:pb-0 space-y-2"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5">
                        <Avatar src={rev.reviewerAvatar} name={rev.reviewerName} size="sm" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-semibold">{rev.reviewerName}</span>
                            <span className="text-[10px] font-semibold text-emerald-600 inline-flex items-center gap-0.5">
                              <CheckCircle2 className="w-3 h-3" /> Verified Purchase
                            </span>
                          </div>
                          <p className="text-[11px] text-neutral-500">
                            {formatRelativeTime(rev.createdAt)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-0.5">
                        {[1, 2, 3, 4, 5].map((s) => (
                          <Star
                            key={s}
                            className={`w-3.5 h-3.5 ${
                              s <= rev.rating
                                ? 'fill-amber-400 text-amber-400'
                                : 'text-neutral-200 dark:text-neutral-700'
                            }`}
                          />
                        ))}
                      </div>
                    </div>

                    <p className="text-xs text-neutral-700 dark:text-neutral-300 leading-relaxed">
                      {rev.comment}
                    </p>

                    {rev.imageUrls && rev.imageUrls.length > 0 && (
                      <div className="flex gap-2 pt-1">
                        {rev.imageUrls.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`Review ${idx + 1}`}
                            className="h-16 w-16 rounded-lg object-cover border border-neutral-200 dark:border-neutral-800"
                          />
                        ))}
                      </div>
                    )}

                    <div className="flex items-center gap-4 pt-1 text-[11px] text-neutral-500">
                      <button
                        type="button"
                        onClick={async () => {
                          if (!firebaseUser) return openAuthModal('Sign in to mark reviews helpful.');
                          await toggleReviewHelpful(rev, firebaseUser.uid);
                          const fresh = await fetchProductReviews(product.id);
                          setReviews(fresh);
                        }}
                        className={`inline-flex items-center gap-1 hover:text-neutral-900 dark:hover:text-white ${
                          votedHelpful ? 'text-[#1877F2] font-semibold' : ''
                        }`}
                      >
                        <ThumbsUp className="w-3 h-3" /> Helpful ({rev.helpfulCount || 0})
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (!firebaseUser) return openAuthModal('Sign in to report a review.');
                          setReportTarget({ type: 'review', id: rev.id, label: `Review by ${rev.reviewerName}` });
                        }}
                        className="inline-flex items-center gap-1 hover:text-red-600"
                      >
                        <Flag className="w-3 h-3" /> Report
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Related Products */}
        {related.length > 0 && (
          <section className="space-y-4">
            <h2 className="font-display font-bold text-lg">Related in {product.category}</h2>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              {related.map((rel) => (
                <Link
                  key={rel.id}
                  to={`/market/product/${rel.id}`}
                  className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden hover:shadow-md transition-shadow flex flex-col"
                >
                  <div className="aspect-[4/3] bg-neutral-100 dark:bg-neutral-950">
                    <ResilientImage
                      src={rel.imageUrls?.[0]}
                      alt={rel.title}
                      fallbackLabel={rel.category}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="p-3 space-y-1">
                    <p className="font-mono font-bold text-sm tabular-nums">
                      {rel.currency} {rel.price.toLocaleString()}
                    </p>
                    <p className="text-xs font-semibold line-clamp-1">{rel.title}</p>
                    <p className="text-[11px] text-neutral-500 truncate">{rel.location}</p>
                  </div>
                </Link>
              ))}
            </div>
          </section>
        )}
      </div>

      {/* Mobile Sticky Bottom Purchase Bar */}
      {!isOwner && (
        <div className="lg:hidden fixed bottom-16 inset-x-0 z-30 border-t border-neutral-200 dark:border-neutral-800 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-sm px-4 py-2.5 flex items-center justify-between gap-3">
          <div>
            <p className="font-mono font-bold text-sm tabular-nums">
              {product.currency} {product.price.toLocaleString()}
            </p>
            <p className="text-[10px] text-neutral-500">
              {inStock ? `${maxStock} available` : 'Out of stock'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={!inStock}
              onClick={() => addCurrentToCart(false)}
              className="px-3.5 h-9 rounded-xl border border-neutral-300 dark:border-neutral-700 text-xs font-semibold disabled:opacity-40"
            >
              Add to Cart
            </button>
            <button
              type="button"
              disabled={!inStock}
              onClick={() => addCurrentToCart(true)}
              className="px-4 h-9 rounded-xl bg-[#1877F2] text-white text-xs font-semibold disabled:opacity-40"
            >
              Buy Now
            </button>
          </div>
        </div>
      )}

      {/* Report Modal */}
      {reportTarget && (
        <div className="fixed inset-0 z-50 bg-black/55 flex items-center justify-center p-4">
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              if (!firebaseUser) return;
              await submitMarketplaceReport({
                reporterId: firebaseUser.uid,
                targetType: reportTarget.type,
                targetId: reportTarget.id,
                reason: reportReason,
                details: reportDetails || `Reported ${reportTarget.label}`,
              });
              setReportTarget(null);
              setReportDetails('');
              toast.success('Report submitted to BANA Marketplace Moderation.');
            }}
            className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 p-5 space-y-3"
          >
            <h3 className="font-display font-bold text-base">Report {reportTarget.label}</h3>
            <select
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
            >
              <option>Misleading product details</option>
              <option>Prohibited or counterfeit item</option>
              <option>Suspected scam or unsafe off-platform request</option>
              <option>Abusive or spam content</option>
            </select>
            <textarea
              rows={3}
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder="Provide any context for the moderation team..."
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setReportTarget(null)}
                className="px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-red-600 text-white text-xs font-semibold">
                Submit Report
              </button>
            </div>
          </form>
        </div>
      )}

      <CartDrawer
        isOpen={cartOpen}
        items={cart}
        onClose={() => setCartOpen(false)}
        onUpdateQty={(pid, nextQty) =>
          persistCart(cart.map((c) => (c.productId === pid ? { ...c, quantity: nextQty } : c)))
        }
        onRemoveItem={(pid) => persistCart(cart.filter((c) => c.productId !== pid))}
        onOrderSuccess={() => {
          if (firebaseUser) loadUserCart(firebaseUser.uid).then(setCart).catch(() => {});
        }}
      />
    </AppShell>
  );
}
