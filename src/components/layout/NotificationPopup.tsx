import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Bell,
  Heart,
  MessageCircle,
  UserPlus,
  Users,
  ShoppingBag,
  Sparkles,
  CheckCheck,
  Settings,
  AtSign,
  UserCheck,
  ShieldCheck,
} from 'lucide-react';
import {
  collection,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  doc,
  updateDoc,
} from 'firebase/firestore';
import { db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { BanaNotification } from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { formatRelativeTime } from '@/src/lib/mediaUtils';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';
import { sortByCreatedAtDesc, subscribeWithIndexFallback } from '@/src/lib/firestoreQuery';

export function NotificationPopup({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { firebaseUser } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [items, setItems] = useState<BanaNotification[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isOpen || !firebaseUser) return;
    setLoading(true);
    const primaryQ = query(
      collection(db, 'notifications'),
      where('recipientId', '==', firebaseUser.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );
    const fallbackQ = query(
      collection(db, 'notifications'),
      where('recipientId', '==', firebaseUser.uid),
      limit(50)
    );
    const unsub = subscribeWithIndexFallback<BanaNotification>({
      primaryQuery: primaryQ,
      fallbackQuery: fallbackQ,
      comparator: sortByCreatedAtDesc,
      onData: (list) => {
        setItems(list.slice(0, 20));
        setLoading(false);
      },
      onError: (err) => {
        logFirestoreError(err, OperationType.LIST, 'notifications');
        setLoading(false);
      },
    });
    return () => unsub();
  }, [isOpen, firebaseUser]);

  if (!isOpen) return null;

  const markAsRead = async (n: BanaNotification) => {
    if (!n.isRead) {
      await updateDoc(doc(db, 'notifications', n.id), { isRead: true }).catch(() => {});
    }
    onClose();
    // Only follow in-app paths; ignore empty, external, or protocol-relative links.
    const target = n.linkUrl && n.linkUrl.startsWith('/') && !n.linkUrl.startsWith('//') ? n.linkUrl : '/discover';
    navigate(target);
  };

  const markAllRead = async () => {
    const unread = items.filter((i) => !i.isRead);
    if (unread.length === 0) return;
    const results = await Promise.all(
      unread.map((n) =>
        updateDoc(doc(db, 'notifications', n.id), { isRead: true }).then(
          () => true,
          () => false
        )
      )
    );
    const failed = results.filter((ok) => !ok).length;
    if (failed === 0) toast.success('All notifications marked as read.');
    else toast.error(`${failed} notification${failed === 1 ? '' : 's'} could not be updated. Please try again.`);
  };

  const getTypeIcon = (type: BanaNotification['type']) => {
    switch (type) {
      case 'like':
        return <Heart className="w-3.5 h-3.5 text-rose-500" />;
      case 'comment':
      case 'reply':
        return <MessageCircle className="w-3.5 h-3.5 text-[#1877F2]" />;
      case 'follow':
      case 'follow_request':
      case 'friend_request':
        return <UserPlus className="w-3.5 h-3.5 text-emerald-600" />;
      case 'follow_accepted':
      case 'friend_accepted':
        return <UserCheck className="w-3.5 h-3.5 text-[#1877F2]" />;
      case 'verification':
        return <ShieldCheck className="w-3.5 h-3.5 text-[#1877F2]" />;
      case 'mention':
        return <AtSign className="w-3.5 h-3.5 text-amber-600" />;
      case 'community':
        return <Users className="w-3.5 h-3.5 text-[#1877F2]" />;
      case 'marketplace':
        return <ShoppingBag className="w-3.5 h-3.5 text-emerald-600" />;
      case 'monetization':
      case 'ad':
        return <Sparkles className="w-3.5 h-3.5 text-amber-500" />;
      default:
        return <Bell className="w-3.5 h-3.5 text-neutral-500" />;
    }
  };

  const unreadCount = items.filter((i) => !i.isRead).length;

  return (
    <div
      role="dialog"
      aria-label="Notifications"
      className="animate-dropdown-in fixed inset-x-3 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-12 w-auto sm:w-[370px] rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl z-40 overflow-hidden"
    >
      <div className="px-4 py-3 border-b border-neutral-200 dark:border-neutral-800 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="font-display font-bold text-sm text-neutral-950 dark:text-white">
            Notifications
          </h3>
          {unreadCount > 0 && (
            <span className="font-mono text-[11px] font-semibold text-[#1877F2] tabular-nums">
              {unreadCount} new
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={markAllRead}
              className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-semibold text-[#1877F2] hover:bg-[#1877F2]/10 transition-colors"
            >
              <CheckCheck className="w-3.5 h-3.5" /> Mark all
            </button>
          )}
          <Link
            to="/settings"
            onClick={onClose}
            aria-label="Notification settings"
            className="p-1.5 rounded-lg text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-900"
          >
            <Settings className="w-4 h-4" />
          </Link>
        </div>
      </div>

      <div className="max-h-[60vh] overflow-y-auto divide-y divide-neutral-100 dark:divide-neutral-900">
        {loading ? (
          <div className="p-4 space-y-3">
            {[1, 2, 3].map((k) => (
              <div key={k} className="flex items-center gap-3 animate-pulse">
                <div className="h-9 w-9 rounded-full bg-neutral-200 dark:bg-neutral-800" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-3 w-3/4 rounded bg-neutral-200 dark:bg-neutral-800" />
                  <div className="h-2.5 w-1/3 rounded bg-neutral-100 dark:bg-neutral-900" />
                </div>
              </div>
            ))}
          </div>
        ) : items.length === 0 ? (
          <div className="py-10 px-4 text-center space-y-2">
            <Bell className="w-7 h-7 mx-auto text-neutral-300 dark:text-neutral-700" />
            <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-300">
              All caught up
            </p>
            <p className="text-[11px] text-neutral-500">
              Likes, comments, replies, follows, and updates appear here.
            </p>
          </div>
        ) : (
          items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => markAsRead(n)}
              className={`w-full text-left px-4 py-3 flex items-start gap-3 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors ${
                !n.isRead ? 'bg-blue-50/45 dark:bg-blue-950/15' : ''
              }`}
            >
              <div className="relative shrink-0">
                <Avatar src={n.actorAvatar} name={n.actorName || 'BANA'} size="sm" />
                <span className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-white dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 flex items-center justify-center">
                  {getTypeIcon(n.type)}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs text-neutral-900 dark:text-neutral-100 leading-snug">
                  {n.body || n.title}
                </p>
                <p className="text-[11px] text-neutral-500 mt-1">{formatRelativeTime(n.createdAt)}</p>
              </div>
              {!n.isRead && (
                <span className="h-2 w-2 rounded-full bg-[#1877F2] shrink-0 mt-1.5" />
              )}
            </button>
          ))
        )}
      </div>

      <div className="px-4 py-2.5 border-t border-neutral-200 dark:border-neutral-800 bg-neutral-50/80 dark:bg-neutral-900/50 text-center">
        <Link
          to="/notifications"
          onClick={onClose}
          className="text-xs font-semibold text-[#1877F2] hover:underline"
        >
          View all notifications
        </Link>
      </div>
    </div>
  );
}
