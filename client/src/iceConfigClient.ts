import type { IceServerConfig } from './types.js';

let cache: { config: IceServerConfig; expiresAt: number } | null = null;

export async function fetchIceConfig(opts: {
  baseUrl: string;
  pairSecret: string;
}): Promise<IceServerConfig> {
  const now = Date.now();
  if (cache && now < cache.expiresAt) return cache.config;

  const res = await fetch(`${opts.baseUrl}/ice-config`, {
    headers: { Authorization: `Bearer ${opts.pairSecret}` },
  });
  if (!res.ok) throw new Error(`ice-config ${res.status}`);

  const data = (await res.json()) as IceServerConfig;
  // Expire 60s before the server-side TTL to avoid using stale credentials
  cache = { config: data, expiresAt: now + (data.ttlSeconds - 60) * 1000 };
  return data;
}
