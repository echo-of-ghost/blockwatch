"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · shared.js
// Tooltips, tooltip engine, DOM helpers, utils/formatters
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLTIP SYSTEM — JSON-driven explanations for opaque KV labels
// ═══════════════════════════════════════════════════════════════════════════════
const TOOLTIPS = {
  // ── node › chain ───────────────────────────────────────────────────────────
  height: {
    body: "The number of blocks in the longest valid chain from genesis.",
    extra: "Increments by 1 roughly every 10 minutes on mainnet.",
  },
  headers: {
    body: "Block headers downloaded but not yet fully validated.",
    extra:
      "Should equal height once synced. A gap means blocks are still being fetched.",
  },
  sync: {
    body: "How far through initial block download your node is, as a percentage.",
    extra:
      "Reaches 100.0000% once headers and block validation are both current.",
  },
  "tip age": {
    body: "Time elapsed since your node last received a new block.",
    extra: "Values over ~20 min may indicate a stale chain or network issue.",
  },
  "median time": {
    body: "Median timestamp of the last 11 blocks (MTP — Median Time Past).",
    extra:
      "Used by consensus rules to validate transaction lock times. Always lags wall-clock time.",
  },
  "chain tips": {
    body: "Number of chain tips your node is tracking.",
    extra:
      '"1 active" is normal. Extra tips are orphaned branches that lost the longest-chain race.',
  },
  // ── node › mempool ─────────────────────────────────────────────────────────
  loaded: {
    body: "Whether the mempool has fully loaded from disk after startup.",
    extra:
      "Transactions are restored from mempool.dat. Briefly false immediately after startup.",
  },
  "txs · size": {
    body: "Unconfirmed transaction count · total virtual size of the mempool in vBytes.",
    extra:
      "vBytes apply the SegWit weight discount. Size drives the minimum-fee floor.",
  },
  usage: {
    body: "RAM the mempool is currently consuming.",
    extra:
      "Capped by maxmempool (default 300 MB). Oldest/cheapest transactions are evicted when full.",
  },
  "min fee · total": {
    body: "Lowest fee rate currently accepted · total fees sitting in the mempool.",
    extra:
      "Min fee rises automatically when the mempool is full, evicting cheap transactions.",
  },
  "relay · incr. fee": {
    body: "Minimum fee to relay a new transaction · minimum additional fee required for RBF.",
    extra:
      "Controlled by minrelaytxfee and incrementalrelayfee in bitcoin.conf.",
  },
  unbroadcast: {
    body: "Transactions submitted locally that no peer has relayed back yet.",
    extra:
      "Your node retries broadcasting them periodically. A non-zero count is normal briefly after submission.",
  },
  // ── node › network ─────────────────────────────────────────────────────────
  connections: {
    body: "Total peer connections open · breakdown into inbound and outbound.",
    extra:
      "Outbound connections are ones your node initiated. Inbound requires an open listen port.",
  },
  "relay fee": {
    body: "Minimum fee rate (sat/vB) your node requires before relaying a transaction to peers.",
    extra:
      "Transactions below this threshold are dropped silently at the network layer.",
  },
  // ── node › config ──────────────────────────────────────────────────────────
  "chain size": {
    body: "Disk space used by the block data directory · pruning mode.",
    extra:
      "Pruned nodes delete old blocks after validation to save space; full nodes keep everything.",
  },
  "prune height": {
    body: "Lowest block height still stored on disk after pruning.",
    extra:
      "Blocks below this height have been deleted and cannot be served to other peers.",
  },
  "full rbf": {
    body: "Whether your mempool accepts fee-bump replacements for any unconfirmed transaction.",
    extra:
      '"enabled" = mempoolfullrbf=1. Any tx can be replaced by a higher-fee version, not just opt-in ones.',
  },
  protocol: {
    body: "Bitcoin P2P protocol version number your node advertises.",
    extra:
      "Current mainline is 70016. Higher versions enable compact blocks, addr v2, and other features.",
  },
  rpc: {
    body: "The Bitcoin Core RPC endpoint blockwatch is polling for data.",
    extra:
      "Every metric on this dashboard originates from Bitcoin Core's JSON-RPC interface.",
  },
  // ── mining ─────────────────────────────────────────────────────────────────
  "diff · hashrate": {
    body: "Current mining difficulty · estimated total network hash rate.",
    extra:
      "Difficulty adjusts every 2016 blocks (~2 weeks) to keep average block time near 10 minutes.",
  },
  chainwork: {
    body: "Total cumulative proof-of-work across the entire chain, as a 256-bit hex value.",
    extra:
      "The definitive way to compare forks: the chain with higher chainwork is the valid one.",
  },
  "tx/s (2w) · total": {
    body: "Average confirmed transactions per second over the past 2 weeks · all-time tx count.",
    extra: "Sourced from the getchaintxstats RPC.",
  },
  // ── retarget ───────────────────────────────────────────────────────────────
  "block · left": {
    body: "Next retarget block height · blocks remaining until the difficulty adjustment fires.",
    extra:
      "Difficulty adjusts every 2016-block epoch based on actual vs target elapsed time.",
  },
  "est. date": {
    body: "Projected wall-clock date and time of the next difficulty retarget.",
    extra:
      "Estimate shifts in real-time as the average block interval changes.",
  },
  "adj · avg": {
    body: "Projected difficulty change percentage at retarget · average block interval this epoch.",
    extra:
      "Change is capped at ±4× per epoch. Negative = difficulty drops (easier); positive = rises (harder).",
  },
  // ── bandwidth ──────────────────────────────────────────────────────────────
  "sent · recv": {
    body: "Total bytes sent to peers · total bytes received from peers since node start.",
  },
  // ── block detail ───────────────────────────────────────────────────────────
  "age · txs": {
    body: "How long ago this block was mined · number of transactions it contains.",
  },
  "in · out": {
    body: "Total transaction inputs · total transaction outputs in this block.",
    extra:
      "Outputs typically exceed inputs because change outputs split coins.",
  },
  "size · fill": {
    body: "Block size in bytes · percentage of the 4 MWU block weight limit used.",
    extra: "Blocks above ~85% fill are considered near-capacity.",
  },
  "avg · total fee": {
    body: "Average fee rate across all transactions · total fees paid to the miner.",
    extra: "Total fees plus subsidy equals the full block reward.",
  },
  "fee pctiles": {
    body: "Fee rate distribution: 10th · 25th · 50th · 75th · 90th percentile (sat/vB).",
    extra:
      "The median (p50) is the most useful single figure for estimating inclusion cost.",
  },
  "subsidy · era": {
    body: "Block subsidy in BTC paid to the miner · halving era number.",
    extra:
      "Subsidy halves every 210,000 blocks. Era 1 started at genesis (50 BTC), era 4 is current (3.125 BTC).",
  },
  "fee share": {
    body: "Transaction fees as a percentage of the total block reward (subsidy + fees).",
    extra:
      "Rises over time as subsidy halves. When it reaches ~100%, fees alone sustain security.",
  },
  signalling: {
    body: "BIP-9 soft-fork activation bits set in this block's version field.",
    extra:
      'Miners signal readiness by setting specific bits. "none" = BIP-9 template, no active signals.',
  },
  "version · bits": {
    body: "Block version integer · nBits compact target encoding.",
    extra:
      "Version top 3 bits 001 = BIP-9 signalling template. nBits encodes the current difficulty target.",
  },
  nonce: {
    body: "The 32-bit number miners iterate to find a valid block hash.",
    extra:
      "When the nonce space is exhausted, miners change the extranonce in the coinbase transaction.",
  },
  hash: {
    body: "The block's SHA-256d hash — its unique identifier on the chain.",
    extra:
      "Must be numerically less than the current difficulty target for the block to be valid.",
  },
  // ── peer detail › conn tab ─────────────────────────────────────────────────
  "net · dir": {
    body: "Network type of this peer's address · connection direction (inbound or outbound).",
    extra: "Possible networks: ipv4, ipv6, onion, i2p, cjdns.",
  },
  type: {
    body: "Connection type negotiated with this peer.",
    extra:
      "outbound-full-relay = normal; block-relay-only = privacy-preserving, no tx/addr relay; feeler = short-lived probe.",
  },
  transport: {
    body: "Transport protocol in use for this connection.",
    extra: "v2 = BIP-324 encrypted P2P transport. v1 = legacy plaintext.",
  },
  "session id": {
    body: "Ephemeral session identifier for the BIP-324 encrypted connection.",
    extra:
      "Unique per connection. Used to verify you're talking to the same peer after reconnect.",
  },
  "relay txs": {
    body: "Whether this peer is willing to receive unconfirmed transaction announcements.",
    extra:
      '"no" is set by block-relay-only peers and some pruned/light clients.',
  },
  asn: {
    body: "Autonomous System Number of the IP range this peer belongs to.",
    extra:
      "Used to diversify outbound connections — Bitcoin Core avoids connecting too many peers from the same ASN.",
  },
  "addr local": {
    body: "Your node's local address as seen from this peer's perspective.",
    extra: "Useful to confirm your external IP is what you expect.",
  },
  "user agent": {
    body: "The Bitcoin software version string this peer sent during the version handshake.",
    extra:
      "Format is typically /Satoshi:x.y.z/. Unusual strings indicate alternative node implementations.",
  },
  whitelisted: {
    body: "Whether this peer has whitelisted status, bypassing some ban and rate-limit checks.",
    extra: "Set via the whitelist= option in bitcoin.conf.",
  },
  flags: {
    body: "Permission flags granted to this peer.",
    extra:
      "Examples: noban (never auto-ban), relay (relay even below fee floor), download (always sync blocks).",
  },
  // ── peer detail › sync tab ─────────────────────────────────────────────────
  blocks: {
    body: "Highest block this peer has confirmed it has synced.",
    extra:
      "Reported via the sendcmpct and getheaders handshake. May lag the actual tip slightly.",
  },
  "start height": {
    body: "The block height this peer reported when the connection was first opened.",
    extra:
      "Sent in the version message. Gives a rough idea of the peer's chain state at connect time.",
  },
  "hdr–blk gap": {
    body: "Difference between headers synced and blocks synced for this peer.",
    extra:
      "A large gap means the peer has headers but hasn't downloaded the full blocks yet.",
  },
  "hb to peer": {
    body: "Whether your node has designated this peer as a high-bandwidth compact-block relay target.",
    extra:
      "BIP-152: high-bandwidth mode pushes new block announcements immediately without a prior request.",
  },
  "hb from peer": {
    body: "Whether this peer has designated your node as a high-bandwidth compact-block source.",
    extra:
      "If yes, you will receive new block announcements from this peer without needing to request them.",
  },
  connected: {
    body: "How long this peer connection has been open.",
  },
  "last send": {
    body: "Time since your node last sent any P2P message to this peer.",
  },
  "last recv": {
    body: "Time since your node last received any P2P message from this peer.",
    extra:
      "Long gaps here combined with high ping may indicate a stalled connection.",
  },
  "time offset": {
    body: "Clock difference between your node and this peer, in seconds.",
    extra:
      "Bitcoin Core warns and may disconnect peers with offsets above 70s. Large offsets can cause consensus issues.",
  },
  "min ping": {
    body: "Best (lowest) round-trip ping time ever recorded for this peer.",
    extra:
      "A useful baseline; the current ping value fluctuates with network conditions.",
  },
  "ping wait": {
    body: "A ping message is currently in flight — this is the elapsed wait time.",
    extra:
      "Appears only when a pong has not yet been received. Suggests high latency or a stalled peer.",
  },
  ping: {
    body: "Round-trip latency to this peer in milliseconds.",
    extra:
      "Measured via the P2P ping/pong message. High latency can delay block propagation.",
  },
  // ── peer detail › bw tab ───────────────────────────────────────────────────
  "↑ sent": {
    body: "Total bytes sent to this peer since the connection opened.",
  },
  "↓ recv": {
    body: "Total bytes received from this peer since the connection opened.",
  },
  "fee filter": {
    body: "The minimum fee rate this peer has requested your node use when sending transaction announcements.",
    extra:
      "Set via the feefilter P2P message. Your node won't relay transactions below this rate to this peer.",
  },
  // ── peer detail › gossip tab ───────────────────────────────────────────────
  "addr processed": {
    body: "Number of addr/addrv2 peer-address announcements received and processed from this peer.",
    extra: "Your node uses these to discover new potential peers.",
  },
  "addr rate-lim": {
    body: "Number of addr/addrv2 announcements dropped due to rate limiting.",
    extra:
      "Non-zero values indicate this peer is sending addresses faster than the allowed rate.",
  },
  // ── softfork / deployment ──────────────────────────────────────────────────
  "fork-status": {
    body: "Current activation state of this soft fork.",
    extra:
      "Lifecycle: defined → started → locked_in → active (or failed). Active = enforced by your node.",
  },
  "fork-since": {
    body: "Block height at which this deployment entered its current state.",
  },
  threshold: {
    body: "Fraction of blocks in a signalling window required to lock in this soft fork.",
    extra: "Typically 90% (1815 of 2016 blocks) for BIP-9 deployments.",
  },
  window: {
    body: "The 2016-block measurement window used to count miner signalling.",
    extra:
      "Aligns with the difficulty retarget period. Signalling resets at the start of each window.",
  },
  elapsed: {
    body: "Number of blocks that have elapsed in the current signalling window.",
  },
  "signalling (window)": {
    body: "Percentage of blocks in the current window that are signalling for this deployment.",
    extra:
      "Must reach the threshold before the window closes for the fork to lock in.",
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLTIP ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
const tooltipEngine = (() => {
  let _el = null;
  let _hideTimer = null;
  let _touchAnchor = null; // track which anchor has an active touch tooltip

  function _getEl() {
    if (!_el) _el = document.getElementById("bw-tooltip");
    return _el;
  }

  // Derive a lookup key from an element: data-tip attribute takes priority,
  // then text content. Normalises all middot variants and collapses whitespace.
  function _keyOf(el) {
    if (el.dataset.tip) return el.dataset.tip.toLowerCase().trim();
    return (el.textContent || "")
      .toLowerCase()
      .trim()
      .replace(/[\u00b7\u2022\u2027\u22c5]/g, "\u00b7") // unify middot variants
      .replace(/\s+/g, " ");
  }

  function _show(anchor, key) {
    const tip = TOOLTIPS[key];
    if (!tip) return;
    const el = _getEl();
    if (!el) return;
    clearTimeout(_hideTimer);

    let html = `<span class="tip-label">${_esc(key)}</span><span class="tip-body">${_esc(tip.body)}</span>`;
    if (tip.extra) html += `<span class="tip-extra">${_esc(tip.extra)}</span>`;
    el.innerHTML = html;

    // Position offscreen first to measure true dimensions
    el.style.left = "-9999px";
    el.style.top = "-9999px";
    el.classList.add("tip-visible");
    el.classList.remove("tip-above");

    const ar = anchor.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 6;

    let top = ar.bottom + GAP;
    let above = false;
    if (top + th > vh - 8) {
      top = ar.top - th - GAP;
      above = true;
    }

    let left = ar.left;
    if (left + tw > vw - 8) left = vw - tw - 8;
    if (left < 8) left = 8;

    el.style.left = left + "px";
    el.style.top = top + "px";
    if (above) el.classList.add("tip-above");
  }

  function _hide(immediate) {
    const el = _getEl();
    if (!el) return;
    clearTimeout(_hideTimer);
    if (immediate) {
      el.classList.remove("tip-visible");
      return;
    }
    _hideTimer = setTimeout(() => el.classList.remove("tip-visible"), 80);
  }

  function _esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  function _wire(el) {
    if (el._tipWired) return; // #8 re-entrancy guard
    const key = _keyOf(el); // #7 normalised key derivation
    if (!TOOLTIPS[key]) return;

    el._tipWired = true;
    el.classList.add("k-tip-anchor");
    el.setAttribute("tabindex", "0");
    el.setAttribute("role", "note"); // #9 — not interactive, just informational
    el.setAttribute("aria-describedby", "bw-tooltip");

    // Mouse
    el.addEventListener("mouseenter", () => _show(el, key));
    el.addEventListener("mouseleave", () => _hide(false));

    // Keyboard focus
    el.addEventListener("focus", () => _show(el, key));
    el.addEventListener("blur", () => _hide(false));

    // #9 keyboard activation — Enter or Space triggers show on focused element
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        _show(el, key);
      }
      if (e.key === "Escape") _hide(true);
    });

    // #11 touch support
    el.addEventListener(
      "touchstart",
      (e) => {
        e.stopPropagation();
        if (_touchAnchor === el) {
          // Second tap on same anchor = dismiss
          _hide(true);
          _touchAnchor = null;
        } else {
          _touchAnchor = el;
          _show(el, key);
        }
      },
      { passive: true },
    );
  }

  function init() {
    document.querySelectorAll(".k").forEach(_wire);

    // #11 touch: tap anywhere else dismisses the tooltip
    document.addEventListener(
      "touchstart",
      (e) => {
        if (_touchAnchor && !_touchAnchor.contains(e.target)) {
          _hide(true);
          _touchAnchor = null;
        }
      },
      { passive: true },
    );

    // MutationObserver picks up .k elements injected by dynamic renders
    // (peer detail tabs, softfork rows, block detail panel, etc.)
    const obs = new MutationObserver((muts) => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList && node.classList.contains("k")) _wire(node);
          node.querySelectorAll && node.querySelectorAll(".k").forEach(_wire);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  return { init };
})();

const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);
const $q = (sel) => document.querySelector(sel);

function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}

function setClass(id, cls) {
  const el = $(id);
  if (el) el.className = cls;
}

function setDisplay(id, show) {
  const el = $(id);
  if (el) el.style.display = show ? "" : "none";
}

function setHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}

// ═══════════════════════════════════════════════════════════════════════════════
// UTILS — pure helpers, no DOM, no state
// ═══════════════════════════════════════════════════════════════════════════════
const utils = {
  f(n, d = 1) {
    return (+n || 0).toFixed(d);
  },
  fb(n) {
    return (+n || 0).toLocaleString("en-US");
  },

  esc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  },

  fmtBytes(b) {
    b = +b || 0;
    const neg = b < 0;
    const a = Math.abs(b);
    const s = neg ? "-" : "";
    if (a >= 1e12) return s + this.f(a / 1e12, 2) + " TB";
    if (a >= 1e9) return s + this.f(a / 1e9, 2) + " GB";
    if (a >= 1e6) return s + this.f(a / 1e6, 2) + " MB";
    if (a >= 1e3) return s + this.f(a / 1e3, 1) + " KB";
    return s + a + " B";
  },

  fmtRate(b) {
    b = +b || 0;
    if (b >= 1e6) return this.f(b / 1e6, 2) + " MB/s";
    if (b >= 1e3) return this.f(b / 1e3, 1) + " KB/s";
    return b.toFixed(0) + " B/s";
  },

  fmtAge(s) {
    s = Math.max(0, Math.floor(+s || 0));
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m " + Math.floor(s % 60) + "s";
    if (s < 86400)
      return Math.floor(s / 3600) + "h " + Math.floor((s % 3600) / 60) + "m";
    return Math.floor(s / 86400) + "d " + Math.floor((s % 86400) / 3600) + "h";
  },

  fmtAgeAgo(s) {
    return this.fmtAge(s) + " ago";
  },

  fmtUptime(s) {
    s = +s || 0;
    const d = Math.floor(s / 86400);
    const h = Math.floor((s % 86400) / 3600);
    const m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  },

  fmtDiff(d) {
    d = +d || 0;
    if (d >= 1e12) return this.f(d / 1e12, 3) + " T";
    if (d >= 1e9) return this.f(d / 1e9, 3) + " G";
    if (d >= 1e6) return this.f(d / 1e6, 2) + " M";
    return this.fb(d);
  },

  fmtHR(diff, medianBlockSecs) {
    const t = medianBlockSecs > 0 ? medianBlockSecs : 600;
    const hr = ((+diff || 0) * Math.pow(2, 32)) / t;
    if (hr >= 1e18) return this.f(hr / 1e18, 2) + " EH/s";
    if (hr >= 1e15) return this.f(hr / 1e15, 2) + " PH/s";
    if (hr >= 1e12) return this.f(hr / 1e12, 2) + " TH/s";
    return this.f(hr / 1e9, 2) + " GH/s";
  },

  fmtSats(sats) {
    sats = Math.round(+sats || 0);
    if (sats >= 1e5) return this.f(sats / 1e8, 4) + " BTC";
    return sats + " sat";
  },

  fmtTimestamp(t) {
    if (!t) return "—";
    return (
      new Date(t * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"
    );
  },

  fmtBanLeft(entry) {
    const left = entry.banned_until
      ? entry.banned_until - Date.now() / 1000
      : 0;
    if (left <= 0) return "expired";
    if (left > 315360000) return "∞ permanent";
    if (left < 3600) return Math.ceil(left / 60) + "m left";
    if (left < 86400) return Math.ceil(left / 3600) + "h left";
    return Math.ceil(left / 86400) + "d left";
  },

  peerNet(addr, network) {
    if (network) return network;
    if (!addr) return "unknown";
    if (addr.endsWith(".onion")) return "onion";
    if (addr.includes(".i2p")) return "i2p";
    if (addr.startsWith("[")) return "ipv6";
    if (addr.includes(":") && !addr.includes(".")) return "ipv6";
    return "ipv4";
  },

  decodeServices(h) {
    const n = parseInt(h || "0", 16);
    const flags = [];
    if (n & 0x1) flags.push("NETWORK");
    if (n & 0x2) flags.push("GETUTXO");
    if (n & 0x4) flags.push("BLOOM");
    if (n & 0x8) flags.push("WITNESS");
    if (n & 0x10) flags.push("XTHIN");
    if (n & 0x40) flags.push("COMPACT_FILTERS");
    if (n & 0x400) flags.push("NETWORK_LIMITED");
    if (n & 0x800) flags.push("P2P_V2");
    return flags.length ? flags : ["NONE"];
  },

  mspaceUrl(hash, chain) {
    const prefixes = { testnet4: "testnet4/", signet: "signet/" };
    const safeHash = /^[0-9a-fA-F]{64}$/.test(hash || "") ? hash : "";
    return (
      "https://mempool.space/" + (prefixes[chain] || "") + "block/" + safeHash
    );
  },

  copyToClipboard(text, el) {
    navigator.clipboard
      .writeText(text)
      .then(() => {
        if (el) {
          const prev = el.textContent;
          el.textContent = "copied";
          el.classList.add("copy-flash");
          setTimeout(() => {
            el.textContent = prev;
            el.classList.remove("copy-flash");
          }, 1200);
        }
      })
      .catch(() => {
        toastStack.add("copy failed — clipboard unavailable");
      });
  },
};

// Convenience aliases
const { f, fb, esc } = utils;

// AbortSignal.timeout polyfill (Safari < 16.4)
if (!AbortSignal.timeout) {
  AbortSignal.timeout = (ms) => {
    const c = new AbortController();
    setTimeout(
      () => c.abort(new DOMException("TimeoutError", "TimeoutError")),
      ms,
    );
    return c.signal;
  };
}
