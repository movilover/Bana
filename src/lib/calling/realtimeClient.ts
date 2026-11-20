import { auth } from '@/src/firebase';
import { getBackendBaseUrl } from '@/src/lib/calling/callingProvider';

export type RealtimeFrameHandler = (frame: Record<string, any>) => void;

class BanaRealtimeSocketClient {
  private ws: WebSocket | null = null;
  private listeners = new Set<RealtimeFrameHandler>();
  private reconnectTimer: number | null = null;
  private pingTimer: number | null = null;
  private intentionalClose = false;
  private attempt = 0;

  isAvailable(): boolean {
    return Boolean(getBackendBaseUrl());
  }

  isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  subscribe(handler: RealtimeFrameHandler): () => void {
    this.listeners.add(handler);
    return () => {
      this.listeners.delete(handler);
    };
  }

  async connect(displayName?: string): Promise<boolean> {
    const baseUrl = getBackendBaseUrl();
    if (!baseUrl) return false;

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return true;
    }

    const token = await auth.currentUser?.getIdToken().catch(() => null);
    if (!token) return false;

    this.intentionalClose = false;
    const wsBase = baseUrl.replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
    const qs = new URLSearchParams({ token });
    if (displayName) qs.set('name', displayName);

    return new Promise((resolve) => {
      try {
        const socket = new WebSocket(`${wsBase}/ws?${qs.toString()}`);
        this.ws = socket;

        socket.onopen = () => {
          this.attempt = 0;
          if (this.pingTimer) window.clearInterval(this.pingTimer);
          this.pingTimer = window.setInterval(() => {
            this.send({ type: 'ping' });
          }, 20000);
          resolve(true);
        };

        socket.onmessage = (evt) => {
          try {
            const frame = JSON.parse(String(evt.data || '{}'));
            this.listeners.forEach((fn) => fn(frame));
          } catch {
            // Ignore malformed socket frames
          }
        };

        socket.onclose = () => {
          if (this.pingTimer) {
            window.clearInterval(this.pingTimer);
            this.pingTimer = null;
          }
          if (!this.intentionalClose) {
            const delay = Math.min(15000, 1000 * Math.pow(2, this.attempt));
            this.attempt += 1;
            this.reconnectTimer = window.setTimeout(() => {
              void this.connect(displayName);
            }, delay);
          }
        };

        socket.onerror = () => {
          resolve(false);
        };
      } catch {
        resolve(false);
      }
    });
  }

  send(frame: Record<string, unknown>): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(frame));
      return true;
    } catch {
      return false;
    }
  }

  disconnect() {
    this.intentionalClose = true;
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }
}

export const realtimeSocket = new BanaRealtimeSocketClient();
