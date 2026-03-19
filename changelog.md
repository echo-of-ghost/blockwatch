# Changelog

All notable changes to blockwatch are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

---

## [1.1.0] — 2026-03-11

### Added

- **`/health` and `/api/health` endpoints** — lightweight JSON status probe (`ok`, `height`, `chain`, `synced`, `ibd`, `progress`, `headers`, `ts`). Returns `200` when bitcoind is reachable, `503` when it is not. Makes only two RPC calls (`getblockcount`, `getblockchaininfo`) — intentionally separate from the full `/api/data` fetch and not rate-limited. Useful for systemd `ExecStartPost` readiness checks, uptime monitors, and reverse proxy health probes.
- **`Permissions-Policy` response header** — explicitly disables camera, microphone, geolocation, and payment APIs on every response. Completes the HTTP security header set alongside the existing `Content-Security-Policy`.

### Changed

- Rate-limit comment in `server.js` clarified: the token bucket is a **global** guard against abusive polling loops, not a per-IP quota. Multi-tab behaviour (in-flight deduplication) documented inline.

---

## [1.0.0] — 2026-03-11

Initial public release.

### Added

**Core**
- Real-time Bitcoin node dashboard via Bitcoin Core RPC — zero npm dependencies, Node.js built-ins only (`http`, `fs`, `path`, `os`, `readline`)
- Cookie auth with automatic discovery across platforms and networks in priority order: `$BITCOIN_COOKIE_FILE` env override → mainnet Linux → mainnet macOS → mainnet Snap → testnet4 → signet → regtest. Falls back to interactive credential prompt if no cookie is found.
- All configuration via environment variables (`PORT`, `HOST`, `BITCOIN_RPC_HOST`, `BITCOIN_RPC_PORT`, `BITCOIN_COOKIE_FILE`, `BITCOIN_RPC_USER`, `BITCOIN_RPC_PASS`) — no config file needed.
- In-flight RPC deduplication — multiple browser tabs share a single server-side fetch batch; no duplicate RPC calls regardless of tab count.
- CSRF `Origin` header check — rejects any non-localhost origin on API endpoints, preventing malicious pages from reaching the server even when both are open in the same browser.
- `Content-Security-Policy` header on all responses.
- Rate-limited `/api/data` endpoint (5 req/s global token bucket) to protect bitcoind from abusive polling.
- `/api/rpc` peer action endpoint (disconnect, ban) restricted to loopback connections only.
- Systemd (`blockwatch@.service`) and launchd (`com.blockwatch.dashboard.plist`) service files included for background operation.
- ANSI-themed terminal startup banner reflecting the connected chain's accent colour.

**Dashboard panels**
- **Node** — chain height, headers, sync %, tip age, median time, chain tips / orphan detection, mempool stats (tx count, size, usage, fees, RBF), network connections (in/out split), relay fee, network reachability (IPv4/IPv6/onion/i2p/cjdns), local addresses (masked by default), config (chain size, prune state, protocol version).
- **Chain** — tip age, fee estimates for next block / 6 blocks / 1 day / economy with urgency colour-coding, softfork deployment status (all BIP9 forks, live badges: active / locked / signalling / defined / failed / buried). Requires Bitcoin Core v24+ for `getdeploymentinfo`; degrades silently on older nodes.
- **Network** — live upload/download rates, total bytes sent/received, dual-series sparkline (recv orange, sent amber) with gradient fill and peak-rate Y-axis label.
- **Blocks** — last 12 blocks: height, truncated hash (links to mempool.space, chain-aware), tx count, in/out value, block fill % with mini-bar, age. Animated row flash on new block arrival.
- **Block detail** — per-block: height, full hash (copyable), age, tx count, value in/out, size, fill %, avg fee, total fee, subsidy, halving era, fee share of reward, miner signalling, BIP9 version bits, median time.
- **Fee heatmap** — fee rate distribution ridge chart across recent blocks (canvas).
- **Fee/subsidy** — sparkline of fee revenue as a % of total block reward across recent blocks (canvas).
- **Block timing** — bar chart of inter-block intervals, reveals mining variance (canvas).
- **Mining** — difficulty, estimated hashrate (computed from actual observed block interval), chainwork (copyable), tx/s and total tx count, difficulty retarget: next block, blocks remaining, estimated date, estimated % adjustment and direction based on current-period block velocity. Retarget history resets at each new 2016-block period.
- **Peers** — inbound/outbound table: direction indicator, address, network type (IPv4/IPv6/onion/i2p), user agent, sync height, ping latency with colour-coded dot, upload/download with mini-bar. Row click opens peer detail.
- **Peer detail** — four tabs (conn / sync / bw / gossip): full address, connection type, user agent badge, services flags, version, sync height, ping, connected duration, bytes sent/received with sparkline, gossip stats. Disconnect and ban controls (1h / 24h / 7d / 30d / permanent).
- **Banned** — list of banned peers with address, expiry, and unban button. Refreshes every 60s independently.
- **Services** — local node service flags rendered as colour-coded badges (core / capability / limited tiers).

**Layout and UX**
- Four-column resizable layout — columns drag-resize horizontally, panels drag-resize vertically within columns.
- Panel drag-and-drop reordering — drag by panel header to reorder within or across columns.
- Panel close and restore — hide via `×` or right-click context menu; restore from status bar pills.
- Persistent layout — panel order, column widths, and hidden state saved to `localStorage` and restored on next load.
- Chain-aware UI themes — CSS custom property swap on `<html>` class: orange (mainnet), blue (testnet4), gold (signet), purple (regtest). Applied from `localStorage` before first fetch so the connecting screen is always correctly themed.
- Dynamic favicon — SVG favicon colour matches chain accent, updated on every render.
- Dynamic `<title>` — shows current block height and chain name.
- Connecting overlay with animated logo, chain-accurate grid background, retry countdown, and manual retry button.
- Node warning banner — surfaces `warnings` from `getblockchaininfo` at the bottom of the viewport.
- Status bar — staleness indicator, error display, hidden panel restore pills, live connection dot (pulsing orange / amber / red).
- IBD mode — reduced polling (30s), skipped expensive RPC calls, sync progress bar with real-time ETA from velocity. Returns to normal automatically on IBD completion.
- Tab visibility API — polling pauses when the tab is hidden, resumes with an immediate fetch on return.
- Copy-to-clipboard on hash and chainwork values via `⎘` icon with flash feedback.
- TSV export for peer table; JSON snapshot export for full data payload.
- Keyboard shortcut: `R` to force a full refresh.

