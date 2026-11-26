import { Router } from 'express';
import type { BackendConfig } from '../config.js';
import type { BanaSignalingHub } from '../ws/signalingServer.js';
import type { UsageAndLogStore } from '../services/usageAndLogs.js';
import { isValidResourceId, sanitizeText } from '../middleware/validate.js';

export function createNotificationsRouter(params: {
  config: BackendConfig;
  hub: BanaSignalingHub;
  store: UsageAndLogStore;
}) {
  const router = Router();
  const { config, hub, store } = params;

  router.post('/dispatch', async (req, res) => {
    const uid = req.principal!.uid;
    const body = req.body || {};
    const recipientId = String(body.recipientId || '');
    const title = sanitizeText(body.title, 160);
    const message = sanitizeText(body.body, 400);
    const type = sanitizeText(body.type || 'message', 40);
    const linkUrl = sanitizeText(body.linkUrl || '/notifications', 200);

    if (!isValidResourceId(recipientId) || !title) {
      res.status(400).json({ error: 'recipientId and title are required.' });
      return;
    }

    const socketDelivered = hub.pushUserEvent(recipientId, {
      type: 'notification:new',
      actorId: uid,
      notificationType: type,
      title,
      body: message,
      linkUrl,
      at: Date.now(),
    });

    let supabaseInserted = false;
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      try {
        const resp = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/notifications`, {
          method: 'POST',
          headers: {
            apikey: config.supabaseServiceRoleKey,
            Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            recipient_id: recipientId,
            actor_id: uid,
            type,
            title,
            body: message,
            link_url: linkUrl,
          }),
        });
        supabaseInserted = resp.ok;
      } catch {
        supabaseInserted = false;
      }
    }

    store.recordUsage({
      category: 'push_notifications',
      providerId: 'inapp_browser',
      operation: 'dispatch',
      ok: true,
    });

    res.json({
      dispatched: true,
      socketDelivered,
      supabaseInserted,
    });
  });

  return router;
}
