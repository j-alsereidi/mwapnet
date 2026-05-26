import { createHmac } from 'node:crypto';
import type { Express, Request, Response } from 'express';
import { config } from './config.js';
import { identifyPeer } from './auth.js';

export interface IceServerConfig {
  iceServers: Array<{ urls: string | string[]; username?: string; credential?: string }>;
  ttlSeconds: number;
}

function buildTurnCredential(): { username: string; credential: string } {
  const expiry = Math.floor(Date.now() / 1000) + 600;
  const username = `${expiry}:duo`;
  const hmac = createHmac('sha1', config.turnStaticAuthSecret);
  hmac.update(username);
  const credential = hmac.digest('base64');
  return { username, credential };
}

export function buildIceConfig(): IceServerConfig {
  // Explicit ICE_SERVERS_JSON override wins over everything — for plugging in
  // a third-party TURN provider (Metered, Cloudflare, Twilio, etc.).
  if (config.iceServersOverride) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iceServers: config.iceServersOverride as any,
      ttlSeconds: 3600,
    };
  }

  // No real TURN is reachable in the local dev setup — return public STUN only.
  // This works for same-LAN testing but fails across symmetric NATs (mobile data).
  if (config.publicTurnHost === 'localhost' || config.publicTurnHost === '127.0.0.1') {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      ttlSeconds: 3600,
    };
  }

  const { username, credential } = buildTurnCredential();
  const h = config.publicTurnHost;
  const p = config.publicTurnPort;
  const tp = config.turnsTlsPort;

  return {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: `stun:${h}:${p}` },
      {
        urls: [
          `turn:${h}:${p}?transport=udp`,
          `turn:${h}:${p}?transport=tcp`,
          `turns:${h}:${tp}?transport=tcp`,
        ],
        username,
        credential,
      },
    ],
    ttlSeconds: 600,
  };
}

// Per-IP rate limiter: 10 req/min
const rateLimitMap = new Map<string, { count: number; resetAt: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + 60_000 });
    return true;
  }
  if (entry.count >= 10) return false;
  entry.count++;
  return true;
}

export function mountIceConfigRoute(app: Express): void {
  app.get('/ice-config', (req: Request, res: Response) => {
    const ip =
      (req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0]?.trim() ??
      req.socket.remoteAddress ??
      'unknown';

    if (!checkRateLimit(ip)) {
      res.status(429).json({ error: 'Too many requests' });
      return;
    }

    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!identifyPeer(auth.slice(7))) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.json(buildIceConfig());
  });
}
