import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/src/contexts/AuthContext';
import type { FriendStatus, SuggestedUserItem } from '@/src/lib/socialGraph';
import {
  addFriendFromSuggestion,
  getFriendSuggestions,
  getSuggestionConfig,
  removeSuggestionFromCache,
  undoFriendRequestFromSuggestion,
  type SuggestionConfig,
} from '@/src/lib/friendSuggestions';
import { dismissSuggestion, loadDismissedSuggestionIds } from '@/src/lib/suggestionDismissals';


/** One shared fetch for every suggestion surface on a page. */
export function useFriendSuggestions(limitCount = 20) {
  const { firebaseUser, profile, settings, blockedUids } = useAuth();
  const [items, setItems] = useState<SuggestedUserItem[]>([]);
  const [config, setConfig] = useState<SuggestionConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<Record<string, FriendStatus>>({});
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [cardError, setCardError] = useState<Record<string, string>>({});

  // Refs so a dismissal never re-triggers a network refresh (and never produces duplicates).
  const dismissedRef = useRef<string[]>([]);
  dismissedRef.current = settings?.dismissedSuggestionIds || dismissedRef.current;
  const blockedRef = useRef<string[]>([]);
  blockedRef.current = blockedUids || [];
  const sessionDismissed = useRef<Set<string>>(new Set());

  const uid = firebaseUser?.uid;
  const load = useCallback(
    async (force = false) => {
      if (!uid || !profile) return;
      setLoading(true);
      setError(null);
      try {
        // Per-document dismissals (unlimited) + the legacy capped settings array (backward compatible).
        const stored = await loadDismissedSuggestionIds(uid);
        const res = await getFriendSuggestions({
          myProfile: profile,
          blockedUids: blockedRef.current,
          dismissedUids: [...dismissedRef.current, ...stored, ...sessionDismissed.current],
          limitCount,
          force,
        });
        setConfig(res.config);
        setItems(res.items);
      } catch {
        setError('Could not load suggestions.');
        setItems([]);
      } finally {
        setLoading(false);
      }
    },
    // profile object identity changes on refreshProfile(); only the uid should retrigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [uid, limitCount]
  );

  useEffect(() => {
    if (!uid) {
      setLoading(false);
      return;
    }
    if (!profile) return;
    void load(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [uid, !!profile]);

  useEffect(() => {
    void getSuggestionConfig().then(setConfig);
  }, []);

  const add = useCallback(
    async (item: SuggestedUserItem) => {
      if (!profile) return;
      const target = item.user.uid;
      if (busy[target]) return; // double-click guard (the backend is idempotent too)
      setBusy((b) => ({ ...b, [target]: true }));
      setCardError((e) => ({ ...e, [target]: '' }));
      try {
        const next = await addFriendFromSuggestion(profile, item.user);
        setStatus((s) => ({ ...s, [target]: next }));
      } catch (err: any) {
        setCardError((e) => ({ ...e, [target]: err?.message || 'Could not send request.' }));
      } finally {
        setBusy((b) => ({ ...b, [target]: false }));
      }
    },
    [profile, busy]
  );

  const undo = useCallback(
    async (targetUid: string) => {
      if (!profile) return;
      setBusy((b) => ({ ...b, [targetUid]: true }));
      try {
        const next = await undoFriendRequestFromSuggestion(profile, targetUid);
        setStatus((s) => ({ ...s, [targetUid]: next }));
      } catch (err: any) {
        setCardError((e) => ({ ...e, [targetUid]: err?.message || 'Could not cancel request.' }));
      } finally {
        setBusy((b) => ({ ...b, [targetUid]: false }));
      }
    },
    [profile]
  );

  const dismiss = useCallback(
    async (targetUid: string) => {
      setItems((prev) => prev.filter((i) => i.user.uid !== targetUid)); // immediate
      sessionDismissed.current.add(targetUid);
      if (uid) removeSuggestionFromCache(uid, targetUid);
      if (uid) await dismissSuggestion(uid, targetUid).catch(() => {}); // one doc per dismissal; no 300-id cap
    },
    [uid]
  );

  return { items, config, loading, error, status, busy, cardError, add, undo, dismiss, refresh: () => load(true) };
}
