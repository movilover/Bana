import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Settings } from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import type { BanaNotification } from '@/src/types/bana';
import { AppShell } from '@/src/components/layout/AppShell';
import { Avatar } from '@/src/components/common/Avatar';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { sortByCreatedAtDesc, subscribeWithIndexFallback } from '@/src/lib/firestoreQuery';

export function NotificationsPage() {
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();
  const [items, setItems] = useState<BanaNotification[]>([]);
  const [filter, setFilter] = useState<'all' | 'unread' | 'social' | 'business'>('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!firebaseUser) {
      setLoading(false);
      return;
    }
    const primaryQ = query(
      collection(db, 'notifications'),
      where('recipientId', '==', firebaseUser.uid),
      orderBy('createdAt', 'desc'),
      limit(60)
    );
    const fallbackQ = query(
      collection(db, 'notifications'),
      where('recipientId', '==', firebaseUser.uid),
      limit(80)
    );
    const unsub = subscribeWithIndexFallback<BanaNotification>({
      primaryQuery: primaryQ,
      fallbackQuery: fallbackQ,
      comparator: sortByCreatedAtDesc,
      onData: (list) => {
        setItems(list);
        setLoading(false);
      },
      onError: (err) => {
        logFirestoreError(err, OperationType.LIST, 'notifications');
        setLoading(false);
      },
    });
    return () => unsub();
  }, [firebaseUser]);

  if (!firebaseUser) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
          <h1 className="font-display font-bold text-xl">Notifications</h1>
          <p className="text-sm text-neutral-500">Sign in to view your real-time BANA activity.</p>
          <button
            type="button"
            onClick={() => navigate('/login')}
            className="px-5 py-2.5 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-xs font-semibold"
          >
            Sign In
          </button>
        </div>
      </AppShell>
    );
  }

  const markAllRead = async () => {
    const unread = items.filter((n) => !n.isRead);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((n) => batch.update(doc(db, 'notifications', n.id), { isRead: true }));
    await batch.commit().catch(() => {});
  };

  const filtered = items.filter((n) => {
    if (filter === 'unread') return !n.isRead;
    if (filter === 'social') {
      return [
        'like',
        'comment',
        'reply',
        'follow',
        'follow_request',
        'follow_accepted',
        'friend_request',
        'friend_accepted',
        'verification',
        'mention',
        'message',
        'call',
      ].includes(n.type);
    }
    if (filter === 'business') return ['community', 'marketplace', 'monetization', 'ad'].includes(n.type);
    return true;
  });

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h1 className="font-display font-extrabold text-2xl">Notifications</h1>
            <p className="text-xs text-neutral-500">Real-time updates across posts, Messenger, communities, and Creator Studio.</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-medium hover:bg-neutral-100 dark:hover:bg-neutral-900"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all read
            </button>
            <Link
              to="/settings"
              className="h-9 w-9 rounded-xl border border-neutral-200 dark:border-neutral-800 flex items-center justify-center"
              title="Notification preferences"
            >
              <Settings className="w-4 h-4" />
            </Link>
          </div>
        </div>

        <div className="inline-flex p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
          {(
            [
              { id: 'all', label: 'All' },
              { id: 'unread', label: 'Unread' },
              { id: 'social', label: 'Social' },
              { id: 'business', label: 'Studio & Market' },
            ] as const
          ).map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setFilter(t.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-medium ${
                filter === t.id ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm' : 'text-neutral-500'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="space-y-3">
            {[1, 2, 3].map((k) => (
              <div key={k} className="h-16 rounded-2xl bg-neutral-100 dark:bg-neutral-900 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 p-12 text-center space-y-2">
            <Bell className="w-8 h-8 mx-auto text-neutral-400" />
            <h3 className="font-display font-bold text-base">You are all caught up</h3>
            <p className="text-xs text-neutral-500">New interactions, follower alerts, and studio updates appear here in real time.</p>
          </div>
        ) : (
          <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 divide-y divide-neutral-100 dark:divide-neutral-800 overflow-hidden bg-white dark:bg-neutral-900">
            {filtered.map((n) => (
              <Link
                key={n.id}
                to={n.linkUrl && n.linkUrl.startsWith('/') && !n.linkUrl.startsWith('//') ? n.linkUrl : '/discover'}
                onClick={() => {
                  if (!n.isRead) updateDoc(doc(db, 'notifications', n.id), { isRead: true }).catch(() => {});
                }}
                className={`flex items-start gap-3.5 p-4 hover:bg-neutral-50 dark:hover:bg-neutral-800/50 transition-colors ${
                  !n.isRead ? 'bg-[#1877F2]/5 dark:bg-blue-950/20' : ''
                }`}
              >
                <Avatar src={n.actorAvatar} name={n.actorName || 'BANA'} size="md" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold truncate">{n.title}</p>
                    <span className="text-[11px] text-neutral-400 shrink-0">{formatRelativeTime(n.createdAt)}</span>
                  </div>
                  <p className="text-xs text-neutral-600 dark:text-neutral-400 mt-0.5">{n.body}</p>
                </div>
                {!n.isRead && <span className="h-2 w-2 rounded-full bg-[#1877F2] mt-2 shrink-0" />}
              </Link>
            ))}
          </div>
        )}
      </div>
    </AppShell>
  );
}
