# Changelog

All notable changes to blockwatch are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [1.1.0] — 2026-03-11

### Added
- **`/health` and `/api/health` endpoints** — returns node status as JSON (`ok`, `height`, `chain`, `synced`, `ibd`, `progress`, `headers`, `ts`). Responds `200` when bitcoind is reachable and `503` when it is not. Useful for systemd `ExecStartPost` readiness checks, uptime monitors, and reverse proxy health probes.
- **`Permissions-Policy` response header** — explicitly disables camera, microphone, geolocation, and payment APIs. Completes the HTTP security header set alongside the existing CSP.

### Notes
- `/health` is unauthenticated and intentionally lightweight — it makes only two RPC calls (`getblockcount`, `getblockchaininfo`) rather than the full fetch.
- Both `/health` and `/api/health` resolve to the same handler for convenience.

---

## [1.0.0] — 2026-03-11

Initial release.

### Features
- Real-time chain, mempool, peer, and network data via Bitcoin Core RPC
- Zero dependencies — Node.js built-ins only (`http`, `fs`, `path`, `os`, `readline`)
- Cookie auth with automatic multi-platform, multi-network discovery (Linux, macOS, Windows, Snap)
- IBD-aware — reduced polling, skipped expensive RPC calls, real-time ETA during initial sync
- In-flight RPC deduplication — multiple browser tabs share one server-side fetch
- Persistent panel layout via `localStorage` (order, column widths, hidden state)
- Chain-aware UI themes — orange (mainnet), blue (testnet4), gold (signet), purple (regtest)
- Peer inspect, disconnect, and ban controls (loopback-restricted)
- CSRF Origin check, Content-Security-Policy, rate-limited `/api/data` endpoint
- Systemd and launchd service files included
- ANSI-themed terminal banner matching UI accent colours