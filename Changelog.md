# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.3] - 2026-04-05

### Fixed
- **Block chime fires during IBD and offline catch-up**: Audio now only plays when fully synced — `ibd: false`, `blocks === headers`, and `verificationprogress >= 0.9999`. The `blocks === headers` check catches the final 1–2 catch-up blocks that slip through once `verificationprogress` already reads as complete.

## [2.2.2] - 2026-04-05

### Fixed
- **Block chime fires during IBD and offline catch-up**: Initial fix using a 3-minute timestamp threshold — superseded by 2.2.3.

## [2.2.1] - 2026-04-02

### Fixed
- **Panel drag highlight disappears after several swaps**: `_bringToFront` incremented `_zTop` unboundedly from 20. Once it exceeded 50 (the swap ghost's z-index), panels rendered on top of the highlight overlay making it invisible — the swap still worked but gave no visual feedback. Fixed by compacting all panel z-indexes back to the 11–19 range before `_zTop` approaches the ghost layer.
- **Persistent dashed insert line after interrupted drag**: Orphaned `drop-ghost` / `drop-insert-line` elements left by a drag that lost its pointer event (e.g. window focus change) are now cleaned up at the start of every new drag.

## [2.2.0] - 2026-04-02

### Added
- **New block audio**: A subtle chime plays on every new block. Uses a bundled `assets/block.ogg` — no format detection, no network request, no latency. Preference persisted in `localStorage`.
- **Audio toggle badge**: The sound toggle is now a styled badge in the titlebar (matching `tb-ver-badge` / `tb-sync-badge`) — muted grey when off, orange-tinted when on. Previously it was a bare `♪` with no visual weight.
- **Block timing gradient fill**: A subtle gradient area fill now traces behind the block timing bars, giving the chart visual grounding instead of floating bars.

### Changed
- **Electron-only**: Removed standalone browser support. blockwatch is now exclusively an Electron desktop application. Run with `npm run app` or the packaged AppImage. `node server.js` is no longer a supported usage pattern.
- **Hero bar typography**: All four hero strip values now share the same `--fs-2xl` font size. Previously the first value was larger than the rest.
- **Fee estimates simplified**: Reduced from 4 parallel `estimatesmartfee` calls (targets 1, 6, 144, 1008) to a single call (target 1). Only the next-block fee rate is displayed, in the hero strip. RPC overhead reduced accordingly.
- **Tip age ticks live**: The chain tip age and hero tip age now update every second via the staleness interval, using `poller._lastData`. Previously they only updated on SSE broadcast, causing the counter to freeze between blocks.

### Removed
- **Fee estimates panel**: Standalone fee estimates panel removed from the layout. Next-block fee (sat/vB) is shown in the hero strip only.
- **`client/panels/fees.js`**: Module deleted. The single line it set (`ch-tip-age`) is now inlined in `boot.js`.

### Fixed
- **Block sound silent after restart**: Format discovery chain (`mp3` → `ogg` fallback) caused the first block after every restart to play no sound, as the discovery resolved too late. Replaced with a single hardcoded `.ogg` instantiation.
- **TSV export wrong columns**: Block panel TSV export used `b.txCount` (undefined) and `b.fillPct` (not stored on block objects). Fixed to use `b.txs` and compute fill % inline from `b.weight`.
- **Dead event listener**: `reset-layout-btn` was wired in `boot.js` but the element does not exist in the HTML. Listener removed.

## [2.1.0] - 2026-03-30

### Added
- **Themed text selection**: `::selection` now uses the chain accent colour (orange on mainnet, with per-chain overrides for testnet4/signet/regtest) instead of the browser default blue.

### Changed
- **Peer detail panel redesigned**: ping and connected-time are now displayed as large `--fs-xl` hero metrics. A split bandwidth bar (sent/recv) replaces the plain text labels. Stat grid reduced to the four most useful fields. Address displayed in monospace at `--fs-xl` / `font-weight: 400` — readable across IPv4, IPv6, and 62-character onion v3 addresses without truncation.
- **Titlebar decluttered**: removed the block height from the titlebar; the hero strip already shows it prominently at large size.
- **Titlebar vertical alignment**: all titlebar elements (version, sync badge, clock, snapshot button) now align to centre. Previously the clock appeared slightly higher than adjacent elements due to `inline-flex` baseline calculation differences.
- **Hover highlight rows**: `.kv`, `.bd-kv`, `.pd-kv` hover state now uses a `::before` pseudo-element (`inset: 0 -12px; z-index: -1`) instead of a negative margin, eliminating the layout reflow on hover.
- **Color tokens**: `--pos` / `--pos-rgb` / `--pos-dim` renamed to `--amber` / `--amber-rgb` / `--amber-dim` throughout CSS and JS for clarity. `--bg-canvas` token added for the app background.
- **Contrast improved**: `--t3` raised from `#686868` to `#808080` and `--t4` from `#585858` to `#686868` to meet WCAG AA contrast ratios on the dark background.
- **Font weight declaration corrected**: `@font-face` declared `font-weight: 100 900` (variable range) but only a Regular `.woff2` is bundled. Changed to `font-weight: 400` to match what is actually loaded.
- **`user-select: none` scope tightened**: removed from `.panel` (which blocked text copy in detail panes); the drag handle `.ph` already had it.
- **Service badge contrast**: `.svc-cap` background raised from `--t4` to `--t2` so the badge text passes contrast requirements.

### Fixed
- **Block height search keyboard access**: the `#` height label in block detail now has `role="button"`, `tabindex="0"`, and an `aria-label`, and responds to Enter/Space — previously only clickable with a mouse.
- **Dead CSS removed**: eliminated unused peer-table selectors (`.ping-cell`, `.ping-dot`, `.peer-bw-wrap`, `.td-dir`, `.td-net`, `.td-ver`, `.td-peer-addr`, `.td-inout`, `.td-bw`, and the `td:nth-child(8)` rule) left over from earlier peer table iterations.

## [2.0.0] - 2026-03-29

### Added
- **Electron desktop app**: blockwatch now ships as a standalone desktop application distributable as an AppImage (Linux). Frameless window with native macOS traffic lights via `titleBarStyle: hiddenInset`. Build with `npm run dist`, run in dev with `npm run app`.
- **In-app terminal**: A slide-up terminal drawer gives direct bitcoin-cli style access to any RPC method without leaving the app. Toggle with Ctrl+\` (or Cmd+\` on macOS). Full command history (↑/↓), JSON syntax highlighting, and quoted/JSON argument parsing.
- **IPC security model**: Terminal RPC calls are routed through the Electron main process via `ipcMain`/`contextBridge`. RPC credentials never reach the renderer. Rate-limited to one call per 200ms. Only explicitly allowed via the `terminal:exec` IPC channel.
- **Slow RPC timeout**: Methods that can run for minutes (`gettxoutsetinfo`, `scantxoutset`, `rescanblockchain`, `verifychain`, and related wallet import/rescan calls) use an 11-minute timeout instead of the default 12-second timeout, preventing premature failures during UTXO scans.
- **Platform-aware layout**: `<body>` receives `platform-linux` / `platform-darwin` / `platform-win32` class via preload, allowing CSS to suppress the macOS traffic-light inset padding on Linux.

### Changed
- **Block timing chart**: Bars now render more accurately with corrected spacing and scale.
- **Ban rows**: Ban list entries display more cleanly in the peers panel.
- **`client/shared.js` formatting**: Minor cleanup to fee normalisation and shared utilities.


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
