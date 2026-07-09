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

/** Fetch ephemeral TURN credentials from Cloudflare Realtime TURN API.
 *  Called on each /ice-config request so credentials are always fresh (≤ 600s TTL).
 *  API reference: https://developers.cloudflare.com/realtime/turn/generate-credentials/ */
async function buildCloudflareIceConfig(): Promise<IceServerConfig> {
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${config.cloudflareTurnKeyId}/credentials/generate-ice-servers`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.cloudflareTurnKeySecret}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ttl: 600 }),
  });
  if (!res.ok) {
    throw new Error(`Cloudflare TURN API returned ${res.status}: ${await res.text()}`);
  }
  const data = await res.json() as { iceServers: IceServerConfig['iceServers'] };
  return { iceServers: data.iceServers, ttlSeconds: 600 };
}

export async function buildIceConfig(): Promise<IceServerConfig> {
  // Priority 1: Explicit ICE_SERVERS_JSON override — verbatim, highest precedence.
  if (config.iceServersOverride) {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iceServers: config.iceServersOverride as any,
      ttlSeconds: 3600,
    };
  }

  // Priority 2: Cloudflare Realtime TURN — when CF keys are configured, fetch
  // fresh short-lived credentials on every request. TURN traffic goes directly
  // from peers to Cloudflare's edge; the app server is not in the media path.
  if (config.cloudflareTurnKeyId && config.cloudflareTurnKeySecret) {
    return buildCloudflareIceConfig();
  }

  // Priority 3: No real TURN reachable in local dev — return public STUN only.
  // Works for same-LAN testing but fails across symmetric NATs (mobile data).
  if (!config.publicTurnHost || config.publicTurnHost === 'localhost' || config.publicTurnHost === '127.0.0.1') {
    return {
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      ttlSeconds: 3600,
    };
  }

  // Priority 4: Self-hosted coturn — build HMAC credentials for the configured host.
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

    buildIceConfig()
      .then((cfg) => res.json(cfg))
      .catch((err: unknown) => {
        console.error('[ice-config] build failed:', err);
        res.status(500).json({ error: 'ICE config unavailable' });
      });
  });
}
