// Camera-on chime. Played both locally and (via signaling) by the peer.
//
// Implemented with Web Audio API rather than an <audio> element because mobile
// browsers (especially iOS Safari) commonly truncate short MP3 clips played
// via HTMLAudioElement — the element gets reused, the file isn't fully
// buffered, and playback cuts off mid-clip. Decoding into an AudioBuffer
// once and replaying from there is sample-accurate on every platform.
//
// The AudioContext is created lazily on first use, which must coincide with
// a user gesture (mic/cam toggle, Enter button). After that, replay from any
// trigger — including a peer's network event — works without further gesture.

type AudioCtxCtor = typeof AudioContext;

class CameraSound {
  private ctx: AudioContext | null = null;
  private buffer: AudioBuffer | null = null;
  private loadPromise: Promise<void> | null = null;

  /** Kick off load + context creation. Safe to call multiple times. */
  prepare(): void {
    void this.ensureLoaded();
  }

  async play(): Promise<void> {
    try {
      await this.ensureLoaded();
      if (!this.ctx || !this.buffer) return;
      // iOS sometimes leaves the context suspended after creation; resume()
      // succeeds silently if it's already running.
      if (this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }
      const src = this.ctx.createBufferSource();
      src.buffer = this.buffer;
      src.connect(this.ctx.destination);
      src.start(0);
    } catch (err) {
      console.warn('[sound] play failed:', err);
    }
  }

  private ensureLoaded(): Promise<void> {
    if (this.buffer) return Promise.resolve();
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = (async () => {
      const Ctor = (window.AudioContext ??
        (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext) as AudioCtxCtor | undefined;
      if (!Ctor) throw new Error('Web Audio not supported');
      this.ctx = new Ctor();
      const res = await fetch('/sounds/cameraOn.mp3');
      if (!res.ok) throw new Error(`fetch ${res.status}`);
      const data = await res.arrayBuffer();
      // Older Safari requires the callback form of decodeAudioData.
      this.buffer = await new Promise<AudioBuffer>((resolve, reject) => {
        const ret = this.ctx!.decodeAudioData(data, resolve, reject);
        if (ret instanceof Promise) ret.then(resolve, reject);
      });
    })();
    return this.loadPromise;
  }
}

export const cameraSound = new CameraSound();
