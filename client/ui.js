"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · ui.js
// Layout engine (drag/resize/persist), toast stack, context menu,
// mobile bar, hero strip
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// LAYOUT v19 — drag, resize, swap, minimize, persist
// ═══════════════════════════════════════════════════════════════════════════════
const layout = {
  // ── Constants ────────────────────────────────────────────────────────────────
  GAP: 16,
  MIN_HF: 0.04, // minimum height fraction any panel can be shrunk to
  MOBILE_BP: 768,
  COL_WF: [0.15, 0.24, 0.262, 0.348], // column width fractions

  // ── State ────────────────────────────────────────────────────────────────────
  _main: null,
  _isMobile: false,
  _minimized: new Map(), // panel el → true
  _zTop: 20,
  _cols: null, // [[{name,hf}, ...], ...] — live layout state

  // ── Labels / order ───────────────────────────────────────────────────────────
  _LABEL: {
    node: "Node",
    chain: "Chain",
    "mempool-viz": "Mempool",
    "block-timing": "Timing",
    blocks: "Blocks",
    "block-detail": "Block",
    mining: "Mining",
    peers: "Peers",
    services: "Services",
    "peer-detail": "Peer",
  },

  _MOB_ORDER: [
    "node",
    "chain",
    "blocks",
    "block-detail",
    "peers",
    "peer-detail",
    "mining",
    "mempool-viz",
    "block-timing",
    "services",
  ],

  // Default column layout: 4 columns, each panel has hf = fraction of data height.
  // All hf in a column sum to 1.0. Gaps are computed separately from data height.
  _DEFAULT_COLS: [
    [
      { name: "node", hf: 0.84 },
      { name: "services", hf: 0.16 },
    ],
    [
      { name: "chain",        hf: 0.22 },
      { name: "mempool-viz",  hf: 0.46 },
      { name: "block-timing", hf: 0.32 },
    ],
    [
      { name: "blocks", hf: 0.25 },
      { name: "block-detail", hf: 0.41 },
      { name: "mining", hf: 0.34 },
    ],
    [
      { name: "peers", hf: 0.46 },
      { name: "peer-detail", hf: 0.54 },
    ],
  ],

  _LS_KEY: "bw_layout_v44",

  // ── Geometry helpers ─────────────────────────────────────────────────────────

  // Returns the pixel geometry of the data area (below chrome).
  _dataArea() {
    const G = this.GAP;
    const W = this._main.offsetWidth || window.innerWidth;
    const H = this._main.offsetHeight || window.innerHeight;
    const tbH = $("titlebar")?.offsetHeight || 40;
    const heroH = $("hero")?.offsetHeight || 60;
    const top = G + tbH + 8 + heroH + G; // yData
    const left = G;
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
    for (let i = 0; i < ci; i++)
      x += Math.floor(panelSpace * this.COL_WF[i]) + G;

    // Last column gets the remaining space to absorb floor() rounding drift
    const w =
      ci === nCols - 1
        ? da.left + da.width - x
        : Math.floor(panelSpace * this.COL_WF[ci]);

    return { x, w };
  },

  // ── Active panels in a column (excluding minimized) ──────────────────────────
  _activePanels(ci) {
    return this._cols[ci].filter(
      (slot) => !this._minimized.has(this._panel(slot.name)),
    );
  },

  _panel(name) {
    return $q(`[data-panel="${name}"]`);
  },
  _allPanels() {
    return Array.from($$("[data-panel]"));
  },
  _checkMobile() {
    this._isMobile = window.innerWidth < this.MOBILE_BP;
  },
  _isTablet() {
    return window.innerWidth >= this.MOBILE_BP && window.innerWidth < 1024;
  },

  // ── Chrome (titlebar + hero) ─────────────────────────────────────────────────
  _positionChrome() {
    const G = this.GAP;
    const W = this._main.offsetWidth || window.innerWidth;
    const H = this._main.offsetHeight || window.innerHeight;
    const tbH = $("titlebar")?.offsetHeight || 40;
    const heroH = $("hero")?.offsetHeight || 60;

    const tb = $("titlebar");
    if (tb)
      Object.assign(tb.style, {
        position: "absolute",
        display: "",
        left: G + "px",
        top: G + "px",
        width: W - G * 2 + "px",
        height: tbH + "px",
      });

    const hero = $("hero");
    if (hero)
      Object.assign(hero.style, {
        position: "absolute",
        display: "",
        left: G + "px",
        top: G + tbH + 8 + "px",
        width: W - G * 2 + "px",
        height: heroH + "px",
      });
  },

  // ── Core render: lay out all columns from _cols state ────────────────────────
  // Placement is owned by the fluid engine (client/fluid.js), which animates
  // toward the layout this module decides. _renderPanels is the direct writer
  // it falls back to when the engine is unavailable or disengaged.
  _render() {
    if (typeof fluid !== "undefined" && fluid.active) return fluid.request();
    this._renderPanels();
  },

  _renderPanels() {
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
        const h =
          i === active.length - 1
            ? da.top + da.height - cursor
            : Math.round((slot.hf / sumHf) * totalH);

        Object.assign(p.style, {
          position: "absolute",
          display: "",
          left: colX + "px",
          top: cursor + "px",
          width: colW + "px",
          height: h + "px",
        });
        cursor += h + G;
      });
    });
  },

  // ── Init ─────────────────────────────────────────────────────────────────────
  init() {
    this._main = $("main");
    if (!this._main) return;

    this._main.classList.add("main-hidden");
    this._checkMobile();
    this._buildRestoreBar();

    // Initialise interaction on every data panel
    this._allPanels().forEach((p) => {
      const name = p.dataset.panel;
      if (name === "titlebar" || name === "hero" || name === "statusbar")
        return;
      this._addHandles(p);
      this._initClose(p);
      p.style.display = "none";
    });

    this._loadSaved();

    const tryShow = (n) => {
      if (window.innerWidth > 0 || n >= 20) {
        this._isMobile ? this._showMobile() : this._showDesktop();
        this._refreshRestoreBar();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            this._main.classList.remove("main-hidden");
          }),
        );
      } else {
        requestAnimationFrame(() => tryShow(n + 1));
      }
    };
    requestAnimationFrame(() => tryShow(0));

    let resizeTimer;
    window.addEventListener("resize", () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        const wasMobile = this._isMobile;
        const wasTablet = this._isTablet();
        this._checkMobile();
        const nowTablet = this._isTablet();

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
          this._allPanels().forEach((p) => {
            if (["titlebar", "hero", "statusbar"].includes(p.dataset.panel))
              return;
            Object.assign(p.style, {
              position: "",
              left: "",
              top: "",
              width: "",
              height: "",
            });
          });
        }
      }, 60);
    });

    if (!this._panelObs) {
      this._panelObs = new MutationObserver(() => {
        this._allPanels().forEach((p) => {
          if (p._lv17 && p._cc) return;
          this._addHandles(p);
          this._initClose(p);
        });
      });
      this._panelObs.observe(this._main, { childList: true, subtree: true });
    }
  },

  _clearShellStyles() {
    ["app", "main", "titlebar", "hero", "statusbar"].forEach((id) => {
      const el = $(id);
      if (el) el.removeAttribute("style");
    });
  },

  _showDesktop() {
    this._main.classList.remove("main-mobile");
    if (this._isTablet()) {
      this._clearShellStyles();
      this._allPanels().forEach((p) => {
        if (["titlebar", "hero", "statusbar"].includes(p.dataset.panel)) return;
        if (this._minimized.has(p)) return;
        Object.assign(p.style, {
          position: "",
          left: "",
          top: "",
          width: "",
          height: "",
          zIndex: "",
        });
        p.style.display = "";
      });
      return;
    }
    this._positionChrome();
    this._render();
  },

  _showMobile() {
    this._clearShellStyles();
    this._main.classList.add("main-mobile");
    const ordered = this._MOB_ORDER
      .map((n) => this._panel(n))
      .filter((p) => p && !this._minimized.has(p));
    this._allPanels().forEach((p) => {
      if (!ordered.includes(p) && !this._minimized.has(p)) ordered.push(p);
    });
    ordered.forEach((p) => {
      Object.assign(p.style, {
        position: "",
        left: "",
        top: "",
        width: "",
        height: "",
        zIndex: "",
      });
      p.style.display = "";
      this._main.appendChild(p);
    });
  },

  _initClose(panel) {
    if (panel._cc) return;
    panel._cc = true;
    const ph = panel.querySelector(".ph");
    if (!ph) return;
    ph.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      contextMenu.show(panel, e.clientX + 2, e.clientY + 2);
    });
  },

  // ── Minimize / restore ───────────────────────────────────────────────────────
  minimize(panel) {
    if (!panel) return;
    this._animOut(panel, () => {
      panel.style.display = "none";
      this._minimized.set(panel, true);
      this._refreshRestoreBar();
      // Redistribute minimized panel's hf evenly among remaining active panels
      this._redistributeHf(panel.dataset.panel);
      // A hidden panel keeps a stale animated position; drop it so the next
      // reveal re-seeds from the solver instead of flying in from nowhere.
      if (typeof fluid !== "undefined" && fluid.active) fluid.forget(panel);
      this._render();
      this._save();
    });
  },

  restore(panel) {
    if (!panel) return;
    // A hide may still be animating; its callback would re-hide this panel.
    this._cancelAnimOut(panel);
    this._minimized.delete(panel);

    if (this._isMobile) {
      Object.assign(panel.style, {
        position: "",
        left: "",
        top: "",
        width: "",
        height: "",
      });
      this._main.appendChild(panel);
      panel.style.display = "";
      this._animIn(panel);
      this._refreshRestoreBar();
      this._save();
      return;
    }

    // Re-normalise hf so restored panel gets its share back
    this._normaliseHf();
    panel.style.position = "absolute";
    // The engine positions by transform on top of left/top:0, so revealing a
    // panel before it has one renders it at the container origin for a frame.
    // reveal() places it first, then shows it.
    if (typeof fluid !== "undefined" && fluid.active) {
      fluid.reveal(panel);
    } else {
      panel.style.display = "";
      this._render();
    }
    this._bringToFront(panel);
    this._animIn(panel);
    this._refreshRestoreBar();
    this._save();
  },

  // When a panel is minimized, give its hf to its neighbours proportionally.
  _redistributeHf(name) {
    this._cols.forEach((col) => {
      const idx = col.findIndex((s) => s.name === name);
      if (idx === -1) return;
      const slot = col[idx];
      const active = col.filter(
        (s, i) => i !== idx && !this._minimized.has(this._panel(s.name)),
      );
      if (!active.length) return;
      const share = slot.hf / active.length;
      active.forEach((s) => {
        s.hf += share;
      });
    });
  },

  // When a panel is restored, re-normalise all hf in its column so they sum to 1.
  _normaliseHf() {
    this._cols.forEach((col) => {
      const active = col.filter(
        (s) => !this._minimized.has(this._panel(s.name)),
      );
      if (!active.length) return;
      const sum = active.reduce((s, slot) => s + slot.hf, 0);
      if (sum === 0) {
        active.forEach((s) => {
          s.hf = 1 / active.length;
        });
      } else {
        active.forEach((s) => {
          s.hf = s.hf / sum;
        });
      }
    });
  },

  // ── Restore bar ──────────────────────────────────────────────────────────────
  _buildRestoreBar() {
    const bar = $("restore-bar");
    const tr = $q("#titlebar .tr");
    if (bar && tr && !tr.contains(bar)) tr.appendChild(bar);
    this._refreshRestoreBar();
  },

  _refreshRestoreBar() {
    const el = $("rb-chips");
    const bar = $("restore-bar");
    if (!el || !bar) return;
    el.innerHTML = "";
    if (this._minimized.size === 0) {
      bar.classList.add("rb-empty");
      return;
    }
    bar.classList.remove("rb-empty");
    this._minimized.forEach((_, panel) => {
      const name = panel.dataset.panel;
      const btn = document.createElement("button");
      btn.className = "rb-chip";
      btn.textContent = this._LABEL[name] || name;
      btn.addEventListener("click", () => this.restore(panel));
      el.appendChild(btn);
    });
  },

  // ── Handles ──────────────────────────────────────────────────────────────────
  _addHandles(panel) {
    if (panel._lv17) return;
    panel._lv17 = true;
    // Only two handles: south (drag bottom edge down) and north (drag top edge up).
    ["s", "n"].forEach((d) => {
      const h = document.createElement("div");
      h.className = `resize-handle resize-${d}`;
      h.dataset.dir = d;
      panel.appendChild(h);
    });
  },

  // ── Animation ────────────────────────────────────────────────────────────────
  _animIn(p) {
    p.classList.remove("p-out");
    p.classList.add("p-spawn");
    setTimeout(() => p.classList.remove("p-spawn"), 320);
  },

  // The hide animation's completion callback is what actually minimizes the
  // panel, so it has to be cancellable. Without this, resetting the layout (or
  // restoring the panel) during the 180ms animation left the callback to fire
  // afterwards and hide a panel the user had just brought back.
  _outTimers: new Map(),

  _animOut(p, cb) {
    p.classList.add("p-out");
    this._cancelAnimOut(p);
    const t = setTimeout(() => {
      this._outTimers.delete(p);
      p.classList.remove("p-out");
      cb();
    }, 180);
    this._outTimers.set(p, t);
  },

  // Abandons a hide that is still animating: the panel stays visible and the
  // bookkeeping in the callback never runs.
  _cancelAnimOut(p) {
    const t = this._outTimers.get(p);
    if (t === undefined) return;
    clearTimeout(t);
    this._outTimers.delete(p);
    p.classList.remove("p-out");
  },

  _bringToFront(p) {
    // Drop ghosts sit at z:50/51. If _zTop climbs past them panels cover the
    // swap highlight. Compact all panel z-indexes back to the base range before
    // that happens so ghosts are always visible during drag.
    if (this._zTop >= 48) {
      const panels = this._allPanels().filter(
        q => !['titlebar','hero','statusbar'].includes(q.dataset.panel)
      );
      const sorted = [...panels].sort(
        (a, b) => (parseInt(a.style.zIndex) || 10) - (parseInt(b.style.zIndex) || 10)
      );
      sorted.forEach((q, i) => { q.style.zIndex = 11 + i; });
      this._zTop = 10 + panels.length;
    }
    p.style.zIndex = ++this._zTop;
  },

  // ── Persist ──────────────────────────────────────────────────────────────────
  _save() {
    try {
      localStorage.setItem(
        this._LS_KEY,
        JSON.stringify({
          cols: this._cols,
          minimized: Array.from(this._minimized.keys())
            .map((p) => p.dataset.panel)
            .filter(Boolean),
        }),
      );
    } catch (_) {}
  },

  _loadSaved() {
    // Start from defaults
    this._cols = this._DEFAULT_COLS.map((col) => col.map((s) => ({ ...s })));

    try {
      const raw = localStorage.getItem(this._LS_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);

      // Validate saved cols: must be 4 columns, every default panel name present,
      // and every hf must be a positive number.
      if (Array.isArray(saved.cols) && saved.cols.length === 4) {
        const savedNames = saved.cols
          .flat()
          .map((s) => s.name)
          .sort();
        const defNames = this._DEFAULT_COLS
          .flat()
          .map((s) => s.name)
          .sort();
        const valid =
          savedNames.length === defNames.length &&
          savedNames.every((n, i) => n === defNames[i]) &&
          saved.cols.every((col) =>
            col.every((s) => typeof s.hf === "number" && s.hf > 0),
          );
        if (valid) {
          this._cols = saved.cols.map((col) => col.map((s) => ({ ...s })));
        }
      }

      if (Array.isArray(saved.minimized)) {
        saved.minimized.forEach((name) => {
          const p = this._panel(name);
          if (p) this._minimized.set(p, true);
        });
      }
    } catch (_) {}
  },

  // Reset: restore defaults, clear minimized state, and re-render.
  _reset() {
    // Reset means every panel is shown, including any that is part-way through
    // its hide animation. Clearing _minimized is not enough on its own: the
    // pending callback would add it straight back.
    this._allPanels().forEach((p) => this._cancelAnimOut(p));
    this._cols = this._DEFAULT_COLS.map((col) => col.map((s) => ({ ...s })));
    this._minimized.clear();
    this._save();
    this._showDesktop();
    this._refreshRestoreBar();
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// TOAST STACK — persistent dismissible error notifications
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// ROVING TABINDEX — a data table is one tab stop, not one per row
// ═══════════════════════════════════════════════════════════════════════════════
//
// Both tables already navigate with the arrow keys (see the handlers in
// boot.js), but every row also carried tabindex="0". That put 52 rows into the
// tab order out of 125 stops in the whole application: reaching the peer filter
// from the titlebar took roughly eighty presses, and Tab could not be used to
// move between panels at all.
//
// This is the other half of the standard grid pattern. Exactly one row in each
// table is tabbable, Tab moves past the table in a single press, and the arrow
// keys move within it.
const rovingRows = {
  // Re-applied after every render, because both tables rebuild their tbody
  // from innerHTML on each poll.
  sync(tbody) {
    if (!tbody) return;
    const rows = tbody.querySelectorAll("tr[data-pid], tr[data-bheight]");
    if (!rows.length) return;
    // Follow the selection, so re-entering the table lands where the user was.
    const active = tbody.querySelector("tr.peer-sel") || rows[0];
    for (const r of rows) r.tabIndex = r === active ? 0 : -1;
  },

  // Called as the arrow keys move focus, so the tab stop travels with it.
  moveTo(row) {
    const tbody = row && row.parentElement;
    if (!tbody) return;
    for (const r of tbody.children) if (r.tagName === "TR") r.tabIndex = -1;
    row.tabIndex = 0;
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// NODE STATE — is Bitcoin Core actually answering?
// ═══════════════════════════════════════════════════════════════════════════════
//
// /api/data answers 200 with an `error` field and zero-filled structures when
// the server cannot reach bitcoind. Rendering those zeros is worse than
// rendering nothing: the dashboard reported block height 0, 0 peers,
// "0.00% SYNCED" and a retarget estimate extrapolated from no data, all under a
// titlebar badge reading "Syncing". Every number on screen was false, and
// nothing said so.
//
// The rule is: unknown is shown as unknown. renderAll skips the panels entirely
// while Core is unreachable, so the last values that were actually true stay on
// screen (or the "—" placeholders do, on a cold start), and this module says
// plainly that they are no longer live.
const nodeState = {
  _down: false,
  _reason: null,
  _toast: null,

  isDown() {
    return this._down;
  },

  down(reason, detail) {
    this._reason = detail || reason || "Bitcoin Core is not responding";
    if (this._down) return;
    this._down = true;
    document.body.classList.add("node-down");
    for (const id of ["tb-sync", "mb-sync"]) {
      const el = $(id);
      if (!el) continue;
      el.textContent = "Unreachable";
      el.className = "tb-sync-badge down";
      // Progressive disclosure: the badge stays short, the raw RPC error is a
      // hover away for anyone who wants it.
      el.title = this._reason;
      el.style.display = "";
    }
    setClass("live-dot", "dot err");
    setClass("mb-dot", "dot err");
    this._toast = toastStack.add(
      "Cannot reach Bitcoin Core — " + this._explain(),
      "error",
      { sticky: true },
    );
  },

  up() {
    if (!this._down) return;
    this._down = false;
    this._reason = null;
    document.body.classList.remove("node-down");
    for (const id of ["tb-sync", "mb-sync"]) {
      const el = $(id);
      if (el) el.removeAttribute("title");
    }
    // The condition is over, so its notice goes with it.
    if (this._toast) {
      toastStack._dismiss(this._toast);
      this._toast = null;
    }
    toastStack.add("Reconnected to Bitcoin Core", "info");
  },

  // Turn the transport failure into something a person can act on. The full
  // message is still on the badge's title.
  _explain() {
    const r = String(this._reason || "");
    if (/ECONNREFUSED/i.test(r)) return "connection refused. Is bitcoind running?";
    if (/EHOSTUNREACH|ENETUNREACH|ENOTFOUND/i.test(r)) return "host unreachable";
    if (/timeout|ETIMEDOUT/i.test(r)) return "the node stopped responding";
    if (/401|Unauthorized|credentials|cookie/i.test(r)) return "authentication was rejected";
    if (/in warmup|Loading block index|Verifying blocks/i.test(r)) return "it is still starting up";
    return "RPC is unavailable";
  },
};

const toastStack = {
  _el: null,
  _toasts: [],
  MAX: 5,

  _container() {
    if (!this._el) this._el = $("toast-stack");
    return this._el;
  },

  // `sticky` is for conditions rather than events. A node that has gone away is
  // not a momentary occurrence, and a five-second toast means anyone who looks
  // ten seconds later gets a red badge with no explanation of what happened.
  add(msg, level = "error", { sticky = false } = {}) {
    const el = this._container();
    if (!el) return;
    if (
      this._toasts.length &&
      this._toasts[this._toasts.length - 1].msg === msg
    )
      return;
    if (this._toasts.length >= this.MAX) this._dismiss(this._toasts[0].node);

    const node = document.createElement("div");
    const lvlClass = level === "warn" ? " toast-warn" : level === "info" ? " toast-info" : "";
    node.className = "toast" + lvlClass;
    node.innerHTML = `<span class="toast-msg">${msg.replace(/</g, "&lt;")}</span><button class="toast-dismiss" aria-label="Dismiss">×</button>`;
    node
      .querySelector(".toast-dismiss")
      .addEventListener("click", () => this._dismiss(node));
    el.appendChild(node);
    const entry = { node, msg };
    this._toasts.push(entry);

    // auto-dismiss after 5 s — unless the toast describes a state that is still
    // true, in which case it stays until the state resolves or it is dismissed.
    if (!sticky) entry._timer = setTimeout(() => this._dismissFade(node), 5000);
    entry.sticky = sticky;
    return node;
  },

  _dismissFade(node) {
    node.classList.add("toast-dying");
    setTimeout(() => this._dismiss(node), 200);
  },

  _dismiss(node) {
    const entry = this._toasts.find((t) => t.node === node);
    if (entry?._timer) clearTimeout(entry._timer);
    node.remove();
    this._toasts = this._toasts.filter((t) => t.node !== node);
  },

  clear() {
    const el = this._container();
    if (el) el.innerHTML = "";
    this._toasts = [];
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT MENU
// ═══════════════════════════════════════════════════════════════════════════════
const contextMenu = {
  _el: null,
  _panel: null,
  _trigger: null,

  _getEl() {
    if (!this._el) {
      this._el = $("ctx-menu");
      if (this._el) {
        this._el.addEventListener("click", (e) => {
          const item = e.target.closest("[data-action]");
          if (!item) return;
          if (item.dataset.action === "toggle") {
            const isMin = layout._minimized.has(this._panel);
            isMin ? layout.restore(this._panel) : layout.minimize(this._panel);
          } else if (item.dataset.action === "terminal") {
            terminalDrawer.show();
          } else if (item.dataset.action === "reset") {
            layout._reset();
          }
          this.hide();
        });
      }
    }
    return this._el;
  },

  show(panel, x, y) {
    const el = this._getEl();
    if (!el) return;

    this._panel = panel;
    const isMin = layout._minimized.has(panel);
    el.innerHTML = `
      <div class="ctx-item" role="menuitem" tabindex="-1" data-action="toggle"><span class="ctx-icon">${isMin ? "&#9672;" : "&#9634;"}</span>${isMin ? "show panel" : "hide panel"}</div>
      <div class="ctx-sep" role="separator"></div><div class="ctx-item" role="menuitem" tabindex="-1" data-action="terminal"><span class="ctx-icon">›</span>open terminal</div>
      <div class="ctx-sep" role="separator"></div>
      <div class="ctx-item danger" role="menuitem" tabindex="-1" data-action="reset"><span class="ctx-icon">&#8635;</span>reset layout</div>`;

    el.style.display = "block";
    const mw = el.offsetWidth,
      mh = el.offsetHeight;
    el.style.left = Math.min(x, window.innerWidth - mw - 6) + "px";
    el.style.top = Math.min(y, window.innerHeight - mh - 6) + "px";
    this._arm(el, panel);
  },

  // Shared by both entry points: label the menu, remember where focus came
  // from, and put focus on the first item so the keyboard can take over.
  _arm(el, panel) {
    el.setAttribute("role", "menu");
    el.setAttribute("aria-label", panel ? "Panel actions" : "Actions");
    this._trigger = document.activeElement;
    const first = el.querySelector('[role="menuitem"]');
    if (first) {
      try { first.focus({ preventScroll: true }); } catch (_) { first.focus(); }
    }
  },

  // Arrow keys move, Enter/Space activate, Escape closes. Without this the menu
  // had no role, no focusable items and no key handling at all — it could only
  // ever be operated with a mouse.
  _onKey(e) {
    const el = this._el;
    if (!el || el.style.display === "none") return;
    const items = [...el.querySelectorAll('[role="menuitem"]')];
    if (!items.length) return;
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const next = e.key === "ArrowDown"
        ? items[(i + 1 + items.length) % items.length]
        : items[(i - 1 + items.length) % items.length];
      next.focus();
    } else if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      (e.key === "Home" ? items[0] : items[items.length - 1]).focus();
    } else if (e.key === "Enter" || e.key === " ") {
      if (i < 0) return;
      e.preventDefault();
      items[i].click();
    } else if (e.key === "Tab") {
      // A menu is not part of the page's tab sequence.
      e.preventDefault();
      this.hide();
    }
  },

  hide() {
    const el = this._getEl();
    if (el) el.style.display = "none";
    // Give focus back to whatever opened the menu, rather than leaving it on a
    // hidden element.
    const t = this._trigger;
    this._trigger = null;
    if (t && document.contains(t)) {
      try { t.focus({ preventScroll: true }); } catch (_) { t.focus(); }
    }
  },

  initGlobal() {
    document.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".ph")) return; // panel header has its own handler
      e.preventDefault();
      const el = this._getEl();
      if (!el) return;
      this._panel = null;
      el.innerHTML = `<div class="ctx-item" role="menuitem" tabindex="-1" data-action="terminal"><span class="ctx-icon">›</span>open terminal</div>`;
      el.style.display = "block";
      el.style.left = Math.min(e.clientX + 2, window.innerWidth - el.offsetWidth - 6) + "px";
      el.style.top = Math.min(e.clientY + 2, window.innerHeight - el.offsetHeight - 6) + "px";
      this._arm(el, null);
    });

    // Capture, so the menu's own keys win over the panel-level handlers behind
    // it while it is open.
    document.addEventListener("keydown", (e) => this._onKey(e), true);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// MOBILE BAR — fixed top titlebar on small screens
// ═══════════════════════════════════════════════════════════════════════════════
const mobileBar = {
  updateChain(height, synced, subversion, uptime) {
    const hEl = $("mb-height");
    if (hEl) hEl.textContent = "#" + fb(height || 0);

    const dot = $("mb-dot");
    if (dot && !dot.classList.contains("err")) dot.className = "dot ok";

    if (subversion != null) {
      const vEl = $("mb-ver");
      if (vEl) vEl.textContent = (subversion || "").replace(/^\/|\/$/g, "");
    }

    const syncEl = $("mb-sync");
    if (syncEl) {
      syncEl.textContent = synced ? "Synced" : "Syncing";
      syncEl.className = "tb-sync-badge " + (synced ? "synced" : "syncing");
      syncEl.style.display = "";
    }

    const uptEl = $("mb-uptime");
    const uptSep = $("mb-uptime-sep");
    if (uptEl) {
      if (uptime) {
        uptEl.textContent = "up " + utils.fmtUptime(uptime);
        uptEl.style.display = "";
        if (uptSep) uptSep.style.display = "";
      } else {
        uptEl.style.display = "none";
        if (uptSep) uptSep.style.display = "none";
      }
    }
  },

  updateStale(age) {
    const el = $("mb-stale");
    if (!el) return;
    if (age < 30) {
      el.textContent = "";
      el.className = "";
    } else if (age < 60) {
      el.textContent = age + "s ago";
      el.className = "";
    } else {
      el.textContent = Math.floor(age / 60) + "m ago";
      el.className = "warn";
    }
  },

  setError() {
    setClass("mb-dot", "dot err");
  },

  tickClock() {
    const el = $("mb-clock");
    if (el)
      el.textContent = new Date().toISOString().slice(0, 19).replace("T", " ");
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// HERO STRIP — block height · next-block fee · mempool · peers
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SHORTCUTS OVERLAY
// Nearly everything powerful here is invisible: the terminal, panel drag and
// hide, arrow-key table navigation, the block-height jump, the label tooltips.
// This sheet is the one place that says so.
//
// The list is maintained beside the handlers it documents, in this file and in
// boot.js, because a shortcuts sheet that drifts out of date is worse than no
// sheet at all. Every entry below is verified against the live app in the
// discoverability test suite.
// ═══════════════════════════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════════════════════════
// SETTINGS OVERLAY
// Settings previously had no home at all — sound, chain and tooltip state were
// each toggled by their own control and written straight to localStorage. The
// explorer target is the first setting with no natural control to hang off, so
// it gets a sheet, and that sheet is where later settings go.
// ═══════════════════════════════════════════════════════════════════════════════
// The elements Tab will actually visit inside `root`, in order.
//
// Two corrections over a naive querySelectorAll, both of which broke the
// settings dialog's focus trap:
//
//   - A radio group is ONE tab stop, not one per radio: the browser tabs to the
//     checked radio (or the first, if none is checked) and uses the arrow keys
//     to move within the group. Listing all three made the trap compute a `last`
//     element that Tab never reached, so the boundary never fired and focus
//     escaped the "modal" dialog into the dashboard behind it.
//   - offsetParent is an unreliable visibility test inside position:fixed
//     containers; getClientRects() is not.
function focusablesIn(root) {
  if (!root) return [];
  const sel =
    'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';
  const seenRadioGroup = new Set();
  return [...root.querySelectorAll(sel)].filter((n) => {
    if (n.disabled || n.getAttribute("aria-hidden") === "true") return false;
    if (!n.getClientRects().length) return false;
    if (n.tagName === "INPUT" && n.type === "radio" && n.name) {
      if (seenRadioGroup.has(n.name)) return false;
      const group = [...root.querySelectorAll(
        'input[type="radio"][name="' + CSS.escape(n.name) + '"]')];
      const target = group.find((r) => r.checked) || group[0];
      if (n !== target) return false;
      seenRadioGroup.add(n.name);
    }
    return true;
  });
}

const settingsOverlay = {
  _lastFocus: null,

  isOpen() {
    const el = $("settings");
    return !!el && el.style.display !== "none";
  },

  open() {
    const el = $("settings");
    if (!el || this.isOpen()) return;
    this._load();
    this._lastFocus = document.activeElement;
    el.style.display = "flex";
    requestAnimationFrame(() => el.classList.add("sc-visible"));
    // Focus the selected mode rather than the close button: it is the control
    // someone came here to change.
    const checked = el.querySelector('input[name="set-explorer"]:checked');
    (checked || $("set-close"))?.focus();
  },

  close() {
    const el = $("settings");
    if (!el || !this.isOpen()) return;
    el.classList.remove("sc-visible");
    el.style.display = "none";
    if (this._lastFocus && document.contains(this._lastFocus)) {
      try { this._lastFocus.focus(); } catch (_) {}
    }
    this._lastFocus = null;
  },

  toggle() { this.isOpen() ? this.close() : this.open(); },

  _trapFocus(e) {
    const el = $("settings");
    if (!el || !this.isOpen() || e.key !== "Tab") return;
    const f = focusablesIn(el);
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  },

  // Reflect stored config into the form.
  _load() {
    const cfg = utils.explorer.get();
    const radio = $("set-exp-" + cfg.mode);
    if (radio) radio.checked = true;
    const url = $("set-exp-url");
    if (url) url.value = cfg.url || "";
    this._syncCustom();
  },

  _mode() {
    return document.querySelector('input[name="set-explorer"]:checked')?.value || "mempool";
  },

  // The URL field is only meaningful for the custom mode, and an input nobody
  // can use should not be a tab stop.
  _syncCustom() {
    const custom = this._mode() === "custom";
    const wrap = $q(".set-custom");
    const url = $("set-exp-url");
    if (wrap) wrap.classList.toggle("set-custom-on", custom);
    if (url) url.disabled = !custom;
    this._validate();
  },

  // Live feedback. Showing the URL that will actually be opened is the only
  // way someone can tell a working base from one that merely looks right.
  _validate() {
    const msg = $("set-exp-msg");
    if (!msg) return;
    if (this._mode() !== "custom") { msg.textContent = ""; msg.className = "set-msg"; return; }

    const raw = $("set-exp-url")?.value || "";
    if (!raw.trim()) {
      msg.textContent = "Enter a base URL, or use {hash} to place the block hash yourself.";
      msg.className = "set-msg";
      return;
    }
    if (!utils.explorer.sanitize(raw)) {
      msg.textContent = "Not a usable address. Must start with http:// or https://";
      msg.className = "set-msg set-msg-bad";
      return;
    }
    const sample = "0".repeat(63) + "1";
    const built = utils.explorer.blockUrl(sample, nodePanel.currentChain);
    msg.textContent = built ? "Opens: " + built.slice(0, 72) + (built.length > 72 ? "…" : "") : "";
    msg.className = "set-msg set-msg-ok";
  },

  // Persist immediately, matching how sound, chain and layout already behave.
  _save() {
    utils.explorer.set({ mode: this._mode(), url: $("set-exp-url")?.value || "" });
    this._validate();
    // Repaint so existing rows pick up the new target without a reload.
    try { blocksPanel.render(poller._lastData || {}); } catch (_) {}
  },

  init() {
    $("set-close")?.addEventListener("click", () => this.close());
    $("settings")?.addEventListener("mousedown", (e) => {
      if (e.target && e.target.id === "settings") this.close();
    });
    document.querySelectorAll('input[name="set-explorer"]').forEach((r) => {
      r.addEventListener("change", () => { this._syncCustom(); this._save(); });
    });
    const url = $("set-exp-url");
    url?.addEventListener("input", () => this._save());
    // Enter in a single-field form should dismiss, not submit nothing.
    url?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); this.close(); }
    });
  },
};

const shortcutsOverlay = {
  _lastFocus: null,

  GROUPS: [
    ["global", [
      ["Ctrl + `", "open or close the terminal"],
      ["?", "show this sheet"],
      ["Esc", "close the terminal, a menu, or this sheet"],
    ]],
    ["tables", [
      ["↑ / ↓", "move between rows in the peers and blocks tables"],
      ["Enter / Space", "select the focused row"],
      ["c", "copy the focused row's hash or address"],
      ["select it again", "deselect a peer and return to the network overview"],
      ["Esc", "clear the peer filter, or back out of a selected peer"],
      ["↓ in the filter", "jump into the peer list"],
    ]],
    ["panels", [
      ["drag a header", "reorder panels, within or across columns"],
      ["drag an edge", "resize a panel"],
      ["Alt + H", "hide the focused panel; bring it back from the restore bar"],
      ["right-click a header", "hide the panel, open the terminal, reset the layout"],
      ["", "layout, column widths and hidden panels persist across sessions"],
    ]],
    ["terminal", [
      ["Tab", "complete an RPC method name; press again to cycle"],
      ["↑ / ↓", "command history, kept across restarts"],
      ["Ctrl + C", "cancel the running command"],
      ["Ctrl + L", "clear the output"],
      ["Ctrl + F", "search the output"],
      ["drag the top edge", "resize the drawer; the height is remembered"],
    ]],
    ["easily missed", [
      ["select a block height", "jump to any block by height"],
      ["hover a label", "most labels carry an explanation"],
      ["select a row", "open peer or block detail"],
      ["snapshot ↓", "download the current state as JSON"],
      ["blocks ↓ / peers ↓", "export the table as TSV"],
      ["⚙ in the titlebar", "choose your block explorer, or turn outbound links off"],
    ]],
  ],

  _build() {
    const body = $("sc-body");
    if (!body || body.childElementCount) return;
    const frag = document.createDocumentFragment();
    for (const [title, rows] of this.GROUPS) {
      const g = document.createElement("div");
      g.className = "sc-group";
      const h = document.createElement("div");
      h.className = "sc-group-title";
      h.textContent = title;
      g.appendChild(h);
      for (const [key, desc] of rows) {
        const r = document.createElement("div");
        r.className = "sc-row";
        const k = document.createElement("span");
        k.className = "sc-key";
        if (key) k.textContent = key;
        const d = document.createElement("span");
        d.className = "sc-desc";
        d.textContent = desc;
        r.appendChild(k);
        r.appendChild(d);
        g.appendChild(r);
      }
      frag.appendChild(g);
    }
    body.appendChild(frag);
  },

  isOpen() {
    const el = $("shortcuts");
    return !!el && el.style.display !== "none";
  },

  open() {
    const el = $("shortcuts");
    if (!el || this.isOpen()) return;
    this._build();
    this._lastFocus = document.activeElement;
    el.style.display = "flex";
    requestAnimationFrame(() => el.classList.add("sc-visible"));
    const close = $("sc-close");
    if (close) close.focus();
  },

  close() {
    const el = $("shortcuts");
    if (!el || !this.isOpen()) return;
    el.classList.remove("sc-visible");
    el.style.display = "none";
    // Return focus where it came from rather than dumping it on <body>.
    if (this._lastFocus && document.contains(this._lastFocus)) {
      try { this._lastFocus.focus(); } catch (_) {}
    }
    this._lastFocus = null;
  },

  toggle() { this.isOpen() ? this.close() : this.open(); },

  // Keep Tab inside the sheet while it is modal.
  _trapFocus(e) {
    const el = $("shortcuts");
    if (!el || !this.isOpen() || e.key !== "Tab") return;
    const focusable = focusablesIn(el);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  },

  init() {
    $("sc-close")?.addEventListener("click", () => this.close());
    // Click the backdrop, but not the sheet itself, to dismiss.
    $("shortcuts")?.addEventListener("mousedown", (e) => {
      if (e.target && e.target.id === "shortcuts") this.close();
    });
  },
};

const heroStrip = {
  _lastHeight: null,
  _soundOn: false,

  _setVal(id, val, primary = false) {
    const el = $(id);
    if (!el) return;
    const s = String(val);
    if (el.textContent === s) return;
    el.textContent = s;
    el.classList.remove("hero-flash", "hero-flash-secondary");
    void el.offsetWidth;
    el.classList.add(primary ? "hero-flash" : "hero-flash-secondary");
  },

  _pulseHeightBar() {
    const cell = $("hero-height")?.closest(".hero-cell");
    if (!cell) return;
    cell.classList.remove("hero-cell-new-block");
    void cell.offsetWidth;
    cell.classList.add("hero-cell-new-block");
  },

  render(d) {
    const bc = d.blockchain || {};
    const ni = d.networkInfo || {};
    const mi = d.mempoolInfo || {};
    const fees = d.fees || {};
    const blocks = d.blocks || [];
    const now = Date.now() / 1000;

    const newHeight = bc.blocks || 0;
    if (this._lastHeight !== null && newHeight > this._lastHeight) {
      this._pulseHeightBar();
      // Only chime when fully synced. blocks === headers means no known blocks
      // are pending validation — catches the last 1-2 catch-up blocks that
      // slip through once verificationprogress already reads >= 0.9999.
      if (!bc.initialblockdownload && bc.blocks === bc.headers && (bc.verificationprogress || 0) >= 0.9999) this._playBlockTick();
    }
    this._lastHeight = newHeight;
    this._setVal("hero-height", fb(newHeight), true);

    const tipTime = blocks.length ? blocks[0].time : 0;
    const ageEl = $("hero-tip-age");
    if (ageEl)
      ageEl.textContent = tipTime ? utils.fmtAgeAgo(now - tipTime) : "—";

    this._setVal("hero-fee", fees.fast != null ? String(fees.fast) : "—");
    // A dash with no explanation reads as broken. Bitcoin Core will not
    // estimate fees during initial block download — it has not seen enough
    // recent blocks to have anything to estimate from — so say that rather than
    // leaving the operator to guess whether the dashboard has failed.
    const feeSub = $("hero-fee-sub");
    const feeCell = $("hero-fee");
    if (feeSub) {
      if (fees.fast != null) {
        feeSub.textContent = "sat / vB";
        if (feeCell) feeCell.removeAttribute("title");
      } else if (bc.initialblockdownload) {
        feeSub.textContent = "while syncing";
        if (feeCell)
          feeCell.title =
            "Bitcoin Core does not estimate fees during initial block download.";
      } else {
        feeSub.textContent = "no estimate";
        if (feeCell)
          feeCell.title =
            "Bitcoin Core has not returned a fee estimate yet. It needs recent blocks to estimate from.";
      }
    }

    this._setVal("hero-mempool", fb(mi.size || 0));
    const mpSub = $("hero-mempool-sub");
    if (mpSub) {
      mpSub.textContent = mi.bytes
        ? utils.fmtBytes(mi.bytes) +
          " · " +
          f((mi.mempoolminfee || 0) * 1e5, 1) +
          " min"
        : "—";
    }

    this._setVal("hero-peers", ni.connections || 0);
    const pSub = $("hero-peers-sub");
    if (pSub) {
      const cin = ni.connections_in;
      const cout = ni.connections_out;
      pSub.textContent =
        cin != null && cout != null ? cin + "↓  " + cout + "↑" : "—";
    }

    // Panel header badges
    const mpPh = $("mp-ph");
    if (mpPh && mi.size != null) mpPh.textContent = fb(mi.size) + " txs";


  },

  _initSound() {
    const btn = $("sound-btn");
    if (!btn) return;
    try { this._soundOn = localStorage.getItem("bw-sound") === "1"; } catch (_) {}
    btn.classList.toggle("sound-on", this._soundOn);
    btn.addEventListener("click", () => {
      this._soundOn = !this._soundOn;
      btn.classList.toggle("sound-on", this._soundOn);
      try { localStorage.setItem("bw-sound", this._soundOn ? "1" : "0"); } catch (_) {}
    });
  },

  _playBlockTick() {
    if (!this._soundOn) return;
    new Audio("/assets/block.ogg").play().catch(() => {});
  },

};
