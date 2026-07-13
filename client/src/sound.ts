// UI sound effects. Played on local actions and on peer state transitions.
//
// Implemented with the Web Audio API rather than <audio> elements because
// mobile browsers (especially iOS Safari) commonly truncate short MP3 clips
// played via HTMLAudioElement — the element gets reused, the file isn't fully
// buffered, and playback cuts off mid-clip. Decoding each file into an
// AudioBuffer once and replaying from there is sample-accurate everywhere.
//
// One AudioContext is shared across all sounds. It must be created during a
// user gesture (any tap/click) to satisfy autoplay policies; after that,
// playback from any trigger — including a peer's network event — works
// without further gestures. main.ts calls prepareSounds() on the first
// pointerdown and on the primary buttons.

const FILES = {
  cameraOn:    '/sounds/cameraOn.mp3',
  lobbyJoin:   '/sounds/lobbyJoin.mp3',
  lobbyToRoom: '/sounds/lobbyToRoom.mp3',
  micButton:   '/sounds/micButton.mp3',
  roomToLobby: '/sounds/roomToLobby.mp3',
} as const;

export type SoundName = keyof typeof FILES;

// "Vine boom" is cameraOn.mp3's own volume channel, separate from every
// other effect (grouped as "SFX"). Two GainNodes, both feeding destination.
const VINE_BOOM: SoundName = 'cameraOn';

type AudioCtxCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let sfxGain: GainNode | null = null;
let vineBoomGain: GainNode | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const loading = new Map<SoundName, Promise<void>>();

// Volume/mute state lives here (not just on the GainNodes) so a setter
// called before the AudioContext exists — e.g. loading persisted settings
// at boot, before any user gesture — still takes effect once it's created.
let sfxVolume = 1;   // 0-1
let sfxMuted = false;
let vineBoomVolume = 1;
let vineBoomMuted = false;

function applyGains(): void {
  if (sfxGain) sfxGain.gain.value = sfxMuted ? 0 : sfxVolume;
  if (vineBoomGain) vineBoomGain.gain.value = vineBoomMuted ? 0 : vineBoomVolume;
}

/** value: 0-100. */
export function setSfxVolume(value: number): void {
  sfxVolume = Math.max(0, Math.min(100, value)) / 100;
  applyGains();
}
export function setSfxMuted(muted: boolean): void {
  sfxMuted = muted;
  applyGains();
}
/** value: 0-100. */
export function setVineBoomVolume(value: number): void {
  vineBoomVolume = Math.max(0, Math.min(100, value)) / 100;
  applyGains();
}
export function setVineBoomMuted(muted: boolean): void {
  vineBoomMuted = muted;
  applyGains();
}

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext) as AudioCtxCtor | undefined;
  if (!Ctor) return null;
  ctx = new Ctor();
  sfxGain = ctx.createGain();
  vineBoomGain = ctx.createGain();
  sfxGain.connect(ctx.destination);
  vineBoomGain.connect(ctx.destination);
  applyGains(); // pick up any volume/mute set before the context existed
  return ctx;
}

function ensureLoaded(name: SoundName): Promise<void> {
  if (buffers.has(name)) return Promise.resolve();
  const inFlight = loading.get(name);
  if (inFlight) return inFlight;
  const p = (async () => {
    const c = ensureContext();
    if (!c) throw new Error('Web Audio not supported');
    const res = await fetch(FILES[name]);
    if (!res.ok) throw new Error(`fetch ${FILES[name]}: ${res.status}`);
    const data = await res.arrayBuffer();
    // Older Safari requires the callback form of decodeAudioData.
    const buffer = await new Promise<AudioBuffer>((resolve, reject) => {
      const ret = c.decodeAudioData(data, resolve, reject);
      if (ret instanceof Promise) ret.then(resolve, reject);
    });
    buffers.set(name, buffer);
  })();
  // Allow a retry on failure rather than caching the rejection forever.
  loading.set(name, p.catch(() => { loading.delete(name); }));
  return p;
}

/** Create the context and start decoding every sound. Call from a user
 *  gesture. Safe to call repeatedly — everything after the first is a no-op. */
export function prepareSounds(): void {
  for (const name of Object.keys(FILES) as SoundName[]) {
    void ensureLoaded(name).catch(() => { /* retried on next prepare/play */ });
  }
}

export async function playSound(name: SoundName): Promise<void> {
  try {
    await ensureLoaded(name);
    const buffer = buffers.get(name);
    if (!ctx || !buffer) return;
    // iOS sometimes leaves the context suspended after creation; resume()
    // succeeds silently if it's already running.
    if (ctx.state === 'suspended') await ctx.resume();
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    const gain = name === VINE_BOOM ? vineBoomGain : sfxGain;
    src.connect(gain ?? ctx.destination);
    src.start(0);
  } catch (err) {
    console.warn(`[sound] ${name} failed:`, err);
  }
}

// Every non-vine-boom effect — used by the settings page's SFX test button.
const SFX_NAMES = (Object.keys(FILES) as SoundName[]).filter((n) => n !== VINE_BOOM);

export function playRandomSfx(): void {
  const pick = SFX_NAMES[Math.floor(Math.random() * SFX_NAMES.length)]!;
  void playSound(pick);
}

export function playVineBoomTest(): void {
  void playSound(VINE_BOOM);
}
