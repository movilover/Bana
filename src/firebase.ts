import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, collection, query, where, limit, getDocsFromServer } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getFunctions } from 'firebase/functions';
import { getAnalytics, isSupported as isAnalyticsSupported } from 'firebase/analytics';
import { initializeAppCheck, ReCaptchaV3Provider } from 'firebase/app-check';

export const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || 'AIzaSyCARq_SZRWktj5st9xyUTyVEl5LcGl0HqY',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || 'bana-a5770.firebaseapp.com',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || 'bana-a5770',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || 'bana-a5770.firebasestorage.app',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '374199401810',
  appId: import.meta.env.VITE_FIREBASE_APP_ID || '1:374199401810:web:ad0470c40d6703b936ce8b',
  measurementId: import.meta.env.VITE_FIREBASE_MEASUREMENT_ID || 'G-LXMRP0JWY5',
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const auth = getAuth(app);

const databaseId = import.meta.env.VITE_FIREBASE_DATABASE_ID || undefined;
export const db = databaseId ? getFirestore(app, databaseId) : getFirestore(app);
export const storage = getStorage(app);
export const functions = getFunctions(app);

export const BOOTSTRAPPED_ADMIN_EMAIL = 'omor.faruk.sojol.2@gmail.com';

// Initialize optional App Check if site key is configured
if (typeof window !== 'undefined' && import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY) {
  try {
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(import.meta.env.VITE_FIREBASE_APPCHECK_SITE_KEY),
      isTokenAutoRefreshEnabled: true,
    });
  } catch {
    // Ignore duplicate App Check initialization in dev
  }
}

// Initialize Analytics only in supported browser contexts
if (typeof window !== 'undefined') {
  isAnalyticsSupported()
    .then((supported) => {
      if (supported) getAnalytics(app);
    })
    .catch(() => {});
}

// Validate Firestore connectivity & deployed public read rules on application boot
export async function testFirestoreConnection(): Promise<{ connected: boolean; message?: string }> {
  try {
    await getDocsFromServer(
      query(
        collection(db, 'posts'),
        where('status', '==', 'published'),
        where('visibility', '==', 'public'),
        limit(1)
      )
    );
    return { connected: true };
  } catch (error: any) {
    const msg = error?.message || String(error);
    if (msg.includes('the client is offline')) {
      return {
        connected: false,
        message: 'Unable to reach Firestore servers. Check your network connection or Firebase configuration.',
      };
    }
    if (error?.code === 'permission-denied' || msg.includes('Missing or insufficient permissions')) {
      return {
        connected: false,
        message:
          'Firestore security rules are not deployed on bana-a5770 yet. Run "firebase deploy --only firestore:rules,firestore:indexes,storage" from the project root.',
      };
    }
    return { connected: true };
  }
}
