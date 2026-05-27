import { store } from './store.js';
import { getPairSecret, clearPairSecret } from './auth.js';
import { MediaManager } from './media.js';
import { connectSignal, type SignalClient } from './signalClient.js';
import { startRtcSession, type RtcSession } from './rtcSession.js';
import { fetchIceConfig } from './iceConfigClient.js';
import { mountUi } from './ui.js';
import { cameraSound } from './sound.js';
import type { IceServerConfig, PeerId } from './types.js';

// App-level events that piggyback on the existing `signal` relay. The server
// forwards `signal.data` opaquely, so we layer non-RTC payloads (currently
// "I just turned my camera on") on the same channel. We filter these out
// before the rtcSession sees them so they don't trip the "unknown shape"
// warning in ingestSignal.
type AppEvent = { kind: 'app'; event: 'cam-on' };
function isAppEvent(data: unknown): data is AppEvent {
  return !!data && typeof data === 'object' && (data as { kind?: unknown }).kind === 'app';
}

// ── Module-scope singletons ──────────────────────────────────────────────────
const media = new MediaManager();
let signalClient: SignalClient | null = null;
let rtcSession: RtcSession | null = null;
let iceConfig: IceServerConfig | null = null;
let peerId: PeerId | null = null;
// Signal messages that arrive before rtcSession exists get held here
const queuedSignals: unknown[] = [];

// ── UI handlers ──────────────────────────────────────────────────────────────
mountUi({
  onMicToggle:   handleMicToggle,
  onCamToggle:   handleCamToggle,
  onCameraPick:  handleCameraPick,
  onEnterRoom:   handleEnterRoom,
  onLeaveRoom:   () => setMyState('lobby'),
  onScreenShare: handleScreenShare,
  onCameraFlip:  () => { void handleCameraFlip(); },
  onRetry:       () => { void bootstrap(); },
  onToggleHideSelf: handleToggleHideSelf,
});

void bootstrap();

// ── Bootstrap ────────────────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  store.set({ phase: 'connecting', lastError: null, peerPresence: 'disconnected' });

  // 1. Pair secret
  let pairSecret: string;
  try { pairSecret = await getPairSecret(); }
  catch { return fail('Could not read pair key.'); }

  // 2. Camera + mic. Browser requires HTTPS context (ngrok provides this).
  try {
    await media.acquire();
  } catch (err) {
    return fail(
      (err as Error).name === 'NotFoundError'
        ? 'No camera or mic detected.'
        : 'MWAPNET needs camera and mic to work.'
    );
  }

  // Reflect the acquired stream into the store + enumerate cameras
  store.set({ localStream: media.getStream(), currentCameraId: media.currentCamera() });

  // Keep the dedicated screen stream in sync whenever media changes — covers
  // the case where the user stops sharing via the OS bar (which fires the
  // track's `ended` event and bypasses our button handler).
  media.onChange(() => pushScreenStateToStore());
  try {
    store.set({ cameras: await media.listCameras() });
  } catch { /* device enumeration is non-critical */ }

  // 3. ICE servers. Failure here is non-fatal — fall back to public STUN.
  try {
    iceConfig = await fetchIceConfig({ baseUrl: location.origin, pairSecret });
  } catch (err) {
    console.warn('[main] ICE config fetch failed, using STUN-only fallback:', err);
    iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], ttlSeconds: 600 };
  }

  // 4. Open the signaling WebSocket. The hello message will move us to lobby.
  const wsUrl = location.origin.replace(/^http/, 'ws') + '/signal';
  signalClient?.close();
  signalClient = connectSignal({ url: wsUrl, pairSecret });
  signalClient.onMessage(handleServerMessage);
}

// ── Server message routing ───────────────────────────────────────────────────
function handleServerMessage(msg: import('./types.js').ServerMessage): void {
  console.log('[signal] recv', msg.type);
  switch (msg.type) {
    case 'hello':
      peerId = msg.you;
      console.log(`[signal] hello — you are ${peerId}, peer is ${msg.peerPresence}`);
      store.set({ peerId, peerPresence: msg.peerPresence, phase: 'lobby' });
      reconcileRtc();
      break;

    case 'peer-state':
      console.log(`[signal] peer-state — peer is now ${msg.state}`);
      store.set({ peerPresence: msg.state });
      reconcileRtc();
      break;

    case 'signal':
      if (isAppEvent(msg.data)) {
        handleRemoteAppEvent(msg.data);
      } else if (rtcSession) {
        rtcSession.ingestSignal(msg.data);
      } else {
        queuedSignals.push(msg.data);
      }
      break;

    case 'error':
      console.warn('[signal] error', msg.code, msg.message);
      if (msg.code === 'unauthorized') {
        clearPairSecret();
        fail('Invalid pair key. Check your key and try again.');
      }
      break;

    case 'pong':
      // no-op; just acknowledges our ping
      break;
  }
}

// ── State transitions ────────────────────────────────────────────────────────
function setMyState(state: 'lobby' | 'room'): void {
  if (!signalClient) return;
  const cur = store.get().phase;
  if (cur !== 'lobby' && cur !== 'room') return;
  signalClient.send({ type: 'state', state });
  store.set({ phase: state });
  reconcileRtc();
}

/**
 * The only place the RTC session is created or destroyed.
 * Active iff *both* peers are in 'room'.
 */
function reconcileRtc(): void {
  const s = store.get();
  const shouldRun = s.phase === 'room' && s.peerPresence === 'room';

  if (shouldRun && !rtcSession) {
    if (!peerId || !signalClient || !iceConfig) return;
    console.log('[main] starting RTC session');
    rtcSession = startRtcSession({
      initiator: peerId === 'A', // Slot A always offers — deterministic, eliminates glare
      media,
      iceConfig,
      signal: signalClient,
    });
    // Deliver any signal messages that landed before the session existed
    while (queuedSignals.length) rtcSession.ingestSignal(queuedSignals.shift());
  } else if (!shouldRun && rtcSession) {
    console.log('[main] tearing down RTC session');
    rtcSession.destroy();
    rtcSession = null;
    queuedSignals.length = 0;
  }
}

// ── UI action handlers ───────────────────────────────────────────────────────
function handleMicToggle(): void {
  const next = !store.get().micMuted;
  media.setMicMuted(next);
  store.set({ micMuted: next });
}

function handleCamToggle(): void {
  const wasOff = store.get().camOff;
  const nextOff = !wasOff;
  media.setCamOff(nextOff);
  store.set({ camOff: nextOff });
  // Pre-warm the audio decode on the first user gesture, even when toggling
  // OFF — it's free if already loaded.
  cameraSound.prepare();
  // Camera transitioned off→on while in room → chime for both peers.
  if (wasOff && !nextOff && store.get().phase === 'room') {
    fireCamOn();
  }
}

function handleEnterRoom(): void {
  // Pre-warm audio under the user gesture so iOS unlocks the AudioContext.
  cameraSound.prepare();
  const camOn = !store.get().camOff;
  setMyState('room');
  // Entering the room with camera on counts as a cam-on event.
  if (camOn) fireCamOn();
}

function handleToggleHideSelf(): void {
  store.set({ hideSelfView: !store.get().hideSelfView });
}

function fireCamOn(): void {
  void cameraSound.play();
  // Tell the peer to chime too. We always send — the peer gates on their
  // own phase, so a lobby-side peer won't hear a stale chime.
  signalClient?.send({ type: 'signal', data: { kind: 'app', event: 'cam-on' } });
}

function handleRemoteAppEvent(ev: AppEvent): void {
  if (ev.event === 'cam-on') {
    // Only play if we're actually in the room — otherwise the chime is
    // disconnected from anything the user is seeing.
    if (store.get().phase === 'room') void cameraSound.play();
  }
}

async function handleCameraPick(deviceId: string): Promise<void> {
  try {
    await media.switchCamera(deviceId);
    store.set({ currentCameraId: media.currentCamera() });
    // Re-apply camOff state to the new track
    media.setCamOff(store.get().camOff);
  } catch (err) {
    console.warn('[main] switchCamera failed:', err);
  }
}

async function handleCameraFlip(): Promise<void> {
  const { cameras, currentCameraId } = store.get();
  if (cameras.length < 2) return;
  const idx = cameras.findIndex(c => c.deviceId === currentCameraId);
  const next = cameras[(idx + 1) % cameras.length];
  await handleCameraPick(next.deviceId);
}

async function handleScreenShare(): Promise<void> {
  const sharing = store.get().screenSharing;
  try {
    if (sharing) await media.stopScreenShare();
    else          await media.startScreenShare();
  } catch (err) {
    // User cancelled the share picker — not an error worth surfacing
    if ((err as Error).name !== 'NotAllowedError') {
      console.warn('[main] screenshare failed:', err);
    }
  }
  pushScreenStateToStore();
}

/** Build a *fresh* MediaStream wrapping just the screen track. Mobile browsers
 *  are unreliable when video elements receive a mutated stream — a brand-new
 *  stream object every time guarantees a clean rebind. */
function pushScreenStateToStore(): void {
  const sharing = media.isScreenSharing();
  const track = media.getScreenTrack();
  const screenStream = sharing && track ? new MediaStream([track]) : null;
  store.set({ screenSharing: sharing, screenStream });
}

function fail(message: string): void {
  store.set({ phase: 'failed', lastError: message });
}
