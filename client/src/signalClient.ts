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
    const sock = new WebSocket(opts.url, [`bearer.${opts.pairSecret}`]);
    ws = sock;

    sock.onopen = () => { retryCount = 0; };

    sock.onmessage = (event) => {
      try {
        emit(JSON.parse(event.data as string) as ServerMessage);
      } catch { /* malformed — ignore */ }
    };

    sock.onclose = (event) => {
      // Ignore close events from superseded sockets: if a reconnect already
      // created a newer WebSocket, this one's fate is irrelevant — reacting
      // to it would double-reconnect or surface a stale "replaced" error.
      if (closed || ws !== sock) return;
      // Auth failure is terminal — the pair secret is invalid, retrying
      // won't help.
      if (event.code === 4001) {
        emit({ type: 'error', code: 'unauthorized', message: event.reason });
        return;
      }
      // "Replaced" (4000) is also terminal, deliberately. It means another
      // live session holds this peer slot (same link open on a second
      // device or tab). Auto-reconnecting here starts a bump war: each
      // side reclaims the slot every few hundred ms, tearing down the
      // peer's RTC session on every cycle. Instead we stop and let the UI
      // show what happened; the user reclaims explicitly via Try Again.
      if (event.code === 4000) {
        emit({ type: 'error', code: 'replaced', message: event.reason });
        return;
      }
      const delay = BACKOFF_MS[Math.min(retryCount, BACKOFF_MS.length - 1)];
      retryCount++;
      retryTimer = setTimeout(connect, delay);
    };

    sock.onerror = () => { /* onclose handles reconnect */ };
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
