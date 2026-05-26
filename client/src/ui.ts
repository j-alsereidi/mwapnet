import { store } from './store.js';
import type { ClientState, PeerPresence } from './types.js';

export interface UiHandlers {
  onMicToggle():   void;
  onCamToggle():   void;
  onCameraPick(deviceId: string): void;
  onEnterRoom():   void;
  onLeaveRoom():   void;
  onScreenShare(): void;
  onRetry():       void;
}

// DOM refs cached on mount (much faster than getElementById on every render)
interface Dom {
  screens: Record<'connecting' | 'lobby' | 'room' | 'failed' | 'auth', HTMLElement>;
  lobbyPreview:  HTMLVideoElement;
  remoteVideo:   HTMLVideoElement;
  localVideo:    HTMLVideoElement;
  cameraPicker:  HTMLSelectElement;
  lobbyBtnMic:   HTMLButtonElement;
  lobbyBtnCam:   HTMLButtonElement;
  lobbyBtnEnter: HTMLButtonElement;
  lobbyStatus:   HTMLElement;
  roomBtnMic:    HTMLButtonElement;
  roomBtnCam:    HTMLButtonElement;
  roomBtnScreen: HTMLButtonElement;
  roomBtnLeave:  HTMLButtonElement;
  roomOverlay:   HTMLElement;
  lobbyBanner:   HTMLElement;
  footer:        HTMLElement;
  failedMsg:     HTMLElement;
  retryBtn:      HTMLButtonElement;
  unmuteOverlay: HTMLElement;
  controls:      HTMLElement;
}

let dom: Dom;
let controlsFadeTimer: ReturnType<typeof setTimeout> | null = null;

export function mountUi(handlers: UiHandlers): void {
  dom = {
    screens: {
      connecting: document.getElementById('screen-connecting')!,
      lobby:      document.getElementById('screen-lobby')!,
      room:       document.getElementById('screen-room')!,
      failed:     document.getElementById('screen-failed')!,
      auth:       document.getElementById('screen-auth')!,
    },
    lobbyPreview:  document.getElementById('lobby-preview') as HTMLVideoElement,
    remoteVideo:   document.getElementById('remote')        as HTMLVideoElement,
    localVideo:    document.getElementById('local')         as HTMLVideoElement,
    cameraPicker:  document.getElementById('camera-picker') as HTMLSelectElement,
    lobbyBtnMic:   document.getElementById('lobby-btn-mic') as HTMLButtonElement,
    lobbyBtnCam:   document.getElementById('lobby-btn-cam') as HTMLButtonElement,
    lobbyBtnEnter: document.getElementById('lobby-btn-enter') as HTMLButtonElement,
    lobbyStatus:   document.getElementById('lobby-status')!,
    roomBtnMic:    document.getElementById('room-btn-mic')    as HTMLButtonElement,
    roomBtnCam:    document.getElementById('room-btn-cam')    as HTMLButtonElement,
    roomBtnScreen: document.getElementById('room-btn-screen') as HTMLButtonElement,
    roomBtnLeave:  document.getElementById('room-btn-leave')  as HTMLButtonElement,
    roomOverlay:   document.getElementById('room-overlay')!,
    lobbyBanner:   document.getElementById('lobby-banner')!,
    footer:        document.getElementById('footer')!,
    failedMsg:     document.getElementById('failed-msg')!,
    retryBtn:      document.getElementById('retry-btn') as HTMLButtonElement,
    unmuteOverlay: document.getElementById('unmute-overlay')!,
    controls:      document.querySelector('#screen-room .controls') as HTMLElement,
  };

  // Wire handlers
  dom.lobbyBtnMic.onclick   = handlers.onMicToggle;
  dom.lobbyBtnCam.onclick   = handlers.onCamToggle;
  dom.lobbyBtnEnter.onclick = handlers.onEnterRoom;
  dom.roomBtnMic.onclick    = handlers.onMicToggle;
  dom.roomBtnCam.onclick    = handlers.onCamToggle;
  dom.roomBtnScreen.onclick = handlers.onScreenShare;
  dom.roomBtnLeave.onclick  = handlers.onLeaveRoom;
  dom.retryBtn.onclick      = handlers.onRetry;
  dom.cameraPicker.onchange = () => handlers.onCameraPick(dom.cameraPicker.value);

  setupRoomControlAutoFade();
  setupLocalPipDrag();

  store.subscribe(render);
  render(store.get());
}

function setupRoomControlAutoFade(): void {
  function reveal(): void {
    dom.controls.style.opacity = '1';
    if (controlsFadeTimer) clearTimeout(controlsFadeTimer);
    controlsFadeTimer = setTimeout(() => { dom.controls.style.opacity = '0'; }, 3000);
  }
  document.addEventListener('pointermove', reveal);
  document.addEventListener('pointerdown', reveal);
  reveal();
}

function setupLocalPipDrag(): void {
  const v = dom.localVideo;
  let dragging = false;
  let offX = 0, offY = 0;
  v.addEventListener('pointerdown', (e) => {
    dragging = true;
    v.setPointerCapture(e.pointerId);
    const r = v.getBoundingClientRect();
    offX = e.clientX - r.left;
    offY = e.clientY - r.top;
    e.preventDefault();
  });
  document.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(e.clientX - offX, window.innerWidth  - v.offsetWidth));
    const y = Math.max(0, Math.min(e.clientY - offY, window.innerHeight - v.offsetHeight));
    v.style.left   = `${x}px`;
    v.style.top    = `${y}px`;
    v.style.right  = 'auto';
    v.style.bottom = 'auto';
  });
  document.addEventListener('pointerup', () => { dragging = false; });
}

// Track the last attached stream so we don't redundantly rewrite srcObject
let lastLocalStreamId: string | null = null;
let lastRemoteStreamId: string | null = null;

function render(s: ClientState): void {
  // Active screen
  setActiveScreen(s.phase);

  // Local video preview — both lobby and room reuse the same source
  if (s.localStream && s.localStream.id !== lastLocalStreamId) {
    dom.lobbyPreview.srcObject = s.localStream;
    dom.localVideo.srcObject   = s.localStream;
    lastLocalStreamId = s.localStream.id;
  }

  // Remote video — only show if RTC is actually connected
  if (s.remoteStream && s.phase === 'room' && s.rtcConnected) {
    if (s.remoteStream.id !== lastRemoteStreamId) {
      dom.remoteVideo.srcObject = s.remoteStream;
      lastRemoteStreamId = s.remoteStream.id;
      dom.remoteVideo.play().catch(() => showUnmuteOverlay());
    }
    dom.remoteVideo.classList.remove('hidden');
  } else {
    dom.remoteVideo.classList.add('hidden');
    if (!s.remoteStream) {
      dom.remoteVideo.srcObject = null;
      lastRemoteStreamId = null;
    }
  }

  // Camera dropdown
  syncCameraPicker(s);

  // Mic / cam button states (shared between lobby + room)
  for (const btn of [dom.lobbyBtnMic, dom.roomBtnMic]) {
    btn.classList.toggle('muted', s.micMuted);
    btn.textContent = s.micMuted ? '🔇' : '🎤';
    btn.title = s.micMuted ? 'Unmute' : 'Mute';
  }
  for (const btn of [dom.lobbyBtnCam, dom.roomBtnCam]) {
    btn.classList.toggle('muted', s.camOff);
    btn.textContent = s.camOff ? '🚫' : '📷';
    btn.title = s.camOff ? 'Turn camera on' : 'Turn camera off';
  }
  dom.roomBtnScreen.classList.toggle('active', s.screenSharing);

  // Lobby status text — three states per spec
  dom.lobbyStatus.classList.remove('peer-room', 'peer-lobby');
  if (s.peerPresence === 'room') {
    dom.lobbyStatus.textContent = 'The other is in the meeting.';
    dom.lobbyStatus.classList.add('peer-room');
  } else if (s.peerPresence === 'lobby') {
    dom.lobbyStatus.textContent = 'The other is in the lobby.';
    dom.lobbyStatus.classList.add('peer-lobby');
  } else {
    dom.lobbyStatus.textContent = "No one's here.";
  }

  // Room — "other is in lobby" banner & overlay copy
  if (s.phase === 'room') {
    dom.lobbyBanner.classList.toggle('hidden', s.peerPresence !== 'lobby');
    setRoomOverlay(s);
    dom.localVideo.classList.toggle('screen', s.screenSharing);
  }

  // Footer (connection type)
  if (s.phase === 'room' && s.rtcConnected) {
    dom.footer.textContent =
      s.connectionType === 'relayed' ? 'relayed via TURN' :
      s.connectionType === 'direct'  ? 'direct' : '';
  } else {
    dom.footer.textContent = '';
  }

  // Failure copy
  if (s.phase === 'failed') {
    dom.failedMsg.textContent = s.lastError ?? 'Something went wrong.';
  }
}

function setActiveScreen(phase: ClientState['phase']): void {
  for (const key of Object.keys(dom.screens) as Array<keyof Dom['screens']>) {
    dom.screens[key].classList.toggle('active', key === phase);
  }
}

function setRoomOverlay(s: ClientState): void {
  // The overlay shows whenever the remote video is hidden in the room
  const text = roomOverlayText(s.peerPresence, s.rtcConnected);
  if (text) {
    dom.roomOverlay.textContent = text;
    dom.roomOverlay.classList.remove('hidden');
  } else {
    dom.roomOverlay.classList.add('hidden');
  }
}

function roomOverlayText(peer: PeerPresence, rtcConnected: boolean): string | null {
  if (rtcConnected) return null;
  if (peer === 'room')         return 'Linking up…';
  if (peer === 'lobby')        return null; // banner covers it
  return 'Waiting for the other one.';
}

function syncCameraPicker(s: ClientState): void {
  // Rebuild only if the list changed (count or any deviceId)
  const sel = dom.cameraPicker;
  const currentIds = Array.from(sel.options).map(o => o.value).join('|');
  const nextIds = s.cameras.map(c => c.deviceId).join('|');
  if (currentIds !== nextIds) {
    sel.innerHTML = '';
    for (const cam of s.cameras) {
      const opt = document.createElement('option');
      opt.value = cam.deviceId;
      opt.textContent = cam.label;
      sel.appendChild(opt);
    }
  }
  if (s.currentCameraId && sel.value !== s.currentCameraId) {
    sel.value = s.currentCameraId;
  }
  sel.disabled = s.cameras.length < 2;
}

function showUnmuteOverlay(): void {
  dom.unmuteOverlay.classList.remove('hidden');
  dom.unmuteOverlay.onclick = () => {
    dom.remoteVideo.play().catch(() => { /* user must interact again */ });
    dom.unmuteOverlay.classList.add('hidden');
  };
}
