import { store } from './store.js';
import type { ClientState, PeerPresence } from './types.js';
import { ICONS, iconHtml } from './icons.js';

// getDisplayMedia is absent on iOS Safari and some older mobile browsers.
// The button is hidden on those platforms rather than silently failing.
// Chrome on Android supports it and shows the button normally.
const SCREEN_SHARE_SUPPORTED =
  typeof navigator !== 'undefined' &&
  !!navigator.mediaDevices &&
  typeof (navigator.mediaDevices as MediaDevices & { getDisplayMedia?: unknown }).getDisplayMedia === 'function';

// Detect a "real" pointer device (mouse / trackpad) so we can scope :hover
// styles to it. Pure CSS `@media (hover: hover)` is unreliable — some
// Android Chrome builds report it as truthy on touch devices, which causes
// the synthetic :hover after a tap to stick and held the button at 0.7
// opacity even after unmute. We require BOTH hover AND a fine pointer,
// AND no touch capability, before opting in.
const HAS_REAL_HOVER =
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(hover: hover)').matches &&
  window.matchMedia('(pointer: fine)').matches &&
  !window.matchMedia('(pointer: coarse)').matches &&
  !('ontouchstart' in window);

export interface UiHandlers {
  onMicToggle():       void;
  onCamToggle():       void;
  onCameraPick(deviceId: string): void;
  onEnterRoom():       void;
  onLeaveRoom():       void;
  onScreenShare():     void;
  onCameraFlip():      void;
  onRetry():           void;
  onToggleHideSelf():  void;
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
  roomBtnFlip:   HTMLButtonElement;
  roomBtnLeave:  HTMLButtonElement;
  roomOverlay:   HTMLElement;
  lobbyBanner:   HTMLElement;
  footer:        HTMLElement;
  failedMsg:     HTMLElement;
  retryBtn:      HTMLButtonElement;
  unmuteOverlay: HTMLElement;
  controls:      HTMLElement;
  settingsBtn:      HTMLButtonElement;
  settingsMenu:     HTMLElement;
  settingsHideSelf: HTMLButtonElement;
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
    roomBtnFlip:   document.getElementById('room-btn-flip')   as HTMLButtonElement,
    roomBtnLeave:  document.getElementById('room-btn-leave')  as HTMLButtonElement,
    roomOverlay:   document.getElementById('room-overlay')!,
    lobbyBanner:   document.getElementById('lobby-banner')!,
    footer:        document.getElementById('footer')!,
    failedMsg:     document.getElementById('failed-msg')!,
    retryBtn:      document.getElementById('retry-btn') as HTMLButtonElement,
    unmuteOverlay: document.getElementById('unmute-overlay')!,
    controls:      document.querySelector('#screen-room .controls') as HTMLElement,
    settingsBtn:      document.getElementById('settings-btn')        as HTMLButtonElement,
    settingsMenu:     document.getElementById('settings-menu')!,
    settingsHideSelf: document.getElementById('settings-hide-self')  as HTMLButtonElement,
  };

  // Wire handlers
  dom.lobbyBtnMic.onclick   = handlers.onMicToggle;
  dom.lobbyBtnCam.onclick   = handlers.onCamToggle;
  dom.lobbyBtnEnter.onclick = handlers.onEnterRoom;
  dom.roomBtnMic.onclick    = handlers.onMicToggle;
  dom.roomBtnCam.onclick    = handlers.onCamToggle;
  dom.roomBtnScreen.onclick = handlers.onScreenShare;
  dom.roomBtnFlip.onclick   = handlers.onCameraFlip;
  dom.roomBtnLeave.onclick  = handlers.onLeaveRoom;
  dom.retryBtn.onclick      = handlers.onRetry;
  dom.cameraPicker.onchange = () => handlers.onCameraPick(dom.cameraPicker.value);

  // Settings menu — gear toggles the dropdown, clicks outside close it.
  dom.settingsBtn.onclick = (e) => {
    e.stopPropagation();
    dom.settingsMenu.classList.toggle('hidden');
  };
  dom.settingsHideSelf.onclick = (e) => {
    e.stopPropagation();
    handlers.onToggleHideSelf();
  };
  // Swallow inside-menu clicks so the document handler below doesn't close it.
  dom.settingsMenu.addEventListener('click', (e) => e.stopPropagation());
  document.addEventListener('pointerdown', (e) => {
    if (dom.settingsMenu.classList.contains('hidden')) return;
    if (e.target === dom.settingsBtn || dom.settingsBtn.contains(e.target as Node)) return;
    if (dom.settingsMenu.contains(e.target as Node)) return;
    dom.settingsMenu.classList.add('hidden');
  });

  // Hide on platforms where getDisplayMedia is absent (iOS Safari, etc.)
  if (!SCREEN_SHARE_SUPPORTED) dom.roomBtnScreen.style.display = 'none';

  // Gate :hover styles on confirmed pointer devices only. CSS without this
  // class never matches `.has-hover .ctrl-btn:hover`, so touch screens
  // can't get stuck in a hover state.
  if (HAS_REAL_HOVER) document.documentElement.classList.add('has-hover');

  // Button icons are static — mute state is conveyed via the .muted class
  // (red background), not by swapping the icon.
  dom.lobbyBtnMic.innerHTML   = iconHtml(ICONS.mic);
  dom.lobbyBtnCam.innerHTML   = iconHtml(ICONS.cam);
  dom.roomBtnMic.innerHTML    = iconHtml(ICONS.mic);
  dom.roomBtnCam.innerHTML    = iconHtml(ICONS.cam);
  dom.roomBtnScreen.innerHTML = iconHtml(ICONS.screen);
  dom.roomBtnFlip.innerHTML   = iconHtml(ICONS.flip);
  dom.roomBtnLeave.innerHTML  = iconHtml(ICONS.door);
  dom.lobbyBtnEnter.innerHTML = `${iconHtml(ICONS.door)}<span>Enter</span>`;
  dom.settingsBtn.innerHTML   = iconHtml(ICONS.settings);

  setupRoomControlAutoFade();
  setupLocalPipDrag();
  setupLocalAspectSync();

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

// Keep the PiP's aspect ratio glued to the underlying stream's intrinsic
// dimensions. Width is fixed in CSS; height follows. Avoids a transparent
// letterbox showing through the box-shadow when the camera's aspect ratio
// (e.g. 4:3) differs from the default container shape.
function setupLocalAspectSync(): void {
  const v = dom.localVideo;
  const sync = (): void => {
    if (v.videoWidth && v.videoHeight) {
      v.style.aspectRatio = `${v.videoWidth} / ${v.videoHeight}`;
    }
  };
  v.addEventListener('loadedmetadata', sync);
  // Fires when intrinsic size changes (camera switch, screenshare, etc.)
  v.addEventListener('resize', sync);
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

// Track the last attached stream so we don't redundantly rewrite srcObject.
// We also track the video track ID separately: on mobile, the stream object
// stays the same after a camera switch (stable identity) but the underlying
// track changes. Mobile browsers don't reactively repaint when tracks are
// swapped on an existing stream — we must null + reassign srcObject.
let lastLocalStreamId: string | null = null;
let lastLocalVideoTrackId: string | null = null;
let lastRemoteStreamId: string | null = null;

function render(s: ClientState): void {
  // Active screen
  setActiveScreen(s.phase);

  // Local video preview — both lobby and room reuse the same source.
  // Check video track ID too: after a camera switch the stream object is
  // identical but the active track changes; mobile needs a null + reassign
  // to actually repaint.
  const localVideoTrackId = s.localStream?.getVideoTracks()[0]?.id ?? null;
  if (s.localStream && (
    s.localStream.id !== lastLocalStreamId ||
    localVideoTrackId !== lastLocalVideoTrackId
  )) {
    dom.lobbyPreview.srcObject = null;
    dom.localVideo.srcObject   = null;
    dom.lobbyPreview.srcObject = s.localStream;
    dom.localVideo.srcObject   = s.localStream;
    void dom.lobbyPreview.play().catch(() => {});
    lastLocalStreamId      = s.localStream.id;
    lastLocalVideoTrackId  = localVideoTrackId;
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

  // Mic / cam button states — icon is static; .muted class shows the state
  for (const btn of [dom.lobbyBtnMic, dom.roomBtnMic]) {
    btn.classList.toggle('muted', s.micMuted);
    btn.title = s.micMuted ? 'Unmute' : 'Mute';
  }
  for (const btn of [dom.lobbyBtnCam, dom.roomBtnCam]) {
    btn.classList.toggle('muted', s.camOff);
    btn.title = s.camOff ? 'Turn camera on' : 'Turn camera off';
  }
  dom.roomBtnScreen.classList.toggle('active', s.screenSharing);
  dom.roomBtnFlip.style.display = s.cameras.length >= 2 ? '' : 'none';

  // Lobby status text — three states per spec
  dom.lobbyStatus.classList.remove('peer-room', 'peer-lobby');
  if (s.peerPresence === 'room') {
    dom.lobbyStatus.textContent = 'MWAP is in the meeting.';
    dom.lobbyStatus.classList.add('peer-room');
  } else if (s.peerPresence === 'lobby') {
    dom.lobbyStatus.textContent = 'MWAP is getting ready to join.';
    dom.lobbyStatus.classList.add('peer-lobby');
  } else {
    dom.lobbyStatus.textContent = "No one's here.";
  }

  // Room — "other is in lobby" banner & overlay copy
  if (s.phase === 'room') {
    dom.lobbyBanner.classList.toggle('hidden', s.peerPresence !== 'lobby');
    setRoomOverlay(s);
    dom.localVideo.classList.toggle('screen', s.screenSharing);
  } else {
    // Settings menu only makes sense in the room — auto-close on leave.
    dom.settingsMenu.classList.add('hidden');
  }

  // Self-PiP visibility. Auto-hide when there is no outgoing video to show
  // (cam off AND not screensharing) OR when the user has opted to hide it
  // via the settings menu. The lobby preview is a separate element, so the
  // placeholder there is always visible.
  // NB: gating on screenSharing (not camOff alone) is what keeps the
  // screenshare preview visible when the camera is logically off.
  const hideSelfAuto = s.camOff && !s.screenSharing;
  const shouldHideLocal = s.phase === 'room' && (s.hideSelfView || hideSelfAuto);
  dom.localVideo.classList.toggle('hidden', shouldHideLocal);

  // Settings checkbox state
  dom.settingsHideSelf.classList.toggle('on', s.hideSelfView);
  dom.settingsHideSelf.setAttribute('aria-checked', s.hideSelfView ? 'true' : 'false');

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
  return 'Waiting...';
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
