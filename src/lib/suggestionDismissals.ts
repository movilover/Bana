import { collection, deleteDoc, doc, getDocs, limit, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { db } from '@/src/firebase';

/**
 * Scalable "Not interested" storage for friend suggestions: ONE small document per dismissed person
 * (suggestionDismissals/<viewerUid>_<targetUid>) instead of a capped array inside userSettings.
 * - unlimited growth (each dismissal is its own write; the old 300-id array is still read for backward compatibility),
 * - duplicates are impossible (deterministic id),
 * - owner-only access enforced by Firestore Rules.
 * The set is loaded once per session (bounded read) and cached in memory.
 */
const READ_CAP = 2000;
const cache = new Map<string, Set<string>>();

export async function loadDismissedSuggestionIds(uid: string, force = false): Promise<Set<string>> {
  if (!force && cache.has(uid)) return cache.get(uid)!;
  const out = new Set<string>();
  try {
    const snap = await getDocs(query(collection(db, 'suggestionDismissals'), where('uid', '==', uid), limit(READ_CAP)));
    snap.docs.forEach((d) => { const t = d.data().targetUid; if (typeof t === 'string') out.add(t); });
  } catch { /* offline / rules not deployed yet: legacy ids still apply */ }
  cache.set(uid, out);
  return out;
}

export async function dismissSuggestion(uid: string, targetUid: string): Promise<void> {
  cache.get(uid)?.add(targetUid);
  await setDoc(doc(db, 'suggestionDismissals', `${uid}_${targetUid}`), { uid, targetUid, createdAt: serverTimestamp() });
}

/** Undo one dismissal (or all, via resetDismissals). */
export async function undoDismissal(uid: string, targetUid: string): Promise<void> {
  cache.get(uid)?.delete(targetUid);
  await deleteDoc(doc(db, 'suggestionDismissals', `${uid}_${targetUid}`));
}

export async function resetDismissals(uid: string): Promise<void> {
  const ids = Array.from(await loadDismissedSuggestionIds(uid, true));
  await Promise.all(ids.map((t) => deleteDoc(doc(db, 'suggestionDismissals', `${uid}_${t}`)).catch(() => {})));
  cache.set(uid, new Set());
}
