import type { ClientMessage, ServerMessage } from './types.js';

export interface SignalClient {
  onMessage(fn: (msg: ServerMessage) => void): void;
  send(msg: ClientMessage): void;
  close(): void;
}

const BACKOFF_MS = [250, 500, 1000, 2000, 4000];

export function connectSignal(opts: { url: string; pairSecret: string }): SignalClient {
  let ws: WebSocket | null = null;
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const listeners: Array<(msg: ServerMessage) => void> = [];

  function emit(msg: ServerMessage): void {
    for (const fn of listeners) fn(msg);
  }

  function connect(): void {
    ws = new WebSocket(opts.url, [`bearer.${opts.pairSecret}`]);

    ws.onopen = () => { retryCount = 0; };

    ws.onmessage = (event) => {
      try {
        emit(JSON.parse(event.data as string) as ServerMessage);
      } catch { /* malformed — ignore */ }
    };

    ws.onclose = (event) => {
      if (closed) return;
      // Server-issued auth/replace closes are terminal — don't reconnect
      if (event.code === 4001) {
        emit({ type: 'error', code: 'unauthorized', message: event.reason });
        return;
      }
      if (event.code === 4000) {
        emit({ type: 'error', code: 'replaced', message: event.reason });
        return;
      }
      const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
      retryCount++;
      retryTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => { /* onclose handles reconnect */ };
  }

  connect();

  return {
    onMessage(fn) { listeners.push(fn); },
    send(msg) {
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
      }
    },
    close() {
      closed = true;
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      ws?.close(1000, 'client-close');
    },
  };
}
