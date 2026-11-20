import React, { useState } from 'react';
import { BadgeCheck, Clock, Loader2, ShieldAlert, Store } from 'lucide-react';
import { useToast } from '@/src/contexts/ToastContext';
import { submitSellerApplication } from '@/src/lib/marketplace';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';
import {
  BANGLADESH_DISTRICTS,
  DEFAULT_PRODUCT_CATEGORIES,
  type BanaUser,
  type SellerApplication,
} from '@/src/types/bana';

interface Props {
  profile: BanaUser;
  application: SellerApplication | null;
  onSubmitted: (app: SellerApplication) => void;
}

/**
 * Prompt 07: sellers must be approved by BANA staff before a storefront can be created.
 * Shows the right state: apply form, pending, rejected (with reason + re-apply), approved.
 */
export function SellerApplicationPanel({ profile, application, onSubmitted }: Props) {
  const toast = useToast();
  const [storeName, setStoreName] = useState(application?.storeName || `${profile.displayName}'s Store`);
  const [storeDescription, setStoreDescription] = useState(application?.storeDescription || '');
  const [district, setDistrict] = useState(application?.district || 'Dhaka');
  const [categories, setCategories] = useState<string[]>(application?.productCategories || []);
  const [phone, setPhone] = useState(application?.contactPhone || '');
  const [email, setEmail] = useState(application?.contactEmail || '');
  const [businessType, setBusinessType] = useState<'individual' | 'registered_business'>(
    application?.businessType || 'individual'
  );
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reapply, setReapply] = useState(false);

  if (application?.status === 'pending') {
    return (
      <div className="rounded-2xl border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 p-5 max-w-2xl space-y-2">
        <div className="flex items-center gap-2 font-display font-bold text-base text-amber-800 dark:text-amber-300">
          <Clock className="w-5 h-5" /> Application under review
        </div>
        <p className="text-xs text-amber-900/80 dark:text-amber-200/80">
          Your seller application for <strong>{application.storeName}</strong> has been submitted. A BANA reviewer will
          approve or reject it and you will be notified. You can create your storefront as soon as it is approved.
        </p>
      </div>
    );
  }

  if (application?.status === 'approved') {
    return (
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50 dark:bg-emerald-950/20 p-5 max-w-2xl space-y-2">
        <div className="flex items-center gap-2 font-display font-bold text-base text-emerald-800 dark:text-emerald-300">
          <BadgeCheck className="w-5 h-5" /> Seller application approved
        </div>
        <p className="text-xs text-emerald-900/80 dark:text-emerald-200/80">
          You can now create your storefront.
        </p>
      </div>
    );
  }

  const showForm = !application || reapply;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await submitSellerApplication(profile, {
        storeName,
        storeDescription,
        district,
        productCategories: categories,
        contactPhone: phone,
        contactEmail: email,
        businessType,
        acceptedSellerPolicy: accepted,
      });
      toast.success('Seller application submitted for review.');
      setReapply(false);
      onSubmitted(saved);
    } catch (err: any) {
      toast.error(formatFirebaseErrorMessage(err) || err?.message || 'Could not submit application.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      {application?.status === 'rejected' && (
        <div className="rounded-2xl border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/20 p-4 space-y-2">
          <div className="flex items-center gap-2 font-semibold text-sm text-red-700 dark:text-red-300">
            <ShieldAlert className="w-4 h-4" /> Your previous application was not approved
          </div>
          {application.adminNote && (
            <p className="text-xs text-red-800/90 dark:text-red-200/80">Reviewer note: {application.adminNote}</p>
          )}
          {!reapply && (
            <button
              type="button"
              onClick={() => setReapply(true)}
              className="px-3 py-1.5 rounded-lg bg-[#1877F2] text-white text-xs font-semibold"
            >
              Edit &amp; re-apply
            </button>
          )}
        </div>
      )}

      {showForm && (
        <form
          onSubmit={submit}
          className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Store className="w-5 h-5 text-[#1877F2]" />
            <h3 className="font-display font-bold text-base">Apply to become a BANA seller</h3>
          </div>
          <p className="text-xs text-neutral-500">
            Tell us about your shop. Applications are reviewed by BANA staff before a storefront is created.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Store Name</label>
              <input
                required
                value={storeName}
                onChange={(e) => setStoreName(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Primary District</label>
              <select
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
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
            <label className="block text-xs font-medium mb-1">What do you plan to sell?</label>
            <textarea
              required
              minLength={10}
              rows={3}
              value={storeDescription}
              onChange={(e) => setStoreDescription(e.target.value)}
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-medium mb-1">Product categories</label>
            <div className="flex flex-wrap gap-1.5">
              {DEFAULT_PRODUCT_CATEGORIES.map((c) => {
                const name = (c as any).name || (c as any).label || String((c as any).id);
                const on = categories.includes(name);
                return (
                  <button
                    type="button"
                    key={name}
                    onClick={() => setCategories((cur) => (on ? cur.filter((x) => x !== name) : [...cur, name]))}
                    className={`px-2.5 py-1 rounded-full text-[11px] font-medium border ${
                      on
                        ? 'bg-[#1877F2] border-[#1877F2] text-white'
                        : 'border-neutral-200 dark:border-neutral-800 text-neutral-600 dark:text-neutral-300'
                    }`}
                  >
                    {name}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium mb-1">Seller type</label>
              <select
                value={businessType}
                onChange={(e) => setBusinessType(e.target.value as any)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 px-3 text-xs"
              >
                <option value="individual">Individual</option>
                <option value="registered_business">Registered business</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Contact phone (optional)</label>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
            </div>
            <div>
              <label className="block text-xs font-medium mb-1">Contact email (optional)</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 text-xs"
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              checked={accepted}
              onChange={(e) => setAccepted(e.target.checked)}
              className="mt-0.5 accent-[#1877F2]"
            />
            <span>
              I confirm that the information is accurate and I agree to the BANA seller policy (no prohibited or
              counterfeit items, honest listings, timely fulfilment).
            </span>
          </label>

          <button
            type="submit"
            disabled={busy || !accepted}
            className="h-10 px-5 rounded-xl bg-[#1877F2] text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center gap-2"
          >
            {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            Submit application
          </button>
        </form>
      )}
    </div>
  );
}
