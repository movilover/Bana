import dotenv from 'dotenv';

dotenv.config();

export interface BackendConfig {
  port: number;
  nodeEnv: string;
  corsAllowedOrigins: string[];
  firebaseProjectId: string;
  superAdminEmails: string[];
  /** Paid providers the OPERATOR approved via server env APPROVED_PAID_PROVIDERS (never taken from a client request). */
  approvedPaidProviders: string[];
  turnUrls: string[];
  turnSharedSecret: string;
  livekitWsUrl: string;
  livekitHttpUrl: string;
  livekitApiKey: string;
  livekitApiSecret: string;
  agoraAppId: string;
  agoraAppCertificate: string;
  hmsAccessKey: string;
  hmsAppSecret: string;
  hmsTemplateId: string;
  supabaseUrl: string;
  supabaseAnonKey: string;
  supabaseServiceRoleKey: string;
  supabaseJwtSecret: string;
  supabaseStorageBucket: string;
  mediaBrokerUrl: string;
  vapidPublicKey: string;
  vapidPrivateKey: string;
  vapidSubject: string;
  testAuthHmacSecret: string;
}

export function loadBackendConfig(overrides?: Partial<BackendConfig>): BackendConfig {
  const rawOrigins = process.env.CORS_ALLOWED_ORIGINS || 'http://localhost:3000,https://bana-a5770.web.app';
  const rawTurnUrls = process.env.TURN_URLS || '';
  const rawAdminEmails = process.env.SUPER_ADMIN_EMAILS || 'omor.faruk.sojol.2@gmail.com';

  return {
    port: Number(process.env.PORT || 8788),
    nodeEnv: process.env.NODE_ENV || 'development',
    corsAllowedOrigins: rawOrigins
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || 'bana-a5770',
    superAdminEmails: rawAdminEmails
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    approvedPaidProviders: (process.env.APPROVED_PAID_PROVIDERS || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
    turnUrls: rawTurnUrls
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    turnSharedSecret: process.env.TURN_SHARED_SECRET || '',
    livekitWsUrl: process.env.LIVEKIT_WS_URL || '',
    livekitHttpUrl: process.env.LIVEKIT_HTTP_URL || '',
    livekitApiKey: process.env.LIVEKIT_API_KEY || '',
    livekitApiSecret: process.env.LIVEKIT_API_SECRET || '',
    agoraAppId: process.env.AGORA_APP_ID || '',
    agoraAppCertificate: process.env.AGORA_APP_CERTIFICATE || '',
    hmsAccessKey: process.env.HMS_ACCESS_KEY || '',
    hmsAppSecret: process.env.HMS_APP_SECRET || '',
    hmsTemplateId: process.env.HMS_TEMPLATE_ID || '',
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_ANON_KEY || '',
    supabaseServiceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    supabaseJwtSecret: process.env.SUPABASE_JWT_SECRET || '',
    supabaseStorageBucket: process.env.SUPABASE_STORAGE_BUCKET || 'bana-media',
    mediaBrokerUrl: process.env.MEDIA_BROKER_URL || '',
    vapidPublicKey: process.env.VAPID_PUBLIC_KEY || '',
    vapidPrivateKey: process.env.VAPID_PRIVATE_KEY || '',
    vapidSubject: process.env.VAPID_SUBJECT || 'mailto:admin@bana.app',
    testAuthHmacSecret: process.env.BANA_TEST_AUTH_SECRET || '',
    ...overrides,
  };
}
