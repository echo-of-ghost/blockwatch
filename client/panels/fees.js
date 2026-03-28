"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · panels/fees.js
// Chain panel: fee estimates
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN MODULE — fee estimates panel
// ═══════════════════════════════════════════════════════════════════════════════
const chainPanel = {
  render(d) {
    const blocks = d.blocks || [];
    const now = Date.now() / 1000;
    setText(
      "ch-tip-age",
      blocks.length && blocks[0].time
        ? utils.fmtAgeAgo(now - blocks[0].time)
        : "—",
    );
    this._renderFees(d.fees || {});
  },

  _renderFees(fees) {
    const t = (n) => (n != null ? "target " + n + " blk" : "");
    const feeList = [
      fees.fast != null
        ? { label: "next block", rate: fees.fast, time: t(fees.fast_target) }
        : null,
      fees.med != null
        ? { label: "6 blocks", rate: fees.med, time: t(fees.med_target) }
        : null,
      fees.slow != null
        ? { label: "1 day", rate: fees.slow, time: t(fees.slow_target) }
        : null,
      fees.eco != null
        ? { label: "economy", rate: fees.eco, time: t(fees.eco_target) }
        : null,
    ].filter(Boolean);

    const el = $("fee-rows");
    if (!el) return;

    if (!feeList.length) {
      el.innerHTML =
        '<div class="fee-empty">no fee data — estimator warming up</div>';
      return;
    }

    const maxRate = Math.max(...feeList.map((e) => e.rate));
    el.innerHTML = feeList
      .map((e) => {
        const valStr = e.rate >= 1 ? f(e.rate, 0) : f(e.rate, 2);
        const pct = ((e.rate / maxRate) * 100).toFixed(1);

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
      })
      .join("");
  },
};
