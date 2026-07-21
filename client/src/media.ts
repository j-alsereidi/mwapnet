import type { CameraOption } from './types.js';

// Listeners for the "stream changed" event (camera switch, screenshare on/off, etc.)
type ChangeListener = (stream: MediaStream) => void;

/**
 * MediaManager owns the local outgoing MediaStream and lets you swap its
 * video track (camera switch, screenshare). Listeners are notified after
 * each change so the RTCRtpSenders can call replaceTrack().
 *
 * The stream identity stays stable across track swaps — we mutate the same
 * MediaStream object so video elements bound to it keep working.
 */
export class MediaManager {
  private stream: MediaStream = new MediaStream();
  private cameraTrack: MediaStreamTrack | null = null;
  private audioTrack: MediaStreamTrack | null = null;
  private screenTrack: MediaStreamTrack | null = null;
  private screenAudioTrack: MediaStreamTrack | null = null;
  private currentCameraId: string | null = null;
  private currentMicId: string | null = null;
  private listeners = new Set<ChangeListener>();

  getStream(): MediaStream {
    return this.stream;
  }

  // The MAIN outgoing video: screen when sharing, else camera.
  getVideoTrack(): MediaStreamTrack | null {
    return this.screenTrack ?? this.cameraTrack;
  }

  // The camera as a SECOND outgoing video, sent only while also screen-sharing
  // (otherwise the camera is already the main track). Lets the peer show
  // screen + camera at once.
  getExtraCameraTrack(): MediaStreamTrack | null {
    return this.screenTrack && this.cameraTrack ? this.cameraTrack : null;
  }

  getAudioTrack(): MediaStreamTrack | null {
    return this.audioTrack;
  }

  isScreenSharing(): boolean {
    return this.screenTrack !== null;
  }

  getScreenTrack(): MediaStreamTrack | null {
    return this.screenTrack;
  }

  getScreenAudioTrack(): MediaStreamTrack | null {
    return this.screenAudioTrack;
  }

  currentCamera(): string | null {
    return this.currentCameraId;
  }

  onChange(fn: ChangeListener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(): void {
    for (const fn of this.listeners) fn(this.stream);
  }

  /** First-time acquisition — call after user gesture. */
  async acquire(): Promise<void> {
    const media = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    this.cameraTrack = media.getVideoTracks()[0] ?? null;
    this.audioTrack  = media.getAudioTracks()[0] ?? null;
    this.currentCameraId = this.cameraTrack?.getSettings().deviceId ?? null;
    this.currentMicId    = this.audioTrack?.getSettings().deviceId ?? null;
    this.rebuildStream();
    this.emit();
  }

  /** List available cameras. Labels are only filled in after permission is granted. */
  async listCameras(): Promise<CameraOption[]> {
    const devices = await navigator.mediaDevices.enumerateDevices();
    return devices
      .filter(d => d.kind === 'videoinput')
      .map(d => ({ deviceId: d.deviceId, label: d.label || 'Camera' }));
  }

  /** Switch the mic feeding the call. Mirrors switchCamera: stop the old
   *  track first, then acquire the new one, then emit so the RTP sender's
   *  replaceTrack picks it up. Mute state is re-applied by the caller. */
  async switchMicrophone(deviceId: string): Promise<void> {
    if (deviceId === this.currentMicId) return;
    this.audioTrack?.stop();
    this.audioTrack = null;
    const next = await navigator.mediaDevices.getUserMedia({
      audio: { deviceId: { exact: deviceId } },
      video: false,
    });
    const newTrack = next.getAudioTracks()[0];
    if (!newTrack) return;
    this.audioTrack = newTrack;
    this.currentMicId = deviceId;
    this.rebuildStream();
    this.emit();
  }

  /** Switch to a different camera. If screensharing, the switch still happens
   *  under the hood — the screen track stays in the video slot until stopped. */
  async switchCamera(deviceId: string): Promise<void> {
    if (deviceId === this.currentCameraId) return;
    // Stop the old track BEFORE requesting the new camera. On mobile, two
    // cameras cannot be open simultaneously — keeping the old one alive while
    // calling getUserMedia for the new one causes the request to hang/freeze.
    this.cameraTrack?.stop();
    this.cameraTrack = null;
    const next = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId } },
      audio: false,
    });
    const newTrack = next.getVideoTracks()[0];
    if (!newTrack) return;
    this.cameraTrack = newTrack;
    this.currentCameraId = deviceId;
    if (!this.screenTrack) this.rebuildStream();
    this.emit();
  }

  /** Start screen capture. Replaces video output (audio unchanged).
   *  Browser-driven stop (user clicks "stop sharing" in OS bar) is handled
   *  via the track's onended event. */
  async startScreenShare(): Promise<void> {
    if (this.screenTrack) return;
    // audio: true adds a "share audio" checkbox to the browser's picker.
    // Chromium delivers audio for tab shares (all platforms) and full-screen
    // shares (Windows only — which covers the desktop app's WebView2);
    // window shares never carry audio. No track when unchecked/unsupported.
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });
    const track = display.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener('ended', () => { void this.stopScreenShare(); });
    this.screenTrack = track;
    // Kept OUT of this.stream — it rides its own RTP slot (see rtcSession),
    // and local preview elements must never play your own screen audio back.
    this.screenAudioTrack = display.getAudioTracks()[0] ?? null;
    this.rebuildStream();
    this.emit();
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenTrack) return;
    this.screenTrack.stop();
    this.screenTrack = null;
    this.screenAudioTrack?.stop();
    this.screenAudioTrack = null;
    this.rebuildStream();
    this.emit();
  }

  setMicMuted(muted: boolean): void {
    if (this.audioTrack) this.audioTrack.enabled = !muted;
  }

  setCamOff(off: boolean): void {
    if (this.cameraTrack) this.cameraTrack.enabled = !off;
  }

  destroy(): void {
    this.cameraTrack?.stop();
    this.audioTrack?.stop();
    this.screenTrack?.stop();
    this.screenAudioTrack?.stop();
    this.cameraTrack = this.audioTrack = this.screenTrack = this.screenAudioTrack = null;
    this.listeners.clear();
  }

  // Sync the local-preview MediaStream. It carries the CAMERA (never the
  // screen) so #local shows your face even while you share — the screen has
  // its own preview element (#screen-pip). The same object identity is kept
  // so bound video elements don't need re-attaching. This stream is also the
  // msid association for the RTP senders; the actual sent tracks are chosen
  // by getVideoTrack()/getExtraCameraTrack() via replaceTrack, independent of
  // membership here.
  private rebuildStream(): void {
    for (const t of this.stream.getTracks()) this.stream.removeTrack(t);
    if (this.cameraTrack) this.stream.addTrack(this.cameraTrack);
    if (this.audioTrack) this.stream.addTrack(this.audioTrack);
  }
}
