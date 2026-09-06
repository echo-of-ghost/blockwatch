'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · fluid.js — fluid spatial layout engine
//
// The dashboard's interaction layer. `layout` (client/ui.js) owns WHAT the
// arrangement is — the canonical columns, persistence, minimize state. This
// owns how it gets there on screen: placement, animation, drag, resize and the
// keyboard equivalents. layout calls in through _render, restore and minimize;
// there is no interception and no second layout system.
//
// WHAT IT REUSES from `layout` (the canonical system):
//   _cols        canonical [[{name, hf}]] state, 4 columns, hf normalised
//   _colGeom     column x/width from COL_WF
//   _dataArea    the region below the hero strip
//   _minimized   hidden panels, restore bar
//   _save        persistence under bw_layout_v44, format unchanged
//
// WHAT IT REPLACED (deleted from ui.js, 448 lines):
//   _initDrag          ghost + insert line, commit on drop → live reflow
//   _initResize        vertical-only handles → same solver, cascading neighbours
//   _findColumnInsert  edge/centre zone probing → continuous insertion
//   _insertPanel       commit on drop → the layout on screen IS the commit
//   _swapPanels        swap-on-centre → insertion only, no equivalent gesture
//
// PIPELINE
//   input (pointer / keyboard)
//     → interaction state (_drag / _resize)
//     → solver (_solve → target rect per panel)
//     → animator (_tick: current → target, critically damped)
//     → renderer (_paint: transform + size writes, change-gated)
//     → persistence (_commit on release only)
//
// The solver is pure: given canonical state and interaction state it returns
// target rectangles. It never touches the DOM. The animator never decides
// layout. That separation is what keeps state and DOM from diverging.
// ═══════════════════════════════════════════════════════════════════════════════

const fluid = {
  // ── Tunables ───────────────────────────────────────────────────────────────
  // Exponential approach rates, in units of e-folds per second. Deliberately
  // NOT a spring: an underdamped spring overshoots, and overshoot reads as
  // wobble. Exponential approach is unconditionally stable and never overshoots,
  // which is the "precise, calm, physical" end of the brief rather than the
  // cartoon end.
  RATE_NEAR: 26, // panels close to the disturbance react almost immediately
  RATE_FAR: 10, // distant panels ease, so the movement reads as local
  INFLUENCE: 620, // px over which nearness falls off
  SETTLE_EPS: 0.35, // px below which a panel is considered settled
  SIZE_EPS: 0.75, // px of size change worth paying a style write for at rest
  // Width animates only when a column collapses or expands, and each write is a
  // real relayout of that panel's subtree. During an active manipulation a
  // coarser gate trades sub-pixel smoothness on an already-moving panel for
  // frames, which is the better bargain while the pointer is down.
  SIZE_EPS_ACTIVE: 2.5,
  MIN_HF: 0.06, // a panel may never be squeezed below this fraction

  // ── State ──────────────────────────────────────────────────────────────────
  active: false,
  _panels: new Map(), // name → { el, cur:{x,y,w,h}, lastW, lastH, prepared }
  _drag: null, // { name, cx, cy, grabX, grabY, ci, idx, prevCols }
  _resize: null, // { name, ci, i, y0, hf0, hfNext0, prevCols }
  _raf: 0,
  _started: false,
  _mqBound: false,
  _lastTs: 0,
  _reduced: false,
  _live: null, // aria-live region for keyboard moves

  // ═════════════════════════════════════════════════════════════════════════
  // ENGAGE
  // ═════════════════════════════════════════════════════════════════════════

  // Must run BEFORE layout.init(). Marking the guards layout checks is what
  // stops the old drag/resize handlers from ever binding, without editing them.
  engage() {
    if (typeof layout === 'undefined' || !layout) return false;
    if (this.active) return true;

    const main = $('main');
    if (!main) return false;

    // Everything that can throw happens first, against locals. `active` is the
    // last thing set, and layout checks it before delegating placement, so the
    // engine is either fully installed or not installed at all. Getting this
    // backwards used to leave no working renderer and a blank dashboard.
    let reducedNow;
    try {
      const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
      reducedNow = mq.matches;
      if (!this._mqBound) {
        mq.addEventListener('change', (e) => { this._reduced = e.matches; });
        this._mqBound = true;
      }
    } catch (err) {
      console.error('[fluid] engage aborted, layout untouched', err);
      return false;
    }

    this._reduced = reducedNow;
    this.active = true;
    return true;
  },

  // Hand placement back to layout._renderPanels. Kept as a safety net rather
  // than a user-facing fallback: if the engine fails at startup a dashboard you
  // cannot drag still beats one you cannot see. Nothing needs restoring because
  // layout dispatches on `active` rather than being monkey-patched.
  disengage() {
    this.active = false;
    this._started = false;
    if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; }
    $('main')?.classList.remove('fluid-on');
    document.body.classList.remove('fluid-active', 'fluid-settling');
    // Hand the panels back clean. The engine positions by transform on top of
    // left/top:0 and layout._renderPanels writes left/top, so a stale transform
    // would offset every panel by its last animated position.
    for (const e of this._panels.values()) {
      Object.assign(e.el.style, {
        position: '', left: '', top: '', width: '', height: '', transform: '',
      });
    }
    this._panels.clear();
  },

  // ── Hooks called by layout ────────────────────────────────────────────────

  // layout.restore() calls this instead of setting display itself: the panel is
  // placed while still hidden, so it appears in its slot rather than at the
  // container origin.
  reveal(panel) {
    if (!panel) return;
    const name = panel.dataset.panel;
    const e = this._entry(name);
    if (e) { e.cur = null; e.prepared = false; e.lastW = -1; e.lastH = -1; }
    panel.style.visibility = 'hidden';
    panel.style.display = '';
    const targets = this._solve();
    const t = targets.get(name);
    if (e && t) e.cur = { ...t }; // seeded at the target: appear, do not fly
    this._paint(targets);
    panel.style.visibility = '';
    this.request();
  },

  // layout.minimize() calls this once the panel is hidden, so the next reveal
  // re-seeds from the solver rather than a position that is no longer valid.
  forget(panel) {
    if (!panel) return;
    const e = this._panels.get(panel.dataset.panel);
    if (e) { e.cur = null; e.prepared = false; e.lastW = -1; e.lastH = -1; }
  },

  // Called after layout.init() has built state and handles.
  start() {
    if (!this.active || this._started) return;
    this._started = true;
    const main = $('main');
    main.classList.add('fluid-on');

    main.querySelectorAll('[data-panel]').forEach((p) => {
      if (this._isChrome(p)) return;
      // Per-panel, so one panel missing a header cannot leave every other
      // panel unbound and undraggable.
      try { this._bind(p); }
      catch (err) { console.error('[fluid] bind failed for', p.dataset.panel, err); }
    });

    this._buildLiveRegion();
    this._wireRestoreBar();
    this._seedFromSolver();
    this.request();

    // A viewport change recomputes constraints from canonical state rather than
    // trying to preserve pixel coordinates that are no longer valid.
    // Debounced to 110ms, deliberately longer than layout's own 60ms handler:
    // that handler is what updates the breakpoint flags this engine reads, so
    // running first would decide engaged/disengaged from stale values.
    let rt = 0;
    window.addEventListener('resize', () => {
      if (this._drag) this._cancelDrag();
      if (this._resize) this._cancelResize();
      clearTimeout(rt);
      rt = setTimeout(() => {
        this._invalidateGeometry();
        if (this._engaged()) this._reengage();
        else this._release();
      }, 110);
    });
  },

  _isChrome(p) {
    return ['titlebar', 'hero', 'statusbar'].includes(p.dataset.panel);
  },

  _engaged() {
    return this.active && !layout._isMobile && !layout._isTablet();
  },

  // ═════════════════════════════════════════════════════════════════════════
  // PANEL REGISTRY
  // ═════════════════════════════════════════════════════════════════════════

  _entry(name) {
    let e = this._panels.get(name);
    if (!e) {
      const el = layout._panel(name);
      if (!el) return null;
      e = { el, cur: null, lastW: -1, lastH: -1, prepared: false };
      this._panels.set(name, e);
    }
    return e;
  },

  // Seed each panel's animated position from the solver's target, so the first
  // frame after engaging paints them where they belong instead of easing in
  // from nowhere. Reads no DOM geometry, hence not _syncFromDom.
  _seedFromSolver() {
    const targets = this._solve();
    for (const [name, rect] of targets) {
      const e = this._entry(name);
      if (!e) continue;
      if (!e.cur) e.cur = { ...rect };
    }
  },

  _invalidateGeometry() {
    for (const e of this._panels.values()) { e.lastW = -1; e.lastH = -1; e.cur = null; }
  },

  // Below the desktop breakpoint the stacked CSS layout is the correct
  // responsive answer, so the engine hands the panels back rather than fighting
  // it: every coordinate it owns is cleared, not frozen at a stale value.
  _release() {
    for (const e of this._panels.values()) {
      Object.assign(e.el.style, {
        position: '', left: '', top: '', width: '', height: '', transform: '',
      });
      e.prepared = false;
      e.cur = null;
      e.lastW = -1;
      e.lastH = -1;
    }
    document.body.classList.remove('fluid-active', 'fluid-settling');
    // The class must go too, not just the coordinates. `.fluid-on .ph` sets
    // touch-action:none, and leaving that on below the desktop breakpoint
    // blocks page scrolling from a panel header — on exactly the devices that
    // scroll by touching one.
    $('main')?.classList.remove('fluid-on');
  },

  // Re-engaging is the mirror of _release: the class comes back before the
  // first paint so headers are grabbable again.
  _reengage() {
    $('main')?.classList.add('fluid-on');
    this.request();
  },

  // ═════════════════════════════════════════════════════════════════════════
  // SOLVER — pure. Canonical state + interaction state → target rectangles.
  // ═════════════════════════════════════════════════════════════════════════

  // Working copy of the canonical columns with minimized panels dropped.
  _workingCols() {
    return layout._cols.map((col) =>
      col
        .filter((s) => !layout._minimized.has(layout._panel(s.name)))
        .map((s) => ({ name: s.name, hf: s.hf })),
    );
  },

  // Horizontal solve. A column holding no panels collapses to nothing and its
  // width is shared out among the others in proportion to their base weights,
  // so emptying a column reclaims the space instead of leaving a dead band.
  // Returns one box per column index; an empty column gets width 0.
  _colBoxes(cols, da) {
    const G = layout.GAP;
    const base = layout.COL_WF;
    const live = cols.map((c) => c.length > 0);
    const nLive = live.filter(Boolean).length;
    if (!nLive) return cols.map(() => ({ x: da.left, w: 0 }));

    const sum = base.reduce((t, w, i) => t + (live[i] ? w : 0), 0) || 1;
    const panelSpace = da.width - G * (nLive - 1);

    const out = [];
    let x = da.left;
    let placed = 0;
    for (let i = 0; i < cols.length; i++) {
      if (!live[i]) { out.push({ x, w: 0 }); continue; }
      placed++;
      // The last live column absorbs rounding drift so the right edge is exact.
      const w = placed === nLive
        ? da.left + da.width - x
        : Math.floor(panelSpace * (base[i] / sum));
      out.push({ x, w });
      x += w + G;
    }
    return out;
  },

  // Lay a single column out vertically. Shared by the solver and by insertion
  // probing, so the boundaries the user sees are the boundaries we test against.
  _layColumn(col, ci, da, into, box) {
    if (!col.length) return;
    const G = layout.GAP;
    const { x, w } = box || layout._colGeom(ci, da);
    const totalH = da.height - G * (col.length - 1);
    const sumHf = col.reduce((s, t) => s + t.hf, 0) || 1;
    let cursor = da.top;
    col.forEach((slot, i) => {
      const h =
        i === col.length - 1
          ? da.top + da.height - cursor
          : Math.round((slot.hf / sumHf) * totalH);
      into.set(slot.name, { x, y: cursor, w, h });
      cursor += h + G;
    });
  },

  // Returns Map<name, {x,y,w,h}>. When a drag is live the dragged panel is
  // removed from its column and reinserted where the pointer implies, so the
  // layout on screen IS the layout that will be committed. That is what removes
  // the need for drop zones: releasing simply stops updating it.
  _solve() {
    const da = layout._dataArea();
    const cols = this._workingCols();
    const out = new Map();

    let dragSlot = null;
    if (this._drag) {
      for (const col of cols) {
        const i = col.findIndex((s) => s.name === this._drag.name);
        if (i >= 0) { dragSlot = col.splice(i, 1)[0]; break; }
      }
      if (dragSlot) {
        const { ci, idx } = this._insertionPoint(cols, da);
        this._drag.ci = ci;
        this._drag.idx = idx;
        cols[ci].splice(idx, 0, dragSlot);
      }
    }

    const boxes = this._colBoxes(cols, da);
    cols.forEach((col, ci) => this._layColumn(col, ci, da, out, boxes[ci]));

    // The dragged panel's position is the pointer, not the solver. Its SIZE
    // still comes from the solver, so it visibly morphs toward the shape it
    // will have on release — the destination is legible without a ghost.
    if (this._drag && dragSlot) {
      const solved = out.get(this._drag.name);
      if (solved) {
        out.set(this._drag.name, {
          x: this._drag.cx - this._drag.grabX,
          y: this._drag.cy - this._drag.grabY,
          w: solved.w,
          h: solved.h,
          pinned: true,
        });
      }
    }
    return out;
  },

  // Which column, and which index within it. Probed against the column laid out
  // WITHOUT the dragged panel, so the boundaries are fixed while deciding and
  // the result cannot oscillate against its own feedback.
  _insertionPoint(colsWithoutDrag, da) {
    const d = this._drag;
    const n = layout.COL_WF.length;

    // Choosing the column uses the FULL four-column geometry, never the
    // collapsed one. A column the drag has just emptied has zero rendered
    // width, and hit-testing against that would make it impossible to drop
    // back into — the panel could leave a column and never return.
    const full = this._colBoxes(colsWithoutDrag.map(() => [null]), da);
    let ci = d.ci >= 0 ? d.ci : d.homeCi;
    let best = Infinity;
    for (let i = 0; i < n; i++) {
      const { x, w } = full[i];
      if (d.cx >= x && d.cx <= x + w) { ci = i; best = -1; break; }
      const dist = Math.abs(d.cx - (x + w / 2));
      if (dist < best) { best = dist; ci = i; }
    }

    // The index is then probed against the width that column will actually
    // have once the panel lands in it, so the boundaries tested are the
    // boundaries about to be drawn.
    const occupancy = colsWithoutDrag.map((c) => c.slice());
    occupancy[ci].push({ name: d.name, hf: 1 });
    const boxes = this._colBoxes(occupancy, da);

    // Index: first panel whose vertical midpoint sits below the pointer.
    const probe = new Map();
    this._layColumn(colsWithoutDrag[ci], ci, da, probe, boxes[ci]);
    const col = colsWithoutDrag[ci];
    let idx = col.length;
    for (let i = 0; i < col.length; i++) {
      const r = probe.get(col[i].name);
      if (!r) continue;
      if (d.cy < r.y + r.h / 2) { idx = i; break; }
    }
    return { ci, idx };
  },

  // ═════════════════════════════════════════════════════════════════════════
  // ANIMATOR — current → target, critically damped, locality-weighted.
  // ═════════════════════════════════════════════════════════════════════════

  request() {
    if (!this._engaged()) return;
    if (this._raf) return;
    this._lastTs = 0;
    this._raf = requestAnimationFrame((ts) => this._tick(ts));
  },

  _tick(ts) {
    this._raf = 0;
    if (!this._engaged()) return;

    const dt = this._lastTs ? Math.min(0.05, (ts - this._lastTs) / 1000) : 0.016;
    this._lastTs = ts;

    const targets = this._solve();
    const disturbing = this._drag || this._resize;
    let dcx = 0, dcy = 0;
    if (this._drag) { dcx = this._drag.cx; dcy = this._drag.cy; }
    else if (this._resize) {
      const r = targets.get(this._resize.name);
      if (r) { dcx = r.x + r.w / 2; dcy = r.y + r.h / 2; }
    }

    let moving = false;

    for (const [name, t] of targets) {
      const e = this._entry(name);
      if (!e) continue;
      if (!e.cur) { e.cur = { x: t.x, y: t.y, w: t.w, h: t.h }; moving = true; continue; }

      // The dragged panel is pinned to the pointer: no smoothing on position,
      // so the pointer always feels directly connected to it.
      if (t.pinned) {
        e.cur.x = t.x;
        e.cur.y = t.y;
        // Reduced motion snaps the size too. Easing only the non-pinned panels
        // would leave the one panel under the pointer still animating.
        const pa = this._reduced ? 1 : this._alpha(this.RATE_NEAR, dt);
        e.cur.w += (t.w - e.cur.w) * pa;
        e.cur.h += (t.h - e.cur.h) * pa;
        moving = true;
        continue;
      }

      // Locality: rate falls off with distance from the disturbance, so nearby
      // panels lead and far ones lag. Panels whose target did not change do not
      // move at all, which is what keeps the rest of the dashboard still.
      let rate = this.RATE_NEAR;
      if (disturbing) {
        const cx = e.cur.x + e.cur.w / 2;
        const cy = e.cur.y + e.cur.h / 2;
        const dist = Math.hypot(cx - dcx, cy - dcy);
        const k = Math.max(0, 1 - dist / this.INFLUENCE);
        rate = this.RATE_FAR + (this.RATE_NEAR - this.RATE_FAR) * k;
      }
      const a = this._reduced ? 1 : this._alpha(rate, dt);

      let far = false;
      for (const key of ['x', 'y', 'w', 'h']) {
        const delta = t[key] - e.cur[key];
        if (Math.abs(delta) > this.SETTLE_EPS) { far = true; e.cur[key] += delta * a; }
        else e.cur[key] = t[key];
      }
      if (far) moving = true;
    }

    this._paint(targets);

    if (moving || disturbing) {
      this._raf = requestAnimationFrame((t2) => this._tick(t2));
    } else {
      // Settled: release the size-write gate so the next disturbance starts clean,
      // and let anything listening (charts) redraw once.
      document.body.classList.remove('fluid-settling');
      window.dispatchEvent(new CustomEvent('fluid:settled'));
    }
  },

  // Exponential approach factor for this frame. Frame-rate independent, so a
  // dropped frame does not change where things end up.
  _alpha(rate, dt) {
    return 1 - Math.exp(-rate * dt);
  },

  // ═════════════════════════════════════════════════════════════════════════
  // RENDERER — transform for position, gated writes for size.
  // ═════════════════════════════════════════════════════════════════════════

  _paint(targets) {
    const eps = (this._drag || this._resize) ? this.SIZE_EPS_ACTIVE : this.SIZE_EPS;
    for (const [name, e] of this._panels) {
      if (!e.cur || !targets.has(name)) continue;
      const el = e.el;
      // layout.init() leaves panels display:none and the old renderer was what
      // revealed them. The engine owns that now.
      if (!e.prepared) { this._prepare(el); e.prepared = true; }
      const w = Math.round(e.cur.w);
      const h = Math.round(e.cur.h);

      // Position via transform only: composited, no layout.
      el.style.transform = `translate3d(${Math.round(e.cur.x)}px,${Math.round(e.cur.y)}px,0)`;

      // Size is real layout, so only pay for it when it actually changed. `contain`
      // (set in CSS) stops a panel's own relayout escaping into its siblings.
      if (Math.abs(w - e.lastW) >= eps) { el.style.width = w + 'px'; e.lastW = w; }
      if (Math.abs(h - e.lastH) >= eps) { el.style.height = h + 'px'; e.lastH = h; }
    }
  },

  // Panels are absolutely positioned at the origin and placed by transform.
  _prepare(el) {
    Object.assign(el.style, { position: 'absolute', left: '0px', top: '0px', display: '' });
  },

  // ═════════════════════════════════════════════════════════════════════════
  // INPUT
  // ═════════════════════════════════════════════════════════════════════════

  _bind(panel) {
    if (panel._fluidBound) return;
    panel._fluidBound = true;
    const name = panel.dataset.panel;

    const ph = panel.querySelector('.ph');
    if (ph) {
      ph.addEventListener('pointerdown', (e) => this._onGrab(e, panel, ph));
      // Keyboard equivalent lives on the same surface that carries the drag.
      // Deliberately NO role="button": three of these headers contain real
      // <button> elements for TSV export, and interactive content inside a
      // button role is invalid. A focusable, labelled group is the honest
      // description, and aria-keyshortcuts advertises the controls.
      ph.setAttribute('tabindex', '0');
      ph.setAttribute('aria-label',
        (layout._LABEL[name] || name) + ' panel. Alt with arrow keys moves it, alt with shift and up or down resizes it.');
      ph.setAttribute('aria-keyshortcuts',
        'Alt+ArrowUp Alt+ArrowDown Alt+ArrowLeft Alt+ArrowRight');
      ph.addEventListener('keydown', (e) => {
        // Any key means the keyboard is driving now: restore the focus ring.
        delete ph.dataset.pointerFocus;
        this._onKey(e, name);
      });
      ph.addEventListener('blur', () => { delete ph.dataset.pointerFocus; });
      ph.addEventListener('pointerdown', () => layout._bringToFront(panel), true);
    }

    panel.querySelectorAll('.resize-handle').forEach((handle) => {
      const dir = handle.dataset.dir;
      if (dir !== 's' && dir !== 'n') return;
      handle.addEventListener('pointerdown', (e) => this._onResize(e, panel, handle, dir));
    });
  },

  // ── Drag ───────────────────────────────────────────────────────────────────
  _onGrab(e, panel, ph) {
    if (!this._engaged()) return;
    if (e.target.closest('.ph-right') || e.target.closest('.resize-handle')) return;
    if (e.pointerType === 'touch' && e.isPrimary === false) return;
    if (this._drag || this._resize) return;

    // preventDefault below suppresses the browser's focus-on-mousedown, which
    // would leave the keyboard controls unreachable for anyone who clicks a
    // panel before pressing alt+arrow. Focus explicitly first.
    //
    // Marked as pointer-acquired, because the browser cannot tell that this
    // focus came from a pointer and will match :focus-visible, painting a ring
    // around the header that outlives the drag. The mark is cleared the moment
    // a key is pressed, so a keyboard user gets the ring back immediately.
    ph.dataset.pointerFocus = '1';
    try { ph.focus({ preventScroll: true }); } catch (_) { ph.focus(); }
    e.preventDefault();

    // Capture immediately, not after the movement threshold. A fast first move
    // can leave the header before the threshold is met, and without capture
    // that pointermove never reaches this listener, so the drag never starts.
    try { ph.setPointerCapture(e.pointerId); } catch (_) {}

    const name = panel.dataset.panel;
    const e0 = this._entry(name);
    if (!e0 || !e0.cur) return;

    const mainRect = $('main').getBoundingClientRect();
    const cx = e.clientX - mainRect.left;
    const cy = e.clientY - mainRect.top;

    let started = false;
    const startX = e.clientX, startY = e.clientY;

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      // A small threshold keeps a click on the header from reordering anything,
      // and on touch it lets a vertical scroll win before a drag is claimed.
      if (!started) {
        if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
        started = true;
        let homeCi = 0;
        layout._cols.forEach((c, i) => { if (c.some((s2) => s2.name === name)) homeCi = i; });
        this._drag = {
          name,
          cx, cy,
          grabX: cx - e0.cur.x,
          grabY: cy - e0.cur.y,
          ci: -1, idx: -1, homeCi,
          prevCols: layout._cols.map((c) => c.map((s) => ({ ...s }))),
        };
        panel.classList.add('fluid-dragging');
        document.body.classList.add('fluid-active', 'fluid-settling');
        this.request();
      }
      const r = $('main').getBoundingClientRect();
      this._drag.cx = ev.clientX - r.left;
      this._drag.cy = ev.clientY - r.top;
      this.request();
    };

    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      ph.removeEventListener('pointermove', move);
      ph.removeEventListener('pointerup', end);
      ph.removeEventListener('pointercancel', cancel);
      ph.removeEventListener('lostpointercapture', cancel);
      if (started) this._commitDrag(panel);
    };

    const cancel = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      ph.removeEventListener('pointermove', move);
      ph.removeEventListener('pointerup', end);
      ph.removeEventListener('pointercancel', cancel);
      ph.removeEventListener('lostpointercapture', cancel);
      if (started) this._cancelDrag(panel);
    };

    ph.addEventListener('pointermove', move);
    ph.addEventListener('pointerup', end);
    ph.addEventListener('pointercancel', cancel);
    ph.addEventListener('lostpointercapture', cancel);
  },

  // Release anywhere: the layout already on screen is the answer, so committing
  // is just writing the arrangement the solver last resolved.
  _commitDrag(panel) {
    const d = this._drag;
    if (!d) return;
    const { name, ci, idx } = d;
    this._drag = null;
    if (panel) panel.classList.remove('fluid-dragging');
    document.body.classList.remove('fluid-active');

    if (ci >= 0 && idx >= 0) this._applyMove(name, ci, idx);
    this._persist();
    this.request();
  },

  _cancelDrag(panel) {
    const d = this._drag;
    if (!d) return;
    this._drag = null;
    if (panel) panel.classList.remove('fluid-dragging');
    else document.querySelectorAll('.fluid-dragging').forEach((p) => p.classList.remove('fluid-dragging'));
    document.body.classList.remove('fluid-active');
    // Restore the arrangement captured at grab time; the animator eases back.
    layout._cols = d.prevCols;
    this.request();
  },

  // Move a panel to (ci, idx) in canonical state, preserving its own hf and
  // renormalising both the column it left and the one it joined.
  _applyMove(name, ci, idx) {
    const cols = layout._cols;
    let slot = null;
    for (const col of cols) {
      const i = col.findIndex((s) => s.name === name);
      if (i >= 0) { slot = col.splice(i, 1)[0]; break; }
    }
    if (!slot) return;
    // idx was computed against active panels only; map it onto the full column
    // so minimized entries keep their place in the canonical order.
    const target = cols[ci];
    let seen = 0, at = target.length;
    for (let i = 0; i < target.length; i++) {
      if (layout._minimized.has(layout._panel(target[i].name))) continue;
      if (seen === idx) { at = i; break; }
      seen++;
    }
    target.splice(at, 0, slot);
    this._normalise(cols);
  },

  _normalise(cols) {
    cols.forEach((col) => {
      if (!col.length) return;
      const sum = col.reduce((s, t) => s + t.hf, 0) || 1;
      col.forEach((s) => { s.hf = Math.max(this.MIN_HF, s.hf / sum); });
      // The second pass renormalises, which can push a clamped panel back under
      // MIN_HF. It holds while a column has fewer than 1/MIN_HF panels (16 at
      // 0.06); there are ten panels in total, so the floor cannot be defeated
      // here. Revisit if columns ever grow.
      const sum2 = col.reduce((s, t) => s + t.hf, 0);
      col.forEach((s) => { s.hf = s.hf / sum2; });
    });
  },

  // ── Resize ─────────────────────────────────────────────────────────────────
  // Same solver, same animator: a resize is just another disturbance, so the
  // panels below it flow exactly the way they do during a drag.
  _onResize(e, panel, handle, dir) {
    if (!this._engaged()) return;
    if (this._drag || this._resize) return;
    e.preventDefault();
    e.stopPropagation();
    try { handle.setPointerCapture(e.pointerId); } catch (_) {}

    const name = panel.dataset.panel;
    let ci = -1, i = -1;
    layout._cols.forEach((col, c) => {
      const k = col.findIndex((s) => s.name === name);
      if (k >= 0) { ci = c; i = k; }
    });
    if (ci < 0) return;

    // 'n' resizes against the panel above, 's' against the one below.
    const active = layout._activePanels(ci);
    const ai = active.findIndex((s) => s.name === name);
    const partner = dir === 's' ? active[ai + 1] : active[ai - 1];
    if (!partner) return;
    const self = active[ai];

    this._resize = {
      name, ci,
      y0: e.clientY,
      selfSlot: self,
      partnerSlot: partner,
      hfSelf0: self.hf,
      hfPartner0: partner.hf,
      sign: dir === 's' ? 1 : -1,
      prevCols: layout._cols.map((c) => c.map((s) => ({ ...s }))),
    };
    document.body.classList.add('fluid-active', 'fluid-settling');
    panel.classList.add('fluid-resizing');
    this.request();

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId || !this._resize) return;
      const r = this._resize;
      const da = layout._dataArea();
      const totalH = da.height - layout.GAP * (active.length - 1);
      const sum = active.reduce((s, t) => s + t.hf, 0) || 1;
      // Convert pixel travel into a height fraction, moving it from one panel to
      // the other so the column's total is conserved and nothing else shifts.
      const dHf = ((ev.clientY - r.y0) * r.sign / totalH) * sum;
      const a = Math.max(this.MIN_HF, r.hfSelf0 + dHf);
      const b = Math.max(this.MIN_HF, r.hfPartner0 - dHf);
      const scale = (r.hfSelf0 + r.hfPartner0) / (a + b);
      r.selfSlot.hf = a * scale;
      r.partnerSlot.hf = b * scale;
      this.request();
    };
    const end = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      this._resize = null;
      panel.classList.remove('fluid-resizing');
      document.body.classList.remove('fluid-active');
      this._persist();
      this.request();
    };
    const cancel = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', cancel);
      handle.removeEventListener('lostpointercapture', cancel);
      this._cancelResize();
      panel.classList.remove('fluid-resizing');
    };

    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', cancel);
    handle.addEventListener('lostpointercapture', cancel);
  },

  _cancelResize() {
    if (!this._resize) return;
    layout._cols = this._resize.prevCols;
    const panel = layout._panel(this._resize.name);
    this._resize = null;
    // Cleared here rather than only in the pointer handler: a viewport change
    // cancels through this path directly, and a stranded .fluid-resizing keeps
    // the panel pinned above its neighbours at z-index 55.
    if (panel) panel.classList.remove('fluid-resizing');
    document.body.classList.remove('fluid-active');
    this.request();
  },

  // ═════════════════════════════════════════════════════════════════════════
  // KEYBOARD — a full equivalent, not a token one.
  // ═════════════════════════════════════════════════════════════════════════

  _onKey(e, name) {
    if (!this._engaged()) return;
    // A pointer interaction holds a snapshot of _cols for its cancel path.
    // Mutating the layout underneath it would make a later cancel silently
    // discard this move, so the keyboard yields while a pointer is down.
    if (this._drag || this._resize) return;
    if (!e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home'].includes(k)) return;
    e.preventDefault();
    e.stopPropagation();

    if (k === 'Home') {
      // layout._reset() rather than rebuilding _cols by hand: it also clears
      // minimized panels and refreshes the restore bar, so the keyboard path
      // and the context menu's "reset layout" now do the same thing.
      layout._reset();
      this._announce('Layout reset to default, all panels shown');
      this.request();
      return;
    }

    let ci = -1, ai = -1;
    layout._cols.forEach((col, c) => {
      const act = layout._activePanels(c);
      const k2 = act.findIndex((s) => s.name === name);
      if (k2 >= 0) { ci = c; ai = k2; }
    });
    if (ci < 0) return;

    if (e.shiftKey && (k === 'ArrowUp' || k === 'ArrowDown')) {
      // Resize: move 4% of the column between this panel and its neighbour.
      const act = layout._activePanels(ci);
      const partner = k === 'ArrowDown' ? act[ai + 1] : act[ai - 1];
      if (!partner) return;
      const self = act[ai];
      const step = 0.04 * (k === 'ArrowDown' ? 1 : -1);
      const a = Math.max(this.MIN_HF, self.hf + step);
      const b = Math.max(this.MIN_HF, partner.hf - step);
      const scale = (self.hf + partner.hf) / (a + b);
      self.hf = a * scale;
      partner.hf = b * scale;
      this._announce(
        (layout._LABEL[name] || name) + ' resized to ' + Math.round(self.hf * 100) + ' percent of its column');
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      const to = ai + (k === 'ArrowDown' ? 1 : -1);
      const act = layout._activePanels(ci);
      if (to < 0 || to >= act.length) return;
      this._applyMove(name, ci, to);
      this._announce(
        (layout._LABEL[name] || name) + ' moved to position ' + (to + 1) + ' of ' + act.length);
    } else {
      const to = ci + (k === 'ArrowRight' ? 1 : -1);
      if (to < 0 || to >= layout.COL_WF.length) return;
      const destLen = layout._activePanels(to).length;
      const idx = Math.min(ai, destLen);
      this._applyMove(name, to, idx);
      this._announce(
        (layout._LABEL[name] || name) + ' moved to column ' + (to + 1) + ', position ' + (idx + 1));
    }

    this._persist();
    this.request();
  },

  // The restore bar clips past its max-width. Scrolling makes every chip
  // reachable; this keeps the fade honest and lets a plain wheel scroll it,
  // since a horizontal scroll otherwise needs shift and nobody guesses that.
  _wireRestoreBar() {
    const inner = $('rb-chips');
    if (!inner || inner._fluidWired) return;
    inner._fluidWired = true;

    const sync = () => {
      const more = inner.scrollWidth - inner.clientWidth - inner.scrollLeft > 2;
      inner.classList.toggle('rb-more', more);
      inner.classList.toggle('rb-more-start', inner.scrollLeft > 2);
    };
    inner.addEventListener('scroll', sync, { passive: true });
    inner.addEventListener('wheel', (e) => {
      if (inner.scrollWidth <= inner.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      inner.scrollLeft += e.deltaY;
    }, { passive: false });
    // Chips are rebuilt wholesale on every minimize/restore.
    new MutationObserver(sync).observe(inner, { childList: true });
    window.addEventListener('resize', sync);
    sync();
  },

  _buildLiveRegion() {
    if (this._live) return;
    const el = document.createElement('div');
    el.className = 'sr-only';
    el.setAttribute('aria-live', 'polite');
    el.setAttribute('aria-atomic', 'true');
    el.id = 'fluid-live';
    document.body.appendChild(el);
    this._live = el;
  },

  _announce(msg) {
    if (this._live) this._live.textContent = msg;
  },

  // ═════════════════════════════════════════════════════════════════════════
  // PERSISTENCE — final resolved layout only, and never corrupting memory.
  // ═════════════════════════════════════════════════════════════════════════

  // Uses layout._save, so the on-disk format and key are unchanged and a layout
  // written here still loads if this experiment is reverted.
  // Takes no rollback argument on purpose. If the write fails the layout on
  // screen is still valid and still what the user asked for; reverting it would
  // undo their work to match a disk that could not be written.
  _persist() {
    try {
      layout._save();
    } catch (err) {
      console.error('[fluid] layout persist failed', err);
      if (typeof toastStack !== 'undefined') {
        toastStack.add('layout not saved — it will reset on reload', 'warn');
      }
    }
  },
};
