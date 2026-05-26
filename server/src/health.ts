import type { Express } from 'express';
import { getPresence } from './pairState.js';

const startedAt = Date.now();

export function mountHealthRoute(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      peerA: getPresence('A'),
      peerB: getPresence('B'),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });
}
