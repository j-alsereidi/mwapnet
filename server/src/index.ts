import process from 'node:process';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { config } from './config.js';
import { mountHealthRoute } from './health.js';
import { mountIceConfigRoute } from './iceConfig.js';
import { mountSignal } from './signal.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const app = express();

  app.use((_req, res, next) => {
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; media-src 'self' blob:; connect-src 'self' wss: https:; img-src 'self' data:; script-src 'self'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'"
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  app.use(express.json({ limit: '16kb' }));

  mountHealthRoute(app);
  mountIceConfigRoute(app);

  // Serve the compiled client SPA; falls back to index.html for client-side routing
  const clientDist = path.resolve(__dirname, '../../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  const server = createServer(app);
  mountSignal(server);

  await new Promise<void>(resolve => server.listen(config.port, resolve));
  console.log(`[duo] listening on :${config.port}`);

  process.on('SIGTERM', () => {
    console.log('[duo] SIGTERM — shutting down');
    server.close(() => process.exit(0));
    // Give open connections 5s to drain before force-exit
    setTimeout(() => process.exit(0), 5_000).unref();
  });
}

main().catch(err => {
  console.error('[duo] fatal:', err);
  process.exit(1);
});
