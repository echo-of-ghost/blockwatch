# BLOCKWATCH

A real-time Bitcoin node dashboard. Connects directly to your local Bitcoin Core node via RPC and displays live chain, mempool, peer, and network data in a clean, dense browser interface.

Uses Bitcoin Core's native ZMQ for real-time block notifications (14x fewer RPC calls) and falls back to polling if unavailable. No external APIs. Your node, your data.

![blockwatch](screenshot-mainnet.png)

---

## Features

- **Chain** — height, headers, sync progress, difficulty, hashrate, chainwork, chain tips / orphan detection
- **Blocks** — last 12 blocks (8 during IBD) with height, hash, tx count, size, weight, age — hashes link to mempool.space (or your own instance)
- **Block detail** — per-block breakdown: fees, subsidy, era, fill %, feerate, miner version bits
- **Fee / subsidy** — sparkline of fee revenue as a % of total block reward across recent blocks
- **Block timing** — bar chart of inter-block intervals, reveals mining rhythm
- **Block activity** — fee rate and total fee history across recent blocks
- **Softforks** — live deployment status for all active and pending BIP9 forks (requires Bitcoin Core v24+)
- **Mempool** — tx count, size, fee rates, usage meter, min relay fee, updated every 5s
- **Fee estimates** — next block / 6 blocks / 1 day / economy, colour-coded by urgency; skipped during IBD
- **Peers** — inbound/outbound, network type (IPv4/IPv6/onion/i2p), version, ping, latency, bandwidth, services; disconnect and ban controls
- **Network services** — local node service flags (NETWORK, WITNESS, COMPACT_FILTERS, P2P_V2 etc.)
- **Difficulty retarget** — next retarget block, blocks remaining, estimated date, estimated % change based on actual block velocity this period
- **IBD mode** — progress bar with real-time ETA computed from sync velocity; fee estimates disabled, only 8 blocks shown to reduce load
- **Real-time block updates** — ZMQ subscriptions to Bitcoin Core for instant block arrival (< 1s latency) instead of polling; falls back to 10s polling if unavailable
- **Bandwidth chart** — 10-minute history at 5-second resolution (120 samples), updated continuously
- **Network themes** — automatic accent colour per chain: orange (mainnet), blue (testnet4), gold (signet), purple (regtest)
- **Persistent layout** — panel order, column widths, and hidden state all persist across refreshes via localStorage

---

## Screenshots

| Mainnet | Testnet4 | Signet | Regtest |
|---|---|---|---|
| ![mainnet](screenshot-mainnet.png) | ![testnet4](screenshot-testnet4.png) | ![signet](screenshot-signet.png) | ![regtest](screenshot-regtest.png) |


---

## Desktop App (AppImage)

blockwatch ships as a self-contained Linux desktop application. Download the latest `.AppImage` from the [releases page](https://github.com/echo-of-ghost/blockwatch/releases), make it executable, and run it — no installation required.

```bash
chmod +x Blockwatch-2.0.0.AppImage
./Blockwatch-2.0.0.AppImage
```

The app embeds a Node.js server and opens directly to the dashboard. All configuration (cookie auth, ZMQ, environment variables) works the same as the browser version.

To build the AppImage yourself:
```bash
npm install
npm run dist        # outputs to dist/
```

To run in dev mode without packaging:
```bash
npm run app
```

> **Note:** AppImage icons require system integration (e.g. [AppImageLauncher](https://github.com/TheAssassin/AppImageLauncher)) to show in the GNOME/KDE taskbar on Wayland.

---

## Requirements

- [Node.js](https://nodejs.org) v18 or later
- Bitcoin Core running locally with RPC enabled
- (Optional) ZeroMQ support in Bitcoin Core (see ZMQ setup above) for real-time block updates

---

## Setup

### 1. Enable RPC on your Bitcoin Core node

In `bitcoin.conf` (usually `~/.bitcoin/bitcoin.conf`):

```ini
server=1
```

That's it for most setups. Bitcoin Core generates a `.cookie` file automatically — blockwatch reads it without any extra configuration.

### Cookie auth vs rpcuser/rpcpassword

**Important:** if you have `rpcuser` and `rpcpassword` set in your `bitcoin.conf`, Bitcoin Core will **not** generate a cookie file — it's one or the other, not both. If blockwatch is prompting for credentials on every launch, this is why.

**Option A — cookie auth (recommended).** Remove `rpcuser` and `rpcpassword` from `bitcoin.conf`, restart bitcoind, and the `.cookie` file will appear automatically. blockwatch will find it with no configuration needed.

**Option B — explicit credentials.** Keep `rpcuser`/`rpcpassword` in your conf and pass them to blockwatch via environment variables:

```bash
BITCOIN_RPC_USER=youruser BITCOIN_RPC_PASS=yourpassword node server.js
```

If you switch from explicit credentials to cookie auth, restart bitcoind after removing them and verify the cookie appeared:

```bash
ls -la ~/.bitcoin/.cookie
```

### 2. Clone, install, and run

```bash
git clone https://github.com/echo-of-ghost/blockwatch.git
cd blockwatch
npm install
node server.js
```

Then open [http://localhost:3000](http://localhost:3000) in your browser.

(If you skip `npm install`, blockwatch will still work but fall back to polling instead of using ZMQ for real-time updates.)

### 3. Enable ZMQ for real-time block updates (optional but highly recommended)

ZMQ reduces RPC load by ~14x and gives you < 1 second block notification latency instead of polling delays.

Add to `bitcoin.conf` (usually `~/.bitcoin/bitcoin.conf`):

```ini
zmqpubhashblock=tcp://127.0.0.1:28332
zmqpubhashtx=tcp://127.0.0.1:28333
```

Restart bitcoind:

```bash
bitcoin-cli stop
bitcoind -daemon
```

blockwatch will automatically detect and connect to ZMQ on startup. You'll see `zmq: tcp://127.0.0.1:28332` in the startup banner if it's working.

If you don't set up ZMQ, blockwatch will fall back to polling and still work fine — just with higher RPC overhead.

### 4. First launch

blockwatch looks for the cookie file automatically across all supported networks and platforms (in priority order):

1. `$BITCOIN_COOKIE_FILE` environment variable (if set, only this path is tried)
2. `~/.bitcoin/.cookie` — mainnet, Linux
3. `~/Library/Application Support/Bitcoin/.cookie` — mainnet, macOS
4. `~/snap/bitcoin-core/current/.bitcoin/.cookie` — mainnet, Snap
5. `~/.bitcoin/testnet4/.cookie` — testnet4
6. `~/.bitcoin/signet/.cookie` — signet
7. `~/.bitcoin/regtest/.cookie` — regtest

If multiple cookies exist (e.g. you're running signet and mainnet simultaneously), blockwatch picks the **most recently modified** one — i.e. the node that started last. To override this, set `BITCOIN_RPC_PORT` explicitly.

If no cookie is found at all, blockwatch prompts for RPC credentials in the terminal.

---

## Configuration

All configuration is via environment variables — no config file needed.

### Web Server

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | Port for the blockwatch web server |
| `HOST` | `127.0.0.1` | Interface for the blockwatch web server to bind to |

### Bitcoin RPC

| Variable | Default | Description |
|---|---|---|
| `BITCOIN_RPC_HOST` | `127.0.0.1` | Bitcoin Core RPC host |
| `BITCOIN_RPC_PORT` | *(auto-detect)* | Bitcoin Core RPC port (8332 / 48332 / 38332 / 18443) |
| `BITCOIN_COOKIE_FILE` | *(auto-detect)* | Explicit path to `.cookie` file |
| `BITCOIN_RPC_USER` | *(from cookie)* | RPC username (overrides cookie) |
| `BITCOIN_RPC_PASS` | *(from cookie)* | RPC password (overrides cookie) |

### ZMQ (optional)

| Variable | Default | Description |
|---|---|---|
| `ZMQ_HOST` | `127.0.0.1` | ZMQ publisher host (must match `zmqpubhashblock` bind address in bitcoin.conf) |
| `ZMQ_PORT` | `28332` | ZMQ publisher port (must match bitcoin.conf) |

### Examples

**Default (cookie auto-detect, ZMQ auto-connect):**
```bash
node server.js
```

**Non-default Bitcoin data directory:**
```bash
BITCOIN_COOKIE_FILE=/mnt/bitcoin/.bitcoin/.cookie node server.js
```

**Explicit RPC credentials:**
```bash
BITCOIN_RPC_USER=alice BITCOIN_RPC_PASS=hunter2 node server.js
```

**Custom ZMQ endpoint** (if not on localhost or non-standard port):
```bash
ZMQ_HOST=192.168.1.50 ZMQ_PORT=28332 node server.js
```

**Force a specific network** (when running multiple nodes):
```bash
BITCOIN_RPC_PORT=38332 node server.js   # signet
BITCOIN_RPC_PORT=48332 node server.js   # testnet4
BITCOIN_RPC_PORT=18443 node server.js   # regtest
```

**Listen on all interfaces** (to access from another device on your LAN):
```bash
HOST=0.0.0.0 node server.js
```

> **Warning:** setting `HOST=0.0.0.0` exposes the dashboard on your network. blockwatch will print a warning at startup if this is detected. Ensure your firewall is configured appropriately.

---

## Health endpoint

blockwatch exposes a lightweight health endpoint at `/health` (also `/api/health`) for use with process monitors, uptime checkers, and systemd readiness probes.

```
GET http://localhost:3000/health
```

**Response — node reachable (`200 OK`):**
```json
{
  "ok": true,
  "height": 895210,
  "chain": "main",
  "synced": true,
  "ibd": false,
  "progress": 99.999,
  "headers": 895210,
  "ts": 1748000000000
}
```

**Response — bitcoind unreachable (`503 Service Unavailable`):**
```json
{
  "ok": false,
  "error": "getblockcount: connect ECONNREFUSED 127.0.0.1:8332",
  "ts": 1748000000000
}
```

The endpoint makes only two RPC calls (`getblockcount`, `getblockchaininfo`) and is intentionally separate from the full `/api/data` fetch. It is not rate-limited.

### systemd readiness check

Add to your service file to delay dependent units until blockwatch confirms bitcoind is up:

```ini
ExecStartPost=/usr/bin/curl -sf http://127.0.0.1:3000/health
```

---

## Running as a background service

To have blockwatch start automatically on boot, service files are included for both Linux and macOS.

### Linux (systemd)

```bash
sudo cp blockwatch@.service /etc/systemd/system/
sudo systemctl enable blockwatch@YOUR_USERNAME
sudo systemctl start blockwatch@YOUR_USERNAME
```

Replace `YOUR_USERNAME` with your actual username. The service runs as that user, so cookie auth works automatically. Edit `WorkingDirectory` in the service file if blockwatch is not installed at `~/blockwatch`.

### macOS (launchd)

Edit `com.blockwatch.dashboard.plist` and replace `YOUR_USERNAME` with your actual username and update the path if needed, then:

```bash
cp com.blockwatch.dashboard.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.blockwatch.dashboard.plist
```

Logs go to `/tmp/blockwatch.log` and `/tmp/blockwatch.error.log`.

To stop:
```bash
launchctl unload ~/Library/LaunchAgents/com.blockwatch.dashboard.plist
```

---

## Connecting to a remote node

blockwatch can connect to a Bitcoin Core node on another machine. The node's RPC port must be reachable from the machine running blockwatch.

```bash
BITCOIN_RPC_HOST=192.168.1.50 BITCOIN_RPC_PORT=8332 \
BITCOIN_RPC_USER=alice BITCOIN_RPC_PASS=hunter2 node server.js
```

**Security note:** Bitcoin Core's RPC is not encrypted. For remote access, use one of:
- A local network you trust (home LAN, Tailscale, WireGuard)
- An SSH tunnel: `ssh -L 8332:127.0.0.1:8332 user@remotehost`, then point blockwatch at `127.0.0.1:8332`

Do not expose the RPC port directly to the internet.

---

## Network themes

blockwatch automatically applies a colour theme based on the connected chain, so it's always clear which network you're looking at.

| Chain | Accent | RPC port |
|---|---|---|
| Mainnet | Orange | 8332 |
| Testnet4 | Blue | 48332 |
| Signet | Gold | 38332 |
| Regtest | Purple | 18443 |

The theme is applied instantly on data load — no configuration needed.

---

## Using your own mempool.space instance

Block hashes in the blocks table link to [mempool.space](https://mempool.space) for full transaction-level detail. These links are chain-aware — testnet4 and signet blocks link to the correct mempool.space subdirectory automatically.

To point links at your own self-hosted [mempool](https://github.com/mempool/mempool) instance, find the `mspaceUrl` function in `client/shared.js` and update the base URL:

```js
// In blockwatch.js — mspaceUrl function
function mspaceUrl(hash, chain){
  const p={testnet4:'testnet4/',signet:'signet/'};
  const safeHash=/^[0-9a-fA-F]{64}$/.test(hash||'')?hash:'';
  return 'https://mempool.space/'+(p[chain]||'')+'block/'+safeHash;
  //      ↑ replace with your instance, e.g. 'http://192.168.1.50:8080/'
}
```

If your instance only serves one network, you can simplify the path logic too.

---

## Interface

### Panels

All panels are resizable by dragging the handles between them. Panels can also be dragged by their header to reorder them within or across columns. Hide a panel by right-clicking its header for a context menu. Hidden panels can be restored via the restore chips that appear in the titlebar.

Panel order, column widths, and hidden state all persist automatically across page refreshes via localStorage.

### Terminal

Press **Ctrl+`** (or **Cmd+`** on macOS) to open the built-in terminal drawer. Available in the Electron app only.

Type any bitcoin-cli RPC method and arguments directly:

```
getblockchaininfo
getmempoolinfo
gettxoutsetinfo
getpeerinfo
estimatesmartfee 1
getblock <hash> 2
```

Arguments are parsed the same as bitcoin-cli — strings, numbers, and JSON all work. Use ↑/↓ to navigate history. Output is syntax-highlighted JSON.

RPC calls are routed through the Electron main process. Credentials are never exposed to the renderer.

### Peer controls

Click any row in the peers table to inspect that peer's full detail — protocol version, services, latency, sync height, bandwidth, and gossip stats. From the detail panel you can disconnect a peer or ban them for 1h / 24h / 7d / 30d / permanently. Ban list is shown in the bans panel and entries can be removed from there.

### Status bar

The bottom status bar shows:
- Live connection dot (pulses green when synced, red on error)
- Staleness indicator — shows time since last successful fetch if data is stale
- Any node warnings from `getblockchaininfo`
- Hidden panel restore chips (appear in titlebar when panels are hidden)

---

## Project structure

```
blockwatch/
  server.js                      — Node.js HTTP server, Bitcoin Core RPC client, ZMQ subscriber
  client/
    boot.js                      — Initialization, event wiring, polling start
    network.js                   — EventSource listener, bandwidth tracking, data export
    terminal.js                  — In-app terminal drawer (Electron only)
    *.js                         — Panel rendering modules
  electron/
    main.js                      — Electron main process, window creation, terminal IPC
    preload.js                   — Context bridge: terminal RPC, platform class, toggle relay
  assets/
    icon.png                     — App icon (1024×1024)
  index.html                     — Frontend markup
  blockwatch.css                 — Styles
  package.json                   — Dependencies and electron-builder config
  blockwatch@.service            — systemd service file (Linux)
  com.blockwatch.dashboard.plist — launchd service file (macOS)
  CHANGELOG.md
  README.md
  LICENSE
```

Node.js built-ins handle HTTP, RPC, and data. ZMQ support is optional via the `zeromq` npm package for real-time block notifications. Without it, blockwatch falls back to polling automatically.

To install with ZMQ:
```bash
npm install
node server.js
```

To run without ZMQ (polling only):
```bash
node server.js   # falls back automatically if zeromq not installed
```

---

## Font

blockwatch uses [Geist](https://vercel.com/font/geist) for a clean, modern monospace look. Both `Geist` and `Geist Mono` are bundled as local `.woff2` files — no external requests, no network dependency.

---

## Update schedule

Data updates on multiple timers and events:

**Block Event (ZMQ hashblock — ~every 10 minutes):**
```
getblockchaininfo
getblockheader
getblockstats
getchaintxstats
getmempoolinfo
```
Total: **5 calls per block**

**Fast Refresh (every 5 seconds):**
```
getnettotals           (bandwidth history)
getmempoolinfo         (mempool size/fee rates)
```
Total: **2 calls × 12/min = 24 calls/min**

**Sparse Refresh (every 60 seconds):**
```
getpeerinfo            (peer list, bandwidth)
getnetworkinfo         (network stats, warnings)
getchaintips           (orphan/alternate chains)
uptime                 (node uptime)
estimatesmartfee [1]   (next block, skipped during IBD)
estimatesmartfee [6]   (6 blocks)
estimatesmartfee [144] (1 day)
estimatesmartfee [1008](economy)
```
Total: **4 calls always + 4 fee calls = 8 calls/min** (4 calls/min during IBD)

**Deployment Refresh (every 5 minutes):**
```
getdeploymentinfo      (softfork status)
```
Total: **0.2 calls/min**

### RPC Load Comparison

| Scenario | Calls/min | Notes |
|----------|-----------|-------|
| **With ZMQ** | ~13 | 0.5 block + 24 fast + 8 sparse + 0.2 deployment |
| **Without ZMQ (polling)** | ~180 | Full snapshot every 10s |
| **Reduction** | **14x** | Huge improvement with ZMQ |

The `/api/data` endpoint serves cached state — no additional RPC calls made.

---

## Notes

- **IBD (Initial Block Download)** — During sync, blockwatch automatically limits the blocks table to 8 entries (vs 12 when synced) and skips fee estimates to reduce RPC load on a node already running at capacity. ZMQ block events continue to fire normally. Everything returns to normal automatically once IBD completes.
- **ZMQ configuration** — ZMQ is optional. If enabled in `bitcoin.conf`, blockwatch uses it for real-time block notifications (~0.5 RPC calls/min). If not available, blockwatch falls back to polling every 10 seconds (~180 RPC calls/min).
- **Cookie vs credentials** — Bitcoin Core will not create a `.cookie` file if `rpcuser`/`rpcpassword` are set in `bitcoin.conf`. If blockwatch is prompting for credentials on every launch, remove those lines from your conf and restart bitcoind.
- **Fee estimates** — `estimatesmartfee` is called during the 60s sparse refresh, but only when not in IBD mode. On a freshly started node, fee estimates will show a "warming up" message rather than stale or synthetic data. Estimates update every minute once warmed up.
- **Onion / I2P peers** — Peer addresses are displayed as plain text. Only clearnet addresses link to mempool.space since onion/i2p addresses are not resolvable there.
- **Difficulty retarget estimate** — The estimated difficulty change is computed from actual measured block times during the current 2016-block period, not from the theoretical 10-minute target. The history resets at each new period.
- **getdeploymentinfo** — Available in Bitcoin Core v24+. On older nodes this call returns null and the softforks panel renders nothing rather than erroring. Updates every 5 minutes.
- **Mempool updates** — The mempool panel updates every 5 seconds (via fast refresh). This gives real-time visibility into tx count, size, and fee rates without the latency of a full sparse refresh.
- **Bandwidth history** — The network bandwidth chart maintains a 10-minute rolling window at 5-second resolution (120 samples). This requires a ZMQ setup to avoid excessive polling; with ZMQ the 5s refresh adds minimal RPC overhead.
- **Security** — The `/api/rpc` endpoint (used for peer disconnect/ban actions) is restricted to loopback connections only. The web server enforces an `Origin` header check so only localhost origins can make API calls. Every response includes a `Content-Security-Policy` header and a `Permissions-Policy` header that explicitly disables camera, microphone, geolocation, and payment APIs. If `HOST` is set to anything other than `127.0.0.1`, blockwatch prints a warning at startup.
- **Connection errors** — If bitcoind is unreachable on first load, the connecting overlay is shown. After a successful first load, any subsequent connection errors surface in the status bar only — the dashboard stays visible with the last good data. The stale indicator shows how long data has been stale.

---

## License

GNU GENERAL PUBLIC LICENSE
