import type { ClientState } from './types.js';

const initialState: ClientState = {
  phase: 'idle',
  localStream: null,
  remoteStream: null,
  micMuted: false,
  camOff: false,
  connectionType: 'unknown',
  peerId: null,
  lastError: null,
};

type Listener = (state: ClientState) => void;

let state: ClientState = { ...initialState };
const listeners = new Set<Listener>();

export const store = {
  get(): ClientState {
    return state;
  },
  set(patch: Partial<ClientState>): void {
    state = { ...state, ...patch };
    for (const fn of listeners) fn(state);
  },
  subscribe(fn: Listener): () => void {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
