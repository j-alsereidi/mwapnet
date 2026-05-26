import { store } from './store.js';
import type { ClientState } from './types.js';

export interface UiHandlers {
  onMicToggle(): void;
  onCamToggle(): void;
  onHangup(): void;
  onRetry(): void;
}

let fadeTimer: ReturnType<typeof setTimeout> | null = null;

export function mountUi(handlers: UiHandlers): void {
  const overlay    = document.getElementById('overlay')!;
  const overlaySub = document.getElementById('overlay-sub')!;
  const retryBtn   = document.getElementById('retry-btn') as HTMLButtonElement;
  const btnMic     = document.getElementById('btn-mic') as HTMLButtonElement;
  const btnCam     = document.getElementById('btn-cam') as HTMLButtonElement;
  const btnHangup  = document.getElementById('btn-hangup') as HTMLButtonElement;
  const controls   = document.getElementById('controls')!;
  const footer     = document.getElementById('footer')!;
  const localVideo = document.getElementById('local') as HTMLVideoElement;

  btnMic.onclick    = handlers.onMicToggle;
  btnCam.onclick    = handlers.onCamToggle;
  btnHangup.onclick = handlers.onHangup;
  retryBtn.onclick  = handlers.onRetry;

  // Controls auto-fade after 3s of pointer inactivity
  function revealControls() {
    controls.style.opacity = '1';
    if (fadeTimer) clearTimeout(fadeTimer);
    fadeTimer = setTimeout(() => { controls.style.opacity = '0'; }, 3000);
  }
  document.addEventListener('pointermove', revealControls);
  document.addEventListener('pointerdown', revealControls);

  // Draggable local PiP via pointer events (no JS library needed)
  let dragging = false;
  let offX = 0, offY = 0;

  localVideo.addEventListener('pointerdown', (e) => {
    dragging = true;
    localVideo.setPointerCapture(e.pointerId);
    const r = localVideo.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(e.clientX - offX, window.innerWidth  - localVideo.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - offY, window.innerHeight - localVideo.offsetHeight));
    localVideo.style.left   = `${x}px`;
    localVideo.style.top    = `${y}px`;
    localVideo.style.right  = 'auto';
    localVideo.style.bottom = 'auto';
  });
  document.addEventListener('pointerup', () => { dragging = false; });

  store.subscribe(render);
  render(store.get());
}

function render(s: ClientState): void {
  const overlay    = document.getElementById('overlay')!;
  const overlaySub = document.getElementById('overlay-sub')!;
  const retryBtn   = document.getElementById('retry-btn') as HTMLButtonElement;
  const btnMic     = document.getElementById('btn-mic') as HTMLButtonElement;
  const btnCam     = document.getElementById('btn-cam') as HTMLButtonElement;
  const footer     = document.getElementById('footer')!;

  // Overlay visibility / messaging
  switch (s.phase) {
    case 'idle':
      overlay.classList.remove('hidden');
      overlaySub.textContent = 'One room. Just you two.';
      retryBtn.classList.add('hidden');
      break;
    case 'connecting-signal':
      overlay.classList.remove('hidden');
      overlaySub.textContent = 'Connecting to server…';
      retryBtn.classList.add('hidden');
      break;
    case 'waiting-for-peer':
      overlay.classList.remove('hidden');
      overlaySub.textContent = 'Waiting for the other one.';
      retryBtn.classList.add('hidden');
      break;
    case 'negotiating':
      overlay.classList.remove('hidden');
      overlaySub.textContent = 'Linking up…';
      retryBtn.classList.add('hidden');
      break;
    case 'reconnecting':
      overlay.classList.add('hidden');
      break;
    case 'connected':
      overlay.classList.add('hidden');
      break;
    case 'failed':
      overlay.classList.remove('hidden');
      overlaySub.textContent = s.lastError ?? 'Connection failed.';
      retryBtn.classList.remove('hidden');
      break;
  }

  // Control button states
  btnMic.classList.toggle('muted', s.micMuted);
  btnMic.textContent = s.micMuted ? '🔇' : '🎤';
  btnMic.title = s.micMuted ? 'Unmute mic' : 'Mute mic';

  btnCam.classList.toggle('muted', s.camOff);
  btnCam.textContent = s.camOff ? '🚫' : '📷';
  btnCam.title = s.camOff ? 'Turn camera on' : 'Turn camera off';

  // Connection type indicator
  if (s.phase === 'connected') {
    if (s.connectionType === 'relayed') footer.textContent = 'relayed via TURN';
    else if (s.connectionType === 'direct') footer.textContent = 'direct';
    else footer.textContent = '';
  } else if (s.phase === 'reconnecting') {
    footer.textContent = 'reconnecting…';
  } else {
    footer.textContent = '';
  }
}
