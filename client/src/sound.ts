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

type AudioCtxCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
const buffers = new Map<SoundName, AudioBuffer>();
const loading = new Map<SoundName, Promise<void>>();

function ensureContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = (window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext) as AudioCtxCtor | undefined;
  if (!Ctor) return null;
  ctx = new Ctor();
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
    src.connect(ctx.destination);
    src.start(0);
  } catch (err) {
    console.warn(`[sound] ${name} failed:`, err);
  }
}
