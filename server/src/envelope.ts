import { z } from 'zod';

const MAX_MESSAGE_BYTES = 16 * 1024;

// Schema for messages the server ACCEPTS from clients. Server-emitted messages
// are constructed directly (no need to validate what we ourselves produce).
export const clientMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), state: z.enum(['lobby', 'room']) }),
  z.object({ type: z.literal('signal'), data: z.unknown() }),
  // "End the call for both of us" — echoed to both peers, who each walk
  // themselves back to the lobby through their normal leave path.
  z.object({ type: z.literal('hangup-all') }),
  z.object({ type: z.literal('ping'), nonce: z.number() }),
]);

export type ClientMessage = z.infer<typeof clientMessageSchema>;

export function parseClientMessage(raw: string): ClientMessage {
  if (Buffer.byteLength(raw, 'utf8') > MAX_MESSAGE_BYTES) {
    throw new Error('Message exceeds 16 KiB limit');
  }
  return clientMessageSchema.parse(JSON.parse(raw));
}
