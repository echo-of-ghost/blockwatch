# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]


## [1.3.0] - 2026-03-29

### Added
- **ZMQ real-time block notifications**: The server now subscribes to bitcoind's `zmqpubhashblock` feed via `zeromq`. New blocks trigger an immediate full-refresh RPC burst and broadcast to all SSE clients, replacing the previous 10-second poll interval for block updates. Falls back to polling automatically if ZMQ is unavailable or not configured.
- **ZMQ chain watcher**: `startChainWatcher()` polls `getblockchaininfo` every 10 seconds alongside ZMQ, detecting chain switches even when the ZMQ subscriber silently hangs after bitcoind restarts.
- **Chain-switch client reset**: On chain change the client now flushes bandwidth and mempool chart history, resets block and peer selection state, and clears the bandwidth rate baseline — preventing data from one chain appearing in another chain's charts.
- **Bitcoind-down indicator**: Stale data age is now tracked in the status bar; after 60 seconds without a fresh update the pulse dot turns red and a "bitcoind unreachable" toast fires (one-time, resets when data resumes).
- **Peer network-type badges**: Restored `in`/`out` direction badges and `ipv4`/`ipv6`/`onion`/`i2p` type badges in the peer list and peer detail panel.

### Fixed
- **Stale dot not resetting**: Removed `!dot.classList.contains('err')` guards so the pulse dot correctly returns to green when fresh data resumes after an outage.
- **Peer bandwidth bars scaled incorrectly**: Bars now share a single `maxBw` scale (max of sent and received across all peers) instead of separate sent/received scales, making relative sizes accurate.
- **Mempool appearing frozen**: Fast and sparse refresh cycles now skip broadcasting when all RPC calls return null, preventing stale timestamps from making the client believe it received fresh data.
- **Chain auto-detection regression**: Chain changes are now detected in both `startPollFallback` and `onNewBlock` handlers, in addition to the dedicated chain watcher, ensuring a full `initState()` re-fetch on any code path.
- **Block detail stale after chain switch**: `blocksPanel._initialised` is reset on chain switch so the tip block of the new chain is auto-selected.
- **`maxCompletedG` redundant spread**: Eliminated a duplicate `Math.max(...completedVals)` computation in the block timing chart.

### Changed
- **SVG noise grain**: Increased tile to 200×200, `baseFrequency` to 0.65, `numOctaves` to 6, opacity to 0.055 for a more refined texture.
- **Scroll fade**: Extracted repeated gradient blocks in `.pb`, `.pd-body`, `.bd-body` into a `--scroll-fade` CSS custom property.
- **Mining panel header**: Hashrate now uses `fs-2xl` / weight 300 consistent with Block and Mempool panel headers; padding corrected to match surrounding panels.
- **`package.json` license**: Corrected `"MIT"` → `"GPL-3.0"` to match the LICENSE file.
- **README**: Fixed `mspaceUrl` file reference (`blockwatch.js` → `client/shared.js`) and corrected font-loading description (bundled `.woff2`, not Google Fonts).


## [1.2.0] - 2026-03-27

### Changed
- Complete redesign of the dashboard using a modern **bento-style grid layout** for improved visual density and responsiveness.
- Updated core files (`index.html`, `blockwatch.css`, `blockwatch.js`) to support the new layout.
- Refreshed screenshots and related assets.
- Bumped version to 1.3.0 with minor modular architecture and font/icon improvements.

**Merged PRs:**
- feat(ui): redesign dashboard with bento-style layout ([#8](https://github.com/echo-of-ghost/blockwatch/pull/8))

## [1.1.0] - 2026-03-19

### Added
- Persistent layout system: panel order, column widths, and hidden state are now saved via `localStorage`.

### Changed
- New hero strip layout — value stands alone on its own line, with label and sub-text in a footer row (sub-text pushed right).
- Uniform 3px gutter between all layout regions.
- Table headers now blend with panel background (removed dark band).
- Service badges redesigned with a cleaner three-tier hierarchy.
- `--net` color now derived neutrally from the chrome instead of using an independent hue.
- Per-theme accent colors audited and tightened for testnet4, signet, and regtest.
- Overall visual redesign: tightened spacing, refined color palette, improved table and peer display consistency.

**Merged PRs:**
- Panel Redesign ([#4](https://github.com/echo-of-ghost/blockwatch/pull/4))
- Updated screenshots ([#5](https://github.com/echo-of-ghost/blockwatch/pull/5))
- Update README.md ([#6](https://github.com/echo-of-ghost/blockwatch/pull/6))
- Fix documentation ([#7](https://github.com/echo-of-ghost/blockwatch/pull/7))

## [1.0.1] - 2026-03-13

### Fixed
- Splitter bar insertion order: `_rebuildBars` now correctly places bars directly before the next visible panel.
- Hidden panel handling: `_initBar` walker now skips panels with `display: none` and exits early if no valid visible bottom panel exists (prevents incorrect bar placement).

**Merged PRs:**
- Fix bar insertion order and skip hidden panels in layout ([#3](https://github.com/echo-of-ghost/blockwatch/pull/3))
- Remove unnecessary `getblockchaininfo` RPC call from startup output ([#2](https://github.com/echo-of-ghost/blockwatch/pull/2))

## [1.0.0] - 2026-03-11

### Added
- Initial release: Self-hosted, real-time Bitcoin node dashboard.
- Direct RPC connection to local `bitcoind` (no external APIs or dependencies beyond Node.js).
- Live display of chain info, blocks, mempool, peers, network status, softforks, fee estimates, and more.
- Support for mainnet, testnet4, signet, and regtest.
- Clean single-page browser UI with adaptive polling and network-aware theming.

**Merged PRs:**
- Initial commit ([#1](https://github.com/echo-of-ghost/blockwatch/pull/1))

---

**Created for:** [echo-of-ghost/blockwatch](https://github.com/echo-of-ghost/blockwatch)
