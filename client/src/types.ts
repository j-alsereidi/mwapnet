export type PeerId = 'A' | 'B';
export type Phase =
  | 'idle'
  | 'connecting-signal'
  | 'waiting-for-peer'
  | 'negotiating'
  | 'connected'
  | 'reconnecting'
  | 'failed';
export type ConnectionType = 'direct' | 'relayed' | 'unknown';

export interface IceServerConfig {
  iceServers: RTCIceServer[];
  ttlSeconds: number;
}

export interface ClientState {
  phase: Phase;
  localStream: MediaStream | null;
  remoteStream: MediaStream | null;
  micMuted: boolean;
  camOff: boolean;
  connectionType: ConnectionType;
  peerId: PeerId | null;
  lastError: string | null;
}

export type SignalEnvelope =
  | HelloMsg
  | PeerJoinedMsg
  | PeerLeftMsg
  | SignalMsg
  | ByeMsg
  | PingMsg
  | PongMsg
  | ErrorMsg;

export interface HelloMsg { type: 'hello'; you: PeerId; peerPresent: boolean; serverTime: number }
export interface PeerJoinedMsg { type: 'peer-joined' }
export interface PeerLeftMsg { type: 'peer-left'; reason: 'disconnect' | 'replaced' | 'bye' }
export interface SignalMsg { type: 'signal'; data: unknown }
export interface ByeMsg { type: 'bye' }
export interface PingMsg { type: 'ping'; nonce: number }
export interface PongMsg { type: 'pong'; nonce: number }
export interface ErrorMsg { type: 'error'; code: string; message: string }
