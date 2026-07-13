export type PeerId = 'A' | 'B';

// What screen am I looking at?
export type Phase = 'connecting' | 'lobby' | 'room' | 'failed';

// Where is the other peer? (mirrored from server)
export type PeerPresence = 'disconnected' | 'lobby' | 'room';

export type ConnectionType = 'direct' | 'relayed' | 'unknown';

export interface IceServerConfig {
  iceServers: RTCIceServer[];
  ttlSeconds: number;
}

export interface CameraOption {
  deviceId: string;
  label: string;
}

export interface ClientState {
  phase: Phase;
  peerId: PeerId | null;
  peerPresence: PeerPresence;

  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  // Dedicated stream wrapping just the screen-capture track, kept entirely
  // separate from the camera PiP so screenshare display has zero entanglement
  // with the camera's track-swap / hide logic.
  screenStream: MediaStream | null;

  micMuted: boolean;
  camOff: boolean;
  screenSharing: boolean;

  cameras: CameraOption[];
  currentCameraId: string | null;

  rtcConnected: boolean;
  connectionType: ConnectionType;

  // User-controlled: hide the self PiP in the room (via settings menu).
  // Doesn't affect the lobby preview.
  hideSelfView: boolean;

  // Settings — persisted via keyStore, loaded once at boot (see main.ts).
  sfxVolume: number;      // 0-100
  sfxMuted: boolean;
  vineBoomVolume: number; // 0-100 — cameraOn.mp3 only
  vineBoomMuted: boolean;
  // Whether you hear roomToLobby.mp3 when the OTHER peer leaves the room.
  // Doesn't affect the sound playing for your OWN departure.
  exitMeowsEnabled: boolean;
  debugMode: boolean;

  lastError: string | null;
}

// ── Wire protocol ───────────────────────────────────────────────────────────
// Server → client messages
export type ServerMessage =
  | { type: 'hello'; you: PeerId; peerPresence: PeerPresence }
  | { type: 'peer-state'; state: PeerPresence }
  | { type: 'signal'; data: unknown }
  | { type: 'pong'; nonce: number }
  | { type: 'error'; code: string; message: string };

// Client → server messages
export type ClientMessage =
  | { type: 'state'; state: 'lobby' | 'room' }
  | { type: 'signal'; data: unknown }
  | { type: 'ping'; nonce: number };
