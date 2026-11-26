import React, { Suspense, lazy } from 'react';
import { ConnectivityBanner } from '@/src/components/common/ConnectivityBanner';
import { UploadStatusDock } from '@/src/components/common/UploadStatusDock';
import { BrandedLoader } from '@/src/components/common/Skeletons';
import { BanaLogo } from '@/src/components/common/BanaLogo';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import { ThemeProvider } from '@/src/contexts/ThemeContext';
import { AuthProvider, useAuth } from '@/src/contexts/AuthContext';
import { ToastProvider } from '@/src/contexts/ToastContext';
import { ErrorBoundary } from '@/src/components/common/ErrorBoundary';
import { DiscoverPage } from '@/src/pages/DiscoverPage';
import { LoginPage, RegisterPage, ForgotPasswordPage } from '@/src/pages/AuthPages';
import { AuthModal } from '@/src/components/auth/AuthModal';
import { OnboardingModal } from '@/src/components/auth/OnboardingModal';
import { CallProvider } from '@/src/contexts/CallContext';
import { GlobalCallOverlay } from '@/src/components/messenger/GlobalCallOverlay';

const ReelsPage = lazy(() => import('@/src/pages/ReelsPage').then((m) => ({ default: m.ReelsPage })));
const CommunitiesPage = lazy(() =>
  import('@/src/pages/CommunitiesPage').then((m) => ({ default: m.CommunitiesPage }))
);
const MarketplacePage = lazy(() =>
  import('@/src/pages/MarketplacePage').then((m) => ({ default: m.MarketplacePage }))
);
const ProductDetailPage = lazy(() =>
  import('@/src/pages/ProductDetailPage').then((m) => ({ default: m.ProductDetailPage }))
);
const StorefrontPage = lazy(() =>
  import('@/src/pages/StorefrontPage').then((m) => ({ default: m.StorefrontPage }))
);
const MessengerPage = lazy(() =>
  import('@/src/pages/MessengerPage').then((m) => ({ default: m.MessengerPage }))
);
const NotificationsPage = lazy(() =>
  import('@/src/pages/NotificationsPage').then((m) => ({ default: m.NotificationsPage }))
);
const SavedPage = lazy(() => import('@/src/pages/SavedPage').then((m) => ({ default: m.SavedPage })));
const CreatorStudioPage = lazy(() =>
  import('@/src/pages/CreatorStudioPage').then((m) => ({ default: m.CreatorStudioPage }))
);
const AdvertisePage = lazy(() =>
  import('@/src/pages/AdvertisePage').then((m) => ({ default: m.AdvertisePage }))
);
const ProfilePage = lazy(() => import('@/src/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })));
const SettingsPage = lazy(() => import('@/src/pages/SettingsPage').then((m) => ({ default: m.SettingsPage })));
const VerificationPage = lazy(() =>
  import('@/src/pages/VerificationPage').then((m) => ({ default: m.VerificationPage }))
);
const VideoAnalyticsPage = lazy(() =>
  import('@/src/pages/VideoAnalyticsPage').then((m) => ({ default: m.VideoAnalyticsPage }))
);

function NotFoundPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-neutral-100 dark:bg-neutral-950 p-4">
      <div className="max-w-md w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-8 text-center space-y-4 shadow-sm">
        <div className="flex justify-center">
          <BanaLogo />
        </div>
        <p className="font-display font-extrabold text-6xl text-neutral-950 dark:text-white tracking-tight">404</p>
        <h1 className="font-display font-bold text-lg text-neutral-950 dark:text-white">Page Not Found</h1>
        <p className="text-xs text-neutral-600 dark:text-neutral-400">
          The page you are looking for does not exist, was moved, or is no longer available.
        </p>
        <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-1">
          <button
            type="button"
            onClick={() => (window.history.length > 1 ? window.history.back() : (window.location.href = import.meta.env.BASE_URL))}
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl border border-neutral-300 dark:border-neutral-700 text-sm font-semibold text-neutral-900 dark:text-neutral-100 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            Go Back
          </button>
          <Link
            to="/discover"
            className="inline-flex items-center justify-center min-h-[44px] px-5 rounded-xl bg-neutral-950 text-white dark:bg-white dark:text-neutral-950 text-sm font-semibold"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-white dark:bg-neutral-950">
      <BrandedLoader label="Loading BANA..." />
    </div>
  );
}

function GlobalAuthModal() {
  const { authModalOpen, authModalReason, authModalTab, closeAuthModal } = useAuth();
  return (
    <AuthModal
      isOpen={authModalOpen}
      reason={authModalReason}
      initialTab={authModalTab}
      onClose={closeAuthModal}
    />
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { firebaseUser, loading } = useAuth();
  const location = useLocation();
  if (loading) {
    return <RouteFallback />;
  }
  if (!firebaseUser) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
  }
  return <>{children}</>;
}

function FeatureRoute({
  featureKey,
  featureLabel,
  children,
}: {
  featureKey: 'enableReels' | 'enableCommunities' | 'enableMarketplace' | 'enableMessaging' | 'enableMonetization' | 'enableAds';
  featureLabel: string;
  children: React.ReactNode;
}) {
  const { platformSettings, adminRole } = useAuth();
  const enabled = platformSettings[featureKey] !== false;
  if (!enabled && !adminRole) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F0F2F5] dark:bg-neutral-950 p-4">
        <div className="max-w-md w-full rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900 p-6 text-center space-y-3 shadow-sm">
          <div className="mx-auto h-11 w-11 rounded-full bg-amber-100 dark:bg-amber-950/50 text-amber-600 flex items-center justify-center">
            <AlertCircle className="w-5 h-5" />
          </div>
          <h1 className="font-display font-bold text-base text-neutral-950 dark:text-white">
            {featureLabel} Temporarily Unavailable
          </h1>
          <p className="text-xs text-neutral-600 dark:text-neutral-400">
            This module is currently paused by BANA Administration. Check back soon or continue exploring Smart Discovery.
          </p>
          <Link
            to="/discover"
            className="inline-flex items-center justify-center px-4 py-2 rounded-xl bg-brand text-white text-xs font-semibold hover:bg-brand-hover"
          >
            Back to Discover
          </Link>
        </div>
      </div>
    );
  }
  return <>{children}</>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <CallProvider>
              <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || undefined}>
                <ConnectivityBanner />
                <UploadStatusDock />
                <Suspense fallback={<RouteFallback />}>
                  <Routes>
                    <Route path="/" element={<Navigate to="/discover" replace />} />
                    <Route path="/discover" element={<DiscoverPage />} />
                    <Route
                      path="/reels"
                      element={
                        <FeatureRoute featureKey="enableReels" featureLabel="BANA Reels">
                          <ReelsPage />
                        </FeatureRoute>
                      }
                    />
                    <Route
                      path="/communities"
                      element={
                        <FeatureRoute featureKey="enableCommunities" featureLabel="BANA Communities">
                          <CommunitiesPage />
                        </FeatureRoute>
                      }
                    />
                    <Route
                      path="/communities/:communityId"
                      element={
                        <FeatureRoute featureKey="enableCommunities" featureLabel="BANA Communities">
                          <CommunitiesPage />
                        </FeatureRoute>
                      }
                    />
                    <Route
                      path="/market"
                      element={
                        <FeatureRoute featureKey="enableMarketplace" featureLabel="BANA Marketplace">
                          <MarketplacePage />
                        </FeatureRoute>
                      }
                    />
                    <Route
                      path="/market/product/:productId"
                      element={
                        <FeatureRoute featureKey="enableMarketplace" featureLabel="BANA Marketplace">
                          <ProductDetailPage />
                        </FeatureRoute>
                      }
                    />
                    <Route
                      path="/market/store/:storeId"
                      element={
                        <FeatureRoute featureKey="enableMarketplace" featureLabel="BANA Marketplace">
                          <StorefrontPage />
                        </FeatureRoute>
                      }
                    />
                    <Route
                      path="/messages"
                      element={
                        <ProtectedRoute>
                          <FeatureRoute featureKey="enableMessaging" featureLabel="BANA Messenger">
                            <MessengerPage />
                          </FeatureRoute>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/messages/:conversationId"
                      element={
                        <ProtectedRoute>
                          <FeatureRoute featureKey="enableMessaging" featureLabel="BANA Messenger">
                            <MessengerPage />
                          </FeatureRoute>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/notifications"
                      element={
                        <ProtectedRoute>
                          <NotificationsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/analytics/videos"
                      element={
                        <ProtectedRoute>
                          <VideoAnalyticsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/verification"
                      element={
                        <ProtectedRoute>
                          <VerificationPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/saved"
                      element={
                        <ProtectedRoute>
                          <SavedPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/creator-studio"
                      element={
                        <ProtectedRoute>
                          <FeatureRoute featureKey="enableMonetization" featureLabel="BANA Creator Studio">
                            <CreatorStudioPage />
                          </FeatureRoute>
                        </ProtectedRoute>
                      }
                    />
                    <Route
                      path="/advertise"
                      element={
                        <ProtectedRoute>
                          <FeatureRoute featureKey="enableAds" featureLabel="BANA Ads Manager">
                            <AdvertisePage />
                          </FeatureRoute>
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/profile/:username" element={<ProfilePage />} />
                    <Route
                      path="/settings"
                      element={
                        <ProtectedRoute>
                          <SettingsPage />
                        </ProtectedRoute>
                      }
                    />
                    <Route path="/login" element={<LoginPage />} />
                    <Route path="/register" element={<RegisterPage />} />
                    <Route path="/forgot-password" element={<ForgotPasswordPage />} />
                    <Route path="*" element={<NotFoundPage />} />
                  </Routes>
                </Suspense>
                <GlobalAuthModal />
                <OnboardingModal />
                <GlobalCallOverlay />
              </BrowserRouter>
            </CallProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
