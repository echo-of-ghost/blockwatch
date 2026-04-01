"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · panels/fees.js
// Chain panel: tip age
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
  },
};
