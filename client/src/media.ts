export async function acquireLocalStream(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ video: true, audio: true });
}

export function setMicMuted(stream: MediaStream, muted: boolean): void {
  for (const track of stream.getAudioTracks()) {
    track.enabled = !muted;
  }
}

export function setCamOff(stream: MediaStream, off: boolean): void {
  for (const track of stream.getVideoTracks()) {
    track.enabled = !off;
  }
}
