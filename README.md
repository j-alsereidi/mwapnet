# MWAPNET

A private, always-on video room for exactly two people. There are no accounts, no scheduled meetings, and no waiting rooms. Each person opens a personal link and lands in a lobby; when both people enter the room, a peer-to-peer WebRTC call starts automatically.

The project is built on the native browser WebRTC API with no client-side media library. The signaling server is a small Node process, and cross-network calls are relayed through a self-hosted coturn TURN server so that connections succeed even when both peers sit behind restrictive NAT such as mobile carrier networks.

## Features

- Two-person model with no user database. Each peer holds one secret, and that secret is the identity.
- A lobby that shows the other person's presence before you enter: nobody present, waiting in the lobby, or already in the room.
- Automatic call setup. The RTCPeerConnection is created only while both peers are in the room and is torn down cleanly the moment either one leaves.
- Camera switching and screen sharing that swap the outgoing video track in place via `replaceTrack`, so neither requires renegotiation.
- Mobile support, including front/rear camera switching and screen sharing where the browser allows it.
- ICE restart and candidate queueing for resilience when a network path drops mid-call.
- A connection-type indicator that reports whether the call is direct or relayed through TURN.
- Three interchangeable TURN back ends selected by environment variable: self-hosted coturn, Cloudflare Realtime TURN, or a raw ICE-servers override for any third-party provider.

## Architecture

```
            +---------+  state + signaling   +---------+
   Peer A --+   WSS   +----------------------+   WSS   +-- Peer B
            +----+----+                      +----+----+
                 |      +------------------+      |
                 +------+ signaling server +------+
                        | (Node + ws)      |
                        +------------------+
                 ^                                ^
                 +-------- DTLS/SRTP P2P ---------+
                          (TURN relay when NAT blocks a direct path)
```

Presence runs on two independent axes, one per peer, each moving between `lobby` and `room`. The signaling server mirrors each peer's state to the other. The client concentrates all connection lifecycle logic in a single `reconcileRtc()` function, which is the only place an `RTCPeerConnection` is created or destroyed. The connection exists if and only if both peers report `room`.

### Repository layout

| Path | Responsibility |
| --- | --- |
| `server/src/` | Express plus `ws`. Authenticates peers, tracks presence, relays signaling messages, and issues TURN credentials. |
| `client/src/main.ts` | Orchestrator. Owns `reconcileRtc()` and routes every state transition through it. |
| `client/src/media.ts` | Owns the local `MediaStream`. Camera switch and screen share both swap the video track in place. |
| `client/src/rtcSession.ts` | Native WebRTC session. Handles offer/answer, ICE restart, and candidate queueing. |
| `client/src/ui.ts` | Renders lobby and room state from a small central store. |
| `docker-compose.yml` | Production stack: Caddy (HTTPS), the Node server, and coturn. |
| `docker-compose.local.yml` | Local coturn validation stack used to test the relay before deploying. |
| `DEPLOY.md` | Step-by-step production deployment to a free cloud VM. |

## Running it locally (Windows)

The fastest way to try the app on your own machine and phone is the included launcher, which serves the app over an [ngrok](https://ngrok.com/download) tunnel. It requires [Node.js](https://nodejs.org) and ngrok on your `PATH`.

```
dev.bat
```

On first run the script generates the pair secrets, installs dependencies, and builds the client. It then starts the server and the tunnel and prints two links, one for each device. Open the first on your computer and the second on your phone.

A call between two devices on the same local network will connect without a TURN server. A call across different networks, such as your phone on mobile data, needs a reachable TURN relay; see the deployment section below for a permanent setup, or set `ICE_SERVERS_JSON` in `.env` to point at any third-party TURN provider for a quick test.

## Running it with Docker

The production stack runs entirely in containers. On any machine with Docker installed:

```bash
cp .env.example .env      # then fill in the values described inside
docker compose up -d --build
```

The stack comprises three services: Caddy terminates HTTPS and reverse-proxies the app, the Node server handles signaling and serves the built client, and coturn provides the TURN relay. Configuration is entirely through `.env`; see `.env.example` for every variable and its purpose.

For a permanent, no-cost deployment to an Oracle Cloud Always Free VM, including firewall configuration and a first-boot provisioning script, follow [`DEPLOY.md`](./DEPLOY.md).

## Configuration

All configuration is read from environment variables. The `.env.example` file documents each one. The essentials:

| Variable | Purpose |
| --- | --- |
| `PAIR_SECRET_A`, `PAIR_SECRET_B` | The two peer secrets. Must differ and be at least 32 characters each. |
| `APP_DOMAIN` | Hostname Caddy provisions a TLS certificate for. A `<public-ip>.nip.io` value works with no DNS setup. |
| `TURN_STATIC_AUTH_SECRET` | Shared secret between the signaling server and coturn for time-limited TURN credentials. |
| `PUBLIC_TURN_HOST`, `PRIVATE_TURN_HOST` | The VM's public and private IP addresses. coturn needs both to advertise a reachable relay address under host networking. |

TURN back end is chosen by which variables are set, in priority order: `ICE_SERVERS_JSON` (a raw override) first, then Cloudflare Realtime TURN (`CLOUDFLARE_TURN_KEY_ID` and `CLOUDFLARE_TURN_KEY_SECRET`), then self-hosted coturn (`PUBLIC_TURN_HOST`). If none are set, the server falls back to public STUN only, which is sufficient for same-network testing.

## Security

- Pair secrets travel in the URL fragment (`#k=...`), which browsers never send to the server, so the secret stays out of access logs. The client clears the fragment from the address bar as soon as it reads it.
- The server compares pair secrets with a constant-time algorithm on every authentication.
- A second connection for the same peer slot replaces the first, which handles reconnection after a laptop sleeps or a network changes.
- Requests are rate limited: five authentication attempts per minute per IP with a five-minute block on excess, ten ICE-config requests per minute per IP, and one hundred WebSocket messages per second per socket.

Note that anyone holding a pair secret can join as that peer, so treat the links as you would a password. Rotating the secrets is a matter of changing the two environment variables and restarting.

## Build targets

`client/` is the single source of truth for all UI and call logic. Three shells build from it. Only `client/src/keystore/` and `client/src/foregroundService/` differ per platform — one implementation file per target, selected at build time via a Vite alias keyed on `--mode`, so a native-only dependency (`@capacitor/preferences`, `tauri-plugin-store`, the Android foreground-service plugin) never reaches the web bundle. Everything else — the WebRTC session, the UI, the store — is fully shared.

### Web

Unaffected by any of the below — `npm run build` in `client/` is the exact command Docker already runs, unchanged. See "Running it with Docker" above.

### Android (Capacitor)

```bash
npm run build:capacitor --prefix client
cd capacitor
npx cap sync android
npx cap open android      # opens Android Studio, or:
cd android && ./gradlew assembleDebug
```

Requires Android Studio with the SDK, NDK, and `ANDROID_HOME`/`JAVA_HOME` set — see [Tauri's prerequisites page](https://v2.tauri.app/start/prerequisites/) for the same setup (the Android tooling requirement is identical regardless of which shell you're building). By default the app talks to `PUBLIC_TURN_HOST`'s deployed backend; override it from the lobby's settings panel (gear icon) after install.

### Desktop (Tauri)

```bash
npm install               # repo root — installs @tauri-apps/cli
npx tauri dev              # runs client's dev server + opens a window
npx tauri build             # produces an installer in src-tauri/target/release/bundle/
```

Needs the Rust toolchain (`rustup`) plus the OS-specific prerequisites Tauri documents for [Windows/macOS/Linux](https://v2.tauri.app/start/prerequisites/). No Node frontend framework required — `client/` is a plain Vite/TypeScript project Tauri points at directly via `frontendDist`.

## License

MIT. See [`LICENSE`](./LICENSE).
