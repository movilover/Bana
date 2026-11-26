import React from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  User,
  Bookmark,
  BarChart3,
  Settings,
  LogOut,
  Sun,
  Moon,
  Monitor,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { useTheme } from '@/src/contexts/ThemeContext';
import { useToast } from '@/src/contexts/ToastContext';
import type { ThemeMode } from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { LiveVerifiedBadge } from '@/src/components/common/LiveVerifiedBadge';

// Separate admin site (own GitHub repo). Set VITE_ADMIN_URL to show the link to admins.
const ADMIN_URL: string = (import.meta.env.VITE_ADMIN_URL || '').trim();

export function ProfileDropdown({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const { profile, adminRole, updateLocalSettings, logout } = useAuth();
  const { themeMode, setThemeMode } = useTheme();
  const toast = useToast();
  const navigate = useNavigate();

  if (!isOpen || !profile) return null;

  const handleThemeChange = async (mode: ThemeMode) => {
    setThemeMode(mode);
    await updateLocalSettings({ themeMode: mode }).catch(() => {});
    toast.info(`Theme switched to ${mode}.`);
  };

  const handleLogout = async () => {
    onClose();
    await logout();
    toast.info('Signed out of BANA.');
    navigate('/discover');
  };

  return (
    <div
      role="menu"
      aria-label="Account menu"
      className="animate-dropdown-in absolute right-0 top-12 w-64 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl z-40 overflow-hidden"
    >
      {/* Profile header summary */}
      <Link
        to={`/profile/${profile.username}`}
        onClick={onClose}
        className="flex items-center gap-3 p-3.5 border-b border-neutral-100 dark:border-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-900 transition-colors"
      >
        <Avatar src={profile.avatarUrl} name={profile.displayName} size="md" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1">
            <p className="text-xs font-bold text-neutral-950 dark:text-white truncate">
              {profile.displayName}
            </p>
            <LiveVerifiedBadge uid={profile.uid} size={13} />
          </div>
          <p className="text-[11px] text-neutral-500 truncate">@{profile.username}</p>
        </div>
      </Link>

      {/* Navigation links */}
      <div className="p-1.5 space-y-0.5 text-xs font-medium">
        <Link
          to={`/profile/${profile.username}`}
          onClick={onClose}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <User className="w-4 h-4 text-neutral-500" />
          My Profile
        </Link>
        <Link
          to="/saved"
          onClick={onClose}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <Bookmark className="w-4 h-4 text-neutral-500" />
          Saved Posts & Videos
        </Link>
        <Link
          to="/creator-studio"
          onClick={onClose}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <BarChart3 className="w-4 h-4 text-neutral-500" />
          Creator Studio
        </Link>
        <Link
          to="/settings"
          onClick={onClose}
          className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-neutral-800 dark:text-neutral-200 hover:bg-neutral-100 dark:hover:bg-neutral-900"
        >
          <Settings className="w-4 h-4 text-neutral-500" />
          Settings & Privacy
        </Link>
        {adminRole && ADMIN_URL && (
          <a
            href={ADMIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            onClick={onClose}
            className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-brand dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/30"
          >
            <ShieldCheck className="w-4 h-4" />
            Admin Console
          </a>
        )}
      </div>

      {/* Inline Theme Switcher */}
      <div className="px-3 py-2.5 border-t border-neutral-100 dark:border-neutral-900 space-y-1.5">
        <span className="block text-[10px] font-semibold uppercase tracking-wider text-neutral-400">
          Appearance
        </span>
        <div className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900">
          {(
            [
              { id: 'light', label: 'Light', icon: Sun },
              { id: 'dark', label: 'Dark', icon: Moon },
              { id: 'system', label: 'Auto', icon: Monitor },
            ] as { id: ThemeMode; label: string; icon: React.ComponentType<{ className?: string }> }[]
          ).map((item) => {
            const Icon = item.icon;
            const active = themeMode === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleThemeChange(item.id)}
                className={`inline-flex items-center justify-center gap-1 py-1.5 rounded-lg text-[11px] font-medium transition-colors ${
                  active
                    ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-xs'
                    : 'text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200'
                }`}
              >
                <Icon className="w-3 h-3" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Sign out */}
      <div className="p-1.5 border-t border-neutral-100 dark:border-neutral-900">
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Log out
        </button>
      </div>
    </div>
  );
}
