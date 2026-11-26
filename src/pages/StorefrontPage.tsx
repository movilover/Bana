import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Flag,
  MapPin,
  MessageSquare,
  Phone,
  ShieldAlert,
  ShoppingBag,
  ShoppingCart,
  Star,
  Store,
} from 'lucide-react';
import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { BanaMarketListing, BanaStore, CartItem, ProductReview } from '@/src/types/bana';
import {
  loadUserCart,
  readGuestCart,
  saveUserCart,
  startOrOpenSellerChat,
  submitMarketplaceReport,
} from '@/src/lib/marketplace';
import { AppShell } from '@/src/components/layout/AppShell';
import { Avatar, ResilientImage } from '@/src/components/common/Avatar';
import { CartDrawer } from '@/src/components/marketplace/CartDrawer';
import { formatRelativeTime } from '@/src/lib/mediaUtils';

export function StorefrontPage() {
  const { storeId } = useParams<{ storeId: string }>();
  const navigate = useNavigate();
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [store, setStore] = useState<BanaStore | null>(null);
  const [products, setProducts] = useState<BanaMarketListing[]>([]);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [cart, setCart] = useState<CartItem[]>([]);
  const [cartOpen, setCartOpen] = useState(false);

  useEffect(() => {
    if (!storeId) return;
    let active = true;
    setLoading(true);
    (async () => {
      try {
        const sSnap = await getDoc(doc(db, 'stores', storeId));
        if (!active) return;
        if (!sSnap.exists()) {
          setStore(null);
          setLoading(false);
          return;
        }
        const st = { id: sSnap.id, ...(sSnap.data() as Omit<BanaStore, 'id'>) };
        setStore(st);

        const [pSnap, rSnap] = await Promise.all([
          getDocs(
            query(
              collection(db, 'marketplaceListings'),
              where('sellerId', '==', st.ownerId),
              where('status', '==', 'active'),
              limit(40)
            )
          ).catch(() => null),
          getDocs(
            query(
              collection(db, 'productReviews'),
              where('storeId', '==', st.id),
              where('status', '==', 'active'),
              limit(25)
            )
          ).catch(() => null),
        ]);

        if (!active) return;
        if (pSnap) {
          setProducts(pSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<BanaMarketListing, 'id'>) })));
        }
        if (rSnap) {
          setReviews(rSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductReview, 'id'>) })));
        }
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => {
      active = false;
    };
  }, [storeId]);

  useEffect(() => {
    if (!firebaseUser) {
      setCart(readGuestCart());
      return;
    }
    loadUserCart(firebaseUser.uid).then(setCart).catch(() => {});
  }, [firebaseUser]);

  const persistCart = async (next: CartItem[]) => {
    setCart(next);
    await saveUserCart(firebaseUser?.uid, next).catch(() => {});
  };

  if (loading) {
    return (
      <AppShell>
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8 space-y-6">
          <div className="h-56 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((k) => (
              <div key={k} className="h-64 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
            ))}
          </div>
        </div>
      </AppShell>
    );
  }

  if (!store) {
    return (
      <AppShell>
        <div className="max-w-xl mx-auto px-4 py-16 text-center space-y-4">
          <Store className="w-10 h-10 mx-auto text-neutral-400" />
          <h1 className="font-display font-bold text-xl">Seller Store not found</h1>
          <Link
            to="/market"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold"
          >
            <ArrowLeft className="w-4 h-4" /> Back to Marketplace
          </Link>
        </div>
      </AppShell>
    );
  }

  const isOwner = firebaseUser?.uid === store.ownerId;

  return (
    <AppShell>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-8">
        <div className="flex items-center justify-between gap-4">
          <Link
            to="/market"
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-neutral-600 dark:text-neutral-300 hover:underline"
          >
            <ArrowLeft className="w-4 h-4" /> All Marketplace
          </Link>
          <button
            type="button"
            onClick={() => setCartOpen(true)}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-xs font-semibold"
          >
            <ShoppingCart className="w-4 h-4 text-brand" />
            <span>Cart</span>
            <span className="font-mono px-1.5 py-0.5 rounded bg-brand/10 text-brand tabular-nums">
              {cart.reduce((s, i) => s + i.quantity, 0)}
            </span>
          </button>
        </div>

        {store.status !== 'active' && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/30 p-3.5 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 shrink-0" />
            <span>
              This store is currently <strong>{store.status}</strong> by marketplace moderation.
              {store.restrictionNote ? ` Note: ${store.restrictionNote}` : ''}
            </span>
          </div>
        )}

        {/* Store Header Card */}
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm">
          <div className="h-44 sm:h-56 bg-neutral-100 dark:bg-neutral-950">
            <ResilientImage
              src={store.coverUrl}
              alt={store.name}
              fallbackLabel={store.name}
              className="w-full h-full object-cover"
            />
          </div>
          <div className="p-5 sm:p-6 flex flex-col sm:flex-row sm:items-end justify-between gap-4 -mt-10 sm:-mt-12">
            <div className="flex items-end gap-4">
              <div className="h-20 w-20 sm:h-24 sm:w-24 rounded-2xl border-4 border-white dark:border-neutral-900 overflow-hidden bg-white dark:bg-neutral-800 shadow-md shrink-0 flex items-center justify-center">
                {store.logoUrl ? (
                  <img loading="lazy" src={store.logoUrl} alt={store.name} className="w-full h-full object-cover" />
                ) : (
                  <Store className="w-8 h-8 text-brand" />
                )}
              </div>
              <div className="pt-10 sm:pt-12 space-y-1">
                <h1 className="font-display font-extrabold text-xl sm:text-2xl">{store.name}</h1>
                <p className="text-xs text-neutral-500 flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1">
                    <MapPin className="w-3.5 h-3.5" /> {store.district}
                  </span>
                  <span>·</span>
                  <span className="inline-flex items-center gap-1">
                    <Star className="w-3.5 h-3.5 fill-amber-400 text-amber-400" />
                    <span className="font-mono">{store.ratingAvg || 0}</span> ({store.reviewsCount || 0} reviews)
                  </span>
                  <span>·</span>
                  <span className="font-mono">{store.totalSales || 0} completed sales</span>
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!isOwner && (
                <>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!firebaseUser || !profile) {
                        openAuthModal(`Sign in to chat with ${store.name}.`);
                        return;
                      }
                      const convId = await startOrOpenSellerChat({
                        buyer: profile,
                        sellerId: store.ownerId,
                        sellerName: store.ownerName,
                        sellerUsername: store.ownerUsername,
                        sellerAvatar: store.logoUrl,
                        initialMessage: `Hi ${store.name}, I have a question about your store products.`,
                      });
                      navigate(`/messages/${convId}`);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold"
                  >
                    <MessageSquare className="w-3.5 h-3.5" /> Chat with Store
                  </button>
                  {store.contactPhone && (store.contactPreference === 'phone' || store.contactPreference === 'both') && (
                    <span className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-mono">
                      <Phone className="w-3.5 h-3.5 text-neutral-500" /> {store.contactPhone}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={async () => {
                      if (!firebaseUser) return openAuthModal('Sign in to report this store.');
                      await submitMarketplaceReport({
                        reporterId: firebaseUser.uid,
                        targetType: 'store',
                        targetId: store.id,
                        reason: 'Store policy review',
                        details: `Reported store ${store.name}`,
                      });
                      toast.success('Store report submitted.');
                    }}
                    className="p-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-neutral-500 hover:text-red-600"
                    title="Report Store"
                  >
                    <Flag className="w-4 h-4" />
                  </button>
                </>
              )}
              {isOwner && (
                <Link
                  to="/market?tab=seller"
                  className="px-4 py-2 rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-xs font-semibold"
                >
                  Manage in Seller Dashboard
                </Link>
              )}
            </div>
          </div>
          {store.description && (
            <p className="px-6 pb-5 text-xs text-neutral-600 dark:text-neutral-400 border-t border-neutral-100 dark:border-neutral-800 pt-3">
              {store.description}
            </p>
          )}
        </div>

        {/* Store Catalog */}
        <section className="space-y-4">
          <h2 className="font-display font-bold text-lg">Store Catalog ({products.length})</h2>
          {products.length === 0 ? (
            <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-10 text-center space-y-2 bg-white dark:bg-neutral-900">
              <ShoppingBag className="w-8 h-8 mx-auto text-neutral-400" />
              <p className="text-xs text-neutral-500">No active products listed in this store right now.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
              {products.map((item) => {
                const stock = typeof item.quantity === 'number' ? item.quantity : 1;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 overflow-hidden shadow-sm hover:shadow-md transition-shadow flex flex-col"
                  >
                    <Link to={`/market/product/${item.id}`} className="aspect-[4/3] bg-neutral-100 dark:bg-neutral-950">
                      <ResilientImage
                        src={item.imageUrls?.[0]}
                        alt={item.title}
                        fallbackLabel={item.category}
                        className="w-full h-full object-cover"
                      />
                    </Link>
                    <div className="p-4 flex-1 flex flex-col justify-between space-y-3">
                      <div>
                        <p className="font-mono font-bold text-base tabular-nums">
                          {item.currency} {item.price.toLocaleString()}
                        </p>
                        <Link
                          to={`/market/product/${item.id}`}
                          className="font-display font-semibold text-sm line-clamp-1 hover:underline"
                        >
                          {item.title}
                        </Link>
                        <p className="text-xs text-neutral-500 mt-0.5">
                          {item.category} · {stock > 0 ? `${stock} in stock` : 'Out of stock'}
                        </p>
                      </div>
                      {!isOwner && (
                        <button
                          type="button"
                          disabled={stock <= 0}
                          onClick={async () => {
                            const existing = cart.find((c) => c.productId === item.id);
                            const nextQty = Math.min(stock, (existing?.quantity || 0) + 1);
                            const nextEntry: CartItem = {
                              productId: item.id,
                              sellerId: item.sellerId,
                              storeId: store.id,
                              storeName: store.name,
                              title: item.title,
                              price: item.price,
                              currency: item.currency,
                              deliveryFee: Number(item.deliveryFee || 0),
                              quantity: nextQty,
                              imageUrl: item.imageUrls?.[0] || '',
                              maxStock: stock,
                            };
                            const next = existing
                              ? cart.map((c) => (c.productId === item.id ? nextEntry : c))
                              : [...cart, nextEntry];
                            await persistCart(next);
                            toast.success('Added to cart.');
                          }}
                          className="w-full h-9 rounded-xl bg-brand hover:bg-brand-hover text-white text-xs font-semibold disabled:opacity-40"
                        >
                          Add to Cart
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* Store Reviews */}
        {reviews.length > 0 && (
          <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 space-y-4">
            <h2 className="font-display font-bold text-lg">Store Verified Reviews ({reviews.length})</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {reviews.map((rev) => (
                <div key={rev.id} className="rounded-xl border border-neutral-100 dark:border-neutral-800 p-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Avatar src={rev.reviewerAvatar} name={rev.reviewerName} size="xs" />
                      <span className="text-xs font-semibold">{rev.reviewerName}</span>
                    </div>
                    <span className="text-[11px] font-mono text-amber-500">★ {rev.rating}.0</span>
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-300">{rev.comment}</p>
                  <p className="text-[10px] text-neutral-400">{formatRelativeTime(rev.createdAt)}</p>
                </div>
              ))}
            </div>
          </section>
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
        onOrderSuccess={() => {
          if (firebaseUser) loadUserCart(firebaseUser.uid).then(setCart).catch(() => {});
        }}
      />
    </AppShell>
  );
}
