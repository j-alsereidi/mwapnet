# Deploying to Oracle Cloud (Always Free)

Self-hosted coturn + Caddy (auto-HTTPS) + the Node app, all on one Oracle
Ampere A1 VM. This config was validated locally first (see the "Local
validation" note at the bottom) — `--external-ip` and a broken coturn flag
were caught and fixed before ever touching the cloud.

## 1. Provision the VM

1. Oracle Cloud Console → Compute → Instances → **Create Instance**
2. Shape: **Ampere A1** (Always Free-eligible) — 4 OCPU / 24 GB RAM is the max
   free allotment; even 1 OCPU / 6 GB is plenty for this app.
3. Image: **Ubuntu 22.04** (or newer LTS)
4. Under Networking, make sure a **public IPv4 address** is assigned.
5. Create/download the SSH key pair if you don't already have one.
6. **Security options**: enable "Require an authorization header" for the
   instance metadata service (IMDSv2). Nothing in this stack talks to IMDS,
   so this is a free hardening win with no compatibility risk.
7. **Initialization script**: paste the contents of this repo's
   [`cloud-init.yml`](./cloud-init.yml) into the "Paste cloud-init script"
   box. It automates step 2B and step 3 below (OS firewall rules + Docker
   install) so they're done by the time you first SSH in.
8. Launch. Note the instance's **public IP** — you'll need it below.

Give the instance 1-2 minutes after it shows "Running" for cloud-init to
finish. You can confirm it's done once connected: `ls ~/cloud-init-done`
(created by the script as the last step). If Docker commands fail with a
permissions error on your very first SSH session, run `newgrp docker` or log
out and back in — group membership from cloud-init doesn't apply retroactively
to an already-open session.

## 2. Open firewall ports (two layers — both required)

**A. Oracle VCN Security List** (Console → Networking → Virtual Cloud
Networks → your VCN → Security Lists → Default Security List → Add Ingress
Rules) — **this step is NOT covered by cloud-init and must be done manually**
in the console, since it's a network-level setting outside the VM itself:

| Source CIDR | Protocol | Port range | Purpose |
|---|---|---|---|
| 0.0.0.0/0 | TCP | 80 | Caddy HTTP → HTTPS redirect |
| 0.0.0.0/0 | TCP | 443 | App HTTPS + WebSocket signaling |
| 0.0.0.0/0 | TCP | 3478 | TURN (TCP fallback) |
| 0.0.0.0/0 | UDP | 3478 | TURN (UDP — primary path) |
| 0.0.0.0/0 | TCP | 5349 | TURNS (TLS) |
| 0.0.0.0/0 | UDP | 49160-49200 | coturn relay port range |

**B. OS firewall on the VM itself** — already applied by `cloud-init.yml` if
you pasted it at instance creation. If you skipped that, run manually:

```bash
sudo iptables -I INPUT 1 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 1 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 1 -m state --state NEW -p tcp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -m state --state NEW -p udp --dport 3478 -j ACCEPT
sudo iptables -I INPUT 1 -m state --state NEW -p tcp --dport 5349 -j ACCEPT
sudo iptables -I INPUT 1 -m state --state NEW -p udp --dport 49160:49200 -j ACCEPT
sudo netfilter-persistent save
```

Insert at position **1**, not lower. Oracle's Ubuntu image ships an INPUT
chain that ends in a blanket `REJECT all` rule partway down; any ACCEPT
inserted below it never matches. Verify with
`sudo iptables -L INPUT -n --line-numbers` — every port ACCEPT above must
appear above the `REJECT ... icmp-host-prohibited` line. (If
`netfilter-persistent` isn't installed: `sudo apt install iptables-persistent`.)

## 3. Install Docker

Already done by `cloud-init.yml` if you used it. If you skipped that, run
manually:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
# log out and back in (or `newgrp docker`) for the group change to apply
```

## 4. Clone the repo and configure `.env`

```bash
git clone https://github.com/j-alsereidi/mwapnet.git
cd mwapnet
cp .env.example .env
```

Edit `.env` and fill in:

```
PAIR_SECRET_A=<generate — see below>
PAIR_SECRET_B=<generate — see below>
TURN_STATIC_AUTH_SECRET=<generate — see below>
PUBLIC_TURN_HOST=<this VM's public IP>        # e.g. 132.145.67.89
PRIVATE_TURN_HOST=<this VM's private IP>      # e.g. 10.0.0.108 — see note below
PUBLIC_TURN_PORT=3478
TURNS_TLS_PORT=5349
APP_DOMAIN=<this VM's public IP>.nip.io       # e.g. 132.145.67.89.nip.io
```

`PRIVATE_TURN_HOST` is the VM's internal IP — find it with `hostname -I` on
the VM (take the `10.x` / `172.x` / `192.168.x` address) or read it off the
VNIC in the Oracle console. coturn runs with `network_mode: host` and sees
several local interfaces, so its `--external-ip` flag needs the
`public/private` pair to know which address to advertise. Supplying only the
public IP makes coturn reject the argument and silently fall back to
advertising an unreachable private address — the classic "works on the same
network, fails across the internet" symptom.

Generate each secret with:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```
(If Node isn't installed on the VM yet, run this on your dev machine instead
and paste the values in.)

`nip.io` is a free wildcard DNS service — `1.2.3.4.nip.io` resolves to
`1.2.3.4` with no setup. Caddy will issue a real Let's Encrypt cert for it
automatically. If you own a real domain, point an A record at the VM's IP
and use that instead — it's a nicer URL to share.

## 5. Bring up the stack

```bash
docker compose up -d --build
```

First boot: Caddy fetches its Let's Encrypt cert on the first HTTPS request
(~10 seconds). coturn starts immediately.

## 6. Verify

- **App loads**: `https://<APP_DOMAIN>/#k=<PAIR_SECRET_A>` → lobby screen appears.
- **coturn parsed `--external-ip` correctly**: `docker compose config | grep external`
  should print `--external-ip=<public>/<private>`, and
  `docker compose logs coturn | grep -i "external-ip\|Unknown argument"` should
  show `Whitelisting external-ip private part: <private>` and **no** "Unknown
  argument" error. (Note: coturn's normal startup log lists private relay
  addresses regardless — that is expected and not a fault; `--external-ip`
  only changes the address it advertises during an allocation, which the
  relay test below confirms.)
- **ICE config is correct**:
  ```bash
  curl https://<APP_DOMAIN>/ice-config -H "Authorization: Bearer <PAIR_SECRET_A>"
  ```
  Should return `turn:<PUBLIC_TURN_HOST>:3478...` entries with a `username`/`credential`.
- **Real relay test**: open
  https://webrtc.github.io/samples/src/content/peerconnection/trickle-ice/,
  add `turn:<PUBLIC_TURN_HOST>:3478?transport=udp` with the username/credential
  from the curl output above, click Gather candidates → look for a `relay`
  candidate.
- **End-to-end**: open the app on two devices on *different* networks (e.g.
  your PC on Wi-Fi + phone on mobile data) using the two pair-key URLs and
  confirm video connects. `docker compose logs coturn` should show allocation
  activity during the call.

## Updating after a code change

```bash
git pull
docker compose up -d --build
```

## Local validation (already done — informational)

Before ever deploying, this coturn configuration was validated on a local
Docker Desktop stack (`docker-compose.local.yml`) using a real browser
`RTCPeerConnection` forced to `iceTransportPolicy: 'relay'`. Three coturn
gotchas surfaced during bring-up and are already handled in this repo:

- `--no-loopback-peers` is not a valid flag on modern coturn — it crash-loops
  the container. Removed (loopback denial is the default now).
- `--external-ip` needs the `public/private` pair (`${PUBLIC_TURN_HOST}/${PRIVATE_TURN_HOST}`),
  not a bare public IP, because `network_mode: host` exposes several local
  interfaces. A bare IP is rejected and coturn falls back to advertising an
  unreachable address.
- On the VM, the port ACCEPT rules must sit above Oracle's default `REJECT`
  in the iptables INPUT chain (see step 2B).

To re-run the local relay test at any point (e.g. after further coturn
changes), see `docker-compose.local.yml`'s header comment for instructions.
