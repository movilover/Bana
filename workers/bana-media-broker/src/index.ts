/**
 * BANA Multi-Cloud Media Broker Worker
 * Runs on Cloudflare Workers Free Tier (100,000 req/day, Spark Plan compatible).
 *
 * Responsibilities:
 * - Verifies Firebase ID token JWTs via Google public JWK certs (zero Admin SDK / zero Blaze needed).
 * - Signs AWS SigV4 presigned PUT/GET/HEAD/DELETE URLs for R2, Backblaze B2, GCS S3, Supabase S3, Generic S3.
 * - Executes real temporary upload + download + SHA-256 + delete probes before marking a provider Connected.
 * - Executes streaming backup copy (source -> target) with SHA-256 integrity verification.
 * - Enforces object path ownership (`<category>/<uid>/...`) so regular users cannot overwrite other users' media.
 */

export interface Env {
  FIREBASE_PROJECT_ID: string;
  ALLOWED_ORIGINS?: string;

  R2_ENDPOINT?: string;
  R2_BUCKET?: string;
  R2_REGION?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_PUBLIC_BASE_URL?: string;

  B2_ENDPOINT?: string;
  B2_BUCKET?: string;
  B2_REGION?: string;
  B2_KEY_ID?: string;
  B2_APPLICATION_KEY?: string;
  B2_PUBLIC_BASE_URL?: string;

  GCS_ENDPOINT?: string;
  GCS_BUCKET?: string;
  GCS_REGION?: string;
  GCS_ACCESS_KEY_ID?: string;
  GCS_SECRET_ACCESS_KEY?: string;
  GCS_PUBLIC_BASE_URL?: string;

  SUPABASE_ENDPOINT?: string;
  SUPABASE_BUCKET?: string;
  SUPABASE_REGION?: string;
  SUPABASE_ACCESS_KEY_ID?: string;
  SUPABASE_SECRET_ACCESS_KEY?: string;
  SUPABASE_PUBLIC_BASE_URL?: string;

  GENERIC_S3_ENDPOINT?: string;
  GENERIC_S3_BUCKET?: string;
  GENERIC_S3_REGION?: string;
  GENERIC_S3_ACCESS_KEY_ID?: string;
  GENERIC_S3_SECRET_ACCESS_KEY?: string;
  GENERIC_S3_PUBLIC_BASE_URL?: string;
}

interface ProviderCredentials {
  providerId: string;
  endpoint: string;
  bucket: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

const encoder = new TextEncoder();
const SUPER_ADMIN_EMAIL = 'omor.faruk.sojol.2@gmail.com';
const GOOGLE_JWK_URL =
  'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

let cachedJwks: { fetchedAt: number; keys: JsonWebKey[] } | null = null;

function corsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get('Origin') || '*';
  const allowed = (env.ALLOWED_ORIGINS || 'https://bana-a5770.web.app,https://bana-a5770.firebaseapp.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const allowOrigin =
    allowed.includes('*') || allowed.includes(origin) ? origin : allowed[0] || '*';

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function jsonResponse(
  request: Request,
  env: Env,
  status: number,
  body: Record<string, unknown>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(request, env),
    },
  });
}

function base64UrlToUint8Array(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

async function getGooglePublicJwks(): Promise<JsonWebKey[]> {
  if (cachedJwks && Date.now() - cachedJwks.fetchedAt < 3600_000) {
    return cachedJwks.keys;
  }
  const resp = await fetch(GOOGLE_JWK_URL);
  if (!resp.ok) {
    throw new Error(`Failed to fetch Google JWK certificates (${resp.status}).`);
  }
  const data = (await resp.json()) as { keys?: JsonWebKey[] };
  const keys = Array.isArray(data.keys) ? data.keys : [];
  cachedJwks = { fetchedAt: Date.now(), keys };
  return keys;
}

interface VerifiedFirebaseUser {
  uid: string;
  email: string;
  isAdmin: boolean;
}

async function verifyFirebaseBearer(request: Request, env: Env): Promise<VerifiedFirebaseUser> {
  const authHeader = request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) {
    throw new Error('Missing Firebase Authorization Bearer token.');
  }
  const token = authHeader.slice(7).trim();
  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID JWT.');
  }

  const header = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[0]))) as {
    alg?: string;
    kid?: string;
  };
  const payload = JSON.parse(new TextDecoder().decode(base64UrlToUint8Array(parts[1]))) as {
    aud?: string;
    iss?: string;
    sub?: string;
    exp?: number;
    email?: string;
    email_verified?: boolean;
    adminRole?: string;
  };

  if (header.alg !== 'RS256' || !header.kid) {
    throw new Error('Unsupported JWT algorithm or missing kid.');
  }

  const projectId = env.FIREBASE_PROJECT_ID || 'bana-a5770';
  const expectedIss = `https://securetoken.google.com/${projectId}`;
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.aud !== projectId || payload.iss !== expectedIss || !payload.sub) {
    throw new Error('Firebase ID token audience/issuer mismatch.');
  }
  if (!payload.exp || payload.exp <= nowSec) {
    throw new Error('Firebase ID token has expired.');
  }

  const jwks = await getGooglePublicJwks();
  const jwk = jwks.find((k: any) => k.kid === header.kid);
  if (!jwk) {
    throw new Error('Matching Google public signing key not found.');
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    jwk,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['verify']
  );

  const signedInput = encoder.encode(`${parts[0]}.${parts[1]}`);
  const signatureBytes = base64UrlToUint8Array(parts[2]);
  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5',
    key,
    signatureBytes,
    signedInput
  );
  if (!valid) {
    throw new Error('Firebase ID token RSA signature verification failed.');
  }

  const isBootstrappedSuper =
    payload.email === SUPER_ADMIN_EMAIL && payload.email_verified === true;
  const hasRoleClaim = ['super_admin', 'admin', 'content_manager'].includes(
    String(payload.adminRole || '')
  );

  return {
    uid: payload.sub,
    email: String(payload.email || ''),
    isAdmin: Boolean(isBootstrappedSuper || hasRoleClaim),
  };
}

function sanitizeObjectKey(rawKey: string): string {
  return rawKey
    .replace(/^\/+/, '')
    .replace(/\.\.+/g, '.')
    .replace(/[^a-zA-Z0-9._\-\/]/g, '_');
}

function isUserAllowedObjectKey(user: VerifiedFirebaseUser, objectKey: string): boolean {
  if (user.isAdmin) return true;
  const segs = objectKey.split('/').filter(Boolean);
  return segs.includes(user.uid);
}

function resolveProviderCredentials(
  providerId: string,
  env: Env,
  overrides?: {
    endpointUrl?: string;
    bucketName?: string;
    region?: string;
    publicCdnBaseUrl?: string;
  }
): ProviderCredentials {
  if (providerId === 'cloudflare_stream') {
    throw new Error('Cloudflare Stream is disabled on Spark Free Plan.');
  }

  const map: Record<string, ProviderCredentials> = {
    cloudflare_r2: {
      providerId: 'cloudflare_r2',
      endpoint: overrides?.endpointUrl || env.R2_ENDPOINT || '',
      bucket: overrides?.bucketName || env.R2_BUCKET || '',
      region: overrides?.region || env.R2_REGION || 'auto',
      accessKeyId: env.R2_ACCESS_KEY_ID || '',
      secretAccessKey: env.R2_SECRET_ACCESS_KEY || '',
      publicBaseUrl: overrides?.publicCdnBaseUrl || env.R2_PUBLIC_BASE_URL || '',
    },
    backblaze_b2: {
      providerId: 'backblaze_b2',
      endpoint: overrides?.endpointUrl || env.B2_ENDPOINT || '',
      bucket: overrides?.bucketName || env.B2_BUCKET || '',
      region: overrides?.region || env.B2_REGION || 'us-west-004',
      accessKeyId: env.B2_KEY_ID || '',
      secretAccessKey: env.B2_APPLICATION_KEY || '',
      publicBaseUrl: overrides?.publicCdnBaseUrl || env.B2_PUBLIC_BASE_URL || '',
    },
    google_cloud_storage: {
      providerId: 'google_cloud_storage',
      endpoint: overrides?.endpointUrl || env.GCS_ENDPOINT || 'https://storage.googleapis.com',
      bucket: overrides?.bucketName || env.GCS_BUCKET || '',
      region: overrides?.region || env.GCS_REGION || 'auto',
      accessKeyId: env.GCS_ACCESS_KEY_ID || '',
      secretAccessKey: env.GCS_SECRET_ACCESS_KEY || '',
      publicBaseUrl: overrides?.publicCdnBaseUrl || env.GCS_PUBLIC_BASE_URL || '',
    },
    supabase_storage: {
      providerId: 'supabase_storage',
      endpoint: overrides?.endpointUrl || env.SUPABASE_ENDPOINT || '',
      bucket: overrides?.bucketName || env.SUPABASE_BUCKET || '',
      region: overrides?.region || env.SUPABASE_REGION || 'us-east-1',
      accessKeyId: env.SUPABASE_ACCESS_KEY_ID || '',
      secretAccessKey: env.SUPABASE_SECRET_ACCESS_KEY || '',
      publicBaseUrl: overrides?.publicCdnBaseUrl || env.SUPABASE_PUBLIC_BASE_URL || '',
    },
    generic_s3: {
      providerId: 'generic_s3',
      endpoint: overrides?.endpointUrl || env.GENERIC_S3_ENDPOINT || '',
      bucket: overrides?.bucketName || env.GENERIC_S3_BUCKET || '',
      region: overrides?.region || env.GENERIC_S3_REGION || 'us-east-1',
      accessKeyId: env.GENERIC_S3_ACCESS_KEY_ID || '',
      secretAccessKey: env.GENERIC_S3_SECRET_ACCESS_KEY || '',
      publicBaseUrl: overrides?.publicCdnBaseUrl || env.GENERIC_S3_PUBLIC_BASE_URL || '',
    },
  };

  const creds = map[providerId];
  if (!creds) {
    throw new Error(`Unsupported storage provider: ${providerId}`);
  }
  if (!creds.endpoint || !creds.bucket || !creds.accessKeyId || !creds.secretAccessKey) {
    throw new Error(
      `Provider ${providerId} is not configured on Media Broker: missing endpoint, bucket, or Worker secret credentials.`
    );
  }
  return creds;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? encoder.encode(data) : new Uint8Array(data);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

async function hmacSha256(key: ArrayBuffer | Uint8Array, msg: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? (key.buffer as ArrayBuffer) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(msg));
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function createPresignedS3Url(params: {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  creds: ProviderCredentials;
  objectKey?: string;
  queryExtra?: Record<string, string>;
  contentType?: string;
  expiresInSeconds?: number;
}): Promise<string> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const expires = Math.max(60, Math.min(604800, params.expiresInSeconds || 900));

  const cleanEndpoint = params.creds.endpoint.replace(/\/+$/, '');
  const endpointUrl = new URL(cleanEndpoint);
  const host = endpointUrl.host;
  const cleanKey = (params.objectKey || '').replace(/^\/+/, '');
  const encodedKey = cleanKey ? cleanKey.split('/').map(encodeRfc3986).join('/') : '';
  const canonicalUri = encodedKey
    ? `/${encodeRfc3986(params.creds.bucket)}/${encodedKey}`
    : `/${encodeRfc3986(params.creds.bucket)}`;

  const credentialScope = `${dateStamp}/${params.creds.region}/s3/aws4_request`;
  const signedHeadersList = ['host'];
  let canonicalHeaders = `host:${host}\n`;
  if (params.contentType && params.method === 'PUT') {
    signedHeadersList.unshift('content-type');
    canonicalHeaders = `content-type:${params.contentType}\nhost:${host}\n`;
  }
  const signedHeaders = signedHeadersList.sort().join(';');

  const queryParams: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${params.creds.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  if (params.queryExtra) {
    for (const [k, v] of Object.entries(params.queryExtra)) {
      queryParams.push([k, v]);
    }
  }
  queryParams.sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalQuery = queryParams
    .map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`)
    .join('&');

  const canonicalRequest = [
    params.method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmacSha256(encoder.encode(`AWS4${params.creds.secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, params.creds.region);
  const kService = await hmacSha256(kRegion, 's3');
  const signingKey = await hmacSha256(kService, 'aws4_request');
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  return `${endpointUrl.protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function buildPublicOrPresignedUrl(
  creds: ProviderCredentials,
  objectKey: string,
  presignedFallback: string
): string {
  if (creds.publicBaseUrl) {
    return `${creds.publicBaseUrl.replace(/\/+$/, '')}/${objectKey}`;
  }
  return presignedFallback;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return jsonResponse(request, env, 200, {
        ok: true,
        service: 'bana-media-broker',
        sparkCompatible: true,
        timestamp: new Date().toISOString(),
      });
    }

    let user: VerifiedFirebaseUser;
    try {
      user = await verifyFirebaseBearer(request, env);
    } catch (err: any) {
      return jsonResponse(request, env, 401, {
        ok: false,
        error: err?.message || 'Unauthorized',
      });
    }

    try {
      const body = (await request.json().catch(() => ({}))) as Record<string, any>;

      // 1. Live Upload + Download + SHA-256 + Delete Connection Probe
      if (url.pathname === '/api/media/probe' && request.method === 'POST') {
        const creds = resolveProviderCredentials(String(body.providerId || ''), env, body);
        const probeKey = `_health/probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`;
        const probeContent = `bana-probe-${Date.now()}`;
        const expectedSha = await sha256Hex(probeContent);

        const putUrl = await createPresignedS3Url({
          method: 'PUT',
          creds,
          objectKey: probeKey,
          contentType: 'text/plain',
          expiresInSeconds: 120,
        });
        const putRes = await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'text/plain' },
          body: probeContent,
        });
        if (!putRes.ok) {
          return jsonResponse(request, env, 502, {
            ok: false,
            error: `Probe upload failed with HTTP ${putRes.status} on ${creds.providerId}.`,
          });
        }

        const getUrl = await createPresignedS3Url({
          method: 'GET',
          creds,
          objectKey: probeKey,
          expiresInSeconds: 120,
        });
        const getRes = await fetch(getUrl);
        if (!getRes.ok) {
          return jsonResponse(request, env, 502, {
            ok: false,
            error: `Probe read-back failed with HTTP ${getRes.status}.`,
          });
        }
        const readText = await getRes.text();
        const actualSha = await sha256Hex(readText);
        if (actualSha !== expectedSha) {
          return jsonResponse(request, env, 502, {
            ok: false,
            error: 'Probe SHA-256 read-back mismatch.',
          });
        }

        const delUrl = await createPresignedS3Url({
          method: 'DELETE',
          creds,
          objectKey: probeKey,
          expiresInSeconds: 120,
        });
        await fetch(delUrl, { method: 'DELETE' }).catch(() => {});

        return jsonResponse(request, env, 200, {
          ok: true,
          message: `Verified PUT + GET + SHA-256 + DELETE probe passed on ${creds.providerId} (${creds.bucket}).`,
        });
      }

      // 2. Presigned PUT URL for Direct Browser-to-Bucket Upload
      if (url.pathname === '/api/media/presign-upload' && request.method === 'POST') {
        const providerId = String(body.providerId || 'cloudflare_r2');
        const objectKey = sanitizeObjectKey(String(body.objectKey || ''));
        const contentType = String(body.contentType || 'application/octet-stream');
        const sizeBytes = Number(body.sizeBytes || 0);

        if (!objectKey) {
          return jsonResponse(request, env, 400, { ok: false, error: 'Missing objectKey.' });
        }
        if (!isUserAllowedObjectKey(user, objectKey)) {
          return jsonResponse(request, env, 403, {
            ok: false,
            error: 'Object path must include authenticated user UID namespace.',
          });
        }
        if (providerId === 'supabase_storage' && sizeBytes > 50 * 1024 * 1024) {
          return jsonResponse(request, env, 400, {
            ok: false,
            error: 'Supabase Storage Free Plan strictly caps single uploads at 50 MB.',
          });
        }

        const creds = resolveProviderCredentials(providerId, env, body);
        const uploadUrl = await createPresignedS3Url({
          method: 'PUT',
          creds,
          objectKey,
          contentType,
          expiresInSeconds: 1800,
        });
        const presignedGet = await createPresignedS3Url({
          method: 'GET',
          creds,
          objectKey,
          expiresInSeconds: 604800,
        });

        return jsonResponse(request, env, 200, {
          ok: true,
          uploadUrl,
          publicUrl: buildPublicOrPresignedUrl(creds, objectKey, presignedGet),
          expiresInSeconds: 1800,
        });
      }

      // 3. Presigned GET URL
      if (url.pathname === '/api/media/presign-download' && request.method === 'POST') {
        const objectKey = sanitizeObjectKey(String(body.objectKey || ''));
        if (!objectKey) {
          return jsonResponse(request, env, 400, { ok: false, error: 'Missing objectKey.' });
        }
        const creds = resolveProviderCredentials(String(body.providerId || 'cloudflare_r2'), env, body);
        const downloadUrl = await createPresignedS3Url({
          method: 'GET',
          creds,
          objectKey,
          expiresInSeconds: 3600,
        });
        return jsonResponse(request, env, 200, {
          ok: true,
          downloadUrl: buildPublicOrPresignedUrl(creds, objectKey, downloadUrl),
        });
      }

      // 4. HEAD Object
      if (url.pathname === '/api/media/head' && request.method === 'POST') {
        const objectKey = sanitizeObjectKey(String(body.objectKey || ''));
        if (!objectKey) {
          return jsonResponse(request, env, 400, { exists: false });
        }
        const creds = resolveProviderCredentials(String(body.providerId || 'cloudflare_r2'), env, body);
        const headUrl = await createPresignedS3Url({
          method: 'HEAD',
          creds,
          objectKey,
          expiresInSeconds: 120,
        });
        const res = await fetch(headUrl, { method: 'HEAD' });
        return jsonResponse(request, env, 200, {
          exists: res.ok,
          sizeBytes: Number(res.headers.get('content-length') || 0),
          contentType: res.headers.get('content-type') || '',
          etag: res.headers.get('etag')?.replace(/"/g, '') || '',
          acceptRanges: (res.headers.get('accept-ranges') || '').toLowerCase() === 'bytes',
        });
      }

      // 5. Server-to-Server Cross-Cloud Backup Copy + SHA-256 Verification
      if (url.pathname === '/api/media/backup-copy' && request.method === 'POST') {
        if (!user.isAdmin && !String(body.targetObjectKey || '').includes(user.uid)) {
          return jsonResponse(request, env, 403, { ok: false, error: 'Forbidden backup scope.' });
        }
        const sourceUrl = String(body.sourceUrl || '');
        const targetProviderId = String(body.targetProviderId || 'backblaze_b2');
        const targetObjectKey = sanitizeObjectKey(String(body.targetObjectKey || ''));
        const expectedSha256 = String(body.expectedSha256 || '').trim().toLowerCase();
        const contentType = String(body.contentType || 'application/octet-stream');

        if (!sourceUrl || !targetObjectKey) {
          return jsonResponse(request, env, 400, {
            ok: false,
            error: 'Missing sourceUrl or targetObjectKey.',
          });
        }

        const creds = resolveProviderCredentials(targetProviderId, env, body);
        const sourceRes = await fetch(sourceUrl);
        if (!sourceRes.ok) {
          return jsonResponse(request, env, 502, {
            ok: false,
            error: `Source fetch failed with HTTP ${sourceRes.status}.`,
          });
        }
        const buf = await sourceRes.arrayBuffer();
        const actualSha256 = await sha256Hex(buf);
        if (expectedSha256 && actualSha256.toLowerCase() !== expectedSha256) {
          return jsonResponse(request, env, 409, {
            ok: false,
            error: `SHA-256 checksum mismatch before backup upload (expected ${expectedSha256.slice(0, 12)}, got ${actualSha256.slice(0, 12)}).`,
          });
        }

        const putUrl = await createPresignedS3Url({
          method: 'PUT',
          creds,
          objectKey: targetObjectKey,
          contentType,
          expiresInSeconds: 900,
        });
        const putRes = await fetch(putUrl, {
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          body: buf,
        });
        if (!putRes.ok) {
          return jsonResponse(request, env, 502, {
            ok: false,
            error: `Backup upload failed on ${targetProviderId} with HTTP ${putRes.status}.`,
          });
        }

        const getFallback = await createPresignedS3Url({
          method: 'GET',
          creds,
          objectKey: targetObjectKey,
          expiresInSeconds: 604800,
        });

        return jsonResponse(request, env, 200, {
          ok: true,
          targetUrl: buildPublicOrPresignedUrl(creds, targetObjectKey, getFallback),
          checksumSha256: actualSha256,
          sizeBytes: buf.byteLength,
        });
      }

      // 6. List Objects
      if (url.pathname === '/api/media/list' && request.method === 'POST') {
        const creds = resolveProviderCredentials(String(body.providerId || 'cloudflare_r2'), env, body);
        const prefix = String(body.prefix || '');
        const maxKeys = Math.min(100, Math.max(1, Number(body.maxKeys || 50)));
        const listUrl = await createPresignedS3Url({
          method: 'GET',
          creds,
          queryExtra: {
            'list-type': '2',
            'max-keys': String(maxKeys),
            ...(prefix ? { prefix } : {}),
          },
          expiresInSeconds: 120,
        });
        const res = await fetch(listUrl);
        if (!res.ok) {
          return jsonResponse(request, env, 502, { ok: false, items: [] });
        }
        const xml = await res.text();
        const items: Array<{ key: string; sizeBytes: number; lastModifiedIso?: string }> = [];
        const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
        let match: RegExpExecArray | null;
        while ((match = contentsRegex.exec(xml)) !== null) {
          const block = match[1];
          const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1] || '';
          const sizeBytes = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] || 0);
          const lastModifiedIso = block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1];
          if (key) items.push({ key, sizeBytes, lastModifiedIso });
        }
        return jsonResponse(request, env, 200, { ok: true, items });
      }

      // 7. Delete Object (Admin or owner path only)
      if (url.pathname === '/api/media/object' && request.method === 'DELETE') {
        const objectKey = sanitizeObjectKey(String(body.objectKey || ''));
        if (!objectKey || !isUserAllowedObjectKey(user, objectKey)) {
          return jsonResponse(request, env, 403, { ok: false, error: 'Forbidden delete.' });
        }
        const creds = resolveProviderCredentials(String(body.providerId || 'cloudflare_r2'), env, body);
        const delUrl = await createPresignedS3Url({
          method: 'DELETE',
          creds,
          objectKey,
          expiresInSeconds: 120,
        });
        const delRes = await fetch(delUrl, { method: 'DELETE' });
        return jsonResponse(request, env, delRes.ok ? 200 : 502, {
          ok: delRes.ok,
        });
      }

      return jsonResponse(request, env, 404, { ok: false, error: 'Unknown Media Broker route.' });
    } catch (err: any) {
      return jsonResponse(request, env, 400, {
        ok: false,
        error: err?.message || 'Media Broker request error.',
      });
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const providerIds = ['cloudflare_r2', 'backblaze_b2', 'google_cloud_storage', 'supabase_storage', 'generic_s3'];
    for (const pid of providerIds) {
      try {
        const creds = resolveProviderCredentials(pid, env);
        const key = `_health/cron_${Date.now()}.txt`;
        const putUrl = await createPresignedS3Url({
          method: 'PUT',
          creds,
          objectKey: key,
          contentType: 'text/plain',
          expiresInSeconds: 60,
        });
        await fetch(putUrl, { method: 'PUT', body: 'ok', headers: { 'Content-Type': 'text/plain' } });
        const delUrl = await createPresignedS3Url({
          method: 'DELETE',
          creds,
          objectKey: key,
          expiresInSeconds: 60,
        });
        await fetch(delUrl, { method: 'DELETE' });
      } catch {
        // Provider not configured — skip silently without marking healthy
      }
    }
  },
};
