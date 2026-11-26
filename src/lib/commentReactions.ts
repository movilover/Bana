import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteDoc, doc, getDoc, increment, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '@/src/firebase';
import type { ReactionType } from '@/src/types/bana';

/**
 * Comment reactions reuse the existing `commentLikes/{commentId}_{uid}` document (one per user per comment,
 * so a user can never hold two reactions). The chosen type is stored in an additive `reactionType` field;
 * older documents without it are treated as "like". The existing `likesCount` total on the comment is
 * maintained exactly as before (+1 on add, -1 on remove, unchanged when switching type).
 */
export async function writeCommentReaction(params: {
  commentId: string;
  uid: string;
  previous: ReactionType | null;
  next: ReactionType | null;
}): Promise<void> {
  const { commentId, uid, previous, next } = params;
  const ref = doc(db, 'commentLikes', `${commentId}_${uid}`);
  const commentRef = doc(db, 'comments', commentId);

  if (!previous && next) {
    await setDoc(ref, { userId: uid, commentId, reactionType: next, createdAt: serverTimestamp() });
    await updateDoc(commentRef, { likesCount: increment(1) }).catch(() => {});
    return;
  }
  if (previous && !next) {
    await deleteDoc(ref);
    await updateDoc(commentRef, { likesCount: increment(-1) }).catch(() => {});
    return;
  }
  if (previous && next && previous !== next) {
    const data = { userId: uid, commentId, reactionType: next, createdAt: serverTimestamp() };
    try {
      await setDoc(ref, data);
    } catch {
      // Some rule sets only allow create/delete: replace the document instead.
      await deleteDoc(ref);
      await setDoc(ref, data);
    }
  }
}

/** Loads (once per id) and tracks the signed-in user's reaction for a list of comments. */
export function useMyCommentReactions(uid: string | undefined, commentIds: string[]) {
  const [mine, setMine] = useState<Record<string, ReactionType | null>>({});
  const requested = useRef<Set<string>>(new Set());

  useEffect(() => {
    requested.current = new Set();
    setMine({});
  }, [uid]);

  const key = commentIds.join('|');
  useEffect(() => {
    if (!uid) return;
    const missing = commentIds.filter((id) => !requested.current.has(id)).slice(0, 40);
    if (missing.length === 0) return;
    missing.forEach((id) => requested.current.add(id));
    let cancelled = false;
    Promise.all(
      missing.map(async (id) => {
        const snap = await getDoc(doc(db, 'commentLikes', `${id}_${uid}`)).catch(() => null);
        const t = snap?.exists() ? ((snap.data().reactionType as ReactionType) || 'like') : null;
        return [id, t] as const;
      })
    ).then((pairs) => {
      if (cancelled) return;
      setMine((prev) => {
        const next = { ...prev };
        pairs.forEach(([id, t]) => {
          if (!(id in next)) next[id] = t;
        });
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, key]);

  const set = useCallback((id: string, value: ReactionType | null) => {
    setMine((prev) => ({ ...prev, [id]: value }));
  }, []);

  return { mine, set };
}
