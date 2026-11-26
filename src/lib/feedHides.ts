import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, setDoc, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';

/**
 * Scalable storage for "hidden creators" and "dismissed posts/reels" (was: two unbounded arrays inside the single
 * userSettings document, rewritten in full on every change and bounded only by the 1 MiB document limit).
 *
 * Now: ONE small document per hide — feedHides/<uid>_<kind>_<targetId> — owner-only (Firestore Rules), loaded once per
 * session (bounded read, newest first) and cached in memory. Legacy arrays in userSettings are still READ and merged, so
 * nothing already hidden reappears; "undo" and "reset" clear both places. Guests keep using localStorage (unchanged).
 */
export type HideKind = 'creator' | 'post';
const READ_CAP = 3000;

interface Hides { creators: Set<string>; posts: Set<string> }
const cache = new Map<string, Hides>();
const subscribers = new Set<() => void>();
const notify = () => subscribers.forEach((f) => f());

export async function loadFeedHides(uid: string, force = false): Promise<Hides> {
  if (!force && cache.has(uid)) return cache.get(uid)!;
  const out: Hides = { creators: new Set(), posts: new Set() };
  try {
    const snap = await getDocs(query(collection(db, 'feedHides'), where('uid', '==', uid), orderBy('createdAt', 'desc'), limit(READ_CAP)));
    snap.docs.forEach((d) => {
      const x = d.data();
      if (typeof x.targetId !== 'string') return;
      (x.kind === 'creator' ? out.creators : out.posts).add(x.targetId);
    });
  } catch { /* offline / rules or index not deployed yet: legacy arrays still apply */ }
  cache.set(uid, out);
  return out;
}

const hideId = (uid: string, kind: HideKind, targetId: string) => `${uid}_${kind}_${targetId}`;

export async function addFeedHide(uid: string, kind: HideKind, targetId: string): Promise<void> {
  const c = cache.get(uid) || { creators: new Set<string>(), posts: new Set<string>() };
  (kind === 'creator' ? c.creators : c.posts).add(targetId);
  cache.set(uid, c);
  notify();
  await setDoc(doc(db, 'feedHides', hideId(uid, kind, targetId)), { uid, kind, targetId, createdAt: serverTimestamp() });
}

export async function removeFeedHide(uid: string, kind: HideKind, targetId: string): Promise<void> {
  const c = cache.get(uid);
  (kind === 'creator' ? c?.creators : c?.posts)?.delete(targetId);
  notify();
  await deleteDoc(doc(db, 'feedHides', hideId(uid, kind, targetId))).catch(() => {});
}

export async function resetFeedHides(uid: string): Promise<void> {
  const all = await loadFeedHides(uid, true);
  const refs = [
    ...Array.from(all.creators).map((t) => doc(db, 'feedHides', hideId(uid, 'creator', t))),
    ...Array.from(all.posts).map((t) => doc(db, 'feedHides', hideId(uid, 'post', t))),
  ];
  for (let i = 0; i < refs.length; i += 400) {
    const b = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => b.delete(r));
    await b.commit().catch(() => {});
  }
  cache.set(uid, { creators: new Set(), posts: new Set() });
  notify();
}

/** Signed-in hook: merged (per-document + legacy array) hidden creators / dismissed posts, plus actions. */
export function useFeedHides() {
  const { firebaseUser, settings, updateLocalSettings } = useAuth();
  const uid = firebaseUser?.uid;
  const [, setTick] = useState(0);

  useEffect(() => {
    const f = () => setTick((n) => n + 1);
    subscribers.add(f);
    return () => { subscribers.delete(f); };
  }, []);
  useEffect(() => {
    if (uid) void loadFeedHides(uid).then(notify);
  }, [uid]);

  const stored = uid ? cache.get(uid) : undefined;
  const legacyCreators = settings?.hiddenCreatorIds;
  const legacyPosts = settings?.dismissedPostIds;
  const hiddenCreatorIds = useMemo(
    () => Array.from(new Set([...(legacyCreators || []), ...(stored ? Array.from(stored.creators) : [])])),
    [legacyCreators, stored, stored?.creators.size] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const dismissedPostIds = useMemo(
    () => Array.from(new Set([...(legacyPosts || []), ...(stored ? Array.from(stored.posts) : [])])),
    [legacyPosts, stored, stored?.posts.size] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const hideCreator = useCallback(async (id: string) => { if (uid) await addFeedHide(uid, 'creator', id).catch(() => {}); }, [uid]);
  const unhideCreator = useCallback(async (id: string) => {
    if (!uid) return;
    await removeFeedHide(uid, 'creator', id);
    if ((legacyCreators || []).includes(id)) await updateLocalSettings({ hiddenCreatorIds: (legacyCreators || []).filter((x) => x !== id) }).catch(() => {});
  }, [uid, legacyCreators, updateLocalSettings]);
  const dismissPost = useCallback(async (id: string) => { if (uid) await addFeedHide(uid, 'post', id).catch(() => {}); }, [uid]);
  const resetHides = useCallback(async () => {
    if (!uid) return;
    await resetFeedHides(uid);
    if ((legacyCreators?.length || 0) + (legacyPosts?.length || 0) > 0) {
      await updateLocalSettings({ hiddenCreatorIds: [], dismissedPostIds: [] }).catch(() => {});
    }
  }, [uid, legacyCreators, legacyPosts, updateLocalSettings]);

  return { hiddenCreatorIds, dismissedPostIds, hideCreator, unhideCreator, dismissPost, resetHides };
}
