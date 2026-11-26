import { doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { stageVideoFeedback, type VideoRef } from '@/src/lib/videoDistribution';

export interface SubmitReportInput {
  reporterId: string;
  targetType: string;
  targetId: string;
  reason: string;
  details?: string;
  evidence?: string;
  context?: Record<string, string | number | boolean | null | undefined>;
  /** Set for reels / video posts: the report and its feedback counter are then written in ONE atomic batch. */
  video?: VideoRef;
}

/** Deterministic id: exactly one report per (reporter, target). Firestore Rules require this exact format. */
export const reportDocId = (targetType: string, targetId: string, reporterId: string) => `${targetType}_${targetId}_${reporterId}`;

/**
 * Submit a report. A report is a signal for human review, never proof of a violation.
 * Returns 'duplicate' when the (reporter, target) report already exists (an update, which rules deny to non-admins)
 * or the write was denied; the caller should show "already reported / could not submit".
 */
export async function submitReport(i: SubmitReportInput): Promise<'submitted' | 'duplicate'> {
  const batch = writeBatch(db);
  const clean: Record<string, any> = {};
  Object.entries(i.context || {}).forEach(([k, v]) => { if (v !== undefined) clean[k] = v; });
  batch.set(doc(db, 'reports', reportDocId(i.targetType, i.targetId, i.reporterId)), {
    reporterId: i.reporterId,
    targetType: i.targetType,
    targetId: i.targetId,
    reason: i.reason.slice(0, 120),
    details: (i.details || '').trim().slice(0, 500),
    ...(i.evidence ? { evidence: i.evidence.slice(0, 500) } : {}),
    ...clean,
    status: 'pending',
    createdAt: serverTimestamp(),
  });
  if (i.video) stageVideoFeedback(batch, i.reporterId, i.video, 'report');
  try {
    await batch.commit();
    return 'submitted';
  } catch (err: any) {
    if (err?.code === 'permission-denied') return 'duplicate';
    throw err;
  }
}
