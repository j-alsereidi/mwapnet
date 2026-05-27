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
  private currentCameraId: string | null = null;
  private listeners = new Set<ChangeListener>();

  getStream(): MediaStream {
    return this.stream;
  }

  // Returns the track currently in the "video" slot — could be camera or screen.
  getVideoTrack(): MediaStreamTrack | null {
    return this.screenTrack ?? this.cameraTrack;
  }

  getAudioTrack(): MediaStreamTrack | null {
    return this.audioTrack;
  }

  isScreenSharing(): boolean {
    return this.screenTrack !== null;
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
    const display = await navigator.mediaDevices.getDisplayMedia({ video: true });
    const track = display.getVideoTracks()[0];
    if (!track) return;
    track.addEventListener('ended', () => { void this.stopScreenShare(); });
    this.screenTrack = track;
    this.rebuildStream();
    this.emit();
  }

  async stopScreenShare(): Promise<void> {
    if (!this.screenTrack) return;
    this.screenTrack.stop();
    this.screenTrack = null;
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
    this.cameraTrack = this.audioTrack = this.screenTrack = null;
    this.listeners.clear();
  }

  // Sync the MediaStream's tracks to match our current selection.
  // We keep the SAME MediaStream object — video elements bound to it just work.
  private rebuildStream(): void {
    for (const t of this.stream.getTracks()) this.stream.removeTrack(t);
    const video = this.screenTrack ?? this.cameraTrack;
    if (video) this.stream.addTrack(video);
    if (this.audioTrack) this.stream.addTrack(this.audioTrack);
  }
}
