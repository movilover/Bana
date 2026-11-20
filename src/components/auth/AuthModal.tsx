import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { X, Loader2, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { BanaLogo } from '@/src/components/common/BanaLogo';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';

interface AuthModalProps {
  isOpen: boolean;
  reason?: string | null;
  initialTab?: 'login' | 'register';
  onClose: () => void;
}

export function AuthModal({ isOpen, reason, initialTab = 'login', onClose }: AuthModalProps) {
  const { signInWithGoogle, signInWithEmail, registerWithEmail, checkUsernameAvailable, platformSettings } = useAuth();
  const [tab, setTab] = useState<'login' | 'register'>(initialTab);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameOk, setUsernameOk] = useState<boolean | null>(null);
  const [birthYear, setBirthYear] = useState('1998');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setTab(initialTab);
    setError(null);
  }, [initialTab, isOpen]);

  useEffect(() => {
    if (tab !== 'register' || username.length < 3) {
      setUsernameOk(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const ok = await checkUsernameAvailable(username);
      if (!cancelled) setUsernameOk(ok);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [tab, username, checkUsernameAvailable]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (tab === 'login') {
        await signInWithEmail(email, password);
      } else {
        await registerWithEmail({
          email,
          password,
          displayName,
          username,
          birthYear: Number(birthYear) || 1998,
        });
      }
      onClose();
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setSubmitting(true);
    try {
      await signInWithGoogle();
      onClose();
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bana-auth-modal-title"
    >
      <div className="w-full max-w-md rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-neutral-100 dark:border-neutral-800">
          <BanaLogo />
          <button
            type="button"
            onClick={onClose}
            aria-label="Close sign in dialog"
            className="h-8 w-8 rounded-full hover:bg-neutral-100 dark:hover:bg-neutral-900 flex items-center justify-center text-neutral-500"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div className="space-y-1">
            <h2 id="bana-auth-modal-title" className="font-display font-bold text-lg text-neutral-950 dark:text-white">
              {tab === 'login' ? 'Sign in to BANA' : 'Join BANA'}
            </h2>
            <p className="text-xs text-neutral-500 dark:text-neutral-400">
              {reason || 'Connect, share voice notes, explore Reels, and chat on BANA.'}
            </p>
          </div>

          <div className="grid grid-cols-2 p-1 rounded-xl bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800">
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setError(null);
              }}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === 'login'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                  : 'text-neutral-500'
              }`}
            >
              Sign In
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('register');
                setError(null);
              }}
              className={`py-1.5 rounded-lg text-xs font-semibold transition-colors ${
                tab === 'register'
                  ? 'bg-white dark:bg-neutral-800 text-neutral-950 dark:text-white shadow-sm'
                  : 'text-neutral-500'
              }`}
            >
              Create Account
            </button>
          </div>

          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 px-3.5 py-2 text-xs text-red-700 dark:text-red-300">
              {error}
            </div>
          )}

          {platformSettings.allowGoogleSignIn !== false && (
            <button
              type="button"
              disabled={submitting || (tab === 'register' && platformSettings.registrationOpen === false)}
              onClick={handleGoogle}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 hover:bg-neutral-50 dark:hover:bg-neutral-800 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              <svg className="w-4 h-4" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continue with Google
            </button>
          )}

          <div className="flex items-center gap-3 text-[11px] text-neutral-400">
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
            <span>or with email</span>
            <span className="h-px flex-1 bg-neutral-200 dark:bg-neutral-800" />
          </div>

          {platformSettings.allowEmailPasswordSignIn === false && (
            <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
              Email & password authentication is currently paused by administrators.
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-3">
            {tab === 'register' && (
              <>
                {platformSettings.registrationOpen === false && (
                  <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                    New user registrations are temporarily paused by administrators.
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2.5">
                  <input
                    type="text"
                    required
                    disabled={platformSettings.allowEmailPasswordSignIn === false}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Full Name"
                    className="h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs disabled:opacity-60"
                  />
                  <div className="relative">
                    <input
                      type="text"
                      required
                      disabled={platformSettings.allowEmailPasswordSignIn === false}
                      value={username}
                      onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                      placeholder="username"
                      className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs font-mono disabled:opacity-60"
                    />
                    {usernameOk !== null && (
                      <span
                        className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] font-semibold ${
                          usernameOk ? 'text-emerald-600' : 'text-red-600'
                        }`}
                      >
                        {usernameOk ? 'OK' : 'Taken'}
                      </span>
                    )}
                  </div>
                </div>
                <input
                  type="number"
                  required
                  disabled={platformSettings.allowEmailPasswordSignIn === false}
                  min={1920}
                  max={new Date().getFullYear() - 13}
                  value={birthYear}
                  onChange={(e) => setBirthYear(e.target.value)}
                  placeholder="Birth Year (e.g. 1998)"
                  className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs disabled:opacity-60"
                />
              </>
            )}

            <input
              type="email"
              required
              disabled={platformSettings.allowEmailPasswordSignIn === false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Email address"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs disabled:opacity-60"
            />
            <input
              type="password"
              required
              disabled={platformSettings.allowEmailPasswordSignIn === false}
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs disabled:opacity-60"
            />

            <button
              type="submit"
              disabled={
                submitting ||
                platformSettings.allowEmailPasswordSignIn === false ||
                (tab === 'register' && (platformSettings.registrationOpen === false || usernameOk === false))
              }
              className="w-full h-10 rounded-xl bg-[#1877F2] text-white text-xs font-semibold hover:bg-[#166FE5] disabled:opacity-50 inline-flex items-center justify-center gap-2 transition-colors"
            >
              {submitting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {tab === 'login' ? 'Sign In' : 'Create BANA Account'}
            </button>
          </form>

          <div className="flex items-center justify-between pt-1 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1">
              <ShieldCheck className="w-3.5 h-3.5 text-blue-600" /> Firebase Auth secured
            </span>
            {tab === 'login' && (
              <Link to="/forgot-password" onClick={onClose} className="text-blue-600 hover:underline font-medium">
                Forgot password?
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
