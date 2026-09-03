# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.2.4] - 2026-09-03

Production-hardening release from a full server/client/Electron audit. Findings were reproduced against a mock Bitcoin Core (RPC + ZMQ) exercising reorgs, catch-up bursts, node restarts, warm-up errors, chain switches, malformed requests and CSRF/DNS-rebinding probes, then every fix was validated against Bitcoin Core v31.1: regtest with genuine `invalidateblock` reorgs, and a pruned signet node followed through a full 320,572-block sync and out the other side. 46 mock scenario checks and 62 real-node checks pass.

### Fixed
- **Server crash on malformed request line**: a request-target that `new URL()` rejects (e.g. `GET http://[::1 HTTP/1.1`) threw inside the async HTTP handler, became an unhandled rejection and ran the shutdown path — before authentication. The handler is now wrapped and answers 400.
- **Blocks frozen when ZMQ is installed but not delivering**: ZMQ `connect()` never fails, so with no `zmqpubhashblock` in `bitcoin.conf` (or a mismatched `ZMQ_HOST`) the dashboard never saw another block. The 10s chain watcher is now a tip watcher: it compares `bestblockhash` and triggers the per-block refresh itself. ZMQ only makes delivery faster; `zmqMode` / `/api/health` `blockSource` now report which path is actually delivering.
- **Reorgs ignored**: dedup was by height only, so a same-height reorg kept the orphaned tip, and deeper reorgs left orphaned blocks in the list. The refresh now dedups on `bestblockhash`, verifies `previousblockhash` linkage against held blocks, walks down until the chains join, and logs `[reorg]`. The block-detail panel re-renders if the block it shows was reorged out.
- **Explicit credentials ignored when a cookie exists**: `getAuth()` re-read the cookie every 5s and preferred it over `BITCOIN_RPC_USER`/`BITCOIN_RPC_PASS` (and prompted credentials), also overriding the RPC port. Explicit credentials now always win.
- **CSRF / cross-origin exposure**: remote mode skipped the Origin check and CORS echoed any Origin, so a cross-site form/fetch with the browser's cached Basic credentials could `setban`/`disconnectnode`/`gettxoutsetinfo`. CORS headers are removed (the app is same-origin), `Origin` must match `Host` in both modes, and `/api/rpc` requires `Content-Type: application/json`.
- **DNS rebinding**: local mode now requires a `localhost` / `127.0.0.1` / `[::1]` `Host` header. `HOST=<non-loopback>` without `BLOCKWATCH_REMOTE=1` refuses to start instead of exposing an unauthenticated dashboard.
- **`/api/rpc` parameters unvalidated**: `setban 0.0.0.0/0` was accepted and `gettxoutsetinfo` could be run concurrently. Parameters are now schema-checked per method (ban targets must be IP literals, subnets no wider than /16 or /32) and the UTXO scan is single-flight (409 while running).
- **`getchaintxstats` window off by one**: `min(2016, height)` violates Core's `nblocks < height` rule, so chains shorter than 2017 blocks (regtest, fresh signet) never got tx/s or average block time. Window is now `min(2016, height-1)`.
- **Difficulty retarget estimate used the wrong window**: it was computed from the trailing 2016 blocks (spanning the already-retargeted previous period). The server now also fetches `getchaintxstats` over exactly the blocks mined this period and the client applies Core's formula (2015 intervals, ratio clamped to ¼–4×). Shows `—` on the first block of a period.
- **Bandwidth chart dips/spikes on every block**: the rate was derived from message arrival time, but block/peer broadcasts re-send the last `getnettotals`. Samples are now timed by `getnettotals.timemillis` and unchanged totals keep the previous rate.
- **Stalled SSE clients leaked memory**: a client that stopped reading accumulated every broadcast in process memory. Clients with more than 8 MB unsent are dropped and SSE sockets use TCP keepalive.
- **Crash exit codes**: crash paths exited 0 (and `EADDRINUSE` exited 0 via an uncaught exception), so `Restart=on-failure` never restarted the service. Crashes and listen failures exit 1 with a clear message.
- **Headless start hang**: with no cookie and no credentials on a non-TTY stdin (systemd, launchd, AppImage) the credential prompt waited forever. It now fails fast with instructions; the Electron app shows an error dialog.
- **Block table stayed degraded after IBD finished**: blocks fetched during initial sync carry no `getblockstats` data and the window is trimmed to 8, but nothing rebuilt it when sync completed — the table refilled one block at a time over the following hours, with the IBD-era rows permanently showing zero size, weight and fees. The snapshot is now rebuilt as soon as `initialblockdownload` clears.
- **Block timing chart floated at the top of its panel in the two-column layout**: between 768px and 1023px the panels form a grid whose rows stretch to a uniform height, but the chart canvas was hard-clamped to `clamp(160px, 45vw, 220px)` in both CSS and `chartHeight()`, so it could not grow into a stretched panel and left dead space beneath it. The clamp now applies only to the single-column layout below 768px, where panels are content-sized and deriving the canvas height from its own container would be circular. In the two-column layout the panel has a definite height and the chart fills it, bars anchored to the bottom.
- **Stale client scripts and styles after upgrade**: client JS and the stylesheet are cached for an hour under unversioned URLs while `index.html` is `no-store`. Both are now stamped with their ETag.
- **Block chime guard read a non-existent field** (`bc.ibd` instead of `initialblockdownload`).
- **Average fee-rate fallback** divided by raw size (sat/byte) while labelled sat/vB; now uses weight/4.
- **Startup logged a missing `client/panels/fees.js`** (deleted in 2.2.0).
- **Electron**: Ctrl+` is only registered while the window is focused (no longer steals the shortcut from other apps); `terminal:exec` validates the IPC sender, method name and params; `will-navigate` off the local origin is blocked; only `http(s)` URLs are handed to the system browser.

- **Empty blocks looked like missing data**: Core's `getblockstats` reports `total_size` and `total_weight` for non-coinbase transactions only, while `txs` counts the coinbase, so a coinbase-only block rendered as `—` size and `—` fill as though the data had failed to load. Such blocks now read `coinbase only` and `0%`, and the size and weight figures are labelled as transaction data. Verified against Bitcoin Core v31.1: for a four-transaction regtest block, `getblock` reports 2575 weight where `getblockstats` reports 1683, the 892-unit difference being the coinbase.

- **Text contrast now actually meets WCAG AA**: every text token was measured against all four surfaces, and the dim tiers failed. `--t4`, which colours nearly every label in the UI, sat at 3.06:1 against `--raised` where AA requires 4.5:1; `--t3` failed on the same surface, as did `--grn2` and `--neg`. The ramp is now `--t2` #bcbcbc, `--t3` #9c9c9c, `--t4` #868686, with `--grn2` #4f9a60 and `--neg` #d86868, the worst case being 4.68:1. The recessed tier reads visibly lighter as a result. The 2.1.0 entry that claimed this was already done has been corrected.
- **Chart labels were the worst offenders and are now on the palette**: canvas text cannot inherit CSS custom properties, so axis and legend labels were hardcoded greys — the bandwidth chart's x-axis labels were `rgba(64,64,64)`, roughly 1.9:1. Charts now read the tokens through a `cssColor()` helper and stay inside the same contrast budget.
- **Focus is no longer signalled by colour alone**: the tooltip anchors and the block-height and terminal inputs each cleared their outline, leaving keyboard focus visible only as a colour change (WCAG 1.4.1). All three keep a visible ring.
- **Sub-scale text removed**: three badge rules set `font-size: 8px`, below the 10px floor of the type scale. They now use `--fs-xs`.
- **The spacing scale is now real**: `--sp-1` through `--sp-6` were defined, documented as a 4px grid, and referenced exactly zero times, against 260 hardcoded pixel values. Measured, the CSS runs on a 2px rhythm, not 4px. The tokens are redefined accordingly (`--sp-2` … `--sp-24`, named by value) and now cover 260 of 265 spacing declarations. The five that remain literal are deliberate one-offs — the 28px hero gutter, the 40px mobile offset, an 80px indent, and two negative bleed margins — and are documented as such. Aliasing the 198 already-on-rhythm values was verified to be a pure rename: computed padding, margin and gap were captured for all 207 element signatures before and after and are byte-identical. Normalising the 62 odd values (1, 3, 5, 7, 9px) onto the rhythm changes only the peer rows, whose pitch grows 69px to 73px, which also relieves the badge padding left tight by the 8px-to-10px font change above.

- **Peer detail now shows an overview instead of a placeholder**: with no peer selected, the largest panel on the dashboard held one line of grey text in roughly 550px of empty space. It now summarises the peer set — count and inbound/outbound split, median and range of ping, total bandwidth each way, network mix, user agent spread, and how many peers are on v2 transport or relaying transactions. Everything is derived from the peer list already in state, so it costs no extra RPC calls.
- **Hashrate no longer reads `0.00 GH/s`**: `fmtHR` stopped at gigahashes, so signet and regtest difficulties formatted as zero. The ladder now continues down through MH/s, KH/s and H/s. Signet reads 349.51 KH/s.
- **Block fill bars are visible at low fill**: below about 5% the bar rounded to a couple of pixels and read as an em dash. Bars now have a minimum visible width whenever fill is above zero.
- **Fee distribution no longer implies a spread that is not there**: when every percentile is equal the bars were drawn scaled, producing one full bar and four at the floor. That case is now drawn flat and labelled with the uniform rate.
- **Peer bandwidth split bars keep both directions visible**: a peer that has sent 3 MB and received 2.3 GB put the sent segment at 0.1%, rendering as one solid colour. Both segments now have a minimum width.
- **The bandwidth chart fills its panel**: its height was hardcoded to 110px, which left roughly 400px empty in the stretched two-column layout. It now grows with the panel above 768px, keeping the fixed height below that where panels are content-sized. Desktop geometry is unchanged, the 110px floor now living in CSS where it can reserve the space rather than in the draw call where it overflowed the container.
- **Chart tick labels stay legible over the data**: y-axis labels are drawn with a thin ground-coloured halo so the series line no longer cuts through the glyphs.
- **One corner radius**: the design mixed 1px, 2px and 3px across 53 declarations, a difference invisible at this scale. All now use a single `--radius` token.
- **Section labels share one treatment**: the node panel rendered them lowercase while every other panel used uppercase. All section labels are now uppercase at the same tracking, with `.sec` differing only by the divider rule it adds.

### Security
- **Electron 33 → 44, off end-of-life**: the packaged app shipped an unmaintained Chromium with known unpatched vulnerabilities. It now runs Electron 44.1.1 (Chromium 152). `electron-builder` moved 25.1.8 → 26.15.3 alongside it, which clears every outstanding advisory: `npm audit` goes from 14 vulnerabilities, one critical, to zero.
- Building this requires Node 22 or newer. Electron's installer now calls `require()` on an ES-module-only `@electron/get`, which Node 18 cannot do, so on Node 18 the install silently completes without ever downloading the Electron binary. Node 18 is itself end-of-life as of April 2025.
- Verified on Electron 44 against a live mainnet node: the preload bridge, sandbox isolation (`window.require` and `window.process` both undefined in the renderer), the terminal IPC round trip, and both IPC input guards all behave as they did on 33. `event.senderFrame` is now typed `WebFrameMain | null`, which the existing sender check handles correctly, since a null frame fails closed.

### Changed
- `package-lock.json` is now committed; install with `npm ci` for reproducible builds.
- Block headers' `nTx` is used for the transaction count when `getblockstats` is unavailable (IBD, pruned blocks); pruned blocks are flagged in block detail.
- Peers on onion/i2p/cjdns no longer show ban buttons (`setban` only accepts IP literals); disconnect uses the node id.
- Terminal scrollback is capped at 200 entries.

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
- **Contrast improved**: `--t3` raised from `#686868` to `#808080` and `--t4` from `#585858` to `#686868`. (Corrected in 2.2.4: this was described at the time as meeting WCAG AA, which it did not — `--t4` still measured 3.06:1 against `--raised`, where AA requires 4.5:1.)
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
