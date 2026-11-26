import { Router } from 'express';
import type { BackendConfig } from '../config.js';
import type { BanaSignalingHub } from '../ws/signalingServer.js';
import type { UsageAndLogStore } from '../services/usageAndLogs.js';
import { isValidResourceId, sanitizeText } from '../middleware/validate.js';

export function createMessagesRouter(params: {
  config: BackendConfig;
  hub: BanaSignalingHub;
  store: UsageAndLogStore;
}) {
  const router = Router();
  const { config, hub, store } = params;

  router.post('/relay', async (req, res) => {
    const uid = req.principal!.uid;
    const body = req.body || {};
    const conversationId = String(body.conversationId || '');
    const recipientIds: string[] = Array.isArray(body.recipientIds) ? body.recipientIds.map(String) : [];
    const text = sanitizeText(body.text, 4000);
    const type = String(body.type || 'text');

    if (!isValidResourceId(conversationId)) {
      res.status(400).json({ error: 'Invalid conversationId.' });
      return;
    }

    let deliveredSockets = 0;
    recipientIds.forEach((rid) => {
      if (rid !== uid) {
        const pushed = hub.pushUserEvent(rid, {
          type: 'chat:message',
          conversationId,
          senderId: uid,
          messageType: type,
          preview: text.slice(0, 120),
          at: Date.now(),
        });
        if (pushed) deliveredSockets += 1;
      }
    });

    // Optional Supabase message mirror when service role configured
    let supabaseSynced = false;
    if (config.supabaseUrl && config.supabaseServiceRoleKey) {
      try {
        const resp = await fetch(`${config.supabaseUrl.replace(/\/$/, '')}/rest/v1/messages`, {
          method: 'POST',
          headers: {
            apikey: config.supabaseServiceRoleKey,
            Authorization: `Bearer ${config.supabaseServiceRoleKey}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({
            conversation_id: conversationId,
            sender_id: uid,
            type,
            text,
          }),
        });
        supabaseSynced = resp.ok;
      } catch {
        supabaseSynced = false;
      }
    }

    store.recordUsage({
      category: 'realtime_messaging',
      providerId: 'firestore_ws',
      operation: 'relay_message',
      ok: true,
    });

    res.json({
      relayed: true,
      deliveredSockets,
      supabaseSynced,
    });
  });

  return router;
}
