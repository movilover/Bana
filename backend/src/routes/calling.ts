import { Router } from 'express';
import type { BackendConfig } from '../config.js';
import type { BanaSignalingHub } from '../ws/signalingServer.js';
import type { UsageAndLogStore } from '../services/usageAndLogs.js';
import { mintCallingSessionCredentials, buildIceServersForUser, type SupportedCallingProvider } from '../services/tokenService.js';
import { isValidResourceId } from '../middleware/validate.js';

export function createCallingRouter(params: {
  config: BackendConfig;
  hub: BanaSignalingHub;
  store: UsageAndLogStore;
}) {
  const router = Router();
  const { config, hub, store } = params;

  router.get('/ice-servers', (req, res) => {
    const uid = req.principal!.uid;
    const ice = buildIceServersForUser(uid, config);
    store.recordUsage({
      category: 'voice_video_calling',
      providerId: 'webrtc_builtin',
      operation: 'ice_servers',
      ok: true,
    });
    res.json(ice);
  });

  router.post('/token', (req, res) => {
    const uid = req.principal!.uid;
    const body = req.body || {};
    const providerId = String(body.providerId || 'webrtc_builtin') as SupportedCallingProvider;
    const roomName = String(body.roomName || '').trim();
    const displayName = String(body.displayName || req.principal?.email || uid).slice(0, 80);

    if (!isValidResourceId(roomName)) {
      res.status(400).json({ error: 'Valid roomName is required (1-128 safe characters).' });
      return;
    }

    const result = mintCallingSessionCredentials(
      {
        providerId,
        roomName,
        uid,
        displayName,
        canPublish: body.canPublish !== false,
        canSubscribe: body.canSubscribe !== false,
        ttlSeconds: Number(body.ttlSeconds || 3600),
        // SECURITY: paid-provider approval comes from server config only. A client-supplied flag is ignored.
        billingApprovedByAdmin: config.approvedPaidProviders.includes(String(providerId).toLowerCase()),
      },
      config
    );

    if (!result.configured) {
      store.recordUsage({
        category: 'voice_video_calling',
        providerId,
        operation: 'mint_token',
        ok: false,
      });
      store.recordError(
        {
          category: 'voice_video_calling',
          providerId,
          severity: result.requiresBillingApproval ? 'warning' : 'error',
          message: result.message || 'Calling provider not configured.',
          endpoint: '/api/calling/token',
          actorUid: uid,
        },
        config
      );
      res.status(result.requiresBillingApproval && !config.approvedPaidProviders.includes(String(providerId).toLowerCase()) ? 403 : 400).json(result);
      return;
    }

    store.recordUsage({
      category: 'voice_video_calling',
      providerId,
      operation: 'mint_token',
      ok: true,
    });
    res.json(result);
  });

  router.post('/rooms', (req, res) => {
    const uid = req.principal!.uid;
    const body = req.body || {};
    const roomId = String(body.roomId || `room_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const conversationId = String(body.conversationId || '');
    if (!isValidResourceId(roomId) || !isValidResourceId(conversationId)) {
      res.status(400).json({ error: 'Valid roomId and conversationId are required.' });
      return;
    }
    const maxParticipants = Math.max(2, Math.min(50, Number(body.maxParticipants || 8)));
    const room = hub.ensureRoom({
      roomId,
      conversationId,
      hostUid: uid,
      callType: body.callType === 'audio' ? 'audio' : 'video',
      maxParticipants,
    });
    store.recordUsage({
      category: 'group_calling',
      providerId: String(body.providerId || 'webrtc_builtin'),
      operation: 'create_room',
      ok: true,
    });
    res.status(201).json({
      roomId: room.roomId,
      conversationId: room.conversationId,
      hostUid: room.hostUid,
      callType: room.callType,
      maxParticipants: room.maxParticipants,
      createdAt: room.createdAt,
    });
  });

  router.get('/rooms/:roomId', (req, res) => {
    const snap = hub.getRoomSnapshot(req.params.roomId);
    if (!snap) {
      res.status(404).json({ error: 'Active group call room not found.' });
      return;
    }
    res.json(snap);
  });

  return router;
}
