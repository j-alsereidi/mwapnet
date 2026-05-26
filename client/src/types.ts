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

  micMuted: boolean;
  camOff: boolean;
  screenSharing: boolean;

  cameras: CameraOption[];
  currentCameraId: string | null;

  rtcConnected: boolean;
  connectionType: ConnectionType;

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
