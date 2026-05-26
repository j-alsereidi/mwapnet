import type { Express } from 'express';
import { isPeerPresent } from './pairState.js';

const startedAt = Date.now();

export function mountHealthRoute(app: Express): void {
  app.get('/health', (_req, res) => {
    res.json({
      ok: true,
      peerA: isPeerPresent('A'),
      peerB: isPeerPresent('B'),
      uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    });
  });
}
