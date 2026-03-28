"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · network.js
// Network bandwidth module, SSE listener (was polling), chain theme
// Transport layer — event-driven via ServerSentEvents
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// NETWORK MODULE — bandwidth history + rich canvas chart
// ═══════════════════════════════════════════════════════════════════════════════
const network = {
  _histSent: Array(120).fill(0),
  _histRecv: Array(120).fill(0),
  _mempoolHistory: Array(120).fill({ size: 0, txCount: 0 }),
  _hoverIdx: -1,
  _hoverRaf: null,
  _canvas: null,
  _lastW: 0,
  _lastH: 0,

  PAD_L: 52,
  PAD_R: 10,
  PAD_T: 18,
  PAD_B: 20,
  CHART_H: 110,

  push(sentRate, recvRate) {
    this._histSent.push(sentRate);
    this._histRecv.push(recvRate);
    if (this._histSent.length > 120) this._histSent.shift();
    if (this._histRecv.length > 120) this._histRecv.shift();
  },

  pushMempool(size, txCount) {
    this._mempoolHistory.push({ size, txCount });
    if (this._mempoolHistory.length > 120) this._mempoolHistory.shift();
  },

  render(netIn, netOut, totalRecv, totalSent) {
    setText("bw-up-v", utils.fmtRate(netOut || 0));
    setText("bw-dn-v", utils.fmtRate(netIn || 0));
    setText("bw-rv", utils.fmtBytes(totalRecv || 0));
    setText("bw-sn", utils.fmtBytes(totalSent || 0));
    this._drawChart();
  },

  _drawChart(hoverIdx) {
    const c = this._canvas || (this._canvas = $("spark"));
    if (!c) return;
    if (!c._bwHoverWired) this._initHover();

    const parent = c.parentElement;
    const cssW = Math.max(
      60,
      (parent?.getBoundingClientRect().width || 200) - 24,
    );
    const cssH = this.CHART_H;

    const dpr = window.devicePixelRatio || 1;
    if (cssW !== this._lastW || cssH !== this._lastH) {
      c.width = Math.round(cssW * dpr);
      c.height = Math.round(cssH * dpr);
      c.style.width = cssW + "px";
      c.style.height = cssH + "px";
      this._lastW = cssW;
      this._lastH = cssH;
    }

    const ctx = c.getContext("2d");
    if (!ctx) return;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, cssW, cssH);

    const { PAD_L, PAD_R, PAD_T, PAD_B } = this;
    const plotW = cssW - PAD_L - PAD_R;
    const plotH = cssH - PAD_T - PAD_B;

    const sent = this._histSent;
    const recv = this._histRecv;
    const N = sent.length;
    const mx = Math.max(...sent, ...recv, 1);

    const recvRgb = (
      getComputedStyle(document.documentElement).getPropertyValue(
        "--grn-rgb",
      ) || "90,170,106"
    ).trim();
    const sentRgb = (
      getComputedStyle(document.documentElement).getPropertyValue(
        "--pos-rgb",
      ) || "196,137,74"
    ).trim();

    // ── Y-axis grid + labels ──────────────────────────────────────────────
    const yTicks = this._niceYTicks(mx);
    ctx.font = "10px Geist Mono, monospace";
    ctx.textAlign = "right";

    yTicks.forEach((tick) => {
      const y = PAD_T + plotH - (tick / mx) * plotH;
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD_L, y);
      ctx.lineTo(cssW - PAD_R, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "rgba(104,104,104,0.9)";
      ctx.fillText(utils.fmtRate(tick), PAD_L - 4, y + 3);
    });

    // ── X-axis tick marks (every 10 samples = ~50s with 5s intervals) ─────
    const xOf = (i) => PAD_L + (i / (N - 1)) * plotW;
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let i = 0; i < N; i += 10) {
      const x = xOf(i);
      ctx.beginPath();
      ctx.moveTo(x, PAD_T + plotH);
      ctx.lineTo(x, PAD_T + plotH + 3);
      ctx.stroke();
    }

    // X-axis labels: "–Ns ago" at anchor points (120 samples × 5s = 10min)
    ctx.font = "10px Geist Mono, monospace";
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(64,64,64,0.9)";
    [
      { i: 0, label: "10m" },
      { i: Math.round(N * 0.5), label: "5m" },
      { i: N - 1, label: "now" },
    ].forEach(({ i, label }) => {
      ctx.fillText(label, xOf(i), cssH - 3);
    });

    // ── Area + line for each series ───────────────────────────────────────
    const drawSeries = (hist, rgb, alpha) => {
      const pts = hist.map((v, i) => ({
        x: xOf(i),
        y: PAD_T + plotH - (v / mx) * plotH,
      }));

      const grad = ctx.createLinearGradient(0, PAD_T, 0, PAD_T + plotH);
      grad.addColorStop(0, `rgba(${rgb},${(alpha * 0.32).toFixed(2)})`);
      grad.addColorStop(0.55, `rgba(${rgb},${(alpha * 0.1).toFixed(2)})`);
      grad.addColorStop(1, `rgba(${rgb},0)`);

      ctx.beginPath();
      ctx.moveTo(pts[0].x, PAD_T + plotH);
      pts.forEach((p) => ctx.lineTo(p.x, p.y));
      ctx.lineTo(pts[N - 1].x, PAD_T + plotH);
      ctx.closePath();
      ctx.fillStyle = grad;
      ctx.fill();

      ctx.beginPath();
      ctx.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length - 1; i++) {
        const mx2 = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx2, my);
      }
      ctx.lineTo(pts[N - 1].x, pts[N - 1].y);
      ctx.strokeStyle = `rgba(${rgb},${alpha.toFixed(2)})`;
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.stroke();

      return pts;
    };

    const ptsRecv = drawSeries(recv, recvRgb, 0.9);
    const ptsSent = drawSeries(sent, sentRgb, 0.72);

    // ── Live-edge dots ────────────────────────────────────────────────────
    const drawDot = (pts, rgb, alpha) => {
      const p = pts[pts.length - 1];
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${(alpha * 0.18).toFixed(2)})`;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb},${alpha.toFixed(2)})`;
      ctx.fill();
    };
    drawDot(ptsRecv, recvRgb, 0.95);
    drawDot(ptsSent, sentRgb, 0.8);

    // ── Hover crosshair ───────────────────────────────────────────────────
    const hi = hoverIdx !== undefined ? hoverIdx : this._hoverIdx;
    if (hi >= 0 && hi < N) {
      const hx = xOf(hi);

      ctx.strokeStyle = "rgba(255,255,255,0.12)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(hx, PAD_T);
      ctx.lineTo(hx, PAD_T + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      [
        { pts: ptsRecv, rgb: recvRgb },
        { pts: ptsSent, rgb: sentRgb },
      ].forEach(({ pts, rgb }) => {
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

      // Tooltip bubble (secsAgo now uses 5s per sample, not 10s)
      const recvV = recv[hi];
      const sentV = sent[hi];
      const secsAgo = (N - 1 - hi) * 5;
      const timeLabel =
        secsAgo === 0
          ? "now"
          : secsAgo < 60
            ? secsAgo + "s ago"
            : Math.round(secsAgo / 60) + "m ago";

      const line1 = `↓ ${utils.fmtRate(recvV)}  ↑ ${utils.fmtRate(sentV)}`;
      const line2 = timeLabel;

      ctx.font = "500 10px Geist Mono, monospace";
      const tw1 = ctx.measureText(line1).width;
      ctx.font = "10px Geist Mono, monospace";
      const tw2 = ctx.measureText(line2).width;
      const tw = Math.max(tw1, tw2);
      const th = 28;
      const tp = 6;

      let tx = hx + 8;
      if (tx + tw + tp * 2 > cssW - PAD_R) tx = hx - tw - tp * 2 - 8;
      const ty = PAD_T + 4;

      ctx.fillStyle = "rgba(21,21,21,0.92)";
      ctx.strokeStyle = "rgba(255,255,255,0.08)";
      ctx.lineWidth = 0.5;
      this._roundRect(ctx, tx, ty, tw + tp * 2, th, 3);
      ctx.fill();
      ctx.stroke();

      ctx.font = "500 10px Geist Mono, monospace";
      ctx.fillStyle = `rgba(${recvRgb},0.95)`;
      ctx.textAlign = "left";
      ctx.fillText(line1, tx + tp, ty + 11);
      ctx.font = "10px Geist Mono, monospace";
      ctx.fillStyle = "rgba(104,104,104,0.9)";
      ctx.fillText(line2, tx + tp, ty + 23);
    }

    ctx.restore();
  },

  _initHover() {
    const c = this._canvas || (this._canvas = $("spark"));
    if (!c || c._bwHoverWired) return;
    c._bwHoverWired = true;

    const { PAD_L, PAD_R, PAD_T, PAD_B, CHART_H } = this;

    const idxAt = (clientX) => {
      const rect = c.getBoundingClientRect();
      const relX = clientX - rect.left - PAD_L;
      const plotW = rect.width - PAD_L - PAD_R;
      const N = this._histSent.length;
      return Math.max(0, Math.min(N - 1, Math.round((relX / plotW) * (N - 1))));
    };

    c.addEventListener("mousemove", (e) => {
      this._hoverIdx = idxAt(e.clientX);
      if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = requestAnimationFrame(() => {
        this._hoverRaf = null;
        this._drawChart();
      });
    });

    c.addEventListener("mouseleave", () => {
      this._hoverIdx = -1;
      if (this._hoverRaf) cancelAnimationFrame(this._hoverRaf);
      this._hoverRaf = requestAnimationFrame(() => {
        this._hoverRaf = null;
        this._drawChart();
      });
    });
  },

  _niceYTicks(max) {
    if (max <= 0) return [0];
    const raw = max / 3;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const nice =
      [1, 2, 5, 10].map((m) => m * mag).find((m) => m >= raw) || mag * 10;
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

  _drawSpark() {
    this._drawChart();
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// POLLER — ServerSentEvents listener (replaces setInterval polling)
// ═══════════════════════════════════════════════════════════════════════════════
const poller = {
  _prevTotals: null,
  _prevFetchAt: null,
  _lastPushAt: 0,
  _failCount: 0,
  _retryTimer: null,
  _hadSuccess: false,
  _lastSync: false,
  _lastFetchAt: null,
  _lastData: null,
  _es: null,

  start() {
    this._connect();
  },

  _connect() {
    if (this._es) {
      this._es.close();
      this._es = null;
    }
    const es = new EventSource("/api/stream");
    this._es = es;
    let handled = false;

    es.onmessage = (e) => {
      try {
        this._onMessage(JSON.parse(e.data));
      } catch (err) {
        console.error("[poller] parse error", err.message);
      }
    };

    es.onerror = () => {
      if (handled) return;
      handled = true;
      es.close();
      if (this._es === es) this._es = null;
      this._onError(new Error("Server unreachable"));
    };
  },

  _onMessage(raw) {
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }

    const nt = raw.netTotals || {};
    const nowT = Date.now() / 1000;
    const totalSent = nt.totalbytessent || 0;
    const totalRecv = nt.totalbytesrecv || 0;
    let sentRate = 0,
      recvRate = 0;

    if (this._prevTotals && this._prevFetchAt) {
      if (totalSent >= this._prevTotals.sent && totalRecv >= this._prevTotals.recv) {
        const dt = Math.max(1, nowT - this._prevFetchAt);
        sentRate = (totalSent - this._prevTotals.sent) / dt;
        recvRate = (totalRecv - this._prevTotals.recv) / dt;
      }
    }

    this._prevTotals = { sent: totalSent, recv: totalRecv };
    this._prevFetchAt = nowT;

    // Push to rolling chart history only if enough time has passed (3s guard
    // prevents rapid-fire pushes from block events and scheduled events close together)
    const now = Date.now();
    if (now - this._lastPushAt >= 3000) {
      network.push(sentRate, recvRate);
      const mi = raw.mempoolInfo || {};
      network.pushMempool(mi.bytes || 0, mi.size || 0);
      this._lastPushAt = now;
    }

    this._failCount = 0;
    this._hadSuccess = true;
    this._lastFetchAt = Date.now();

    const connecting = $("connecting");
    if (connecting) connecting.style.display = "none";
    const btn = $("conn-retry");
    if (btn) btn.style.display = "none";
    setText("conn-countdown", "");
    $q(".c-bg-grid")?.classList.remove("paused");

    const d = {
      ...raw,
      netIn: recvRate,
      netOut: sentRate,
      totalRecv,
      totalSent,
    };
    this._lastData = d;
    renderAll(d);
  },

  _onError(err) {
    this._failCount++;
    toastStack.add(this._friendlyError(err.message), "warn");
    console.warn("[poller]", err.message);

    setClass("live-dot", "dot err");
    mobileBar.setError();
    setText("conn-msg", this._friendlyError(err.message));

    const overlay = $("connecting");
    if (overlay && !this._hadSuccess) overlay.style.display = "flex";

    const delay = Math.min(5 * Math.pow(2, this._failCount - 1), 60);
    this._startRetryCountdown(delay);
  },

  _startRetryCountdown(delay) {
    let t = delay;
    const cdEl = $("conn-countdown");
    const btn = $("conn-retry");
    if (btn) btn.style.display = "inline-block";
    $q(".c-bg-grid")?.classList.add("paused");
    if (cdEl) cdEl.textContent = "retrying in " + t + "s…";

    clearTimeout(this._retryTimer);
    this._retryTimer = setInterval(() => {
      t--;
      if (cdEl)
        cdEl.textContent = t > 0 ? "retrying in " + t + "s…" : "retrying…";
      if (t <= 0) {
        clearTimeout(this._retryTimer);
        this._retryTimer = null;
        if (btn) btn.style.display = "none";
        if (cdEl) cdEl.textContent = "";
        $q(".c-bg-grid")?.classList.remove("paused");
        this._connect();
      }
    }, 1000);
  },

  retryNow() {
    clearTimeout(this._retryTimer);
    this._retryTimer = null;
    setText("conn-countdown", "");
    const btn = $("conn-retry");
    if (btn) btn.style.display = "none";
    $q(".c-bg-grid")?.classList.remove("paused");
    this._connect();
  },

  fetchNow() {
    this.retryNow();
    return Promise.resolve();
  },

  schedule() {
    // no-op — scheduling now happens server-side
  },

  setSync(syncing) {
    this._lastSync = syncing;
  },

  getLastFetchAt() {
    return this._lastFetchAt;
  },

  pause() {
    if (this._es) {
      this._es.close();
      this._es = null;
    }
    if (this._retryTimer) {
      clearTimeout(this._retryTimer);
      this._retryTimer = null;
    }
  },

  resume() {
    this._connect();
  },

  exportJSON() {
    if (!this._lastData) return;
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([JSON.stringify(this._lastData, null, 2)], {
        type: "application/json",
      }),
    );
    a.download = `blockwatch-${ts}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },

  _friendlyError(msg) {
    if (!msg) return "Connection error";
    if (msg.includes("Failed to fetch") || msg.includes("NetworkError"))
      return "Server unreachable";
    if (msg.includes("HTTP 429")) return "Rate limited — too many requests";
    if (msg.includes("HTTP 503") || msg.includes("503"))
      return "Bitcoin node unavailable";
    if (msg.includes("HTTP 4") || msg.includes("HTTP 5"))
      return "Server error (" + (msg.match(/HTTP \d+/) || [""])[0] + ")";
    if (msg.includes("timeout")) return "Request timed out";
    if (msg.includes("JSON") || msg.includes("Parse"))
      return "Invalid response from server";
    if (msg.length > 80) return msg.slice(0, 77) + "…";
    return msg;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CHAIN THEME — apply html class + favicon + title
// ═══════════════════════════════════════════════════════════════════════════════
const chainTheme = {
  apply(chain, blockHeight) {
    const chainNameMap = {
      testnet4: "testnet4",
      signet: "signet",
      regtest: "regtest",
    };
    const chainClass = "chain-" + (chainNameMap[chain] || chain || "main");

    const classes = [];
    if (chain && chain !== "main") classes.push(chainClass);
    document.documentElement.className = classes.join(" ");

    const faviconColors = {
      testnet4: "#3a8fd4",
      signet: "#c8a820",
      regtest: "#9a5cc8",
      test: "#3a8fd4",
    };
    const fColor = faviconColors[chain] || "#f07020";
    const fSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><rect width="16" height="16" rx="3" fill="${fColor}"/></svg>`;
    const fEl =
      $q('link[rel="icon"]') ||
      Object.assign(document.createElement("link"), { rel: "icon" });
    fEl.type = "image/svg+xml";
    fEl.href = "data:image/svg+xml," + encodeURIComponent(fSvg);
    if (!fEl.parentNode) document.head.appendChild(fEl);

    const metaColor = fColor;
    const tcEl =
      $q('meta[name="theme-color"]') ||
      Object.assign(document.createElement("meta"), { name: "theme-color" });
    tcEl.content = metaColor;
    if (!tcEl.parentNode) document.head.appendChild(tcEl);

    const chainLabel = chain && chain !== "main" ? " · " + chain : "";
    if (blockHeight)
      document.title = "#" + fb(blockHeight) + chainLabel + " · blockwatch";
    else if (chainLabel) document.title = "blockwatch" + chainLabel;

    try {
      localStorage.setItem("bw-chain", chain || "main");
    } catch (_) {}
  },
};
