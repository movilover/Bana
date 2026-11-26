import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, ChevronLeft, Clock, Copy, Info, Loader2, ShieldCheck, XCircle } from 'lucide-react';
import { AppShell } from '@/src/components/layout/AppShell';
import { VerificationRequestModal } from '@/src/components/social/VerificationRequestModal';
import { VerificationStatusPill } from '@/src/components/verification/VerificationStatusPill';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import { useLiveVerified } from '@/src/lib/verifiedStatus';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import {
  VerificationSubmitError,
  canSubmitNewClaim,
  formatMoney,
  resolveUserState,
  subscribeMyVerification,
  subscribeVerificationConfig,
  submitPaidVerification,
  validateSubmission,
  type SubmissionErrors,
} from '@/src/lib/paidVerification';
import {
  PAYMENT_METHOD_IDS,
  PAYMENT_METHOD_LABELS,
  STATUS_LABELS,
  type PaidVerificationApplication,
  type PaymentMethodId,
  type VerificationConfig,
  type VerificationStatusDoc,
} from '@/src/types/paidVerification';

const BENEFITS = [
  'A verified badge beside your name on your profile, posts, comments and Reels.',
  'A clear signal to other members that your account has been reviewed by BANA.',
  'Status tracked in one place, with a full history of your applications.',
];

const card = 'rounded-[12px] border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 shadow-sm';
const input =
  'w-full rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-950 px-3.5 py-2.5 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/20';

export function VerificationPage() {
  const { firebaseUser, profile, refreshProfile } = useAuth();
  const toast = useToast();
  const uid = firebaseUser?.uid || '';
  const liveVerified = useLiveVerified(uid);

  const [config, setConfig] = useState<VerificationConfig | null>(null);
  const [configLoaded, setConfigLoaded] = useState(false);
  const [statusDoc, setStatusDoc] = useState<VerificationStatusDoc | null>(null);
  const [apps, setApps] = useState<PaidVerificationApplication[]>([]);
  const [loadError, setLoadError] = useState(false);
  const [legacyOpen, setLegacyOpen] = useState(false);

  const [method, setMethod] = useState<PaymentMethodId | ''>('');
  const [transactionId, setTransactionId] = useState('');
  const [senderNumber, setSenderNumber] = useState('');
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [errors, setErrors] = useState<SubmissionErrors>({});
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const off = subscribeVerificationConfig(
      (c) => {
        setConfig(c);
        setConfigLoaded(true);
      },
      () => setLoadError(true)
    );
    return off;
  }, []);

  useEffect(() => {
    if (!uid) return;
    return subscribeMyVerification(
      uid,
      ({ status, applications }) => {
        setStatusDoc(status);
        setApps(applications);
      },
      () => setLoadError(true)
    );
  }, [uid]);

  const state = resolveUserState(statusDoc, liveVerified);

  // When an admin approves while this page is open, sync the cached profile once (no re-login needed).
  const synced = useRef(false);
  useEffect(() => {
    if (liveVerified && profile && !profile.isVerified && !synced.current) {
      synced.current = true;
      void refreshProfile();
    }
  }, [liveVerified, profile, refreshProfile]);

  // Pre-fill the amount from the admin-configured fee (editable, but the server re-validates it).
  useEffect(() => {
    if (config?.enabled && !amount) setAmount(String(config.feeAmount));
  }, [config, amount]);

  const enabledMethods = useMemo(
    () => (config ? PAYMENT_METHOD_IDS.filter((id) => config.methods[id].enabled && config.methods[id].number) : []),
    [config]
  );
  const activeApp = apps.find((a) => a.id === statusDoc?.applicationId) || apps[0];
  const emailOk = Boolean(
    firebaseUser?.emailVerified || firebaseUser?.providerData?.some((p) => p.providerId === 'google.com')
  );
  const canApply = canSubmitNewClaim(state) && config?.enabled && enabledMethods.length > 0;

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Number copied');
    } catch {
      toast.info(text);
    }
  };

  const onSubmit = async (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (!config || !profile || submitting) return;
    const found = validateSubmission({ method, transactionId, senderNumber, amount, reference }, config);
    setErrors(found);
    if (Object.keys(found).length) return;
    setSubmitting(true);
    try {
      await submitPaidVerification({
        uid,
        username: profile.username,
        displayName: profile.displayName,
        input: { method, transactionId, senderNumber, amount, reference },
        config,
      });
      toast.success('Submitted. An administrator will review your payment.');
      setTransactionId('');
      setReference('');
      setErrors({});
    } catch (err) {
      setErrors({ form: err instanceof VerificationSubmitError ? err.message : 'Could not submit. Please try again.' });
    } finally {
      setSubmitting(false);
    }
  };

  const selected = method ? config?.methods[method] : null;

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <Link
          to={profile ? `/profile/${profile.username}` : '/discover'}
          className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
        >
          <ChevronLeft className="w-3.5 h-3.5" /> Back to profile
        </Link>

        {/* Header + status */}
        <div className={`${card} p-5`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-brand/10 text-brand flex items-center justify-center shrink-0">
                <ShieldCheck className="w-5 h-5" />
              </div>
              <div>
                <h1 className="font-display font-bold text-lg text-neutral-950 dark:text-white">Profile Verification</h1>
                <p className="text-xs text-neutral-500">Get a verified badge after your payment is confirmed.</p>
              </div>
            </div>
            <VerificationStatusPill state={state} />
          </div>

          {loadError && (
            <p className="mt-4 text-xs text-red-600">Some verification data could not be loaded. Refresh to try again.</p>
          )}

          {state === 'verified' && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 p-3.5 text-sm text-emerald-800 dark:text-emerald-300">
              <BadgeCheck className="w-5 h-5 shrink-0 mt-0.5" />
              <p>Your profile is verified. The badge now appears beside your name across BANA.</p>
            </div>
          )}
          {(state === 'payment_pending' || state === 'under_review') && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-blue-50 dark:bg-blue-950/30 p-3.5 text-sm text-blue-900 dark:text-blue-200">
              <Clock className="w-5 h-5 shrink-0 mt-0.5" />
              <p>
                {state === 'payment_pending'
                  ? 'We received your payment details. An administrator will check them against our payment records.'
                  : 'An administrator is reviewing your payment right now.'}{' '}
                Submitting a transaction ID does not verify your profile by itself.
              </p>
            </div>
          )}
          {state === 'rejected' && (
            <div className="mt-4 flex items-start gap-2.5 rounded-xl bg-red-50 dark:bg-red-950/30 p-3.5 text-sm text-red-800 dark:text-red-300">
              <XCircle className="w-5 h-5 shrink-0 mt-0.5" />
              <p>
                Your last application was not approved{activeApp?.rejectionReason ? `: ${activeApp.rejectionReason}` : '.'} You can
                submit a new one below.
              </p>
            </div>
          )}
          {statusDoc?.status === 'revoked' && state === 'not_verified' && (
            <p className="mt-4 text-xs text-neutral-500">Your previous verification was removed by an administrator.</p>
          )}
        </div>

        {/* Benefits */}
        {state !== 'verified' && (
          <div className={`${card} p-5`}>
            <h2 className="font-display font-semibold text-sm mb-3">Verification benefits</h2>
            <ul className="space-y-2">
              {BENEFITS.map((b) => (
                <li key={b} className="flex items-start gap-2 text-sm text-neutral-700 dark:text-neutral-300">
                  <CheckCircle2 className="w-4 h-4 text-brand shrink-0 mt-0.5" /> {b}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Payment + form */}
        {canSubmitNewClaim(state) && (
          <div className={`${card} p-5 space-y-5`}>
            {!configLoaded ? (
              <div className="flex items-center gap-2 text-sm text-neutral-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Loading payment details…
              </div>
            ) : !config?.enabled ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                Paid verification is not available right now. Please check back later.
              </p>
            ) : enabledMethods.length === 0 ? (
              <p className="text-sm text-neutral-600 dark:text-neutral-300">
                No payment method is accepting verification payments at the moment.
              </p>
            ) : !emailOk ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Verify your email address first — it is required before you can submit a verification payment.
              </p>
            ) : (
              <>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display font-semibold text-sm">Verification fee</h2>
                  <p className="font-display font-extrabold text-2xl text-neutral-950 dark:text-white">
                    {formatMoney(config.feeAmount, config.currency)}
                  </p>
                </div>
                {config.generalInstructions && (
                  <p className="text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-line">{config.generalInstructions}</p>
                )}

                <div>
                  <h3 className="text-xs font-semibold text-neutral-500 mb-2">1. Choose how you will pay</h3>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    {enabledMethods.map((id) => (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setMethod(id)}
                        aria-pressed={method === id}
                        className={`rounded-xl border px-3.5 py-3 text-left transition-colors ${
                          method === id
                            ? 'border-brand bg-brand/5'
                            : 'border-neutral-200 dark:border-neutral-700 hover:bg-neutral-50 dark:hover:bg-neutral-800'
                        }`}
                      >
                        <span className="block text-sm font-semibold">{PAYMENT_METHOD_LABELS[id]}</span>
                        <span className="block text-[11px] text-neutral-500 capitalize">{config.methods[id].accountType}</span>
                      </button>
                    ))}
                  </div>
                  {errors.method && <p className="mt-1.5 text-xs text-red-600">{errors.method}</p>}
                </div>

                {method && selected && (
                  <div className="rounded-xl bg-neutral-50 dark:bg-neutral-800/60 p-4 space-y-2">
                    <p className="text-xs text-neutral-500">Send exactly {formatMoney(config.feeAmount, config.currency)} to:</p>
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono font-semibold text-base break-all">{selected.number}</span>
                      <button
                        type="button"
                        onClick={() => copy(selected.number)}
                        className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 dark:border-neutral-700 px-2.5 py-1.5 text-xs font-medium hover:bg-white dark:hover:bg-neutral-900 shrink-0"
                      >
                        <Copy className="w-3.5 h-3.5" /> Copy
                      </button>
                    </div>
                    {selected.instructions && (
                      <p className="text-xs text-neutral-600 dark:text-neutral-300 whitespace-pre-line">{selected.instructions}</p>
                    )}
                  </div>
                )}

                <form onSubmit={onSubmit} className="space-y-3.5" noValidate>
                  <h3 className="text-xs font-semibold text-neutral-500">2. Submit your payment details</h3>
                  <div>
                    <label className="block text-xs font-medium mb-1" htmlFor="pv-tx">Transaction ID</label>
                    <input id="pv-tx" className={`${input} font-mono uppercase`} value={transactionId} maxLength={40}
                      autoComplete="off" onChange={(e) => setTransactionId(e.target.value)} placeholder="From your payment confirmation" />
                    {errors.transactionId && <p className="mt-1 text-xs text-red-600">{errors.transactionId}</p>}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    <div>
                      <label className="block text-xs font-medium mb-1" htmlFor="pv-sender">Number you paid from</label>
                      <input id="pv-sender" inputMode="tel" className={input} value={senderNumber} maxLength={20}
                        autoComplete="tel" onChange={(e) => setSenderNumber(e.target.value)} />
                      {errors.senderNumber && <p className="mt-1 text-xs text-red-600">{errors.senderNumber}</p>}
                    </div>
                    <div>
                      <label className="block text-xs font-medium mb-1" htmlFor="pv-amount">Amount paid ({config.currency})</label>
                      <input id="pv-amount" inputMode="decimal" className={input} value={amount} onChange={(e) => setAmount(e.target.value)} />
                      {errors.amount && <p className="mt-1 text-xs text-red-600">{errors.amount}</p>}
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" htmlFor="pv-ref">Note for the reviewer (optional)</label>
                    <textarea id="pv-ref" rows={2} className={input} value={reference} maxLength={300}
                      onChange={(e) => setReference(e.target.value)} />
                    {errors.reference && <p className="mt-1 text-xs text-red-600">{errors.reference}</p>}
                  </div>

                  <div className="flex items-start gap-2 text-[11px] text-neutral-500">
                    <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <p>
                      Payments are checked manually by a BANA administrator. Each transaction ID can be used once, and false
                      or duplicated claims are rejected.
                    </p>
                  </div>
                  {errors.form && <p className="text-xs text-red-600" role="alert">{errors.form}</p>}
                  <button
                    type="submit"
                    disabled={submitting || !method}
                    className="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl bg-brand hover:bg-brand-hover disabled:opacity-50 text-white text-sm font-semibold px-5 py-2.5"
                  >
                    {submitting && <Loader2 className="w-4 h-4 animate-spin" />} Submit for review
                  </button>
                </form>
              </>
            )}
          </div>
        )}

        {/* History */}
        <div className={`${card} p-5`}>
          <h2 className="font-display font-semibold text-sm mb-3">Application history</h2>
          {apps.length === 0 ? (
            <p className="text-xs text-neutral-500">No applications yet.</p>
          ) : (
            <ul className="divide-y divide-neutral-100 dark:divide-neutral-800">
              {apps.map((a) => (
                <li key={a.id} className="py-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {PAYMENT_METHOD_LABELS[a.method]} · {formatMoney(a.amount, a.currency)}
                    </p>
                    <p className="text-[11px] text-neutral-500 font-mono truncate">{a.transactionId} · {formatRelativeTime(a.createdAt)}</p>
                    {a.status === 'rejected' && a.rejectionReason && <p className="text-[11px] text-red-600 mt-0.5">{a.rejectionReason}</p>}
                  </div>
                  <span className="text-[11px] font-semibold text-neutral-600 dark:text-neutral-300">{STATUS_LABELS[a.status]}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {state !== 'verified' && (
          <p className="text-xs text-neutral-500">
            Prefer to apply with identity or organization documents instead?{' '}
            <button type="button" onClick={() => setLegacyOpen(true)} className="text-brand font-semibold hover:underline">
              Use the document-review request
            </button>
            .
          </p>
        )}
      </div>
      <VerificationRequestModal open={legacyOpen} onClose={() => setLegacyOpen(false)} />
    </AppShell>
  );
}
