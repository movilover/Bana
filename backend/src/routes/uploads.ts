import { Router } from 'express';
import type { BackendConfig } from '../config.js';
import type { UsageAndLogStore } from '../services/usageAndLogs.js';
import { validateUploadMetadata } from '../middleware/validate.js';

export function createUploadsRouter(params: {
  config: BackendConfig;
  store: UsageAndLogStore;
}) {
  const router = Router();
  const { config, store } = params;

  router.post('/validate', (req, res) => {
    const body = req.body || {};
    const fileName = String(body.fileName || '');
    const mimeType = String(body.mimeType || '');
    const sizeBytes = Number(body.sizeBytes || 0);

    const errMsg = validateUploadMetadata(fileName, mimeType, sizeBytes);
    if (errMsg) {
      store.recordUsage({
        category: 'file_media_storage',
        providerId: 'cloudflare_r2',
        operation: 'validate_upload',
        ok: false,
      });
      res.status(400).json({ valid: false, error: errMsg });
      return;
    }

    store.recordUsage({
      category: 'file_media_storage',
      providerId: 'cloudflare_r2',
      operation: 'validate_upload',
      ok: true,
    });

    res.json({
      valid: true,
      mediaBrokerUrl: config.mediaBrokerUrl || null,
      supabaseStorageConfigured: Boolean(config.supabaseUrl && config.supabaseStorageBucket),
    });
  });

  return router;
}
