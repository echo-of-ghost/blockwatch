(function () {
'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLTIP SYSTEM — JSON-driven explanations for opaque KV labels
// ═══════════════════════════════════════════════════════════════════════════════
const TOOLTIPS = {
  // ── node › chain ───────────────────────────────────────────────────────────
  'height': {
    body: 'The number of blocks in the longest valid chain from genesis.',
    extra: 'Increments by 1 roughly every 10 minutes on mainnet.'
  },
  'headers': {
    body: 'Block headers downloaded but not yet fully validated.',
    extra: 'Should equal height once synced. A gap means blocks are still being fetched.'
  },
  'sync': {
    body: 'How far through initial block download your node is, as a percentage.',
    extra: 'Reaches 100.0000% once headers and block validation are both current.'
  },
  'tip age': {
    body: 'Time elapsed since your node last received a new block.',
    extra: 'Values over ~20 min may indicate a stale chain or network issue.'
  },
  'median time': {
    body: 'Median timestamp of the last 11 blocks (MTP — Median Time Past).',
    extra: 'Used by consensus rules to validate transaction lock times. Always lags wall-clock time.'
  },
  'chain tips': {
    body: 'Number of chain tips your node is tracking.',
    extra: '"1 active" is normal. Extra tips are orphaned branches that lost the longest-chain race.'
  },
  // ── node › mempool ─────────────────────────────────────────────────────────
  'loaded': {
    body: 'Whether the mempool has fully loaded from disk after startup.',
    extra: 'Transactions are restored from mempool.dat. Briefly false immediately after startup.'
  },
  'txs · size': {
    body: 'Unconfirmed transaction count · total virtual size of the mempool in vBytes.',
    extra: 'vBytes apply the SegWit weight discount. Size drives the minimum-fee floor.'
  },
  'usage': {
    body: 'RAM the mempool is currently consuming.',
    extra: 'Capped by maxmempool (default 300 MB). Oldest/cheapest transactions are evicted when full.'
  },
  'min fee · total': {
    body: 'Lowest fee rate currently accepted · total fees sitting in the mempool.',
    extra: 'Min fee rises automatically when the mempool is full, evicting cheap transactions.'
  },
  'relay · incr. fee': {
    body: 'Minimum fee to relay a new transaction · minimum additional fee required for RBF.',
    extra: 'Controlled by minrelaytxfee and incrementalrelayfee in bitcoin.conf.'
  },
  'unbroadcast': {
    body: 'Transactions submitted locally that no peer has relayed back yet.',
    extra: 'Your node retries broadcasting them periodically. A non-zero count is normal briefly after submission.'
  },
  // ── node › network ─────────────────────────────────────────────────────────
  'connections': {
    body: 'Total peer connections open · breakdown into inbound and outbound.',
    extra: 'Outbound connections are ones your node initiated. Inbound requires an open listen port.'
  },
  'relay fee': {
    body: 'Minimum fee rate (sat/vB) your node requires before relaying a transaction to peers.',
    extra: 'Transactions below this threshold are dropped silently at the network layer.'
  },
  // ── node › config ──────────────────────────────────────────────────────────
  'chain size': {
    body: 'Disk space used by the block data directory · pruning mode.',
    extra: 'Pruned nodes delete old blocks after validation to save space; full nodes keep everything.'
  },
  'prune height': {
    body: 'Lowest block height still stored on disk after pruning.',
    extra: 'Blocks below this height have been deleted and cannot be served to other peers.'
  },
  'full rbf': {
    body: 'Whether your mempool accepts fee-bump replacements for any unconfirmed transaction.',
    extra: '"enabled" = mempoolfullrbf=1. Any tx can be replaced by a higher-fee version, not just opt-in ones.'
  },
  'protocol': {
    body: 'Bitcoin P2P protocol version number your node advertises.',
    extra: 'Current mainline is 70016. Higher versions enable compact blocks, addr v2, and other features.'
  },
  'rpc': {
    body: 'The Bitcoin Core RPC endpoint blockwatch is polling for data.',
    extra: 'Every metric on this dashboard originates from Bitcoin Core\'s JSON-RPC interface.'
  },
  // ── mining ─────────────────────────────────────────────────────────────────
  'diff · hashrate': {
    body: 'Current mining difficulty · estimated total network hash rate.',
    extra: 'Difficulty adjusts every 2016 blocks (~2 weeks) to keep average block time near 10 minutes.'
  },
  'chainwork': {
    body: 'Total cumulative proof-of-work across the entire chain, as a 256-bit hex value.',
    extra: 'The definitive way to compare forks: the chain with higher chainwork is the valid one.'
  },
  'tx/s (2w) · total': {
    body: 'Average confirmed transactions per second over the past 2 weeks · all-time tx count.',
    extra: 'Sourced from the getchaintxstats RPC.'
  },
  // ── retarget ───────────────────────────────────────────────────────────────
  'block · left': {
    body: 'Next retarget block height · blocks remaining until the difficulty adjustment fires.',
    extra: 'Difficulty adjusts every 2016-block epoch based on actual vs target elapsed time.'
  },
  'est. date': {
    body: 'Projected wall-clock date and time of the next difficulty retarget.',
    extra: 'Estimate shifts in real-time as the average block interval changes.'
  },
  'adj · avg': {
    body: 'Projected difficulty change percentage at retarget · average block interval this epoch.',
    extra: 'Change is capped at ±4× per epoch. Negative = difficulty drops (easier); positive = rises (harder).'
  },
  // ── bandwidth ──────────────────────────────────────────────────────────────
  'sent · recv': {
    body: 'Total bytes sent to peers · total bytes received from peers since node start.',
  },
  // ── block detail ───────────────────────────────────────────────────────────
  'age · txs': {
    body: 'How long ago this block was mined · number of transactions it contains.',
  },
  'in · out': {
    body: 'Total transaction inputs · total transaction outputs in this block.',
    extra: 'Outputs typically exceed inputs because change outputs split coins.'
  },
  'size · fill': {
    body: 'Block size in bytes · percentage of the 4 MWU block weight limit used.',
    extra: 'Blocks above ~85% fill are considered near-capacity.'
  },
  'avg · total fee': {
    body: 'Average fee rate across all transactions · total fees paid to the miner.',
    extra: 'Total fees plus subsidy equals the full block reward.'
  },
  'fee pctiles': {
    body: 'Fee rate distribution: 10th · 25th · 50th · 75th · 90th percentile (sat/vB).',
    extra: 'The median (p50) is the most useful single figure for estimating inclusion cost.'
  },
  'subsidy · era': {
    body: 'Block subsidy in BTC paid to the miner · halving era number.',
    extra: 'Subsidy halves every 210,000 blocks. Era 1 started at genesis (50 BTC), era 4 is current (3.125 BTC).'
  },
  'fee share': {
    body: 'Transaction fees as a percentage of the total block reward (subsidy + fees).',
    extra: 'Rises over time as subsidy halves. When it reaches ~100%, fees alone sustain security.'
  },
  'signalling': {
    body: 'BIP-9 soft-fork activation bits set in this block\'s version field.',
    extra: 'Miners signal readiness by setting specific bits. "none" = BIP-9 template, no active signals.'
  },
  'version · bits': {
    body: 'Block version integer · nBits compact target encoding.',
    extra: 'Version top 3 bits 001 = BIP-9 signalling template. nBits encodes the current difficulty target.'
  },
  'nonce': {
    body: 'The 32-bit number miners iterate to find a valid block hash.',
    extra: 'When the nonce space is exhausted, miners change the extranonce in the coinbase transaction.'
  },
  'hash': {
    body: 'The block\'s SHA-256d hash — its unique identifier on the chain.',
    extra: 'Must be numerically less than the current difficulty target for the block to be valid.'
  },
  // ── peer detail › conn tab ─────────────────────────────────────────────────
  'net · dir': {
    body: 'Network type of this peer\'s address · connection direction (inbound or outbound).',
    extra: 'Possible networks: ipv4, ipv6, onion, i2p, cjdns.'
  },
  'type': {
    body: 'Connection type negotiated with this peer.',
    extra: 'outbound-full-relay = normal; block-relay-only = privacy-preserving, no tx/addr relay; feeler = short-lived probe.'
  },
  'transport': {
    body: 'Transport protocol in use for this connection.',
    extra: 'v2 = BIP-324 encrypted P2P transport. v1 = legacy plaintext.'
  },
  'session id': {
    body: 'Ephemeral session identifier for the BIP-324 encrypted connection.',
    extra: 'Unique per connection. Used to verify you\'re talking to the same peer after reconnect.'
  },
  'relay txs': {
    body: 'Whether this peer is willing to receive unconfirmed transaction announcements.',
    extra: '"no" is set by block-relay-only peers and some pruned/light clients.'
  },
  'asn': {
    body: 'Autonomous System Number of the IP range this peer belongs to.',
    extra: 'Used to diversify outbound connections — Bitcoin Core avoids connecting too many peers from the same ASN.'
  },
  'addr local': {
    body: 'Your node\'s local address as seen from this peer\'s perspective.',
    extra: 'Useful to confirm your external IP is what you expect.'
  },
  'user agent': {
    body: 'The Bitcoin software version string this peer sent during the version handshake.',
    extra: 'Format is typically /Satoshi:x.y.z/. Unusual strings indicate alternative node implementations.'
  },
  'whitelisted': {
    body: 'Whether this peer has whitelisted status, bypassing some ban and rate-limit checks.',
    extra: 'Set via the whitelist= option in bitcoin.conf.'
  },
  'flags': {
    body: 'Permission flags granted to this peer.',
    extra: 'Examples: noban (never auto-ban), relay (relay even below fee floor), download (always sync blocks).'
  },
  // ── peer detail › sync tab ─────────────────────────────────────────────────
  'blocks': {
    body: 'Highest block this peer has confirmed it has synced.',
    extra: 'Reported via the sendcmpct and getheaders handshake. May lag the actual tip slightly.'
  },
  'start height': {
    body: 'The block height this peer reported when the connection was first opened.',
    extra: 'Sent in the version message. Gives a rough idea of the peer\'s chain state at connect time.'
  },
  'hdr–blk gap': {
    body: 'Difference between headers synced and blocks synced for this peer.',
    extra: 'A large gap means the peer has headers but hasn\'t downloaded the full blocks yet.'
  },
  'hb to peer': {
    body: 'Whether your node has designated this peer as a high-bandwidth compact-block relay target.',
    extra: 'BIP-152: high-bandwidth mode pushes new block announcements immediately without a prior request.'
  },
  'hb from peer': {
    body: 'Whether this peer has designated your node as a high-bandwidth compact-block source.',
    extra: 'If yes, you will receive new block announcements from this peer without needing to request them.'
  },
  'connected': {
    body: 'How long this peer connection has been open.',
  },
  'last send': {
    body: 'Time since your node last sent any P2P message to this peer.',
  },
  'last recv': {
    body: 'Time since your node last received any P2P message from this peer.',
    extra: 'Long gaps here combined with high ping may indicate a stalled connection.'
  },
  'time offset': {
    body: 'Clock difference between your node and this peer, in seconds.',
    extra: 'Bitcoin Core warns and may disconnect peers with offsets above 70s. Large offsets can cause consensus issues.'
  },
  'min ping': {
    body: 'Best (lowest) round-trip ping time ever recorded for this peer.',
    extra: 'A useful baseline; the current ping value fluctuates with network conditions.'
  },
  'ping wait': {
    body: 'A ping message is currently in flight — this is the elapsed wait time.',
    extra: 'Appears only when a pong has not yet been received. Suggests high latency or a stalled peer.'
  },
  'ping': {
    body: 'Round-trip latency to this peer in milliseconds.',
    extra: 'Measured via the P2P ping/pong message. High latency can delay block propagation.'
  },
  // ── peer detail › bw tab ───────────────────────────────────────────────────
  '↑ sent': {
    body: 'Total bytes sent to this peer since the connection opened.',
  },
  '↓ recv': {
    body: 'Total bytes received from this peer since the connection opened.',
  },
  'fee filter': {
    body: 'The minimum fee rate this peer has requested your node use when sending transaction announcements.',
    extra: 'Set via the feefilter P2P message. Your node won\'t relay transactions below this rate to this peer.'
  },
  // ── peer detail › gossip tab ───────────────────────────────────────────────
  'addr processed': {
    body: 'Number of addr/addrv2 peer-address announcements received and processed from this peer.',
    extra: 'Your node uses these to discover new potential peers.'
  },
  'addr rate-lim': {
    body: 'Number of addr/addrv2 announcements dropped due to rate limiting.',
    extra: 'Non-zero values indicate this peer is sending addresses faster than the allowed rate.'
  },
  // ── softfork / deployment ──────────────────────────────────────────────────
  'fork-status': {
    body: 'Current activation state of this soft fork.',
    extra: 'Lifecycle: defined → started → locked_in → active (or failed). Active = enforced by your node.'
  },
  'fork-since': {
    body: 'Block height at which this deployment entered its current state.',
  },
  'threshold': {
    body: 'Fraction of blocks in a signalling window required to lock in this soft fork.',
    extra: 'Typically 90% (1815 of 2016 blocks) for BIP-9 deployments.'
  },
  'window': {
    body: 'The 2016-block measurement window used to count miner signalling.',
    extra: 'Aligns with the difficulty retarget period. Signalling resets at the start of each window.'
  },
  'elapsed': {
    body: 'Number of blocks that have elapsed in the current signalling window.',
  },
  'signalling (window)': {
    body: 'Percentage of blocks in the current window that are signalling for this deployment.',
    extra: 'Must reach the threshold before the window closes for the fork to lock in.'
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOOLTIP ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
const tooltipEngine = (() => {
  let _el = null;
  let _hideTimer = null;
  let _touchAnchor = null;  // track which anchor has an active touch tooltip

  function _getEl() {
    if (!_el) _el = document.getElementById('bw-tooltip');
    return _el;
  }

  // Derive a lookup key from an element: data-tip attribute takes priority,
  // then text content. Normalises all middot variants and collapses whitespace.
  function _keyOf(el) {
    if (el.dataset.tip) return el.dataset.tip.toLowerCase().trim();
    return (el.textContent || '')
      .toLowerCase()
      .trim()
      .replace(/[\u00b7\u2022\u2027\u22c5]/g, '\u00b7') // unify middot variants
      .replace(/\s+/g, ' ');
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
    el.style.left = '-9999px';
    el.style.top  = '-9999px';
    el.classList.add('tip-visible');
    el.classList.remove('tip-above');

    const ar = anchor.getBoundingClientRect();
    const tw = el.offsetWidth;
    const th = el.offsetHeight;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const GAP = 6;

    let top = ar.bottom + GAP;
    let above = false;
    if (top + th > vh - 8) { top = ar.top - th - GAP; above = true; }

    let left = ar.left;
    if (left + tw > vw - 8) left = vw - tw - 8;
    if (left < 8) left = 8;

    el.style.left = left + 'px';
    el.style.top  = top + 'px';
    if (above) el.classList.add('tip-above');
  }

  function _hide(immediate) {
    const el = _getEl();
    if (!el) return;
    clearTimeout(_hideTimer);
    if (immediate) { el.classList.remove('tip-visible'); return; }
    _hideTimer = setTimeout(() => el.classList.remove('tip-visible'), 80);
  }

  function _esc(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _wire(el) {
    if (el._tipWired) return;  // #8 re-entrancy guard
    const key = _keyOf(el);    // #7 normalised key derivation
    if (!TOOLTIPS[key]) return;

    el._tipWired = true;
    el.classList.add('k-tip-anchor');
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'note');           // #9 — not interactive, just informational
    el.setAttribute('aria-describedby', 'bw-tooltip');

    // Mouse
    el.addEventListener('mouseenter', () => _show(el, key));
    el.addEventListener('mouseleave', () => _hide(false));

    // Keyboard focus
    el.addEventListener('focus', () => _show(el, key));
    el.addEventListener('blur',  () => _hide(false));

    // #9 keyboard activation — Enter or Space triggers show on focused element
    el.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); _show(el, key); }
      if (e.key === 'Escape') _hide(true);
    });

    // #11 touch support
    el.addEventListener('touchstart', e => {
      e.stopPropagation();
      if (_touchAnchor === el) {
        // Second tap on same anchor = dismiss
        _hide(true);
        _touchAnchor = null;
      } else {
        _touchAnchor = el;
        _show(el, key);
      }
    }, { passive: true });
  }

  function init() {
    document.querySelectorAll('.k').forEach(_wire);

    // #11 touch: tap anywhere else dismisses the tooltip
    document.addEventListener('touchstart', e => {
      if (_touchAnchor && !_touchAnchor.contains(e.target)) {
        _hide(true);
        _touchAnchor = null;
      }
    }, { passive: true });

    // MutationObserver picks up .k elements injected by dynamic renders
    // (peer detail tabs, softfork rows, block detail panel, etc.)
    const obs = new MutationObserver(muts => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.classList && node.classList.contains('k')) _wire(node);
          node.querySelectorAll && node.querySelectorAll('.k').forEach(_wire);
        }
      }
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  return { init };
})();


const $ = id => document.getElementById(id);
const $$ = sel => document.querySelectorAll(sel);
const $q = sel => document.querySelector(sel);

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
  if (el) el.style.display = show ? '' : 'none';
}

function setHTML(id, html) {
  const el = $(id);
  if (el) el.innerHTML = html;
}


// ═══════════════════════════════════════════════════════════════════════════════
// UTILS — pure helpers, no DOM, no state
// ═══════════════════════════════════════════════════════════════════════════════
const utils = {
  f(n, d = 1) { return (+n || 0).toFixed(d); },
  fb(n) { return (+n || 0).toLocaleString('en-US'); },

  esc(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  },

  fmtBytes(b) {
    b = +b || 0;
    const neg = b < 0;
    const a = Math.abs(b);
    const s = neg ? '-' : '';
    if (a >= 1e12) return s + this.f(a / 1e12, 2) + ' TB';
    if (a >= 1e9)  return s + this.f(a / 1e9, 2) + ' GB';
    if (a >= 1e6)  return s + this.f(a / 1e6, 2) + ' MB';
    if (a >= 1e3)  return s + this.f(a / 1e3, 1) + ' KB';
    return s + a + ' B';
  },

  fmtRate(b) {
    b = +b || 0;
    if (b >= 1e6) return this.f(b / 1e6, 2) + ' MB/s';
    if (b >= 1e3) return this.f(b / 1e3, 1) + ' KB/s';
    return b.toFixed(0) + ' B/s';
  },

  fmtAge(s) {
    s = Math.max(0, Math.floor(+s || 0));
    if (s < 60)    return s + 's';
    if (s < 3600)  return Math.floor(s / 60) + 'm ' + Math.floor(s % 60) + 's';
    if (s < 86400) return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm';
    return Math.floor(s / 86400) + 'd ' + Math.floor(s % 86400 / 3600) + 'h';
  },

  fmtAgeAgo(s) { return this.fmtAge(s) + ' ago'; },

  fmtUptime(s) {
    s = +s || 0;
    const d = Math.floor(s / 86400);
    const h = Math.floor(s % 86400 / 3600);
    const m = Math.floor(s % 3600 / 60);
    return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
  },

  fmtDiff(d) {
    d = +d || 0;
    if (d >= 1e12) return this.f(d / 1e12, 3) + ' T';
    if (d >= 1e9)  return this.f(d / 1e9, 3) + ' G';
    if (d >= 1e6)  return this.f(d / 1e6, 2) + ' M';
    return this.fb(d);
  },

  fmtHR(diff, medianBlockSecs) {
    const t = medianBlockSecs > 0 ? medianBlockSecs : 600;
    const hr = (+diff || 0) * Math.pow(2, 32) / t;
    if (hr >= 1e18) return this.f(hr / 1e18, 2) + ' EH/s';
    if (hr >= 1e15) return this.f(hr / 1e15, 2) + ' PH/s';
    if (hr >= 1e12) return this.f(hr / 1e12, 2) + ' TH/s';
    return this.f(hr / 1e9, 2) + ' GH/s';
  },

  fmtSats(sats) {
    sats = Math.round(+sats || 0);
    if (sats >= 1e5) return this.f(sats / 1e8, 4) + ' BTC';
    return sats + ' sat';
  },

  fmtTimestamp(t) {
    if (!t) return '—';
    return new Date(t * 1000).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  },

  fmtBanLeft(entry) {
    const left = entry.banned_until ? entry.banned_until - Date.now() / 1000 : 0;
    if (left <= 0)        return 'expired';
    if (left > 315360000) return '∞ permanent';
    if (left < 3600)      return Math.ceil(left / 60) + 'm left';
    if (left < 86400)     return Math.ceil(left / 3600) + 'h left';
    return Math.ceil(left / 86400) + 'd left';
  },

  peerNet(addr, network) {
    if (network) return network;
    if (!addr)   return 'unknown';
    if (addr.endsWith('.onion'))                  return 'onion';
    if (addr.includes('.i2p'))                    return 'i2p';
    if (addr.startsWith('['))                     return 'ipv6';
    if (addr.includes(':') && !addr.includes('.')) return 'ipv6';
    return 'ipv4';
  },

  decodeServices(h) {
    const n = parseInt(h || '0', 16);
    const flags = [];
    if (n & 0x1)   flags.push('NETWORK');
    if (n & 0x2)   flags.push('GETUTXO');
    if (n & 0x4)   flags.push('BLOOM');
    if (n & 0x8)   flags.push('WITNESS');
    if (n & 0x10)  flags.push('XTHIN');
    if (n & 0x40)  flags.push('COMPACT_FILTERS');
    if (n & 0x400) flags.push('NETWORK_LIMITED');
    if (n & 0x800) flags.push('P2P_V2');
    return flags.length ? flags : ['NONE'];
  },

  mspaceUrl(hash, chain) {
    const prefixes = { testnet4: 'testnet4/', signet: 'signet/' };
    const safeHash = /^[0-9a-fA-F]{64}$/.test(hash || '') ? hash : '';
    return 'https://mempool.space/' + (prefixes[chain] || '') + 'block/' + safeHash;
  },

  copyToClipboard(text, el) {
    navigator.clipboard.writeText(text).then(() => {
      if (el) {
        const prev = el.textContent;
        el.textContent = 'copied';
        el.classList.add('copy-flash');
        setTimeout(() => {
          el.textContent = prev;
          el.classList.remove('copy-flash');
        }, 1200);
      }
    }).catch(() => {});
  },
};

// Convenience aliases
const { f, fb, esc } = utils;

// AbortSignal.timeout polyfill (Safari < 16.4)
if (!AbortSignal.timeout) {
  AbortSignal.timeout = ms => {
    const c = new AbortController();
    setTimeout(() => c.abort(new DOMException('TimeoutError', 'TimeoutError')), ms);
    return c.signal;
  };
}


// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK MODULE — bandwidth history + rich canvas chart
// ═══════════════════════════════════════════════════════════════════════════════
const network = {
  _histSent: Array(60).fill(0),
  _histRecv: Array(60).fill(0),
  _hoverIdx: -1,         // index currently under cursor (-1 = none)
  _hoverRaf: null,       // pending rAF for hover redraw
  _canvas: null,         // cached canvas el
  _lastW: 0,
  _lastH: 0,

  // ── Layout constants ───────────────────────────────────────────────────────
  PAD_L: 52,   // left margin for Y-axis labels
  PAD_R: 10,
  PAD_T: 18,   // top margin for peak label
  PAD_B: 20,   // bottom margin for X-axis ticks
  CHART_H: 110,

  push(sentRate, recvRate) {
    this._histSent.push(sentRate);
    this._histRecv.push(recvRate);
    if (this._histSent.length > 60) this._histSent.shift();
    if (this._histRecv.length > 60) this._histRecv.shift();
  },

  render(netIn, netOut, totalRecv, totalSent) {
    setText('bw-up-v', utils.fmtRate(netOut || 0));
    setText('bw-dn-v', utils.fmtRate(netIn || 0));
    setText('bw-rv',   utils.fmtBytes(totalRecv || 0));
    setText('bw-sn',   utils.fmtBytes(totalSent || 0));
    this._drawChart();
  },

  // ── Main draw ──────────────────────────────────────────────────────────────
  _drawChart(hoverIdx) {
    const c = this._canvas || (this._canvas = $('spark'));
    if (!c) return;
    if (!c._bwHoverWired) this._initHover();

    const parent = c.parentElement;
    const cssW = Math.max(60, (parent?.getBoundingClientRect().width || 200) - 24);
    const cssH = this.CHART_H;

    // Only resize backing store if dimensions changed
    const dpr = window.devicePixelRatio || 1;
    if (cssW !== this._lastW || cssH !== this._lastH) {
      c.width  = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width  = cssW + 'px';
      c.style.height = cssH + 'px';
      this._lastW = cssW;
      this._lastH = cssH;
    }

    const ctx = c.getContext('2d');
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const { PAD_L, PAD_R, PAD_T, PAD_B } = this;
    const plotW = cssW - PAD_L - PAD_R;
    const plotH = cssH - PAD_T - PAD_B;

    const sent = this._histSent;
    const recv = this._histRecv;
    const N    = sent.length;
    const mx   = Math.max(...sent, ...recv, 1);

    const recvRgb = (getComputedStyle(document.documentElement)
      .getPropertyValue('--grn-rgb') || '90,170,106').trim();
    const sentRgb = (getComputedStyle(document.documentElement)
      .getPropertyValue('--pos-rgb') || '196,137,74').trim();

    // ── Y-axis grid + labels ──────────────────────────────────────────────
    const yTicks = this._niceYTicks(mx);
    ctx.font = '10px Geist Mono, monospace';
    ctx.textAlign = 'right';

    yTicks.forEach(tick => {
      const y = PAD_T + plotH - (tick / mx) * plotH;
      // grid line
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(cssW - PAD_R, y);
      ctx.stroke();
      ctx.setLineDash([]);
      // label
      ctx.fillStyle = 'rgba(104,104,104,0.9)';
      ctx.fillText(utils.fmtRate(tick), PAD_L - 4, y + 3);
    });

    // ── X-axis tick marks (every 10 samples = ~100s) ──────────────────────
    const xOf = i => PAD_L + (i / (N - 1)) * plotW;
    ctx.strokeStyle = 'rgba(255,255,255,0.04)';
    ctx.lineWidth = 1;
    for (let i = 0; i < N; i += 10) {
      const x = xOf(i);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T + plotH);
      ctx.lineTo(x, PAD_T + plotH + 3);
      ctx.stroke();
    }

    // X-axis labels: "–Ns ago" at a few anchor points
    ctx.font = '10px Geist Mono, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(64,64,64,0.9)';
    [{ i: 0, label: '10m' }, { i: Math.round(N * 0.5), label: '5m' }, { i: N - 1, label: 'now' }]
      .forEach(({ i, label }) => {
        ctx.fillText(label, xOf(i), cssH - 3);
      });

    // ── Area + line for each series ───────────────────────────────────────
    const drawSeries = (hist, rgb, alpha) => {
      const pts = hist.map((v, i) => ({
        x: xOf(i),
        y: PAD_T + plotH - (v / mx) * plotH,
      }));

      // Smooth area fill
      const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + plotH);
      grad.addColorStop(0,    `rgba(${rgb},${(alpha * 0.32).toFixed(2)})`);
      grad.addColorStop(0.55, `rgba(${rgb},${(alpha * 0.10).toFixed(2)})`);
      grad.addColorStop(1,    `rgba(${rgb},0)`);

      ctx.beginPath();
      ctx.moveTo(pts[0].x, PAD_T + plotH);
      pts.forEach(p => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[N - 1].x, PAD_T + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Smooth stroke using quadratic curves
      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx2 = (pts[i].x + pts[i + 1].x) / 2;
        const my  = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx2, my);
      }
      ctx.lineTo(pts[N - 1].x, pts[N - 1].y);
      ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      return pts;
    };

    const ptsRecv = drawSeries(recv, recvRgb, 0.90);
    const ptsSent = drawSeries(sent, sentRgb, 0.72);

    // ── Live-edge dots ────────────────────────────────────────────────────
    const drawDot = (pts, rgb, alpha) => {
      const p = pts[pts.length - 1];
      // outer glow ring
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${(alpha * 0.18).toFixed(2)})`;
      ctx.fill();
      // solid dot
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(2)})`;
      ctx.fill();
    };
    drawDot(ptsRecv, recvRgb, 0.95);
    drawDot(ptsSent, sentRgb, 0.80);

    // ── Hover crosshair ───────────────────────────────────────────────────
    const hi = hoverIdx !== undefined ? hoverIdx : this._hoverIdx;
    if (hi >= 0 && hi < N) {
      const hx = xOf(hi);

      // Vertical rule
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, PAD_T);
      ctx.lineTo(hx, PAD_T + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // Intersection dots
      [{ pts: ptsRecv, rgb: recvRgb }, { pts: ptsSent, rgb: sentRgb }].forEach(({ pts, rgb }) => {
        const p = pts[hi];
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},1)`;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb},0.35)`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      });

      // Tooltip bubble
      const recvV = recv[hi];
      const sentV = sent[hi];
      const secsAgo = (N - 1 - hi) * 10;
      const timeLabel = secsAgo === 0 ? 'now'
        : secsAgo < 60  ? secsAgo + 's ago'
        : Math.round(secsAgo / 60) + 'm ago';

      const line1 = `↓ ${utils.fmtRate(recvV)}  ↑ ${utils.fmtRate(sentV)}`;
      const line2 = timeLabel;

      ctx.font = '500 10px Geist Mono, monospace';
      const tw1 = ctx.measureText(line1).width;
      ctx.font = '10px Geist Mono, monospace';
      const tw2 = ctx.measureText(line2).width;
      const tw  = Math.max(tw1, tw2);
      const th  = 28;
      const tp  = 6;

      let tx = hx + 8;
      if (tx + tw + tp * 2 > cssW - PAD_R) tx = hx - tw - tp * 2 - 8;
      const ty = PAD_T + 4;

      // Bubble background
      ctx.fillStyle = 'rgba(21,21,21,0.92)';
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 0.5;
      this._roundRect(ctx, tx, ty, tw + tp * 2, th, 3);
      ctx.fill();
      ctx.stroke();

      // Bubble text
      ctx.font = '500 10px Geist Mono, monospace';
      ctx.fillStyle = `rgba(${recvRgb},0.95)`;
      ctx.textAlign = 'left';
      ctx.fillText(line1, tx + tp, ty + 11);
      ctx.font = '10px Geist Mono, monospace';
      ctx.fillStyle = 'rgba(104,104,104,0.9)';
      ctx.fillText(line2, tx + tp, ty + 23);
    }

    ctx.restore();
  },

  // ── Hover wiring ──────────────────────────────────────────────────────────
  _initHover() {
    const c = this._canvas || (this._canvas = $('spark'));
    if (!c || c._bwHoverWired) return;
    c._bwHoverWired = true;

    const { PAD_L, PAD_R, PAD_T, PAD_B, CHART_H } = this;

    const idxAt = clientX => {
      const rect = c.getBoundingClientRect();
      const relX = clientX - rect.left - PAD_L;
      const plotW = rect.width - PAD_L - PAD_R;
      const N = this._histSent.length;
      return Math.max(0, Math.min(N - 1, Math.round((relX / plotW) * (N - 1))));
    };

    c.addEventListener('mousemove', e => {
      this._hoverIdx = idxAt(e.clientX);
      if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = requestAnimationFrame(() => { this._hoverRaf = null; this._drawChart(); });
    });

    c.addEventListener('mouseleave', () => {
      this._hoverIdx = -1;
      if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = requestAnimationFrame(() => { this._hoverRaf = null; this._drawChart(); });
    });
  },

  // ── Helpers ───────────────────────────────────────────────────────────────
  _niceYTicks(max) {
    // Produce 3-4 nicely rounded Y-axis tick values
    if (max <= 0) return [0];
    const raw  = max / 3;
    const mag  = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice = [1, 2, 5, 10].map(m => m * mag).find(m => m >= raw) || mag * 10;
    const ticks = [];
    for (let v = nice; v <= max * 1.05; v += nice) ticks.push(v);
    return ticks.slice(0, 4);
  },

  _roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
  },

  // Public alias kept for ResizeObserver calls
  _drawSpark() { this._drawChart(); },
};


// ═══════════════════════════════════════════════════════════════════════════════
// NODE MODULE — node panel, titlebar, mempool, retarget, sync, services
// ═══════════════════════════════════════════════════════════════════════════════
const nodePanel = {
  _currentChain: 'main',
  _retargetHistory: [],
  _syncHistory: [],
  _localAddrsRevealed: false,
  _lastLocalAddrs: [],
  _avgBlockSecs: 600,
  _epochTooltipWired: false,
  _retargetState: { blocksLeft: 0, pctChange: 0 },

  get currentChain() { return this._currentChain; },

  render(d) {
    const bc  = d.blockchain || {};
    const ni  = d.networkInfo || {};
    const mi  = d.mempoolInfo || {};
    const cts = d.chainTxStats || {};
    const blocks = d.blocks || [];
    const now = Date.now() / 1000;

    this._renderTitlebar(bc, ni, d.uptime, blocks, d);
    this._renderNodeInfo(bc, ni, d.rpcNode, blocks, now);
    this._renderChainTips(d.chainTips || []);
    this._renderRetarget(bc.blocks || 0, bc.mediantime || 0, cts);
    this._renderConsensus(bc, cts);
    this._renderMempool(mi, d);
    this._renderStorage(bc);
    this._renderNetworkReachability(ni);
    this._renderServices(ni);
    this._renderLocalAddrs(ni.localaddresses || []);

    if (bc.initialblockdownload) {
      this._updateSync(bc.verificationprogress || 0);
    }
  },

  _renderTitlebar(bc, ni, uptime, blocks, d = {}) {
    const synced = (bc.verificationprogress || 0) >= 0.9995;

    setText('tb-ver', (ni.subversion || '').replace(/^\/|\/$/g, ''));
    setText('tb-height', '#' + fb(bc.blocks || 0));

    const syncEl = $('tb-sync');
    if (syncEl) {
      syncEl.textContent = synced ? 'Synced' : 'Syncing';
      syncEl.className = 'tb-sync-badge ' + (synced ? 'synced' : 'syncing');
      syncEl.style.display = '';
    }

    this._currentChain = bc.chain || 'main';
    chainTheme.apply(bc.chain || 'main', bc.blocks || 0);

    setClass('live-dot', 'dot ok');

    const warnEl = $('node-warnings');
    if (warnEl) {
      const chainWarns = Array.isArray(bc.warnings)
        ? bc.warnings.join(' ')
        : ((bc.warnings || '').trim());
      const netWarns = (d.networkWarnings || '').trim();
      const warns = [chainWarns, netWarns].filter(Boolean).join(' · ');
      warnEl.textContent = warns ? '⚠ ' + warns : '';
      warnEl.style.display = warns ? 'block' : 'none';
    }

    const tbUptime = $('tb-uptime');
    const tbUptimeSep = $('tb-uptime-sep');
    if (tbUptime) {
      if (uptime) {
        tbUptime.textContent = 'up ' + utils.fmtUptime(uptime);
        tbUptime.style.display = '';
        if (tbUptimeSep) tbUptimeSep.style.display = '';
      } else {
        tbUptime.style.display = 'none';
        if (tbUptimeSep) tbUptimeSep.style.display = 'none';
      }
    }

    mobileBar.updateChain(bc.blocks || 0, synced, ni.subversion || '', uptime || 0);
  },

  _renderNodeInfo(bc, ni, rpcNode, blocks, now) {
    const synced = (bc.verificationprogress || 0) >= 0.9995;
    const pct = (bc.verificationprogress || 0) * 100;
    const chainNames = { main: 'mainnet', testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' };
    const tipTime = blocks.length ? blocks[0].time : 0;

    setText('ni-net', chainNames[bc.chain] || bc.chain || '—');
    setText('ni-hd', fb(bc.headers || 0));

    const hdRow = $('ni-hd-row');
    if (hdRow) hdRow.style.display = (bc.headers && bc.headers !== bc.blocks) ? '' : 'none';

    setText('ni-sync', synced ? '100%' : pct.toFixed(2) + '%');
    setText('ni-ta', tipTime ? utils.fmtAgeAgo(now - tipTime) : '—');
    setText('ni-mt', bc.mediantime ? utils.fmtTimestamp(bc.mediantime) : '—');

    // tip age status dot
    const ageSecs = tipTime ? (now - tipTime) : null;
    const dot = $('ni-tipage-dot');
    if (dot) {
      const cls = ageSecs === null  ? 'tipage-dot-unknown'
        : ageSecs < 1200            ? 'tipage-dot-ok'
        : ageSecs < 3600            ? 'tipage-dot-warn'
        :                             'tipage-dot-err';
      dot.className = 'ni-tipage-dot ' + cls;
    }

    setText('ni-sync-status', bc.initialblockdownload ? 'active' : 'complete');
    setText('ni-pv', ni.protocolversion != null ? String(ni.protocolversion) : '—');
    setText('ni-conn', ni.connections != null
      ? (ni.connections + (ni.maxconnections ? (' / ' + ni.maxconnections) : ''))
      : '—');

    const splitEl = $('ni-conn-split');
    if (splitEl) {
      const cin = ni.connections_in;
      const cout = ni.connections_out;
      splitEl.textContent = (cin != null && cout != null)
        ? (cin + '↓ ' + cout + '↑')
        : '—';
    }

    setText('ni-rf', ni.relayfee != null ? f(ni.relayfee * 1e5, 2) + ' sat/vB' : '—');
    setText('ni-rpc', rpcNode || '—');

    setDisplay('sync-section', bc.initialblockdownload);
  },

  _renderChainTips(tips) {
    const tipsEl = $('ni-tips');
    if (!tipsEl) return;

    if (!tips.length) {
      tipsEl.textContent = '—';
      tipsEl.className = 'v dim';
      const tipListEl = $('ni-tips-list');
      if (tipListEl) tipListEl.innerHTML = '';
      return;
    }

    const active    = tips.filter(t => t.status === 'active').length;
    const deepForks = tips.filter(t => t.status === 'valid-fork' && t.branchlen > 1);
    const orphans   = tips.filter(t => t.status === 'valid-fork' && t.branchlen === 1);
    const validHdr  = tips.filter(t => t.status === 'valid-headers');
    const invalid   = tips.filter(t => t.status === 'invalid');

    if (deepForks.length) {
      tipsEl.textContent = deepForks.length + ' fork' + (deepForks.length > 1 ? 's' : '');
      tipsEl.className = 'v neg';
    } else if (invalid.length) {
      tipsEl.textContent = invalid.length + ' invalid';
      tipsEl.className = 'v neg';
    } else if (validHdr.length) {
      tipsEl.textContent = validHdr.length + ' valid-headers';
      tipsEl.className = 'v o';
    } else if (orphans.length) {
      tipsEl.textContent = orphans.length + ' orphan' + (orphans.length > 1 ? 's' : '');
      tipsEl.className = 'v dim';
    } else {
      tipsEl.textContent = active + ' active';
      tipsEl.className = 'v dim';
    }

    const nonActive = [...deepForks, ...invalid, ...validHdr, ...orphans];
    let tipListEl = $('ni-tips-list');
    if (!tipListEl) {
      tipListEl = document.createElement('div');
      tipListEl.id = 'ni-tips-list';
      const parent = tipsEl.closest('.kv');
      if (parent) parent.after(tipListEl);
    }

    if (!nonActive.length) {
      tipListEl.innerHTML = '';
      return;
    }

    const MAX_TIPS = 4;
    const visible  = nonActive.slice(0, MAX_TIPS);
    const overflow = nonActive.length - visible.length;

    const badgeCls = t =>
        t.status === 'invalid'                          ? 'failed'
      : (t.status === 'valid-fork' && t.branchlen > 1) ? 'failed'
      : t.status === 'valid-headers'                    ? 'locked'
      : 'defined';

    tipListEl.innerHTML = `<div class="tip-list">`
      + visible.map(t => {
          const hash = t.hash || '';
          const hashDisplay = hash
            ? `<span class="tip-hash-pfx">${hash.slice(0,4)}${hash.slice(4,8)}…</span><em>${hash.slice(-4)}</em>`
            : '—';
          const copySpan = hash
            ? `<span data-copy="${esc(hash)}" class="copy-icon">⎘</span>`
            : '';
          const branchStr = t.branchlen > 0
            ? `<span class="tip-branch-badge">${t.branchlen}blk</span>`
            : '';
          return `<div class="tip-card">
            <div class="tip-card-top">
              <span class="tip-card-height">#${fb(t.height || 0)}</span>
              <span class="fork-badge ${badgeCls(t)}">${esc(t.status || '')}</span>
              ${branchStr}
            </div>
            <div class="tip-card-hash">${hashDisplay}${copySpan}</div>
          </div>`;
        }).join('')
      + (overflow > 0 ? `<div class="tip-overflow">+${overflow} more</div>` : '')
      + `</div>`;
  },

  _renderConsensus(bc, cts) {
    const diffVal = bc.difficulty || 0;
    setText('mn-df', utils.fmtDiff(diffVal));
    setText('mn-hr', utils.fmtHR(diffVal, this._avgBlockSecs));
    setText('mn-ph', utils.fmtHR(diffVal, this._avgBlockSecs));

    const cw = bc.chainwork || '';
    setText('mn-cw', cw ? '…' + cw.slice(-12) : '—');

    const cwCopy = $('mn-cw-copy');
    if (cwCopy) {
      cwCopy.dataset.copy = cw;
      cwCopy.style.display = cw ? '' : 'none';
    }

    setText('mn-tps', cts.txrate ? f(cts.txrate, 2) + ' tx/s' : '—');
    setText('mn-ttx', cts.txcount ? fb(cts.txcount) : '—');
  },

  _renderRetarget(height, mediantime, cts) {
    const INTERVAL = 2016;
    const TARGET = 600;
    const posInPeriod = height % INTERVAL;
    const nextRetarget = height + (INTERVAL - posInPeriod);
    const blocksLeft = nextRetarget - height;

    setText('mn-rt-blk', fb(nextRetarget));
    setText('mn-rt-left', fb(blocksLeft) + ' blocks');

    // epoch progress bar
    const epochPct = ((posInPeriod / INTERVAL) * 100).toFixed(2);
    const epochFill = $('mn-epoch-fill');
    if (epochFill) epochFill.style.width = epochPct + '%';
    const epochPctEl = $('mn-epoch-pct');
    if (epochPctEl) epochPctEl.textContent = epochPct + '%';

    // store for tooltip access — updated each render pass
    this._retargetState.blocksLeft = blocksLeft;

    if (mediantime && height) {
      const periodStart = height - posInPeriod;
      if (this._retargetHistory.length
          && (this._retargetHistory[0].height < periodStart || posInPeriod === 0)) {
        this._retargetHistory = [];
      }
      const last = this._retargetHistory[this._retargetHistory.length - 1];
      if (!last || last.height !== height) {
        this._retargetHistory.push({ height, time: mediantime });
        if (this._retargetHistory.length > 120) this._retargetHistory.shift();
      }
    }

    // Prefer chainTxStats for accurate avg block time
    let avgSec = TARGET;
    if (cts && cts.window_interval > 0 && cts.window_block_count > 0) {
      avgSec = cts.window_interval / cts.window_block_count;
    } else if (this._retargetHistory.length >= 2) {
      const newest = this._retargetHistory[this._retargetHistory.length - 1];
      const oldest = this._retargetHistory[0];
      const dh = newest.height - oldest.height;
      const dt = newest.time - oldest.time;
      if (dh > 0 && dt > 0) avgSec = dt / dh;
    }
    this._avgBlockSecs = avgSec;

    const estSecs = blocksLeft * avgSec;
    const estDate = new Date(Date.now() + estSecs * 1000);
    setText('mn-rt-date',
      estDate.toISOString().slice(0, 10) + ' ~'
      + estDate.toISOString().slice(11, 16) + ' UTC');

    const pctChange = ((TARGET / avgSec) - 1) * 100;
    this._retargetState.pctChange = pctChange;
    const chgEl = $('mn-rt-chg');
    if (chgEl) {
      const sign = pctChange >= 0 ? '+' : '';
      const arrow = pctChange > 1 ? ' ↑' : pctChange < -1 ? ' ↓' : '';
      chgEl.textContent = sign + pctChange.toFixed(2) + '%' + arrow;
      chgEl.className = 'v ' + (pctChange > 1 ? 'o' : pctChange < -1 ? 'grn' : 'dim');
    }

    setText('mn-rt-avg', (avgSec / 60).toFixed(2) + ' min/block');

    // Wire a live tooltip on the epoch track bar (once, after the element exists)
    if (!this._epochTooltipWired) {
      const track = $('mn-epoch-track');
      if (track) {
        this._epochTooltipWired = true;
        const tipEl = document.getElementById('bw-tooltip');
        const self = this;

        function _showEpochTip(anchor) {
          if (!tipEl) return;
          const { blocksLeft, pctChange: pc } = self._retargetState;
          const sign = pc >= 0 ? '+' : '';
          const adjStr = sign + pc.toFixed(2) + '%';
          const adjClass = pc > 1 ? 'color:var(--orange)' : pc < -1 ? 'color:var(--grn)' : 'color:var(--t3)';
          tipEl.innerHTML =
            '<span class="tip-label">epoch progress</span>' +
            '<span class="tip-body">' + blocksLeft.toLocaleString() + ' blocks until retarget' +
            ' &middot; est. <span style="' + adjClass + ';font-weight:600">' + adjStr + '</span> adjustment</span>' +
            '<span class="tip-extra">Difficulty adjusts every 2016 blocks. Change is capped at \xB14\xD7 per epoch.</span>';

          tipEl.style.left = '-9999px';
          tipEl.style.top  = '-9999px';
          tipEl.classList.add('tip-visible');
          tipEl.classList.remove('tip-above');

          const ar = anchor.getBoundingClientRect();
          const tw = tipEl.offsetWidth;
          const th = tipEl.offsetHeight;
          const vw = window.innerWidth;
          const vh = window.innerHeight;
          const GAP = 6;
          let top = ar.bottom + GAP;
          let above = false;
          if (top + th > vh - 8) { top = ar.top - th - GAP; above = true; }
          let left = ar.left;
          if (left + tw > vw - 8) left = vw - tw - 8;
          if (left < 8) left = 8;
          tipEl.style.left = left + 'px';
          tipEl.style.top  = top  + 'px';
          if (above) tipEl.classList.add('tip-above');
        }

        function _hideEpochTip() {
          if (tipEl) tipEl.classList.remove('tip-visible');
        }

        track.setAttribute('aria-describedby', 'bw-tooltip');
        track.addEventListener('mouseenter', () => _showEpochTip(track));
        track.addEventListener('mouseleave', _hideEpochTip);
        track.addEventListener('focus',      () => _showEpochTip(track));
        track.addEventListener('blur',       _hideEpochTip);
      }
    }
  },

  _renderMempool(mi, d = {}) {
    const mpFee = mi.mempoolminfee || 0;
    const uPct = mi.usage && mi.maxmempool ? mi.usage / mi.maxmempool * 100 : 0;

    const mpLoaded = $('mp-loaded');
    const mpLoadingRow = $('mp-loading-row');
    if (mpLoaded) {
      if (mi.loaded === false) {
        mpLoaded.innerHTML = '<span class="fork-badge defined">loading…</span>';
        mpLoaded.className = 'v';
        if (mpLoadingRow) mpLoadingRow.style.display = '';
      } else {
        if (mpLoadingRow) mpLoadingRow.style.display = 'none';
      }
    }

    setText('mp-txs', fb(mi.size || 0));
    setText('mp-sz', utils.fmtBytes(mi.bytes || 0));
    setText('mp-us', utils.fmtBytes(mi.usage || 0) + ' (' + f(uPct, 1) + '%)');
    const mpFill = $('mp-usage-fill');
    if (mpFill) {
      mpFill.style.width = Math.min(uPct, 100).toFixed(1) + '%';
      mpFill.className = 'mfill ' + (uPct > 80 ? 'hi' : uPct > 50 ? 'o' : 'o2');
    }
    setText('mp-mf', mpFee ? f(mpFee * 1e5, 2) + ' sat/vB' : '—');
    setText('mp-tf', mi.total_fee ? utils.fmtSats(Math.round(mi.total_fee * 1e8)) : '—');

    const rfEl = $('mp-rf');
    const incrEl = $('mp-incrf');
    if (rfEl) rfEl.textContent = d.minrelaytxfee != null ? f(d.minrelaytxfee * 1e5, 2) + ' sat/vB' : '—';
    if (incrEl) incrEl.textContent = d.incrementalfee != null ? f(d.incrementalfee * 1e5, 2) + ' sat/vB' : '—';

    const unconfEl = $('mp-unconf');
    if (unconfEl) {
      const ub = mi.unbroadcastcount ?? 0;
      unconfEl.textContent = ub > 0 ? ub + ' unbroadcast' : 'none';
      unconfEl.className = 'v ' + (ub > 0 ? 'o' : 'dim');
    }

    const mpRbfEl = $('mp-fullrbf');
    if (mpRbfEl) {
      mpRbfEl.innerHTML = mi.fullrbf === true
        ? '<span class="fork-badge active">enabled</span>'
        : mi.fullrbf === false
          ? '<span class="fork-badge defined">disabled</span>'
          : '—';
    }
  },

  _renderStorage(bc) {
    setText('ni-sz', bc.size_on_disk ? utils.fmtBytes(bc.size_on_disk) : '—');
    setText('ni-pr', bc.pruned ? 'yes' : 'no');

    const pruneRow = $('ni-pruneheight-row');
    if (pruneRow) pruneRow.style.display = bc.pruned ? '' : 'none';
    if (bc.pruned && bc.pruneheight != null) setText('ni-pruneheight', '#' + fb(bc.pruneheight));
  },

  _renderNetworkReachability(ni) {
    const el = $('ni-reachability');
    if (!el) return;

    const nets = ni.networks || [];
    if (!nets.length) {
      el.innerHTML = '<span class="ni-placeholder">—</span>';
      return;
    }

    const ORDER = ['ipv4', 'ipv6', 'onion', 'i2p', 'cjdns'];
    const sorted = [...nets].sort((a, b) => {
      const ai = ORDER.indexOf(a.name);
      const bi = ORDER.indexOf(b.name);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    const pills = sorted.map(n => {
      const reachable = n.reachable === true;
      const limited   = n.limited === true && !reachable;
      const cls = reachable ? 'reach-pill reach-pill-on'
                : limited   ? 'reach-pill reach-pill-lim'
                :             'reach-pill reach-pill-off';
      const proxyTip = n.proxy ? ` title="${esc(n.proxy)}"` : '';
      return `<span class="${cls}"${proxyTip}>${esc(n.name)}</span>`;
    }).join('');

    el.innerHTML = `<div class="reach-pills">${pills}</div>`;
  },

  _renderServices(ni) {
    const svcs = ni.localservicesnames || [];
    setText('svc-ph', svcs.length ? svcs.length + ' active' : '—');

    const grid = $('svc-grid');
    if (grid) {
      grid.innerHTML = '<div class="pd-svc">' + svcs.map(s => {
        const cls = ['NETWORK', 'WITNESS'].includes(s) ? 'svc-core'
          : ['BLOOM', 'COMPACT_FILTERS', 'P2P_V2'].includes(s) ? 'svc-cap'
          : 'svc-ltd';
        return `<span class="${cls}">${esc(s)}</span>`;
      }).join('') + '</div>';
    }
  },

  _renderLocalAddrs(localAddresses) {
    this._lastLocalAddrs = localAddresses || [];
    const el = $('ni-localaddrs');
    if (!el) return;

    if (!this._lastLocalAddrs.length) {
      el.innerHTML = '<span class="ni-placeholder">not reachable / no external address</span>';
      return;
    }

    const MASK = '•••••••••••••••••••';
    el.innerHTML = this._lastLocalAddrs.map(a => {
      const addr = esc(a.address || '');
      const score = a.score != null ? a.score : '';
      const type = addr.endsWith('.onion') ? 'onion'
        : (addr.startsWith('[') || (addr.includes(':') && !addr.includes('.'))) ? 'ipv6'
        : 'ipv4';
      const typeClass = type === 'onion' ? 'la-type-onion'
        : type === 'ipv6' ? 'la-type-ipv6'
        : 'la-type-ipv4';
      const display = this._localAddrsRevealed ? addr : MASK;
      const cls = this._localAddrsRevealed ? 'la-addr' : 'la-addr masked';

      return `<div class="la-row">
        <span class="${cls}">${display}</span>
        <span class="la-type ${typeClass}">${type}</span>
        ${score !== '' ? `<span class="la-score">s:${score}</span>` : ''}
      </div>`;
    }).join('');
  },

  toggleLocalAddrs() {
    this._localAddrsRevealed = !this._localAddrsRevealed;
    const btn = $('la-reveal-btn');
    if (btn) btn.textContent = this._localAddrsRevealed ? 'hide' : 'reveal';
    this._renderLocalAddrs(this._lastLocalAddrs);
  },

  _updateSync(progress) {
    const now = Date.now();
    this._syncHistory.push({ progress, ts: now });
    if (this._syncHistory.length > 20) this._syncHistory.shift();

    const fill = $('sync-fill');
    const pct = progress * 100;
    if (fill) fill.style.width = pct.toFixed(2) + '%';

    if (this._syncHistory.length < 3) {
      setText('sync-eta', pct.toFixed(3) + '%');
      return;
    }

    const newest = this._syncHistory[this._syncHistory.length - 1];
    const oldest = this._syncHistory[0];
    const dp = newest.progress - oldest.progress;
    const dt = newest.ts - oldest.ts;

    if (dp <= 0 || dt <= 0) {
      setText('sync-eta', pct.toFixed(3) + '%');
      return;
    }

    const sLeft = (1 - progress) / (dp / dt) / 1000;
    let eta;
    if (sLeft < 60)         eta = Math.round(sLeft) + 's';
    else if (sLeft < 3600)  eta = Math.round(sLeft / 60) + 'm ' + Math.round(sLeft % 60) + 's';
    else if (sLeft < 86400) eta = Math.round(sLeft / 3600) + 'h ' + Math.round((sLeft % 3600) / 60) + 'm';
    else                    eta = Math.round(sLeft / 86400) + 'd ' + Math.round((sLeft % 86400) / 3600) + 'h';

    setText('sync-eta', pct.toFixed(3) + '%  · est. ' + eta);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN MODULE — fee estimates panel
// ═══════════════════════════════════════════════════════════════════════════════
const chainPanel = {
  render(d) {
    const blocks = d.blocks || [];
    const now = Date.now() / 1000;
    setText('ch-tip-age', blocks.length && blocks[0].time
      ? utils.fmtAgeAgo(now - blocks[0].time) : '—');
    this._renderFees(d.fees || {});
  },

  _renderFees(fees) {
    const t = n => n != null ? 'target ' + n + ' blk' : '';
    const feeList = [
      fees.fast != null ? { label: 'next block', rate: fees.fast, time: t(fees.fast_target) } : null,
      fees.med  != null ? { label: '6 blocks',   rate: fees.med,  time: t(fees.med_target) }  : null,
      fees.slow != null ? { label: '1 day',      rate: fees.slow, time: t(fees.slow_target) } : null,
      fees.eco  != null ? { label: 'economy',    rate: fees.eco,  time: t(fees.eco_target) }  : null,
    ].filter(Boolean);

    const el = $('fee-rows');
    if (!el) return;

    if (!feeList.length) {
      el.innerHTML = '<div class="fee-empty">no fee data — estimator warming up</div>';
      return;
    }

    const maxRate = Math.max(...feeList.map(e => e.rate));
    el.innerHTML = feeList.map(e => {
      const valStr = e.rate >= 1 ? f(e.rate, 0) : f(e.rate, 2);
      const pct = (e.rate / maxRate * 100).toFixed(1);

      return `<div class="fee-bar-row" data-copy="${valStr}">
        <div class="fee-bar-accent"></div>
        <div class="fee-bar-body">
          <span class="fee-bar-lbl">${e.label}</span>
          <span class="fee-bar-time">${e.time}</span>
        </div>
        <div class="fee-bar-right">
          <span class="fee-bar-val">${valStr}</span>
          <span class="fee-bar-unit">sat/vB</span>
        </div>
        <div class="fee-bar-fill"><div class="fee-bar-fill-inner" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// PEERS MODULE — peer table, peer detail, RPC actions
// ═══════════════════════════════════════════════════════════════════════════════
const peersPanel = {
  _cache: [],
  _selectedId: null,
  _activeTab: 'conn',
  _filterTerm: '',
  _actionController: null,
  _renderedPeerId: null,

  async rpc(method, params) {
    try {
      const res = await fetch('/api/rpc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, params }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      return j.result;
    } catch (e) {
      toastStack.add(method + ': ' + e.message);
      console.error('[rpc:' + method + ']', e.message);
      throw e;
    }
  },

  render(d) {
    const peers = d.peers || [];
    const ni = d.networkInfo || {};
    const ibd = d.blockchain?.initialblockdownload || false;
    const now = Date.now() / 1000;
    this._cache = peers;

    const peersIn = peers.filter(p => p.inbound);
    const peersOut = peers.filter(p => !p.inbound);
    const connIn = ni.connections_in != null ? ni.connections_in : peersIn.length;
    const connOut = ni.connections_out != null ? ni.connections_out : peersOut.length;
    setText('peer-in-ph', '↓ ' + connIn + ' in');
    setText('peer-out-ph', '↑ ' + connOut + ' out');

    const tbody = $('peer-table-body');
    if (!tbody) return;

    if (ibd && !peers.length) {
      tbody.innerHTML = '<tr><td colspan="2" class="ibd-placeholder">peer data unavailable during initial sync</td></tr>';
      return;
    }

    const bestPeerBlock = peers.reduce((best, p) => Math.max(best, p.last_block || 0), 0);
    const maxSent = peers.reduce((m, p) => Math.max(m, p.bytessent || 0), 1);
    const maxRecv = peers.reduce((m, p) => Math.max(m, p.bytesrecv || 0), 1);
    const maxBW = Math.max(maxSent, maxRecv);

    const bestBlock = d.blockchain?.blocks || 0;

    tbody.innerHTML = peers.map(p => {
      const net = utils.peerNet(p.addr || '', p.network || '');
      const isBlockRelay = (p.connection_type || '').includes('block-relay');
      const connAge = p.conntime ? (now - p.conntime) : 0;
      const peerBlockAge = p.last_block > 0 ? (now - p.last_block) : Infinity;
      const peerTxAge = p.last_transaction > 0 ? (now - p.last_transaction) : Infinity;
      const networkHasBlocks = bestPeerBlock > 0 && (now - bestPeerBlock) < 1200;
      const blockStale = connAge > 300 && peerBlockAge > 1200 && networkHasBlocks;
      const txStale = !isBlockRelay && p.relaytxes !== false && connAge > 300 && peerTxAge > 1200 && networkHasBlocks;
      const isStale = blockStale && (isBlockRelay || txStale);
      const isSel = p.id === this._selectedId;

      // Col 0: stripe
      const stripeClass = isBlockRelay ? 'peer-stripe-relay'
        : p.inbound ? 'peer-stripe-in' : 'peer-stripe-out';

      // Col 1: address cell
      const addrFull = esc(p.addr || '');
      const addr = esc((p.addr || '').replace(/:\d+$/, '').replace(/^\[(.+)\]$/, '$1'));
      const ver = esc((p.subver || '').replace(/^\/|\/$/g, ''));
      const netLabelClass = net === 'onion' ? 'net-onion'
        : net === 'ipv6' ? 'net-ipv6'
        : net === 'i2p'  ? 'net-i2p'
        : 'net-ipv4';
      const sentPct = ((p.bytessent || 0) / maxBW * 100).toFixed(1);
      const recvPct = ((p.bytesrecv || 0) / maxBW * 100).toFixed(1);

      // Col 2: ping
      const pc = p.pingtime > 0
        ? (p.pingtime < 0.06 ? 'grn' : p.pingtime < 0.18 ? 'dim' : 'neg') : 'dim';
      const ping = p.pingtime > 0 ? Math.round(p.pingtime * 1000) + 'ms' : '—';
      const pingCell = `<span class="ping-cell"><span class="ping-dot ${pc}"></span><span class="ping-val td-${pc}">${ping}</span></span>`;

      return `<tr data-pid="${p.id}" role="row" tabindex="0" aria-selected="${isSel}"
        class="${isSel ? 'peer-sel' : ''}${isStale ? ' peer-stale' : ''}">
        <td class="td-peer-main">
          <div class="peer-row-top">
            <span class="peer-net-label ${netLabelClass}">${esc(net)}</span>
            <span class="peer-addr-text">${addr || '—'}</span>
          </div>
          <span class="peer-ver-text">${ver}</span>
          <div class="peer-bars-group">
            <div class="peer-bar-row">
              <span class="peer-bar-lbl">sent</span>
              <div class="peer-bar-track"><div class="peer-bar-fill" style="width:${sentPct}%;background:var(--pos)"></div></div>
              <span class="peer-bar-val sent">↑ ${utils.fmtBytes(p.bytessent || 0)}</span>
            </div>
            <div class="peer-bar-row">
              <span class="peer-bar-lbl">recv</span>
              <div class="peer-bar-track"><div class="peer-bar-fill" style="width:${recvPct}%;background:var(--orange)"></div></div>
              <span class="peer-bar-val recv">↓ ${utils.fmtBytes(p.bytesrecv || 0)}</span>
            </div>
          </div>
        </td>
        <td class="td-peer-ping">${pingCell}</td>
      </tr>`;
    }).join('');

    if (this._filterTerm) {
      this._applyFilter();
    }

    if (this._selectedId != null) {
      const p = this._cache.find(x => x.id === this._selectedId);
      if (p) this.renderDetail(p);
    }
  },

  _applyFilter() {
    const term = this._filterTerm;
    const rows = $$('#peer-table-body tr[data-pid]');
    let visible = 0;
    rows.forEach(row => {
      const text = row.textContent.toLowerCase();
      const show = !term || text.includes(term);
      row.style.display = show ? '' : 'none';
      if (show) visible++;
    });

    let countEl = $('peer-filter-count');
    const input = $('peer-filter');
    if (!countEl && input?.parentElement) {
      countEl = document.createElement('div');
      countEl.id = 'peer-filter-count';
      countEl.className = 'peer-filter-count';
      input.parentElement.appendChild(countEl);
    }
    if (countEl) {
      countEl.textContent = term ? `${visible} / ${rows.length} shown` : '';
    }
  },

  renderDetail(p) {
    const body = $('peer-detail-body');

    if (!p) {
      if (body) body.innerHTML = '<div class="pd-empty">click a peer to inspect</div>';
      setText('pd-ph', '—');
      this._renderedPeerId = null;
      return;
    }

    // Same peer already rendered — patch values in-place, no DOM rebuild
    if (this._renderedPeerId === p.id && body?.querySelector('[data-pd]')) {
      this._patchDetail(p, body);
      return;
    }
    this._renderedPeerId = p.id;

    const net     = utils.peerNet(p.addr || '', p.network || '');
    const now     = Date.now() / 1000;
    const svcs    = utils.decodeServices(p.services);
    const addrDisplay = (p.addr || '').replace(/:\d+$/, '').replace(/^\[(.+)\]$/, '$1');
    setText('pd-ph', addrDisplay || '—');

    const netLabelClass = net === 'onion' ? 'net-onion'
      : net === 'ipv6' ? 'net-ipv6' : net === 'i2p' ? 'net-i2p' : 'net-ipv4';

    const ct = p.connection_type || '';
    const CT_CLASS = {
      'outbound-full-relay': 'ct-outbound', 'block-relay-only': 'ct-block-relay',
      inbound: 'ct-inbound', feeler: 'ct-feeler', 'addr-fetch': 'ct-feeler', manual: 'ct-manual',
    };
    const ctClass = CT_CLASS[ct] || '';
    const ctLabel = ct.replace('outbound-full-relay', 'full-relay') || '—';
    const verClean = esc((p.subver || '').replace(/^\/|\/$/g, ''));
    const asnStr   = p.mapped_as != null ? 'AS' + p.mapped_as : null;
    const isV2     = (p.transport_protocol_type || '').includes('v2');
    const pingMs   = p.pingtime > 0 ? Math.round(p.pingtime * 1000) : null;
    const pingCls  = pingMs == null ? 'dim' : pingMs < 60 ? 'grn' : pingMs < 180 ? 'dim' : 'neg';
    const lastSendStr = p.lastsend > 0 ? utils.fmtAgeAgo(now - p.lastsend) : '—';
    const lastRecvStr = p.lastrecv > 0 ? utils.fmtAgeAgo(now - p.lastrecv) : '—';
    const hdrBlkGap   = (p.synced_headers || 0) - (p.synced_blocks || 0);
    const ff          = p.minfeefilter ?? p.fee_filter;
    const permsArr    = Array.isArray(p.permissions) ? p.permissions
      : (p.permissions ? String(p.permissions).split(',').map(s => s.trim()).filter(Boolean) : []);

    const svcHTML = svcs.map(s => {
      const cls = ['NETWORK','WITNESS'].includes(s) ? 'svc-core'
        : ['BLOOM','COMPACT_FILTERS','P2P_V2'].includes(s) ? 'svc-cap' : 'svc-ltd';
      return `<span class="${cls}">${esc(s)}</span>`;
    }).join('');

    const sm = p.bytessent_per_msg || {}, rm = p.bytesrecv_per_msg || {};
    const msgs = [...new Set([...Object.keys(sm), ...Object.keys(rm)])].sort();
    const msgRows = msgs.length ? `
      <div class="pd-section">
        <div class="pd-section-label">per-message bytes</div>
        <div class="pd-msg-grid">
          ${msgs.map(k => `
            <span class="pd-msg-name">${esc(k)}</span>
            <span class="pd-msg-sent">↑ ${utils.fmtBytes(sm[k] || 0)}</span>
            <span class="pd-msg-recv" data-pd="msg-${esc(k)}">↓ ${utils.fmtBytes(rm[k] || 0)}</span>`).join('')}
        </div>
      </div>` : '';

    const header = `
      <div class="pd-header">
        <div class="pd-header-top">
          <span class="pd-header-net ${netLabelClass}">${esc(net)}</span>
          <span class="pd-header-addr">${esc(addrDisplay || '—')}</span>
          <span class="pd-header-copy copy-icon" data-copy="${esc(p.addr || '')}">⎘</span>
        </div>
        <div class="pd-header-badges">
          <span class="pd-badge ${p.inbound ? 'pd-badge-dir-in' : 'pd-badge-dir-out'}">${p.inbound ? '← in' : '→ out'}</span>
          ${ct ? `<span class="pd-badge pd-badge-ct ${ctClass}">${esc(ctLabel)}</span>` : ''}
          ${verClean ? `<span class="pd-badge pd-badge-ua">${verClean}</span>` : ''}
          ${isV2 ? `<span class="pd-badge pd-badge-v2">v2 enc</span>` : ''}
          ${asnStr ? `<span class="pd-badge pd-badge-asn">${esc(asnStr)}</span>` : ''}
        </div>
      </div>`;

    const statGrid = `
      <div class="pd-stat-grid">
        <div class="pd-stat-cell">
          <span class="pd-stat-val ${pingCls}" data-pd="ping">${pingMs != null ? pingMs + 'ms' : '—'}</span>
          <span class="pd-stat-lbl">ping${p.minping > 0 ? ' · min ' + Math.round(p.minping * 1000) + 'ms' : ''}</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim" data-pd="conntime">${p.conntime ? utils.fmtAge(now - p.conntime) : '—'}</span>
          <span class="pd-stat-lbl">connected</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim" data-pd="synced-blocks">${p.synced_blocks ? fb(p.synced_blocks) : '—'}</span>
          <span class="pd-stat-lbl">synced blocks</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim">${p.version ? esc(String(p.version)) : '—'}</span>
          <span class="pd-stat-lbl">protocol</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val sent" data-pd="bw-sent">↑ ${utils.fmtBytes(p.bytessent || 0)}</span>
          <span class="pd-stat-lbl">sent</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val recv" data-pd="bw-recv">↓ ${utils.fmtBytes(p.bytesrecv || 0)}</span>
          <span class="pd-stat-lbl">recv</span>
        </div>
      </div>`;

    const sections = `
      <div class="pd-body">
        <div class="pd-section">
          <div class="pd-section-label">sync</div>
          <div class="pd-kv"><span class="k">headers</span><span class="v dim" data-pd="synced-headers">${fb(p.synced_headers || 0)}</span></div>
          <div class="pd-kv"><span class="k">hdr–blk gap</span><span class="v ${hdrBlkGap > 10 ? 'o' : 'dim'}" data-pd="hdr-blk-gap">${fb(hdrBlkGap)}</span></div>
          <div class="pd-kv"><span class="k">start height</span><span class="v dim">${fb(p.startingheight || 0)}</span></div>
          <div class="pd-kv"><span class="k">HB to peer</span><span class="v ${p.bip152_hb_to ? 'grn' : 'dim'}">${p.bip152_hb_to != null ? (p.bip152_hb_to ? 'high-bw' : 'low-bw') : '—'}</span></div>
          <div class="pd-kv"><span class="k">HB from peer</span><span class="v ${p.bip152_hb_from ? 'grn' : 'dim'}">${p.bip152_hb_from != null ? (p.bip152_hb_from ? 'high-bw' : 'low-bw') : '—'}</span></div>
        </div>
        <div class="pd-section">
          <div class="pd-section-label">timing</div>
          <div class="pd-kv"><span class="k">last send</span><span class="v dim" data-pd="lastsend">${lastSendStr}</span></div>
          <div class="pd-kv"><span class="k">last recv</span><span class="v dim" data-pd="lastrecv">${lastRecvStr}</span></div>
          <div class="pd-kv"><span class="k">last block</span><span class="v dim" data-pd="last-block">${p.last_block > 0 ? utils.fmtAgeAgo(now - p.last_block) : '—'}</span></div>
          <div class="pd-kv"><span class="k">last tx</span><span class="v dim" data-pd="last-tx">${p.last_transaction > 0 ? utils.fmtAgeAgo(now - p.last_transaction) : '—'}</span></div>
          <div class="pd-kv"><span class="k">time offset</span><span class="v ${Math.abs(p.timeoffset || 0) > 70 ? 'neg' : 'dim'}">${p.timeoffset != null ? (p.timeoffset > 0 ? '+' : '') + p.timeoffset + 's' : '—'}</span></div>
          ${p.pingwait != null ? `<div class="pd-kv"><span class="k">ping wait</span><span class="v neg">${Math.round(p.pingwait * 1000)}ms in-flight</span></div>` : ''}
        </div>
        <div class="pd-section">
          <div class="pd-section-label">connection</div>
          <div class="pd-kv"><span class="k">transport</span><span class="v dim">${esc(p.transport_protocol_type || '—')}</span></div>
          ${p.session_id ? `<div class="pd-kv"><span class="k">session id</span><span class="v mono">${esc(p.session_id.slice(0,16))}…</span></div>` : ''}
          <div class="pd-kv"><span class="k">relay txs</span><span class="v ${p.relaytxes === false ? 'neg' : 'dim'}">${p.relaytxes === false ? 'no' : 'yes'}</span></div>
          ${ff != null ? `<div class="pd-kv"><span class="k">fee filter</span><span class="v dim">${f(ff * 1e5, 2)} sat/vB</span></div>` : ''}
          ${p.addr_local ? `<div class="pd-kv"><span class="k">local addr</span><span class="v mono">${esc(p.addr_local)}</span></div>` : ''}
          ${permsArr.length ? `<div class="pd-kv"><span class="k">flags</span><span class="v dim">${esc(permsArr.join(', '))}</span></div>` : ''}
          <div class="pd-kv"><span class="k">addr processed</span><span class="v dim" data-pd="addr-processed">${p.addr_processed != null ? fb(p.addr_processed) : '—'}</span></div>
          ${p.addr_rate_limited > 0 ? `<div class="pd-kv"><span class="k">addr rate-lim</span><span class="v neg" data-pd="addr-rate-lim">${fb(p.addr_rate_limited)}</span></div>` : ''}
        </div>
        <div class="pd-section">
          <div class="pd-section-label">services</div>
          <div class="pd-svc">${svcHTML}</div>
        </div>
        ${msgRows}
        <div class="pd-section">
          <div class="pd-section-label">actions</div>
          <div class="peer-actions">
            <button type="button" class="pa-btn" data-pa="disconnect">disconnect</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban1h">ban 1h</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban24h">ban 24h</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban7d">ban 7d</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban30d">ban 30d</button>
            <button type="button" class="pa-btn pa-ban" data-pa="banperm">ban ∞</button>
          </div>
        </div>
      </div>`;

    if (body) body.innerHTML = header + statGrid + sections;
    this._wireActions(p, body);
  },

  // Patch live values in-place — no innerHTML rebuild, no scroll disruption
  _patchDetail(p, body) {
    const now = Date.now() / 1000;
    const set = (key, val) => {
      const el = body.querySelector(`[data-pd="${key}"]`);
      if (el && el.textContent !== val) el.textContent = val;
    };
    const pingMs = p.pingtime > 0 ? Math.round(p.pingtime * 1000) : null;
    set('ping',           pingMs != null ? pingMs + 'ms' : '—');
    set('conntime',       p.conntime ? utils.fmtAge(now - p.conntime) : '—');
    set('synced-blocks',  p.synced_blocks ? fb(p.synced_blocks) : '—');
    set('bw-sent',        '↑ ' + utils.fmtBytes(p.bytessent || 0));
    set('bw-recv',        '↓ ' + utils.fmtBytes(p.bytesrecv || 0));
    set('synced-headers', fb(p.synced_headers || 0));
    set('hdr-blk-gap',    fb((p.synced_headers || 0) - (p.synced_blocks || 0)));
    set('lastsend',       p.lastsend > 0 ? utils.fmtAgeAgo(now - p.lastsend) : '—');
    set('lastrecv',       p.lastrecv > 0 ? utils.fmtAgeAgo(now - p.lastrecv) : '—');
    set('last-block',     p.last_block > 0 ? utils.fmtAgeAgo(now - p.last_block) : '—');
    set('last-tx',        p.last_transaction > 0 ? utils.fmtAgeAgo(now - p.last_transaction) : '—');
    set('addr-processed', p.addr_processed != null ? fb(p.addr_processed) : '—');
    set('addr-rate-lim',  p.addr_rate_limited != null ? fb(p.addr_rate_limited) : '—');
    const sm = p.bytessent_per_msg || {}, rm = p.bytesrecv_per_msg || {};
    [...new Set([...Object.keys(sm), ...Object.keys(rm)])].forEach(k =>
      set('msg-' + k, '↓ ' + utils.fmtBytes(rm[k] || 0))
    );
  },


  _wireActions(p, body) {
    if (!body) return;

    if (this._actionController) this._actionController.abort();
    this._actionController = new AbortController();
    const signal = this._actionController.signal;

    body.querySelectorAll('.pa-btn[data-pa]').forEach(btn => {
      let pendingReset = null;

      btn.addEventListener('click', async e => {
        e.stopPropagation();
        const action = btn.dataset.pa;

        if (action === 'disconnect') {
          btn.classList.add('pa-working');
          try {
            await this.rpc('disconnectnode', [p.addr || '']);
            this._selectedId = null;
            this.renderDetail(null);
            setTimeout(() => poller.fetchNow(), 600);
          } catch (_) {
            btn.classList.remove('pa-working');
          }
          return;
        }

        // Ban: require confirmation click within 3s
        if (btn.dataset.confirm !== 'pending') {
          clearTimeout(pendingReset);
          const origText = btn.textContent;
          btn.dataset.origText = origText;
          btn.dataset.confirm = 'pending';
          btn.textContent = 'confirm?';
          btn.style.opacity = '1';
          pendingReset = setTimeout(() => {
            btn.dataset.confirm = '';
            btn.textContent = btn.dataset.origText || origText;
            btn.style.opacity = '';
          }, 3000);
          return;
        }

        // Confirmed
        clearTimeout(pendingReset);
        btn.dataset.confirm = '';
        btn.textContent = btn.dataset.origText || btn.textContent;
        btn.style.opacity = '';
        btn.classList.add('pa-working');

        try {
          const banAddr = (p.addr || '').replace(/:(\d+)$/, '').replace(/^\[(.+)\]$/, '$1');
          if (action === 'banperm') {
            await this.rpc('setban', [banAddr, 'add', 253370764800, true]);
          } else {
            const dur = { ban1h: 3600, ban24h: 86400, ban7d: 604800, ban30d: 2592000 }[action];
            await this.rpc('setban', [banAddr, 'add', dur, false]);
          }
          this._selectedId = null;
          this.renderDetail(null);
          banList.refresh();
          setTimeout(() => poller.fetchNow(), 600);
        } catch (_) {
          btn.classList.remove('pa-working');
        }
      }, { signal });
    });
  },

  selectById(pid) {
    this._selectedId = pid;
    this._renderedPeerId = null;
    $('peer-table-body')?.querySelectorAll('tr').forEach(r =>
      r.classList.toggle('peer-sel', parseInt(r.dataset.pid, 10) === pid)
    );
    const p = this._cache.find(x => x.id === pid);
    if (p) this.renderDetail(p);
  },

  exportTSV() {
    const now = Date.now() / 1000;
    const cols = [
      'id', 'addr', 'network', 'direction', 'connection_type', 'relaytxes',
      'version', 'subver', 'synced_blocks', 'synced_headers', 'startingheight',
      'pingtime_ms', 'minping_ms', 'conntime_age_s', 'lastrecv_ago_s',
      'last_block_ago_s', 'last_transaction_ago_s',
      'bytessent', 'bytesrecv', 'services', 'minfeefilter',
      'addr_processed', 'addr_rate_limited', 'transport_protocol_type',
    ];

    const row = p => [
      p.id,
      p.addr || '',
      utils.peerNet(p.addr || '', p.network || ''),
      p.inbound ? 'inbound' : 'outbound',
      p.connection_type || '',
      p.relaytxes === false ? 'false' : 'true',
      p.version || '',
      (p.subver || '').replace(/^\/|\/$/g, ''),
      p.synced_blocks ?? '',
      p.synced_headers ?? '',
      p.startingheight ?? '',
      p.pingtime > 0 ? Math.round(p.pingtime * 1000) : '',
      p.minping > 0 ? Math.round(p.minping * 1000) : '',
      p.conntime ? Math.round(now - p.conntime) : '',
      p.lastrecv ? Math.round(now - p.lastrecv) : '',
      p.last_block > 0 ? Math.round(now - p.last_block) : '',
      p.last_transaction > 0 ? Math.round(now - p.last_transaction) : '',
      p.bytessent ?? 0,
      p.bytesrecv ?? 0,
      p.services || '',
      p.minfeefilter ?? p.fee_filter ?? '',
      p.addr_processed ?? '',
      p.addr_rate_limited ?? '',
      p.transport_protocol_type || '',
    ].map(v => String(v).replace(/\t/g, ' ')).join('\t');

    const tsv = [cols.join('\t'), ...this._cache.map(row)].join('\n');
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([tsv], { type: 'text/tab-separated-values' }));
    a.download = `peers-${ts}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// BAN LIST MODULE
// ═══════════════════════════════════════════════════════════════════════════════
const banList = {
  async refresh() {
    const rowsEl = $('ban-rows');
    const phEl = $('ban-ph');
    if (!rowsEl) return;

    let bans = [];
    try { bans = await peersPanel.rpc('listbanned', []); } catch (_) { return; }

    if (!bans || !bans.length) {
      if (phEl) phEl.textContent = '—';
      rowsEl.innerHTML = '<div class="ban-empty">no bans</div>';
      return;
    }

    if (phEl) phEl.textContent = bans.length + (bans.length === 1 ? ' address' : ' addresses');

    rowsEl.innerHTML = bans.map(b =>
      '<div class="ban-row">'
      + '<span class="ban-row-addr">' + esc(b.address || '') + '</span>'
      + '<span class="ban-row-exp">' + utils.fmtBanLeft(b) + '</span>'
      + '<button type="button" class="pa-btn pa-unban" data-unban="' + esc(b.address || '') + '">unban</button>'
      + '</div>'
    ).join('');

    rowsEl.querySelectorAll('.pa-btn[data-unban]').forEach(btn => {
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        btn.classList.add('pa-working');
        try {
          await peersPanel.rpc('setban', [btn.dataset.unban, 'remove']);
          await this.refresh();
          setTimeout(() => poller.fetchNow(), 400);
        } catch (_) {
          btn.classList.remove('pa-working');
        }
      });
    });
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKS MODULE — blocks table, block detail, BIP9 signalling
// ═══════════════════════════════════════════════════════════════════════════════
const blocksPanel = {
  _cache: [],
  _selectedHeight: null,
  _lastDeploymentInfo: {},
  _seenHeights: new Set(),
  _initialised: false,

  render(d) {
    const blocks = d.blocks || [];
    const ibd = d.blockchain?.initialblockdownload || false;
    const now = Date.now() / 1000;
    this._cache = blocks;
    this._lastDeploymentInfo = d.deploymentInfo || {};

    setText('blk-ph', blocks.length ? 'tip #' + fb(blocks[0].height) : '—');

    const tbody = $('blk-body');
    if (!tbody) return;

    if (ibd && !blocks.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="ibd-placeholder">block stats unavailable during initial sync</td></tr>';
      return;
    }

    tbody.innerHTML = blocks.map((b, i) => {
      const isSel = b.height === this._selectedHeight;
      const isNew = !this._seenHeights.has(b.height) && i === 0;
      const fillPct = b.weight ? b.weight / 4000000 * 100 : 0;
      const clr = fillPct >= 85 ? 'var(--grn)'
        : fillPct >= 50 ? 'var(--orange)'
        : fillPct >= 20 ? 'var(--pos)'
        : 'var(--t4)';

      return `<tr class="${isNew ? 'new' : ''} ${isSel ? 'peer-sel' : ''}" role="row" tabindex="0" aria-selected="${isSel}" data-bheight="${b.height}">
        <td class="td-num"><a class="ext-link" href="${utils.mspaceUrl(b.hash, nodePanel.currentChain)}" target="_blank" rel="noopener noreferrer">${fb(b.height)}</a></td>
        <td class="td-hash td-hash-click" data-copy="${esc(b.hash || '')}"><span class="td-hash-prefix">${(b.hash || '').slice(0, 4)}${(b.hash || '').slice(4, 8)}…</span><em>${(b.hash || '').slice(-4)}</em></td>
        <td class="td-dim">${fb(b.txs)}</td>
        <td class="td-fill">
          <div class="blk-fill-wrap">
            <div class="blk-fill-track"><div class="blk-fill-bar" style="width:${Math.min(fillPct, 100).toFixed(1)}%;background:${clr}"></div></div>
            <span class="blk-fill-pct">${fillPct ? fillPct.toFixed(0) + '%' : '—'}</span>
          </div>
        </td>
        <td class="td-dim">${b.time ? utils.fmtAge(now - b.time) : '—'}</td>
      </tr>`;
    }).join('');

    blocks.forEach(b => this._seenHeights.add(b.height));

    if (!this._initialised && blocks.length) {
      // First load only: auto-select the tip and render the detail panel.
      this._initialised = true;
      this._selectedHeight = blocks[0].height;
      this.renderDetail(blocks[0]);
    }
    // Subsequent polls leave the detail panel untouched — the user drives it.
  },

  renderDetail(b) {
    const el = $('block-detail-body');
    const ph = $('bd-ph');

    if (!b) {
      if (el) el.innerHTML = '<div class="pd-empty">—</div>';
      if (ph) ph.textContent = 'latest';
      return;
    }

    if (ph) ph.textContent = '#' + fb(b.height);
    const now = Date.now() / 1000;

    // ── derived values ────────────────────────────────────────────────────────

    const fillPct    = b.weight ? b.weight / 4000000 * 100 : 0;
    const fillColor  = fillPct >= 85 ? 'var(--grn)'
                     : fillPct >= 50 ? 'var(--orange)'
                     : fillPct >= 20 ? 'var(--pos)'
                     : 'var(--t4)';
    const fillBadgeCls = fillPct >= 85 ? 'bd-fill-high'
                       : fillPct >= 40 ? 'bd-fill-med'
                       : 'bd-fill-low';

    const avgfeeStr = (() => {
      if (b.avgfeerate >= 1)             return f(b.avgfeerate, 0) + ' sat/vB';
      if (b.totalfee > 0 && b.size > 0) return f(b.totalfee / b.size, 2) + ' sat/vB';
      return '—';
    })();
    const avgFeeCls = b.avgfeerate > 20 ? 'o' : b.avgfeerate > 5 ? 'o2' : 'g';

    let era = '—';
    if (b.subsidy != null) {
      if      (b.subsidy >= 5000000000) era = '1';
      else if (b.subsidy >= 2500000000) era = '2';
      else if (b.subsidy >= 1250000000) era = '3';
      else if (b.subsidy >= 625000000)  era = '4';
      else if (b.subsidy >= 312500000)  era = '5';
      else if (b.subsidy > 0)           era = '6+';
      else                              era = 'none';
    }

    const totalReward  = (b.totalfee || 0) + (b.subsidy || 0);
    const feeRatioPct  = totalReward > 0 ? (b.totalfee || 0) / totalReward * 100 : 0;
    const feeRatioStr  = totalReward > 0 ? f(feeRatioPct, 2) + '%' : '—';
    const feeRatioCls  = feeRatioPct > 20 ? 'o' : feeRatioPct > 5 ? 'o2' : 'dim';

    // BIP-9 signalling
    const deployments = (this._lastDeploymentInfo && this._lastDeploymentInfo.deployments) || {};
    const sigBits = [];
    Object.entries(deployments).forEach(([name, fork]) => {
      if (fork.bip9 && fork.bip9.bit != null) {
        if ((b.version >>> 0) & (1 << fork.bip9.bit)) sigBits.push(name);
      }
    });
    const bip9Compliant = ((b.version >>> 0) >>> 29) === 0b001;
    const sigStr = sigBits.length ? sigBits.map(esc).join(', ') : (bip9Compliant ? 'none' : 'n/a');
    const sigCls = sigBits.length ? 'o2' : 'dim';

    // Fee percentile mini bar-chart
    const pctileHtml = (() => {
      const p = b.feePercentiles;
      if (!p || p.length < 5) return '';
      const vals = [p[0], p[1], p[2], p[3], p[4]];
      const max  = Math.max(...vals, 1);
      const fmt  = v => v >= 1 ? String(Math.round(v)) : v.toFixed(1);
      const bars = vals.map((v, i) => {
        const h   = Math.max(10, Math.round(v / max * 100));
        const mid = i === 2;
        return `<div class="bd-pctile-bar${mid ? ' bd-pctile-mid' : ''}" style="height:${h}%"></div>`;
      }).join('');
      return `
        <div class="bd-section-label">fee distribution (sat/vB)</div>
        <div class="bd-pctile-chart">${bars}</div>
        <div class="bd-pctile-labels">
          <span>p10:${esc(fmt(vals[0]))}</span>
          <span>p25:${esc(fmt(vals[1]))}</span>
          <span class="bd-pctile-mid-lbl">p50:${esc(fmt(vals[2]))}</span>
          <span>p75:${esc(fmt(vals[3]))}</span>
          <span>p90:${esc(fmt(vals[4]))}</span>
        </div>`;
    })();

    // Age + timestamp line
    const ageStr     = b.time ? utils.fmtAgeAgo(now - b.time) : '—';
    const stampStr   = b.time ? utils.fmtTimestamp(b.time) : '';
    const ageDisplay = stampStr ? `${ageStr} · ${stampStr}` : ageStr;

    // Hash display
    const hashFull    = b.hash || '';
    const hashDisplay = hashFull
      ? `<span class="bd-hash-accent">${esc(hashFull.slice(0, 4))}</span>${esc(hashFull.slice(4, 8))}…${esc(hashFull.slice(-6))}`
      : '—';

    const sizeStr = b.size   ? utils.fmtBytes(b.size)       : '—';
    const wgtStr  = b.weight ? f(b.weight / 1e6, 2) + ' MWU' : '—';

    // ── render ────────────────────────────────────────────────────────────────

    if (!el) return;

    el.innerHTML = `

      <div class="bd-header">
        <span class="bd-height">#${fb(b.height)}</span>
        <span class="bd-hash-wrap">
          <a class="ext-link" href="${utils.mspaceUrl(b.hash, nodePanel.currentChain)}"
             target="_blank" rel="noopener noreferrer">${hashDisplay}</a><span
             data-copy="${esc(hashFull)}" class="copy-icon">⎘</span>
        </span>
      </div>

      <div class="bd-meta-row">
        <span class="bd-age">${esc(ageDisplay)}</span>
        ${fillPct ? `<span class="bd-fill-badge ${fillBadgeCls}">${f(fillPct, 0)}% full</span>` : ''}
      </div>

      <div class="bd-body">

        <div class="bd-section">
          <div class="bd-section-label">transactions</div>
          <div class="bd-stat-grid">
            <div class="bd-stat">
              <div class="bd-stat-val bd-sv-dim">${b.txs ? fb(b.txs) : '—'}</div>
              <div class="bd-stat-lbl">total txs</div>
            </div>
            <div class="bd-stat">
              <div class="bd-stat-val bd-sv-dim">${b.ins ? fb(b.ins) : '—'}</div>
              <div class="bd-stat-lbl">inputs</div>
            </div>
            <div class="bd-stat">
              <div class="bd-stat-val bd-sv-dim">${b.outs ? fb(b.outs) : '—'}</div>
              <div class="bd-stat-lbl">outputs</div>
            </div>
          </div>
        </div>

        <div class="bd-section">
          <div class="bd-section-label">block fill</div>
          <div class="bd-fill-track">
            <div class="bd-fill-bar"
                 style="width:${Math.min(fillPct, 100).toFixed(1)}%;background:${fillColor}">
            </div>
          </div>
          <div class="bd-fill-labels">
            <span>${esc(sizeStr)} · ${esc(wgtStr)}</span>
            <span style="color:${fillColor};font-weight:600">${fillPct ? f(fillPct, 0) + '%' : '—'} / 4 MWU</span>
          </div>
        </div>

        ${pctileHtml ? `<div class="bd-section">${pctileHtml}</div>` : ''}

        <div class="bd-section">
          <div class="bd-section-label">reward</div>
          <div class="bd-kv">
            <span class="k">avg fee rate</span>
            <span class="v ${avgFeeCls}">${esc(avgfeeStr)}</span>
          </div>
          <div class="bd-kv">
            <span class="k">total fees</span>
            <span class="v o2">${b.totalfee ? utils.fmtSats(b.totalfee) : '—'}</span>
          </div>
          <div class="bd-kv">
            <span class="k">subsidy · era</span>
            <span class="v"><span class="o">${b.subsidy != null ? f(b.subsidy / 1e8, 3) + ' BTC' : '—'}</span><span class="dim"> · ${esc(era)}</span></span>
          </div>
          <div class="bd-kv">
            <span class="k">fee share</span>
            <span class="v ${feeRatioCls}">${esc(feeRatioStr)}</span>
          </div>
        </div>

        <div class="bd-section bd-section-tech">
          <div class="bd-section-label">technical</div>
          <div class="bd-kv">
            <span class="k">version · bits</span>
            <span class="v mono">0x${(b.version >>> 0).toString(16).padStart(8, '0')}${b.bits ? ' · 0x' + esc(b.bits) : ''}</span>
          </div>
          <div class="bd-kv">
            <span class="k">nonce</span>
            <span class="v mono">${b.nonce != null ? fb(b.nonce) : '—'}</span>
          </div>
          <div class="bd-kv">
            <span class="k">median time</span>
            <span class="v dim">${b.mediantime ? utils.fmtTimestamp(b.mediantime) : '—'}</span>
          </div>
          <div class="bd-kv">
            <span class="k">signalling</span>
            <span class="v ${sigCls} v-wrap">${sigStr}</span>
          </div>
        </div>

      </div>`;
  },

  selectByHeight(height) {
    this._selectedHeight = height;
    $('blk-body')?.querySelectorAll('tr').forEach(r =>
      r.classList.toggle('peer-sel', parseInt(r.dataset.bheight, 10) === height)
    );
    const b = this._cache.find(x => x.height === height);
    if (b) this.renderDetail(b);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CHARTS MODULE — fee heatmap, fee/subsidy sparkline, block timing bars
// ═══════════════════════════════════════════════════════════════════════════════

// Shared: get accent RGB from CSS once per frame
function getAccentRgb() {
  return (getComputedStyle(document.documentElement)
    .getPropertyValue('--orange-rgb') || '240,112,32').trim();
}

// Shared: compute chart height (mobile-aware)
function chartHeight(panel, extras = 0) {
  if (!panel) return 0;
  const r = panel.getBoundingClientRect();
  if (r.width <= 10) return 0;

  if (window.innerWidth < 1024) {
    return Math.min(220, Math.max(160, window.innerWidth * 0.45));
  }

  const ph = panel.querySelector('.ph');
  const phH = ph ? ph.getBoundingClientRect().height : 24;
  return Math.max(20, r.height - phH - 14 - extras);
}

// Shared: set up a HiDPI canvas
function setupCanvas(canvas, W, H) {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  // canvas.width assignment resets the backing store and clears the transform
  // stack — use resetTransform() to be explicit, then apply dpr scale once.
  ctx.resetTransform ? ctx.resetTransform() : ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  return ctx;
}

const charts = {

  feeHeatmap: {
    _blocks: [],
    _panel: null,

    draw(blocks) {
      if (blocks?.length) this._blocks = blocks;
      this._measure();
    },

    _measure() {
      const panel = this._panel || (this._panel = $('p-col2-heatmap'));
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      if (r.width <= 10) return;

      const H = window.innerWidth < 1024
        ? Math.min(220, Math.max(160, window.innerWidth * 0.45))
        : (() => {
            const ph = panel.querySelector('.ph');
            const phH = ph ? ph.getBoundingClientRect().height : 28;
            return Math.max(40, r.height - phH - 16);
          })();

      this._render(this._blocks, r.width - 24, H);
    },

    _render(blocks, W, H) {
      const canvas = $('fee-ridge-canvas');
      const ctx = setupCanvas(canvas, W, H);
      if (!ctx || !blocks || blocks.length < 2) return;

      const rgb = getAccentRgb();

      const ordered = [...blocks].filter(b => {
        const p = b.feePercentiles;
        return (p && p.length >= 5 && p[2] > 0) || b.avgfeerate > 0;
      });
      const N = ordered.length;
      if (!N) return;

      const LABEL_W = 32, BOT_PAD = 14, TOP_PAD = 4, RIGHT_PAD = 6;
      const plotW = W - LABEL_W - RIGHT_PAD;
      const LOG_MIN = Math.log10(0.5), LOG_MAX = Math.log10(1200);
      const feeToX = fee => LABEL_W + ((Math.log10(Math.max(0.4, fee)) - LOG_MIN) / (LOG_MAX - LOG_MIN)) * plotW;
      const floorX = feeToX(1);

      const rowH = (H - BOT_PAD - TOP_PAD) / N;
      const BAR_H = Math.max(3, Math.min(10, rowH * 0.38));
      const WHISKER_H = Math.max(2, BAR_H * 0.5);

      // Vertical grid lines
      [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000].forEach(fee => {
        const x = feeToX(fee);
        if (x < LABEL_W || x > W - RIGHT_PAD) return;
        const isMajor = (fee === 1 || fee === 10 || fee === 100);
        ctx.strokeStyle = `rgba(${rgb},${isMajor ? 0.10 : 0.04})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, TOP_PAD); ctx.lineTo(x, H - BOT_PAD); ctx.stroke();
      });

      // Relay floor line
      ctx.strokeStyle = `rgba(${rgb},0.22)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(floorX, TOP_PAD); ctx.lineTo(floorX, H - BOT_PAD); ctx.stroke();
      ctx.setLineDash([]);

      // Rows (newest = index 0 = top)
      ordered.forEach((b, i) => {
        const p = b.feePercentiles;
        let p10, p25, p50, p75, p90;
        if (p && p.length >= 5) {
          [p10, p25, p50, p75, p90] = p;
        } else {
          const r = b.avgfeerate;
          p10 = r * 0.6; p25 = r * 0.8; p50 = r; p75 = r * 1.2; p90 = r * 1.5;
        }
        if (!p50 || p50 < 0.01) return;

        const isNewest = (i === 0);
        const ageAlpha = isNewest ? 1.0 : Math.max(0.22, 1.0 - (i / (N - 1 || 1)) * 0.78);
        const cy = TOP_PAD + i * rowH + rowH * 0.5;

        const x10 = feeToX(p10), x90 = feeToX(p90);
        const x25 = feeToX(p25), x75 = feeToX(p75);
        const x50 = feeToX(p50);

        // Whisker line
        ctx.strokeStyle = `rgba(${rgb},${(ageAlpha * 0.35).toFixed(2)})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x10, cy); ctx.lineTo(x90, cy); ctx.stroke();

        // Whisker caps
        ctx.beginPath();
        ctx.moveTo(x10, cy - WHISKER_H / 2); ctx.lineTo(x10, cy + WHISKER_H / 2);
        ctx.moveTo(x90, cy - WHISKER_H / 2); ctx.lineTo(x90, cy + WHISKER_H / 2);
        ctx.strokeStyle = `rgba(${rgb},${(ageAlpha * 0.45).toFixed(2)})`;
        ctx.stroke();

        // IQR bar
        const barGrad = ctx.createLinearGradient(x25, 0, x75, 0);
        barGrad.addColorStop(0,   `rgba(${rgb},${(ageAlpha * 0.18).toFixed(2)})`);
        barGrad.addColorStop(0.4, `rgba(${rgb},${(ageAlpha * 0.52).toFixed(2)})`);
        barGrad.addColorStop(0.6, `rgba(${rgb},${(ageAlpha * 0.52).toFixed(2)})`);
        barGrad.addColorStop(1,   `rgba(${rgb},${(ageAlpha * 0.18).toFixed(2)})`);
        ctx.fillStyle = barGrad;
        const bx = Math.min(x25, x75);
        const bw = Math.max(2, Math.abs(x75 - x25));
        ctx.fillRect(bx, cy - BAR_H / 2, bw, BAR_H);

        // Bar outline
        ctx.strokeStyle = `rgba(${rgb},${(ageAlpha * 0.30).toFixed(2)})`;
        ctx.lineWidth = 0.5;
        ctx.strokeRect(bx + 0.5, cy - BAR_H / 2 + 0.5, bw - 1, BAR_H - 1);

        // Median tick
        const tickH = BAR_H + 4;
        ctx.strokeStyle = `rgba(${rgb},${(ageAlpha * (isNewest ? 1.0 : 0.75)).toFixed(2)})`;
        ctx.lineWidth = isNewest ? 2 : 1.5;
        ctx.beginPath(); ctx.moveTo(x50, cy - tickH / 2); ctx.lineTo(x50, cy + tickH / 2); ctx.stroke();

        // Glow on newest
        if (isNewest) {
          ctx.shadowColor = `rgba(${rgb},0.6)`;
          ctx.shadowBlur = 6;
          ctx.strokeStyle = `rgba(${rgb},1)`;
          ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(x50, cy - tickH / 2); ctx.lineTo(x50, cy + tickH / 2); ctx.stroke();
          ctx.shadowBlur = 0;
        }

        // Height label
        ctx.font = '10px Geist Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = `rgba(${rgb},${(ageAlpha * (isNewest ? 0.80 : 0.38)).toFixed(2)})`;
        if (b.height) ctx.fillText('…' + String(b.height).slice(-3), LABEL_W - 3, cy + 2.5);

        // Median value label (newest only)
        if (isNewest) {
          ctx.font = '10px Geist Mono, monospace';
          ctx.textAlign = 'left';
          ctx.fillStyle = `rgba(${rgb},0.85)`;
          const label = p50 >= 10 ? Math.round(p50) + 's' : p50.toFixed(1) + 's';
          ctx.fillText(label, x50 + 3, cy + 2.5);
        }
      });

      // X-axis labels
      ctx.font = '10px Geist Mono, monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(${rgb},0.55)`;
      ctx.fillText('1', floorX, H - 2);
      [2, 5, 10, 20, 50, 100, 200, 500, 1000].forEach(fee => {
        const x = feeToX(fee);
        if (x < floorX + 8 || x > W - RIGHT_PAD) return;
        ctx.fillStyle = `rgba(${rgb},0.28)`;
        ctx.fillText(fee >= 1000 ? '1k' : String(fee), x, H - 2);
      });

      ctx.restore();

      const hasPercentiles = blocks.some(b => b.feePercentiles);
      const phEl = $('fh-ph');
      if (phEl) phEl.textContent = 'last ' + ordered.length + ' blocks · sat/vB' + (hasPercentiles ? ' · p10–p90' : ' · avg');
    },
  },

  feeSubsidy: {
    _blocks: [],
    _panel: null,

    draw(blocks) {
      if (blocks?.length) this._blocks = blocks;
      this._measure();
    },

    _measure() {
      const panel = this._panel || (this._panel = $('p-col2-subsidy'));
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      if (r.width <= 10) return;

      const leg = $('fs-min')?.closest('div');
      const legH = leg ? leg.getBoundingClientRect().height + 3 : 18;
      const H = chartHeight(panel, legH + 3);
      if (H <= 0) return;

      this._render(this._blocks, r.width - 20 - 8, H);
    },

    _render(blocks, W, H) {
      const canvas = $('fs-canvas');
      const ctx = setupCanvas(canvas, W, H);
      if (!ctx || !blocks || blocks.length < 2) return;

      const valid = [...blocks].filter(b => (b.subsidy || 0) + (b.totalfee || 0) > 0).reverse();
      if (valid.length < 2) { setText('fs-avg', 'no data'); ctx.restore(); return; }

      const rgb = getAccentRgb();
      const ratios = valid.map(b => {
        const total = (b.totalfee || 0) + (b.subsidy || 0);
        return total > 0 ? (b.totalfee || 0) / total * 100 : 0;
      });
      const maxR = Math.max(...ratios, 5);
      const avgR = ratios.reduce((a, b) => a + b, 0) / ratios.length;
      const minR = Math.min(...ratios);

      const pad = 2;
      const xStep = (W - pad * 2) / (ratios.length - 1);
      const yOf = r => H - pad - (r / maxR) * (H - pad * 2);

      // Fill
      const peakY = Math.min(...ratios.map(r => yOf(r)));
      const grad = ctx.createLinearGradient(0, peakY, 0, H);
      grad.addColorStop(0, `rgba(${rgb},0.28)`);
      grad.addColorStop(0.55, `rgba(${rgb},0.10)`);
      grad.addColorStop(1, `rgba(${rgb},0)`);

      ctx.beginPath();
      ctx.moveTo(pad, yOf(ratios[0]));
      ratios.forEach((r, i) => { if (i > 0) ctx.lineTo(pad + i * xStep, yOf(r)); });
      ctx.lineTo(pad + (ratios.length - 1) * xStep, H);
      ctx.lineTo(pad, H);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      // Line
      ctx.beginPath();
      ctx.moveTo(pad, yOf(ratios[0]));
      ratios.forEach((r, i) => { if (i > 0) ctx.lineTo(pad + i * xStep, yOf(r)); });
      ctx.strokeStyle = `rgba(${rgb},0.75)`;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Endpoint dot
      const lx = pad + (ratios.length - 1) * xStep;
      const ly = yOf(ratios[ratios.length - 1]);
      ctx.beginPath(); ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},0.9)`;
      ctx.fill();

      // 50% reference line
      if (maxR >= 50) {
        const refY = yOf(50);
        ctx.strokeStyle = 'rgba(90,90,90,0.55)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(0, refY); ctx.lineTo(W, refY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px Geist Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(90,90,90,0.6)';
        ctx.fillText('50%', W - 1, refY - 2);
      }

      ctx.restore();

      setText('fs-min', minR.toFixed(2) + '%');
      setText('fs-max', maxR.toFixed(2) + '%');
      setText('fs-avg', 'avg ' + avgR.toFixed(2) + '%');
      const phEl = $('fs-ph');
      if (phEl) phEl.textContent = 'fees % of block reward · last ' + valid.length;
    },
  },

  blockTiming: {
    _blocks: [],
    _panel: null,

    draw(blocks) {
      if (blocks?.length) this._blocks = blocks;
      this._measure();
    },

    _measure() {
      const panel = this._panel || (this._panel = $('p-col2-mid'));
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      if (r.width <= 10) return;

      const legend = panel.querySelector('#bt-min')?.closest('div');
      const labelH = legend ? legend.getBoundingClientRect().height + 3 : 18;
      const H = chartHeight(panel, labelH + 3);
      if (H <= 0) return;

      this._render(this._blocks, r.width - 20 - 8, H);
    },

    _render(blocks, W, H) {
      const canvas = $('bt-canvas');
      const ctx = setupCanvas(canvas, W, H);
      if (!ctx || !blocks || blocks.length < 2) return;

      const accentRgb = getAccentRgb();

      const gaps = [];
      for (let i = 0; i < blocks.length - 1; i++) {
        const g = (blocks[i].time - blocks[i + 1].time) / 60;
        if (g > 0 && g < 180) gaps.push({ g, current: false });
      }
      if (!gaps.length) { ctx.restore(); return; }

      gaps.reverse();

      // Current gap (time since tip)
      if (blocks.length) {
        const sinceNow = (Date.now() / 1000 - blocks[0].time) / 60;
        if (sinceNow > 0 && sinceNow < 180) gaps.push({ g: sinceNow, current: true });
      }

      const gVals = gaps.map(x => x.g);
      const completedVals = gaps.filter(x => !x.current).map(x => x.g);
      const maxG = Math.max(...gVals, 1);
      const minG = Math.min(...completedVals);
      const avgG = completedVals.reduce((a, b) => a + b, 0) / completedVals.length;

      const bw = Math.floor(W / gaps.length) - 1;
      const padX = Math.floor((W - gaps.length * (bw + 1)) / 2);
      const fontSize = Math.max(10, Math.min(11, Math.floor(bw * 0.7)));
      ctx.font = `${fontSize}px Geist Mono, monospace`;
      ctx.textAlign = 'center';

      gaps.forEach(({ g, current }, i) => {
        const barH = Math.max(2, Math.floor((g / maxG) * (H - 4)));
        const x = padX + i * (bw + 1);
        const y = H - barH;

        if (current) {
          ctx.fillStyle = `rgba(${accentRgb},0.20)`;
          ctx.fillRect(x, y, bw, barH);
          ctx.strokeStyle = `rgba(${accentRgb},0.45)`;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 2]);
          ctx.strokeRect(x + 0.5, y + 0.5, bw - 1, barH - 1);
          ctx.setLineDash([]);
        } else {
          const fast = g <= avgG * 1.4;
          const slow = g > avgG * 2;
          const barGrad = ctx.createLinearGradient(x, y, x, y + barH);
          if (fast) {
            barGrad.addColorStop(0, 'rgba(90,170,106,.75)');
            barGrad.addColorStop(1, 'rgba(90,170,106,.35)');
          } else if (slow) {
            barGrad.addColorStop(0, 'rgba(64,64,64,.6)');
            barGrad.addColorStop(1, 'rgba(40,40,40,.4)');
          } else {
            barGrad.addColorStop(0, `rgba(${accentRgb},0.65)`);
            barGrad.addColorStop(1, `rgba(${accentRgb},0.30)`);
          }
          ctx.fillStyle = barGrad;
          ctx.fillRect(x, y, bw, barH);
        }

        const label = g >= 10 ? Math.round(g) + 'm' : g.toFixed(1) + 'm';
        const labelW = ctx.measureText(label).width;
        if (bw >= labelW + 2) {
          ctx.save();
          if (barH >= fontSize + 6) {
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fillText(label, x + bw / 2, y + fontSize + 2);
          } else {
            ctx.fillStyle = 'rgba(104,104,104,0.85)';
            ctx.fillText(label, x + bw / 2, Math.max(fontSize + 1, y - 2));
          }
          ctx.restore();
        }
      });

      // 10m target line
      if (10 <= maxG) {
        const targetY = H - Math.floor((10 / maxG) * (H - 4)) - 1;
        ctx.strokeStyle = 'rgba(90,90,90,0.9)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(0, targetY); ctx.lineTo(W, targetY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px Geist Mono, monospace';
        ctx.textAlign = 'right';
        ctx.fillStyle = 'rgba(90,90,90,0.8)';
        ctx.fillText('10m', W - 1, targetY - 2);
      }

      // Average line
      if (Math.abs(avgG - 10) > 0.5) {
        const avgY = H - Math.floor((avgG / maxG) * (H - 4)) - 1;
        ctx.strokeStyle = `rgba(${accentRgb},0.35)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath(); ctx.moveTo(0, avgY); ctx.lineTo(W, avgY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '10px Geist Mono, monospace';
        ctx.textAlign = 'left';
        ctx.fillStyle = `rgba(${accentRgb},0.55)`;
        ctx.fillText('avg', 2, avgY - 2);
      }

      ctx.restore();

      setText('bt-min', minG.toFixed(1) + 'm');
      setText('bt-max', Math.max(...completedVals).toFixed(1) + 'm');
      setText('bt-avg', 'avg ' + avgG.toFixed(1) + 'm');
      setText('bt-ph', 'last ' + completedVals.length);
    },
  },

  // Wire ResizeObservers — rAF-debounced
  init() {
    if (typeof ResizeObserver === 'undefined') return;

    const observe = (panel, chart) => {
      if (!panel) return;
      let raf = null;
      new ResizeObserver(() => {
        if (!chart._blocks.length) return;
        if (panel.style.display === 'none') return;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { raf = null; chart._measure(); });
      }).observe(panel);
    };

    observe($('p-col2-heatmap'), this.feeHeatmap);
    observe($('p-col2-subsidy'), this.feeSubsidy);
    observe($('p-col2-mid'), this.blockTiming);

    const sparkPanel = $('p-col2-top');
    if (sparkPanel) {
      let raf = null;
      new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => { raf = null; network._drawSpark(); });
      }).observe(sparkPanel);
    }
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT v19 — drag, resize, swap, minimize, persist
// ═══════════════════════════════════════════════════════════════════════════════
const layout = {
  // ── Constants ────────────────────────────────────────────────────────────────
  GAP: 16,
  MIN_HF: 0.04,  // minimum height fraction any panel can be shrunk to
  MOBILE_BP: 768,
  COL_WF: [0.150, 0.240, 0.262, 0.348], // column width fractions

  // ── State ────────────────────────────────────────────────────────────────────
  _main: null,
  _isMobile: false,
  _minimized: new Map(),  // panel el → true
  _zTop: 20,
  _cols: null,            // [[{name,hf}, ...], ...] — live layout state

  // ── Labels / order ───────────────────────────────────────────────────────────
  _LABEL: {
    node: 'Node', chain: 'Chain', 'fee-distribution': 'Fees', 'fee-subsidy': 'Fee/Sub',
    'block-timing': 'Timing', blocks: 'Blocks', 'block-detail': 'Block', mining: 'Mining',
    peers: 'Peers', services: 'Services', banned: 'Banned', 'peer-detail': 'Peer',
  },

  _MOB_ORDER: [
    'node', 'chain', 'blocks', 'block-detail', 'peers', 'peer-detail', 'banned', 'mining',
    'fee-distribution', 'fee-subsidy', 'block-timing', 'services',
  ],

  // Default column layout: 4 columns, each panel has hf = fraction of data height.
  // All hf in a column sum to 1.0. Gaps are computed separately from data height.
  _DEFAULT_COLS: [
    [
      { name: 'node',             hf: 0.840 },
      { name: 'services',         hf: 0.160 },
    ],
    [
      { name: 'chain',            hf: 0.405 },
      { name: 'fee-distribution', hf: 0.135 },
      { name: 'fee-subsidy',      hf: 0.175 },
      { name: 'block-timing',     hf: 0.285 },
    ],
    [
      { name: 'blocks',           hf: 0.250 },
      { name: 'block-detail',     hf: 0.410 },
      { name: 'mining',           hf: 0.340 },
    ],
    [
      { name: 'peers',            hf: 0.380 },
      { name: 'banned',           hf: 0.080 },
      { name: 'peer-detail',      hf: 0.540 },
    ],
  ],

  _LS_KEY: 'bw_layout_v40',

  // ── Geometry helpers ─────────────────────────────────────────────────────────

  // Returns the pixel geometry of the data area (below chrome).
  _dataArea() {
    const G = this.GAP;
    const W = this._main.offsetWidth  || window.innerWidth;
    const H = this._main.offsetHeight || window.innerHeight;
    const tbH   = $('titlebar')?.offsetHeight || 40;
    const heroH = $('hero')?.offsetHeight     || 60;
    const top   = G + tbH + 8 + heroH + G;  // yData
    const left  = G;
    const width = W - G * 2;
    const height = H - top - G;
    return { left, top, width, height, W, H };
  },

  // Compute pixel x, w for column ci from data area.
  // COL_WF fractions are applied to the panel-only space (da.width minus 3 inter-column gaps)
  // so the rightmost column's right edge lands exactly at da.left + da.width.
  _colGeom(ci, da) {
    const G = this.GAP;
    const nCols = this.COL_WF.length;
    const panelSpace = da.width - G * (nCols - 1); // total width minus all inter-col gaps

    let x = da.left;
    for (let i = 0; i < ci; i++) x += Math.floor(panelSpace * this.COL_WF[i]) + G;

    // Last column gets the remaining space to absorb floor() rounding drift
    const w = ci === nCols - 1
      ? (da.left + da.width) - x
      : Math.floor(panelSpace * this.COL_WF[ci]);

    return { x, w };
  },

  // ── Active panels in a column (excluding minimized) ──────────────────────────
  _activePanels(ci) {
    return this._cols[ci].filter(slot => !this._minimized.has(this._panel(slot.name)));
  },

  _panel(name) { return $q(`[data-panel="${name}"]`); },
  _allPanels()  { return Array.from($$('[data-panel]')); },
  _checkMobile() { this._isMobile = window.innerWidth < this.MOBILE_BP; },
  _isTablet()   { return window.innerWidth >= this.MOBILE_BP && window.innerWidth < 1024; },

  // ── Chrome (titlebar + hero) ─────────────────────────────────────────────────
  _positionChrome() {
    const G = this.GAP;
    const W = this._main.offsetWidth  || window.innerWidth;
    const H = this._main.offsetHeight || window.innerHeight;
    const tbH   = $('titlebar')?.offsetHeight || 40;
    const heroH = $('hero')?.offsetHeight     || 60;

    const tb = $('titlebar');
    if (tb) Object.assign(tb.style, {
      position: 'absolute', display: '',
      left: G + 'px', top: G + 'px', width: (W - G * 2) + 'px', height: tbH + 'px',
    });

    const hero = $('hero');
    if (hero) Object.assign(hero.style, {
      position: 'absolute', display: '',
      left: G + 'px', top: (G + tbH + 8) + 'px', width: (W - G * 2) + 'px', height: heroH + 'px',
    });
  },

  // ── Core render: lay out all columns from _cols state ────────────────────────
  _render() {
    if (this._isTablet() || this._isMobile) return;
    const G = this.GAP;
    const da = this._dataArea();

    this._cols.forEach((col, ci) => {
      const { x: colX, w: colW } = this._colGeom(ci, da);
      const active = this._activePanels(ci);
      if (!active.length) return;

      // Total gap space consumed by separators between panels
      const totalGaps = G * (active.length - 1);
      // Pixel height available for panel content
      const totalH = da.height - totalGaps;

      // Normalise fractions of active panels so they always sum to 1.0
      const sumHf = active.reduce((s, slot) => s + slot.hf, 0);

      let cursor = da.top;
      active.forEach((slot, i) => {
        const p = this._panel(slot.name);
        if (!p) return;
        // Last panel gets remaining pixels to avoid 1px drift from rounding
        const h = i === active.length - 1
          ? da.top + da.height - cursor
          : Math.round((slot.hf / sumHf) * totalH);

        Object.assign(p.style, {
          position: 'absolute',
          display:  '',
          left:     colX + 'px',
          top:      cursor + 'px',
          width:    colW + 'px',
          height:   h    + 'px',
        });
        cursor += h + G;
      });
    });
  },

  // ── Init ─────────────────────────────────────────────────────────────────────
  init() {
    this._main = $('main');
    if (!this._main) return;

    this._main.classList.add('main-hidden');
    this._checkMobile();
    this._buildRestoreBar();

    // Initialise interaction on every data panel
    this._allPanels().forEach(p => {
      const name = p.dataset.panel;
      if (name === 'titlebar' || name === 'hero' || name === 'statusbar') return;
      this._addHandles(p);
      this._initDrag(p);
      this._initResize(p);
      this._initClose(p);
      p.style.display = 'none';
    });

    this._loadSaved();

    const tryShow = n => {
      if (window.innerWidth > 0 || n >= 20) {
        this._isMobile ? this._showMobile() : this._showDesktop();
        this._refreshRestoreBar();
        requestAnimationFrame(() => requestAnimationFrame(() => {
          this._main.classList.remove('main-hidden');
        }));
      } else {
        requestAnimationFrame(() => tryShow(n + 1));
      }
    };
    requestAnimationFrame(() => tryShow(0));

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const wasMobile  = this._isMobile;
        const wasTablet  = this._isTablet();
        this._checkMobile();
        const nowTablet  = this._isTablet();

        if (this._isMobile && !wasMobile) {
          this._showMobile();
        } else if (!this._isMobile && wasMobile) {
          this._showDesktop();
        } else if (wasTablet && !nowTablet) {
          this._showDesktop();
        } else if (!nowTablet && !this._isMobile) {
          // Pure desktop resize — just re-render. _cols is viewport-independent,
          // so this always produces pixel-perfect GAP-exact layout.
          this._positionChrome();
          this._render();
        } else if (nowTablet) {
          this._clearShellStyles();
          this._allPanels().forEach(p => {
            if (['titlebar','hero','statusbar'].includes(p.dataset.panel)) return;
            Object.assign(p.style, { position:'', left:'', top:'', width:'', height:'' });
          });
        }
      }, 60);
    });

    new MutationObserver(() => {
      this._allPanels().forEach(p => {
        if (p._lv17 && p._dragInit && p._rr && p._cc) return;
        this._addHandles(p);
        this._initDrag(p);
        this._initResize(p);
        this._initClose(p);
      });
    }).observe(this._main, { childList: true, subtree: true });
  },

  _clearShellStyles() {
    ['app', 'main', 'titlebar', 'hero', 'statusbar'].forEach(id => {
      const el = $(id);
      if (el) el.removeAttribute('style');
    });
  },

  _showDesktop() {
    this._main.classList.remove('main-mobile');
    if (this._isTablet()) {
      this._clearShellStyles();
      this._allPanels().forEach(p => {
        if (['titlebar','hero','statusbar'].includes(p.dataset.panel)) return;
        if (this._minimized.has(p)) return;
        Object.assign(p.style, { position:'', left:'', top:'', width:'', height:'', zIndex:'' });
        p.style.display = '';
      });
      return;
    }
    this._positionChrome();
    this._render();
  },

  _showMobile() {
    this._clearShellStyles();
    this._main.classList.add('main-mobile');
    const ordered = this._MOB_ORDER.map(n => this._panel(n)).filter(p => p && !this._minimized.has(p));
    this._allPanels().forEach(p => {
      if (!ordered.includes(p) && !this._minimized.has(p)) ordered.push(p);
    });
    ordered.forEach(p => {
      Object.assign(p.style, { position:'', left:'', top:'', width:'', height:'', zIndex:'' });
      p.style.display = '';
      this._main.appendChild(p);
    });
  },

  // ── Drag — insert into column or swap with panel ─────────────────────────
  // _findColumnInsert returns a descriptor for edge/gap zones (insert line shown).
  // When the cursor is in a panel's centre zone it returns null, which triggers
  // swap detection. A single-panel column behaves identically to a multi-panel
  // column: centre = swap, top/bottom edges = insert before/after.
  _initDrag(panel) {
    if (panel._dragInit) return;
    panel._dragInit = true;

    panel.addEventListener('pointerdown', e => {
      if (!this._isMobile && !e.target.closest('.resize-handle'))
        this._bringToFront(panel);
    }, true);

    const ph = panel.querySelector('.ph');
    if (!ph) return;

    ph.addEventListener('mouseenter', () => panel.classList.add('panel-ph-hover'));
    ph.addEventListener('mouseleave', () => panel.classList.remove('panel-ph-hover'));

    ph.addEventListener('pointerdown', e => {
      if (e.target.closest('.ph-right') || e.target.closest('.resize-handle')
          || this._isMobile || this._isTablet()) return;
      if (e.pointerType === 'touch' && e.isPrimary === false) return;
      e.preventDefault();
      ph.setPointerCapture(e.pointerId);

      const l0 = parseInt(panel.style.left) || 0;
      const t0 = parseInt(panel.style.top)  || 0;
      const W  = panel.offsetWidth;
      const H  = panel.offsetHeight;
      // Capture where within the panel the user clicked, so dragging feels natural
      const panelRect = panel.getBoundingClientRect();
      const grabOffsetX = e.clientX - panelRect.left;
      const grabOffsetY = e.clientY - panelRect.top;
      let moved      = false;
      let swapGhost  = null;  // box ghost shown over swap target
      let insertLine = null;  // line ghost shown for insert position
      let overTarget = null;  // panel to swap with
      let insertDrop = null;  // { ci, insertIndex } for column insert

      const mv = ev => {
        if (ev.pointerId !== e.pointerId) return;
        if (!moved && Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;

        if (!moved) {
          moved = true;
          panel.classList.add('panel-dragging');
          panel.classList.remove('panel-ph-hover');
          document.body.classList.add('is-dragging');
          document.body.style.cursor = 'grabbing';
          panel.style.willChange = 'transform';

          swapGhost = document.createElement('div');
          swapGhost.className = 'drop-ghost drop-ghost-swap';
          swapGhost.style.cssText = 'position:absolute;pointer-events:none;display:none;';
          this._main.appendChild(swapGhost);

          insertLine = document.createElement('div');
          insertLine.className = 'drop-insert-line';
          insertLine.style.cssText = 'position:absolute;pointer-events:none;display:none;';
          this._main.appendChild(insertLine);
        }

        const mainRect = this._main.getBoundingClientRect();
        const rawL = ev.clientX - mainRect.left - grabOffsetX;
        const rawT = ev.clientY - mainRect.top  - grabOffsetY;
        const da = this._dataArea();
        const clampL = Math.max(da.left, Math.min(da.left + da.width  - W, rawL));
        const clampT = Math.max(da.top,  Math.min(da.top  + da.height - H, rawT));
        panel.style.transform = `translate(${clampL - l0}px,${clampT - t0}px)`;

        const cx = ev.clientX - mainRect.left;
        const cy = ev.clientY - mainRect.top;

        // _findColumnInsert claims edge zones and returns null for centre zones.
        // A null result means swap detection gets to run below.
        insertDrop = (cy >= da.top && cy <= da.top + da.height)
          ? this._findColumnInsert(cx, cy, panel.dataset.panel, da)
          : null;

        // Swap target: cursor is in a panel's centre zone (insertDrop is null).
        overTarget = null;
        if (!insertDrop) {
          this._allPanels().forEach(p => {
            if (p === panel) return;
            if (['titlebar', 'hero', 'statusbar'].includes(p.dataset.panel)) return;
            if (this._minimized.has(p) || p.style.display === 'none') return;
            const pl = parseInt(p.style.left), pt = parseInt(p.style.top);
            if (cx >= pl && cx <= pl + p.offsetWidth && cy >= pt && cy <= pt + p.offsetHeight) {
              overTarget = p;
            }
          });
        }

        // Update ghosts — swap ghost for centre zone, insert line for edges/gaps.
        if (overTarget) {
          swapGhost.style.cssText = `position:absolute;pointer-events:none;
            left:${overTarget.style.left};top:${overTarget.style.top};
            width:${overTarget.offsetWidth}px;height:${overTarget.offsetHeight}px;`;
          swapGhost.style.display = '';
          insertLine.style.display = 'none';
        } else if (insertDrop) {
          swapGhost.style.display = 'none';
          const { lineX, lineW, lineY } = insertDrop;
          insertLine.style.cssText = `position:absolute;pointer-events:none;
            left:${lineX}px;top:${lineY - 1}px;width:${lineW}px;height:2px;`;
          insertLine.style.display = '';
        } else {
          swapGhost.style.display = 'none';
          insertLine.style.display = 'none';
        }
      };

      const up = ev => {
        if (ev.pointerId !== e.pointerId) return;
        ph.removeEventListener('pointermove', mv);
        ph.removeEventListener('pointerup',   up);
        ph.removeEventListener('pointercancel', up);
        document.body.style.cursor = '';
        document.body.classList.remove('is-dragging');
        panel.classList.remove('panel-dragging');
        panel.style.transform = '';
        panel.style.willChange = '';
        if (swapGhost)  { swapGhost.remove();  swapGhost  = null; }
        if (insertLine) { insertLine.remove(); insertLine = null; }

        if (moved && overTarget) {
          this._swapPanels(panel.dataset.panel, overTarget.dataset.panel);
        } else if (moved && insertDrop) {
          this._insertPanel(panel.dataset.panel, insertDrop.ci, insertDrop.insertIndex);
        } else if (moved) {
          panel.classList.add('panel-swapping');
          Object.assign(panel.style, { left: l0 + 'px', top: t0 + 'px' });
          setTimeout(() => panel.classList.remove('panel-swapping'), 260);
        }
      };

      ph.addEventListener('pointermove', mv);
      ph.addEventListener('pointerup',   up);
      ph.addEventListener('pointercancel', up);
    });
  },

  // Returns a drop target descriptor for edge/gap zones, or null for centre zones.
  // Edge zones (top/bottom 22% of a panel) → insert before/after.
  // Centre zone → null, letting swap detection handle it (works for any column size).
  // Gaps between panels (including phantom space from hidden panels) → insert at
  // the boundary of the nearest panel using top-edge comparison, not midpoint.
  // { ci, insertIndex, lineX, lineW, lineY }
  _findColumnInsert(cx, cy, dragName, da) {
    const G = this.GAP;
    const nCols = this.COL_WF.length;
    const EDGE_ZONE = 0.22;

    for (let ci = 0; ci < nCols; ci++) {
      const { x: colX, w: colW } = this._colGeom(ci, da);

      if (cx < colX || cx > colX + colW) continue;

      // Exclude the dragging panel — its slot still exists but shouldn't
      // influence index or geometry decisions.
      const active = this._activePanels(ci).filter(s => s.name !== dragName);

      // Check each panel for an edge-zone or centre-zone hit.
      for (let i = 0; i < active.length; i++) {
        const p = this._panel(active[i].name);
        if (!p) continue;
        const pt = parseInt(p.style.top);
        const ph = p.offsetHeight;
        if (cy < pt || cy > pt + ph) continue;

        // Cursor is on this panel.
        const edgePx = Math.max(32, ph * EDGE_ZONE);

        if (cy <= pt + edgePx) {
          // Top edge → insert before.
          const lineY = i === 0 ? da.top : pt - Math.round(G / 2);
          return { ci, insertIndex: i, lineX: colX, lineW: colW, lineY };
        }

        if (cy >= pt + ph - edgePx) {
          // Bottom edge → insert after.
          const lineY = i === active.length - 1
            ? da.top + da.height
            : pt + ph + Math.round(G / 2);
          return { ci, insertIndex: i + 1, lineX: colX, lineW: colW, lineY };
        }

        // Centre zone — return null so swap detection fires.
        return null;
      }

      // Cursor is in the column but not on any panel (gap or empty column).
      // Use panel top-edges as boundaries — avoids phantom-space issues when
      // a hidden panel leaves the remaining panel not at da.top.
      if (active.length === 0) {
        return { ci, insertIndex: 0, lineX: colX, lineW: colW, lineY: da.top };
      }

      for (let i = 0; i < active.length; i++) {
        const p = this._panel(active[i].name);
        if (!p) continue;
        const pt = parseInt(p.style.top);
        if (cy < pt) {
          // Above this panel — insert before it.
          const lineY = i === 0 ? da.top : pt - Math.round(G / 2);
          return { ci, insertIndex: i, lineX: colX, lineW: colW, lineY };
        }
      }

      // Below all panels — append at end.
      const last = this._panel(active[active.length - 1].name);
      const lastBottom = last ? parseInt(last.style.top) + last.offsetHeight : da.top + da.height;
      return { ci, insertIndex: active.length, lineX: colX, lineW: colW, lineY: lastBottom + Math.round(G / 2) };
    }

    return null;
  },

  // Move a panel from its current column into targetCol at insertIndex.
  // insertIndex is relative to the active (visible) panels in the target column —
  // it must be translated to a raw _cols index that accounts for hidden panels.
  _insertPanel(name, targetCi, insertIndex) {
    // Find and remove from source column.
    let srcCi = -1, srcSlot = null;
    for (let ci = 0; ci < this._cols.length; ci++) {
      const idx = this._cols[ci].findIndex(s => s.name === name);
      if (idx !== -1) {
        srcCi   = ci;
        srcSlot = this._cols[ci].splice(idx, 1)[0];
        break;
      }
    }
    if (srcCi === -1 || !srcSlot) return;

    // Redistribute the departed panel's hf to its former active column-mates.
    const srcActive = this._activePanels(srcCi);
    if (srcActive.length) {
      const share = srcSlot.hf / srcActive.length;
      srcActive.forEach(s => { s.hf += share; });
    }

    // Translate insertIndex (relative to active panels) into a raw _cols index.
    // We find the raw position of the insertIndex-th active panel and insert
    // before it; if insertIndex is past all active panels we append at the end.
    const targetCol = this._cols[targetCi];
    const targetActive = this._activePanels(targetCi);
    let rawIndex;
    if (insertIndex >= targetActive.length) {
      // Append after the last slot in the column.
      rawIndex = targetCol.length;
    } else {
      // Insert before the insertIndex-th active panel.
      const anchorName = targetActive[insertIndex].name;
      rawIndex = targetCol.findIndex(s => s.name === anchorName);
      if (rawIndex === -1) rawIndex = targetCol.length;
    }

    // Claim an equal share of the target column's active height.
    const nActive = targetActive.length;
    const newHf = nActive ? 1 / (nActive + 1) : 1;
    const scaleFactor = nActive ? nActive / (nActive + 1) : 1;
    targetActive.forEach(s => { s.hf *= scaleFactor; });

    targetCol.splice(rawIndex, 0, { name, hf: newHf });

    const p = this._panel(name);
    if (p) p.classList.add('panel-swapping');

    this._render();
    this._save();

    setTimeout(() => { if (p) p.classList.remove('panel-swapping'); }, 260);
  },

  // Swap two named panels in _cols — each keeps the other's hf so column
  // proportions stay stable.
  _swapPanels(nameA, nameB) {
    let slotA = null, ciA = -1, iiA = -1;
    let slotB = null, ciB = -1, iiB = -1;

    this._cols.forEach((col, ci) => {
      col.forEach((slot, ii) => {
        if (slot.name === nameA) { slotA = slot; ciA = ci; iiA = ii; }
        if (slot.name === nameB) { slotB = slot; ciB = ci; iiB = ii; }
      });
    });

    if (!slotA || !slotB) return;

    this._cols[ciA][iiA] = { name: nameB, hf: slotA.hf };
    this._cols[ciB][iiB] = { name: nameA, hf: slotB.hf };

    const pA = this._panel(nameA);
    const pB = this._panel(nameB);
    if (pA) pA.classList.add('panel-swapping');
    if (pB) pB.classList.add('panel-swapping');

    this._render();
    this._save();

    setTimeout(() => {
      if (pA) pA.classList.remove('panel-swapping');
      if (pB) pB.classList.remove('panel-swapping');
    }, 260);
  },

  // ── Resize — south edge only, adjusts panel below ───────────────────────────
  _initResize(panel) {
    if (panel._rr) return;
    panel._rr = true;

    panel.querySelectorAll('.resize-handle').forEach(handle => {
      const dir = handle.dataset.dir;
      if (dir !== 's' && dir !== 'n') return;

      handle.addEventListener('pointerdown', e => {
        if (this._isMobile || this._isTablet()) return;
        e.preventDefault(); e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        this._bringToFront(panel);

        const name = panel.dataset.panel;
        const y0   = e.clientY;
        const h0   = panel.offsetHeight;

        document.body.style.cursor = 'ns-resize';
        document.body.classList.add('is-dragging');
        panel.classList.add('panel-resizing');

        let ci = -1;
        this._cols.forEach((col, c) => {
          col.forEach(slot => { if (slot.name === name) ci = c; });
        });
        if (ci === -1) return;

        const mv = ev => {
          if (ev.pointerId !== e.pointerId) return;
          const da     = this._dataArea();
          const G      = this.GAP;
          const active = this._activePanels(ci);
          const totalH = da.height - G * (active.length - 1);
          const sumHf  = active.reduce((s, sl) => s + sl.hf, 0);
          const ai     = active.findIndex(s => s.name === name);
          if (ai === -1) return;

          const dy = ev.clientY - y0;

          if (dir === 's') {
            // South: grow/shrink this panel, compensate the panel below
            if (ai === active.length - 1) return;
            const newHf     = Math.min(sumHf - this.MIN_HF * (active.length - 1),
                                Math.max(this.MIN_HF, (h0 + dy) / totalH * sumHf));
            const nextSlot  = active[ai + 1];
            const nextNewHf = nextSlot.hf - (newHf - active[ai].hf);
            if (nextNewHf < this.MIN_HF) return;
            active[ai].hf = newHf;
            nextSlot.hf   = nextNewHf;

          } else {
            // North: grow/shrink this panel, compensate the panel above
            if (ai === 0) return;
            const newHf     = Math.min(sumHf - this.MIN_HF * (active.length - 1),
                                Math.max(this.MIN_HF, (h0 - dy) / totalH * sumHf));
            const prevSlot  = active[ai - 1];
            const prevNewHf = prevSlot.hf - (newHf - active[ai].hf);
            if (prevNewHf < this.MIN_HF) return;
            active[ai].hf = newHf;
            prevSlot.hf   = prevNewHf;
          }

          this._render();
        };

        const up = ev => {
          if (ev.pointerId !== e.pointerId) return;
          handle.removeEventListener('pointermove', mv);
          handle.removeEventListener('pointerup',   up);
          handle.removeEventListener('pointercancel', up);
          document.body.style.cursor = '';
          document.body.classList.remove('is-dragging');
          panel.classList.remove('panel-resizing');
          this._save();
        };

        handle.addEventListener('pointermove', mv);
        handle.addEventListener('pointerup',   up);
        handle.addEventListener('pointercancel', up);
      });
    });
  },

  // ── Context menu ─────────────────────────────────────────────────────────────
  _initClose(panel) {
    if (panel._cc) return;
    panel._cc = true;
    const ph = panel.querySelector('.ph');
    if (!ph) return;
    ph.addEventListener('contextmenu', e => {
      e.preventDefault(); e.stopPropagation();
      contextMenu.show(panel, e.clientX + 2, e.clientY + 2);
    });
  },

  // ── Minimize / restore ───────────────────────────────────────────────────────
  minimize(panel) {
    if (!panel) return;
    this._animOut(panel, () => {
      panel.style.display = 'none';
      this._minimized.set(panel, true);
      this._refreshRestoreBar();
      // Redistribute minimized panel's hf evenly among remaining active panels
      this._redistributeHf(panel.dataset.panel);
      this._render();
      this._save();
    });
  },

  restore(panel) {
    if (!panel) return;
    this._minimized.delete(panel);

    if (this._isMobile) {
      Object.assign(panel.style, { position:'', left:'', top:'', width:'', height:'' });
      this._main.appendChild(panel);
      panel.style.display = '';
      this._animIn(panel);
      this._refreshRestoreBar();
      this._save();
      return;
    }

    // Re-normalise hf so restored panel gets its share back
    this._normaliseHf();
    panel.style.position = 'absolute';
    panel.style.display  = '';
    this._render();
    this._bringToFront(panel);
    this._animIn(panel);
    this._refreshRestoreBar();
    this._save();
  },

  // When a panel is minimized, give its hf to its neighbours proportionally.
  _redistributeHf(name) {
    this._cols.forEach(col => {
      const idx = col.findIndex(s => s.name === name);
      if (idx === -1) return;
      const slot = col[idx];
      const active = col.filter((s, i) => i !== idx && !this._minimized.has(this._panel(s.name)));
      if (!active.length) return;
      const share = slot.hf / active.length;
      active.forEach(s => { s.hf += share; });
    });
  },

  // When a panel is restored, re-normalise all hf in its column so they sum to 1.
  _normaliseHf() {
    this._cols.forEach(col => {
      const active = col.filter(s => !this._minimized.has(this._panel(s.name)));
      if (!active.length) return;
      const sum = active.reduce((s, slot) => s + slot.hf, 0);
      if (sum === 0) {
        active.forEach(s => { s.hf = 1 / active.length; });
      } else {
        active.forEach(s => { s.hf = s.hf / sum; });
      }
    });
  },

  // ── Restore bar ──────────────────────────────────────────────────────────────
  _buildRestoreBar() {
    const bar = $('restore-bar');
    const tr  = $q('#titlebar .tr');
    if (bar && tr && !tr.contains(bar)) tr.appendChild(bar);
    this._refreshRestoreBar();
  },

  _refreshRestoreBar() {
    const el  = $('rb-chips');
    const bar = $('restore-bar');
    if (!el || !bar) return;
    el.innerHTML = '';
    if (this._minimized.size === 0) { bar.classList.add('rb-empty'); return; }
    bar.classList.remove('rb-empty');
    this._minimized.forEach((_, panel) => {
      const name = panel.dataset.panel;
      const btn  = document.createElement('button');
      btn.className   = 'rb-chip';
      btn.textContent = this._LABEL[name] || name;
      btn.title       = `Restore ${this._LABEL[name] || name}`;
      btn.addEventListener('click', () => this.restore(panel));
      el.appendChild(btn);
    });
  },

  // ── Handles ──────────────────────────────────────────────────────────────────
  _addHandles(panel) {
    if (panel._lv17) return;
    panel._lv17 = true;
    // Only two handles: south (drag bottom edge down) and north (drag top edge up).
    ['s', 'n'].forEach(d => {
      const h = document.createElement('div');
      h.className   = `resize-handle resize-${d}`;
      h.dataset.dir = d;
      panel.appendChild(h);
    });
  },

  // ── Animation ────────────────────────────────────────────────────────────────
  _animIn(p) {
    p.classList.remove('p-out');
    p.classList.add('p-spawn');
    setTimeout(() => p.classList.remove('p-spawn'), 320);
  },

  _animOut(p, cb) {
    p.classList.add('p-out');
    setTimeout(() => { p.classList.remove('p-out'); cb(); }, 180);
  },

  _bringToFront(p) { p.style.zIndex = ++this._zTop; },

  // ── Persist ──────────────────────────────────────────────────────────────────
  _save() {
    try {
      localStorage.setItem(this._LS_KEY, JSON.stringify({
        cols:      this._cols,
        minimized: Array.from(this._minimized.keys()).map(p => p.dataset.panel).filter(Boolean),
      }));
    } catch (_) {}
  },

  _loadSaved() {
    // Start from defaults
    this._cols = this._DEFAULT_COLS.map(col => col.map(s => ({ ...s })));

    try {
      const raw = localStorage.getItem(this._LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);

      // Validate saved cols: must be 4 columns, every default panel name present,
      // and every hf must be a positive number.
      if (Array.isArray(saved.cols) && saved.cols.length === 4) {
        const savedNames = saved.cols.flat().map(s => s.name).sort();
        const defNames   = this._DEFAULT_COLS.flat().map(s => s.name).sort();
        const valid = savedNames.length === defNames.length
          && savedNames.every((n, i) => n === defNames[i])
          && saved.cols.every(col => col.every(s => typeof s.hf === 'number' && s.hf > 0));
        if (valid) {
          this._cols = saved.cols.map(col => col.map(s => ({ ...s })));
        }
      }

      if (Array.isArray(saved.minimized)) {
        saved.minimized.forEach(name => {
          const p = this._panel(name);
          if (p) this._minimized.set(p, true);
        });
      }
    } catch (_) {}
  },

  // Reset: restore defaults, clear minimized state, and re-render.
  _reset() {
    this._cols = this._DEFAULT_COLS.map(col => col.map(s => ({ ...s })));
    this._minimized.clear();
    this._save();
    this._showDesktop();
    this._refreshRestoreBar();
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// TOAST STACK — persistent dismissible error notifications
// ═══════════════════════════════════════════════════════════════════════════════
const toastStack = {
  _el: null,
  _toasts: [],
  MAX: 5,

  _container() {
    if (!this._el) this._el = $('toast-stack');
    return this._el;
  },

  add(msg) {
    const el = this._container();
    if (!el) return;
    if (this._toasts.length && this._toasts[this._toasts.length - 1].msg === msg) return;
    if (this._toasts.length >= this.MAX) this._dismiss(this._toasts[0].node);

    const node = document.createElement('div');
    node.className = 'toast';
    node.innerHTML = `<span class="toast-msg">${msg.replace(/</g, '&lt;')}</span><button class="toast-dismiss" aria-label="Dismiss">×</button>`;
    node.querySelector('.toast-dismiss').addEventListener('click', () => this._dismiss(node));
    el.appendChild(node);
    this._toasts.push({ node, msg });
  },

  _dismiss(node) {
    node.remove();
    this._toasts = this._toasts.filter(t => t.node !== node);
  },

  clear() {
    const el = this._container();
    if (el) el.innerHTML = '';
    this._toasts = [];
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════════
const contextMenu = {
  _el: null,

  _getEl() {
    if (!this._el) this._el = $('ctx-menu');
    return this._el;
  },

  show(panel, x, y) {
    const el = this._getEl();
    if (!el) return;

    const isMin = layout._minimized.has(panel);
    el.innerHTML = `
      <div class="ctx-item" data-action="toggle"><span class="ctx-icon">${isMin ? '&#9672;' : '&#9634;'}</span>${isMin ? 'show panel' : 'hide panel'}</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item" data-action="reset"><span class="ctx-icon">&#8635;</span>reset layout</div>`;

    el.querySelector('[data-action="toggle"]').addEventListener('click', () => {
      isMin ? layout.restore(panel) : layout.minimize(panel);
      this.hide();
    });

    el.querySelector('[data-action="reset"]').addEventListener('click', () => {
      layout._reset();
      this.hide();
    });

    el.style.display = 'block';
    const mw = el.offsetWidth, mh = el.offsetHeight;
    el.style.left = Math.min(x, window.innerWidth - mw - 6) + 'px';
    el.style.top = Math.min(y, window.innerHeight - mh - 6) + 'px';
  },

  hide() {
    const el = this._getEl();
    if (el) el.style.display = 'none';
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// MOBILE BAR — fixed top titlebar on small screens
// ═══════════════════════════════════════════════════════════════════════════════
const mobileBar = {
  updateChain(height, synced, subversion, uptime) {
    const hEl = $('mb-height');
    if (hEl) hEl.textContent = '#' + fb(height || 0);

    const dot = $('mb-dot');
    if (dot && !dot.classList.contains('err')) dot.className = 'dot ok';

    if (subversion != null) {
      const vEl = $('mb-ver');
      if (vEl) vEl.textContent = (subversion || '').replace(/^\/|\/$/g, '');
    }

    const syncEl = $('mb-sync');
    if (syncEl) {
      syncEl.textContent = synced ? 'Synced' : 'Syncing';
      syncEl.className = 'tb-sync-badge ' + (synced ? 'synced' : 'syncing');
      syncEl.style.display = '';
    }

    const uptEl = $('mb-uptime');
    const uptSep = $('mb-uptime-sep');
    if (uptEl) {
      if (uptime) {
        uptEl.textContent = 'up ' + utils.fmtUptime(uptime);
        uptEl.style.display = '';
        if (uptSep) uptSep.style.display = '';
      } else {
        uptEl.style.display = 'none';
        if (uptSep) uptSep.style.display = 'none';
      }
    }
  },

  updateStale(age) {
    const el = $('mb-stale');
    if (!el) return;
    if (age < 30) { el.textContent = ''; el.className = ''; }
    else if (age < 60) { el.textContent = age + 's ago'; el.className = ''; }
    else { el.textContent = Math.floor(age / 60) + 'm ago'; el.className = 'warn'; }
  },

  setError() {
    setClass('mb-dot', 'dot err');
  },

  tickClock() {
    const el = $('mb-clock');
    if (el) el.textContent = new Date().toISOString().slice(0, 19).replace('T', ' ');
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// HERO STRIP — block height · next-block fee · mempool · peers
// ═══════════════════════════════════════════════════════════════════════════════
const heroStrip = {
  _setVal(id, val) {
    const el = $(id);
    if (!el) return;
    const s = String(val);
    if (el.textContent === s) return;
    el.textContent = s;
    el.classList.remove('hero-flash');
    void el.offsetWidth; // reflow to restart animation
    el.classList.add('hero-flash');
  },

  render(d) {
    const bc = d.blockchain || {};
    const ni = d.networkInfo || {};
    const mi = d.mempoolInfo || {};
    const fees = d.fees || {};
    const blocks = d.blocks || [];
    const now = Date.now() / 1000;

    this._setVal('hero-height', fb(bc.blocks || 0));

    const tipTime = blocks.length ? blocks[0].time : 0;
    const ageEl = $('hero-tip-age');
    if (ageEl) ageEl.textContent = tipTime ? utils.fmtAgeAgo(now - tipTime) : '—';

    this._setVal('hero-fee', fees.fast != null ? String(fees.fast) : '—');

    this._setVal('hero-mempool', fb(mi.size || 0));
    const mpSub = $('hero-mempool-sub');
    if (mpSub) {
      mpSub.textContent = mi.bytes
        ? utils.fmtBytes(mi.bytes) + ' · ' + f((mi.mempoolminfee || 0) * 1e5, 1) + ' min'
        : '—';
    }

    this._setVal('hero-peers', ni.connections || 0);
    const pSub = $('hero-peers-sub');
    if (pSub) {
      const cin = ni.connections_in;
      const cout = ni.connections_out;
      pSub.textContent = (cin != null && cout != null) ? cin + '↓  ' + cout + '↑' : '—';
    }

  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// POLLER — fetch, rate state, retry countdown, polling schedule
// ═══════════════════════════════════════════════════════════════════════════════
const poller = {
  _prevTotals: null,
  _prevFetchAt: null,
  _failCount: 0,
  _retryTimer: null,
  _pollTimer: null,
  _fetching: false,
  _hadSuccess: false,
  _lastSync: false,
  _lastFetchAt: null,
  _lastData: null,

  async fetchNow() {
    if (this._fetching) return;
    this._fetching = true;

    if (this._retryTimer) {
      clearInterval(this._retryTimer);
      this._retryTimer = null;
    }

    try {
      const res = await fetch('/api/data', { signal: AbortSignal.timeout(15000) });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const raw = await res.json();
      if (raw.error) throw new Error(raw.error);

      // Compute bandwidth rates
      const nt = raw.netTotals || {};
      const nowT = Date.now() / 1000;
      const totalSent = nt.totalbytessent || 0;
      const totalRecv = nt.totalbytesrecv || 0;
      let sentRate = 0, recvRate = 0;

      if (this._prevTotals && this._prevFetchAt) {
        if (totalSent >= this._prevTotals.sent && totalRecv >= this._prevTotals.recv) {
          const dt = Math.max(1, nowT - this._prevFetchAt);
          sentRate = (totalSent - this._prevTotals.sent) / dt;
          recvRate = (totalRecv - this._prevTotals.recv) / dt;
        }
      }

      this._prevTotals = { sent: totalSent, recv: totalRecv };
      this._prevFetchAt = nowT;
      network.push(sentRate, recvRate);

      this._failCount = 0;
      this._hadSuccess = true;
      this._lastFetchAt = Date.now();

      const connecting = $('connecting');
      if (connecting) connecting.style.display = 'none';

      const d = { ...raw, netIn: recvRate, netOut: sentRate, totalRecv, totalSent };
      this._lastData = d;
      renderAll(d);

    } catch (e) {
      this._failCount++;
      toastStack.add(this._friendlyError(e.message));
      console.error('[poller]', e.message);

      setClass('live-dot', 'dot err');
      mobileBar.setError();
      setText('conn-msg', this._friendlyError(e.message));

      const overlay = $('connecting');
      if (overlay && !this._hadSuccess) overlay.style.display = 'flex';

      this._startRetryCountdown(Math.min(5 * Math.pow(2, this._failCount - 1), 60));
    } finally {
      this._fetching = false;
    }
  },

  _startRetryCountdown(delay) {
    let t = delay;
    const cdEl = $('conn-countdown');
    const btn = $('conn-retry');
    if (btn) btn.style.display = 'inline-block';
    $q('.c-bg-grid')?.classList.add('paused');
    if (cdEl) cdEl.textContent = 'retrying in ' + t + 's…';

    clearInterval(this._retryTimer);
    this._retryTimer = setInterval(() => {
      t--;
      if (cdEl) cdEl.textContent = t > 0 ? 'retrying in ' + t + 's…' : 'retrying…';
      if (t <= 0) {
        clearInterval(this._retryTimer);
        this._retryTimer = null;
        if (btn) btn.style.display = 'none';
        if (cdEl) cdEl.textContent = '';
        $q('.c-bg-grid')?.classList.remove('paused');
        this.fetchNow();
      }
    }, 1000);
  },

  retryNow() {
    clearInterval(this._retryTimer);
    this._retryTimer = null;
    setText('conn-countdown', '');
    const btn = $('conn-retry');
    if (btn) btn.style.display = 'none';
    this.fetchNow();
  },

  schedule() {
    clearInterval(this._pollTimer);
    const interval = this._lastSync ? 30000 : 10000;
    this._pollTimer = setInterval(async () => {
      const prev = this._lastSync;
      await this.fetchNow();
      if (this._lastSync !== prev) this.schedule();
    }, interval);
  },

  _friendlyError(msg) {
    if (!msg) return 'Connection error';
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError')) return 'Server unreachable';
    if (msg.includes('HTTP 429')) return 'Rate limited — too many requests';
    if (msg.includes('HTTP 503') || msg.includes('503')) return 'Bitcoin node unavailable';
    if (msg.includes('HTTP 4') || msg.includes('HTTP 5')) return 'Server error (' + (msg.match(/HTTP \d+/)||[''])[0] + ')';
    if (msg.includes('timeout')) return 'Request timed out';
    if (msg.includes('JSON') || msg.includes('Parse')) return 'Invalid response from server';
    if (msg.length > 80) return msg.slice(0, 77) + '…';
    return msg;
  },

  setSync(syncing) { this._lastSync = syncing; },
  getLastFetchAt() { return this._lastFetchAt; },

  pause() {
    clearInterval(this._pollTimer);
    this._pollTimer = null;
  },

  resume() {
    this.fetchNow().then(() => this.schedule());
  },

  exportJSON() {
    if (!this._lastData) return;
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(this._lastData, null, 2)], { type: 'application/json' }));
    a.download = `blockwatch-${ts}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN THEME — apply html class + favicon + title
// ═══════════════════════════════════════════════════════════════════════════════
const chainTheme = {
  apply(chain, blockHeight) {
    const chainNameMap = { testnet4: 'testnet4', signet: 'signet', regtest: 'regtest' };
    const chainClass = 'chain-' + (chainNameMap[chain] || chain || 'main');

    const classes = [];
    if (chain && chain !== 'main') classes.push(chainClass);
    document.documentElement.className = classes.join(' ');

    // Dynamic favicon + theme-color meta
    const faviconColors = { testnet4: '#3a8fd4', signet: '#c8a820', regtest: '#9a5cc8', test: '#3a8fd4' };
    const fColor = faviconColors[chain] || '#f07020';
    const fSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${fColor}"/></svg>`;
    const fEl = $q('link[rel="icon"]') || Object.assign(document.createElement('link'), { rel: 'icon' });
    fEl.type = 'image/svg+xml';
    fEl.href = 'data:image/svg+xml,' + encodeURIComponent(fSvg);
    if (!fEl.parentNode) document.head.appendChild(fEl);

    // theme-color: tints the browser chrome on mobile to match the chain accent
    const metaColor = fColor;
    const tcEl = $q('meta[name="theme-color"]') || Object.assign(document.createElement('meta'), { name: 'theme-color' });
    tcEl.content = metaColor;
    if (!tcEl.parentNode) document.head.appendChild(tcEl);

    // Title
    const chainLabel = chain && chain !== 'main' ? ' · ' + chain : '';
    if (blockHeight) document.title = '#' + fb(blockHeight) + chainLabel + ' · blockwatch';
    else if (chainLabel) document.title = 'blockwatch' + chainLabel;

    try { localStorage.setItem('bw-chain', chain || 'main'); } catch (_) {}
  },
};


// ═══════════════════════════════════════════════════════════════════════════════
// RENDER ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════════
function safeRender(name, fn) {
  try { fn(); }
  catch (e) { console.error('[render:' + name + ']', e.message, e.stack); }
}

let _firstRender = true;

function renderAll(d) {
  poller.setSync(d.blockchain?.initialblockdownload || false);

  safeRender('hero',    () => heroStrip.render(d));
  safeRender('node',    () => nodePanel.render(d));
  safeRender('chain',   () => chainPanel.render(d));
  safeRender('network', () => network.render(d.netIn, d.netOut, d.totalRecv, d.totalSent));
  safeRender('peers',   () => peersPanel.render(d));
  safeRender('blocks',  () => blocksPanel.render(d));

  const drawCharts = () => {
    safeRender('feeHeatmap',  () => charts.feeHeatmap.draw(d.blocks || []));
    safeRender('feeSubsidy',  () => charts.feeSubsidy.draw(d.blocks || []));
    safeRender('blockTiming', () => charts.blockTiming.draw(d.blocks || []));
  };

  if (window.innerWidth < 1024) requestAnimationFrame(drawCharts);
  else drawCharts();

  if (_firstRender) {
    _firstRender = false;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// BOOT — wire events, init modules, start polling
// ═══════════════════════════════════════════════════════════════════════════════

// Restore chain theme before first fetch (applied early to avoid flash)
try {
  const savedChain = localStorage.getItem('bw-chain');
  if (savedChain && savedChain !== 'main') chainTheme.apply(savedChain);
} catch (_) {}

// Layout
layout.init();

// Charts resize observers
charts.init();

// Bandwidth chart hover
network._initHover();

// Global copy-to-clipboard delegation
document.addEventListener('click', e => {
  const el = e.target.closest('[data-copy]');
  if (!el || !el.dataset.copy) return;
  if (e.target.closest('a')) return;
  e.stopPropagation();
  utils.copyToClipboard(el.dataset.copy, el);
});


// A11y: copy icons
function a11yCopyIcons(root = document) {
  root.querySelectorAll('.copy-icon:not([role])').forEach(el => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Copy to clipboard');
  });
}
a11yCopyIcons();
new MutationObserver(() => a11yCopyIcons()).observe(document.body, { childList: true, subtree: true });

// Context menu dismiss
document.addEventListener('click', () => contextMenu.hide());



// Peer table click delegation
$('peer-table-body')?.addEventListener('click', e => {
  const row = e.target.closest('tr');
  if (!row || !row.dataset.pid) return;
  peersPanel.selectById(parseInt(row.dataset.pid, 10));
});

// Block table click delegation
$('blk-body')?.addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const row = e.target.closest('tr[data-bheight]');
  if (!row) return;
  blocksPanel.selectByHeight(parseInt(row.dataset.bheight, 10));
});

// Button listeners
$('conn-retry')?.addEventListener('click', () => poller.retryNow());
$('la-reveal-btn')?.addEventListener('click', () => nodePanel.toggleLocalAddrs());
$('peers-tsv-btn')?.addEventListener('click', () => peersPanel.exportTSV());
$('snapshot-btn')?.addEventListener('click', () => poller.exportJSON());

// Reset layout button
$('reset-layout-btn')?.addEventListener('click', () => {
  layout._reset();
});

// Peer filter
(function initPeerFilter() {
  const input = $('peer-filter');
  if (!input) return;

  input.addEventListener('input', () => {
    peersPanel._filterTerm = input.value.toLowerCase().trim();
    peersPanel._applyFilter();
  });
})();

// Ban list — immediate + every 60s
banList.refresh();
setInterval(() => banList.refresh(), 60000);

// Clock + staleness indicator — every second
setInterval(() => {
  const now = new Date();
  const iso = now.toISOString(); // e.g. "2026-03-25T14:32:07.000Z"
  const dateStr = iso.slice(0, 10);           // "2026-03-25"
  const hhmm    = iso.slice(11, 16);           // "14:32"
  const secs    = ':' + iso.slice(17, 19);     // ":07"
  const clockEl = $('clock');
  if (clockEl) {
    clockEl.innerHTML =
      '<span class="clock-date">' + dateStr + ' </span>' +
      hhmm +
      '<span class="clock-secs">' + secs + '</span>';
  }
  mobileBar.tickClock();

  const stale = $('sb-stale');
  if (!stale) return;

  const lastAt = poller.getLastFetchAt();
  if (!lastAt) { stale.textContent = ''; return; }

  const age = Math.floor((Date.now() - lastAt) / 1000);
  const dot = $('live-dot');

  if (age < 30) {
    stale.textContent = '';
    stale.className = 'sb-stale';
    if (dot && !dot.classList.contains('err')) dot.className = 'dot ok';
  } else if (age < 60) {
    stale.textContent = age + 's ago';
    stale.className = 'sb-stale';
    if (dot && !dot.classList.contains('err')) dot.className = 'dot warn';
  } else {
    stale.textContent = Math.floor(age / 60) + 'm ago';
    stale.className = 'sb-stale warn';
    if (dot) dot.className = 'dot err';
  }

  mobileBar.updateStale(age);
}, 1000);

// Tab visibility — pause polling when hidden
document.addEventListener('visibilitychange', () => {
  if (document.hidden) poller.pause();
  else poller.resume();
});

// Start
tooltipEngine.init();
poller.fetchNow().then(() => poller.schedule());

})(); // end IIFE