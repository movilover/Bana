import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { pathToFileURL } from 'node:url';
import { loadBackendConfig, type BackendConfig } from './config.js';
import { createAuthMiddleware, requireAdminRole } from './middleware/auth.js';
import { createRateLimiter } from './middleware/rateLimit.js';
import { securityHeadersMiddleware } from './middleware/validate.js';
import { UsageAndLogStore } from './services/usageAndLogs.js';
import { BanaSignalingHub } from './ws/signalingServer.js';
import { createCallingRouter } from './routes/calling.js';
import { createMessagesRouter } from './routes/messages.js';
import { createNotificationsRouter } from './routes/notifications.js';
import { createUploadsRouter } from './routes/uploads.js';
import { createAdminRouter } from './routes/admin.js';

export function createBanaBackendServer(overrides?: Partial<BackendConfig>) {
  const config = loadBackendConfig(overrides);
  const app = express();
  const server = http.createServer(app);
  const store = new UsageAndLogStore();
  const hub = new BanaSignalingHub(server, config);

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(securityHeadersMiddleware);
  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) {
          callback(null, true);
          return;
        }
        if (config.corsAllowedOrigins.includes('*') || config.corsAllowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`CORS origin blocked: ${origin}`));
      },
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));

  const globalLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: Number(process.env.RATE_LIMIT_MAX_PER_MIN || 120),
    keyPrefix: 'global',
  });
  const tokenLimiter = createRateLimiter({
    windowMs: 60_000,
    maxRequests: Number(process.env.TOKEN_RATE_LIMIT_PER_MIN || 30),
    keyPrefix: 'calling_token',
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      service: 'bana-realtime-backend',
      uptimeSec: Math.round(process.uptime()),
      wsStats: hub.getStats(),
      timestamp: new Date().toISOString(),
    });
  });

  const requireAuth = createAuthMiddleware(config);
  const requireAdmin = requireAdminRole(config);

  app.use('/api/calling', requireAuth, tokenLimiter, createCallingRouter({ config, hub, store }));
  app.use('/api/messages', requireAuth, globalLimiter, createMessagesRouter({ config, hub, store }));
  app.use('/api/notifications', requireAuth, globalLimiter, createNotificationsRouter({ config, hub, store }));
  app.use('/api/uploads', requireAuth, globalLimiter, createUploadsRouter({ config, store }));
  app.use('/api/admin', requireAuth, requireAdmin, globalLimiter, createAdminRouter({ config, hub, store }));

  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err?.status || 500).json({
      error: err?.message || 'Internal server error',
    });
  });

  return { app, server, hub, store, config };
}

const isDirectEntry =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectEntry) {
  const { server, config } = createBanaBackendServer();
  server.listen(config.port, '0.0.0.0', () => {
    console.log(`BANA realtime backend listening on port ${config.port}`);
  });
}
