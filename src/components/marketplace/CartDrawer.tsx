import React, { useEffect, useState } from 'react';
import {
  X,
  ShoppingBag,
  Trash2,
  Plus,
  Minus,
  Truck,
  ShieldCheck,
  CreditCard,
  CheckCircle2,
  AlertTriangle,
  Loader2,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  BANGLADESH_DISTRICTS,
  type CartItem,
  type OrderPaymentMethod,
  type OrderShippingAddress,
  type PaymentGatewayStatus,
} from '@/src/types/bana';
import {
  fetchPaymentGatewayStatus,
  placeMarketplaceOrder,
} from '@/src/lib/marketplace';
import { ResilientImage } from '@/src/components/common/Avatar';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';
import { CLOUD_FUNCTIONS_ENABLED } from '@/src/lib/firebasePlan';

interface CartDrawerProps {
  isOpen: boolean;
  items: CartItem[];
  onClose: () => void;
  onUpdateQty: (productId: string, nextQty: number) => void;
  onRemoveItem: (productId: string) => void;
  onOrderSuccess: (orderIds: string[]) => void;
}

export function CartDrawer({
  isOpen,
  items,
  onClose,
  onUpdateQty,
  onRemoveItem,
  onOrderSuccess,
}: CartDrawerProps) {
  const { firebaseUser, profile, openAuthModal } = useAuth();
  const toast = useToast();

  const [step, setStep] = useState<'cart' | 'checkout' | 'confirmed'>('cart');
  const [deliveryOption, setDeliveryOption] = useState<'Standard Courier' | 'Local Pickup'>('Standard Courier');
  const [paymentMethod, setPaymentMethod] = useState<OrderPaymentMethod>('cod');
  const [paymentRef, setPaymentRef] = useState('');
  const [senderAccount, setSenderAccount] = useState('');
  const [gatewayStatus, setGatewayStatus] = useState<PaymentGatewayStatus | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmedOrderIds, setConfirmedOrderIds] = useState<string[]>([]);

  const [address, setAddress] = useState<OrderShippingAddress>({
    fullName: '',
    phone: '',
    district: 'Dhaka',
    addressLine: '',
    postalCode: '',
    notes: '',
  });

  useEffect(() => {
    if (!isOpen) return;
    setError(null);
    if (items.length > 0 && step === 'confirmed') {
      setStep('cart');
    }
    if (profile && !address.fullName) {
      setAddress((prev) => ({
        ...prev,
        fullName: profile.displayName || '',
        district:
          profile.location && BANGLADESH_DISTRICTS.includes(profile.location)
            ? profile.location
            : prev.district,
      }));
    }
    fetchPaymentGatewayStatus()
      .then((gw) => {
        setGatewayStatus(gw);
        if (!gw.codEnabled && gw.manualMobileBankingEnabled) {
          setPaymentMethod('bkash');
        }
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const currency = items[0]?.currency || 'BDT';
  const subtotal = items.reduce((sum, i) => sum + Number(i.price) * Number(i.quantity), 0);

  // Per-seller highest delivery fee matches backend order-splitting calculation
  const sellerFees = new Map<string, number>();
  items.forEach((item) => {
    const prev = sellerFees.get(item.sellerId) || 0;
    sellerFees.set(item.sellerId, Math.max(prev, Number(item.deliveryFee || 0)));
  });
  const estimatedDeliveryFee =
    deliveryOption === 'Local Pickup'
      ? 0
      : Array.from(sellerFees.values()).reduce((s, f) => s + f, 0);
  const estimatedTotal = subtotal + estimatedDeliveryFee;

  const onlineGatewayReady = Boolean(
    gatewayStatus &&
      (gatewayStatus.sslcommerzConfigured ||
        gatewayStatus.stripeConfigured ||
        gatewayStatus.bkashGatewayConfigured ||
        gatewayStatus.nagadGatewayConfigured)
  );

  const handleCheckoutSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) {
      openAuthModal('Sign in to complete your BANA Marketplace order.');
      return;
    }
    if (items.length === 0) return;
    if (!address.fullName.trim() || !address.phone.trim() || !address.addressLine.trim()) {
      setError('Please enter your full name, phone number, and street address.');
      return;
    }
    if ((paymentMethod === 'bkash' || paymentMethod === 'nagad') && !paymentRef.trim()) {
      setError('Enter your bKash/Nagad Transaction ID (TrxID) so the seller/admin can verify payment.');
      return;
    }

    setSubmitting(true);
    setError(null);
    const idempotencyKey = `ord_${firebaseUser.uid.slice(0, 8)}_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 7)}`;

    try {
      const res = await placeMarketplaceOrder({
        buyerProfile: profile,
        idempotencyKey,
        items,
        shippingAddress: {
          fullName: address.fullName.trim(),
          phone: address.phone.trim(),
          district: address.district.trim(),
          addressLine: address.addressLine.trim(),
          postalCode: address.postalCode?.trim() || '',
          notes: address.notes?.trim() || '',
        },
        paymentMethod,
        deliveryOption,
        paymentRef: paymentRef.trim(),
        senderAccount: senderAccount.trim(),
      });

      setConfirmedOrderIds(res.orderIds);
      setStep('confirmed');
      setPaymentRef('');
      setSenderAccount('');
      toast.success(`Order placed (${res.orderIds.length} seller order${res.orderIds.length > 1 ? 's' : ''}).`);
      onOrderSuccess(res.orderIds);
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-[1px] flex justify-end">
      <div
        className="w-full max-w-md bg-white dark:bg-neutral-950 border-l border-neutral-200 dark:border-neutral-800 h-full flex flex-col shadow-2xl"
        role="dialog"
        aria-label="Shopping Cart"
      >
        <div className="px-5 py-4 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-[#1877F2]" />
            <div>
              <h2 className="font-display font-bold text-base">
                {step === 'cart'
                  ? `Shopping Cart (${items.reduce((s, i) => s + i.quantity, 0)})`
                  : step === 'checkout'
                  ? 'Secure Checkout'
                  : 'Order Confirmed'}
              </h2>
              <p className="text-[11px] text-neutral-500">
                Prices & inventory are verified before confirmation
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Cart"
            className="p-2 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {step === 'confirmed' ? (
            <div className="py-10 text-center space-y-4">
              <div className="mx-auto h-14 w-14 rounded-full bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 flex items-center justify-center">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <div className="space-y-1">
                <h3 className="font-display font-bold text-lg">Thank you for your order</h3>
                <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                  Your order has been saved and inventory updated. Track delivery or contact your seller anytime in My Orders.
                </p>
              </div>
              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-left space-y-1">
                <p className="text-[11px] font-semibold text-neutral-500">Order Reference(s)</p>
                {confirmedOrderIds.map((oid) => (
                  <p key={oid} className="text-xs font-mono text-neutral-900 dark:text-neutral-100 truncate">
                    #{oid}
                  </p>
                ))}
              </div>
              <div className="flex flex-col gap-2 pt-2">
                <Link
                  to="/market?tab=orders"
                  onClick={onClose}
                  className="w-full h-10 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold flex items-center justify-center"
                >
                  Track My Orders
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    setStep('cart');
                    onClose();
                  }}
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-medium"
                >
                  Continue Shopping
                </button>
              </div>
            </div>
          ) : items.length === 0 ? (
            <div className="py-16 text-center space-y-3">
              <ShoppingBag className="w-10 h-10 mx-auto text-neutral-300 dark:text-neutral-700" />
              <h3 className="font-display font-bold text-base">Your cart is empty</h3>
              <p className="text-xs text-neutral-500 max-w-xs mx-auto">
                Add items from verified BANA sellers and stores to check out seamlessly.
              </p>
            </div>
          ) : step === 'cart' ? (
            <div className="space-y-3">
              {items.map((item) => {
                const max = item.maxStock && item.maxStock > 0 ? item.maxStock : 99;
                return (
                  <div
                    key={item.productId}
                    className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3 flex gap-3 bg-white dark:bg-neutral-900"
                  >
                    <Link
                      to={`/market/product/${item.productId}`}
                      onClick={onClose}
                      className="h-20 w-20 rounded-lg overflow-hidden bg-neutral-100 dark:bg-neutral-950 shrink-0"
                    >
                      <ResilientImage
                        src={item.imageUrl}
                        alt={item.title}
                        fallbackLabel="Product"
                        className="w-full h-full object-cover"
                      />
                    </Link>
                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <Link
                          to={`/market/product/${item.productId}`}
                          onClick={onClose}
                          className="text-xs font-semibold line-clamp-2 hover:underline"
                        >
                          {item.title}
                        </Link>
                        {item.storeName && (
                          <p className="text-[11px] text-neutral-500 mt-0.5 truncate">{item.storeName}</p>
                        )}
                      </div>
                      <div className="flex items-center justify-between pt-2">
                        <span className="font-mono font-bold text-xs tabular-nums">
                          {item.currency} {(item.price * item.quantity).toLocaleString()}
                        </span>
                        <div className="flex items-center gap-1.5">
                          <div className="inline-flex items-center rounded-lg border border-neutral-200 dark:border-neutral-700">
                            <button
                              type="button"
                              onClick={() =>
                                item.quantity > 1
                                  ? onUpdateQty(item.productId, item.quantity - 1)
                                  : onRemoveItem(item.productId)
                              }
                              aria-label="Decrease quantity"
                              className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800"
                            >
                              <Minus className="w-3 h-3" />
                            </button>
                            <span className="px-2 text-xs font-mono tabular-nums">{item.quantity}</span>
                            <button
                              type="button"
                              disabled={item.quantity >= max}
                              onClick={() => onUpdateQty(item.productId, item.quantity + 1)}
                              aria-label="Increase quantity"
                              className="p-1.5 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-40"
                            >
                              <Plus className="w-3 h-3" />
                            </button>
                          </div>
                          <button
                            type="button"
                            onClick={() => onRemoveItem(item.productId)}
                            aria-label="Remove item"
                            className="p-1.5 text-neutral-400 hover:text-red-600"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}

              <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 p-3.5 space-y-2 bg-neutral-50/70 dark:bg-neutral-900">
                <p className="text-xs font-semibold flex items-center gap-1.5">
                  <Truck className="w-3.5 h-3.5 text-[#1877F2]" /> Delivery Option
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {(['Standard Courier', 'Local Pickup'] as const).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setDeliveryOption(opt)}
                      className={`px-3 py-2 rounded-lg text-xs font-medium border text-left transition-colors ${
                        deliveryOption === opt
                          ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]'
                          : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-400'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <form id="bana-checkout-form" onSubmit={handleCheckoutSubmit} className="space-y-4">
              <div className="space-y-2.5">
                <h3 className="font-display font-bold text-xs uppercase tracking-wide text-neutral-500">
                  Shipping Details
                </h3>
                <input
                  type="text"
                  required
                  value={address.fullName}
                  onChange={(e) => setAddress({ ...address, fullName: e.target.value })}
                  placeholder="Recipient Full Name"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="tel"
                    required
                    value={address.phone}
                    onChange={(e) => setAddress({ ...address, phone: e.target.value })}
                    placeholder="Phone (+8801...)"
                    className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs font-mono"
                  />
                  <select
                    value={address.district}
                    onChange={(e) => setAddress({ ...address, district: e.target.value })}
                    className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 px-3 text-xs"
                  >
                    {BANGLADESH_DISTRICTS.filter((d) => d !== 'All Districts').map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                </div>
                <textarea
                  required
                  rows={2}
                  value={address.addressLine}
                  onChange={(e) => setAddress({ ...address, addressLine: e.target.value })}
                  placeholder="House, Road, Area / Pickup landmark"
                  className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs"
                />
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    value={address.postalCode || ''}
                    onChange={(e) => setAddress({ ...address, postalCode: e.target.value })}
                    placeholder="Postal Code (optional)"
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                  />
                  <input
                    type="text"
                    value={address.notes || ''}
                    onChange={(e) => setAddress({ ...address, notes: e.target.value })}
                    placeholder="Delivery note (optional)"
                    className="w-full h-9 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
                  />
                </div>
              </div>

              <div className="space-y-2.5 pt-2 border-t border-neutral-100 dark:border-neutral-800">
                <h3 className="font-display font-bold text-xs uppercase tracking-wide text-neutral-500 flex items-center gap-1.5">
                  <CreditCard className="w-3.5 h-3.5" /> Payment Method
                </h3>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={gatewayStatus ? !gatewayStatus.codEnabled : false}
                    onClick={() => setPaymentMethod('cod')}
                    className={`p-2.5 rounded-xl border text-left text-xs font-medium disabled:opacity-40 ${
                      paymentMethod === 'cod'
                        ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]'
                        : 'border-neutral-200 dark:border-neutral-800'
                    }`}
                  >
                    Cash on Delivery
                  </button>
                  <button
                    type="button"
                    disabled={gatewayStatus ? !gatewayStatus.manualMobileBankingEnabled : false}
                    onClick={() => setPaymentMethod('bkash')}
                    className={`p-2.5 rounded-xl border text-left text-xs font-medium disabled:opacity-40 ${
                      paymentMethod === 'bkash'
                        ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]'
                        : 'border-neutral-200 dark:border-neutral-800'
                    }`}
                  >
                    bKash Verification
                  </button>
                  <button
                    type="button"
                    disabled={gatewayStatus ? !gatewayStatus.manualMobileBankingEnabled : false}
                    onClick={() => setPaymentMethod('nagad')}
                    className={`p-2.5 rounded-xl border text-left text-xs font-medium disabled:opacity-40 ${
                      paymentMethod === 'nagad'
                        ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]'
                        : 'border-neutral-200 dark:border-neutral-800'
                    }`}
                  >
                    Nagad Verification
                  </button>
                  <button
                    type="button"
                    disabled={!onlineGatewayReady}
                    onClick={() => setPaymentMethod('card_gateway')}
                    className={`p-2.5 rounded-xl border text-left text-xs font-medium disabled:opacity-45 ${
                      paymentMethod === 'card_gateway'
                        ? 'border-[#1877F2] bg-[#1877F2]/5 text-[#1877F2]'
                        : 'border-neutral-200 dark:border-neutral-800'
                    }`}
                  >
                    Online Card Gateway
                    {!onlineGatewayReady && (
                      <span className="block text-[10px] text-neutral-400 font-normal">
                        Server keys not configured
                      </span>
                    )}
                  </button>
                </div>

                {(paymentMethod === 'bkash' || paymentMethod === 'nagad') && (
                  <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 space-y-2">
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-300">
                      Payments stay in <strong>awaiting_verification</strong> until confirmed by a Finance Administrator. BANA never marks transactions paid automatically.
                    </p>
                    <input
                      type="text"
                      required
                      value={senderAccount}
                      onChange={(e) => setSenderAccount(e.target.value)}
                      placeholder={`Your ${paymentMethod === 'bkash' ? 'bKash' : 'Nagad'} Account Number`}
                      className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-xs font-mono"
                    />
                    <input
                      type="text"
                      required
                      value={paymentRef}
                      onChange={(e) => setPaymentRef(e.target.value)}
                      placeholder="Transaction ID (TrxID)"
                      className="w-full h-9 rounded-lg border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-xs font-mono"
                    />
                  </div>
                )}

                {!onlineGatewayReady && (
                  <p className="text-[11px] text-neutral-500 flex items-center gap-1.5">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                    {CLOUD_FUNCTIONS_ENABLED
                      ? 'Card details are never stored on BANA. Instant online card checkout activates once SSLCommerz/Stripe server secrets are configured.'
                      : 'Running on Firebase Spark Free Plan: automated card webhooks require Blaze Cloud Functions + gateway secrets. Cash on Delivery and manual bKash/Nagad TrxID verification are fully supported.'}
                  </p>
                )}
              </div>
            </form>
          )}
        </div>

        {items.length > 0 && step !== 'confirmed' && (
          <div className="p-5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/70 dark:bg-neutral-900/60 space-y-3">
            <div className="space-y-1 text-xs">
              <div className="flex justify-between text-neutral-500">
                <span>Subtotal</span>
                <span className="font-mono tabular-nums">
                  {currency} {subtotal.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-neutral-500">
                <span>Delivery ({deliveryOption})</span>
                <span className="font-mono tabular-nums">
                  {currency} {estimatedDeliveryFee.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between font-bold text-sm pt-1 border-t border-neutral-200 dark:border-neutral-800">
                <span>Estimated Total</span>
                <span className="font-mono tabular-nums">
                  {currency} {estimatedTotal.toLocaleString()}
                </span>
              </div>
            </div>

            {step === 'cart' ? (
              <button
                type="button"
                onClick={() => {
                  if (!firebaseUser) {
                    openAuthModal('Sign in to proceed to checkout.');
                    return;
                  }
                  setStep('checkout');
                }}
                className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold transition-colors"
              >
                Proceed to Checkout
              </button>
            ) : (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep('cart')}
                  disabled={submitting}
                  className="px-4 h-11 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-medium"
                >
                  Back
                </button>
                <button
                  type="submit"
                  form="bana-checkout-form"
                  disabled={submitting}
                  className="flex-1 h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold flex items-center justify-center gap-2 disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Confirming Order...
                    </>
                  ) : (
                    `Place Order · ${currency} ${estimatedTotal.toLocaleString()}`
                  )}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
