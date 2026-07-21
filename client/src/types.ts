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

  // The PEER's screen-share audio (set by rtcSession from its dedicated
  // transceiver). `Active` mirrors the peer's explicit 'share' announcement —
  // i.e. whether their share actually carries audio right now. Volume/mute are
  // local, session-only listener controls; they never affect the peer's voice.
  remoteScreenAudioTrack: MediaStreamTrack | null;
  remoteScreenAudioActive: boolean;
  screenAudioVolume: number; // 0-100
  screenAudioMuted: boolean;

  // The PEER's camera while they screen-share (their own dedicated video
  // transceiver). Shown as a PiP over their screen; `Active` follows their
  // 'share' announcement (sharing with camera on).
  remoteExtraCameraTrack: MediaStreamTrack | null;
  remoteScreenCamActive: boolean;

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
  // Either peer asked to end the call for BOTH sides; the server echoes this
  // to both sockets and each client walks itself back to the lobby.
  | { type: 'hangup-all' }
  | { type: 'pong'; nonce: number }
  | { type: 'error'; code: string; message: string };

// Client → server messages
export type ClientMessage =
  | { type: 'state'; state: 'lobby' | 'room' }
  | { type: 'signal'; data: unknown }
  | { type: 'hangup-all' }
  | { type: 'ping'; nonce: number };
