import React, { useEffect, useState } from 'react';
import { Flag, Loader2, X } from 'lucide-react';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';

export type ReportTargetType = 'reel' | 'message' | 'conversation';

const REASONS: Record<ReportTargetType, string[]> = {
  reel: [
    'Spam or misleading',
    'Nudity or sexual content',
    'Violence or dangerous acts',
    'Hate speech or harassment',
    'Scam or fraud',
    'Copyright or impersonation',
    'Other',
  ],
  message: [
    'Harassment or bullying',
    'Spam or scam',
    'Threats or violence',
    'Hate speech',
    'Inappropriate content',
    'Other',
  ],
  conversation: [
    'Harassment or bullying',
    'Spam or scam',
    'Threats or violence',
    'Hate speech',
    'Inappropriate content',
    'Other',
  ],
};

interface ReportDialogProps {
  open: boolean;
  targetType: ReportTargetType;
  targetId: string;
  /** Optional evidence the reporter explicitly chooses to submit (e.g. the reported message text). */
  evidence?: string;
  /** Extra non-sensitive context (e.g. conversationId, reelId owner). */
  context?: Record<string, string | number | boolean | null | undefined>;
  title?: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

/**
 * Shared report dialog. One report per (reporter, target) is enforced through a
 * deterministic document id: a second create is an update, which Firestore rules
 * only allow for admins, so a duplicate is rejected by the backend, not just the UI.
 */
export function ReportDialog({
  open,
  targetType,
  targetId,
  evidence,
  context,
  title,
  onClose,
  onSubmitted,
}: ReportDialogProps) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const [reason, setReason] = useState<string>('');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setDetails('');
      setError(null);
      setSubmitting(false);
    }
  }, [open, targetId]);

  if (!open) return null;

  const submit = async () => {
    if (!firebaseUser) return;
    if (!reason) {
      setError('Please choose a reason.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const cleanContext: Record<string, any> = {};
      Object.entries(context || {}).forEach(([k, v]) => {
        if (v !== undefined) cleanContext[k] = v;
      });
      await setDoc(doc(db, 'reports', `${targetType}_${targetId}_${firebaseUser.uid}`), {
        reporterId: firebaseUser.uid,
        targetType,
        targetId,
        reason,
        details: details.trim().slice(0, 500),
        ...(evidence ? { evidence: evidence.slice(0, 500) } : {}),
        ...cleanContext,
        status: 'pending',
        createdAt: serverTimestamp(),
      });
      toast.success('Report submitted. Our safety team will review it.');
      onSubmitted?.();
      onClose();
    } catch (err: any) {
      if (err?.code === 'permission-denied') {
        // Update on an existing deterministic id is denied for non-admins => already reported.
        setError('You have already reported this. Our team is reviewing it.');
      } else if (err?.code === 'unavailable' || err?.message?.includes('network')) {
        setError('Network problem. Check your connection and try again.');
      } else {
        setError('Could not submit the report. Please try again.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Report"
      onClick={onClose}
    >
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 shadow-2xl p-5 space-y-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-base font-bold inline-flex items-center gap-2 text-neutral-900 dark:text-neutral-50">
            <Flag className="w-4 h-4 text-amber-500" />
            {title || 'Report'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close report dialog"
            className="h-9 w-9 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-neutral-500 leading-relaxed">
          Why are you reporting this? Reports are reviewed by BANA moderators. Content is not removed automatically.
        </p>

        <div className="space-y-1.5" role="radiogroup" aria-label="Report reason">
          {REASONS[targetType].map((r) => (
            <label
              key={r}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border text-sm cursor-pointer min-h-[44px] ${
                reason === r
                  ? 'border-[#1877F2] bg-[#1877F2]/5 text-neutral-900 dark:text-neutral-50'
                  : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300'
              }`}
            >
              <input
                type="radio"
                name="report-reason"
                value={r}
                checked={reason === r}
                onChange={() => {
                  setReason(r);
                  setError(null);
                }}
                className="accent-[#1877F2]"
              />
              {r}
            </label>
          ))}
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-600 dark:text-neutral-400">
            Additional details (optional)
          </label>
          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value.slice(0, 500))}
            rows={3}
            placeholder="Tell us more to help the review"
            className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3 py-2 text-sm resize-none"
          />
          <p className="text-[10px] text-neutral-400 text-right tabular-nums">{details.length}/500</p>
        </div>

        {evidence && (
          <p className="text-[11px] text-neutral-500 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-2.5">
            Only the selected message text is shared with moderators. The rest of your conversation stays private.
          </p>
        )}

        {error && (
          <p role="alert" className="text-xs text-rose-600 font-medium">
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="px-4 h-10 rounded-xl border border-neutral-200 dark:border-neutral-700 text-sm font-medium"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting || !reason}
            className="px-4 h-10 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-50 text-white text-sm font-semibold inline-flex items-center gap-2"
          >
            {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
            Submit report
          </button>
        </div>
      </div>
    </div>
  );
}
