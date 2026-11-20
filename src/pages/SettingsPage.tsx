import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sun,
  Moon,
  Monitor,
  Download,
  LogOut,
  Trash2,
  Shield,
  MessageSquare,
  PhoneCall,
} from 'lucide-react';
import { collection, query, where, getDocs, deleteDoc, doc, getDoc } from 'firebase/firestore';
import { deleteUser } from 'firebase/auth';
import { deleteMyAccountData } from '@/src/lib/accountDeletion';
import { auth, db } from '@/src/firebase';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTheme } from '@/src/contexts/ThemeContext';
import { useToast } from '@/src/contexts/ToastContext';
import { AppShell } from '@/src/components/layout/AppShell';
import { Avatar } from '@/src/components/common/Avatar';
import { ConfirmDialog } from '@/src/components/common/ConfirmDialog';
import type {
  ChatBubbleStyle,
  MessengerThemeMode,
  PostVisibility,
  ThemeMode,
  FriendRequestPolicy,
  ProfileListVisibility,
  FollowerListVisibility,
} from '@/src/types/bana';

interface BlockedRow {
  id: string;
  blockedUid: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
}

interface RestrictedRow {
  id: string;
  restrictedUid: string;
  displayName?: string;
  username?: string;
  avatarUrl?: string;
}

export function SettingsPage() {
  const { firebaseUser, profile, settings, updateLocalSettings, logout, refreshSocialFilters } = useAuth();
  const { themeMode, messengerTheme } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  const [blockedUsers, setBlockedUsers] = useState<BlockedRow[]>([]);
  const [restrictedUsers, setRestrictedUsers] = useState<RestrictedRow[]>([]);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);

  useEffect(() => {
    if (!firebaseUser) return;
    getDocs(query(collection(db, 'userBlocks'), where('blockerId', '==', firebaseUser.uid)))
      .then(async (snap) => {
        const rows: BlockedRow[] = await Promise.all(
          snap.docs.map(async (d) => {
            const blockedUid = String(d.data().blockedUid || '');
            const uSnap = blockedUid ? await getDoc(doc(db, 'users', blockedUid)).catch(() => null) : null;
            const u = uSnap?.exists() ? uSnap.data() : null;
            return {
              id: d.id,
              blockedUid,
              displayName: u?.displayName,
              username: u?.username,
              avatarUrl: u?.avatarUrl,
            };
          })
        );
        setBlockedUsers(rows);
      })
      .catch(() => {});

    getDocs(query(collection(db, 'userRestrictions'), where('restrictorId', '==', firebaseUser.uid)))
      .then(async (snap) => {
        const rows: RestrictedRow[] = await Promise.all(
          snap.docs.map(async (d) => {
            const restrictedUid = String(d.data().restrictedUid || '');
            const uSnap = restrictedUid ? await getDoc(doc(db, 'users', restrictedUid)).catch(() => null) : null;
            const u = uSnap?.exists() ? uSnap.data() : null;
            return {
              id: d.id,
              restrictedUid,
              displayName: u?.displayName,
              username: u?.username,
              avatarUrl: u?.avatarUrl,
            };
          })
        );
        setRestrictedUsers(rows);
      })
      .catch(() => {});
  }, [firebaseUser]);

  if (!firebaseUser || !profile || !settings) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 px-4 text-center space-y-4">
          <h1 className="font-display font-bold text-xl">BANA Settings</h1>
          <p className="text-sm text-neutral-500">Sign in to manage theme, privacy, and account preferences.</p>
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

  const notifySaved = (msg = 'Preferences saved to your account.') => {
    setSavedNotice(msg);
    toast.success(msg);
    setTimeout(() => setSavedNotice(null), 2500);
  };

  const handleCallNotificationToggle = async (enabled: boolean) => {
    if (enabled && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      try {
        await Notification.requestPermission();
      } catch {
        // Browser dismissed permission dialog
      }
    }
    await updateLocalSettings({ callNotificationsEnabled: enabled });
    notifySaved();
  };

  const handleExportData = async () => {
    const postsSnap = await getDocs(query(collection(db, 'posts'), where('authorId', '==', firebaseUser.uid)));
    // Extra data categories (best effort: a category the security rules do not allow is simply left out).
    const [reelsSnap, followingSnap, followersSnap, commentsSnap] = await Promise.all([
      getDocs(query(collection(db, 'reels'), where('authorId', '==', firebaseUser.uid))).catch(() => null),
      getDocs(query(collection(db, 'userFollows'), where('followerId', '==', firebaseUser.uid))).catch(() => null),
      getDocs(query(collection(db, 'userFollows'), where('followingId', '==', firebaseUser.uid))).catch(() => null),
      getDocs(query(collection(db, 'comments'), where('authorId', '==', firebaseUser.uid))).catch(() => null),
    ]);
    const payload = {
      exportedAt: new Date().toISOString(),
      profile,
      settings,
      posts: postsSnap.docs.map((d) => ({ id: d.id, ...d.data() })),
      reels: reelsSnap ? reelsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [],
      following: followingSnap ? followingSnap.docs.map((d) => d.data().followingId) : [],
      followers: followersSnap ? followersSnap.docs.map((d) => d.data().followerId) : [],
      comments: commentsSnap ? commentsSnap.docs.map((d) => ({ id: d.id, ...d.data() })) : [],
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bana-data-${profile.username}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async () => {
    if (!auth.currentUser) return;
    // Firebase only allows deleting the sign-in account shortly after a fresh sign-in. Check BEFORE erasing
    // any data so the profile is never removed while the login account survives.
    const lastSignIn = auth.currentUser.metadata?.lastSignInTime ? Date.parse(auth.currentUser.metadata.lastSignInTime) : 0;
    if (!lastSignIn || Date.now() - lastSignIn > 4 * 60 * 1000) {
      toast.error('For your security, please sign out, sign in again, and delete your account right away.');
      setConfirmDelete(false);
      return;
    }
    setDeletingAccount(true);
    try {
      const erasure = await deleteMyAccountData(firebaseUser.uid);
      if (erasure.skipped.length > 0) {
        console.warn('Some data could not be erased from the browser:', erasure.skipped);
      }
      await deleteUser(auth.currentUser);
      setConfirmDelete(false);
      toast.info('Your BANA account has been deleted.');
      navigate('/login');
    } catch {
      toast.error('Please sign out and sign in again recently before deleting your account.');
      setConfirmDelete(false);
    } finally {
      setDeletingAccount(false);
    }
  };

  return (
    <AppShell>
      <div className="max-w-3xl mx-auto px-4 sm:px-6 py-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display font-extrabold text-2xl">Settings & Privacy</h1>
            <p className="text-xs text-neutral-500">
              Manage BANA theme modes, Messenger customization, calling privacy, and account safety.
            </p>
          </div>
          {savedNotice && (
            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{savedNotice}</span>
          )}
        </div>

        {/* Appearance, Messenger Theme & Bubble Style */}
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          <h2 className="font-display font-bold text-base">Appearance & Messenger Theme</h2>

          <div className="space-y-2">
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">App Theme</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'light', label: 'Light', icon: Sun },
                  { id: 'dark', label: 'Dark', icon: Moon },
                  { id: 'system', label: 'System', icon: Monitor },
                ] as { id: ThemeMode; label: string; icon: any }[]
              ).map((opt) => {
                const Icon = opt.icon;
                const active = themeMode === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={async () => {
                      await updateLocalSettings({ themeMode: opt.id });
                      notifySaved();
                    }}
                    className={`h-11 rounded-xl border text-xs font-semibold flex items-center justify-center gap-2 ${
                      active
                        ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2] dark:text-blue-400'
                        : 'border-neutral-200 dark:border-neutral-800'
                    }`}
                  >
                    <Icon className="w-4 h-4" /> {opt.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400 flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Independent Messenger Theme
            </p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'match', label: 'Match App' },
                  { id: 'light', label: 'Messenger Light' },
                  { id: 'dark', label: 'Messenger Dark' },
                ] as { id: MessengerThemeMode; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={async () => {
                    await updateLocalSettings({ messengerTheme: opt.id });
                    notifySaved();
                  }}
                  className={`h-10 rounded-xl border text-xs font-semibold ${
                    messengerTheme === opt.id
                      ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2] dark:text-blue-400'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2 pt-2">
            <p className="text-xs font-medium text-neutral-600 dark:text-neutral-400">Chat Bubble Style</p>
            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: 'classic', label: 'Classic Blue' },
                  { id: 'minimal', label: 'Minimal Crisp' },
                  { id: 'soft', label: 'Soft Pill' },
                ] as { id: ChatBubbleStyle; label: string }[]
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={async () => {
                    await updateLocalSettings({ chatBubbleStyle: opt.id });
                    notifySaved();
                  }}
                  className={`h-10 rounded-xl border text-xs font-semibold ${
                    (settings.chatBubbleStyle || 'classic') === opt.id
                      ? 'border-[#1877F2] bg-[#1877F2]/10 text-[#1877F2] dark:text-blue-400'
                      : 'border-neutral-200 dark:border-neutral-800'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Privacy & Calling Controls */}
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          <h2 className="font-display font-bold text-base flex items-center gap-2">
            <Shield className="w-4 h-4 text-[#1877F2]" /> Privacy, Messaging & Calling Controls
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
            <div>
              <label className="block font-medium mb-1">Default Post Visibility</label>
              <select
                value={settings.whoCanSeePosts}
                onChange={async (e) => {
                  await updateLocalSettings({ whoCanSeePosts: e.target.value as PostVisibility });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="public">Public</option>
                <option value="followers">Followers</option>
                <option value="friends">Friends</option>
                <option value="only_me">Only me</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1">Who Can Message Me</label>
              <select
                value={settings.whoCanMessage}
                onChange={async (e) => {
                  await updateLocalSettings({ whoCanMessage: e.target.value as any });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="followers">Followers (others send Requests)</option>
                <option value="friends">Mutual Friends (others send Requests)</option>
                <option value="nobody">Nobody</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1 flex items-center gap-1">
                <PhoneCall className="w-3.5 h-3.5 text-[#1877F2]" /> Who Can Call Me (Audio & Video)
              </label>
              <select
                value={settings.whoCanCall || 'everyone'}
                onChange={async (e) => {
                  await updateLocalSettings({ whoCanCall: e.target.value as any });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="followers">Followers Only</option>
                <option value="friends">Mutual Friends Only</option>
                <option value="nobody">Nobody</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1">Who Can Comment</label>
              <select
                value={settings.whoCanComment}
                onChange={async (e) => {
                  await updateLocalSettings({ whoCanComment: e.target.value as any });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="followers">Followers</option>
                <option value="friends">Friends</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1">Who Can Follow Me</label>
              <select
                value={settings.isPrivateAccount ? 'approval' : settings.whoCanFollow}
                onChange={async (e) => {
                  const val = e.target.value as 'everyone' | 'approval';
                  await updateLocalSettings({
                    whoCanFollow: val,
                    ...(val === 'everyone' ? { isPrivateAccount: false } : {}),
                  });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="approval">Require Approval</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1">Who Can Send Friend Requests</label>
              <select
                value={settings.whoCanFriendRequest || 'everyone'}
                onChange={async (e) => {
                  await updateLocalSettings({ whoCanFriendRequest: e.target.value as FriendRequestPolicy });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="friends_of_friends">Friends of Friends</option>
                <option value="followers">People I Follow</option>
                <option value="nobody">Nobody</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1">Who Can View Friends List</label>
              <select
                value={settings.whoCanViewFriends || 'everyone'}
                onChange={async (e) => {
                  await updateLocalSettings({ whoCanViewFriends: e.target.value as ProfileListVisibility });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="friends">Friends Only</option>
                <option value="only_me">Only Me</option>
              </select>
            </div>

            <div>
              <label className="block font-medium mb-1">Who Can View Followers & Following</label>
              <select
                value={settings.whoCanViewFollowers || 'everyone'}
                onChange={async (e) => {
                  await updateLocalSettings({ whoCanViewFollowers: e.target.value as FollowerListVisibility });
                  notifySaved();
                }}
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-950 px-3"
              >
                <option value="everyone">Everyone</option>
                <option value="followers">Followers Only</option>
                <option value="only_me">Only Me</option>
              </select>
            </div>
          </div>

          <div className="space-y-2.5 pt-2 text-xs border-t border-neutral-100 dark:border-neutral-800">
            <label className="flex items-center justify-between py-1.5">
              <div>
                <span className="font-semibold block">Private Account Mode</span>
                <span className="text-[11px] text-neutral-500">
                  Only approved followers can view your full posts, reels, photos, and friends lists.
                </span>
              </div>
              <input
                type="checkbox"
                checked={Boolean(settings.isPrivateAccount)}
                onChange={async (e) => {
                  const isPriv = e.target.checked;
                  await updateLocalSettings({
                    isPrivateAccount: isPriv,
                    whoCanFollow: isPriv ? 'approval' : settings.whoCanFollow,
                  });
                  notifySaved();
                }}
                className="accent-[#1877F2]"
              />
            </label>

            {[
              { key: 'showOnlineStatus', label: 'Show Online Activity Status in Messenger' },
              { key: 'showReadReceipts', label: 'Send Read Receipts in Messenger' },
              { key: 'messengerSoundEnabled', label: 'Messenger Ringtone & Sound Effects' },
              { key: 'showPersonalInfo', label: 'Show Profile Bio Website & Contact Info Publicly' },
              { key: 'showLocation', label: 'Show Profile Location City / District Publicly' },
            ].map((toggle) => (
              <label key={toggle.key} className="flex items-center justify-between py-1.5">
                <span>{toggle.label}</span>
                <input
                  type="checkbox"
                  checked={(settings as any)[toggle.key] !== false}
                  onChange={async (e) => {
                    await updateLocalSettings({ [toggle.key]: e.target.checked } as any);
                    notifySaved();
                  }}
                  className="accent-[#1877F2]"
                />
              </label>
            ))}

            <label className="flex items-center justify-between py-1.5">
              <span>Incoming Call Browser Notifications (Background Tabs)</span>
              <input
                type="checkbox"
                checked={settings.callNotificationsEnabled !== false}
                onChange={(e) => handleCallNotificationToggle(e.target.checked)}
                className="accent-[#1877F2]"
              />
            </label>
          </div>
        </section>

        {/* Notification Preferences */}
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
          <h2 className="font-display font-bold text-base">Notification Preferences</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
            {(
              [
                { key: 'likes', label: 'Post & Reel Reactions' },
                { key: 'comments', label: 'Comments & Voice Replies' },
                { key: 'follows', label: 'Followers & Follow Requests' },
                { key: 'friendRequests', label: 'Friend Requests & Acceptances' },
                { key: 'messages', label: 'Direct & Group Messages' },
                { key: 'verification', label: 'Verification & Account Status' },
              ] as const
            ).map((pref) => (
              <label
                key={pref.key}
                className="flex items-center justify-between px-3 py-2 rounded-xl border border-neutral-100 dark:border-neutral-800"
              >
                <span>{pref.label}</span>
                <input
                  type="checkbox"
                  checked={(settings.notificationPrefs as any)?.[pref.key] !== false}
                  onChange={async (e) => {
                    await updateLocalSettings({
                      notificationPrefs: {
                        ...settings.notificationPrefs,
                        [pref.key]: e.target.checked,
                      },
                    });
                    notifySaved();
                  }}
                  className="accent-[#1877F2]"
                />
              </label>
            ))}
          </div>
        </section>

        {/* Blocked & Restricted Users */}
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-4">
          <div className="space-y-2.5">
            <h2 className="font-display font-bold text-base">Blocked Accounts ({blockedUsers.length})</h2>
            {blockedUsers.length === 0 ? (
              <p className="text-xs text-neutral-500">You have not blocked any accounts.</p>
            ) : (
              <div className="space-y-2">
                {blockedUsers.map((b) => (
                  <div key={b.id} className="flex items-center justify-between gap-3 text-xs py-1.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={b.avatarUrl} name={b.displayName || b.blockedUid} size="sm" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{b.displayName || 'BANA Member'}</p>
                        <p className="text-[11px] text-neutral-500 font-mono truncate">
                          {b.username ? `@${b.username}` : b.blockedUid}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteDoc(doc(db, 'userBlocks', b.id));
                        setBlockedUsers((prev) => prev.filter((x) => x.id !== b.id));
                        await refreshSocialFilters();
                        toast.info('Account unblocked.');
                      }}
                      className="px-3 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[#1877F2] font-semibold shrink-0"
                    >
                      Unblock
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="space-y-2.5 pt-3 border-t border-neutral-100 dark:border-neutral-800">
            <h3 className="font-display font-bold text-sm">Restricted Accounts ({restrictedUsers.length})</h3>
            {restrictedUsers.length === 0 ? (
              <p className="text-xs text-neutral-500">
                Restricted accounts cannot see your activity status or send direct calls/messages without requests.
              </p>
            ) : (
              <div className="space-y-2">
                {restrictedUsers.map((r) => (
                  <div key={r.id} className="flex items-center justify-between gap-3 text-xs py-1.5">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar src={r.avatarUrl} name={r.displayName || r.restrictedUid} size="sm" />
                      <div className="min-w-0">
                        <p className="font-semibold truncate">{r.displayName || 'BANA Member'}</p>
                        <p className="text-[11px] text-neutral-500 font-mono truncate">
                          {r.username ? `@${r.username}` : r.restrictedUid}
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        await deleteDoc(doc(db, 'userRestrictions', r.id));
                        setRestrictedUsers((prev) => prev.filter((x) => x.id !== r.id));
                        await refreshSocialFilters();
                        toast.info('Restriction removed.');
                      }}
                      className="px-3 py-1 rounded-lg border border-neutral-200 dark:border-neutral-700 text-[#1877F2] font-semibold shrink-0"
                    >
                      Unrestrict
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Data Export, Sign Out & Account Deletion */}
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-5 space-y-3">
          <h2 className="font-display font-bold text-base">Account & Data</h2>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={handleExportData}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <Download className="w-3.5 h-3.5" /> Export My Data (JSON)
            </button>
            <button
              type="button"
              onClick={async () => {
                await logout();
                navigate('/login');
              }}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-800"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign Out
            </button>
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-red-200 dark:border-red-900 text-xs font-semibold text-red-600"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Account
            </button>
          </div>
        </section>
      </div>

      <ConfirmDialog
        isOpen={confirmDelete}
        title="Delete BANA Account Permanently"
        description="This deletes your authentication account and user settings. This action cannot be undone."
        confirmLabel="Delete Account"
        loading={deletingAccount}
        onConfirm={handleDeleteAccount}
        onCancel={() => {
          if (!deletingAccount) setConfirmDelete(false);
        }}
      />
    </AppShell>
  );
}
