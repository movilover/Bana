import { collection, deleteDoc, doc, getDocs, limit, query, where, writeBatch } from 'firebase/firestore';
import { db } from '@/src/firebase';
import { CLOUD_FUNCTIONS_ENABLED, invokeCloudFunction } from '@/src/lib/firebasePlan';

/**
 * Collections where Firestore security rules allow the owner to delete their own documents.
 * Used on the Spark plan (no Cloud Functions). Anything the rules do not let a client delete
 * (e.g. comments, messages in other people's conversations) is erased by the `deleteMyAccountData`
 * Cloud Function once Blaze + Functions are enabled.
 */
const OWNED_QUERIES: Array<{ col: string; field: string; op?: 'array-contains' }> = [
  { col: 'posts', field: 'authorId' },
  { col: 'reels', field: 'authorId' },
  { col: 'stories', field: 'authorId' },
  { col: 'postLikes', field: 'userId' },
  { col: 'savedPosts', field: 'userId' },
  { col: 'userFollows', field: 'followerId' },
  { col: 'userFollows', field: 'followingId' },
  { col: 'followRequests', field: 'fromUid' },
  { col: 'followRequests', field: 'toUid' },
  { col: 'friendRequests', field: 'fromUid' },
  { col: 'friendRequests', field: 'toUid' },
  { col: 'userBlocks', field: 'blockerId' },
  { col: 'usernames', field: 'uid' }, // frees the reserved @username
  { col: 'friendships', field: 'participants', op: 'array-contains' },
  { col: 'friendLinks', field: 'ownerUid' },
  { col: 'friendLinks', field: 'friendUid' },
  { col: 'friendSuggestionStats', field: 'uid' },
  { col: 'suggestionDismissals', field: 'uid' },
  { col: 'feedHides', field: 'uid' },
];

const PAGE = 400;

export interface AccountDeletionResult {
  deleted: number;
  /** Collections that could not be fully erased from the browser (permission/index problems). */
  skipped: string[];
}

export async function deleteMyAccountData(uid: string): Promise<AccountDeletionResult> {
  if (CLOUD_FUNCTIONS_ENABLED) {
    try {
      const res = await invokeCloudFunction<unknown, { deleted?: number }>('deleteMyAccountData');
      return { deleted: Number(res?.deleted || 0), skipped: [] };
    } catch {
      // fall through to the browser-side path below
    }
  }

  let deleted = 0;
  const skipped: string[] = [];

  for (const spec of OWNED_QUERIES) {
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const snap = await getDocs(
          query(collection(db, spec.col), where(spec.field, spec.op || '==', uid), limit(PAGE))
        );
        if (snap.empty) break;
        const batch = writeBatch(db);
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
        deleted += snap.size;
        if (snap.size < PAGE) break;
      }
    } catch {
      skipped.push(`${spec.col}.${spec.field}`);
    }
  }

  // Settings and the public profile document go last so a retry can still find the rest.
  await deleteDoc(doc(db, 'userSettings', uid)).catch(() => skipped.push('userSettings'));
  await deleteDoc(doc(db, 'users', uid)).catch(() => skipped.push('users'));
  return { deleted, skipped };
}
