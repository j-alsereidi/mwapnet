import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { identifyPeer, type PeerId } from './auth.js';
import { attach, detach, otherSocket, isPeerPresent } from './pairState.js';
import { parse } from './envelope.js';

const HEARTBEAT_INTERVAL_MS = 20_000;
const HEARTBEAT_TIMEOUT_MS = 45_000;
const RATE_LIMIT_MAX_PER_SEC = 100;

interface PeerMeta {
  peerId: PeerId;
  lastPongAt: number;
}

interface TokenBucket {
  count: number;
  resetAt: number;
}

const buckets = new WeakMap<WebSocket, TokenBucket>();

function checkMsgRate(ws: WebSocket): boolean {
  const now = Date.now();
  let b = buckets.get(ws);
  if (!b || now > b.resetAt) {
    buckets.set(ws, { count: 1, resetAt: now + 1_000 });
    return true;
  }
  if (b.count >= RATE_LIMIT_MAX_PER_SEC) return false;
  b.count++;
  return true;
}

function sendJson(ws: WebSocket, msg: unknown): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function extractBearer(protocols: string): string | null {
  for (const p of protocols.split(',').map(s => s.trim())) {
    if (p.startsWith('bearer.')) return p.slice(7);
  }
  return null;
}

// Auth rate limiter: 5 attempts/min per IP, then blocked 5 min
const authRateMap = new Map<string, { count: number; blockedUntil: number }>();

function checkAuthRate(ip: string): boolean {
  const now = Date.now();
  const e = authRateMap.get(ip);
  if (!e) { authRateMap.set(ip, { count: 1, blockedUntil: 0 }); return true; }
  if (now < e.blockedUntil) return false;
  if (e.count >= 5) { e.blockedUntil = now + 5 * 60_000; e.count = 0; return false; }
  e.count++;
  return true;
}

export function mountSignal(server: Server): void {
  const wss = new WebSocketServer({
    server,
    path: '/signal',
    // Echo the bearer subprotocol back so browsers accept the upgrade
    handleProtocols: (protocols: Set<string>) => {
      for (const p of protocols) {
        if (p.startsWith('bearer.')) return p;
      }
      return false;
    },
  });

  // Heartbeat: ping every 20s, terminate if no pong within 45s
  const heartbeatInterval = setInterval(() => {
    for (const ws of wss.clients) {
      const meta = (ws as WebSocket & { __duo?: PeerMeta }).__duo;
      if (!meta) continue;
      if (Date.now() - meta.lastPongAt > HEARTBEAT_TIMEOUT_MS) {
        ws.terminate();
        continue;
      }
      ws.ping();
    }
  }, HEARTBEAT_INTERVAL_MS);

  wss.on('close', () => clearInterval(heartbeatInterval));

  wss.on('connection', (ws: WebSocket & { __duo?: PeerMeta }, req) => {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';

    if (!checkAuthRate(ip)) {
      sendJson(ws, { type: 'error', code: 'rate-limited', message: 'Too many connection attempts.' });
      ws.close(1008, 'rate-limited');
      return;
    }

    const rawProtocols = req.headers['sec-websocket-protocol'] ?? '';
    const secret = extractBearer(rawProtocols);
    if (!secret) {
      sendJson(ws, { type: 'error', code: 'unauthorized', message: 'Missing pair secret.' });
      ws.close(4001, 'unauthorized');
      return;
    }

    const peerId = identifyPeer(secret);
    if (!peerId) {
      sendJson(ws, { type: 'error', code: 'unauthorized', message: 'Invalid pair secret.' });
      ws.close(4001, 'unauthorized');
      return;
    }

    // Successful auth resets the rate limit counter for this IP
    authRateMap.delete(ip);

    ws.__duo = { peerId, lastPongAt: Date.now() };
    attach(peerId, ws);

    const peerPresent = isPeerPresent(peerId === 'A' ? 'B' : 'A');
    console.log(`[signal] ${peerId} connected from ${ip} (peerPresent=${peerPresent})`);
    sendJson(ws, { type: 'hello', you: peerId, peerPresent, serverTime: Date.now() });

    if (peerPresent) {
      // New arrival learns peer is here via hello.peerPresent; also send peer-joined for symmetry
      sendJson(ws, { type: 'peer-joined' });
      const other = otherSocket(peerId);
      if (other) sendJson(other, { type: 'peer-joined' });
    }

    ws.on('pong', () => {
      if (ws.__duo) ws.__duo.lastPongAt = Date.now();
    });

    ws.on('message', (raw) => {
      if (!checkMsgRate(ws)) {
        sendJson(ws, { type: 'error', code: 'rate-limited', message: 'Message rate limit exceeded.' });
        ws.close(4001, 'rate-limited');
        return;
      }

      let msg;
      try {
        msg = parse(raw.toString());
      } catch {
        sendJson(ws, { type: 'error', code: 'malformed', message: 'Invalid message.' });
        return;
      }

      if (msg.type === 'signal' || msg.type === 'bye') {
        const other = otherSocket(peerId);
        if (other) sendJson(other, msg);
      } else if (msg.type === 'ping') {
        sendJson(ws, { type: 'pong', nonce: msg.nonce });
      }
      // Server-to-client-only types are silently ignored if client sends them
    });

    ws.on('close', (code, reason) => {
      console.log(`[signal] ${peerId} disconnected (code=${code} reason=${reason.toString() || 'none'})`);
      detach(peerId, ws);
      const other = otherSocket(peerId);
      if (other) sendJson(other, { type: 'peer-left', reason: 'disconnect' });
    });

    ws.on('error', (err) => {
      console.error(`[signal] ${peerId} error: ${err.message}`);
    });
  });
}
