import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  ShieldCheck,
  Upload,
  X,
  Clock,
  AlertTriangle,
  FileText,
  ExternalLink,
} from 'lucide-react';
import {
  collection,
  doc,
  getDocs,
  addDoc,
  updateDoc,
  query,
  where,
  orderBy,
  limit,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { getDocsWithIndexFallback, sortByCreatedAtDesc } from '@/src/lib/firestoreQuery';
import { useAuth } from '@/src/contexts/AuthContext';
import { uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import type { VerificationRequest } from '@/src/types/bana';

interface VerificationRequestModalProps {
  open: boolean;
  onClose: () => void;
}

const VERIFICATION_CATEGORIES = [
  'Creator / Content Maker',
  'Public Figure / Leader',
  'Journalist / Media',
  'Artist / Musician',
  'Developer / Educator',
  'Business / Brand',
  'Non-Profit / Community Org',
];

export function VerificationRequestModal({ open, onClose }: VerificationRequestModalProps) {
  const { firebaseUser, profile } = useAuth();
  const [requests, setRequests] = useState<VerificationRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [type, setType] = useState<'identity' | 'organization'>('identity');
  const [fullName, setFullName] = useState('');
  const [category, setCategory] = useState(VERIFICATION_CATEGORIES[0]);
  const [reason, setReason] = useState('');
  const [linksInput, setLinksInput] = useState('');
  const [responseNote, setResponseNote] = useState('');
  const [docFile, setDocFile] = useState<File | null>(null);

  useEffect(() => {
    if (!open || !firebaseUser) return;
    setLoading(true);
    setError(null);
    setSuccessMsg(null);
    getDocsWithIndexFallback<VerificationRequest>(
      query(
        collection(db, 'verificationRequests'),
        where('uid', '==', firebaseUser.uid),
        orderBy('createdAt', 'desc'),
        limit(10)
      ),
      query(collection(db, 'verificationRequests'), where('uid', '==', firebaseUser.uid), limit(20)),
      sortByCreatedAtDesc
    )
      .then(({ items }) => {
        const list = items.slice(0, 10);
        setRequests(list);
        const latest = list[0];
        if (latest) {
          setType(latest.type);
          setFullName(latest.fullName || profile?.displayName || '');
          setCategory(latest.category || VERIFICATION_CATEGORIES[0]);
          setReason(latest.reason || '');
          setLinksInput((latest.publicLinks || []).join('\n'));
        } else if (profile) {
          setFullName(profile.displayName || '');
        }
      })
      .catch(() => setRequests([]))
      .finally(() => setLoading(false));
  }, [open, firebaseUser, profile]);

  if (!open) return null;

  const latestReq = requests[0] || null;
  const canEditOrApply =
    !profile?.isVerified &&
    (!latestReq || latestReq.status === 'needs_info' || latestReq.status === 'rejected');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser || !profile) return;
    if (fullName.trim().length < 2) {
      setError('Please enter your legal full name or registered organization name.');
      return;
    }

    if (!latestReq && !docFile) {
      setError('Please upload a supporting identity or organization verification document.');
      return;
    }

    if (docFile && docFile.size > 10 * 1024 * 1024) {
      setError('Document file must be 10 MB or smaller.');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccessMsg(null);

    try {
      let documentUrl = latestReq?.documentUrl || '';
      let documentName = latestReq?.documentName || '';

      if (docFile) {
        const safeName = docFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `verifications/${firebaseUser.uid}/${Date.now()}_${safeName}`;
        documentUrl = await uploadMediaWithProgress(path, docFile, (pct) => setUploadPct(pct));
        documentName = docFile.name;
      }

      const publicLinks = linksInput
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter((s) => /^https?:\/\//i.test(s))
        .slice(0, 5);

      const nowIso = new Date().toISOString();

      if (latestReq && (latestReq.status === 'needs_info' || latestReq.status === 'rejected')) {
        const nextHistory = [
          ...(latestReq.history || []),
          {
            status: 'pending' as const,
            note: responseNote.trim() || 'Resubmitted verification request',
            actorUid: firebaseUser.uid,
            at: nowIso,
          },
        ];
        await updateDoc(doc(db, 'verificationRequests', latestReq.id), {
          type,
          fullName: fullName.trim().slice(0, 120),
          category,
          reason: reason.trim().slice(0, 500),
          documentUrl,
          documentName,
          publicLinks,
          userResponseNote: responseNote.trim().slice(0, 500),
          status: 'pending',
          history: nextHistory,
          updatedAt: serverTimestamp(),
        });
      } else {
        await addDoc(collection(db, 'verificationRequests'), {
          uid: firebaseUser.uid,
          username: profile.username,
          displayName: profile.displayName,
          type,
          fullName: fullName.trim().slice(0, 120),
          category,
          reason: reason.trim().slice(0, 500),
          documentUrl,
          documentName,
          publicLinks,
          status: 'pending',
          history: [
            {
              status: 'pending',
              note: 'Initial verification submission',
              actorUid: firebaseUser.uid,
              at: nowIso,
            },
          ],
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      setSuccessMsg('Verification request submitted. BANA reviewers will evaluate your application.');
      setDocFile(null);
      setUploadPct(null);
      // Reload requests list
      const { items } = await getDocsWithIndexFallback<VerificationRequest>(
        query(
          collection(db, 'verificationRequests'),
          where('uid', '==', firebaseUser.uid),
          orderBy('createdAt', 'desc'),
          limit(10)
        ),
        query(collection(db, 'verificationRequests'), where('uid', '==', firebaseUser.uid), limit(20)),
        sortByCreatedAtDesc
      );
      setRequests(items.slice(0, 10));
    } catch (err: any) {
      setError(err?.message || 'Failed to submit verification request.');
    } finally {
      setSubmitting(false);
      setUploadPct(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-xs flex items-center justify-center p-4">
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-5 space-y-4">
        <div className="flex items-center justify-between border-b border-neutral-200 dark:border-neutral-800 pb-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-[#1877F2]" />
            <div>
              <h2 className="text-base font-bold text-black dark:text-white">Profile Verification</h2>
              <p className="text-[11px] text-neutral-500">Private proof review · BANA Trust & Identity</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-800 flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {profile?.isVerified ? (
          <div className="p-4 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-[#1877F2] shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-bold text-black dark:text-white">Your account is verified</p>
              <p className="text-xs text-neutral-600 dark:text-neutral-300 mt-1">
                Verified badge type: <span className="font-semibold capitalize">{profile.verificationType || 'identity'}</span>.
                Your badge is visible across Feed, Reels, Search, Messenger, and Profile.
              </p>
            </div>
          </div>
        ) : loading ? (
          <div className="py-10 text-center text-xs text-neutral-500">Loading verification status...</div>
        ) : (
          <>
            {latestReq && (
              <div className="p-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold uppercase tracking-wider text-neutral-500">Latest Request</span>
                  <span
                    className={`text-xs font-bold px-2.5 py-0.5 rounded-full inline-flex items-center gap-1 ${
                      latestReq.status === 'pending'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        : latestReq.status === 'needs_info'
                        ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                        : latestReq.status === 'approved'
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        : 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
                    }`}
                  >
                    {latestReq.status === 'pending' && <Clock className="w-3 h-3" />}
                    {latestReq.status === 'needs_info' && <AlertTriangle className="w-3 h-3" />}
                    {latestReq.status.replace('_', ' ').toUpperCase()}
                  </span>
                </div>
                <p className="text-xs text-neutral-700 dark:text-neutral-300">
                  <span className="font-semibold">{latestReq.fullName}</span> · {latestReq.category}
                </p>
                {latestReq.adminNote && (
                  <p className="text-xs p-2.5 rounded-lg bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300">
                    <span className="font-bold">Reviewer Note:</span> {latestReq.adminNote}
                  </p>
                )}
                {latestReq.documentUrl && (
                  <a
                    href={latestReq.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#1877F2] hover:underline"
                  >
                    <FileText className="w-3.5 h-3.5" /> {latestReq.documentName || 'Submitted Proof'}
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>
            )}

            {latestReq?.status === 'pending' ? (
              <div className="p-4 rounded-xl bg-neutral-50 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 text-xs text-neutral-600 dark:text-neutral-300">
                Your verification submission is currently under review by BANA administrators. We keep your documents strictly confidential.
              </div>
            ) : canEditOrApply ? (
              <form onSubmit={handleSubmit} className="space-y-3">
                {error && (
                  <div className="p-2.5 rounded-xl bg-red-50 dark:bg-red-950/40 text-red-700 dark:text-red-300 text-xs">
                    {error}
                  </div>
                )}
                {successMsg && (
                  <div className="p-2.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 text-xs">
                    {successMsg}
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold block mb-1.5">Verification Type</label>
                  <div className="grid grid-cols-2 gap-2">
                    {(['identity', 'organization'] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => setType(t)}
                        className={`py-2 px-3 rounded-xl text-xs font-semibold border transition-colors ${
                          type === t
                            ? 'bg-black text-white dark:bg-white dark:text-black border-black dark:border-white'
                            : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300'
                        }`}
                      >
                        {t === 'identity' ? 'Personal Identity' : 'Organization / Brand'}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1">
                    {type === 'identity' ? 'Full Legal Name' : 'Registered Organization Name'}
                  </label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={type === 'identity' ? 'As shown on NID / Passport' : 'Official Company / Brand Name'}
                    className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-xs outline-none focus:border-[#1877F2]"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1">Category</label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-xs outline-none"
                  >
                    {VERIFICATION_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1">Public Reference Links (Optional, 1 per line)</label>
                  <textarea
                    rows={2}
                    value={linksInput}
                    onChange={(e) => setLinksInput(e.target.value)}
                    placeholder="https://yourwebsite.com&#10;https://news.example.com/article"
                    className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-xs outline-none focus:border-[#1877F2]"
                  />
                </div>

                <div>
                  <label className="text-xs font-semibold block mb-1">Why should this profile be verified?</label>
                  <textarea
                    rows={2}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Describe your public presence, community leadership, or official brand."
                    className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-xs outline-none focus:border-[#1877F2]"
                  />
                </div>

                {(latestReq?.status === 'needs_info' || latestReq?.status === 'rejected') && (
                  <div>
                    <label className="text-xs font-semibold block mb-1">Response to Reviewer</label>
                    <input
                      type="text"
                      value={responseNote}
                      onChange={(e) => setResponseNote(e.target.value)}
                      placeholder="Clarify requested details..."
                      className="w-full px-3 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 text-xs outline-none focus:border-[#1877F2]"
                    />
                  </div>
                )}

                <div>
                  <label className="text-xs font-semibold block mb-1">
                    Proof Document (NID, Passport, or Trade License · Image or PDF, max 10MB)
                  </label>
                  <label className="flex items-center justify-center gap-2 px-3 py-3 rounded-xl border border-dashed border-neutral-300 dark:border-neutral-700 cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-950 text-xs text-neutral-600 dark:text-neutral-300">
                    <Upload className="w-4 h-4 text-[#1877F2]" />
                    <span className="truncate">{docFile ? docFile.name : latestReq?.documentName ? `Replace (${latestReq.documentName})` : 'Choose file to upload privately'}</span>
                    <input
                      type="file"
                      accept="image/*,.pdf"
                      className="hidden"
                      onChange={(e) => setDocFile(e.target.files?.[0] || null)}
                    />
                  </label>
                  {uploadPct !== null && (
                    <div className="mt-2">
                      <div className="h-1.5 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden">
                        <div className="h-full bg-[#1877F2] transition-all" style={{ width: `${uploadPct}%` }} />
                      </div>
                      <p className="text-[10px] text-neutral-500 mt-1">Uploading document securely... {uploadPct}%</p>
                    </div>
                  )}
                </div>

                <div className="flex justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="px-4 py-2 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold disabled:opacity-50"
                  >
                    {submitting ? 'Submitting...' : latestReq ? 'Resubmit Request' : 'Submit Verification'}
                  </button>
                </div>
              </form>
            ) : null}

            {latestReq?.history && latestReq.history.length > 0 && (
              <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3">
                <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500 mb-2">Verification History</p>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {latestReq.history.map((h, i) => (
                    <div key={i} className="text-[11px] flex items-start justify-between gap-2 text-neutral-600 dark:text-neutral-400">
                      <span>
                        <strong className="uppercase">{h.status.replace('_', ' ')}</strong>
                        {h.note ? ` — ${h.note}` : ''}
                      </span>
                      <span className="font-mono text-[10px] shrink-0">{h.at.slice(0, 10)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
