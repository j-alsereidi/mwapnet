import { store } from './store.js';
import { getPairSecret, clearPairSecret } from './auth.js';
import { MediaManager } from './media.js';
import { connectSignal, type SignalClient } from './signalClient.js';
import { startRtcSession, type RtcSession } from './rtcSession.js';
import { fetchIceConfig } from './iceConfigClient.js';
import { mountUi, showToast } from './ui.js';
import {
  prepareSounds, playSound, playRandomSfx, playVineBoomTest,
  setSfxVolume, setSfxMuted, setVineBoomVolume, setVineBoomMuted,
} from './sound.js';
import { getServerBaseUrl } from './serverConfig.js';
import { syncForegroundService } from '@foreground-service';
import {
  sfxVolumeStore, sfxMutedStore, vineBoomVolumeStore, vineBoomMutedStore,
  exitMeowsEnabledStore, debugModeStore,
} from '@keystore';
import type { IceServerConfig, PeerId } from './types.js';

// App-level events that piggyback on the existing `signal` relay. The server
// forwards `signal.data` opaquely, so we layer non-RTC payloads (currently
// "I just turned my camera on") on the same channel. We filter these out
// before the rtcSession sees them so they don't trip the "unknown shape"
// warning in ingestSignal.
type AppEvent =
  | { kind: 'app'; event: 'cam-on' }
  // "My screen share carries audio" — drives the peer's volume-control
  // visibility deterministically (the remote track's mute/unmute events are
  // RTP-driven and unreliable for this).
  | { kind: 'app'; event: 'screen-audio'; on: boolean };
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
  onLeaveRoom:   handleLeaveRoom,
  onScreenShare: handleScreenShare,
  onCameraFlip:  () => { void handleCameraFlip(); },
  onRetry:       () => { void bootstrap(); },
  onToggleHideSelf: handleToggleHideSelf,
  onSettingsSaved: () => { void bootstrap(); },
  onToggleExitMeows: handleToggleExitMeows,
  onToggleDebugMode: handleToggleDebugMode,
  onSfxMuteToggle: handleSfxMuteToggle,
  onVineBoomMuteToggle: handleVineBoomMuteToggle,
  onSfxVolumeChange: handleSfxVolumeChange,
  onVineBoomVolumeChange: handleVineBoomVolumeChange,
  onTestSfx: playRandomSfx,
  onTestVineBoom: playVineBoomTest,
  // Listener-side controls for the PEER's screen-share audio. Session-only —
  // ui.ts render() pushes these straight onto the <audio> element.
  onScreenAudioVolumeChange: (value) => store.set({ screenAudioVolume: value }),
  onScreenAudioMuteToggle: () => store.set({ screenAudioMuted: !store.get().screenAudioMuted }),
  onGlobalHangup: requestGlobalHangup,
});

// Unlock the AudioContext and start decoding all sound effects on the very
// first tap/click anywhere. Remote-triggered sounds (peer joins the lobby,
// peer enters the room) can only play after some local gesture — this makes
// that gesture "any interaction at all" rather than a specific button.
document.addEventListener('pointerdown', () => prepareSounds(), { once: true });

// ── Screen wake lock ─────────────────────────────────────────────────────────
// While in the room, stop the phone from idle-sleeping. Without this, Android
// dims → locks after the idle timeout, the browser is backgrounded, and the
// OS cuts camera (always) and eventually mic capture — the "call goes one-way
// after 10-20 seconds" failure. The lock is released by the OS whenever the
// tab is hidden or the user presses the power button, so we re-acquire on
// every return to visibility while still in the room.
// ponytail: a deliberate manual power-button lock still backgrounds the tab —
// whether audio survives that is up to the OS/OEM battery policy and can't be
// controlled from a web page. Keeping the screen on during calls is the fix
// browsers actually support.
let wakeLock: WakeLockSentinel | null = null;
let wakeLockPending = false;
function syncWakeLock(): void {
  const want = store.get().phase === 'room';
  if (want && !wakeLock && !wakeLockPending && 'wakeLock' in navigator && document.visibilityState === 'visible') {
    wakeLockPending = true;
    void navigator.wakeLock.request('screen')
      .then((lock) => {
        wakeLock = lock;
        lock.addEventListener('release', () => { wakeLock = null; });
      })
      .catch((err: unknown) => console.warn('[wakelock] request failed:', err))
      .finally(() => { wakeLockPending = false; });
  } else if (!want && wakeLock) {
    void wakeLock.release();
    wakeLock = null;
  }
}
store.subscribe(syncWakeLock);
document.addEventListener('visibilitychange', syncWakeLock);

// Android-only foreground service (see client/src/foregroundService — no-op
// on web/tauri). Keeps mic access alive across an app-switch backgrounding;
// does not survive a deliberate screen lock, same ceiling as the wake lock
// above.
store.subscribe(syncForegroundService);

void loadPersistedSettings().then(() => bootstrap());

// ── Persisted settings ───────────────────────────────────────────────────────
async function loadPersistedSettings(): Promise<void> {
  const [sfxVolumeRaw, sfxMutedRaw, vineBoomVolumeRaw, vineBoomMutedRaw, exitMeowsRaw, debugModeRaw] =
    await Promise.all([
      sfxVolumeStore.get(), sfxMutedStore.get(),
      vineBoomVolumeStore.get(), vineBoomMutedStore.get(),
      exitMeowsEnabledStore.get(), debugModeStore.get(),
    ]);

  const sfxVolume = sfxVolumeRaw !== null ? Number(sfxVolumeRaw) : 100;
  const sfxMuted = sfxMutedRaw === 'true';
  const vineBoomVolume = vineBoomVolumeRaw !== null ? Number(vineBoomVolumeRaw) : 100;
  const vineBoomMuted = vineBoomMutedRaw === 'true';
  const debugMode = debugModeRaw === 'true';

  let exitMeowsEnabled: boolean;
  if (exitMeowsRaw !== null) {
    exitMeowsEnabled = exitMeowsRaw === 'true';
  } else {
    // First run ever: default disabled overnight (9pm-6am local), enabled
    // otherwise. Computed once and persisted immediately so it doesn't
    // silently flip later just because the clock crossed the boundary.
    const hour = new Date().getHours();
    exitMeowsEnabled = !(hour >= 21 || hour < 6);
    await exitMeowsEnabledStore.set(String(exitMeowsEnabled));
  }

  setSfxVolume(sfxVolume);
  setSfxMuted(sfxMuted);
  setVineBoomVolume(vineBoomVolume);
  setVineBoomMuted(vineBoomMuted);

  store.set({ sfxVolume, sfxMuted, vineBoomVolume, vineBoomMuted, exitMeowsEnabled, debugMode });
}

function handleToggleExitMeows(): void {
  const next = !store.get().exitMeowsEnabled;
  store.set({ exitMeowsEnabled: next });
  void exitMeowsEnabledStore.set(String(next));
}

function handleToggleDebugMode(): void {
  const next = !store.get().debugMode;
  store.set({ debugMode: next });
  void debugModeStore.set(String(next));
}

function handleSfxMuteToggle(): void {
  const next = !store.get().sfxMuted;
  setSfxMuted(next);
  store.set({ sfxMuted: next });
  void sfxMutedStore.set(String(next));
}

function handleVineBoomMuteToggle(): void {
  const next = !store.get().vineBoomMuted;
  setVineBoomMuted(next);
  store.set({ vineBoomMuted: next });
  void vineBoomMutedStore.set(String(next));
}

function handleSfxVolumeChange(value: number): void {
  setSfxVolume(value);
  store.set({ sfxVolume: value });
  void sfxVolumeStore.set(String(value));
}

function handleVineBoomVolumeChange(value: number): void {
  setVineBoomVolume(value);
  store.set({ vineBoomVolume: value });
  void vineBoomVolumeStore.set(String(value));
}

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

  // 3. Resolve the backend address. Web: location.origin (the app is served
  // BY the backend). Native: a configured absolute URL — the webview's own
  // origin (capacitor://localhost, tauri://localhost) has nothing to do
  // with where the backend actually lives.
  const baseUrl = await getServerBaseUrl();

  // 4. ICE servers. Failure here is non-fatal — fall back to public STUN.
  try {
    iceConfig = await fetchIceConfig({ baseUrl, pairSecret });
  } catch (err) {
    console.warn('[main] ICE config fetch failed, using STUN-only fallback:', err);
    iceConfig = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }], ttlSeconds: 600 };
  }

  // 5. Open the signaling WebSocket. The hello message will move us to lobby.
  const wsUrl = baseUrl.replace(/^http/, 'ws') + '/signal';
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

    case 'peer-state': {
      console.log(`[signal] peer-state — peer is now ${msg.state}`);
      const prev = store.get().peerPresence;
      store.set({ peerPresence: msg.state });
      playPeerTransitionSound(prev, msg.state);
      reconcileRtc();
      // A peer who (re)connected or re-entered missed earlier announcements.
      if (media.getScreenAudioTrack()) announceScreenAudio(true);
      break;
    }

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
        void clearPairSecret();
        fail('Invalid pair key. Check your key and try again.');
      } else if (msg.code === 'replaced') {
        // Another device/tab opened this same link and took the slot.
        // Surface it instead of dying silently — Try Again reclaims.
        fail('This link was opened on another device or tab. Only one can be connected at a time. Tap Try Again to reconnect here.');
      }
      break;

    case 'hangup-all': {
      // Either side asked to end the call for both. Your own leave sound
      // always plays for your own actions, but a hangup the OTHER side
      // initiated respects "mute exit meows" — fully silent when muted.
      const mine = requestedHangup;
      requestedHangup = false;
      if (store.get().phase === 'room') {
        setMyState('lobby');
        if (mine || store.get().exitMeowsEnabled) void playSound('roomToLobby');
      }
      break;
    }

    case 'pong':
      // no-op; just acknowledges our ping
      break;
  }
}

/** Ask the server to end the call for BOTH peers (long-press on the leave
 *  button). The server echoes 'hangup-all' back to both sides; the flag
 *  lets the echo handler tell "I asked for this" from "the peer did". */
let requestedHangup = false;
export function requestGlobalHangup(): void {
  requestedHangup = true;
  signalClient?.send({ type: 'hangup-all' });
}

// ── Presence transition sounds ───────────────────────────────────────────────
// Sounds keyed on the PEER's observed transitions. Self-side counterparts of
// the "both users" sounds are played in the respective handlers below.
//   lobbyJoin:   peer arrived (absent → lobby). Not room → lobby.
//   lobbyToRoom: peer stepped into the room.
//   roomToLobby: peer left the room — back to lobby OR connection lost.
function playPeerTransitionSound(
  prev: import('./types.js').PeerPresence,
  next: import('./types.js').PeerPresence
): void {
  if (prev === next) return;
  if (prev === 'disconnected' && next === 'lobby') void playSound('lobbyJoin');
  else if (prev === 'lobby' && next === 'room')    void playSound('lobbyToRoom');
  else if (prev === 'room' && (next === 'lobby' || next === 'disconnected')) {
    // This is the PEER leaving — gated by "mute exit meows". The self-side
    // leave sound in handleLeaveRoom() stays unconditional.
    if (store.get().exitMeowsEnabled) void playSound('roomToLobby');
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
  // Local-only feedback — the peer doesn't hear this one.
  void playSound('micButton');
}

function handleCamToggle(): void {
  const wasOff = store.get().camOff;
  const nextOff = !wasOff;
  media.setCamOff(nextOff);
  store.set({ camOff: nextOff });
  // Pre-warm the audio decode on the first user gesture, even when toggling
  // OFF — it's free if already loaded.
  prepareSounds();
  // Camera transitioned off→on while in room → chime for both peers.
  if (wasOff && !nextOff && store.get().phase === 'room') {
    fireCamOn();
  }
}

function handleEnterRoom(): void {
  // Pre-warm audio under the user gesture so iOS unlocks the AudioContext.
  prepareSounds();
  const camOn = !store.get().camOff;
  setMyState('room');
  // Self side of "plays for BOTH users" — the peer hears it via their own
  // peer-state transition.
  void playSound('lobbyToRoom');
  // Entering the room with camera on counts as a cam-on event.
  if (camOn) fireCamOn();
}

function handleLeaveRoom(): void {
  setMyState('lobby');
  // Self side of "plays for BOTH users".
  void playSound('roomToLobby');
}

function handleToggleHideSelf(): void {
  store.set({ hideSelfView: !store.get().hideSelfView });
}

function fireCamOn(): void {
  void playSound('cameraOn');
  // Tell the peer to chime too. We always send — the peer gates on their
  // own phase, so a lobby-side peer won't hear a stale chime.
  signalClient?.send({ type: 'signal', data: { kind: 'app', event: 'cam-on' } });
}

function handleRemoteAppEvent(ev: AppEvent): void {
  if (ev.event === 'cam-on') {
    // Only play if we're actually in the room — otherwise the chime is
    // disconnected from anything the user is seeing.
    if (store.get().phase === 'room') void playSound('cameraOn');
  } else if (ev.event === 'screen-audio') {
    store.set({ remoteScreenAudioActive: ev.on });
    if (store.get().debugMode) showToast(`[debug] peer screen audio: ${ev.on ? 'on' : 'off'}`);
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
    else {
      await media.startScreenShare();
      // Debug: instantly shows whether the picker actually delivered audio —
      // window shares never do; Chromium carries audio for tab shares, and
      // entire-screen shares on Windows only.
      if (store.get().debugMode && media.isScreenSharing()) {
        showToast(`[debug] share started — audio ${media.getScreenAudioTrack() ? 'CAPTURED' : 'NOT captured'}`, 5000);
      }
    }
  } catch (err) {
    console.warn('[main] screenshare failed:', err);
    // Always say SOMETHING. On Android, NotAllowedError covers both "user
    // dismissed the picker" and "the OS refused capture" — the two are
    // indistinguishable, and swallowing them made a failing share button
    // look like it did nothing at all. For any OTHER error, show the actual
    // name + message so a real device failure is diagnosable on the spot
    // (e.g. a browser genuinely lacking getDisplayMedia throws a TypeError).
    const e = err as Error;
    showToast(
      e.name === 'NotAllowedError'
        ? 'Screen share cancelled or blocked.'
        : `Screen share failed: ${e.name || 'error'} — ${e.message || 'unknown'}`,
      6000
    );
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
  announceScreenAudio();
}

// Tell the peer whether my share carries audio. Deduplicated, so it's cheap
// to call from every media change; `force` re-sends for peers who missed it.
let announcedScreenAudio = false;
function announceScreenAudio(force = false): void {
  const on = media.getScreenAudioTrack() !== null;
  if (!force && on === announcedScreenAudio) return;
  announcedScreenAudio = on;
  signalClient?.send({ type: 'signal', data: { kind: 'app', event: 'screen-audio', on } });
}

function fail(message: string): void {
  store.set({ phase: 'failed', lastError: message });
  // Failing while a call is live (e.g. slot replaced mid-room) must also
  // tear the RTC session down — reconcileRtc is only otherwise called from
  // explicit state transitions.
  reconcileRtc();
}
