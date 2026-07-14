import type { ClientState } from './types.js';

const initialState: ClientState = {
  phase: 'connecting',
  peerId: null,
  peerPresence: 'disconnected',

  localStream: null,
  remoteStream: null,
  screenStream: null,

  micMuted: false,
  camOff: false,
  screenSharing: false,

  remoteScreenAudioTrack: null,
  remoteScreenAudioActive: false,
  screenAudioVolume: 100,
  screenAudioMuted: false,

  cameras: [],
  currentCameraId: null,

  rtcConnected: false,
  connectionType: 'unknown',

  hideSelfView: false,

  // Placeholders — overwritten almost immediately at boot by main.ts's
  // loadPersistedSettings(), which reads the real values (and computes
  // exitMeowsEnabled's time-of-day default) before the first render.
  sfxVolume: 100,
  sfxMuted: false,
  vineBoomVolume: 100,
  vineBoomMuted: false,
  exitMeowsEnabled: true,
  debugMode: false,

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
