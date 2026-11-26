/**
 * Pure Web Crypto AWS Signature V4 helper usable in Cloudflare Workers,
 * modern browsers (for admin/test harnesses), and Node.js 20+.
 */

const encoder = new TextEncoder();

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

async function hmacSha256(key: ArrayBuffer | Uint8Array, message: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    key instanceof Uint8Array ? (key.buffer as ArrayBuffer) : key,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
}

async function getSigningKey(secretKey: string, dateStamp: string, region: string, service = 's3') {
  const kDate = await hmacSha256(encoder.encode(`AWS4${secretKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  return hmacSha256(kService, 'aws4_request');
}

function encodeRfc3986(str: string): string {
  return encodeURIComponent(str).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function formatAmzDate(date: Date): { amzDate: string; dateStamp: string } {
  const iso = date.toISOString().replace(/[:-]|\.\d{3}/g, '');
  return {
    amzDate: iso,
    dateStamp: iso.slice(0, 8),
  };
}

export interface S3PresignParams {
  method: 'GET' | 'PUT' | 'HEAD' | 'DELETE';
  endpoint: string;
  bucket: string;
  objectKey: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  expiresInSeconds?: number;
  contentType?: string;
  pathStyle?: boolean;
}

export async function createPresignedS3Url(params: S3PresignParams): Promise<string> {
  const now = new Date();
  const { amzDate, dateStamp } = formatAmzDate(now);
  const expires = Math.max(60, Math.min(604800, params.expiresInSeconds || 900));
  const cleanEndpoint = params.endpoint.replace(/\/+$/, '');
  const endpointUrl = new URL(cleanEndpoint);
  const cleanKey = params.objectKey.replace(/^\/+/, '');
  const encodedKey = cleanKey.split('/').map(encodeRfc3986).join('/');

  const usePathStyle = params.pathStyle !== false;
  const host = usePathStyle ? endpointUrl.host : `${params.bucket}.${endpointUrl.host}`;
  const canonicalUri = usePathStyle ? `/${encodeRfc3986(params.bucket)}/${encodedKey}` : `/${encodedKey}`;

  const credentialScope = `${dateStamp}/${params.region}/s3/aws4_request`;
  const signedHeadersList = ['host'];
  let canonicalHeaders = `host:${host}\n`;
  if (params.contentType && params.method === 'PUT') {
    signedHeadersList.unshift('content-type');
    canonicalHeaders = `content-type:${params.contentType}\nhost:${host}\n`;
  }
  const signedHeaders = signedHeadersList.sort().join(';');

  const queryParams: [string, string][] = [
    ['X-Amz-Algorithm', 'AWS4-HMAC-SHA256'],
    ['X-Amz-Credential', `${params.accessKeyId}/${credentialScope}`],
    ['X-Amz-Date', amzDate],
    ['X-Amz-Expires', String(expires)],
    ['X-Amz-SignedHeaders', signedHeaders],
  ];
  queryParams.sort((a, b) => a[0].localeCompare(b[0]));
  const canonicalQuery = queryParams.map(([k, v]) => `${encodeRfc3986(k)}=${encodeRfc3986(v)}`).join('&');

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

  const signingKey = await getSigningKey(params.secretAccessKey, dateStamp, params.region, 's3');
  const signature = toHex(await hmacSha256(signingKey, stringToSign));

  const protocol = endpointUrl.protocol;
  return `${protocol}//${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}
