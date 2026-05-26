import type { IceServerConfig, ConnectionType } from './types.js';
import type { SignalClient } from './signalClient.js';
import { store } from './store.js';

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
  localStream: MediaStream;
  iceConfig: IceServerConfig;
  signal: SignalClient;
}): RtcSession {
  let destroyed = false;
  let iceRestartCount = 0;
  let iceRestartWindowStart = Date.now();
  let disconnectTimer: ReturnType<typeof setTimeout> | null = null;
  // ICE candidates that arrive before setRemoteDescription has run get queued
  const pendingRemoteCandidates: RTCIceCandidateInit[] = [];
  let remoteDescriptionSet = false;

  console.log(`[rtc] creating RTCPeerConnection (initiator=${opts.initiator}, tracks=${opts.localStream.getTracks().length})`);

  const pc = new RTCPeerConnection({ iceServers: opts.iceConfig.iceServers });

  for (const track of opts.localStream.getTracks()) {
    pc.addTrack(track, opts.localStream);
  }

  const negotiationDeadline = setTimeout(() => {
    if (destroyed) return;
    if (store.get().phase !== 'connected') {
      console.warn('[rtc] negotiation timed out after 20s');
      store.set({
        phase: 'failed',
        lastError: "Couldn't establish a connection. Your networks may need a TURN relay.",
      });
    }
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
    // Attach the stream now, but DO NOT flip phase to 'connected' yet —
    // ontrack fires as soon as SDP is exchanged, long before media flows.
    // Phase moves to 'connected' only when ICE actually connects.
    store.set({ remoteStream });
    attachRemoteStream(remoteStream);
  };

  pc.oniceconnectionstatechange = () => {
    const s = pc.iceConnectionState;
    console.log(`[rtc] ice state: ${s}`);
    if (s === 'connected' || s === 'completed') {
      clearTimeout(negotiationDeadline);
      if (disconnectTimer) { clearTimeout(disconnectTimer); disconnectTimer = null; }
      store.set({ phase: 'connected' });
      void detectConnectionType(pc);
    } else if (s === 'disconnected') {
      disconnectTimer = setTimeout(() => {
        if (pc.iceConnectionState === 'disconnected' || pc.iceConnectionState === 'failed') {
          tryIceRestart();
        }
      }, ICE_DISCONNECT_GRACE_MS);
    } else if (s === 'failed') {
      tryIceRestart();
    }
  };

  pc.onsignalingstatechange = () => console.log(`[rtc] signaling state: ${pc.signalingState}`);
  pc.onicegatheringstatechange = () => console.log(`[rtc] ice gathering: ${pc.iceGatheringState}`);

  // Initiator drives renegotiation (also handles ICE restart-triggered renegotiation later)
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
        // Drain any ICE candidates that arrived before the remote description
        while (pendingRemoteCandidates.length) {
          const c = pendingRemoteCandidates.shift()!;
          try { await pc.addIceCandidate(c); } catch (e) { console.warn('[rtc] queued ICE add failed:', e); }
        }
        if (msg.type === 'offer') {
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
    try { pc.close(); } catch { /* already closed */ }
    store.set({ remoteStream: null, connectionType: 'unknown' });
  }

  return { destroy, ingestSignal: (data) => { void ingestSignal(data); } };
}

function attachRemoteStream(stream: MediaStream): void {
  const video = document.getElementById('remote') as HTMLVideoElement;
  video.srcObject = stream;
  video.play().catch(() => {
    const overlay = document.getElementById('unmute-overlay')!;
    overlay.classList.remove('hidden');
    overlay.onclick = () => {
      video.play().catch(() => { /* user needs to retry */ });
      overlay.classList.add('hidden');
    };
  });
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
