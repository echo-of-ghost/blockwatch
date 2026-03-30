"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · panels/node.js
// Node panel: chain info, mempool, retarget, sync progress, services
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// NODE MODULE — node panel, titlebar, mempool, retarget, sync, services
// ═══════════════════════════════════════════════════════════════════════════════
const nodePanel = {
  _currentChain: "main",
  _retargetHistory: [],
  _syncHistory: [],
  _localAddrsRevealed: false,
  _lastLocalAddrs: [],
  _avgBlockSecs: 600,
  _epochTooltipWired: false,
  _retargetState: { blocksLeft: 0, pctChange: 0 },

  get currentChain() {
    return this._currentChain;
  },

  render(d) {
    const bc = d.blockchain || {};
    const ni = d.networkInfo || {};
    const mi = d.mempoolInfo || {};
    const cts = d.chainTxStats || {};
    const blocks = d.blocks || [];
    const now = Date.now() / 1000;

    setText("mp-fullrbf", mi.fullrbf != null ? (mi.fullrbf ? "enabled" : "disabled") : "—");
    const zmqEl = $("ni-zmq");
    if (zmqEl) {
      zmqEl.textContent = d.zmqMode === "poll" ? "polling" : d.zmqMode === "zmq" ? "zmq" : "—";
    }

    this._renderTitlebar(bc, ni, d.uptime, blocks, d);
    this._renderNodeInfo(bc, ni, d.rpcNode, blocks, now);
    this._renderChainTips(d.chainTips || []);
    this._renderRetarget(bc.blocks || 0, bc.mediantime || 0, cts);
    this._renderConsensus(bc, cts);
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

    setText("tb-ver", (ni.subversion || "").replace(/^\/|\/$/g, ""));
    setText("tb-height", "#" + fb(bc.blocks || 0));

    const syncEl = $("tb-sync");
    if (syncEl) {
      syncEl.textContent = synced ? "Synced" : "Syncing";
      syncEl.className = "tb-sync-badge " + (synced ? "synced" : "syncing");
      syncEl.style.display = "";
    }

    this._currentChain = bc.chain || "main";
    chainTheme.apply(bc.chain || "main", bc.blocks || 0);

    setClass("live-dot", "dot ok");

    const warnEl = $("node-warnings");
    if (warnEl) {
      const chainWarns = Array.isArray(bc.warnings)
        ? bc.warnings.join(" ")
        : (bc.warnings || "").trim();
      const netWarns = (d.networkWarnings || "").trim();
      const warns = [chainWarns, netWarns].filter(Boolean).join(" · ");
      warnEl.textContent = warns ? "⚠ " + warns : "";
      warnEl.style.display = warns ? "block" : "none";
    }

    const tbUptime = $("tb-uptime");
    const tbUptimeSep = $("tb-uptime-sep");
    if (tbUptime) {
      if (uptime) {
        tbUptime.textContent = "up " + utils.fmtUptime(uptime);
        tbUptime.style.display = "";
        if (tbUptimeSep) tbUptimeSep.style.display = "";
      } else {
        tbUptime.style.display = "none";
        if (tbUptimeSep) tbUptimeSep.style.display = "none";
      }
    }

    mobileBar.updateChain(
      bc.blocks || 0,
      synced,
      ni.subversion || "",
      uptime || 0,
    );
  },

  _renderNodeInfo(bc, ni, rpcNode, blocks, now) {
    const synced = (bc.verificationprogress || 0) >= 0.9995;
    const pct = (bc.verificationprogress || 0) * 100;
    const chainNames = {
      main: "mainnet",
      testnet4: "testnet4",
      signet: "signet",
      regtest: "regtest",
    };
    const tipTime = blocks.length ? blocks[0].time : 0;

    setText("ni-net", chainNames[bc.chain] || bc.chain || "—");
    setText("ni-hd", fb(bc.headers || 0));

    const hdRow = $("ni-hd-row");
    if (hdRow)
      hdRow.style.display =
        bc.headers && bc.headers !== bc.blocks ? "" : "none";

    setText("ni-sync", synced ? "100%" : pct.toFixed(2) + "%");
    setText("ni-ta", tipTime ? utils.fmtAgeAgo(now - tipTime) : "—");
    setText("ni-mt", bc.mediantime ? utils.fmtTimestamp(bc.mediantime) : "—");

    // tip age status dot
    const ageSecs = tipTime ? now - tipTime : null;
    const dot = $("ni-tipage-dot");
    if (dot) {
      const cls =
        ageSecs === null
          ? "tipage-dot-unknown"
          : ageSecs < 1200
            ? "tipage-dot-ok"
            : ageSecs < 3600
              ? "tipage-dot-warn"
              : "tipage-dot-err";
      dot.className = "ni-tipage-dot " + cls;
    }

    setText("ni-sync-status", bc.initialblockdownload ? "active" : "complete");
    setText(
      "ni-pv",
      ni.protocolversion != null ? String(ni.protocolversion) : "—",
    );
    setText(
      "ni-conn",
      ni.connections != null
        ? ni.connections + (ni.maxconnections ? " / " + ni.maxconnections : "")
        : "—",
    );

    const splitEl = $("ni-conn-split");
    if (splitEl) {
      const cin = ni.connections_in;
      const cout = ni.connections_out;
      splitEl.textContent =
        cin != null && cout != null ? cin + "↓ " + cout + "↑" : "—";
    }

    setText(
      "ni-rf",
      ni.relayfee != null ? f(ni.relayfee * 1e5, 2) + " sat/vB" : "—",
    );
    setText("ni-rpc", rpcNode || "—");

    setDisplay("sync-section", bc.initialblockdownload);
  },

  _renderChainTips(tips) {
    const tipsEl = $("ni-tips");
    if (!tipsEl) return;

    if (!tips.length) {
      tipsEl.textContent = "—";
      tipsEl.className = "v dim";
      const tipListEl = $("ni-tips-list");
      if (tipListEl) tipListEl.innerHTML = "";
      return;
    }

    const active = tips.filter((t) => t.status === "active").length;
    const deepForks = tips.filter(
      (t) => t.status === "valid-fork" && t.branchlen > 1,
    );
    const orphans = tips.filter(
      (t) => t.status === "valid-fork" && t.branchlen === 1,
    );
    const validHdr = tips.filter((t) => t.status === "valid-headers");
    const invalid = tips.filter((t) => t.status === "invalid");

    if (deepForks.length) {
      tipsEl.textContent =
        deepForks.length + " fork" + (deepForks.length > 1 ? "s" : "");
      tipsEl.className = "v neg";
    } else if (invalid.length) {
      tipsEl.textContent = invalid.length + " invalid";
      tipsEl.className = "v neg";
    } else if (validHdr.length) {
      tipsEl.textContent = validHdr.length + " valid-headers";
      tipsEl.className = "v o";
    } else if (orphans.length) {
      tipsEl.textContent =
        orphans.length + " orphan" + (orphans.length > 1 ? "s" : "");
      tipsEl.className = "v dim";
    } else {
      tipsEl.textContent = active + " active";
      tipsEl.className = "v dim";
    }

    const nonActive = [...deepForks, ...invalid, ...validHdr, ...orphans];
    let tipListEl = $("ni-tips-list");
    if (!tipListEl) {
      tipListEl = document.createElement("div");
      tipListEl.id = "ni-tips-list";
      const parent = tipsEl.closest(".kv");
      if (parent) parent.after(tipListEl);
    }

    if (!nonActive.length) {
      tipListEl.innerHTML = "";
      return;
    }

    const MAX_TIPS = 4;
    const visible = nonActive.slice(0, MAX_TIPS);
    const overflow = nonActive.length - visible.length;

    const badgeCls = (t) =>
      t.status === "invalid"
        ? "failed"
        : t.status === "valid-fork" && t.branchlen > 1
          ? "failed"
          : t.status === "valid-headers"
            ? "locked"
            : "defined";

    tipListEl.innerHTML =
      `<div class="tip-list">` +
      visible
        .map((t) => {
          const hash = t.hash || "";
          const hashDisplay = hash
            ? `<span class="tip-hash-pfx">${hash.slice(0, 4)}${hash.slice(4, 8)}…</span><em>${hash.slice(-4)}</em>`
            : "—";
          const copySpan = hash
            ? `<span data-copy="${esc(hash)}" class="copy-icon">⎘</span>`
            : "";
          const branchStr =
            t.branchlen > 0
              ? `<span class="tip-branch-badge">${t.branchlen}blk</span>`
              : "";
          return `<div class="tip-card">
            <div class="tip-card-top">
              <span class="tip-card-height">#${fb(t.height || 0)}</span>
              <span class="fork-badge ${badgeCls(t)}">${esc(t.status || "")}</span>
              ${branchStr}
            </div>
            <div class="tip-card-hash">${hashDisplay}${copySpan}</div>
          </div>`;
        })
        .join("") +
      (overflow > 0
        ? `<div class="tip-overflow">+${overflow} more</div>`
        : "") +
      `</div>`;
  },

  _renderConsensus(bc, cts) {
    const diffVal = bc.difficulty || 0;
    setText("mn-df", utils.fmtDiff(diffVal));
    setText("mn-hr", utils.fmtHR(diffVal, this._avgBlockSecs));
    setText("mn-ph", utils.fmtHR(diffVal, this._avgBlockSecs));

    const cw = bc.chainwork || "";
    setText("mn-cw", cw ? "…" + cw.slice(-12) : "—");

    const cwCopy = $("mn-cw-copy");
    if (cwCopy) {
      cwCopy.dataset.copy = cw;
      cwCopy.style.display = cw ? "" : "none";
    }

    setText("mn-tps", cts.txrate ? f(cts.txrate, 2) + " tx/s" : "—");
    setText("mn-ttx", cts.txcount ? fb(cts.txcount) : "—");
  },

  _renderRetarget(height, mediantime, cts) {
    const INTERVAL = 2016;
    const TARGET = 600;
    const posInPeriod = height % INTERVAL;
    const nextRetarget = height + (INTERVAL - posInPeriod);
    const blocksLeft = nextRetarget - height;

    setText("mn-rt-blk", fb(nextRetarget));
    setText("mn-rt-left", fb(blocksLeft) + " blocks");

    // epoch progress bar
    const epochPct = ((posInPeriod / INTERVAL) * 100).toFixed(2);
    const epochFill = $("mn-epoch-fill");
    if (epochFill) epochFill.style.width = epochPct + "%";
    const epochPctEl = $("mn-epoch-pct");
    if (epochPctEl) epochPctEl.textContent = epochPct + "%";

    // store for tooltip access — updated each render pass
    this._retargetState.blocksLeft = blocksLeft;

    if (mediantime && height) {
      const periodStart = height - posInPeriod;
      if (
        this._retargetHistory.length &&
        (this._retargetHistory[0].height < periodStart || posInPeriod === 0)
      ) {
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
    setText(
      "mn-rt-date",
      estDate.toISOString().slice(0, 10) +
        " ~" +
        estDate.toISOString().slice(11, 16) +
        " UTC",
    );

    const pctChange = (TARGET / avgSec - 1) * 100;
    this._retargetState.pctChange = pctChange;
    const chgEl = $("mn-rt-chg");
    if (chgEl) {
      const sign = pctChange >= 0 ? "+" : "";
      const arrow = pctChange > 1 ? " ↑" : pctChange < -1 ? " ↓" : "";
      chgEl.textContent = sign + pctChange.toFixed(2) + "%" + arrow;
      chgEl.className =
        "v " + (pctChange > 1 ? "o" : pctChange < -1 ? "grn" : "dim");
    }

    setText("mn-rt-avg", (avgSec / 60).toFixed(2) + " min/block");

    // Wire a live tooltip on the epoch track bar (once, after the element exists)
    if (!this._epochTooltipWired) {
      const track = $("mn-epoch-track");
      if (track) {
        this._epochTooltipWired = true;
        const tipEl = document.getElementById("bw-tooltip");
        const self = this;

        function _showEpochTip(anchor) {
          if (!tipEl) return;
          const { blocksLeft, pctChange: pc } = self._retargetState;
          const sign = pc >= 0 ? "+" : "";
          const adjStr = sign + pc.toFixed(2) + "%";
          const adjClass =
            pc > 1
              ? "color:var(--orange)"
              : pc < -1
                ? "color:var(--grn)"
                : "color:var(--t3)";
          tipEl.innerHTML =
            '<span class="tip-label">epoch progress</span>' +
            '<span class="tip-body">' +
            blocksLeft.toLocaleString() +
            " blocks until retarget" +
            ' &middot; est. <span style="' +
            adjClass +
            ';font-weight:600">' +
            adjStr +
            "</span> adjustment</span>" +
            '<span class="tip-extra">Difficulty adjusts every 2016 blocks. Change is capped at \xB14\xD7 per epoch.</span>';

          tipEl.style.left = "-9999px";
          tipEl.style.top = "-9999px";
          tipEl.classList.add("tip-visible");
          tipEl.classList.remove("tip-above");

          const ar = anchor.getBoundingClientRect();
          const tw = tipEl.offsetWidth;
          const th = tipEl.offsetHeight;
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
          tipEl.style.left = left + "px";
          tipEl.style.top = top + "px";
          if (above) tipEl.classList.add("tip-above");
        }

        function _hideEpochTip() {
          if (tipEl) tipEl.classList.remove("tip-visible");
        }

        track.setAttribute("aria-describedby", "bw-tooltip");
        track.addEventListener("mouseenter", () => _showEpochTip(track));
        track.addEventListener("mouseleave", _hideEpochTip);
        track.addEventListener("focus", () => _showEpochTip(track));
        track.addEventListener("blur", _hideEpochTip);
      }
    }
  },

  _renderStorage(bc) {
    setText("ni-sz", bc.size_on_disk ? utils.fmtBytes(bc.size_on_disk) : "—");

    const prunedRow = $("ni-pruned-row");
    if (prunedRow) prunedRow.style.display = bc.pruned ? "" : "none";
    if (bc.pruned) setText("ni-pr", "yes");

    const pruneRow = $("ni-pruneheight-row");
    if (pruneRow) pruneRow.style.display = bc.pruned ? "" : "none";
    if (bc.pruned && bc.pruneheight != null)
      setText("ni-pruneheight", "#" + fb(bc.pruneheight));
  },

  _renderNetworkReachability(ni) {
    const el = $("ni-reachability");
    if (!el) return;

    const nets = ni.networks || [];
    if (!nets.length) {
      el.innerHTML = '<span class="ni-placeholder">—</span>';
      return;
    }

    const ORDER = ["ipv4", "ipv6", "onion", "i2p", "cjdns"];
    const sorted = [...nets].sort((a, b) => {
      const ai = ORDER.indexOf(a.name);
      const bi = ORDER.indexOf(b.name);
      return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
    });

    const pills = sorted
      .map((n) => {
        const reachable = n.reachable === true;
        const limited = n.limited === true && !reachable;
        const cls = reachable
          ? "reach-pill reach-pill-on"
          : limited
            ? "reach-pill reach-pill-lim"
            : "reach-pill reach-pill-off";
        const proxyTip = n.proxy ? ` title="${esc(n.proxy)}"` : "";
        return `<span class="${cls}"${proxyTip}>${esc(n.name)}</span>`;
      })
      .join("");

    el.innerHTML = `<div class="reach-pills">${pills}</div>`;
  },

  _renderServices(ni) {
    const svcs = ni.localservicesnames || [];
    setText("svc-ph", svcs.length ? svcs.length + " active" : "—");

    const grid = $("svc-grid");
    if (grid) {
      grid.innerHTML =
        '<div class="pd-svc">' +
        svcs
          .map((s) => {
            const cls = ["NETWORK", "WITNESS"].includes(s)
              ? "svc-core"
              : ["BLOOM", "COMPACT_FILTERS", "P2P_V2"].includes(s)
                ? "svc-cap"
                : "svc-ltd";
            return `<span class="${cls}">${esc(s)}</span>`;
          })
          .join("") +
        "</div>";
    }
  },

  _renderLocalAddrs(localAddresses) {
    this._lastLocalAddrs = localAddresses || [];
    const el = $("ni-localaddrs");
    if (!el) return;

    if (!this._lastLocalAddrs.length) {
      el.innerHTML =
        '<span class="ni-placeholder">not reachable / no external address</span>';
      return;
    }

    const MASK = "•••••••••••••••••••";
    el.innerHTML = this._lastLocalAddrs
      .map((a) => {
        const addr = esc(a.address || "");
        const type = addr.endsWith(".onion")
          ? "onion"
          : addr.startsWith("[") || (addr.includes(":") && !addr.includes("."))
            ? "ipv6"
            : "ipv4";
        const typeClass =
          type === "onion"
            ? "la-type-onion"
            : type === "ipv6"
              ? "la-type-ipv6"
              : "la-type-ipv4";
        const display = this._localAddrsRevealed ? addr : MASK;
        const cls = this._localAddrsRevealed ? "la-addr" : "la-addr masked";

        return `<div class="la-row">
        <span class="${cls}">${display}</span>
        <span class="la-type ${typeClass}">${type}</span>
        <span class="copy-icon" data-copy="${addr}" role="button" tabindex="0" aria-label="Copy address">⎘</span>
      </div>`;
      })
      .join("");
  },

  toggleLocalAddrs() {
    this._localAddrsRevealed = !this._localAddrsRevealed;
    const btn = $("la-reveal-btn");
    if (btn) btn.textContent = this._localAddrsRevealed ? "hide" : "reveal";
    this._renderLocalAddrs(this._lastLocalAddrs);
  },

  _updateSync(progress) {
    const now = Date.now();
    this._syncHistory.push({ progress, ts: now });
    if (this._syncHistory.length > 20) this._syncHistory.shift();

    const fill = $("sync-fill");
    const pct = progress * 100;
    if (fill) fill.style.width = pct.toFixed(2) + "%";

    if (this._syncHistory.length < 3) {
      setText("sync-eta", pct.toFixed(3) + "%");
      return;
    }

    const newest = this._syncHistory[this._syncHistory.length - 1];
    const oldest = this._syncHistory[0];
    const dp = newest.progress - oldest.progress;
    const dt = newest.ts - oldest.ts;

    if (dp <= 0 || dt <= 0) {
      setText("sync-eta", pct.toFixed(3) + "%");
      return;
    }

    const sLeft = (1 - progress) / (dp / dt) / 1000;
    let eta;
    if (sLeft < 60) eta = Math.round(sLeft) + "s";
    else if (sLeft < 3600)
      eta = Math.round(sLeft / 60) + "m " + Math.round(sLeft % 60) + "s";
    else if (sLeft < 86400)
      eta =
        Math.round(sLeft / 3600) + "h " + Math.round((sLeft % 3600) / 60) + "m";
    else
      eta =
        Math.round(sLeft / 86400) +
        "d " +
        Math.round((sLeft % 86400) / 3600) +
        "h";

    setText("sync-eta", pct.toFixed(3) + "%  · est. " + eta);
  },
};
