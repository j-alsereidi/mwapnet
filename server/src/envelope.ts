import { z } from 'zod';

const MAX_MESSAGE_BYTES = 16 * 1024;

export const envelopeSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('hello') }),
  z.object({ type: z.literal('peer-joined') }),
  z.object({ type: z.literal('peer-left'), reason: z.enum(['disconnect', 'replaced', 'bye']) }),
  z.object({ type: z.literal('signal'), data: z.unknown() }),
  z.object({ type: z.literal('bye') }),
  z.object({ type: z.literal('ping'), nonce: z.number() }),
  z.object({ type: z.literal('pong'), nonce: z.number() }),
  z.object({ type: z.literal('error'), code: z.string(), message: z.string() }),
]);

export type SignalEnvelope = z.infer<typeof envelopeSchema>;

export function parse(raw: string): SignalEnvelope {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error('Message exceeds 16 KiB limit');
  }
  const json = JSON.parse(raw) as unknown;
  return envelopeSchema.parse(json);
}
