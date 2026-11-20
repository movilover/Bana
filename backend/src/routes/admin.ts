import { Router } from 'express';
import type { BackendConfig } from '../config.js';
import type { BanaSignalingHub } from '../ws/signalingServer.js';
import type { UsageAndLogStore } from '../services/usageAndLogs.js';
import { testProviderConnectivity } from '../services/providerAdapters.js';
import { requireAdminRoles } from '../middleware/auth.js';

export function createAdminRouter(params: {
  config: BackendConfig;
  hub: BanaSignalingHub;
  store: UsageAndLogStore;
}) {
  const router = Router();
  const { config, hub, store } = params;
  // Service/provider management is limited to roles holding `manage_api_providers`
  // (mirrors src/lib/adminRbac.ts). Moderators, support, finance and ad staff get 403 here.
  const requireProviderAdmin = requireAdminRoles(config, ['super_admin', 'admin']);

  router.get('/status', requireProviderAdmin, (_req, res) => {
    res.json({
      service: 'bana-realtime-backend',
      timestamp: new Date().toISOString(),
      wsStats: hub.getStats(),
      activeRooms: hub.listRooms(),
      envPresence: {
        turnConfigured: Boolean(config.turnUrls.length > 0 && config.turnSharedSecret),
        livekitConfigured: Boolean(config.livekitWsUrl && config.livekitApiKey && config.livekitApiSecret),
        agoraConfigured: Boolean(config.agoraAppId && config.agoraAppCertificate),
        hmsConfigured: Boolean(config.hmsAccessKey && config.hmsAppSecret),
        supabaseConfigured: Boolean(config.supabaseUrl && config.supabaseAnonKey),
        supabaseServiceRoleConfigured: Boolean(config.supabaseUrl && config.supabaseServiceRoleKey),
        mediaBrokerConfigured: Boolean(config.mediaBrokerUrl),
        webPushVapidConfigured: Boolean(config.vapidPublicKey && config.vapidPrivateKey),
      },
    });
  });

  router.post('/providers/test', requireProviderAdmin, async (req, res) => {
    const body = req.body || {};
    const category = String(body.category || '');
    const providerKey = String(body.providerKey || '');
    if (!category || !providerKey) {
      res.status(400).json({ error: 'category and providerKey are required.' });
      return;
    }

    const result = await testProviderConnectivity(
      {
        category,
        providerKey,
        endpointUrl: body.endpointUrl ? String(body.endpointUrl) : undefined,
        // SECURITY: approval is decided by server env (APPROVED_PAID_PROVIDERS), not by the request body.
        billingApprovedByAdmin: config.approvedPaidProviders.includes(providerKey.toLowerCase()),
        requiresBillingApproval: Boolean(body.requiresBillingApproval),
      },
      config
    );

    store.recordUsage({
      category,
      providerId: providerKey,
      operation: 'test_connection',
      ok: result.connectionStatus === 'connected',
    });

    if (result.connectionStatus === 'error') {
      store.recordError(
        {
          category,
          providerId: providerKey,
          severity: 'error',
          message: result.message,
          endpoint: '/api/admin/providers/test',
          actorUid: req.principal?.uid,
        },
        config
      );
    }

    res.json(result);
  });

  router.get('/usage', requireProviderAdmin, (_req, res) => {
    res.json({
      usage: store.getUsageSummary(),
      errors: store.getRecentErrors(50),
    });
  });

  return router;
}
