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
const turnStaticAuthSecret = requireEnv('TURN_STATIC_AUTH_SECRET');
const publicTurnHost = requireEnv('PUBLIC_TURN_HOST');

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
if (turnStaticAuthSecret.length < 32) {
  console.error('[config] TURN_STATIC_AUTH_SECRET must be >= 32 characters');
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
  turnStaticAuthSecret,
  turnRealm: process.env['TURN_REALM'] ?? 'duo.local',
  publicTurnHost,
  publicTurnPort: optionalEnvInt('PUBLIC_TURN_PORT', 3478),
  turnsTlsPort: optionalEnvInt('TURNS_TLS_PORT', 5349),
  iceServersOverride: parseIceServersJson(),
};
