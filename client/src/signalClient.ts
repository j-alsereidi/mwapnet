import type { SignalEnvelope } from './types.js';

export type SignalState = 'connecting' | 'open' | 'closing' | 'closed' | 'reconnecting';

export interface SignalClient {
  onMessage(fn: (msg: SignalEnvelope) => void): void;
  send(msg: SignalEnvelope): void;
  close(): void;
  readonly state: SignalState;
}

const BACKOFF = [250, 500, 1000, 2000, 4000];

export function connectSignal(opts: { url: string; pairSecret: string }): SignalClient {
  let ws: WebSocket | null = null;
  let currentState: SignalState = 'connecting';
  let retryCount = 0;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;
  const listeners: Array<(msg: SignalEnvelope) => void> = [];

  function connect() {
    ws = new WebSocket(opts.url, [`bearer.${opts.pairSecret}`]);
    currentState = 'connecting';

    ws.onopen = () => {
      currentState = 'open';
      retryCount = 0;
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as SignalEnvelope;
        for (const fn of listeners) fn(msg);
      } catch {
        // ignore malformed server messages
      }
    };

    ws.onclose = (event) => {
      if (closed) { currentState = 'closed'; return; }

      // Auth failure or replaced — do not retry
      if (event.code === 4001) {
        currentState = 'closed';
        const errMsg: SignalEnvelope = { type: 'error', code: 'unauthorized', message: event.reason };
        for (const fn of listeners) fn(errMsg);
        return;
      }
      if (event.code === 4000) {
        currentState = 'closed';
        const errMsg: SignalEnvelope = { type: 'error', code: 'replaced', message: event.reason };
        for (const fn of listeners) fn(errMsg);
        return;
      }

      currentState = 'reconnecting';
      const delay = BACKOFF[Math.min(retryCount, BACKOFF.length - 1)];
      retryCount++;
      retryTimer = setTimeout(connect, delay);
    };

    ws.onerror = () => {
      // Always followed by onclose; let that handler drive reconnect
    };
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
      currentState = 'closing';
      if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
      ws?.close(1000, 'client-close');
    },
    get state() { return currentState; },
  };
}
