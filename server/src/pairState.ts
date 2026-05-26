import type { WebSocket } from 'ws';
import type { PeerId } from './auth.js';

interface SlotState {
  ws: WebSocket;
  peerId: PeerId;
  connectedAt: number;
}

const slots: [SlotState | null, SlotState | null] = [null, null];

function slotIndex(peerId: PeerId): 0 | 1 {
  return peerId === 'A' ? 0 : 1;
}

export function attach(peerId: PeerId, ws: WebSocket): { replaced: boolean } {
  const idx = slotIndex(peerId);
  const existing = slots[idx];
  let replaced = false;

  if (existing && existing.ws !== ws) {
    try {
      existing.ws.send(JSON.stringify({
        type: 'error',
        code: 'replaced',
        message: 'Another device connected as you.',
      }));
      existing.ws.close(4000, 'replaced');
    } catch {
      // socket may already be closed
    }
    replaced = true;
  }

  slots[idx] = { ws, peerId, connectedAt: Date.now() };
  return { replaced };
}

// No-op if ws is no longer the current occupant (handles late close events after a bump)
export function detach(peerId: PeerId, ws: WebSocket): void {
  const idx = slotIndex(peerId);
  if (slots[idx]?.ws === ws) {
    slots[idx] = null;
  }
}

export function peerSocket(peerId: PeerId): WebSocket | null {
  return slots[slotIndex(peerId)]?.ws ?? null;
}

export function otherSocket(peerId: PeerId): WebSocket | null {
  const otherIdx: 0 | 1 = peerId === 'A' ? 1 : 0;
  return slots[otherIdx]?.ws ?? null;
}

export function isPeerPresent(peerId: PeerId): boolean {
  return slots[slotIndex(peerId)] !== null;
}
