import React, { createContext, useContext, useEffect, useMemo, useState, useCallback } from 'react';
import {
  User as FirebaseUser,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
  signOut,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  updateDoc,
  serverTimestamp,
  collection,
  query,
  where,
  onSnapshot,
  limit,
} from 'firebase/firestore';
import { auth, db, BOOTSTRAPPED_ADMIN_EMAIL, testFirestoreConnection } from '@/src/firebase';
import { invokeCloudFunction, readSessionCache, writeSessionCache } from '@/src/lib/firebasePlan';
import type {
  BanaUser,
  BanaUserSettings,
  AdminRoleType,
  PlatformSettings,
  DiscoveryCategory,
} from '@/src/types/bana';
import { useTheme } from '@/src/contexts/ThemeContext';
import { logFirestoreError, OperationType } from '@/src/lib/firebaseErrors';

export const DEFAULT_PLATFORM_SETTINGS: PlatformSettings = {
  platformName: 'BANA',
  tagline: 'Discover More. Connect Better.',
  websiteTitle: 'BANA — Discover More. Connect Better.',
  websiteDescription:
    'Discover More. Connect Better. A vibrant, safe social platform with Communities, Reels, Messenger, Marketplace, and Creator Studio.',
  logoUrl: '',
  faviconUrl: '',
  maintenanceMode: false,
  maintenanceMessage: 'Scheduled upgrades are underway. Normal interactive services will resume shortly.',
  registrationOpen: true,
  allowGoogleSignIn: true,
  allowEmailPasswordSignIn: true,
  requireEmailVerification: true,
  enableReels: true,
  enableMarketplace: true,
  enableCalling: true,
  enableMessaging: true,
  enableCommunities: true,
  enableMonetization: true,
  enableAds: true,
  defaultPostVisibility: 'public',
  defaultMessagePrivacy: 'everyone',
  defaultAccountPrivate: false,
  defaultEmailNotifications: true,
  defaultPushNotifications: true,
  contentPolicyText:
    'Share original, authentic content. Harassment, hate speech, non-consensual media, fraud, and illegal goods are prohibited.',
  communityGuidelinesText:
    'Respect community members, verify facts before sharing, disclose sponsored content transparently, and keep spaces safe for everyone.',
  announcementEnabled: false,
  announcementMessage: '',
  announcementSeverity: 'info',
};

interface AuthContextValue {
  firebaseUser: FirebaseUser | null;
  profile: BanaUser | null;
  settings: BanaUserSettings | null;
  adminRole: AdminRoleType | null;
  claimsAdminRole: AdminRoleType | null;
  platformSettings: PlatformSettings;
  needsOnboarding: boolean;
  loading: boolean;
  firestoreWarning: string | null;
  unreadNotifications: number;
  unreadMessages: number;
  blockedUids: string[];
  restrictedUids: string[];
  refreshSocialFilters: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (params: {
    email: string;
    password: string;
    displayName: string;
    username: string;
    birthYear: number;
  }) => Promise<void>;
  checkUsernameAvailable: (username: string, currentUid?: string) => Promise<boolean>;
  reserveUsername: (username: string, uid: string, oldUsername?: string) => Promise<void>;
  completeOnboarding: (params: {
    displayName: string;
    username: string;
    bio: string;
    avatarUrl?: string;
    location?: string;
    interests: DiscoveryCategory[];
  }) => Promise<void>;
  sendResetEmail: (email: string) => Promise<void>;
  resendVerification: () => Promise<void>;
  logout: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateLocalSettings: (partial: Partial<BanaUserSettings>) => Promise<void>;
  authModalOpen: boolean;
  authModalReason: string | null;
  authModalTab: 'login' | 'register';
  openAuthModal: (reason?: string, tab?: 'login' | 'register') => void;
  closeAuthModal: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const defaultSettings = (
  uid: string,
  email?: string,
  birthYear?: number,
  plat: PlatformSettings = DEFAULT_PLATFORM_SETTINGS
): BanaUserSettings => ({
  uid,
  email: email || '',
  birthYear: birthYear || 1998,
  themeMode: 'light',
  messengerTheme: 'match',
  chatBubbleStyle: 'classic',
  messengerSoundEnabled: true,
  callNotificationsEnabled: plat.defaultPushNotifications !== false,
  whoCanSeePosts: plat.defaultPostVisibility || 'public',
  whoCanMessage: plat.defaultMessagePrivacy || 'everyone',
  whoCanCall: 'everyone',
  whoCanComment: 'everyone',
  whoCanFollow: plat.defaultAccountPrivate ? 'approval' : 'everyone',
  whoCanFriendRequest: 'everyone',
  whoCanViewFriends: 'everyone',
  whoCanViewFollowers: 'everyone',
  isPrivateAccount: Boolean(plat.defaultAccountPrivate),
  showOnlineStatus: true,
  showReadReceipts: true,
  showPersonalInfo: true,
  showLocation: true,
  dismissedSuggestionIds: [],
  allowFriendSuggestions: true,
  notificationPrefs: {
    likes: plat.defaultPushNotifications !== false,
    comments: plat.defaultPushNotifications !== false,
    follows: plat.defaultPushNotifications !== false,
    friendRequests: plat.defaultPushNotifications !== false,
    messages: plat.defaultPushNotifications !== false,
    communities: plat.defaultPushNotifications !== false,
    marketplace: plat.defaultEmailNotifications !== false,
    monetization: plat.defaultEmailNotifications !== false,
    verification: plat.defaultEmailNotifications !== false,
  },
});

export function sanitizeUsername(raw: string, fallbackUid?: string): string {
  const cleaned = raw
    .toLowerCase()
    .replace(/[^a-z0-9_.]/g, '')
    .slice(0, 24);
  if (cleaned.length >= 3) return cleaned;
  return fallbackUid ? `user_${fallbackUid.slice(0, 6).toLowerCase()}` : cleaned;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { setThemeMode, setMessengerTheme } = useTheme();
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [baseProfile, setProfile] = useState<BanaUser | null>(null);
  // Private account fields (isMinor, moderation note, messaging restriction) come from userPrivate/{uid};
  // legacy values still on the public doc are used only as a fallback until the migration has run.
  const [privateFields, setPrivateFields] = useState<Partial<BanaUser> | null>(null);
  const profile = useMemo<BanaUser | null>(
    () => (baseProfile ? ({ ...baseProfile, ...(privateFields || {}) } as BanaUser) : baseProfile),
    [baseProfile, privateFields]
  );
  const [settings, setSettings] = useState<BanaUserSettings | null>(null);
  const [adminRole, setAdminRole] = useState<AdminRoleType | null>(null);
  const [claimsAdminRole, setClaimsAdminRole] = useState<AdminRoleType | null>(null);
  const [platformSettings, setPlatformSettings] = useState<PlatformSettings>(DEFAULT_PLATFORM_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [firestoreWarning, setFirestoreWarning] = useState<string | null>(null);
  const [unreadNotifications, setUnreadNotifications] = useState(0);
  const [unreadMessages, setUnreadMessages] = useState(0);
  const [blockedUids, setBlockedUids] = useState<string[]>([]);
  const [restrictedUids, setRestrictedUids] = useState<string[]>([]);
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const [authModalReason, setAuthModalReason] = useState<string | null>(null);
  const [authModalTab, setAuthModalTab] = useState<'login' | 'register'>('login');

  const openAuthModal = useCallback((reason?: string, tab: 'login' | 'register' = 'login') => {
    setAuthModalReason(reason || null);
    setAuthModalTab(tab);
    setAuthModalOpen(true);
  }, []);

  const closeAuthModal = useCallback(() => {
    setAuthModalOpen(false);
  }, []);

  useEffect(() => {
    testFirestoreConnection().then((res) => {
      if (!res.connected && res.message) {
        setFirestoreWarning(res.message);
      }
    });
  }, []);

  // Platform Branding & Feature Settings (Spark-optimized: getDoc + 5-min sessionStorage cache)
  useEffect(() => {
    const CACHE_KEY = 'bana_platform_settings_cache';
    const cached = readSessionCache<Partial<PlatformSettings>>(CACHE_KEY, 5 * 60 * 1000);
    if (cached) {
      setPlatformSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...cached });
      return;
    }
    getDoc(doc(db, 'adminSettings', 'platform'))
      .then((snap) => {
        if (snap.exists()) {
          const data = snap.data() as Partial<PlatformSettings>;
          writeSessionCache(CACHE_KEY, data);
          setPlatformSettings({ ...DEFAULT_PLATFORM_SETTINGS, ...data });
        }
      })
      .catch(() => {
        // Keep defaults gracefully if rules aren't deployed yet
      });
  }, []);

  // Synchronize document title, meta description & optional custom favicon live
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const nextTitle =
      platformSettings.websiteTitle?.trim() ||
      `${platformSettings.platformName || 'BANA'} — ${platformSettings.tagline || 'Discover More. Connect Better.'}`;
    document.title = nextTitle;

    if (platformSettings.websiteDescription) {
      const metaDesc = document.querySelector('meta[name="description"]');
      if (metaDesc) metaDesc.setAttribute('content', platformSettings.websiteDescription);
    }
    if (platformSettings.faviconUrl) {
      let iconEl = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!iconEl) {
        iconEl = document.createElement('link');
        iconEl.rel = 'icon';
        document.head.appendChild(iconEl);
      }
      iconEl.href = platformSettings.faviconUrl;
    }
  }, [
    platformSettings.platformName,
    platformSettings.tagline,
    platformSettings.websiteTitle,
    platformSettings.websiteDescription,
    platformSettings.faviconUrl,
  ]);

  const checkUsernameAvailable = useCallback(async (rawUsername: string, currentUid?: string): Promise<boolean> => {
    const uname = sanitizeUsername(rawUsername);
    if (uname.length < 3 || !/^[a-z0-9_.]{3,30}$/.test(uname)) return false;

    try {
      const [unameSnap, usersSnap] = await Promise.all([
        getDoc(doc(db, 'usernames', uname)).catch(() => null),
        getDocs(query(collection(db, 'users'), where('username', '==', uname), limit(1))).catch(() => null),
      ]);

      if (unameSnap?.exists() && unameSnap.data()?.uid !== currentUid) {
        return false;
      }
      if (usersSnap && !usersSnap.empty && usersSnap.docs[0].id !== currentUid) {
        return false;
      }
      return true;
    } catch {
      return true;
    }
  }, []);

  const reserveUsername = useCallback(async (rawUsername: string, uid: string, oldUsername?: string) => {
    const uname = sanitizeUsername(rawUsername, uid);
    if (oldUsername && oldUsername !== uname) {
      const oldSnap = await getDoc(doc(db, 'usernames', oldUsername)).catch(() => null);
      if (oldSnap?.exists() && oldSnap.data()?.uid === uid) {
        await deleteDoc(doc(db, 'usernames', oldUsername)).catch(() => {});
      }
    }
    await setDoc(doc(db, 'usernames', uname), {
      uid,
      username: uname,
      createdAt: serverTimestamp(),
    }).catch(() => {});
  }, []);

  const ensureUserDocuments = useCallback(
    async (
      fbUser: FirebaseUser,
      extra?: { displayName?: string; username?: string; birthYear?: number; isNewSignup?: boolean }
    ) => {
      const userRef = doc(db, 'users', fbUser.uid);
      const settingsRef = doc(db, 'userSettings', fbUser.uid);

      try {
        const userSnap = await getDoc(userRef);
        if (!userSnap.exists()) {
          const baseName = extra?.displayName || fbUser.displayName || fbUser.email?.split('@')[0] || 'BANA Member';
          let uname = sanitizeUsername(
            extra?.username || fbUser.email?.split('@')[0] || baseName,
            fbUser.uid
          );
          const available = await checkUsernameAvailable(uname, fbUser.uid);
          if (!available) {
            uname = sanitizeUsername(`${uname}_${fbUser.uid.slice(0, 4)}`, fbUser.uid);
          }

          const isMinor = extra?.birthYear ? new Date().getFullYear() - extra.birthYear < 18 : false;

          const newUser: BanaUser = {
            uid: fbUser.uid,
            username: uname,
            displayName: baseName.slice(0, 80),
            bio: '',
            avatarUrl: fbUser.photoURL || '',
            coverUrl: '',
            location: '',
            website: '',
            interests: [],
            onboardingCompleted: false,
            isVerified: false,
            isCreator: false,
            isMinor,
            accountStatus: 'active',
            followersCount: 0,
            followingCount: 0,
            friendsCount: 0,
            postsCount: 0,
          };

          // PRIVACY: isMinor is NOT stored on the public profile; it goes to userPrivate (owner/admin only).
          const { isMinor: _minor, ...publicUser } = newUser;
          await setDoc(userRef, {
            ...publicUser,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
          await setDoc(doc(db, 'userPrivate', fbUser.uid), {
            uid: fbUser.uid,
            isMinor,
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          }).catch(() => {});
          await reserveUsername(uname, fbUser.uid);
          setProfile(newUser);
        } else {
          const existingData = userSnap.data() as Omit<BanaUser, 'uid'>;
          setProfile({ uid: userSnap.id, ...existingData });
        }

        const settingsSnap = await getDoc(settingsRef);
        if (!settingsSnap.exists()) {
          const initialSettings = defaultSettings(fbUser.uid, fbUser.email || '', extra?.birthYear, platformSettings);
          await setDoc(settingsRef, {
            ...initialSettings,
            updatedAt: serverTimestamp(),
          });
          setSettings(initialSettings);
        } else {
          const s = settingsSnap.data() as BanaUserSettings;
          setSettings(s);
          if (s.themeMode) setThemeMode(s.themeMode);
          if (s.messengerTheme) setMessengerTheme(s.messengerTheme);
        }

        // Verify Firebase Auth Custom Claims first via getIdTokenResult()
        let tokenClaimRole: AdminRoleType | null = null;
        try {
          const tokenRes = await fbUser.getIdTokenResult();
          const claimVal = tokenRes?.claims?.adminRole;
          if (
            typeof claimVal === 'string' &&
            [
              'super_admin',
              'admin',
              'moderator',
              'support_staff',
              'finance_manager',
              'ad_manager',
              'content_manager',
              'support_manager',
            ].includes(claimVal)
          ) {
            tokenClaimRole = claimVal as AdminRoleType;
          }
        } catch {
          tokenClaimRole = null;
        }
        setClaimsAdminRole(tokenClaimRole);

        // Verify Admin role via Custom Claim, Firestore adminRoles, or verified Bootstrapped Super Admin email
        if (tokenClaimRole) {
          setAdminRole(tokenClaimRole);
        } else if (fbUser.email?.toLowerCase() === BOOTSTRAPPED_ADMIN_EMAIL && fbUser.emailVerified) {
          setAdminRole('super_admin');
          // Attempt non-blocking server sync of custom claim ONLY when Cloud Functions (Blaze) are enabled
          invokeCloudFunction('syncMyAdminClaims')
            .then(() => fbUser.getIdTokenResult(true))
            .then((refreshed) => {
              const r = refreshed?.claims?.adminRole;
              if (typeof r === 'string') setClaimsAdminRole(r as AdminRoleType);
            })
            .catch(() => {});
        } else {
          try {
            const roleSnap = await getDoc(doc(db, 'adminRoles', fbUser.uid));
            if (roleSnap.exists()) {
              setAdminRole(roleSnap.data()?.role as AdminRoleType);
            } else {
              setAdminRole(null);
            }
          } catch {
            setAdminRole(null);
          }
        }
        setFirestoreWarning(null);
      } catch (err: any) {
        logFirestoreError(err, OperationType.GET, `users/${fbUser.uid}`);
        if (err?.code === 'permission-denied' || String(err?.message).includes('permission')) {
          setFirestoreWarning(
            'Firestore rules are not deployed yet on bana-a5770 or email verification is pending. Deploy firestore.rules using the provided setup guide.'
          );
        }
        setProfile((prev) =>
          prev || {
            uid: fbUser.uid,
            username: sanitizeUsername(fbUser.email?.split('@')[0] || 'member', fbUser.uid),
            displayName: fbUser.displayName || fbUser.email?.split('@')[0] || 'BANA Member',
            avatarUrl: fbUser.photoURL || '',
            onboardingCompleted: true,
            isVerified: false,
            isCreator: false,
            accountStatus: 'active',
            followersCount: 0,
            followingCount: 0,
          }
        );
      }
    },
    [setThemeMode, setMessengerTheme, checkUsernameAvailable, reserveUsername]
  );

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        await ensureUserDocuments(user);
      } else {
        setProfile(null);
        setSettings(null);
        setAdminRole(null);
        setClaimsAdminRole(null);
        setUnreadNotifications(0);
        setUnreadMessages(0);
      }
      setLoading(false);
    });
    return () => unsub();
  }, [ensureUserDocuments]);

  // Own private account fields (one doc listener). Failure (e.g. rules not deployed yet) falls back to legacy public values.
  useEffect(() => {
    if (!firebaseUser) {
      setPrivateFields(null);
      return;
    }
    const unsub = onSnapshot(
      doc(db, 'userPrivate', firebaseUser.uid),
      (snap) => {
        if (!snap.exists()) { setPrivateFields(null); return; }
        const d = snap.data() as Record<string, any>;
        const next: Partial<BanaUser> = {};
        if (typeof d.isMinor === 'boolean') next.isMinor = d.isMinor;
        if (typeof d.accountRestrictionNote === 'string') next.accountRestrictionNote = d.accountRestrictionNote;
        if (typeof d.messagingRestricted === 'boolean') next.messagingRestricted = d.messagingRestricted;
        setPrivateFields(next);
      },
      () => setPrivateFields(null)
    );
    return () => unsub();
  }, [firebaseUser?.uid]);

  // Real-time unread notification and message counters when signed in (Spark-optimized: 2 listeners)
  useEffect(() => {
    if (!firebaseUser) {
      setBlockedUids([]);
      setRestrictedUids([]);
      return;
    }

    const notifQuery = query(
      collection(db, 'notifications'),
      where('recipientId', '==', firebaseUser.uid),
      where('isRead', '==', false),
      limit(30)
    );
    const unsubNotif = onSnapshot(
      notifQuery,
      (snap) => setUnreadNotifications(snap.size),
      (err) => logFirestoreError(err, OperationType.LIST, 'notifications')
    );

    const convQuery = query(
      collection(db, 'conversations'),
      where('participantIds', 'array-contains', firebaseUser.uid),
      limit(30)
    );
    const unsubConv = onSnapshot(
      convQuery,
      (snap) => {
        let total = 0;
        snap.docs.forEach((d) => {
          const unread = d.data()?.unreadCounts?.[firebaseUser.uid] || 0;
          total += Number(unread);
        });
        setUnreadMessages(total);
      },
      (err) => logFirestoreError(err, OperationType.LIST, 'conversations')
    );

    // One-time read instead of permanent listeners (updated via refreshSocialFilters() on block/restrict)
    Promise.all([
      getDocs(query(collection(db, 'userBlocks'), where('blockerId', '==', firebaseUser.uid), limit(100))).catch(() => null),
      getDocs(query(collection(db, 'userRestrictions'), where('restrictorId', '==', firebaseUser.uid), limit(100))).catch(() => null),
    ]).then(([bSnap, rSnap]) => {
      if (bSnap) setBlockedUids(bSnap.docs.map((d) => String(d.data().blockedUid || '')).filter(Boolean));
      if (rSnap) setRestrictedUids(rSnap.docs.map((d) => String(d.data().restrictedUid || '')).filter(Boolean));
    });

    return () => {
      unsubNotif();
      unsubConv();
    };
  }, [firebaseUser]);

  const refreshSocialFilters = useCallback(async () => {
    if (!firebaseUser) {
      setBlockedUids([]);
      setRestrictedUids([]);
      return;
    }
    const [bSnap, rSnap] = await Promise.all([
      getDocs(query(collection(db, 'userBlocks'), where('blockerId', '==', firebaseUser.uid), limit(100))).catch(() => null),
      getDocs(query(collection(db, 'userRestrictions'), where('restrictorId', '==', firebaseUser.uid), limit(100))).catch(() => null),
    ]);
    if (bSnap) setBlockedUids(bSnap.docs.map((d) => String(d.data().blockedUid || '')).filter(Boolean));
    if (rSnap) setRestrictedUids(rSnap.docs.map((d) => String(d.data().restrictedUid || '')).filter(Boolean));
  }, [firebaseUser]);

  const signInWithGoogle = async () => {
    if (platformSettings.allowGoogleSignIn === false) {
      throw new Error('Google sign-in is currently disabled by platform administrators.');
    }
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const cred = await signInWithPopup(auth, provider);
    await ensureUserDocuments(cred.user);
  };

  const signInWithEmail = async (email: string, password: string) => {
    if (platformSettings.allowEmailPasswordSignIn === false) {
      throw new Error('Email & password sign-in is currently disabled by platform administrators.');
    }
    const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
    await ensureUserDocuments(cred.user);
  };

  const registerWithEmail = async ({
    email,
    password,
    displayName,
    username,
    birthYear,
  }: {
    email: string;
    password: string;
    displayName: string;
    username: string;
    birthYear: number;
  }) => {
    if (platformSettings.registrationOpen === false) {
      throw new Error('New user registrations are temporarily paused by BANA administrators.');
    }
    if (platformSettings.allowEmailPasswordSignIn === false) {
      throw new Error('Email & password registration is currently disabled by platform administrators.');
    }

    const cleanUname = sanitizeUsername(username);
    if (!/^[a-z0-9_.]{3,30}$/.test(cleanUname)) {
      throw new Error('Username must be 3-30 characters using lowercase letters, numbers, dots, or underscores.');
    }
    const available = await checkUsernameAvailable(cleanUname);
    if (!available) {
      throw new Error(`Username "@${cleanUname}" is already taken. Please choose another.`);
    }

    const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
    await updateProfile(cred.user, { displayName: displayName.trim() });
    await sendEmailVerification(cred.user).catch(() => {});
    await ensureUserDocuments(cred.user, {
      displayName,
      username: cleanUname,
      birthYear,
      isNewSignup: true,
    });
  };

  const completeOnboarding = async ({
    displayName,
    username,
    bio,
    avatarUrl,
    location,
    interests,
  }: {
    displayName: string;
    username: string;
    bio: string;
    avatarUrl?: string;
    location?: string;
    interests: DiscoveryCategory[];
  }) => {
    if (!firebaseUser || !profile) return;
    const cleanUname = sanitizeUsername(username, firebaseUser.uid);
    if (cleanUname !== profile.username) {
      const available = await checkUsernameAvailable(cleanUname, firebaseUser.uid);
      if (!available) {
        throw new Error(`Username "@${cleanUname}" is already taken.`);
      }
      await reserveUsername(cleanUname, firebaseUser.uid, profile.username);
    }

    const userUpdate: Partial<BanaUser> = {
      displayName: displayName.trim().slice(0, 80),
      username: cleanUname,
      bio: bio.trim().slice(0, 300),
      location: (location || '').trim().slice(0, 80),
      interests,
      onboardingCompleted: true,
      ...(avatarUrl !== undefined ? { avatarUrl } : {}),
    };

    await updateDoc(doc(db, 'users', firebaseUser.uid), {
      ...userUpdate,
      updatedAt: serverTimestamp(),
    });

    await updateProfile(firebaseUser, {
      displayName: userUpdate.displayName,
      ...(avatarUrl ? { photoURL: avatarUrl } : {}),
    }).catch(() => {});

    await updateLocalSettings({ interests });
    setProfile((prev) => (prev ? { ...prev, ...userUpdate } : prev));
  };

  const sendResetEmail = async (email: string) => {
    await sendPasswordResetEmail(auth, email.trim());
  };

  const resendVerification = async () => {
    if (auth.currentUser) {
      await sendEmailVerification(auth.currentUser);
    }
  };

  const logout = async () => {
    await signOut(auth);
  };

  const refreshProfile = async () => {
    if (auth.currentUser) {
      await auth.currentUser.reload();
      await ensureUserDocuments(auth.currentUser);
    }
  };

  // Real-time online activity heartbeat (when user permits showOnlineStatus)
  useEffect(() => {
    if (!firebaseUser || !profile || settings?.showOnlineStatus === false) return;
    const ping = () => {
      updateDoc(doc(db, 'users', firebaseUser.uid), {
        lastActiveAt: Date.now(),
        showOnlineStatus: settings?.showOnlineStatus !== false,
        updatedAt: serverTimestamp(),
      }).catch(() => {});
    };
    ping();
    const id = window.setInterval(ping, 60000);
    return () => window.clearInterval(id);
  }, [firebaseUser, profile?.uid, settings?.showOnlineStatus]);

  const updateLocalSettings = async (partial: Partial<BanaUserSettings>) => {
    if (!firebaseUser) return;
    const merged: BanaUserSettings = {
      ...(settings || defaultSettings(firebaseUser.uid, firebaseUser.email || '')),
      ...partial,
      uid: firebaseUser.uid,
    };
    setSettings(merged);
    if (partial.themeMode) setThemeMode(partial.themeMode);
    if (partial.messengerTheme) setMessengerTheme(partial.messengerTheme);

    try {
      await setDoc(
        doc(db, 'userSettings', firebaseUser.uid),
        {
          ...merged,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Mirror non-sensitive Messenger/Calling/Profile privacy fields to public user profile
      const publicSync: Record<string, any> = {};
      if (partial.isPrivateAccount !== undefined) {
        publicSync.isPrivateAccount = partial.isPrivateAccount;
        if (partial.isPrivateAccount) {
          publicSync.whoCanFollow = 'approval';
        }
      }
      if (partial.whoCanFollow !== undefined) publicSync.whoCanFollow = partial.whoCanFollow;
      if (partial.whoCanFriendRequest !== undefined) publicSync.whoCanFriendRequest = partial.whoCanFriendRequest;
      if (partial.allowFriendSuggestions !== undefined) publicSync.suggestionsOptOut = partial.allowFriendSuggestions === false;
      if (partial.whoCanViewFriends !== undefined) publicSync.whoCanViewFriends = partial.whoCanViewFriends;
      if (partial.whoCanViewFollowers !== undefined) publicSync.whoCanViewFollowers = partial.whoCanViewFollowers;
      if (partial.showPersonalInfo !== undefined) publicSync.showPersonalInfo = partial.showPersonalInfo;
      if (partial.showLocation !== undefined) publicSync.showLocation = partial.showLocation;
      if (partial.whoCanMessage !== undefined) publicSync.whoCanMessage = partial.whoCanMessage;
      if (partial.whoCanCall !== undefined) publicSync.whoCanCall = partial.whoCanCall;
      if (partial.showOnlineStatus !== undefined) {
        publicSync.showOnlineStatus = partial.showOnlineStatus;
        publicSync.lastActiveAt = partial.showOnlineStatus ? Date.now() : 0;
      }
      if (Object.keys(publicSync).length > 0) {
        await updateDoc(doc(db, 'users', firebaseUser.uid), {
          ...publicSync,
          updatedAt: serverTimestamp(),
        }).catch(() => {});
        setProfile((prev) => (prev ? { ...prev, ...publicSync } : prev));
      }
    } catch (err) {
      logFirestoreError(err, OperationType.WRITE, `userSettings/${firebaseUser.uid}`);
      throw err;
    }
  };

  const needsOnboarding = Boolean(
    firebaseUser && profile && profile.onboardingCompleted === false && !firestoreWarning
  );

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        profile,
        settings,
        adminRole,
        claimsAdminRole,
        platformSettings,
        needsOnboarding,
        loading,
        firestoreWarning,
        unreadNotifications,
        unreadMessages,
        blockedUids,
        restrictedUids,
        refreshSocialFilters,
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        checkUsernameAvailable,
        reserveUsername,
        completeOnboarding,
        sendResetEmail,
        resendVerification,
        logout,
        refreshProfile,
        updateLocalSettings,
        authModalOpen,
        authModalReason,
        authModalTab,
        openAuthModal,
        closeAuthModal,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
