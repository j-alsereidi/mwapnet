import process from 'node:process';

function requireEnv(name: string): string {
  const val = process.env[name];
  if (!val || val.length === 0) {
    console.error(`[config] Missing required env var: ${name}`);
    process.exit(1);
  }
  return val;
}

function optionalEnvInt(name: string, defaultVal: number): number {
  const val = process.env[name];
  if (!val) return defaultVal;
  const n = parseInt(val, 10);
  if (isNaN(n)) {
    console.error(`[config] Env var ${name} must be an integer, got: ${val}`);
    process.exit(1);
  }
  return n;
}

const pairSecretA = requireEnv('PAIR_SECRET_A');
const pairSecretB = requireEnv('PAIR_SECRET_B');

if (pairSecretA.length < 32) {
  console.error('[config] PAIR_SECRET_A must be >= 32 characters');
  process.exit(1);
}
if (pairSecretB.length < 32) {
  console.error('[config] PAIR_SECRET_B must be >= 32 characters');
  process.exit(1);
}
if (pairSecretA === pairSecretB) {
  console.error('[config] PAIR_SECRET_A and PAIR_SECRET_B must differ');
  process.exit(1);
}

// Cloudflare Realtime TURN — when set, the server fetches ephemeral TURN
// credentials from the Cloudflare API on each /ice-config request.
// Get a key pair from: Cloudflare Dashboard → Realtime → TURN → Create TURN keys.
const cloudflareTurnKeyId     = process.env['CLOUDFLARE_TURN_KEY_ID']     ?? '';
const cloudflareTurnKeySecret = process.env['CLOUDFLARE_TURN_KEY_SECRET'] ?? '';

// Self-hosted coturn — optional; only used when Cloudflare TURN is not configured.
// TURN_STATIC_AUTH_SECRET must still be >= 32 chars if provided (coturn requires it).
const publicTurnHost       = process.env['PUBLIC_TURN_HOST']        ?? '';
const turnStaticAuthSecret = process.env['TURN_STATIC_AUTH_SECRET'] ?? '';

const usingCloudflareTurn = cloudflareTurnKeyId.length > 0 && cloudflareTurnKeySecret.length > 0;
const usingCoturn = !usingCloudflareTurn && publicTurnHost.length > 0 &&
  publicTurnHost !== 'localhost' && publicTurnHost !== '127.0.0.1';

if (usingCoturn && turnStaticAuthSecret.length < 32) {
  console.error('[config] TURN_STATIC_AUTH_SECRET must be >= 32 characters when using self-hosted TURN');
  process.exit(1);
}

// Optional override: a JSON array of RTCIceServer objects, used verbatim.
// Lets you plug in any TURN provider (Metered, Cloudflare, Twilio, etc.) without code changes.
// Example: ICE_SERVERS_JSON=[{"urls":"turn:host:port","username":"u","credential":"p"}]
function parseIceServersJson(): unknown[] | null {
  const raw = process.env['ICE_SERVERS_JSON'];
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error('must be an array');
    return parsed;
  } catch (e) {
    console.error('[config] ICE_SERVERS_JSON is invalid JSON:', (e as Error).message);
    process.exit(1);
  }
}

export const config = {
  port: optionalEnvInt('PORT', 8080),
  pairSecretA,
  pairSecretB,
  // Cloudflare Realtime TURN (preferred when set)
  cloudflareTurnKeyId,
  cloudflareTurnKeySecret,
  // Self-hosted coturn (fallback when CF TURN is not configured)
  turnStaticAuthSecret,
  turnRealm: process.env['TURN_REALM'] ?? 'duo.local',
  publicTurnHost,
  publicTurnPort: optionalEnvInt('PUBLIC_TURN_PORT', 3478),
  turnsTlsPort: optionalEnvInt('TURNS_TLS_PORT', 5349),
  iceServersOverride: parseIceServersJson(),
};
