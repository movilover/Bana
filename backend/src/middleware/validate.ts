import type { Request, Response, NextFunction } from 'express';

const BLOCKED_FILE_EXT = /\.(exe|bat|cmd|sh|ps1|msi|dll|js|mjs|vbs|scr|php|py|rb)$/i;
const SAFE_ID_PATTERN = /^[a-zA-Z0-9_\-:.]{1,128}$/;

export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), display-capture=(self)');
  next();
}

export function isValidResourceId(id: unknown): id is string {
  return typeof id === 'string' && SAFE_ID_PATTERN.test(id);
}

export function validateUploadMetadata(fileName: string, mimeType: string, sizeBytes: number): string | null {
  if (!fileName || fileName.length > 220) {
    return 'File name is missing or exceeds 220 characters.';
  }
  if (BLOCKED_FILE_EXT.test(fileName)) {
    return 'Executable or script file types are blocked for security.';
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0 || sizeBytes > 250 * 1024 * 1024) {
    return 'File size must be between 1 byte and 250 MB.';
  }
  if (mimeType && !/^[a-z0-9.+/-]+$/i.test(mimeType)) {
    return 'Invalid MIME content type.';
  }
  return null;
}

export function sanitizeText(value: unknown, maxLen = 4000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\0/g, '').trim().slice(0, maxLen);
}
