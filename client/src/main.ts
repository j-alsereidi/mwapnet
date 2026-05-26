import { store } from './store.js';
import { getPairSecret, clearPairSecret } from './auth.js';
import { acquireLocalStream, setMicMuted, setCamOff } from './media.js';
import { connectSignal, type SignalClient } from './signalClient.js';
import { startRtcSession, type RtcSession } from './rtcSession.js';
import { fetchIceConfig } from './iceConfigClient.js';
import { mountUi } from './ui.js';
import type { IceServerConfig, PeerId } from './types.js';

let pairSecret = '';
let signalClient: SignalClient | null = null;
let rtcSession: RtcSession | null = null;

// Mount UI before bootstrap so handlers are live immediately
mountUi({ onMicToggle, onCamToggle, onHangup, onRetry: () => { bootstrap(); } });

// iOS Safari: getUserMedia requires a user gesture. On first load we show
// the overlay — the user clicking "connect" provides that gesture.
bootstrap();

export async function bootstrap(): Promise<void> {
  store.set({ phase: 'idle', lastError: null, connectionType: 'unknown' });

  try {
    pairSecret = await getPairSecret();
  } catch {
    store.set({ phase: 'failed', lastError: 'Could not read pair key.' });
    return;
  }

  // Acquire camera + mic
  let localStream: MediaStream;
  try {
    localStream = await acquireLocalStream();
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    if (name === 'NotFoundError') {
      store.set({ phase: 'failed', lastError: 'No camera or mic detected.' });
    } else {
      store.set({ phase: 'failed', lastError: 'duo needs camera and mic to work.' });
    }
    return;
  }

  store.set({ localStream });
  (document.getElementById('local') as HTMLVideoElement).srcObject = localStream;

  // Fetch ICE servers (STUN + TURN credentials)
  let iceConfig: IceServerConfig;
  try {
    iceConfig = await fetchIceConfig({ baseUrl: location.origin, pairSecret });
  } catch (err) {
    console.warn('[main] TURN unavailable, falling back to STUN only:', err);
    // Proceed with Google STUN; direct connections still work for ~85% of NAT pairs
    iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], ttlSeconds: 600 };
  }

  // Open signaling WebSocket
  store.set({ phase: 'connecting-signal' });
  const wsUrl = location.origin.replace(/^http/, 'ws') + '/signal';
  signalClient?.close();
  signalClient = connectSignal({ url: wsUrl, pairSecret });

  let peerId: PeerId | null = null;
  let sessionStarted = false;
  // Buffer any signal messages that arrive before rtcSession is wired up
  const pendingSignals: unknown[] = [];

  signalClient.onMessage((msg) => {
    console.log('[signal] recv', msg.type);
    switch (msg.type) {
      case 'hello': {
        peerId = msg.you;
        console.log(`[signal] hello — you are ${peerId}, peerPresent=${msg.peerPresent}`);
        store.set({ peerId, phase: msg.peerPresent ? 'negotiating' : 'waiting-for-peer' });
        if (msg.peerPresent && !sessionStarted) startSession(localStream, iceConfig);
        break;
      }
      case 'peer-joined': {
        console.log('[signal] peer-joined');
        store.set({ phase: 'negotiating' });
        if (!sessionStarted) startSession(localStream, iceConfig);
        break;
      }
      case 'peer-left': {
        console.log('[signal] peer-left');
        teardownRtc();
        store.set({ phase: 'waiting-for-peer', remoteStream: null, connectionType: 'unknown' });
        (document.getElementById('remote') as HTMLVideoElement).srcObject = null;
        break;
      }
      case 'signal': {
        if (rtcSession) rtcSession.ingestSignal(msg.data);
        else pendingSignals.push(msg.data);
        break;
      }
      case 'error': {
        console.warn('[signal] error', msg.code, msg.message);
        if (msg.code === 'unauthorized') {
          clearPairSecret();
          store.set({ phase: 'failed', lastError: 'Invalid pair key. Check your key and try again.' });
        }
        break;
      }
    }
  });

  function startSession(stream: MediaStream, ice: IceServerConfig) {
    if (!peerId || sessionStarted || !signalClient) return;
    sessionStarted = true;
    teardownRtc();
    rtcSession = startRtcSession({
      initiator: peerId === 'A', // A is always the offerer — deterministic, eliminates glare
      localStream: stream,
      iceConfig: ice,
      signal: signalClient,
    });
    // Drain anything that arrived before rtcSession existed
    while (pendingSignals.length) {
      rtcSession.ingestSignal(pendingSignals.shift());
    }
  }
}

function teardownRtc() {
  rtcSession?.destroy();
  rtcSession = null;
}

function onMicToggle() {
  const { localStream, micMuted } = store.get();
  if (!localStream) return;
  const next = !micMuted;
  setMicMuted(localStream, next);
  store.set({ micMuted: next });
}

function onCamToggle() {
  const { localStream, camOff } = store.get();
  if (!localStream) return;
  const next = !camOff;
  setCamOff(localStream, next);
  store.set({ camOff: next });
}

function onHangup() {
  signalClient?.send({ type: 'bye' });
  teardownRtc();
  store.set({ phase: 'waiting-for-peer', remoteStream: null, connectionType: 'unknown' });
  (document.getElementById('remote') as HTMLVideoElement).srcObject = null;
}
