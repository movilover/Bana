import type { IncomingMessage } from 'node:http';
import type { Server as HttpServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import type { BackendConfig } from '../config.js';
import { verifyBearerToken } from '../middleware/auth.js';

export interface RoomParticipantState {
  uid: string;
  displayName: string;
  micMuted: boolean;
  camOff: boolean;
  screenSharing: boolean;
  speaking: boolean;
  role: 'host' | 'participant';
}

export interface RoomRecord {
  roomId: string;
  conversationId: string;
  hostUid: string;
  callType: 'audio' | 'video';
  maxParticipants: number;
  participants: Map<string, RoomParticipantState>;
  createdAt: string;
}

interface AuthedSocket extends WebSocket {
  uid?: string;
  displayName?: string;
  roomId?: string;
  isAlive?: boolean;
}

export class BanaSignalingHub {
  private wss: WebSocketServer;
  private rooms = new Map<string, RoomRecord>();
  private userSockets = new Map<string, Set<AuthedSocket>>();
  private heartbeatTimer: NodeJS.Timeout;

  constructor(server: HttpServer, config: BackendConfig) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', async (req: IncomingMessage, socket, head) => {
      try {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        if (url.pathname !== '/ws') {
          socket.destroy();
          return;
        }

        const token =
          url.searchParams.get('token') ||
          (req.headers.authorization?.startsWith('Bearer ')
            ? req.headers.authorization.slice(7).trim()
            : '');

        if (!token) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }

        const principal = await verifyBearerToken(token, config);
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          const client = ws as AuthedSocket;
          client.uid = principal.uid;
          client.displayName = url.searchParams.get('name') || principal.email || principal.uid;
          client.isAlive = true;
          this.wss.emit('connection', client, req);
        });
      } catch {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      }
    });

    this.wss.on('connection', (ws: AuthedSocket) => {
      const uid = ws.uid!;
      if (!this.userSockets.has(uid)) {
        this.userSockets.set(uid, new Set());
      }
      this.userSockets.get(uid)!.add(ws);

      this.sendJson(ws, {
        type: 'connected',
        uid,
        serverTime: Date.now(),
      });

      this.broadcastPresence(uid, true);

      ws.on('pong', () => {
        ws.isAlive = true;
      });

      ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(String(raw || '{}'));
          this.handleMessage(ws, msg);
        } catch {
          this.sendJson(ws, { type: 'error', message: 'Invalid JSON frame.' });
        }
      });

      ws.on('close', () => {
        const set = this.userSockets.get(uid);
        if (set) {
          set.delete(ws);
          if (set.size === 0) {
            this.userSockets.delete(uid);
            this.broadcastPresence(uid, false);
          }
        }
        if (ws.roomId) {
          this.leaveRoom(ws, ws.roomId);
        }
      });
    });

    this.heartbeatTimer = setInterval(() => {
      for (const client of this.wss.clients as Set<AuthedSocket>) {
        if (client.isAlive === false) {
          client.terminate();
          continue;
        }
        client.isAlive = false;
        client.ping();
      }
    }, 25000);
  }

  close() {
    clearInterval(this.heartbeatTimer);
    this.wss.close();
  }

  getStats() {
    return {
      onlineUsers: this.userSockets.size,
      activeRooms: this.rooms.size,
      socketConnections: this.wss.clients.size,
    };
  }

  getRoomSnapshot(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    return {
      roomId: room.roomId,
      conversationId: room.conversationId,
      hostUid: room.hostUid,
      callType: room.callType,
      maxParticipants: room.maxParticipants,
      participants: Array.from(room.participants.values()),
      createdAt: room.createdAt,
    };
  }

  listRooms() {
    return Array.from(this.rooms.keys()).map((id) => this.getRoomSnapshot(id));
  }

  ensureRoom(params: {
    roomId: string;
    conversationId: string;
    hostUid: string;
    callType?: 'audio' | 'video';
    maxParticipants?: number;
  }) {
    let room = this.rooms.get(params.roomId);
    if (!room) {
      room = {
        roomId: params.roomId,
        conversationId: params.conversationId,
        hostUid: params.hostUid,
        callType: params.callType || 'video',
        maxParticipants: Math.max(2, Math.min(50, params.maxParticipants || 8)),
        participants: new Map(),
        createdAt: new Date().toISOString(),
      };
      this.rooms.set(params.roomId, room);
    }
    return room;
  }

  pushUserEvent(targetUid: string, payload: Record<string, unknown>) {
    const sockets = this.userSockets.get(targetUid);
    if (!sockets) return false;
    sockets.forEach((s) => this.sendJson(s, payload));
    return sockets.size > 0;
  }

  private sendJson(ws: WebSocket, data: Record<string, unknown>) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(data));
    }
  }

  private broadcastPresence(uid: string, online: boolean) {
    const frame = JSON.stringify({
      type: 'chat:presence',
      uid,
      online,
      at: Date.now(),
    });
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(frame);
      }
    }
  }

  private broadcastToRoom(roomId: string, payload: Record<string, unknown>, excludeUid?: string) {
    const room = this.rooms.get(roomId);
    if (!room) return;
    for (const uid of room.participants.keys()) {
      if (excludeUid && uid === excludeUid) continue;
      this.pushUserEvent(uid, payload);
    }
  }

  private leaveRoom(ws: AuthedSocket, roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room || !ws.uid) return;
    room.participants.delete(ws.uid);
    ws.roomId = undefined;
    this.broadcastToRoom(roomId, {
      type: 'room:participant_left',
      roomId,
      uid: ws.uid,
      participants: Array.from(room.participants.values()),
    });
    if (room.participants.size === 0) {
      this.rooms.delete(roomId);
    }
  }

  private handleMessage(ws: AuthedSocket, msg: any) {
    const uid = ws.uid!;
    const kind = String(msg?.type || '');

    if (kind === 'ping') {
      this.sendJson(ws, { type: 'pong', ts: Date.now() });
      return;
    }

    if (kind === 'room:join') {
      const roomId = String(msg.roomId || '').trim();
      const conversationId = String(msg.conversationId || roomId).trim();
      if (!roomId) {
        this.sendJson(ws, { type: 'error', message: 'roomId is required.' });
        return;
      }
      const room = this.ensureRoom({
        roomId,
        conversationId,
        hostUid: String(msg.hostUid || uid),
        callType: msg.callType === 'audio' ? 'audio' : 'video',
        maxParticipants: Number(msg.maxParticipants || 8),
      });

      if (!room.participants.has(uid) && room.participants.size >= room.maxParticipants) {
        this.sendJson(ws, {
          type: 'room:full',
          roomId,
          maxParticipants: room.maxParticipants,
        });
        return;
      }

      ws.roomId = roomId;
      room.participants.set(uid, {
        uid,
        displayName: String(msg.displayName || ws.displayName || uid),
        micMuted: Boolean(msg.micMuted),
        camOff: Boolean(msg.camOff),
        screenSharing: Boolean(msg.screenSharing),
        speaking: false,
        role: room.hostUid === uid ? 'host' : 'participant',
      });

      this.sendJson(ws, {
        type: 'room:state',
        roomId,
        hostUid: room.hostUid,
        maxParticipants: room.maxParticipants,
        participants: Array.from(room.participants.values()),
      });

      this.broadcastToRoom(
        roomId,
        {
          type: 'room:participant_joined',
          roomId,
          uid,
          participants: Array.from(room.participants.values()),
        },
        uid
      );
      return;
    }

    if (kind === 'room:leave') {
      const roomId = String(msg.roomId || ws.roomId || '');
      if (roomId) this.leaveRoom(ws, roomId);
      return;
    }

    if (kind === 'signal:offer' || kind === 'signal:answer' || kind === 'signal:ice') {
      const toUid = String(msg.toUid || '');
      const roomId = String(msg.roomId || ws.roomId || '');
      if (!toUid) return;
      this.pushUserEvent(toUid, {
        type: kind,
        roomId,
        fromUid: uid,
        sdp: msg.sdp,
        candidate: msg.candidate,
      });
      return;
    }

    if (kind === 'room:media_state' || kind === 'screen:toggle' || kind === 'speaker:level') {
      const roomId = String(msg.roomId || ws.roomId || '');
      const room = this.rooms.get(roomId);
      if (!room) return;
      const p = room.participants.get(uid);
      if (p) {
        if (typeof msg.micMuted === 'boolean') p.micMuted = msg.micMuted;
        if (typeof msg.camOff === 'boolean') p.camOff = msg.camOff;
        if (typeof msg.screenSharing === 'boolean') p.screenSharing = msg.screenSharing;
        if (typeof msg.speaking === 'boolean') p.speaking = msg.speaking;
      }
      this.broadcastToRoom(roomId, {
        type: 'room:participants_updated',
        roomId,
        participants: Array.from(room.participants.values()),
      });
      return;
    }

    if (kind === 'participant:mute' || kind === 'participant:kick' || kind === 'room:end') {
      const roomId = String(msg.roomId || ws.roomId || '');
      const room = this.rooms.get(roomId);
      if (!room || room.hostUid !== uid) {
        this.sendJson(ws, { type: 'error', message: 'Only room host can moderate participants.' });
        return;
      }

      if (kind === 'room:end') {
        this.broadcastToRoom(roomId, { type: 'room:ended', roomId, endedBy: uid });
        this.rooms.delete(roomId);
        return;
      }

      const targetUid = String(msg.targetUid || '');
      if (!targetUid) return;

      if (kind === 'participant:mute') {
        const target = room.participants.get(targetUid);
        if (target) target.micMuted = true;
        this.pushUserEvent(targetUid, { type: 'room:force_muted', roomId, byUid: uid });
        this.broadcastToRoom(roomId, {
          type: 'room:participants_updated',
          roomId,
          participants: Array.from(room.participants.values()),
        });
      } else if (kind === 'participant:kick') {
        room.participants.delete(targetUid);
        this.pushUserEvent(targetUid, { type: 'room:kicked', roomId, byUid: uid });
        this.broadcastToRoom(roomId, {
          type: 'room:participants_updated',
          roomId,
          participants: Array.from(room.participants.values()),
        });
      }
      return;
    }

    if (kind === 'chat:typing' || kind === 'chat:delivered' || kind === 'chat:read') {
      const targetUids: string[] = Array.isArray(msg.targetUids) ? msg.targetUids.map(String) : [];
      targetUids.forEach((target: string) => {
        if (target && target !== uid) {
          this.pushUserEvent(target, {
            type: kind,
            conversationId: msg.conversationId,
            messageId: msg.messageId,
            fromUid: uid,
            typing: msg.typing,
            at: Date.now(),
          });
        }
      });
    }
  }
}
