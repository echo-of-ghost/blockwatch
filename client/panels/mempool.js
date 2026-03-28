"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · panels/mempool.js
// Mempool panel — mirrors block-detail layout
// ═══════════════════════════════════════════════════════════════════════════════

const mempoolPanel = {
  _built: false,

  render(d) {
    const mi = d.mempoolInfo || {};
    const el = $("mp-body");
    if (!el) return;

    const uPct =
      mi.usage && mi.maxmempool ? (mi.usage / mi.maxmempool) * 100 : 0;
    const mpFee = mi.mempoolminfee || 0;
    const ub = mi.unbroadcastcount ?? 0;

    const fillColor =
      uPct > 75
        ? "var(--orange)"
        : uPct > 40
          ? "rgba(240,112,32,0.55)"
          : "rgba(100,100,100,0.5)";
    const fillBadgeCls =
      uPct > 75 ? "bd-fill-high" : "bd-fill-med";

    const loadedBadge =
      mi.loaded === false
        ? `<span class="fork-badge defined">loading…</span> `
        : "";

    const relayStr =
      d.minrelaytxfee != null ? f(d.minrelaytxfee * 1e5, 2) + " sat/vB" : "—";
    const incrStr =
      d.incrementalfee != null ? f(d.incrementalfee * 1e5, 2) + " sat/vB" : "—";

    setText("mp-ph", mi.size ? fb(mi.size) + " txs" : "—");

    // First render: build full structure
    if (!this._built) {
      this._built = true;
      el.innerHTML = `
      <div class="bd-header">
        <span class="bd-height" id="mp-hdr-size">${fb(mi.size || 0)}</span>
        <span class="bd-hash-wrap">
          <span id="mp-hdr-badge">${loadedBadge}</span><span id="mp-hdr-bytes">${utils.fmtBytes(mi.bytes || 0)}</span>
        </span>
      </div>

      <div class="bd-meta-row">
        <span class="bd-age" id="mp-meta-age">${
          mi.usage
            ? utils.fmtBytes(mi.usage) + " used" +
              (mi.maxmempool ? " / " + utils.fmtBytes(mi.maxmempool) : "")
            : "—"
        }${ub > 0 ? " · " + ub + " unbroadcast" : ""}</span>
        <span id="mp-meta-badge">${uPct > 40 ? `<span class="bd-fill-badge ${fillBadgeCls}">${f(uPct, 0)}% full</span>` : ""}</span>
      </div>

      <div class="bd-body">

        <div class="bd-section">
          <div class="bd-section-label">memory usage</div>
          <div class="bd-fill-track">
            <div class="bd-fill-bar" id="mp-fill-bar"
                 style="width:${Math.min(uPct, 100).toFixed(1)}%;background:${fillColor}">
            </div>
          </div>
          <div class="bd-fill-labels">
            <span id="mp-fill-used">${utils.fmtBytes(mi.usage || 0)}</span>
            <span id="mp-fill-pct" style="color:${fillColor};font-weight:600">${uPct ? f(uPct, 0) + "%" : "—"} / ${utils.fmtBytes(mi.maxmempool || 0)}</span>
          </div>
        </div>

        <div class="bd-section bd-section-chart">
          <div class="bd-section-label">tx backlog · vbytes</div>
          <canvas id="mp-canvas" style="display:block;width:100%"></canvas>
          <div class="chart-leg" style="margin-top:3px">
            <span class="chart-leg-min" id="mp-min">—</span
            ><span class="chart-leg-avg" id="mp-avg">—</span
            ><span class="chart-leg-max" id="mp-max">—</span>
          </div>
        </div>

        <div class="bd-section">
          <div class="bd-section-label">backlog</div>
          <div class="bd-kv">
            <span class="k">pending txs</span>
            <span class="v o" id="mp-bl-txs">${fb(mi.size || 0)}</span>
          </div>
          <div class="bd-kv">
            <span class="k">tx data</span>
            <span class="v dim" id="mp-bl-bytes">${utils.fmtBytes(mi.bytes || 0)}</span>
          </div>
        </div>

        <div class="bd-section">
          <div class="bd-section-label">fees</div>
          <div class="bd-kv">
            <span class="k">min fee rate</span>
            <span class="v o" id="mp-fee-min">${mpFee ? f(mpFee * 1e5, 2) + " sat/vB" : "—"}</span>
          </div>
          <div class="bd-kv">
            <span class="k">total fees</span>
            <span class="v o2" id="mp-fee-total">${mi.total_fee ? utils.fmtSats(Math.round(mi.total_fee * 1e8)) : "—"}</span>
          </div>
          <div class="bd-kv">
            <span class="k">relay · incr. fee</span>
            <span class="v" id="mp-fee-relay"><span class="dim">${relayStr}</span><span class="dim"> · ${incrStr}</span></span>
          </div>
          <div class="bd-kv" id="mp-ub-row" style="${ub > 0 ? "" : "display:none"}">
            <span class="k">unbroadcast</span>
            <span class="v o" id="mp-ub-val">${ub}</span>
          </div>
        </div>

      </div>`;

      charts.mempoolViz.draw(network._mempoolHistory);
      return;
    }

    // Subsequent renders: patch values without touching scroll position
    setText("mp-hdr-size",  fb(mi.size || 0));
    setText("mp-hdr-bytes", utils.fmtBytes(mi.bytes || 0));

    const badgeEl = $("mp-hdr-badge");
    if (badgeEl) badgeEl.innerHTML = loadedBadge;

    setText("mp-meta-age",
      (mi.usage
        ? utils.fmtBytes(mi.usage) + " used" +
          (mi.maxmempool ? " / " + utils.fmtBytes(mi.maxmempool) : "")
        : "—") + (ub > 0 ? " · " + ub + " unbroadcast" : ""));

    const metaBadge = $("mp-meta-badge");
    if (metaBadge)
      metaBadge.innerHTML = uPct > 40
        ? `<span class="bd-fill-badge ${fillBadgeCls}">${f(uPct, 0)}% full</span>`
        : "";

    setText("mp-bl-txs",   fb(mi.size || 0));
    setText("mp-bl-bytes", utils.fmtBytes(mi.bytes || 0));

    const bar = $("mp-fill-bar");
    if (bar) {
      bar.style.width      = Math.min(uPct, 100).toFixed(1) + "%";
      bar.style.background = fillColor;
    }
    setText("mp-fill-used", utils.fmtBytes(mi.usage || 0));
    const pct = $("mp-fill-pct");
    if (pct) {
      pct.style.color  = fillColor;
      pct.textContent  = (uPct ? f(uPct, 0) + "%" : "—") + " / " + utils.fmtBytes(mi.maxmempool || 0);
    }

    setText("mp-fee-min",   mpFee ? f(mpFee * 1e5, 2) + " sat/vB" : "—");
    setText("mp-fee-total", mi.total_fee ? utils.fmtSats(Math.round(mi.total_fee * 1e8)) : "—");

    const relayEl = $("mp-fee-relay");
    if (relayEl) relayEl.innerHTML =
      `<span class="dim">${relayStr}</span><span class="dim"> · ${incrStr}</span>`;

    const ubRow = $("mp-ub-row");
    if (ubRow) {
      ubRow.style.display = ub > 0 ? "" : "none";
      setText("mp-ub-val", ub);
    }

    charts.mempoolViz.draw(network._mempoolHistory);
  },

  // Called by layout when the panel is torn down (e.g. reset layout)
  reset() { this._built = false; },
};
