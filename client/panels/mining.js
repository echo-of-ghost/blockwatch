"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · panels/mining.js
// Blocks table, block detail drawer, BIP9 signalling
// ═══════════════════════════════════════════════════════════════════════════════

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

    setText("blk-ph", blocks.length ? "tip #" + fb(blocks[0].height) : "—");

    const tbody = $("blk-body");
    if (!tbody) return;

    if (ibd && !blocks.length) {
      tbody.innerHTML =
        '<tr><td colspan="6" class="ibd-placeholder">block stats unavailable during initial sync</td></tr>';
      return;
    }

    tbody.innerHTML = blocks
      .map((b, i) => {
        const isSel = b.height === this._selectedHeight;
        const isNew = this._seenHeights.size > 0 && !this._seenHeights.has(b.height) && i === 0;
        const fillPct = b.weight ? (b.weight / 4000000) * 100 : 0;
        const clr =
          fillPct >= 85
            ? "var(--grn)"
            : fillPct >= 50
              ? "var(--orange)"
              : fillPct >= 20
                ? "var(--amber)"
                : "var(--t4)";

        return `<tr class="${isNew ? "new" : ""} ${isSel ? "peer-sel" : ""}" role="row" tabindex="0" aria-selected="${isSel}" data-bheight="${b.height}">
        <td class="td-num"><a class="ext-link" href="${utils.mspaceUrl(b.hash, nodePanel.currentChain)}" target="_blank" rel="noopener noreferrer">${fb(b.height)}</a></td>
        <td class="td-hash td-hash-click" data-copy="${esc(b.hash || "")}"><span class="td-hash-prefix">${(b.hash || "").slice(0, 4)}${(b.hash || "").slice(4, 8)}…</span><em>${(b.hash || "").slice(-4)}</em></td>
        <td class="td-dim">${fb(b.txs)}</td>
        <td class="td-fill">
          <div class="blk-fill-wrap">
            <div class="blk-fill-track"><div class="blk-fill-bar" style="width:${Math.min(fillPct, 100).toFixed(1)}%;background:${clr}"></div></div>
            <span class="blk-fill-pct">${fillPct ? fillPct.toFixed(0) + "%" : "—"}</span>
          </div>
        </td>
        <td class="td-dim">${b.time ? utils.fmtAge(now - b.time) : "—"}</td>
      </tr>`;
      })
      .join("");

    blocks.forEach((b) => this._seenHeights.add(b.height));
    if (this._seenHeights.size > 200) {
      const arr = [...this._seenHeights];
      this._seenHeights = new Set(arr.slice(-200));
    }

    if (!this._initialised && blocks.length) {
      // First load only: auto-select the tip and render the detail panel.
      this._initialised = true;
      this._selectedHeight = blocks[0].height;
      this.renderDetail(blocks[0]);
    }
    // Subsequent polls leave the detail panel untouched — the user drives it.
  },

  renderDetail(b) {
    const el = $("block-detail-body");
    const ph = $("bd-ph");

    if (!b) {
      if (el) el.innerHTML = '<div class="pd-empty">—</div>';
      if (ph) ph.textContent = "latest";
      return;
    }

    if (ph) ph.textContent = "#" + fb(b.height);
    const now = Date.now() / 1000;

    // ── derived values ────────────────────────────────────────────────────────

    const fillPct = b.weight ? (b.weight / 4000000) * 100 : 0;
    const fillColor =
      fillPct >= 85
        ? "var(--grn)"
        : fillPct >= 50
          ? "var(--orange)"
          : fillPct >= 20
            ? "var(--amber)"
            : "var(--t4)";
    const fillBadgeCls =
      fillPct >= 85
        ? "bd-fill-high"
        : fillPct >= 40
          ? "bd-fill-med"
          : "bd-fill-low";

    const avgfeeStr = (() => {
      if (b.avgfeerate >= 1) return f(b.avgfeerate, 0) + " sat/vB";
      if (b.totalfee > 0 && b.size > 0)
        return f(b.totalfee / b.size, 2) + " sat/vB";
      return "—";
    })();
    const avgFeeCls = b.avgfeerate > 20 ? "o" : b.avgfeerate > 5 ? "o2" : "g";

    let era = "—";
    if (b.subsidy != null) {
      if (b.subsidy >= 5000000000) era = "1";
      else if (b.subsidy >= 2500000000) era = "2";
      else if (b.subsidy >= 1250000000) era = "3";
      else if (b.subsidy >= 625000000) era = "4";
      else if (b.subsidy >= 312500000) era = "5";
      else if (b.subsidy > 0) era = "6+";
      else era = "none";
    }

    const totalReward = (b.totalfee || 0) + (b.subsidy || 0);
    const feeRatioPct =
      totalReward > 0 ? ((b.totalfee || 0) / totalReward) * 100 : 0;
    const feeRatioStr = totalReward > 0 ? f(feeRatioPct, 2) + "%" : "—";
    const feeRatioCls = feeRatioPct > 20 ? "o" : feeRatioPct > 5 ? "o2" : "dim";

    // BIP-9 signalling
    const deployments =
      (this._lastDeploymentInfo && this._lastDeploymentInfo.deployments) || {};
    const sigBits = [];
    Object.entries(deployments).forEach(([name, fork]) => {
      if (fork.bip9 && fork.bip9.bit != null) {
        if ((b.version >>> 0) & (1 << fork.bip9.bit)) sigBits.push(name);
      }
    });
    const bip9Compliant = (b.version >>> 0) >>> 29 === 0b001;
    const sigStr = sigBits.length
      ? sigBits.map(esc).join(", ")
      : bip9Compliant
        ? "none"
        : "n/a";
    const sigCls = sigBits.length ? "o2" : "dim";

    // Fee percentile mini bar-chart
    const pctileHtml = (() => {
      const p = b.feePercentiles;
      if (!p || p.length < 5) return "";
      const vals = [p[0], p[1], p[2], p[3], p[4]];
      const max = Math.max(...vals, 1);
      const fmt = (v) => (v >= 1 ? String(Math.round(v)) : v.toFixed(1));
      const bars = vals
        .map((v, i) => {
          const h = Math.max(10, Math.round((v / max) * 100));
          const mid = i === 2;
          return `<div class="bd-pctile-bar${mid ? " bd-pctile-mid" : ""}" style="height:${h}%"></div>`;
        })
        .join("");
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
    const ageStr = b.time ? utils.fmtAgeAgo(now - b.time) : "—";
    const stampStr = b.time ? utils.fmtTimestamp(b.time) : "";
    const ageDisplay = stampStr ? `${ageStr} · ${stampStr}` : ageStr;

    // Hash display
    const hashFull = b.hash || "";
    const hashDisplay = hashFull
      ? `<span class="bd-hash-accent">${esc(hashFull.slice(0, 4))}</span>${esc(hashFull.slice(4, 8))}…${esc(hashFull.slice(-6))}`
      : "—";

    const sizeStr = b.size ? utils.fmtBytes(b.size) : "—";
    const wgtStr = b.weight ? f(b.weight / 1e6, 2) + " MWU" : "—";

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
        ${fillPct ? `<span class="bd-fill-badge ${fillBadgeCls}">${f(fillPct, 0)}% full</span>` : ""}
      </div>

      <div class="bd-body">

        <div class="bd-section">
          <div class="bd-section-label">transactions</div>
          <div class="bd-stat-grid">
            <div class="bd-stat">
              <div class="bd-stat-val bd-sv-dim">${b.txs ? fb(b.txs) : "—"}</div>
              <div class="bd-stat-lbl">total txs</div>
            </div>
            <div class="bd-stat">
              <div class="bd-stat-val bd-sv-dim">${b.ins ? fb(b.ins) : "—"}</div>
              <div class="bd-stat-lbl">inputs</div>
            </div>
            <div class="bd-stat">
              <div class="bd-stat-val bd-sv-dim">${b.outs ? fb(b.outs) : "—"}</div>
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
            <span style="color:${fillColor};font-weight:600">${fillPct ? f(fillPct, 0) + "%" : "—"} / 4 MWU</span>
          </div>
        </div>

        ${pctileHtml ? `<div class="bd-section">${pctileHtml}</div>` : ""}

        <div class="bd-section">
          <div class="bd-section-label">reward</div>
          <div class="bd-kv">
            <span class="k">avg fee rate</span>
            <span class="v ${avgFeeCls}">${esc(avgfeeStr)}</span>
          </div>
          <div class="bd-kv">
            <span class="k">total fees</span>
            <span class="v o2">${b.totalfee ? utils.fmtSats(b.totalfee) : "—"}</span>
          </div>
          <div class="bd-kv">
            <span class="k">subsidy · era</span>
            <span class="v"><span class="o">${b.subsidy != null ? f(b.subsidy / 1e8, 3) + " BTC" : "—"}</span><span class="dim"> · ${esc(era)}</span></span>
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
            <span class="v mono">0x${(b.version >>> 0).toString(16).padStart(8, "0")}${b.bits ? " · 0x" + esc(b.bits) : ""}</span>
          </div>
          <div class="bd-kv">
            <span class="k">nonce</span>
            <span class="v mono">${b.nonce != null ? fb(b.nonce) : "—"}</span>
          </div>
          <div class="bd-kv">
            <span class="k">median time</span>
            <span class="v dim">${b.mediantime ? utils.fmtTimestamp(b.mediantime) : "—"}</span>
          </div>
          <div class="bd-kv">
            <span class="k">signalling</span>
            <span class="v ${sigCls} v-wrap">${sigStr}</span>
          </div>
        </div>

      </div>`;

    this._bindHeightSearch();
  },

  selectByHeight(height) {
    this._selectedHeight = height;
    $("blk-body")
      ?.querySelectorAll("tr")
      .forEach((r) =>
        r.classList.toggle(
          "peer-sel",
          parseInt(r.dataset.bheight, 10) === height,
        ),
      );
    const b = this._cache.find((x) => x.height === height);
    if (b) this.renderDetail(b);
  },

  _searchActive: false,

  _bindHeightSearch() {
    const el = $q("#block-detail-body .bd-height");
    if (!el) return;

    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.setAttribute("aria-label", "Click to jump to a block height");

    const activate = () => {
      if (this._searchActive) return;
      this._searchActive = true;

      const height = this._selectedHeight;
      const wrap = document.createElement("span");
      wrap.className = "bd-height";
      const hash = document.createElement("span");
      hash.textContent = "#";
      const input = document.createElement("input");
      input.type = "text";
      input.className = "bd-height-input";
      input.setAttribute("aria-label", "Jump to block height");
      if (height != null) input.value = height;
      input.style.width = Math.max(5, String(height ?? "").length + 1) + "ch";
      wrap.appendChild(hash);
      wrap.appendChild(input);

      el.replaceWith(wrap);
      input.select();

      const restore = () => {
        this._searchActive = false;
        const span = document.createElement("span");
        span.className = "bd-height";
        span.style.cursor = "text";
        span.textContent = this._selectedHeight != null ? "#" + fb(this._selectedHeight) : "—";
        wrap.replaceWith(span);
        this._bindHeightSearch();
      };

      let _submitted = false;

      input.addEventListener("keydown", async (ev) => {
        if (ev.key === "Escape") { restore(); return; }
        if (ev.key !== "Enter") return;
        ev.preventDefault();
        const val = parseInt(input.value.trim(), 10);
        if (isNaN(val) || val < 0) { restore(); return; }
        _submitted = true;
        input.disabled = true;
        try {
          const res = await fetch(`/api/block/${val}`);
          const block = await res.json();
          if (block.error) throw new Error(block.error);
          this._searchActive = false;
          this._selectedHeight = block.height;
          $("blk-body")?.querySelectorAll("tr").forEach(r => r.classList.remove("peer-sel"));
          this.renderDetail(block);
        } catch (_) {
          restore();
        }
      });

      input.addEventListener("blur", () => {
        if (this._searchActive && !_submitted) restore();
      });
    };

    el.addEventListener("click", activate);
    el.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); activate(); }
    });
  },
};
