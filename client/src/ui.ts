import { store } from './store.js';
import type { ClientState, PeerPresence } from './types.js';
import { ICONS, iconHtml } from './icons.js';
import { pairKeyStore, serverUrlKeyStore } from '@keystore';

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
  onSettingsSaved():   void;
  onToggleExitMeows(): void;
  onToggleDebugMode(): void;
  onSfxMuteToggle():   void;
  onVineBoomMuteToggle(): void;
  onSfxVolumeChange(value: number):      void;
  onVineBoomVolumeChange(value: number): void;
  onTestSfx():      void;
  onTestVineBoom(): void;
}

// DOM refs cached on mount (much faster than getElementById on every render)
interface Dom {
  screens: Record<'connecting' | 'lobby' | 'room' | 'failed' | 'auth', HTMLElement>;
  lobbyPreview:  HTMLVideoElement;
  remoteVideo:   HTMLVideoElement;
  localVideo:    HTMLVideoElement;
  screenPip:     HTMLVideoElement;
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
  settingsExitMeows: HTMLButtonElement;
  settingsOpenPage:  HTMLButtonElement;
  lobbySettingsBtn:    HTMLButtonElement;

  settingsPage:       HTMLElement;
  settingsPageClose:  HTMLButtonElement;
  sfxVolumeSlider:      HTMLInputElement;
  sfxMuteBtn:           HTMLButtonElement;
  sfxTestBtn:           HTMLButtonElement;
  vineBoomVolumeSlider: HTMLInputElement;
  vineBoomMuteBtn:      HTMLButtonElement;
  vineBoomTestBtn:      HTMLButtonElement;
  settingsPageExitMeows:    HTMLButtonElement;
  settingsPageKeyInput:     HTMLInputElement;
  settingsPageServerUrlRow: HTMLElement;
  settingsPageServerUrlInput: HTMLInputElement;
  settingsPageKeySave:        HTMLButtonElement;
  settingsPageDebugMode:      HTMLButtonElement;
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
    screenPip:     document.getElementById('screen-pip')    as HTMLVideoElement,
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
    settingsExitMeows: document.getElementById('settings-exit-meows') as HTMLButtonElement,
    settingsOpenPage:  document.getElementById('settings-open-page')  as HTMLButtonElement,
    lobbySettingsBtn:    document.getElementById('lobby-settings-btn')     as HTMLButtonElement,

    settingsPage:      document.getElementById('settings-page')!,
    settingsPageClose: document.getElementById('settings-page-close') as HTMLButtonElement,
    sfxVolumeSlider:      document.getElementById('sfx-volume-slider')      as HTMLInputElement,
    sfxMuteBtn:           document.getElementById('sfx-mute-btn')           as HTMLButtonElement,
    sfxTestBtn:           document.getElementById('sfx-test-btn')          as HTMLButtonElement,
    vineBoomVolumeSlider: document.getElementById('vineboom-volume-slider') as HTMLInputElement,
    vineBoomMuteBtn:      document.getElementById('vineboom-mute-btn')     as HTMLButtonElement,
    vineBoomTestBtn:      document.getElementById('vineboom-test-btn')     as HTMLButtonElement,
    settingsPageExitMeows:  document.getElementById('settings-page-exit-meows') as HTMLButtonElement,
    settingsPageKeyInput:   document.getElementById('settings-page-key-input')  as HTMLInputElement,
    settingsPageServerUrlRow:   document.getElementById('settings-page-server-url-row')!,
    settingsPageServerUrlInput: document.getElementById('settings-page-server-url-input') as HTMLInputElement,
    settingsPageKeySave:        document.getElementById('settings-page-key-save')  as HTMLButtonElement,
    settingsPageDebugMode:      document.getElementById('settings-page-debug-mode') as HTMLButtonElement,
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

  // Room settings — gear toggles its dropdown, clicks outside close it.
  dom.settingsBtn.onclick = (e) => {
    e.stopPropagation();
    dom.settingsMenu.classList.toggle('hidden');
  };
  dom.settingsHideSelf.onclick = (e) => {
    e.stopPropagation();
    handlers.onToggleHideSelf();
  };
  dom.settingsExitMeows.onclick = (e) => {
    e.stopPropagation();
    handlers.onToggleExitMeows();
  };
  dom.settingsOpenPage.onclick = (e) => {
    e.stopPropagation();
    dom.settingsMenu.classList.add('hidden');
    openSettingsPage();
  };

  const settingsPairs: Array<[HTMLButtonElement, HTMLElement]> = [
    [dom.settingsBtn, dom.settingsMenu],
  ];
  for (const [, menu] of settingsPairs) {
    // Swallow inside-menu clicks so the document handler below doesn't close it.
    menu.addEventListener('click', (e) => e.stopPropagation());
  }
  document.addEventListener('pointerdown', (e) => {
    for (const [btn, menu] of settingsPairs) {
      if (menu.classList.contains('hidden')) continue;
      if (e.target === btn || btn.contains(e.target as Node)) continue;
      if (menu.contains(e.target as Node)) continue;
      menu.classList.add('hidden');
    }
  });

  // Full settings page — opened directly from the lobby button (no dropdown)
  // or from the room popup's "Settings" item. A fixed overlay, not a screen;
  // it never touches store.phase so the call underneath keeps running.
  dom.lobbySettingsBtn.onclick = (e) => {
    e.stopPropagation();
    openSettingsPage();
  };
  dom.settingsPageClose.onclick = () => closeSettingsPage();
  dom.settingsPageExitMeows.onclick = () => handlers.onToggleExitMeows();
  dom.settingsPageDebugMode.onclick = () => handlers.onToggleDebugMode();
  dom.sfxMuteBtn.onclick      = () => handlers.onSfxMuteToggle();
  dom.vineBoomMuteBtn.onclick = () => handlers.onVineBoomMuteToggle();
  dom.sfxTestBtn.onclick      = () => handlers.onTestSfx();
  dom.vineBoomTestBtn.onclick = () => handlers.onTestVineBoom();
  dom.sfxVolumeSlider.oninput      = () => handlers.onSfxVolumeChange(Number(dom.sfxVolumeSlider.value));
  dom.vineBoomVolumeSlider.oninput = () => handlers.onVineBoomVolumeChange(Number(dom.vineBoomVolumeSlider.value));
  dom.settingsPageKeySave.onclick = () => {
    const newKey = dom.settingsPageKeyInput.value.trim();
    if (!newKey) return;
    void (async () => {
      await pairKeyStore.set(newKey);
      if (__PLATFORM__ !== 'web') {
        const url = dom.settingsPageServerUrlInput.value.trim();
        if (url) await serverUrlKeyStore.set(url);
      }
      handlers.onSettingsSaved();
    })();
  };

  function openSettingsPage(): void {
    dom.settingsPage.classList.remove('hidden');
    void pairKeyStore.get().then((v) => { dom.settingsPageKeyInput.value = v ?? ''; });
    if (__PLATFORM__ !== 'web') {
      dom.settingsPageServerUrlRow.classList.remove('hidden');
      void serverUrlKeyStore.get().then((v) => {
        dom.settingsPageServerUrlInput.value = v ?? __SERVER_BASE_URL_DEFAULT__;
      });
    }
  }
  function closeSettingsPage(): void {
    dom.settingsPage.classList.add('hidden');
  }

  // Screen-share button is always shown. Android Chrome supports
  // getDisplayMedia; if a browser doesn't, the click fails and surfaces a
  // toast (see handleScreenShare) instead of the button silently vanishing.

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
  dom.settingsBtn.innerHTML       = iconHtml(ICONS.settings);
  dom.lobbySettingsBtn.innerHTML  = `${iconHtml(ICONS.settings)}<span>Settings</span>`;
  dom.sfxMuteBtn.innerHTML      = iconHtml(ICONS.mutedSpeaker);
  dom.vineBoomMuteBtn.innerHTML = iconHtml(ICONS.mutedSpeaker);

  setupRoomControlAutoFade();
  setupLocalPipDrag();
  setupPipDrag(dom.screenPip);
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
  setupPipDrag(dom.localVideo);
}

function setupPipDrag(v: HTMLVideoElement): void {
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
let lastLocalHidden = false;
let lastPeerPresence: PeerPresence | null = null;
let lastPhase: ClientState['phase'] | null = null;

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
    // The `autoplay` attribute only fires on initial load — after a srcObject
    // swap (camera switch, screenshare start) the element stays paused
    // unless we kick it. Same call for both elements so neither freezes.
    void dom.lobbyPreview.play().catch(() => {});
    void dom.localVideo.play().catch(() => {});
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
  // One-shot effects for exactly these two transitions — nothing else.
  if (lastPeerPresence === 'disconnected' && s.peerPresence === 'lobby') {
    triggerLobbyStatusEffect('sparkle');
  } else if (lastPeerPresence === 'lobby' && s.peerPresence === 'room') {
    triggerLobbyStatusEffect('shake');
  }
  lastPeerPresence = s.peerPresence;

  // Room — "other is in lobby" banner & overlay copy
  if (s.phase === 'room') {
    dom.lobbyBanner.classList.toggle('hidden', s.peerPresence !== 'lobby');
    setRoomOverlay(s);
  }
  // Auto-close the room settings dropdown on any actual phase change (not
  // every render) — e.g. leaving the room, or the settings page's own
  // "save & reconnect" cycling back through 'connecting'.
  if (s.phase !== lastPhase) {
    dom.settingsMenu.classList.add('hidden');
    lastPhase = s.phase;
  }

  // ── Camera PiP visibility (#local) ────────────────────────────────────
  // Only ever shows the camera, never the screenshare. Hidden when:
  //   - not in the room
  //   - camera off (nothing to show)
  //   - screensharing (screen-pip takes over the slot)
  //   - user toggled "Hide my camera" in settings
  const showLocal =
    s.phase === 'room' && !s.camOff && !s.screenSharing && !s.hideSelfView;
  dom.localVideo.classList.toggle('hidden', !showLocal);
  if (lastLocalHidden && showLocal) {
    void dom.localVideo.play().catch(() => {});
  }
  lastLocalHidden = !showLocal;

  // ── Screen PiP (#screen-pip) — fully independent path ────────────────
  // Bound to a dedicated MediaStream wrapping only the screen track, so
  // nothing in the camera-side logic (track-id tracking, srcObject swaps,
  // hide class on #local) can interfere with screenshare display.
  renderScreenPip(s);

  // Settings checkbox state
  dom.settingsHideSelf.classList.toggle('on', s.hideSelfView);
  dom.settingsHideSelf.setAttribute('aria-checked', s.hideSelfView ? 'true' : 'false');

  // "Mute exit meows" is phrased as a mute toggle, but the state it reflects
  // (exitMeowsEnabled) is the inverse — on means "you CAN hear them leave".
  const exitMeowsMuted = !s.exitMeowsEnabled;
  for (const btn of [dom.settingsExitMeows, dom.settingsPageExitMeows]) {
    btn.classList.toggle('on', exitMeowsMuted);
    btn.setAttribute('aria-checked', exitMeowsMuted ? 'true' : 'false');
  }

  dom.settingsPageDebugMode.classList.toggle('on', s.debugMode);
  dom.settingsPageDebugMode.setAttribute('aria-checked', s.debugMode ? 'true' : 'false');
  document.documentElement.classList.toggle('debug-mode', s.debugMode);

  // SFX / vine boom sliders + mute buttons — reflect persisted state, but
  // only write when it actually differs so an in-progress drag isn't clobbered.
  if (Number(dom.sfxVolumeSlider.value) !== s.sfxVolume) {
    dom.sfxVolumeSlider.value = String(s.sfxVolume);
  }
  dom.sfxMuteBtn.classList.toggle('on', s.sfxMuted);
  if (Number(dom.vineBoomVolumeSlider.value) !== s.vineBoomVolume) {
    dom.vineBoomVolumeSlider.value = String(s.vineBoomVolume);
  }
  dom.vineBoomMuteBtn.classList.toggle('on', s.vineBoomMuted);

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

// Fires a one-shot CSS animation on the lobby status text. Removes any
// previous effect class and forces a reflow first so the same effect can
// retrigger if the same transition happens again shortly after.
function triggerLobbyStatusEffect(effect: 'sparkle' | 'shake'): void {
  const el = dom.lobbyStatus;
  el.classList.remove('sparkle', 'shake');
  void el.offsetWidth; // force reflow
  el.classList.add(effect);
  el.addEventListener('animationend', () => el.classList.remove(effect), { once: true });
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

// Track the last-bound screen stream's identity so we only call play() once
// per fresh stream, not on every render tick.
let lastScreenStreamId: string | null = null;

function renderScreenPip(s: ClientState): void {
  const show = s.phase === 'room' && !!s.screenStream && !s.hideSelfView;
  const el = dom.screenPip;

  if (show && s.screenStream) {
    if (s.screenStream.id !== lastScreenStreamId) {
      el.srcObject = s.screenStream;
      lastScreenStreamId = s.screenStream.id;
      // Mobile / autoplay-after-rebind hedge: kick playback explicitly.
      void el.play().catch(() => {});
    }
    el.classList.remove('hidden');
  } else {
    el.classList.add('hidden');
    if (lastScreenStreamId) {
      el.srcObject = null;
      lastScreenStreamId = null;
    }
  }
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

// ── Transient toast ──────────────────────────────────────────────────────────
let toastTimer: ReturnType<typeof setTimeout> | null = null;

/** Show a short status message that fades out on its own. Used for failures
 *  that would otherwise be invisible (e.g. screen share failing on mobile). */
export function showToast(message: string, ms = 3500): void {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), ms);
}
