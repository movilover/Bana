import React, { useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Loader2, ArrowLeft } from 'lucide-react';
import { useAuth } from '@/src/contexts/AuthContext';
import { BanaLogo } from '@/src/components/common/BanaLogo';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';
import authEditorialImg from '@/src/assets/images/bana_auth_editorial_1794590889256.jpg';

function AuthSplitShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid grid-cols-1 lg:grid-cols-2 bg-white dark:bg-neutral-950 text-neutral-950 dark:text-white">
      <div className="flex flex-col justify-between p-6 sm:p-10 lg:p-14 max-w-lg mx-auto w-full">
        <div className="flex items-center justify-between">
          <Link to="/discover">
            <BanaLogo />
          </Link>
          <Link
            to="/discover"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-neutral-500 hover:text-neutral-950 dark:hover:text-white"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Explore Feed
          </Link>
        </div>

        <div className="py-10 space-y-6">
          <div className="space-y-1.5">
            <h1 className="font-display font-extrabold text-3xl tracking-tight text-balance">{title}</h1>
            <p className="text-sm text-neutral-600 dark:text-neutral-400">{subtitle}</p>
          </div>
          {children}
        </div>

        <p className="text-xs text-neutral-500 dark:text-neutral-400">
          BANA · Discover More. Connect Better.
        </p>
      </div>

      <div className="hidden lg:block relative overflow-hidden bg-neutral-100 dark:bg-neutral-900">
        <img
          src={authEditorialImg}
          alt="BANA Community Gathering"
          className="h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent flex flex-col justify-end p-12 text-white">
          <p className="font-display font-bold text-2xl max-w-md leading-snug text-balance">
            Discover More. Connect Better.
          </p>
          <p className="text-sm text-white/80 max-w-md mt-2">
            Explore Smart Discovery, 9:16 Reels, real-time Messenger, Communities & Local Events, and BANA Market.
          </p>
        </div>
      </div>
    </div>
  );
}

export function LoginPage() {
  const { signInWithEmail, signInWithGoogle, platformSettings, firebaseUser, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  // Only same-origin absolute paths are accepted as a post-login target (prevents open redirects).
  const rawFrom = (location.state as { from?: string } | null)?.from;
  const afterLogin = typeof rawFrom === 'string' && rawFrom.startsWith('/') && !rawFrom.startsWith('//') ? rawFrom : '/discover';
  React.useEffect(() => {
    if (!authLoading && firebaseUser) navigate(afterLogin, { replace: true });
  }, [authLoading, firebaseUser, navigate, afterLogin]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signInWithEmail(email, password);
      navigate(afterLogin);
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  const handleGoogle = async () => {
    setError(null);
    setLoading(true);
    try {
      await signInWithGoogle();
      navigate(afterLogin);
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitShell title={`Sign in to ${platformSettings.platformName || 'BANA'}`} subtitle="Welcome back to your communities, reels, and conversations.">
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {platformSettings.allowGoogleSignIn !== false && (
        <button
          type="button"
          disabled={loading}
          onClick={handleGoogle}
          className="w-full h-11 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-sm font-semibold flex items-center justify-center gap-2.5 hover:bg-neutral-50 dark:hover:bg-neutral-800 transition-colors"
        >
          <svg className="w-4 h-4" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M23.745 12.27c0-.7-.06-1.4-.19-2.07H12v4.51h6.6c-.29 1.52-1.14 2.82-2.4 3.68v3.05h3.88c2.27-2.09 3.665-5.17 3.665-9.17Z" />
            <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.88-3.05c-1.08.72-2.45 1.16-4.05 1.16-3.12 0-5.77-2.11-6.72-4.96H1.29v3.14C3.26 21.3 7.31 24 12 24Z" />
            <path fill="#FBBC05" d="M5.28 14.24c-.24-.72-.38-1.49-.38-2.24s.14-1.52.38-2.24V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.99-3.14Z" />
            <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.99 3.14c.95-2.85 3.6-4.96 6.72-4.96Z" />
          </svg>
          Continue with Google
        </button>
      )}

      <div className="relative flex items-center py-1">
        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
        <span className="px-3 text-xs text-neutral-400">or with email</span>
        <div className="flex-1 border-t border-neutral-200 dark:border-neutral-800" />
      </div>

      {platformSettings.allowEmailPasswordSignIn === false && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
          Email & password sign-in is currently paused by BANA Administration. Use Google sign-in if enabled.
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Email</label>
          <input
            type="email"
            required
            disabled={platformSettings.allowEmailPasswordSignIn === false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full h-11 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1877F2] disabled:opacity-60"
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Password</label>
            <Link to="/forgot-password" className="text-xs text-[#1877F2] dark:text-blue-400 hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            type="password"
            required
            disabled={platformSettings.allowEmailPasswordSignIn === false}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="w-full h-11 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#1877F2] disabled:opacity-60"
          />
        </div>

        <button
          type="submit"
          disabled={loading || platformSettings.allowEmailPasswordSignIn === false}
          className="w-full h-11 rounded-xl bg-[#1877F2] text-white text-sm font-semibold hover:bg-[#166FE5] disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Sign In
        </button>
      </form>

      <p className="text-xs text-neutral-600 dark:text-neutral-400 text-center">
        New to BANA?{' '}
        <Link to="/register" className="font-semibold text-[#1877F2] dark:text-blue-400 hover:underline">
          Create an account
        </Link>
      </p>
    </AuthSplitShell>
  );
}

export function RegisterPage() {
  const { registerWithEmail, signInWithGoogle, checkUsernameAvailable, platformSettings } = useAuth();
  const navigate = useNavigate();
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameOk, setUsernameOk] = useState<boolean | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [birthYear, setBirthYear] = useState(2000);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameOk(null);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      const ok = await checkUsernameAvailable(username);
      if (!cancelled) setUsernameOk(ok);
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [username, checkUsernameAvailable]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (platformSettings.registrationOpen === false) {
      setError('New registrations are currently closed by BANA administrators.');
      return;
    }
    if (new Date().getFullYear() - birthYear < 13) {
      setError('You must be at least 13 years old to register on BANA.');
      return;
    }
    if (usernameOk === false) {
      setError('That username is already taken. Please choose another.');
      return;
    }
    setLoading(true);
    try {
      await registerWithEmail({
        email,
        password,
        displayName,
        username,
        birthYear,
      });
      navigate('/discover');
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitShell title="Join BANA" subtitle="Create your profile to share stories, reels, and join local communities.">
      {platformSettings.registrationOpen === false && (
        <div className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200">
          New account registration is currently paused by BANA Administration.
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {platformSettings.allowGoogleSignIn !== false && (
        <button
          type="button"
          disabled={loading || platformSettings.registrationOpen === false}
          onClick={async () => {
            setError(null);
            setLoading(true);
            try {
              await signInWithGoogle();
              navigate('/discover');
            } catch (err) {
              setError(formatFirebaseErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
          className="w-full h-11 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 text-sm font-semibold flex items-center justify-center gap-2 hover:bg-neutral-50 dark:hover:bg-neutral-800 disabled:opacity-50"
        >
          Sign up with Google
        </button>
      )}

      <form onSubmit={handleSubmit} className="space-y-3.5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Display Name</label>
            <input
              type="text"
              required
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Amina Rahman"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Username</label>
              {usernameOk === true && <span className="text-[10px] text-emerald-600 font-semibold">Available</span>}
              {usernameOk === false && <span className="text-[10px] text-red-600 font-semibold">Taken</span>}
            </div>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
              placeholder="amina_r"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="sm:col-span-2 space-y-1">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Birth Year</label>
            <input
              type="number"
              min={1920}
              max={new Date().getFullYear()}
              required
              value={birthYear}
              onChange={(e) => setBirthYear(Number(e.target.value))}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm font-mono"
            />
          </div>
        </div>

        <div className="space-y-1">
          <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Password</label>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Minimum 6 characters"
            className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-sm"
          />
        </div>

        <button
          type="submit"
          disabled={loading || platformSettings.registrationOpen === false || platformSettings.allowEmailPasswordSignIn === false}
          className="w-full h-11 rounded-xl bg-[#1877F2] text-white text-sm font-semibold hover:bg-[#166FE5] disabled:opacity-60 flex items-center justify-center gap-2 transition-colors"
        >
          {loading && <Loader2 className="w-4 h-4 animate-spin" />}
          Create BANA Account
        </button>
      </form>

      <p className="text-xs text-neutral-600 dark:text-neutral-400 text-center">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-[#1877F2] dark:text-blue-400 hover:underline">
          Sign in
        </Link>
      </p>
    </AuthSplitShell>
  );
}

export function ForgotPasswordPage() {
  const { sendResetEmail } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await sendResetEmail(email);
      setSent(true);
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthSplitShell title="Reset your password" subtitle="Enter your email address and we will send a password reset link.">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">{error}</div>
      )}
      {sent ? (
        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/30 p-4 text-sm text-emerald-800 dark:text-emerald-300 space-y-2">
          <p className="font-semibold">Reset email sent</p>
          <p className="text-xs">Check your inbox for a link from Firebase Auth to reset your password.</p>
          <Link to="/login" className="inline-block text-xs font-semibold underline pt-1">
            Return to Sign In
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full h-11 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3.5 text-sm"
          />
          <button
            type="submit"
            disabled={loading}
            className="w-full h-11 rounded-xl bg-[#1877F2] text-white text-sm font-semibold hover:bg-[#166FE5] disabled:opacity-60 transition-colors"
          >
            {loading ? 'Sending...' : 'Send Reset Link'}
          </button>
          <Link to="/login" className="block text-center text-xs text-neutral-500 hover:underline">
            Back to Sign In
          </Link>
        </form>
      )}
    </AuthSplitShell>
  );
}
