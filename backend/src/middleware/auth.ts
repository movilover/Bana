import crypto from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { BackendConfig } from '../config.js';

export interface AuthenticatedPrincipal {
  uid: string;
  email?: string;
  emailVerified: boolean;
  adminRole?: string;
  provider: 'firebase' | 'supabase' | 'hmac_test';
}

declare global {
  namespace Express {
    interface Request {
      principal?: AuthenticatedPrincipal;
    }
  }
}

interface CertCache {
  certs: Record<string, string>;
  expiresAt: number;
}

let firebaseCertCache: CertCache = { certs: {}, expiresAt: 0 };

function base64UrlDecode(input: string): Buffer {
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

function parseJwtParts(token: string) {
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT structure.');
  const header = JSON.parse(base64UrlDecode(parts[0]).toString('utf8'));
  const payload = JSON.parse(base64UrlDecode(parts[1]).toString('utf8'));
  const signature = base64UrlDecode(parts[2]);
  return {
    header,
    payload,
    signingInput: `${parts[0]}.${parts[1]}`,
    signature,
  };
}

async function getFirebasePublicCerts(): Promise<Record<string, string>> {
  if (Date.now() < firebaseCertCache.expiresAt && Object.keys(firebaseCertCache.certs).length > 0) {
    return firebaseCertCache.certs;
  }
  const resp = await fetch(
    'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com'
  );
  if (!resp.ok) {
    throw new Error(`Failed to fetch Firebase public keys (${resp.status}).`);
  }
  const cacheControl = resp.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const maxAgeSec = maxAgeMatch ? Number(maxAgeMatch[1]) : 3600;
  const certs = (await resp.json()) as Record<string, string>;
  firebaseCertCache = {
    certs,
    expiresAt: Date.now() + Math.max(60, maxAgeSec) * 1000,
  };
  return certs;
}

export async function verifyBearerToken(
  token: string,
  config: BackendConfig
): Promise<AuthenticatedPrincipal> {
  if (!token || token.length < 20) {
    throw new Error('Missing or invalid bearer token.');
  }

  const { header, payload, signingInput, signature } = parseJwtParts(token);
  const nowSec = Math.floor(Date.now() / 1000);

  if (typeof payload.exp === 'number' && payload.exp <= nowSec) {
    throw new Error('Authentication token expired.');
  }
  if (typeof payload.nbf === 'number' && payload.nbf > nowSec + 30) {
    throw new Error('Authentication token not yet valid.');
  }

  // Non-Firebase (HS256) tokens must always carry an expiry so a leaked token cannot live forever.
  if (header.alg === 'HS256' && typeof payload.exp !== 'number') {
    throw new Error('Token is missing an expiry (exp) claim.');
  }

  // 1. Optional test HMAC HS256 verifier (active ONLY when BANA_TEST_AUTH_SECRET is configured AND NODE_ENV is not 'production')
  if (header.alg === 'HS256' && config.testAuthHmacSecret && config.nodeEnv !== 'production' && payload.iss === 'bana-test') {
    const expectedSig = crypto
      .createHmac('sha256', config.testAuthHmacSecret)
      .update(signingInput)
      .digest();
    if (signature.length !== expectedSig.length || !crypto.timingSafeEqual(signature, expectedSig)) {
      throw new Error('Invalid test token signature.');
    }
    const uid = String(payload.sub || payload.uid || '');
    if (!uid) throw new Error('Test token missing uid.');
    return {
      uid,
      email: payload.email ? String(payload.email) : undefined,
      emailVerified: Boolean(payload.email_verified),
      adminRole: payload.adminRole ? String(payload.adminRole) : undefined,
      provider: 'hmac_test',
    };
  }

  // 2. Supabase HS256 JWT verification
  if (header.alg === 'HS256' && config.supabaseJwtSecret) {
    const expectedSig = crypto
      .createHmac('sha256', config.supabaseJwtSecret)
      .update(signingInput)
      .digest();
    if (signature.length === expectedSig.length && crypto.timingSafeEqual(signature, expectedSig)) {
      const uid = String(payload.sub || '');
      if (!uid) throw new Error('Supabase token missing sub claim.');
      return {
        uid,
        email: payload.email ? String(payload.email) : undefined,
        emailVerified: true,
        // Explicit precedence: only a server-set app_metadata.adminRole string, or the service_role key, grants admin access.
        adminRole:
          typeof payload.app_metadata?.adminRole === 'string' && payload.app_metadata.adminRole
            ? String(payload.app_metadata.adminRole)
            : payload.role === 'service_role'
              ? 'admin'
              : undefined,
        provider: 'supabase',
      };
    }
  }

  // 3. Firebase Auth RS256 ID Token verification via Google public X509 certificates
  if (header.alg === 'RS256' && header.kid) {
    const certs = await getFirebasePublicCerts();
    const pem = certs[String(header.kid)];
    if (!pem) {
      throw new Error('Unknown Firebase signing key ID.');
    }
    const verifier = crypto.createVerify('RSA-SHA256');
    verifier.update(signingInput);
    const valid = verifier.verify(pem, signature);
    if (!valid) {
      throw new Error('Invalid Firebase ID token signature.');
    }
    const expectedIssuer = `https://securetoken.google.com/${config.firebaseProjectId}`;
    if (payload.aud !== config.firebaseProjectId || payload.iss !== expectedIssuer) {
      throw new Error('Firebase token project mismatch.');
    }
    const uid = String(payload.user_id || payload.sub || '');
    if (!uid) throw new Error('Firebase token missing subject.');
    const email = payload.email ? String(payload.email).toLowerCase() : undefined;
    const isSuper = Boolean(email && payload.email_verified && config.superAdminEmails.includes(email));
    return {
      uid,
      email,
      emailVerified: Boolean(payload.email_verified),
      adminRole: payload.adminRole ? String(payload.adminRole) : isSuper ? 'super_admin' : undefined,
      provider: 'firebase',
    };
  }

  throw new Error('Unsupported or unverified authentication token.');
}

export function createAuthMiddleware(config: BackendConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const header = req.headers.authorization || '';
      const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
      if (!token) {
        res.status(401).json({ error: 'Authorization Bearer token is required.' });
        return;
      }
      req.principal = await verifyBearerToken(token, config);
      next();
    } catch (err: any) {
      res.status(401).json({ error: err?.message || 'Unauthorized.' });
    }
  };
}

export function requireAdminRole(config: BackendConfig) {
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const isSuperEmail = Boolean(p.email && p.emailVerified && config.superAdminEmails.includes(p.email.toLowerCase()));
    const allowedRoles = new Set(['super_admin', 'admin', 'moderator', 'support_staff', 'finance_manager', 'ad_manager']);
    if (!isSuperEmail && (!p.adminRole || !allowedRoles.has(p.adminRole))) {
      res.status(403).json({ error: 'Administrator privileges required.' });
      return;
    }
    next();
  };
}

/**
 * Prompt 09: per-route privilege gate. `requireAdminRole` only proves "is some kind of staff";
 * routes that can reach provider secrets/connectivity, usage data or anything that may cost money
 * must additionally require a role that owns that capability (never decided by the frontend).
 */
export function requireAdminRoles(config: BackendConfig, allowedRoles: string[]) {
  const allowed = new Set(allowedRoles);
  return (req: Request, res: Response, next: NextFunction) => {
    const p = req.principal;
    if (!p) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    const isSuperEmail = Boolean(p.email && p.emailVerified && config.superAdminEmails.includes(p.email.toLowerCase()));
    if (isSuperEmail || (p.adminRole && allowed.has(p.adminRole))) {
      next();
      return;
    }
    // Structured, secret-free denial trail (uid + route only).
    console.warn(JSON.stringify({ event: 'admin_route_denied', uid: p.uid, role: p.adminRole || null, path: req.originalUrl.split('?')[0] }));
    res.status(403).json({ error: 'Your staff role is not permitted to use this service-management endpoint.' });
  };
}
