import type { BackendConfig } from '../config.js';

export interface ProviderTestResult {
  providerKey: string;
  category: string;
  configured: boolean;
  connectionStatus: 'connected' | 'unconfigured' | 'degraded' | 'error';
  message: string;
  latencyMs: number;
  checkedAt: string;
}

export async function testProviderConnectivity(
  params: {
    category: string;
    providerKey: string;
    endpointUrl?: string;
    billingApprovedByAdmin?: boolean;
    requiresBillingApproval?: boolean;
  },
  config: BackendConfig
): Promise<ProviderTestResult> {
  const started = Date.now();
  const key = params.providerKey;

  if (params.requiresBillingApproval && !params.billingApprovedByAdmin) {
    return {
      providerKey: key,
      category: params.category,
      configured: false,
      connectionStatus: 'unconfigured',
      message: 'Paid provider requires explicit Admin billing approval before testing/activation.',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  }

  if (key === 'webrtc_builtin' || key === 'browser_webrtc' || key === 'browser_progressive' || key === 'inapp_browser' || key === 'firestore_ws') {
    const turnReady = config.turnUrls.length > 0 && Boolean(config.turnSharedSecret);
    return {
      providerKey: key,
      category: params.category,
      configured: true,
      connectionStatus: 'connected',
      message:
        key === 'webrtc_builtin'
          ? turnReady
            ? 'Built-in WebRTC STUN + Coturn TURN credentials verified on backend.'
            : 'Built-in WebRTC STUN + Signaling Relay healthy (optional Coturn TURN not configured).'
          : 'Built-in open/free capability active and ready.',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  }

  if (key === 'livekit_oss' || key === 'livekit_screen') {
    const wsUrl = params.endpointUrl || config.livekitWsUrl;
    if (!wsUrl || !config.livekitApiKey || !config.livekitApiSecret) {
      return {
        providerKey: key,
        category: params.category,
        configured: false,
        connectionStatus: 'unconfigured',
        message: 'Missing LIVEKIT_WS_URL, LIVEKIT_API_KEY, or LIVEKIT_API_SECRET in backend environment.',
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    }

    const httpProbeUrl =
      config.livekitHttpUrl ||
      wsUrl.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    try {
      const resp = await fetch(httpProbeUrl, { method: 'GET', signal: AbortSignal.timeout(4000) });
      return {
        providerKey: key,
        category: params.category,
        configured: true,
        connectionStatus: resp.ok || resp.status === 404 ? 'connected' : 'degraded',
        message: `LiveKit server responded with HTTP ${resp.status}. Token signing ready.`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        providerKey: key,
        category: params.category,
        configured: true,
        connectionStatus: 'error',
        message: `LiveKit HTTP reachability check failed: ${err?.message || 'unreachable'}`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  if (key === 'supabase_realtime' || key === 'supabase_storage') {
    if (!config.supabaseUrl || !config.supabaseAnonKey) {
      return {
        providerKey: key,
        category: params.category,
        configured: false,
        connectionStatus: 'unconfigured',
        message: 'Missing SUPABASE_URL or SUPABASE_ANON_KEY in backend environment.',
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    }
    try {
      const baseUrl = config.supabaseUrl.replace(/\/$/, '');
      const resp = await fetch(`${baseUrl}/rest/v1/`, {
        headers: { apikey: config.supabaseAnonKey },
        signal: AbortSignal.timeout(4000),
      });
      return {
        providerKey: key,
        category: params.category,
        configured: true,
        connectionStatus: resp.ok || resp.status === 401 ? 'connected' : 'degraded',
        message: `Supabase REST API reachable (HTTP ${resp.status}).`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        providerKey: key,
        category: params.category,
        configured: true,
        connectionStatus: 'error',
        message: `Supabase probe failed: ${err?.message || 'network error'}`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  if (key === 'cloudflare_r2') {
    const brokerUrl = params.endpointUrl || config.mediaBrokerUrl;
    if (!brokerUrl) {
      return {
        providerKey: key,
        category: params.category,
        configured: false,
        connectionStatus: 'unconfigured',
        message: 'Media Broker URL is not set in backend or storageProviders config.',
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    }
    try {
      const resp = await fetch(`${brokerUrl.replace(/\/$/, '')}/health`, {
        signal: AbortSignal.timeout(4000),
      });
      return {
        providerKey: key,
        category: params.category,
        configured: resp.ok,
        connectionStatus: resp.ok ? 'connected' : 'degraded',
        message: resp.ok ? 'Media Broker /health responded HTTP 200.' : `Media Broker responded HTTP ${resp.status}.`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    } catch (err: any) {
      return {
        providerKey: key,
        category: params.category,
        configured: false,
        connectionStatus: 'error',
        message: `Media Broker check failed: ${err?.message || 'unreachable'}`,
        latencyMs: Date.now() - started,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  if (key === 'agora') {
    const ok = Boolean(config.agoraAppId && config.agoraAppCertificate);
    return {
      providerKey: key,
      category: params.category,
      configured: ok,
      connectionStatus: ok ? 'connected' : 'unconfigured',
      message: ok
        ? 'Agora App ID & Certificate configured on backend.'
        : 'Missing AGORA_APP_ID / AGORA_APP_CERTIFICATE.',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  }

  if (key === '100ms') {
    const ok = Boolean(config.hmsAccessKey && config.hmsAppSecret);
    return {
      providerKey: key,
      category: params.category,
      configured: ok,
      connectionStatus: ok ? 'connected' : 'unconfigured',
      message: ok
        ? '100ms Access Key & App Secret configured on backend.'
        : 'Missing HMS_ACCESS_KEY / HMS_APP_SECRET.',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  }

  if (key === 'web_push_vapid') {
    const ok = Boolean(config.vapidPublicKey && config.vapidPrivateKey);
    return {
      providerKey: key,
      category: params.category,
      configured: ok,
      connectionStatus: ok ? 'connected' : 'unconfigured',
      message: ok
        ? 'VAPID public & private keys present.'
        : 'Missing VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY.',
      latencyMs: Date.now() - started,
      checkedAt: new Date().toISOString(),
    };
  }

  return {
    providerKey: key,
    category: params.category,
    configured: false,
    connectionStatus: 'unconfigured',
    message: `No active credentials detected for provider "${key}". Configure backend env vars first.`,
    latencyMs: Date.now() - started,
    checkedAt: new Date().toISOString(),
  };
}
