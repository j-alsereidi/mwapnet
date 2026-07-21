// Live mic input-level meter for the desktop settings page. Captures the
// chosen device *independently* of the call's audio track, so the meter still
// responds while the call mic is muted (a mic test that goes flat when you're
// muted is useless) and can never disturb the live outgoing stream.
//
// The analyser is deliberately NOT connected to the context destination —
// routing the mic to the speakers would cause feedback.

type AudioCtxCtor = typeof AudioContext;

/** RMS of a getByteTimeDomainData buffer (128 = silence), scaled to ~0-1 for
 *  the meter bar. Pure, so it can be checked without Web Audio. */
export function rmsLevel(data: Uint8Array): number {
  let sum = 0;
  for (const v of data) {
    const x = (v - 128) / 128;
    sum += x * x;
  }
  const rms = Math.sqrt(sum / data.length);
  return Math.min(1, rms * 2.5); // normal speech roughly fills the bar
}

/** Start metering `deviceId` (or the default mic when undefined). Resolves to
 *  a stop function that tears down the rAF loop, capture stream, and context. */
export async function startMicMeter(
  deviceId: string | undefined,
  onLevel: (level: number) => void,
): Promise<() => void> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: deviceId ? { deviceId: { exact: deviceId } } : true,
    video: false,
  });

  const Ctor = (window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioCtxCtor }).webkitAudioContext) as AudioCtxCtor;
  const ctx = new Ctor();
  const source = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);

  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let stopped = false;

  function tick(): void {
    analyser.getByteTimeDomainData(data);
    onLevel(rmsLevel(data));
    raf = requestAnimationFrame(tick);
  }

  if (ctx.state === 'suspended') await ctx.resume();
  tick();

  return () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    for (const t of stream.getTracks()) t.stop();
    void ctx.close();
    onLevel(0);
  };
}
