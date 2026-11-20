import React, { useState } from 'react';
import { Flag, Loader2, X } from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import { submitMarketplaceReport } from '@/src/lib/marketplace';

const REASONS = [
  'Spam or misleading',
  'Harassment or hate speech',
  'Nudity or sexual content',
  'Violence or dangerous acts',
  'Scam or fraud',
  'Rule-breaking for this group',
  'Other',
];

interface Props {
  open: boolean;
  targetType: 'community' | 'community_post';
  targetId: string;
  communityId: string;
  title: string;
  onClose: () => void;
}

/** Reason-based report dialog for groups and group posts. One report per user per target (backend enforced). */
export function CommunityReportDialog({ open, targetType, targetId, communityId, title, onClose }: Props) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  const submit = async () => {
    if (!firebaseUser) return;
    if (!reason) {
      setError('Please choose a reason.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await submitMarketplaceReport({ reporterId: firebaseUser.uid, targetType, targetId, communityId, reason, details });
      toast.success('Report submitted. Our team will review it.');
      setReason('');
      setDetails('');
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Could not submit the report.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-end sm:items-center justify-center bg-black/60 p-0 sm:p-4" role="dialog" aria-modal="true" onClick={onClose}>
      <div
        className="w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 p-5 space-y-3"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold inline-flex items-center gap-2">
            <Flag className="w-4 h-4 text-amber-500" /> {title}
          </h3>
          <button type="button" onClick={onClose} aria-label="Close">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="space-y-1.5">
          {REASONS.map((r) => (
            <label key={r} className="flex items-center gap-2 text-xs">
              <input type="radio" name="community-report-reason" checked={reason === r} onChange={() => setReason(r)} className="accent-[#1877F2]" />
              {r}
            </label>
          ))}
        </div>
        <textarea
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          maxLength={500}
          rows={3}
          placeholder="Additional details (optional)"
          className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 p-3 text-xs"
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="w-full h-10 rounded-xl bg-[#1877F2] text-white text-xs font-semibold disabled:opacity-50 inline-flex items-center justify-center gap-2"
        >
          {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Submit report
        </button>
      </div>
    </div>
  );
}
