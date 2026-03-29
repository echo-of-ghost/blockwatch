"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · charts.js
// Canvas charts: fee heatmap, fee/subsidy sparkline, block timing bars
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// CHARTS MODULE — fee heatmap, fee/subsidy sparkline, block timing bars
// ═══════════════════════════════════════════════════════════════════════════════

// Shared: get accent RGB from CSS once per frame
function getAccentRgb() {
  return (
    getComputedStyle(document.documentElement).getPropertyValue(
      "--orange-rgb",
    ) || "240,112,32"
  ).trim();
}

// Shared: compute chart height (mobile-aware)
function chartHeight(panel, extras = 0) {
  if (!panel) return 0;
  const r = panel.getBoundingClientRect();
  if (r.width <= 10) return 0;

  if (window.innerWidth < 1024) {
    return Math.min(220, Math.max(160, window.innerWidth * 0.45));
  }

  const ph = panel.querySelector(".ph");
  const phH = ph ? ph.getBoundingClientRect().height : 24;
  return Math.max(20, r.height - phH - 14 - extras);
}

// Shared: set up a HiDPI canvas
function setupCanvas(canvas, W, H) {
  if (!canvas) return null;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + "px";
  canvas.style.height = H + "px";
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  // canvas.width assignment resets the backing store and clears the transform
  // stack — use resetTransform() to be explicit, then apply dpr scale once.
  ctx.resetTransform
    ? ctx.resetTransform()
    : ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, W, H);
  return ctx;
}

const charts = {
  mempoolViz: {
    _history: new Array(120).fill(0),
    _panel: null,

    draw(history) {
      if (history?.length) this._history = history;
      this._measure();
    },

    _measure() {
      const canvas = $("mp-canvas");
      if (!canvas) return;

      const panel = this._panel || (this._panel = $q('[data-panel="mempool-viz"]'));
      if (!panel) return;

      const pr = panel.getBoundingClientRect();
      if (pr.width <= 10) return;

      const ph = panel.querySelector(".ph");
      const phH = ph ? ph.getBoundingClientRect().height : 28;
      const contentH = pr.height - phH;
      const W = pr.width - 24;
      const H = Math.max(60, Math.min(220, Math.round(contentH * 0.38)));
      this._render(this._history, W, H);
    },

    _render(history, W, H) {
      const canvas = $("mp-canvas");
      const ctx = setupCanvas(canvas, W, H);
      if (!ctx || !history) return;

      const valid = history.filter((h) => h && h.size > 0);
      if (valid.length < 2) {
        setText("mp-min", "—");
        setText("mp-avg", "—");
        setText("mp-max", "—");
        ctx.restore();
        return;
      }

      const rgb = getAccentRgb();
      const sizes = valid.map((h) => h.size);
      const maxSize = Math.max(...sizes, 1);
      const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;
      const minSize = Math.min(...sizes);

      const pt = 10, pb = 6, pl = 4, pr = 12;
      const plotW = W - pl - pr;
      const plotH = H - pt - pb;
      const n = valid.length;

      const xOf = (i) => pl + (i / (n - 1)) * plotW;
      const yOf = (s) => pt + (1 - s / maxSize) * plotH;

      // Subtle horizontal grid lines
      ctx.setLineDash([2, 6]);
      ctx.lineWidth = 1;
      [0.25, 0.5, 0.75].forEach((level) => {
        const y = pt + (1 - level) * plotH;
        ctx.strokeStyle = `rgba(${rgb},0.07)`;
        ctx.beginPath();
        ctx.moveTo(pl, y);
        ctx.lineTo(W - pr, y);
        ctx.stroke();
      });
      ctx.setLineDash([]);

      // Avg line
      const avgY = yOf(avgSize);
      ctx.strokeStyle = `rgba(${rgb},0.18)`;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      ctx.moveTo(pl, avgY);
      ctx.lineTo(W - pr, avgY);
      ctx.stroke();
      ctx.setLineDash([]);

      // Build smooth bezier path
      const buildPath = () => {
        ctx.beginPath();
        ctx.moveTo(xOf(0), yOf(sizes[0]));
        for (let i = 1; i < n; i++) {
          const cpx = (xOf(i - 1) + xOf(i)) / 2;
          ctx.bezierCurveTo(cpx, yOf(sizes[i - 1]), cpx, yOf(sizes[i]), xOf(i), yOf(sizes[i]));
        }
      };

      // Glow pass
      buildPath();
      ctx.shadowColor = `rgba(${rgb},0.55)`;
      ctx.shadowBlur = 7;
      ctx.strokeStyle = `rgba(${rgb},0.5)`;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;

      // Crisp line on top
      buildPath();
      ctx.strokeStyle = `rgba(${rgb},1)`;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Beacon at the live tip (rightmost = newest)
      const lx = xOf(n - 1);
      const ly = yOf(sizes[n - 1]);

      // Outer glow rings
      [14, 8].forEach((r, i) => {
        ctx.beginPath();
        ctx.arc(lx, ly, r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${rgb},${i === 0 ? 0.06 : 0.13})`;
        ctx.fill();
      });

      // Core dot
      ctx.beginPath();
      ctx.arc(lx, ly, 2.5, 0, Math.PI * 2);
      ctx.shadowColor = `rgba(${rgb},1)`;
      ctx.shadowBlur = 8;
      ctx.fillStyle = `rgba(${rgb},1)`;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Live value label beside beacon
      const fmt = (bytes) => {
        if (bytes > 1e6) return (bytes / 1e6).toFixed(1) + "M";
        if (bytes > 1e3) return (bytes / 1e3).toFixed(1) + "K";
        return bytes.toFixed(0);
      };
      ctx.font = "10px Geist Mono, monospace";
      ctx.textAlign = "right";
      ctx.fillStyle = `rgba(${rgb},0.85)`;
      ctx.fillText(fmt(sizes[n - 1]) + "B", lx - 6, ly + 3.5);

      ctx.restore();

      setText("mp-min", "min " + fmt(minSize) + "B");
      setText("mp-max", "max " + fmt(maxSize) + "B");
      setText("mp-avg", "avg " + fmt(avgSize) + "B");
      const phEl = $("mp-ph");
      if (phEl) phEl.textContent = "mempool · " + n + " samples";
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
      const panel = this._panel || (this._panel = $("p-col2-mid"));
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      if (r.width <= 10) return;

      const legend = panel.querySelector("#bt-min")?.closest("div");
      const labelH = legend ? legend.getBoundingClientRect().height + 3 : 18;
      const H = chartHeight(panel, labelH + 3);
      if (H <= 0) return;

      this._render(this._blocks, r.width - 20 - 8, H);
    },

    _render(blocks, W, H) {
      const canvas = $("bt-canvas");
      const ctx = setupCanvas(canvas, W, H);
      if (!ctx) return;
      if (!blocks || blocks.length < 2) {
        const t4 = getComputedStyle(document.documentElement).getPropertyValue("--t4").trim() || "#555";
        ctx.fillStyle = t4;
        ctx.font = "10px Geist Mono, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("waiting for blocks…", W / 2, H / 2);
        ctx.restore();
        return;
      }

      const accentRgb = getAccentRgb();

      const gaps = [];
      for (let i = 0; i < blocks.length - 1; i++) {
        const g = (blocks[i].time - blocks[i + 1].time) / 60;
        if (g > 0 && g < 180) gaps.push({ g, current: false });
      }
      if (!gaps.length) {
        ctx.restore();
        return;
      }

      gaps.reverse();

      // Current gap (time since tip)
      if (blocks.length) {
        const sinceNow = (Date.now() / 1000 - blocks[0].time) / 60;
        if (sinceNow > 0 && sinceNow < 180)
          gaps.push({ g: sinceNow, current: true });
      }

      const gVals = gaps.map((x) => x.g);
      const completedVals = gaps.filter((x) => !x.current).map((x) => x.g);
      const maxG = Math.max(...gVals, 1);
      const minG = Math.min(...completedVals);
      const maxCompletedG = Math.max(...completedVals);
      const avgG =
        completedVals.reduce((a, b) => a + b, 0) / completedVals.length;

      const bw = Math.floor(W / gaps.length) - 1;
      const padX = Math.floor((W - gaps.length * (bw + 1)) / 2);
      const fontSize = Math.max(10, Math.min(11, Math.floor(bw * 0.7)));
      ctx.font = `${fontSize}px Geist Mono, monospace`;
      ctx.textAlign = "center";

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
            barGrad.addColorStop(0, "rgba(90,170,106,.75)");
            barGrad.addColorStop(1, "rgba(90,170,106,.35)");
          } else if (slow) {
            barGrad.addColorStop(0, "rgba(64,64,64,.6)");
            barGrad.addColorStop(1, "rgba(40,40,40,.4)");
          } else {
            barGrad.addColorStop(0, `rgba(${accentRgb},0.65)`);
            barGrad.addColorStop(1, `rgba(${accentRgb},0.30)`);
          }
          ctx.fillStyle = barGrad;
          ctx.fillRect(x, y, bw, barH);
        }

        const label = g >= 10 ? Math.round(g) + "m" : g.toFixed(1) + "m";
        const labelW = ctx.measureText(label).width;
        if (bw >= labelW + 2) {
          ctx.save();
          if (barH >= fontSize + 6) {
            ctx.fillStyle = "rgba(0,0,0,0.5)";
            ctx.fillText(label, x + bw / 2, y + fontSize + 2);
          } else {
            ctx.fillStyle = "rgba(104,104,104,0.85)";
            ctx.fillText(label, x + bw / 2, Math.max(fontSize + 1, y - 2));
          }
          ctx.restore();
        }
      });

      // 10m target line
      if (10 <= maxG) {
        const targetY = H - Math.floor((10 / maxG) * (H - 4)) - 1;
        ctx.strokeStyle = "rgba(90,90,90,0.9)";
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(0, targetY);
        ctx.lineTo(W, targetY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "10px Geist Mono, monospace";
        ctx.textAlign = "right";
        ctx.fillStyle = "rgba(90,90,90,0.8)";
        ctx.fillText("10m", W - 1, targetY - 2);
      }

      // Average line
      if (Math.abs(avgG - 10) > 0.5) {
        const avgY = H - Math.floor((avgG / maxG) * (H - 4)) - 1;
        ctx.strokeStyle = `rgba(${accentRgb},0.35)`;
        ctx.lineWidth = 1;
        ctx.setLineDash([2, 4]);
        ctx.beginPath();
        ctx.moveTo(0, avgY);
        ctx.lineTo(W, avgY);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = "10px Geist Mono, monospace";
        ctx.textAlign = "left";
        ctx.fillStyle = `rgba(${accentRgb},0.55)`;
        ctx.fillText("avg", 2, avgY - 2);
      }

      ctx.restore();

      setText("bt-min", "min " + minG.toFixed(1) + "m");
      setText("bt-max", "max " + maxCompletedG.toFixed(1) + "m");
      setText("bt-avg", "avg " + avgG.toFixed(1) + "m");
      setText("bt-ph", "last " + completedVals.length + " blocks");
    },
  },

  _resizeObservers: [],

  // Wire ResizeObservers — rAF-debounced
  init() {
    if (typeof ResizeObserver === "undefined") return;

    const observe = (panel, chart, hasData) => {
      if (!panel) return;
      let raf = null;
      const ro = new ResizeObserver(() => {
        if (!hasData()) return;
        if (panel.style.display === "none") return;
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          raf = null;
          chart._measure();
        });
      });
      ro.observe(panel);
      this._resizeObservers.push(ro);
    };

    observe($("p-col2-subsidy"), this.mempoolViz,
      () => !!$("mp-canvas") && this.mempoolViz._history.some(h => h && h.size > 0));
    observe($("p-col2-mid"), this.blockTiming,
      () => this.blockTiming._blocks.length > 0);

    const sparkPanel = $("p-col2-top");
    if (sparkPanel) {
      let raf = null;
      const ro = new ResizeObserver(() => {
        if (raf) cancelAnimationFrame(raf);
        raf = requestAnimationFrame(() => {
          raf = null;
          network._drawSpark();
        });
      });
      ro.observe(sparkPanel);
      this._resizeObservers.push(ro);
    }
  },
};
