import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Link, useLocation } from 'react-router-dom';
import {
  Compass,
  Film,
  Users,
  ShoppingBag,
  MessageSquare,
  Bell,
  BarChart3,
  User,
  Plus,
  Search,
  Settings,
  Megaphone,
  ShieldCheck,
  AlertCircle,
  Bookmark,
  X,
} from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import { BanaLogo } from '@/src/components/common/BanaLogo';
import { Avatar } from '@/src/components/common/Avatar';
import { CreateModal, CreateMode } from '@/src/components/create/CreateModal';
import { SearchPopup } from '@/src/components/layout/SearchPopup';
import { NotificationPopup } from '@/src/components/layout/NotificationPopup';
import { ProfileDropdown } from '@/src/components/layout/ProfileDropdown';

interface AppShellProps {
  children: React.ReactNode;
  fullBleed?: boolean;
}

export function AppShell({ children, fullBleed = false }: AppShellProps) {
  const {
    firebaseUser,
    profile,
    adminRole,
    platformSettings,
    unreadMessages,
    unreadNotifications,
    firestoreWarning,
    resendVerification,
    refreshProfile,
    openAuthModal,
  } = useAuth();
  const toast = useToast();
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<CreateMode>('text');
  const [searchOpen, setSearchOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [profileMenuOpen, setProfileMenuOpen] = useState(false);
  const [dismissBanner, setDismissBanner] = useState(false);
  const [verificationSent, setVerificationSent] = useState(false);

  const location = useLocation();
  const headerActionsRef = useRef<HTMLDivElement | null>(null);

  // Close popups on route change or outside click
  useEffect(() => {
    setNotifOpen(false);
    setProfileMenuOpen(false);
  }, [location.pathname, location.search]);

  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (headerActionsRef.current && !headerActionsRef.current.contains(e.target as Node)) {
        setNotifOpen(false);
        setProfileMenuOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === 'Escape') {
        setNotifOpen(false);
        setProfileMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  const navItems = [
    { to: '/discover', label: 'Discover', icon: Compass },
    ...(platformSettings.enableReels !== false ? [{ to: '/reels', label: 'Reels', icon: Film }] : []),
    ...(platformSettings.enableCommunities !== false ? [{ to: '/communities', label: 'Communities', icon: Users }] : []),
    ...(platformSettings.enableMarketplace !== false ? [{ to: '/market', label: 'BANA Market', icon: ShoppingBag }] : []),
    ...(platformSettings.enableMessaging !== false
      ? [{ to: '/messages', label: 'Messages', icon: MessageSquare, badge: unreadMessages }]
      : []),
    { to: '/notifications', label: 'Notifications', icon: Bell, badge: unreadNotifications },
    { to: '/saved', label: 'Saved', icon: Bookmark },
    ...(platformSettings.enableMonetization !== false
      ? [{ to: '/creator-studio', label: 'Creator Studio', icon: BarChart3 }]
      : []),
    {
      to: profile ? `/profile/${profile.username}` : '/login',
      label: 'My Profile',
      icon: User,
    },
  ];

  const isReelsRoute = location.pathname === '/reels';

  return (
    <div className="min-h-dvh bg-white dark:bg-neutral-950 text-neutral-950 dark:text-neutral-50 flex flex-col lg:flex-row">
      {/* Desktop Left Navigation Rail */}
      <aside className="hidden lg:flex lg:w-[252px] lg:flex-col lg:fixed lg:inset-y-0 border-r border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 z-30">
        <div className="h-16 px-5 flex items-center border-b border-neutral-100 dark:border-neutral-900">
          <Link to="/discover">
            <BanaLogo />
          </Link>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {navItems.map((item) => {
            const Icon = item.icon;
            const requiresAuth =
              ['/messages', '/notifications', '/saved', '/creator-studio'].includes(item.to) ||
              item.label === 'My Profile';
            return (
              <NavLink
                key={item.label}
                to={item.to}
                onClick={(e) => {
                  if (requiresAuth && !firebaseUser) {
                    e.preventDefault();
                    openAuthModal(`Sign in to open ${item.label}.`);
                  }
                }}
                className={({ isActive }) =>
                  `flex items-center justify-between px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors whitespace-nowrap ${
                    isActive
                      ? 'bg-[#1877F2] text-white shadow-sm'
                      : 'text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  }`
                }
              >
                <span className="flex items-center gap-3">
                  <Icon className="w-[18px] h-[18px] shrink-0" />
                  <span>{item.label}</span>
                </span>
                {item.badge ? (
                  <span className="font-mono text-[11px] font-semibold px-1.5 py-0.5 rounded-md bg-rose-600 text-white tabular-nums">
                    {item.badge > 99 ? '99+' : item.badge}
                  </span>
                ) : null}
              </NavLink>
            );
          })}

          <div className="pt-3 mt-3 border-t border-neutral-100 dark:border-neutral-900 space-y-1">
            {platformSettings.enableAds !== false && (
              <NavLink
                to="/advertise"
                onClick={(e) => {
                  if (!firebaseUser) {
                    e.preventDefault();
                    openAuthModal('Sign in to access BANA Ads Manager.');
                  }
                }}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#1877F2] text-white shadow-sm'
                      : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                  }`
                }
              >
                <Megaphone className="w-[18px] h-[18px]" />
                <span>Ads Manager</span>
              </NavLink>
            )}
            <NavLink
              to="/settings"
              onClick={(e) => {
                if (!firebaseUser) {
                  e.preventDefault();
                  openAuthModal('Sign in to manage your BANA account settings.');
                }
              }}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isActive
                    ? 'bg-[#1877F2] text-white shadow-sm'
                    : 'text-neutral-600 dark:text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                }`
              }
            >
              <Settings className="w-[18px] h-[18px]" />
              <span>Settings</span>
            </NavLink>
            {adminRole && (
              <NavLink
                to="/admin"
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                    isActive
                      ? 'bg-[#1877F2] text-white'
                      : 'text-[#1877F2] dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30'
                  }`
                }
              >
                <ShieldCheck className="w-[18px] h-[18px]" />
                <span>Admin Panel</span>
              </NavLink>
            )}
          </div>
        </nav>

        <div className="p-4 border-t border-neutral-100 dark:border-neutral-900 space-y-3">
          <button
            type="button"
            onClick={() => {
              if (!firebaseUser) return openAuthModal('Sign in to create posts, reels, stories, polls, or voice notes.');
              if (profile && profile.accountStatus !== 'active') {
                toast.error(
                  profile.accountRestrictionNote ||
                    `Your account is currently ${profile.accountStatus}. Publishing actions are disabled.`
                );
                return;
              }
              if (platformSettings.maintenanceMode && !adminRole) {
                toast.error(platformSettings.maintenanceMessage || 'BANA is currently in maintenance mode.');
                return;
              }
              setCreateMode('text');
              setCreateOpen(true);
            }}
            className="w-full h-11 rounded-xl bg-[#1877F2] text-white font-display font-semibold text-sm flex items-center justify-center gap-2 hover:bg-[#166FE5] shadow-sm transition-colors"
          >
            <Plus className="w-4 h-4" />
            Create
          </button>

          {profile ? (
            <Link
              to={`/profile/${profile.username}`}
              className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-neutral-100 dark:hover:bg-neutral-900 transition-colors"
            >
              <Avatar src={profile.avatarUrl} name={profile.displayName} size="sm" />
              <div className="min-w-0">
                <p className="text-xs font-semibold truncate">{profile.displayName}</p>
                <p className="text-[11px] text-neutral-500 truncate">@{profile.username}</p>
              </div>
            </Link>
          ) : (
            <button
              type="button"
              onClick={() => openAuthModal('Sign in or create a BANA account to interact.')}
              className="block w-full text-center py-2 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
            >
              Sign In / Sign Up
            </button>
          )}
        </div>
      </aside>

      {/* Main Column */}
      <div className="flex-1 lg:pl-[252px] flex flex-col min-h-dvh bg-[#F0F2F5] dark:bg-neutral-950">
        {/* Top Header (Hidden on immersive Reels mobile view) */}
        {!isReelsRoute && (
          <header className="sticky top-0 z-20 h-14 bg-white/95 dark:bg-neutral-950/95 backdrop-blur-md border-b border-neutral-200 dark:border-neutral-800 px-4 lg:px-6 flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 lg:hidden">
              <Link to="/discover">
                <BanaLogo />
              </Link>
            </div>

            {/* Desktop Search Trigger Bar -> Opens SearchPopup */}
            <button
              type="button"
              onClick={() => setSearchOpen(true)}
              className="hidden sm:flex items-center justify-between flex-1 max-w-md h-9 px-3.5 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 text-xs text-neutral-500 dark:text-neutral-400 hover:border-neutral-300 dark:hover:border-neutral-700 transition-colors"
            >
              <span className="inline-flex items-center gap-2 truncate">
                <Search className="w-3.5 h-3.5 text-neutral-400 shrink-0" />
                <span className="truncate">Search BANA posts, people, communities...</span>
              </span>
              <kbd className="hidden md:inline-block font-mono text-[10px] text-neutral-400 px-1.5 py-0.5 rounded bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700">
                ⌘K
              </kbd>
            </button>

            <div ref={headerActionsRef} className="relative flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label="Open global search"
                className="sm:hidden h-10 w-10 rounded-full bg-[#F0F2F5] dark:bg-neutral-900 flex items-center justify-center hover:bg-neutral-200/80 dark:hover:bg-neutral-800 transition-colors"
              >
                <Search className="w-5 h-5" />
              </button>

              {platformSettings.enableMessaging !== false && (
                <Link
                  to="/messages"
                  onClick={(e) => {
                    if (!firebaseUser) {
                      e.preventDefault();
                      openAuthModal('Sign in to open BANA Messenger.');
                    }
                  }}
                  aria-label="Messenger"
                  className="relative h-10 w-10 rounded-full bg-[#F0F2F5] dark:bg-neutral-900 flex items-center justify-center hover:bg-neutral-200/80 dark:hover:bg-neutral-800 transition-colors"
                >
                  <MessageSquare className="w-5 h-5" />
                  {unreadMessages > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-[#1877F2] text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                      {unreadMessages > 99 ? '99+' : unreadMessages}
                    </span>
                  )}
                </Link>
              )}

              <div className="relative">
                <button
                  type="button"
                  onClick={() => {
                    if (!firebaseUser) {
                      openAuthModal('Sign in to view your notifications.');
                      return;
                    }
                    setProfileMenuOpen(false);
                    setNotifOpen((o) => !o);
                  }}
                  aria-label="Notifications"
                  aria-expanded={notifOpen}
                  className={`relative h-10 w-10 rounded-full flex items-center justify-center transition-colors ${
                    notifOpen
                      ? 'bg-[#1877F2]/15 text-[#1877F2]'
                      : 'bg-[#F0F2F5] dark:bg-neutral-900 hover:bg-neutral-200/80 dark:hover:bg-neutral-800'
                  }`}
                >
                  <Bell className="w-5 h-5" />
                  {unreadNotifications > 0 && (
                    <span className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-mono font-bold flex items-center justify-center tabular-nums">
                      {unreadNotifications > 99 ? '99+' : unreadNotifications}
                    </span>
                  )}
                </button>
                <NotificationPopup isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
              </div>

              {profile ? (
                <div className="relative ml-1">
                  <button
                    type="button"
                    onClick={() => {
                      setNotifOpen(false);
                      setProfileMenuOpen((o) => !o);
                    }}
                    aria-label="Open profile menu"
                    aria-expanded={profileMenuOpen}
                    className="rounded-full ring-2 ring-transparent hover:ring-[#1877F2]/40 transition-all"
                  >
                    <Avatar src={profile.avatarUrl} name={profile.displayName} size="sm" />
                  </button>
                  <ProfileDropdown
                    isOpen={profileMenuOpen}
                    onClose={() => setProfileMenuOpen(false)}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => openAuthModal('Sign in to view your profile and interact on BANA.')}
                  className="ml-1 px-3.5 py-1.5 rounded-xl bg-[#1877F2] text-white text-xs font-semibold hover:bg-[#166FE5] transition-colors"
                >
                  Sign In
                </button>
              )}
            </div>
          </header>
        )}

        {/* Platform Announcement Banner */}
        {platformSettings.announcementEnabled && platformSettings.announcementMessage && (
          <div
            className={`border-b px-4 py-2 text-xs flex items-center gap-2 ${
              platformSettings.announcementSeverity === 'alert'
                ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200'
                : platformSettings.announcementSeverity === 'warning'
                ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-200'
                : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-900 text-blue-800 dark:text-blue-200'
            }`}
          >
            <Megaphone className="w-4 h-4 shrink-0" />
            <span className="font-medium">{platformSettings.announcementMessage}</span>
          </div>
        )}

        {/* Maintenance mode banner for non-admins */}
        {platformSettings.maintenanceMode && !adminRole && (
          <div className="bg-red-50 dark:bg-red-950/40 border-b border-red-200 dark:border-red-900 px-4 py-2.5 text-xs text-red-800 dark:text-red-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
            <span>
              <strong>{platformSettings.platformName} Maintenance Mode:</strong>{' '}
              {platformSettings.maintenanceMessage ||
                'Some posting and marketplace actions may be temporarily paused while updates run.'}
            </span>
          </div>
        )}

        {/* Account Standing / Restriction Banner */}
        {profile && (profile.accountStatus !== 'active' || profile.messagingRestricted) && (
          <div className="bg-rose-50 dark:bg-rose-950/40 border-b border-rose-200 dark:border-rose-900 px-4 py-2.5 text-xs text-rose-800 dark:text-rose-200 flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
            <span>
              <strong>
                {profile.accountStatus !== 'active'
                  ? `Account ${profile.accountStatus === 'banned' ? 'Deactivated' : 'Suspended'}:`
                  : 'Messaging Restricted:'}
              </strong>{' '}
              {profile.accountRestrictionNote ||
                (profile.accountStatus !== 'active'
                  ? 'Posting, commenting, messaging, and marketplace actions are restricted.'
                  : 'Sending new messages is currently restricted on this account.')}
            </span>
          </div>
        )}

        {/* Verification or Firestore setup notice */}
        {!dismissBanner && (firestoreWarning || (firebaseUser && !firebaseUser.emailVerified && firebaseUser.providerData[0]?.providerId === 'password')) && (
          <div className="bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-900 px-4 py-2.5 flex items-center justify-between gap-3 text-xs text-amber-900 dark:text-amber-200">
            <div className="flex items-center gap-2 min-w-0">
              <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
              <span className="truncate">
                {firestoreWarning || 'Please verify your email address to unlock posting, comments, and marketplace listings.'}
              </span>
            </div>
            <div className="flex items-center gap-2.5 shrink-0">
              {firebaseUser && !firebaseUser.emailVerified && firebaseUser.providerData[0]?.providerId === 'password' && (
                <>
                  {!verificationSent ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await resendVerification();
                        setVerificationSent(true);
                      }}
                      className="font-semibold underline whitespace-nowrap"
                    >
                      Resend Email
                    </button>
                  ) : (
                    <span className="font-medium">Sent</span>
                  )}
                  <button
                    type="button"
                    onClick={() => refreshProfile()}
                    className="font-semibold underline whitespace-nowrap"
                  >
                    Refresh Status
                  </button>
                </>
              )}
              <button type="button" onClick={() => setDismissBanner(true)} className="p-1">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}

        {/* Page Viewport */}
        <main className={`flex-1 ${fullBleed ? '' : 'pb-20 lg:pb-8'}`}>
          {children}
        </main>
      </div>

      {/* Mobile Bottom Navigation (<= 15% sticky height cap) */}
      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 h-16 pb-safe bg-white/95 dark:bg-neutral-950/95 backdrop-blur-md border-t border-neutral-200 dark:border-neutral-800 grid grid-cols-5 items-center px-1">
        <NavLink
          to="/discover"
          className={({ isActive }) =>
            `flex flex-col items-center justify-center gap-0.5 h-12 ${
              isActive ? 'text-[#1877F2] dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
            }`
          }
        >
          <Compass className="w-5 h-5" />
          <span className="text-[10px] font-medium">Discover</span>
        </NavLink>

        {platformSettings.enableReels !== false ? (
          <NavLink
            to="/reels"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 h-12 ${
                isActive ? 'text-[#1877F2] dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <Film className="w-5 h-5" />
            <span className="text-[10px] font-medium">Reels</span>
          </NavLink>
        ) : (
          <NavLink
            to="/saved"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 h-12 ${
                isActive ? 'text-[#1877F2] dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <Bookmark className="w-5 h-5" />
            <span className="text-[10px] font-medium">Saved</span>
          </NavLink>
        )}

        <button
          type="button"
          onClick={() => {
            if (!firebaseUser) return openAuthModal('Sign in to create posts, reels, stories, polls, or voice notes.');
            if (profile && profile.accountStatus !== 'active') {
              toast.error(
                profile.accountRestrictionNote ||
                  `Your account is currently ${profile.accountStatus}. Publishing actions are disabled.`
              );
              return;
            }
            if (platformSettings.maintenanceMode && !adminRole) {
              toast.error(platformSettings.maintenanceMessage || 'BANA is currently in maintenance mode.');
              return;
            }
            setCreateMode('text');
            setCreateOpen(true);
          }}
          aria-label="Create post"
          className="mx-auto h-10 w-12 rounded-xl bg-[#1877F2] text-white flex items-center justify-center shadow-sm active:scale-95 transition-transform"
        >
          <Plus className="w-5 h-5" />
        </button>

        {platformSettings.enableCommunities !== false ? (
          <NavLink
            to="/communities"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 h-12 ${
                isActive ? 'text-[#1877F2] dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <Users className="w-5 h-5" />
            <span className="text-[10px] font-medium">Groups</span>
          </NavLink>
        ) : (
          <NavLink
            to="/notifications"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 h-12 ${
                isActive ? 'text-[#1877F2] dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <Bell className="w-5 h-5" />
            <span className="text-[10px] font-medium">Alerts</span>
          </NavLink>
        )}

        {platformSettings.enableMarketplace !== false ? (
          <NavLink
            to="/market"
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 h-12 ${
                isActive ? 'text-[#1877F2] dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <ShoppingBag className="w-5 h-5" />
            <span className="text-[10px] font-medium">Marketplace</span>
          </NavLink>
        ) : (
          <NavLink
            to={profile ? `/profile/${profile.username}` : '/login'}
            className={({ isActive }) =>
              `flex flex-col items-center justify-center gap-0.5 h-12 ${
                isActive ? 'text-[#1877F2] dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
              }`
            }
          >
            <User className="w-5 h-5" />
            <span className="text-[10px] font-medium">Profile</span>
          </NavLink>
        )}
      </nav>

      <CreateModal
        isOpen={createOpen}
        initialMode={createMode}
        onClose={() => setCreateOpen(false)}
      />

      <SearchPopup
        isOpen={searchOpen}
        onClose={() => setSearchOpen(false)}
      />
    </div>
  );
}
