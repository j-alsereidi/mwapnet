import type { WebSocket } from 'ws';
import type { PeerId } from './auth.js';

export type Presence = 'lobby' | 'room';
export type ObservablePresence = Presence | 'disconnected';

interface SlotState {
  ws: WebSocket;
  peerId: PeerId;
  presence: Presence;
  connectedAt: number;
}

const slots: [SlotState | null, SlotState | null] = [null, null];

function slotIndex(peerId: PeerId): 0 | 1 {
  return peerId === 'A' ? 0 : 1;
}

function otherIndex(peerId: PeerId): 0 | 1 {
  return peerId === 'A' ? 1 : 0;
}

// New connection — always starts in lobby. Bumps any prior socket holding this slot.
export function attach(peerId: PeerId, ws: WebSocket): void {
  const idx = slotIndex(peerId);
  const existing = slots[idx];

  if (existing && existing.ws !== ws) {
    try {
      existing.ws.send(JSON.stringify({
        type: 'error',
        code: 'replaced',
        message: 'Another device connected as you.',
      }));
      existing.ws.close(4000, 'replaced');
    } catch { /* socket may already be dead */ }
  }

  slots[idx] = { ws, peerId, presence: 'lobby', connectedAt: Date.now() };
}

// Idempotent: only clears the slot if `ws` is still the current occupant
export function detach(peerId: PeerId, ws: WebSocket): void {
  const idx = slotIndex(peerId);
  if (slots[idx]?.ws === ws) {
    slots[idx] = null;
  }
}

export function setPresence(peerId: PeerId, presence: Presence): void {
  const idx = slotIndex(peerId);
  if (slots[idx]) slots[idx]!.presence = presence;
}

export function getPresence(peerId: PeerId): ObservablePresence {
  return slots[slotIndex(peerId)]?.presence ?? 'disconnected';
}

export function otherSocket(peerId: PeerId): WebSocket | null {
  return slots[otherIndex(peerId)]?.ws ?? null;
}
