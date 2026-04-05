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
      this._initDrag(p);
      this._initResize(p);
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
          if (p._lv17 && p._dragInit && p._rr && p._cc) return;
          this._addHandles(p);
          this._initDrag(p);
          this._initResize(p);
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

  // ── Drag — insert into column or swap with panel ─────────────────────────
  // _findColumnInsert returns a descriptor for edge/gap zones (insert line shown).
  // When the cursor is in a panel's centre zone it returns null, which triggers
  // swap detection. A single-panel column behaves identically to a multi-panel
  // column: centre = swap, top/bottom edges = insert before/after.
  _initDrag(panel) {
    if (panel._dragInit) return;
    panel._dragInit = true;

    panel.addEventListener(
      "pointerdown",
      (e) => {
        if (!this._isMobile && !e.target.closest(".resize-handle"))
          this._bringToFront(panel);
      },
      true,
    );

    const ph = panel.querySelector(".ph");
    if (!ph) return;

    ph.addEventListener("mouseenter", () =>
      panel.classList.add("panel-ph-hover"),
    );
    ph.addEventListener("mouseleave", () =>
      panel.classList.remove("panel-ph-hover"),
    );

    ph.addEventListener("pointerdown", (e) => {
      if (
        e.target.closest(".ph-right") ||
        e.target.closest(".resize-handle") ||
        this._isMobile ||
        this._isTablet()
      )
        return;
      if (e.pointerType === "touch" && e.isPrimary === false) return;
      e.preventDefault();
      ph.setPointerCapture(e.pointerId);

      // Clean up any orphaned ghosts left by a previous drag that lost its pointer event
      this._main.querySelectorAll('.drop-ghost, .drop-insert-line').forEach(el => el.remove());

      const l0 = parseInt(panel.style.left) || 0;
      const t0 = parseInt(panel.style.top) || 0;
      const W = panel.offsetWidth;
      const H = panel.offsetHeight;
      // Capture where within the panel the user clicked, so dragging feels natural
      const panelRect = panel.getBoundingClientRect();
      const grabOffsetX = e.clientX - panelRect.left;
      const grabOffsetY = e.clientY - panelRect.top;
      let moved = false;
      let swapGhost = null; // box ghost shown over swap target
      let insertLine = null; // line ghost shown for insert position
      let overTarget = null; // panel to swap with
      let insertDrop = null; // { ci, insertIndex } for column insert

      const mv = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        if (
          !moved &&
          Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5
        )
          return;

        if (!moved) {
          moved = true;
          panel.classList.add("panel-dragging");
          panel.classList.remove("panel-ph-hover");
          document.body.classList.add("is-dragging");
          document.body.style.cursor = "grabbing";
          panel.style.willChange = "transform";

          swapGhost = document.createElement("div");
          swapGhost.className = "drop-ghost drop-ghost-swap";
          swapGhost.style.cssText =
            "position:absolute;pointer-events:none;display:none;";
          this._main.appendChild(swapGhost);

          insertLine = document.createElement("div");
          insertLine.className = "drop-insert-line";
          insertLine.style.cssText =
            "position:absolute;pointer-events:none;display:none;";
          this._main.appendChild(insertLine);
        }

        const mainRect = this._main.getBoundingClientRect();
        const rawL = ev.clientX - mainRect.left - grabOffsetX;
        const rawT = ev.clientY - mainRect.top - grabOffsetY;
        const da = this._dataArea();
        const clampL = Math.max(
          da.left,
          Math.min(da.left + da.width - W, rawL),
        );
        const clampT = Math.max(da.top, Math.min(da.top + da.height - H, rawT));
        panel.style.transform = `translate(${clampL - l0}px,${clampT - t0}px)`;

        const cx = ev.clientX - mainRect.left;
        const cy = ev.clientY - mainRect.top;

        // _findColumnInsert claims edge zones and returns null for centre zones.
        // A null result means swap detection gets to run below.
        insertDrop =
          cy >= da.top && cy <= da.top + da.height
            ? this._findColumnInsert(cx, cy, panel.dataset.panel, da)
            : null;

        // Swap target: cursor is in a panel's centre zone (insertDrop is null).
        overTarget = null;
        if (!insertDrop) {
          this._allPanels().forEach((p) => {
            if (p === panel) return;
            if (["titlebar", "hero", "statusbar"].includes(p.dataset.panel))
              return;
            if (this._minimized.has(p) || p.style.display === "none") return;
            const pl = parseInt(p.style.left),
              pt = parseInt(p.style.top);
            if (
              cx >= pl &&
              cx <= pl + p.offsetWidth &&
              cy >= pt &&
              cy <= pt + p.offsetHeight
            ) {
              overTarget = p;
            }
          });
        }

        // Update ghosts — swap ghost for centre zone, insert line for edges/gaps.
        if (overTarget) {
          swapGhost.style.cssText = `position:absolute;pointer-events:none;
            left:${overTarget.style.left};top:${overTarget.style.top};
            width:${overTarget.offsetWidth}px;height:${overTarget.offsetHeight}px;`;
          swapGhost.style.display = "";
          insertLine.style.display = "none";
        } else if (insertDrop) {
          swapGhost.style.display = "none";
          const { lineX, lineW, lineY } = insertDrop;
          insertLine.style.cssText = `position:absolute;pointer-events:none;
            left:${lineX}px;top:${lineY - 1}px;width:${lineW}px;height:2px;`;
          insertLine.style.display = "";
        } else {
          swapGhost.style.display = "none";
          insertLine.style.display = "none";
        }
      };

      const up = (ev) => {
        if (ev.pointerId !== e.pointerId) return;
        ph.removeEventListener("pointermove", mv);
        ph.removeEventListener("pointerup", up);
        ph.removeEventListener("pointercancel", up);
        document.body.style.cursor = "";
        document.body.classList.remove("is-dragging");
        panel.classList.remove("panel-dragging");
        panel.style.transform = "";
        panel.style.willChange = "";
        if (swapGhost) {
          swapGhost.remove();
          swapGhost = null;
        }
        if (insertLine) {
          insertLine.remove();
          insertLine = null;
        }

        if (moved && overTarget) {
          this._swapPanels(panel.dataset.panel, overTarget.dataset.panel);
        } else if (moved && insertDrop) {
          this._insertPanel(
            panel.dataset.panel,
            insertDrop.ci,
            insertDrop.insertIndex,
          );
        } else if (moved) {
          panel.classList.add("panel-swapping");
          Object.assign(panel.style, { left: l0 + "px", top: t0 + "px" });
          setTimeout(() => panel.classList.remove("panel-swapping"), 260);
        }
      };

      ph.addEventListener("pointermove", mv);
      ph.addEventListener("pointerup", up);
      ph.addEventListener("pointercancel", up);
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
      const active = this._activePanels(ci).filter((s) => s.name !== dragName);

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
          const lineY =
            i === active.length - 1
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
      const lastBottom = last
        ? parseInt(last.style.top) + last.offsetHeight
        : da.top + da.height;
      return {
        ci,
        insertIndex: active.length,
        lineX: colX,
        lineW: colW,
        lineY: lastBottom + Math.round(G / 2),
      };
    }

    return null;
  },

  // Move a panel from its current column into targetCol at insertIndex.
  // insertIndex is relative to the active (visible) panels in the target column —
  // it must be translated to a raw _cols index that accounts for hidden panels.
  _insertPanel(name, targetCi, insertIndex) {
    // Find and remove from source column.
    let srcCi = -1,
      srcSlot = null;
    for (let ci = 0; ci < this._cols.length; ci++) {
      const idx = this._cols[ci].findIndex((s) => s.name === name);
      if (idx !== -1) {
        srcCi = ci;
        srcSlot = this._cols[ci].splice(idx, 1)[0];
        break;
      }
    }
    if (srcCi === -1 || !srcSlot) return;

    // Redistribute the departed panel's hf to its former active column-mates.
    const srcActive = this._activePanels(srcCi);
    if (srcActive.length) {
      const share = srcSlot.hf / srcActive.length;
      srcActive.forEach((s) => {
        s.hf += share;
      });
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
      rawIndex = targetCol.findIndex((s) => s.name === anchorName);
      if (rawIndex === -1) rawIndex = targetCol.length;
    }

    // Claim an equal share of the target column's active height.
    const nActive = targetActive.length;
    const newHf = nActive ? 1 / (nActive + 1) : 1;
    const scaleFactor = nActive ? nActive / (nActive + 1) : 1;
    targetActive.forEach((s) => {
      s.hf *= scaleFactor;
    });

    targetCol.splice(rawIndex, 0, { name, hf: newHf });

    const p = this._panel(name);
    if (p) p.classList.add("panel-swapping");

    this._render();
    this._save();

    setTimeout(() => {
      if (p) p.classList.remove("panel-swapping");
    }, 260);
  },

  // Swap two named panels in _cols — each keeps the other's hf so column
  // proportions stay stable.
  _swapPanels(nameA, nameB) {
    let slotA = null,
      ciA = -1,
      iiA = -1;
    let slotB = null,
      ciB = -1,
      iiB = -1;

    this._cols.forEach((col, ci) => {
      col.forEach((slot, ii) => {
        if (slot.name === nameA) {
          slotA = slot;
          ciA = ci;
          iiA = ii;
        }
        if (slot.name === nameB) {
          slotB = slot;
          ciB = ci;
          iiB = ii;
        }
      });
    });

    if (!slotA || !slotB) return;

    this._cols[ciA][iiA] = { name: nameB, hf: slotA.hf };
    this._cols[ciB][iiB] = { name: nameA, hf: slotB.hf };

    const pA = this._panel(nameA);
    const pB = this._panel(nameB);
    if (pA) pA.classList.add("panel-swapping");
    if (pB) pB.classList.add("panel-swapping");

    this._render();
    this._save();

    setTimeout(() => {
      if (pA) pA.classList.remove("panel-swapping");
      if (pB) pB.classList.remove("panel-swapping");
    }, 260);
  },

  // ── Resize — south edge only, adjusts panel below ───────────────────────────
  _initResize(panel) {
    if (panel._rr) return;
    panel._rr = true;

    panel.querySelectorAll(".resize-handle").forEach((handle) => {
      const dir = handle.dataset.dir;
      if (dir !== "s" && dir !== "n") return;

      handle.addEventListener("pointerdown", (e) => {
        if (this._isMobile || this._isTablet()) return;
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        this._bringToFront(panel);

        const name = panel.dataset.panel;
        const y0 = e.clientY;
        const h0 = panel.offsetHeight;

        document.body.style.cursor = "ns-resize";
        document.body.classList.add("is-dragging");
        panel.classList.add("panel-resizing");

        let ci = -1;
        this._cols.forEach((col, c) => {
          col.forEach((slot) => {
            if (slot.name === name) ci = c;
          });
        });
        if (ci === -1) return;

        const mv = (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          const da = this._dataArea();
          const G = this.GAP;
          const active = this._activePanels(ci);
          const totalH = da.height - G * (active.length - 1);
          const sumHf = active.reduce((s, sl) => s + sl.hf, 0);
          const ai = active.findIndex((s) => s.name === name);
          if (ai === -1) return;

          const dy = ev.clientY - y0;

          if (dir === "s") {
            // South: grow/shrink this panel, compensate the panel below
            if (ai === active.length - 1) return;
            const newHf = Math.min(
              sumHf - this.MIN_HF * (active.length - 1),
              Math.max(this.MIN_HF, ((h0 + dy) / totalH) * sumHf),
            );
            const nextSlot = active[ai + 1];
            const nextNewHf = nextSlot.hf - (newHf - active[ai].hf);
            if (nextNewHf < this.MIN_HF) return;
            active[ai].hf = newHf;
            nextSlot.hf = nextNewHf;
          } else {
            // North: grow/shrink this panel, compensate the panel above
            if (ai === 0) return;
            const newHf = Math.min(
              sumHf - this.MIN_HF * (active.length - 1),
              Math.max(this.MIN_HF, ((h0 - dy) / totalH) * sumHf),
            );
            const prevSlot = active[ai - 1];
            const prevNewHf = prevSlot.hf - (newHf - active[ai].hf);
            if (prevNewHf < this.MIN_HF) return;
            active[ai].hf = newHf;
            prevSlot.hf = prevNewHf;
          }

          this._render();
        };

        const up = (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          handle.removeEventListener("pointermove", mv);
          handle.removeEventListener("pointerup", up);
          handle.removeEventListener("pointercancel", up);
          document.body.style.cursor = "";
          document.body.classList.remove("is-dragging");
          panel.classList.remove("panel-resizing");
          this._save();
        };

        handle.addEventListener("pointermove", mv);
        handle.addEventListener("pointerup", up);
        handle.addEventListener("pointercancel", up);
      });
    });
  },

  // ── Context menu ─────────────────────────────────────────────────────────────
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
      this._render();
      this._save();
    });
  },

  restore(panel) {
    if (!panel) return;
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
    panel.style.display = "";
    this._render();
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

  _animOut(p, cb) {
    p.classList.add("p-out");
    setTimeout(() => {
      p.classList.remove("p-out");
      cb();
    }, 180);
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
const toastStack = {
  _el: null,
  _toasts: [],
  MAX: 5,

  _container() {
    if (!this._el) this._el = $("toast-stack");
    return this._el;
  },

  add(msg, level = "error") {
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

    // auto-dismiss after 5 s
    entry._timer = setTimeout(() => this._dismissFade(node), 5000);
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
      <div class="ctx-item" data-action="toggle"><span class="ctx-icon">${isMin ? "&#9672;" : "&#9634;"}</span>${isMin ? "show panel" : "hide panel"}</div>
      <div class="ctx-sep"></div><div class="ctx-item" data-action="terminal"><span class="ctx-icon">›</span>open terminal</div>
      <div class="ctx-sep"></div>
      <div class="ctx-item danger" data-action="reset"><span class="ctx-icon">&#8635;</span>reset layout</div>`;

    el.style.display = "block";
    const mw = el.offsetWidth,
      mh = el.offsetHeight;
    el.style.left = Math.min(x, window.innerWidth - mw - 6) + "px";
    el.style.top = Math.min(y, window.innerHeight - mh - 6) + "px";
  },

  hide() {
    const el = this._getEl();
    if (el) el.style.display = "none";
  },

  initGlobal() {
    document.addEventListener("contextmenu", (e) => {
      if (e.target.closest(".ph")) return; // panel header has its own handler
      e.preventDefault();
      const el = this._getEl();
      if (!el) return;
      this._panel = null;
      el.innerHTML = `<div class="ctx-item" data-action="terminal"><span class="ctx-icon">›</span>open terminal</div>`;
      el.style.display = "block";
      el.style.left = Math.min(e.clientX + 2, window.innerWidth - el.offsetWidth - 6) + "px";
      el.style.top = Math.min(e.clientY + 2, window.innerHeight - el.offsetHeight - 6) + "px";
    });
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
      // Only chime for live blocks — suppress during IBD and catch-up after
      // being offline (blocks older than 20 minutes are not live arrivals).
      const tipTime = blocks.length ? blocks[0].time : 0;
      if (now - tipTime < 1200) this._playBlockTick();
    }
    this._lastHeight = newHeight;
    this._setVal("hero-height", fb(newHeight), true);

    const tipTime = blocks.length ? blocks[0].time : 0;
    const ageEl = $("hero-tip-age");
    if (ageEl)
      ageEl.textContent = tipTime ? utils.fmtAgeAgo(now - tipTime) : "—";

    this._setVal("hero-fee", fees.fast != null ? String(fees.fast) : "—");

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
