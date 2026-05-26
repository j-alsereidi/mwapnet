# duo

A permanent video room for exactly two people. No accounts, no meetings, no waiting rooms — just one always-available call.

## How it works

- **Peer A** and **Peer B** each hold a distinct pair secret (a long random string).
- The signaling server accepts exactly two WebSocket connections and relays WebRTC SDP/ICE between them.
- WebRTC connects directly (P2P) when NAT allows; falls back to a TURN relay otherwise.
- A small footer indicator shows `direct` or `relayed via TURN`.

## Quick start (ngrok dev setup)

### 1. Generate secrets

```sh
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Run this three times to get `PAIR_SECRET_A`, `PAIR_SECRET_B`, and `TURN_STATIC_AUTH_SECRET`.

### 2. Configure

```sh
cp .env.example .env
# Edit .env — fill in the three secrets above.
# Leave PUBLIC_TURN_HOST blank for now; you'll fill it in step 4.
```

### 3. Start ngrok tunnels (two terminals)

```sh
# Terminal 1 — signaling + static client
ngrok http 8080

# Terminal 2 — TURN relay
ngrok tcp 3478
```

Copy the TCP tunnel host and port from terminal 2 into `.env`:

```
PUBLIC_TURN_HOST=4.tcp.ngrok.io   # example
PUBLIC_TURN_PORT=12345            # the port ngrok assigned
```

### 4. Start services

```sh
docker compose up --build
```

### 5. Share links

Each peer gets their own link. The secret goes in the URL fragment so it never hits the server:

```
https://<ngrok-https-id>.ngrok-free.app/#k=PAIR_SECRET_A   → peer A
https://<ngrok-https-id>.ngrok-free.app/#k=PAIR_SECRET_B   → peer B
```

After the first visit the browser saves the key — they only need to paste it once.

## Local development (no Docker)

```sh
# Terminal 1 — server
cd server && npm install && npm run dev

# Terminal 2 — client (with HMR proxy to :8080)
cd client && npm install && npm run dev
```

Set env vars in your shell before starting the server:

```sh
export PAIR_SECRET_A=...
export PAIR_SECRET_B=...
export TURN_STATIC_AUTH_SECRET=...
export PUBLIC_TURN_HOST=localhost
```

## Architecture

```
[Peer A browser] <==DTLS/SRTP P2P==> [Peer B browser]
       \                                    /
        \---WSS /signal---> [Server] <------/
                                |
                    [coturn STUN/TURN :3478]
```

- **Signaling server** — Node.js + `ws` + `express`. Stateless beyond a single in-memory pair state; no database.
- **coturn** — STUN + TURN. Credentials are ephemeral (RFC 5766 REST API, 10-min TTL).
- **Client** — Vite + vanilla TypeScript + `simple-peer`. No framework.

## Security notes

- Pair secrets are delivered via URL fragment (`#k=...`) — never sent to the server in HTTP requests.
- The browser scrubs the fragment from the address bar immediately after reading it.
- Both secrets are compared in constant time to resist timing attacks.
- A third connection attempt for an occupied slot bumps the previous socket (handles reconnects after sleep/network blip).
- Rate limiting: 5 auth attempts/min per IP, 10 ICE-config requests/min per IP, 100 WS messages/sec per socket.
