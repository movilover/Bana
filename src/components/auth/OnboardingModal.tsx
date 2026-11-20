import React, { useEffect, useState } from 'react';
import { Check, Loader2, MapPin, Sparkles, Upload, AlertCircle } from 'lucide-react';
import { useAuth, sanitizeUsername } from '@/src/contexts/AuthContext';
import { useToast } from '@/src/contexts/ToastContext';
import {
  BANGLADESH_DISTRICTS,
  DISCOVERY_CATEGORIES,
  type DiscoveryCategory,
} from '@/src/types/bana';
import { Avatar } from '@/src/components/common/Avatar';
import { compressImageFile, uploadMediaWithProgress } from '@/src/lib/mediaUtils';
import { formatFirebaseErrorMessage } from '@/src/lib/firebaseErrors';

export function OnboardingModal() {
  const { firebaseUser, profile, needsOnboarding, checkUsernameAvailable, completeOnboarding } = useAuth();
  const toast = useToast();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [usernameAvailable, setUsernameAvailable] = useState<boolean | null>(null);
  const [checkingUsername, setCheckingUsername] = useState(false);
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('Dhaka');
  const [interests, setInterests] = useState<DiscoveryCategory[]>(['Technology', 'Education', 'Business']);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string>('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile && needsOnboarding) {
      setDisplayName(profile.displayName || '');
      setUsername(profile.username || '');
      setBio(profile.bio || '');
      setLocation(profile.location || 'Dhaka');
      setAvatarPreview(profile.avatarUrl || '');
      setUsernameAvailable(true);
    }
  }, [profile, needsOnboarding]);

  useEffect(() => {
    if (!avatarFile) return;
    const url = URL.createObjectURL(avatarFile);
    setAvatarPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [avatarFile]);

  useEffect(() => {
    if (!needsOnboarding || !profile) return;
    const clean = sanitizeUsername(username);
    if (clean.length < 3) {
      setUsernameAvailable(false);
      return;
    }
    if (clean === profile.username) {
      setUsernameAvailable(true);
      return;
    }
    let cancelled = false;
    setCheckingUsername(true);
    const timer = window.setTimeout(async () => {
      const ok = await checkUsernameAvailable(clean, profile.uid);
      if (!cancelled) {
        setUsernameAvailable(ok);
        setCheckingUsername(false);
      }
    }, 320);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [username, needsOnboarding, profile, checkUsernameAvailable]);

  if (!needsOnboarding || !firebaseUser || !profile) return null;

  const toggleInterest = (cat: DiscoveryCategory) => {
    setInterests((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!displayName.trim()) {
      setError('Display name is required.');
      return;
    }
    if (usernameAvailable === false) {
      setError('Please pick a valid, available username.');
      return;
    }
    setSaving(true);
    try {
      let avatarUrl = profile.avatarUrl || '';
      if (avatarFile) {
        const compressed = await compressImageFile(avatarFile, 600);
        avatarUrl = await uploadMediaWithProgress(
          `users/${firebaseUser.uid}/avatar_${Date.now()}.jpg`,
          compressed
        );
      }
      await completeOnboarding({
        displayName,
        username,
        bio,
        avatarUrl,
        location,
        interests: interests.length > 0 ? interests : ['Technology', 'News & Community'],
      });
      toast.success('Welcome to BANA! Your Smart Discovery profile is ready.');
    } catch (err) {
      setError(formatFirebaseErrorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const handleSkip = async () => {
    setSaving(true);
    try {
      await completeOnboarding({
        displayName: displayName.trim() || profile.displayName,
        username: profile.username,
        bio: bio.trim(),
        location,
        interests: interests.length > 0 ? interests : ['Technology'],
      });
    } catch {
      // ignore
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="bana-onboarding-title"
    >
      <div className="w-full max-w-lg rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-950 shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
        <div className="px-6 py-4 border-b border-neutral-100 dark:border-neutral-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="h-9 w-9 rounded-xl bg-[#1877F2]/10 text-[#1877F2] flex items-center justify-center">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h2 id="bana-onboarding-title" className="font-display font-bold text-base">
                Complete Your BANA Profile
              </h2>
              <p className="text-[11px] text-neutral-500">
                Personalize your identity & Smart Discovery interests
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={handleSkip}
            className="text-xs font-medium text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
          >
            Skip
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto">
          {error && (
            <div className="rounded-xl border border-red-200 dark:border-red-900 bg-red-50 dark:bg-red-950/30 p-3 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* Avatar Upload */}
          <div className="flex items-center gap-4">
            <Avatar src={avatarPreview} name={displayName || profile.displayName} size="lg" />
            <div className="space-y-1.5">
              <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-neutral-200 dark:border-neutral-800 text-xs font-semibold cursor-pointer hover:bg-neutral-50 dark:hover:bg-neutral-900">
                <Upload className="w-3.5 h-3.5 text-[#1877F2]" />
                <span>Upload Profile Photo</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => setAvatarFile(e.target.files?.[0] || null)}
                />
              </label>
              <p className="text-[11px] text-neutral-500">Optional · Automatically compressed for fast loading</p>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                Display Name
              </label>
              <input
                type="text"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Your full name"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
              />
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
                  Unique Username
                </label>
                {checkingUsername ? (
                  <span className="text-[10px] text-neutral-400">Checking...</span>
                ) : usernameAvailable === true ? (
                  <span className="text-[10px] text-emerald-600 font-medium">Available</span>
                ) : usernameAvailable === false ? (
                  <span className="text-[10px] text-red-600 font-medium">Unavailable</span>
                ) : null}
              </div>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))}
                placeholder="username"
                className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">Bio</label>
            <textarea
              rows={2}
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Tell the BANA community what you create or care about..."
              className="w-full rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 p-3 text-xs focus:outline-none focus:ring-2 focus:ring-[#1877F2]"
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300 flex items-center gap-1">
              <MapPin className="w-3.5 h-3.5 text-[#1877F2]" /> City / District Preference (Optional)
            </label>
            <select
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full h-10 rounded-xl border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900 px-3 text-xs"
            >
              <option value="">Prefer not to set</option>
              {BANGLADESH_DISTRICTS.filter((d) => d !== 'All Districts').map((d) => (
                <option key={d} value={`${d}, Bangladesh`}>
                  {d}, Bangladesh
                </option>
              ))}
              <option value="Global">Global</option>
            </select>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-medium text-neutral-700 dark:text-neutral-300">
              Select Your Interests ({interests.length} selected)
            </label>
            <div className="flex flex-wrap gap-1.5">
              {DISCOVERY_CATEGORIES.map((cat) => {
                const selected = interests.includes(cat);
                return (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => toggleInterest(cat)}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                      selected
                        ? 'bg-[#1877F2] border-[#1877F2] text-white'
                        : 'border-neutral-200 dark:border-neutral-800 text-neutral-700 dark:text-neutral-300 hover:bg-neutral-100 dark:hover:bg-neutral-900'
                    }`}
                  >
                    {selected && <Check className="w-3 h-3" />}
                    {cat}
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="submit"
            disabled={saving || checkingUsername || usernameAvailable === false}
            className="w-full h-11 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] text-white text-sm font-semibold disabled:opacity-60 inline-flex items-center justify-center gap-2 transition-colors"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save & Start Discovering
          </button>
        </form>
      </div>
    </div>
  );
}
