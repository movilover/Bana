import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from 'firebase/firestore';
import { db } from '@/src/firebase';

/**
 * Live, server-authoritative "is this user verified?" lookup.
 *
 * Why this exists: posts/reels used to carry a client-written `authorVerified` copy, which goes stale
 * when verification is granted or revoked and can be forged by the author. The badge is now derived from
 * users/{uid}.isVerified (which only staff can change — see firestore.rules) and updates in real time.
 *
 * Cost control (Firestore Spark): one shared listener per distinct uid no matter how many badges render,
 * torn down 60s after the last consumer unmounts, and capped at MAX_LIVE listeners — beyond that a
 * 5-minute-cached one-shot read is used instead of a listener.
 */

type Listener = (v: boolean | undefined) => void;
interface Entry {
  value: boolean | undefined;
  listeners: Set<Listener>;
  unsub?: () => void;
  expires?: number; // one-shot entries only
  teardown?: ReturnType<typeof setTimeout>;
}

const MAX_LIVE = 120;
const TEARDOWN_MS = 60_000;
const ONE_SHOT_TTL_MS = 5 * 60_000;
const entries = new Map<string, Entry>();
let liveCount = 0;

function setValue(entry: Entry, v: boolean | undefined) {
  entry.value = v;
  entry.listeners.forEach((l) => l(v));
}

function attach(uid: string, listener: Listener): () => void {
  let entry = entries.get(uid);
  if (entry?.expires && entry.expires < Date.now()) {
    entries.delete(uid);
    entry = undefined;
  }
  if (!entry) {
    entry = { value: undefined, listeners: new Set() };
    entries.set(uid, entry);
    const created = entry;
    if (liveCount < MAX_LIVE) {
      liveCount += 1;
      created.unsub = onSnapshot(
        doc(db, 'users', uid),
        (snap) => setValue(created, snap.exists() ? snap.data()?.isVerified === true : false),
        () => setValue(created, undefined)
      );
    } else {
      created.expires = Date.now() + ONE_SHOT_TTL_MS;
      getDoc(doc(db, 'users', uid))
        .then((snap) => setValue(created, snap.exists() ? snap.data()?.isVerified === true : false))
        .catch(() => setValue(created, undefined));
    }
  }
  if (entry.teardown) {
    clearTimeout(entry.teardown);
    entry.teardown = undefined;
  }
  entry.listeners.add(listener);
  listener(entry.value);

  const target = entry;
  return () => {
    target.listeners.delete(listener);
    if (target.listeners.size === 0 && target.unsub) {
      target.teardown = setTimeout(() => {
        if (target.listeners.size === 0) {
          target.unsub?.();
          liveCount = Math.max(0, liveCount - 1);
          if (entries.get(uid) === target) entries.delete(uid);
        }
      }, TEARDOWN_MS);
    }
  };
}

/** `undefined` while loading or on error → callers must treat that as NOT verified (never trust a client copy). */
export function useLiveVerified(uid?: string | null): boolean {
  const [value, setVal] = useState<boolean | undefined>(undefined);
  useEffect(() => {
    if (!uid) {
      setVal(undefined);
      return;
    }
    return attach(uid, setVal);
  }, [uid]);
  return value === true;
}
