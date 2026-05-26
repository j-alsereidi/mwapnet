import { timingSafeEqual } from 'node:crypto';
import { config } from './config.js';

export type PeerId = 'A' | 'B';

function safeCompare(a: string, b: string): boolean {
  const maxLen = Math.max(a.length, b.length);
  const bufA = Buffer.alloc(maxLen);
  const bufB = Buffer.alloc(maxLen);
  bufA.write(a);
  bufB.write(b);
  // Compare padded buffers in constant time, then separately check lengths
  return timingSafeEqual(bufA, bufB) && a.length === b.length;
}

export function identifyPeer(presentedSecret: string): PeerId | null {
  // Always compare against BOTH secrets to prevent timing side-channels
  const matchA = safeCompare(presentedSecret, config.pairSecretA);
  const matchB = safeCompare(presentedSecret, config.pairSecretB);
  if (matchA) return 'A';
  if (matchB) return 'B';
  return null;
}
