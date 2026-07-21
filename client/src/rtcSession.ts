import type { IceServerConfig, ConnectionType } from './types.js';
import type { SignalClient } from './signalClient.js';
import type { MediaManager } from './media.js';
import { store } from './store.js';
import { showToast } from './ui.js';

const NEGOTIATION_TIMEOUT_MS = 20_000;
const MAX_ICE_RESTARTS = 3;
const ICE_RESTART_WINDOW_MS = 60_000;
const ICE_DISCONNECT_GRACE_MS = 3_000;

export interface RtcSession {
  destroy(): void;
  ingestSignal(data: unknown): void;
}

type WireSignal =
  | { type: 'offer';  sdp: string }
  | { type: 'answer'; sdp: string }
  | { candidate: RTCIceCandidateInit };

export function startRtcSession(opts: {
  initiator: boolean;
  media: MediaManager;
  iceConfig: IceServerConfig;
  signal: SignalClient;
}): RtcSession {
  let destroyed = false;
  let iceRestartCount = 0;
  let iceRestartWindowStart = Date.now();
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  let remoteDescriptionSet = false;

  console.log(`[rtc] creating RTCPeerConnection (initiator=${opts.initiator})`);
  const pc = new RTCPeerConnection({ iceServers: opts.iceConfig.iceServers });

  // Add tracks ONCE; track changes (camera switch, screenshare) happen via
  // sender.replaceTrack(), which doesn't trigger renegotiation.
  let videoSender: RTCRtpSender | null = null;
  let audioSender: RTCRtpSender | null = null;
  const videoTrack = opts.media.getVideoTrack();
  const audioTrack = opts.media.getAudioTrack();
  if (videoTrack) videoSender = pc.addTrack(videoTrack, opts.media.getStream());
  if (audioTrack) audioSender = pc.addTrack(audioTrack, opts.media.getStream());

  // While screen-sharing, the camera keeps flowing on its OWN video slot so
  // the peer sees screen + camera at once (getVideoTrack puts the screen on
  // the main sender; getExtraCameraTrack puts the camera here). Screen audio
  // rides a fourth slot. Both extra slots are negotiated once in the initial
  // offer so start/stop is replaceTrack only, never renegotiation.
  //
  // ONLY the initiator pre-allocates them: per spec, an incoming m-line
  // associates exclusively with transceivers created by addTrack, so a
  // pre-added addTransceiver on the answerer is left orphaned (never sends,
  // its receiver never fires) while setRemoteDescription spawns a hidden
  // recvonly duplicate that actually owns the m-line. The answerer instead
  // ADOPTS those spawned transceivers when the offer arrives (see adopt
  // below) and upgrades them to sendrecv before answering. The two extra
  // transceivers are added video-then-audio on BOTH sides so the m-lines
  // pair up deterministically.
  let extraCamTransceiver: RTCRtpTransceiver | null =
    opts.initiator ? pc.addTransceiver('video') : null;
  let screenAudioTransceiver: RTCRtpTransceiver | null =
    opts.initiator ? pc.addTransceiver('audio') : null;

  const syncSenders = (): void => {
    if (destroyed) return;
    const v = opts.media.getVideoTrack();
    const a = opts.media.getAudioTrack();
    const ec = opts.media.getExtraCameraTrack();
    const sa = opts.media.getScreenAudioTrack();
    if (videoSender && videoSender.track !== v) {
      void videoSender.replaceTrack(v).catch((e) => console.warn('[rtc] video replaceTrack failed:', e));
    }
    if (audioSender && audioSender.track !== a) {
      void audioSender.replaceTrack(a).catch((e) => console.warn('[rtc] audio replaceTrack failed:', e));
    }
    if (extraCamTransceiver && extraCamTransceiver.sender.track !== ec) {
      void extraCamTransceiver.sender.replaceTrack(ec)
        .catch((e) => console.warn('[rtc] extra-camera replaceTrack failed:', e));
    }
    if (screenAudioTransceiver && screenAudioTransceiver.sender.track !== sa) {
      void screenAudioTransceiver.sender.replaceTrack(sa)
        .catch((e) => console.warn('[rtc] screen-audio replaceTrack failed:', e));
    }
  };
  const stopMediaListener = opts.media.onChange(syncSenders);

  // Receiver side: publish each extra track for its sink. Visibility is driven
  // by the peer's explicit 'share' app event (see main.ts); the RTP-driven
  // mute/unmute events here are only debug-mode probes.
  function wireExtraCam(t: RTCRtpTransceiver): void {
    store.set({ remoteExtraCameraTrack: t.receiver.track });
  }
  function wireScreenAudio(t: RTCRtpTransceiver): void {
    const remoteScreenAudio = t.receiver.track;
    remoteScreenAudio.onunmute = () => {
      if (store.get().debugMode) showToast('[debug] screen-audio RTP flowing');
    };
    remoteScreenAudio.onmute = () => {
      if (store.get().debugMode) showToast('[debug] screen-audio RTP stopped');
    };
    store.set({ remoteScreenAudioTrack: remoteScreenAudio });
  }
  if (extraCamTransceiver) wireExtraCam(extraCamTransceiver);
  if (screenAudioTransceiver) wireScreenAudio(screenAudioTransceiver);
  // A share may already be live from before this session started.
  syncSenders();

  // Answerer half: adopt the transceivers setRemoteDescription(offer) spawned
  // for the extra m-lines — the video one that isn't the camera's main sender,
  // and the audio one that isn't the mic's. Runs before createAnswer so the
  // sendrecv upgrade (Chrome spawns them recvonly) lands in the answer.
  function adoptExtraTransceivers(): void {
    if (!extraCamTransceiver) {
      extraCamTransceiver = pc.getTransceivers().find(
        (t) => t.receiver.track.kind === 'video' && t.sender !== videoSender
      ) ?? null;
      if (extraCamTransceiver) {
        extraCamTransceiver.direction = 'sendrecv';
        wireExtraCam(extraCamTransceiver);
      } else {
        console.warn('[rtc] extra-camera transceiver missing from offer');
      }
    }
    if (!screenAudioTransceiver) {
      screenAudioTransceiver = pc.getTransceivers().find(
        (t) => t.receiver.track.kind === 'audio' && t.sender !== audioSender
      ) ?? null;
      if (screenAudioTransceiver) {
        screenAudioTransceiver.direction = 'sendrecv';
        wireScreenAudio(screenAudioTransceiver);
      } else {
        console.warn('[rtc] screen-audio transceiver missing from offer');
      }
    }
    syncSenders();
  }

  const negotiationDeadline = setTimeout(() => {
    if (destroyed || store.get().rtcConnected) return;
    console.warn('[rtc] negotiation timed out after 20s');
    store.set({
      phase: 'failed',
      lastError: "Couldn't establish a connection. Your networks may need a TURN relay.",
    });
  }, NEGOTIATION_TIMEOUT_MS);

  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    console.log('[rtc] signal OUT: ice');
    opts.signal.send({ type: 'signal', data: { candidate: e.candidate.toJSON() } });
  };

  pc.ontrack = (e) => {
    const [remoteStream] = e.streams;
    if (!remoteStream) return;
    console.log(`[rtc] remote track (${remoteStream.getTracks().length} tracks)`);
    // ontrack fires before media flows; the UI uses rtcConnected to decide
    // when to actually show the video as "live".
    store.set({ remoteStream });
  };

  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    console.log(`[rtc] ice state: ${s}`);
    if (s === 'connected' || s === 'completed') {
      clearTimeout(negotiationDeadline);
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
      store.set({ rtcConnected: true });
      void detectConnectionType(pc);
    } else if (s === 'disconnected') {
      store.set({ rtcConnected: false });
      disconnectTimer = setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          tryIceRestart();
        }
      }, ICE_DISCONNECT_GRACE_MS);
    } else if (s === 'failed') {
      store.set({ rtcConnected: false });
      tryIceRestart();
    }
  };

  pc.onsignalingstatechange = () => console.log(`[rtc] signaling state: ${pc.signalingState}`);
  pc.onicegatheringstatechange = () => console.log(`[rtc] ice gathering: ${pc.iceGatheringState}`);

  pc.onnegotiationneeded = async () => {
    if (destroyed || !opts.initiator) return;
    try {
      console.log('[rtc] negotiationneeded → creating offer');
      const offer = await pc.createOffer();
      if (destroyed) return;
      await pc.setLocalDescription(offer);
      if (destroyed) return;
      console.log('[rtc] signal OUT: offer');
      opts.signal.send({ type: 'signal', data: { type: 'offer', sdp: pc.localDescription!.sdp } });
    } catch (err) {
      console.warn('[rtc] offer creation failed:', err);
    }
  };

  async function ingestSignal(raw: unknown): Promise<void> {
    if (destroyed) return;
    const msg = raw as WireSignal;
    try {
      if ('type' in msg && (msg.type === 'offer' || msg.type === 'answer')) {
        console.log(`[rtc] signal IN: ${msg.type}`);
        await pc.setRemoteDescription({ type: msg.type, sdp: msg.sdp });
        remoteDescriptionSet = true;
        while (pendingRemoteCandidates.length) {
          const c = pendingRemoteCandidates.shift()!;
          try { await pc.addIceCandidate(c); } catch (e) { console.warn('[rtc] queued ICE add failed:', e); }
        }
        if (msg.type === 'offer') {
          adoptExtraTransceivers(); // before createAnswer — see above
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          console.log('[rtc] signal OUT: answer');
          opts.signal.send({ type: 'signal', data: { type: 'answer', sdp: pc.localDescription!.sdp } });
        }
      } else if ('candidate' in msg && msg.candidate) {
        console.log('[rtc] signal IN: ice');
        if (remoteDescriptionSet) {
          await pc.addIceCandidate(msg.candidate);
        } else {
          pendingRemoteCandidates.push(msg.candidate);
        }
      } else {
        console.warn('[rtc] signal IN: unknown shape', msg);
      }
    } catch (err) {
      console.warn('[rtc] ingestSignal error:', err);
    }
  }

  function tryIceRestart(): void {
    if (destroyed) return;
    const now = Date.now();
    if (now - iceRestartWindowStart > ICE_RESTART_WINDOW_MS) {
      iceRestartCount = 0;
      iceRestartWindowStart = now;
    }
    if (iceRestartCount >= MAX_ICE_RESTARTS) {
      store.set({
        phase: 'failed',
        lastError: "Couldn't maintain a connection. Check your network or the TURN server.",
      });
      return;
    }
    iceRestartCount++;
    if (opts.initiator) {
      try { pc.restartIce(); } catch (e) { console.warn('[rtc] restartIce failed:', e); }
    }
  }

  function destroy(): void {
    if (destroyed) return;
    destroyed = true;
    clearTimeout(negotiationDeadline);
    if (disconnectTimer) clearTimeout(disconnectTimer);
    stopMediaListener();
    try { pc.close(); } catch { /* already closed */ }
    store.set({
      remoteStream: null, rtcConnected: false, connectionType: 'unknown',
      remoteScreenAudioTrack: null, remoteScreenAudioActive: false,
      remoteExtraCameraTrack: null, remoteScreenCamActive: false,
    });
  }

  return { destroy, ingestSignal: (data) => { void ingestSignal(data); } };
}

async function detectConnectionType(pc: RTCPeerConnection): Promise<void> {
  try {
    const stats = await pc.getStats();
    let remoteCandidateId: string | null = null;

    stats.forEach((report) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r = report as any;
      if (
        r.type === 'candidate-pair' &&
        (r.selected === true || (r.state === 'succeeded' && r.nominated !== false))
      ) {
        remoteCandidateId = r.remoteCandidateId as string;
      }
    });

    let connectionType: ConnectionType = 'unknown';
    if (remoteCandidateId) {
      stats.forEach((report) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = report as any;
        if (r.id === remoteCandidateId) {
          connectionType = r.candidateType === 'relay' ? 'relayed' : 'direct';
        }
      });
    }

    store.set({ connectionType });
  } catch {
    /* getStats not available */
  }
}
