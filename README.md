# duo

A permanent video room for exactly two people. No accounts, no meetings, no waiting rooms — just one always-available call with a lobby in front of it.

## How it works

- **Peer A** and **Peer B** each hold a distinct pair secret. There are no other users — the secret *is* the identity.
- On connect, you land in the **lobby**: pick a camera, toggle mic/cam, see whether the other one is around. Three statuses: nobody here, in the lobby, in the meeting.
- Click **enter room** to join. When *both* peers are in the room, WebRTC starts. If the other one is still in the lobby, the room shows a small banner saying so.
- **Screenshare** (desktop or mobile) swaps your camera track via `replaceTrack` — no renegotiation, instant switch.
- **Leaving** drops you back to the lobby, where you can re-enter. The RTC connection is recreated cleanly each time.
- The footer shows `direct` or `relayed via TURN` once connected.

## Quick start (Windows, ngrok)

```
dev.bat
```

That's it. The script generates pair secrets on first run, installs deps, builds the client, then opens two terminals: one for the server, one for ngrok. When the tunnel is up it prints the two share links — one for this PC, one for the mobile.

Cross-network calls need a TURN relay (carrier NAT can't be punched through with STUN alone). Sign up free at [metered.ca](https://dashboard.metered.ca/signup), grab your TURN credentials, and add them to `.env`:

```
ICE_SERVERS_JSON=[{"urls":"stun:stun.relay.metered.ca:80"},{"urls":"turn:standard.relay.metered.ca:80","username":"...","credential":"..."},{"urls":"turn:standard.relay.metered.ca:443?transport=tcp","username":"...","credential":"..."}]
```

Add the same line to `.env.bat` prefixed with `@set `, then restart.

## Architecture

```
            ┌─────────┐  state + signaling  ┌─────────┐
   Peer A ──┤   WSS   ├─────────────────────┤   WSS   ├── Peer B
            └────┬────┘                     └────┬────┘
                 │     ┌───────────────────┐     │
                 └─────┤  signaling server ├─────┘
                       │  (Node + ws)      │
                       └───────────────────┘
                  ▲                              ▲
                  └──── DTLS/SRTP P2P ───────────┘
                          (TURN relay if NAT blocks)
```

**Two state axes, independent:**

| | A connected | A in lobby | A in room |
|---|---|---|---|
| **B connected**     | both idle | A sees "other in lobby"; B sees blank | A sees "other in meeting"; B alone in room |
| **B in lobby**      | (mirror)  | both see each other in lobby | A sees lobby banner; B sees "other in meeting" |
| **B in room**       | (mirror)  | (mirror) | **WebRTC live** |

RTC starts when both are in `room`, tears down the moment either leaves.

**Code map:**

- `server/src/` — Express + `ws`. Tracks each slot's presence (`lobby` / `room`), relays signals, mints ephemeral TURN credentials.
- `client/src/main.ts` — orchestrator. The `reconcileRtc()` function is the only place an `RTCPeerConnection` is created or torn down — every state transition routes through it.
- `client/src/media.ts` — owns the local stream. Camera switch and screenshare both work by swapping the video track in-place; rtcSession reacts via `replaceTrack`.
- `client/src/rtcSession.ts` — native WebRTC (no library). Handles ICE restart, queues ICE candidates that arrive before the remote description.

## Security notes

- Pair secrets travel via URL fragment (`#k=...`) so they never hit server access logs.
- Browser scrubs the fragment from the address bar immediately on read.
- Server compares both pair secrets in constant time on every auth.
- A second connection for the same slot bumps the first (handles laptop-sleep reconnects).
- Rate-limited: 5 auth attempts/min per IP, 10 ICE-config requests/min per IP, 100 WS messages/sec per socket.
