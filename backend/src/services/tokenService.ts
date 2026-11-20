import crypto from 'node:crypto';
import type { BackendConfig } from '../config.js';

export type SupportedCallingProvider = 'webrtc_builtin' | 'livekit_oss' | 'agora' | '100ms';

export interface MintCallTokenRequest {
  providerId: SupportedCallingProvider;
  roomName: string;
  uid: string;
  displayName?: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  ttlSeconds?: number;
  billingApprovedByAdmin?: boolean;
}

export interface MintCallTokenResponse {
  providerId: SupportedCallingProvider;
  configured: boolean;
  requiresBillingApproval: boolean;
  token?: string;
  wsUrl?: string;
  appId?: string;
  channelName: string;
  uid: string;
  expiresAtIso?: string;
  iceServers?: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  message?: string;
}

function base64UrlEncode(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

/**
 * Generates an official LiveKit v2 JWT AccessToken signed with HMAC-SHA256.
 * Zero paid SDK dependencies required; compatible with self-hosted LiveKit & LiveKit Cloud.
 */
export function signLiveKitJwt(params: {
  apiKey: string;
  apiSecret: string;
  identity: string;
  name?: string;
  roomName: string;
  canPublish?: boolean;
  canSubscribe?: boolean;
  ttlSeconds?: number;
}): { token: string; expiresAtIso: string } {
  const nowSec = Math.floor(Date.now() / 1000);
  const ttl = Math.max(60, Math.min(21600, params.ttlSeconds || 3600));
  const exp = nowSec + ttl;

  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = {
    iss: params.apiKey,
    sub: params.identity,
    name: params.name || params.identity,
    nbf: nowSec - 5,
    exp,
    jti: params.identity,
    video: {
      roomJoin: true,
      room: params.roomName,
      canPublish: params.canPublish !== false,
      canSubscribe: params.canSubscribe !== false,
      canPublishData: true,
    },
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const sig = crypto.createHmac('sha256', params.apiSecret).update(signingInput).digest();

  return {
    token: `${signingInput}.${base64UrlEncode(sig)}`,
    expiresAtIso: new Date(exp * 1000).toISOString(),
  };
}

/**
 * Generates Coturn TURN REST ephemeral HMAC-SHA1 credentials
 * (`username = "<unixExpiry>:<uid>"`, `credential = base64(hmac_sha1(secret, username))`).
 */
export function buildIceServersForUser(uid: string, config: BackendConfig) {
  const iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }> = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ];

  let turnConfigured = false;
  if (config.turnUrls.length > 0 && config.turnSharedSecret) {
    const expiry = Math.floor(Date.now() / 1000) + 3600 * 6;
    const username = `${expiry}:${uid}`;
    const credential = crypto
      .createHmac('sha1', config.turnSharedSecret)
      .update(username)
      .digest('base64');
    iceServers.push({
      urls: config.turnUrls,
      username,
      credential,
    });
    turnConfigured = true;
  }

  return { iceServers, turnConfigured };
}

export function mintCallingSessionCredentials(
  req: MintCallTokenRequest,
  config: BackendConfig
): MintCallTokenResponse {
  if (req.providerId === 'webrtc_builtin') {
    const { iceServers, turnConfigured } = buildIceServersForUser(req.uid, config);
    return {
      providerId: 'webrtc_builtin',
      configured: true,
      requiresBillingApproval: false,
      channelName: req.roomName,
      uid: req.uid,
      iceServers,
      expiresAtIso: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
      message: turnConfigured
        ? 'Built-in WebRTC with ephemeral Coturn TURN credentials ready.'
        : 'Built-in WebRTC STUN ready (configure TURN_URLS & TURN_SHARED_SECRET for strict firewall relay).',
    };
  }

  if (req.providerId === 'livekit_oss') {
    if (!config.livekitWsUrl || !config.livekitApiKey || !config.livekitApiSecret) {
      return {
        providerId: 'livekit_oss',
        configured: false,
        requiresBillingApproval: false,
        channelName: req.roomName,
        uid: req.uid,
        message: 'LiveKit is not configured. Set LIVEKIT_WS_URL, LIVEKIT_API_KEY, and LIVEKIT_API_SECRET in backend environment.',
      };
    }
    const { token, expiresAtIso } = signLiveKitJwt({
      apiKey: config.livekitApiKey,
      apiSecret: config.livekitApiSecret,
      identity: req.uid,
      name: req.displayName,
      roomName: req.roomName,
      canPublish: req.canPublish,
      canSubscribe: req.canSubscribe,
      ttlSeconds: req.ttlSeconds,
    });
    return {
      providerId: 'livekit_oss',
      configured: true,
      requiresBillingApproval: false,
      token,
      wsUrl: config.livekitWsUrl,
      channelName: req.roomName,
      uid: req.uid,
      expiresAtIso,
      message: 'LiveKit access token signed.',
    };
  }

  if (req.providerId === 'agora') {
    if (!req.billingApprovedByAdmin) {
      return {
        providerId: 'agora',
        configured: false,
        requiresBillingApproval: true,
        channelName: req.roomName,
        uid: req.uid,
        message: 'Agora RTC is a paid provider and requires explicit Admin billing approval before activation.',
      };
    }
    if (!config.agoraAppId || !config.agoraAppCertificate) {
      return {
        providerId: 'agora',
        configured: false,
        requiresBillingApproval: true,
        channelName: req.roomName,
        uid: req.uid,
        message: 'AGORA_APP_ID and AGORA_APP_CERTIFICATE must be configured in backend environment variables.',
      };
    }
    return {
      providerId: 'agora',
      configured: true,
      requiresBillingApproval: true,
      appId: config.agoraAppId,
      channelName: req.roomName,
      uid: req.uid,
      message: 'Agora App credentials detected. Add official agora-token builder if minting RTC AccessToken2 in production.',
    };
  }

  if (req.providerId === '100ms') {
    if (!req.billingApprovedByAdmin) {
      return {
        providerId: '100ms',
        configured: false,
        requiresBillingApproval: true,
        channelName: req.roomName,
        uid: req.uid,
        message: '100ms is a paid provider and requires explicit Admin billing approval before activation.',
      };
    }
    if (!config.hmsAccessKey || !config.hmsAppSecret) {
      return {
        providerId: '100ms',
        configured: false,
        requiresBillingApproval: true,
        channelName: req.roomName,
        uid: req.uid,
        message: 'HMS_ACCESS_KEY and HMS_APP_SECRET must be configured in backend environment variables.',
      };
    }
    // 100ms Auth Token v2 JWT signed with HMS_APP_SECRET
    const nowSec = Math.floor(Date.now() / 1000);
    const exp = nowSec + 3600;
    const header = base64UrlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payload = base64UrlEncode(
      JSON.stringify({
        access_key: config.hmsAccessKey,
        room_id: req.roomName,
        user_id: req.uid,
        role: 'guest',
        type: 'app',
        version: 2,
        iat: nowSec,
        nbf: nowSec,
        exp,
        jti: crypto.randomUUID(),
      })
    );
    const sig = crypto
      .createHmac('sha256', config.hmsAppSecret)
      .update(`${header}.${payload}`)
      .digest();
    return {
      providerId: '100ms',
      configured: true,
      requiresBillingApproval: true,
      token: `${header}.${payload}.${base64UrlEncode(sig)}`,
      channelName: req.roomName,
      uid: req.uid,
      expiresAtIso: new Date(exp * 1000).toISOString(),
      message: '100ms v2 App Auth token signed.',
    };
  }

  return {
    providerId: req.providerId,
    configured: false,
    requiresBillingApproval: false,
    channelName: req.roomName,
    uid: req.uid,
    message: 'Unknown calling provider.',
  };
}
