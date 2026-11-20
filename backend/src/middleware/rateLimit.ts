import type { Request, Response, NextFunction } from 'express';

interface Bucket {
  timestamps: number[];
}

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}) {
  const store = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const uid = req.principal?.uid;
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const key = `${options.keyPrefix}:${uid || ip}`;

    const entry = store.get(key) || { timestamps: [] };
    entry.timestamps = entry.timestamps.filter((ts) => now - ts < options.windowMs);

    if (entry.timestamps.length >= options.maxRequests) {
      const oldest = entry.timestamps[0] || now;
      const retryAfterSec = Math.max(1, Math.ceil((options.windowMs - (now - oldest)) / 1000));
      res.setHeader('Retry-After', String(retryAfterSec));
      res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
      res.setHeader('X-RateLimit-Remaining', '0');
      res.status(429).json({
        error: 'Rate limit exceeded. Please wait before retrying.',
        retryAfterSeconds: retryAfterSec,
      });
      return;
    }

    entry.timestamps.push(now);
    store.set(key, entry);

    // Opportunistic prune so memory remains bounded
    if (store.size > 5000) {
      for (const [k, b] of store.entries()) {
        if (b.timestamps.length === 0 || now - b.timestamps[b.timestamps.length - 1] > options.windowMs) {
          store.delete(k);
        }
      }
    }

    res.setHeader('X-RateLimit-Limit', String(options.maxRequests));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, options.maxRequests - entry.timestamps.length)));
    next();
  };
}
