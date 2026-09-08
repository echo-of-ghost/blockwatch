"use strict";
// Fluid layout engine validation.
//
// Drives the real window over CDP so the actual pointer handlers — pointer
// capture included — are exercised, rather than synthetic DOM events that can
// pass while the product is broken.
//
// Three rules this suite follows, each learned from a defect it failed to catch
// before:
//
//   1. Assert direction, not difference. "Something changed" passes when the
//      engine moves a neighbour the wrong way. Every motion check below states
//      which way, and by roughly how much.
//   2. Wait on conditions, never on the clock. Fixed sleeps made results depend
//      on machine load; `settled()` and `waitFor()` observe the engine instead.
//   3. Undo every page-side patch in a `finally`. A patch left installed by a
//      throwing assertion poisons every test after it, and the run then reports
//      failures that have nothing to do with the change under test.

const { connect, focusAndPrime, ensureFocus } = require("./lib/cdp");
const { runSuite } = require("./lib/harness");

const PORT = process.env.BW_PORT || 3020;
const CDP = process.env.BW_CDP || 9333;
const PANELS = 10;

// The structural guarantees the engine must never violate, evaluated in the
// page. Defined once and reinstalled after every reload, because a reload
// discards the document this lives on.
const INV_PROBE = `(() => {
  window.__inv = () => {
    const cols = layout._cols;
    const names = cols.flat().map(s => s.name);
    const da = layout._dataArea();
    const boxes = [...fluid._solve()].map(([n, r]) => ({ n, ...r }));
    let overlap = null, outside = null;
    for (let i = 0; i < boxes.length; i++) {
      const a = boxes[i];
      if (a.x < da.left - 2 || a.x + a.w > da.left + da.width + 2 ||
          a.y < da.top - 2 || a.y + a.h > da.top + da.height + 2) outside = a.n;
      for (let j = i + 1; j < boxes.length; j++) {
        const b = boxes[j];
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 1 && oy > 1) overlap = a.n + " over " + b.n;
      }
    }
    // The height fractions of the ACTIVE panels in a column sum to 1. A
    // minimized panel keeps its own hf so restore() can give the share back
    // (layout._redistributeHf / _normaliseHf), so summing every slot is only
    // correct when nothing is hidden — and asserting that instead reports a
    // failure every time a panel is minimized, which is normal behaviour.
    const active = cols.map(c => c.filter(x => !layout._minimized.has(layout._panel(x.name))));
    const sums = active.map(c => c.length ? +c.reduce((s, x) => s + x.hf, 0).toFixed(4) : 1);
    const badCol = sums.findIndex(s => Math.abs(s - 1) > 0.01);
    return { count: names.length, unique: new Set(names).size, overlap, outside,
      badSum: badCol < 0 ? null : sums[badCol],
      badCol: badCol < 0 ? null : badCol,
      // Dumped only when something is wrong, so a failure explains itself
      // instead of sending the reader back to the console.
      dump: badCol < 0 ? null : cols[badCol].map(s =>
        s.name + ':' + s.hf.toFixed(3) +
        (layout._minimized.has(layout._panel(s.name)) ? '(hidden)' : '')).join(' '),
      minimized: layout._minimized.size,
      minHf: +Math.min(...cols.flat().map(s => s.hf)).toFixed(4), MIN_HF: fluid.MIN_HF };
  };
  return true; })()`;

runSuite("fluid layout engine", async (t) => {
  t.expect(108);

  const cdp = await connect({ cdpPort: CDP, dashboardPort: PORT });
  try {
    await focusAndPrime(cdp);
    await run(t, cdp);
  } finally {
    await cdp.close();
  }
});

async function run(t, cdp) {
  // ── helpers ───────────────────────────────────────────────────────────────
  const ev = (e) => cdp.eval(e);
  const js = (e) => cdp.json(e);

  // Installed once here and again after every reload.
  await ev(INV_PROBE);

  // Every structural guarantee in one assertion, reusable and self-describing.
  const invariantsHold = async () => {
    const i = await js("window.__inv()");
    const bad = [];
    if (i.count !== PANELS) bad.push(`count ${i.count}`);
    if (i.unique !== PANELS) bad.push(`unique ${i.unique}`);
    if (i.overlap) bad.push(`overlap ${i.overlap}`);
    if (i.outside) bad.push(`outside data area: ${i.outside}`);
    if (i.badSum !== null) {
      bad.push(`column ${i.badCol} hf sums to ${i.badSum} [${i.dump}] ` +
               `(${i.minimized} minimized)`);
    }
    if (i.minHf < i.MIN_HF - 0.001) bad.push(`hf ${i.minHf} below MIN_HF ${i.MIN_HF}`);
    return { ok: bad.length === 0, why: bad.join("; ") || "all invariants hold" };
  };
  const checkInvariants = (label) => {
    let why = "";
    return t.check(label, async () => {
      const r = await invariantsHold();
      why = r.why;
      return r.ok;
    }, () => why);
  };

  const reset = async () => {
    await ev(`([...layout._minimized.keys()].forEach(p => layout.restore(p)),
      layout._cols = layout._DEFAULT_COLS.map(c => c.map(s => ({ ...s }))),
      layout._save(), fluid.request(), true)`);
    // restore() finishes in an animation callback, so wait for the state rather
    // than assuming the call completed the work.
    await cdp.waitFor("layout._minimized.size === 0",
      { timeout: 6000, label: "all panels restored" });
    await cdp.settled();
  };

  const headerAt = (name) => js(
    `(() => { const p = document.querySelector('[data-panel="${name}"] .ph');
       const r = p.getBoundingClientRect();
       return { x: r.left + 40, y: r.top + r.height / 2 }; })()`);
  const cols = () => js(`layout._cols.map(c => c.map(s => s.name))`);
  const whereIs = (name) => js(
    `(() => { for (let c = 0; c < layout._cols.length; c++) {
        const i = layout._cols[c].findIndex(s => s.name === '${name}');
        if (i >= 0) return { ci: c, idx: i }; } return { ci: -1, idx: -1 }; })()`);
  // Painted position, read from the DOM rather than from engine state, so a
  // solver that agrees with itself but not with the screen is still caught.
  const posOf = (name) => js(
    `(() => { const r = layout._panel('${name}').getBoundingClientRect();
       return { x: Math.round(r.left), y: Math.round(r.top),
                w: Math.round(r.width), h: Math.round(r.height) }; })()`);
  const hfOf = (name) => ev(
    `(() => { for (const c of layout._cols) { const s = c.find(x => x.name === '${name}');
        if (s) return +s.hf.toFixed(4); } return null; })()`);
  const focusHeader = (name) =>
    ev(`(document.querySelector('[data-panel="${name}"] .ph').focus(), true)`);

  // Synthetic pointer moves are paced. "Wait on conditions, not the clock"
  // applies to observing state, not to generating input: a real pointer
  // produces moves roughly every 8-16ms, and dispatching two dozen of them with
  // no gap is a gesture no browser ever sees. Doing so made drags intermittently
  // die mid-traverse, about one run in five.
  const MOVE_MS = 10;
  const moveTo = async (x, y) => {
    await cdp.mouse("mouseMoved", x, y);
    await new Promise((r) => setTimeout(r, MOVE_MS));
  };

  // Getting a drag started is synthetic-input plumbing, not the behaviour under
  // test. CDP presses are occasionally dropped by the compositor — the same
  // reason focusAndPrime() retries — and when that happened here it failed a
  // *precondition*, so the suite reported a flake instead of a result. This
  // retries the grab, and reports how many attempts it took so a drag that
  // needs retrying is still visible rather than silently smoothed over.
  const startDrag = async (name, dx, dy, attempts = 3) => {
    let h = null;
    for (let a = 1; a <= attempts; a++) {
      await ensureFocus(cdp);
      h = await headerAt(name);
      await cdp.mouse("mousePressed", h.x, h.y);
      await moveTo(h.x + dx, h.y + dy);
      try {
        await cdp.waitFor("!!fluid._drag", { timeout: 1500, label: "drag started" });
        return { ok: true, h, tries: a };
      } catch (_) {
        // Leave nothing half-held before trying again.
        await cdp.mouse("mouseReleased", h.x + dx, h.y + dy);
        await ev(`(fluid._drag ? (fluid._cancelDrag(layout._panel('${name}')), true) : true)`);
        await cdp.settled().catch(() => {});
      }
    }
    return { ok: false, h, tries: attempts };
  };
  // Same reasoning as startDrag, for the resize handles. A failed attempt never
  // started a resize, so nothing moved and the retry measures the same geometry.
  const startResize = async (box, dx, dy, attempts = 3) => {
    for (let a = 1; a <= attempts; a++) {
      await ensureFocus(cdp);
      await cdp.mouse("mousePressed", box.x, box.y);
      await moveTo(box.x + dx, box.y + dy);
      try {
        await cdp.waitFor("!!fluid._resize", { timeout: 1500, label: "resize started" });
        return { ok: true, tries: a };
      } catch (_) {
        await cdp.mouse("mouseReleased", box.x + dx, box.y + dy);
        await ev(`(fluid._resize ? (fluid._cancelResize(), true) : true)`);
        await cdp.settled().catch(() => {});
      }
    }
    return { ok: false, tries: attempts };
  };

  const grabNote = (g) => g.tries > 1 ? `grab took ${g.tries} attempts` : "";

  // Becoming live is a condition to wait for, not to sample: the pointer
  // handler runs after the input event is acknowledged, so an immediate read
  // occasionally lost the race and reported a drag that had not started yet.
  const gestureLive = (expr, label) => () => cdp
    .waitFor(expr, { timeout: 3000, label }).then(() => true).catch(() => false);

  await reset();

  // ── the engine is live and owns the layout ────────────────────────────────
  t.section("engine state");
  await t.require("engine engaged", () => ev(`fluid.active === true`));
  await t.check("the classic drag and resize code is gone, not merely bypassed",
    () => ev(`['_initDrag','_initResize','_findColumnInsert','_insertPanel','_swapPanels']
      .every(k => typeof layout[k] === 'undefined')`),
    () => ev(`['_initDrag','_initResize','_findColumnInsert','_insertPanel','_swapPanels']
      .filter(k => typeof layout[k] !== 'undefined').join(',') || '(all removed)'`));
  await t.check("layout dispatches to the engine rather than being monkey-patched",
    () => ev(`typeof layout._renderPanels === 'function' &&
      /fluid/.test(layout._render.toString()) && !/fluid/.test(layout._renderPanels.toString())`));
  await t.check("resize handles exist on every panel for the engine to bind",
    () => ev(`[...document.querySelectorAll('.panel')]
      .every(p => p.querySelectorAll('.resize-handle').length === 2)`));
  await t.check("all panels registered", async () => (await ev(`fluid._panels.size`)) === PANELS,
    () => ev(`fluid._panels.size + ' registered'`));
  await t.check("no state/DOM divergence when settled", async () => {
    const worst = await ev(`(() => {
      const t = fluid._solve(); let worst = 0;
      for (const [name, r] of t) {
        const el = layout._panel(name); if (!el) continue;
        const m = /translate3d\\((-?\\d+)px,\\s*(-?\\d+)px/.exec(el.style.transform);
        if (!m) return 9999;
        worst = Math.max(worst, Math.abs(+m[1] - Math.round(r.x)), Math.abs(+m[2] - Math.round(r.y)),
          Math.abs(parseInt(el.style.width) - Math.round(r.w)),
          Math.abs(parseInt(el.style.height) - Math.round(r.h)));
      } return worst; })()`);
    return worst <= 1;
  }, "solver and DOM agree to within 1px");
  await checkInvariants("layout invariants hold at rest");

  // ── a drag reflows neighbours live, in the right direction ────────────────
  t.section("drag: live reflow");
  await ensureFocus(cdp);
  await reset();
  const before = await cols();
  // 'services' sits below 'node' in column 0. Pulling it up must push 'node'
  // DOWN — the direction is the point, not merely that something moved.
  const nodeY0 = (await posOf("node")).y;
  let g;                       // last gesture result, reused across sections
  let h = await headerAt("services");
  await cdp.mouse("mousePressed", h.x, h.y);
  await moveTo(h.x + 8, h.y - 8);
  await t.require("drag begins after a threshold",
    gestureLive("!!fluid._drag", "drag started"));
  await moveTo(h.x + 10, h.y - 420);
  await cdp.waitFor(`layout._panel('node').getBoundingClientRect().top > ${nodeY0} + 4`,
    { timeout: 3000, label: "displaced neighbour moves down" }).catch(() => {});
  const nodeYMid = (await posOf("node")).y;
  await t.check("the displaced neighbour moves DOWN during the drag, not on release",
    () => nodeYMid > nodeY0 + 4, `node y ${nodeY0} -> ${nodeYMid}`);
  await t.check("the dragged panel is pinned to the pointer", () => ev(`(() => {
    const e = fluid._panels.get('services');
    return Math.abs((e.cur.y + fluid._drag.grabY) - fluid._drag.cy) < 1.5; })()`));
  await t.check("body marked active so stray hits cannot land",
    () => ev(`document.body.classList.contains('fluid-active')`));
  await t.check("the dragged panel is marked for the drag styling",
    () => ev(`layout._panel('services').classList.contains('fluid-dragging')`));
  await cdp.mouse("mouseReleased", h.x + 10, h.y - 420);
  await cdp.settled();
  const after = await cols();
  await t.check("release commits a real reorder",
    () => JSON.stringify(before) !== JSON.stringify(after), JSON.stringify(after[0]));
  await t.check("the drag class is cleared on release",
    () => ev(`!document.querySelector('.fluid-dragging') &&
      !document.body.classList.contains('fluid-active')`));
  await checkInvariants("layout invariants hold after a drag");

  // ── cross-column diagonal traverse ────────────────────────────────────────
  t.section("drag: cross-column");
  await ensureFocus(cdp);
  await reset();
  const startCol = (await whereIs("services")).ci;
  const target = await js(
    `(() => { const r = document.querySelector('[data-panel="peers"]').getBoundingClientRect();
       return { x: r.left + r.width / 2, y: r.top + 60 }; })()`);
  g = await startDrag("services", 10, 10);
  h = g.h;
  await t.require("a drag is live before the traverse", () => g.ok, grabNote(g));
  let diedAt = 0;
  for (let i = 1; i <= 24; i++) {
    await moveTo(h.x + (target.x - h.x) * (i / 24), h.y + (target.y - h.y) * (i / 24));
    if (!diedAt && i % 4 === 0 && !(await ev(`!!fluid._drag`))) diedAt = i;
  }
  await t.check("the drag survives a long multi-panel traverse", () => diedAt === 0,
    diedAt ? `drag was gone by move ${diedAt} of 24` : "alive for all 24 moves");
  const dragColMid = await ev(`fluid._drag ? fluid._drag.ci : -1`);
  await t.check("the column target tracks the pointer mid-flight",
    () => dragColMid !== startCol && dragColMid >= 0, `col ${startCol} -> ${dragColMid}`);
  await t.check("the dragged panel morphs toward its destination width", () => ev(`(() => {
    if (!fluid._drag) return false;
    const w = parseInt(layout._panel('services').style.width);
    const da = layout._dataArea();
    const dest = layout._colGeom(fluid._drag.ci, da).w;
    const src = layout._colGeom(${startCol}, da).w;
    return Math.abs(w - dest) < Math.abs(w - src); })()`));
  await cdp.mouse("mouseReleased", target.x, target.y);
  await cdp.settled();
  const landed = await whereIs("services");
  await t.check("a diagonal cross-dashboard drag lands where it was released",
    () => landed.ci === dragColMid, `released over col ${dragColMid}, landed in ${landed.ci}`);
  await checkInvariants("layout invariants hold after a cross-column drag");

  // ── thrash ────────────────────────────────────────────────────────────────
  t.section("drag: rapid reversal");
  await ensureFocus(cdp);
  await reset();
  g = await startDrag("mining", 20, 20);
  h = g.h;
  await t.require("a drag is live before thrashing it", () => g.ok, grabNote(g));
  for (let i = 0; i < 30; i++) {
    await moveTo(h.x + (i % 2 ? 340 : -340), h.y + (i % 3) * 90);
  }
  await cdp.mouse("mouseReleased", h.x, h.y);
  await cdp.settled();
  await checkInvariants("rapid back-and-forth leaves a valid layout");
  await t.check("no panel is left below the minimum height fraction", async () => {
    const i = await js("window.__inv()");
    return i.minHf >= i.MIN_HF - 0.001;
  }, async () => { const i = await js("window.__inv()"); return `min hf ${i.minHf}, floor ${i.MIN_HF}`; });

  // ── cancellation ──────────────────────────────────────────────────────────
  t.section("drag: cancellation");
  await ensureFocus(cdp);
  await reset();
  const preCancel = await cols();
  g = await startDrag("chain", 400, 200);
  h = g.h;
  await t.require("a drag is live before cancelling", () => g.ok, grabNote(g));
  await ev(`(fluid._cancelDrag(layout._panel('chain')), true)`);
  await cdp.mouse("mouseReleased", h.x + 400, h.y + 200);
  await cdp.settled();
  await t.check("a cancelled drag restores the previous layout",
    async () => JSON.stringify(await cols()) === JSON.stringify(preCancel));
  await t.check("cancelling clears the drag state and its class",
    () => ev(`!fluid._drag && !document.querySelector('.fluid-dragging')`));

  // ── window resize mid-drag ────────────────────────────────────────────────
  // A viewport change while a pointer is down used to be the obvious way to
  // strand `_drag` against stale geometry.
  t.section("drag: viewport change mid-drag");
  await ensureFocus(cdp);
  await reset();
  g = await startDrag("chain", 60, 120);
  h = g.h;
  await t.require("a drag is live before the viewport changes", () => g.ok, grabNote(g));
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
  await cdp.mouse("mouseReleased", h.x + 60, h.y + 120);
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await cdp.waitFor("!fluid._drag", { timeout: 5000, label: "drag released" }).catch(() => {});
  await cdp.settled({ timeout: 12000 }).catch(() => {});
  await t.check("a viewport change mid-drag leaves no stranded drag state",
    () => ev(`!fluid._drag && !document.body.classList.contains('fluid-active')`),
    () => ev(`'drag=' + JSON.stringify(!!fluid._drag) + ' activeClass=' +
      document.body.classList.contains('fluid-active')`));
  await checkInvariants("layout invariants survive a viewport change mid-drag");

  // ── resize ────────────────────────────────────────────────────────────────
  t.section("resize");
  await ensureFocus(cdp);
  await reset();
  const nodeHf0 = await hfOf("node");
  const partner = await ev(
    `(() => { const a = layout._activePanels(0); const i = a.findIndex(s => s.name === 'node');
       return a[i + 1] ? a[i + 1].name : null; })()`);
  await t.require("node has a neighbour below it to trade height with", () => partner !== null,
    "partner: " + partner);
  const partnerHf0 = await hfOf(partner);
  const partnerY0 = (await posOf(partner)).y;
  const rh = await js(
    `(() => { const el = document.querySelector('[data-panel="node"] .resize-handle[data-dir="s"]');
       if (!el) return null; const r = el.getBoundingClientRect();
       const p = el.closest('.panel').getBoundingClientRect();
       // .panel is overflow:hidden, so stay inside its box or the press is lost.
       return { x: r.left + r.width / 2, y: Math.min(r.top + r.height / 2, p.bottom - 3) }; })()`);
  await t.require("the south resize handle is hit-testable", () => rh !== null,
    "handle box: " + JSON.stringify(rh));
  const rg = await startResize(rh, 0, -90);
  await t.require("a resize is live", () => rg.ok, grabNote(rg));
  await cdp.waitFor(`layout._panel('${partner}').getBoundingClientRect().top < ${partnerY0} - 4`,
    { timeout: 3000, label: "neighbour rises" }).catch(() => {});
  const partnerYMid = (await posOf(partner)).y;
  await t.check("dragging the south edge UP moves the neighbour UP, live",
    () => partnerYMid < partnerY0 - 4, `${partner} y ${partnerY0} -> ${partnerYMid}`);
  await t.check("the resizing panel is marked for the resize styling",
    () => ev(`layout._panel('node').classList.contains('fluid-resizing')`));
  await cdp.mouse("mouseReleased", rh.x, rh.y - 90);
  await cdp.settled();
  const nodeHf1 = await hfOf("node");
  const partnerHf1 = await hfOf(partner);
  await t.check("shrinking a panel lowers its own height fraction",
    () => nodeHf1 < nodeHf0 - 0.005, `node hf ${nodeHf0} -> ${nodeHf1}`);
  await t.check("the height it gave up went to its neighbour",
    () => partnerHf1 > partnerHf0 + 0.005, `${partner} hf ${partnerHf0} -> ${partnerHf1}`);
  await t.check("the pair conserves its combined share",
    () => Math.abs((nodeHf1 + partnerHf1) - (nodeHf0 + partnerHf0)) < 0.01,
    `${(nodeHf0 + partnerHf0).toFixed(4)} -> ${(nodeHf1 + partnerHf1).toFixed(4)}`);
  await checkInvariants("layout invariants hold after a resize");

  // The north handle is the mirror path and had no coverage at all.
  t.section("resize: north handle");
  await ensureFocus(cdp);
  await reset();
  const nh = await js(
    `(() => { const a = layout._activePanels(0); if (a.length < 2) return null;
       const el = document.querySelector('[data-panel="' + a[1].name + '"] .resize-handle[data-dir="n"]');
       if (!el) return null; const r = el.getBoundingClientRect();
       const p = el.closest('.panel').getBoundingClientRect();
       return { name: a[1].name, above: a[0].name,
                x: r.left + r.width / 2, y: Math.max(r.top + r.height / 2, p.top + 3) }; })()`);
  await t.require("the north resize handle is hit-testable", () => nh !== null,
    "handle box: " + JSON.stringify(nh));
  const aboveHf0 = await hfOf(nh.above);
  const ng = await startResize(nh, 0, 80);
  await t.require("a north-handle resize is live", () => ng.ok, grabNote(ng));
  await cdp.mouse("mouseReleased", nh.x, nh.y + 80);
  await cdp.settled();
  const aboveHf1 = await hfOf(nh.above);
  await t.check("dragging the north edge DOWN grows the panel above",
    () => aboveHf1 > aboveHf0 + 0.005, `${nh.above} hf ${aboveHf0} -> ${aboveHf1}`);
  await checkInvariants("layout invariants hold after a north-handle resize");

  // ── keyboard ──────────────────────────────────────────────────────────────
  // Real key events through the browser. dispatchEvent(new KeyboardEvent(...))
  // would pass even if the listener were bound to an element the user can never
  // focus, which is exactly the bug worth catching.
  t.section("keyboard");
  await reset();
  await t.check("panel headers are focusable and labelled", () => ev(
    `(() => { const ph = document.querySelector('[data-panel="mempool-viz"] .ph');
       return ph.tabIndex === 0 && !!ph.getAttribute('aria-label'); })()`));
  const kbBefore = await whereIs("mempool-viz");
  await focusHeader("mempool-viz");
  await t.require("the header actually took focus", () => ev(
    `document.activeElement === document.querySelector('[data-panel="mempool-viz"] .ph')`),
    () => ev(`document.activeElement.className || document.activeElement.tagName`));
  await cdp.key("ArrowRight", { alt: true });
  await cdp.settled();
  const kbAfter = await whereIs("mempool-viz");
  await t.check("alt+ArrowRight moves a panel one column right",
    () => kbAfter.ci === kbBefore.ci + 1, `col ${kbBefore.ci} -> ${kbAfter.ci}`);
  await t.check("the move is announced to assistive tech",
    () => ev(`/moved to column/i.test(document.getElementById('fluid-live').textContent)`),
    () => ev(`document.getElementById('fluid-live').textContent`));
  const kbHf0 = await hfOf("mempool-viz");
  await focusHeader("mempool-viz");
  await cdp.key("ArrowDown", { alt: true, shift: true });
  await cdp.settled();
  const kbHf1 = await hfOf("mempool-viz");
  await t.check("alt+shift+ArrowDown GROWS the panel, without a pointer",
    () => kbHf1 > kbHf0 + 0.005, `hf ${kbHf0} -> ${kbHf1}`);
  await t.check("the resize is announced too",
    () => ev(`/resized to/i.test(document.getElementById('fluid-live').textContent)`),
    () => ev(`document.getElementById('fluid-live').textContent`));
  await focusHeader("mempool-viz");
  await cdp.key("Home", { alt: true });
  await cdp.settled();
  await t.check("alt+Home restores the default layout", () => ev(
    `JSON.stringify(layout._cols.map(c => c.map(s => s.name))) ===
     JSON.stringify(layout._DEFAULT_COLS.map(c => c.map(s => s.name)))`));
  await checkInvariants("layout invariants hold after keyboard moves");

  // ── persistence ───────────────────────────────────────────────────────────
  t.section("persistence");
  await focusHeader("blocks");
  await cdp.key("ArrowLeft", { alt: true });
  await cdp.settled();
  const wanted = await cols();
  await t.check("the layout is persisted under the existing key", () => ev(
    `(() => { const raw = localStorage.getItem(layout._LS_KEY);
       if (!raw) return false;
       const s = JSON.parse(raw);
       return JSON.stringify(s.cols.map(c => c.map(x => x.name))) ===
              JSON.stringify(${JSON.stringify(wanted)}); })()`));
  await t.check("the saved shape still validates against the loader's contract", () => ev(
    `(() => { const s = JSON.parse(localStorage.getItem(layout._LS_KEY));
       const names = s.cols.flat().map(x => x.name).sort();
       const def = layout._DEFAULT_COLS.flat().map(x => x.name).sort();
       return s.cols.length === 4 && names.length === def.length &&
         names.every((n, i) => n === def[i]) &&
         s.cols.every(c => c.every(x => typeof x.hf === 'number' && x.hf > 0)); })()`));

  await reloadPage(cdp);
  await t.check("the layout survives a reload",
    async () => JSON.stringify(await cols()) === JSON.stringify(wanted),
    async () => JSON.stringify(await cols()));
  await t.check("the engine re-engages after a reload",
    () => cdp.waitFor(`fluid.active === true && fluid._panels.size === ${PANELS}`,
      { timeout: 8000, label: "engine re-engaged" }).then(() => true).catch(() => false),
    () => ev(`'active=' + fluid.active + ' panels=' + fluid._panels.size`));

  // ── corrupt persisted state ───────────────────────────────────────────────
  // A truncated or hand-edited localStorage value must not brick the dashboard.
  t.section("persistence: corrupt state");
  for (const [label, value] of [
    ["not JSON at all", `'{"cols":[[{"name":'`],
    ["valid JSON, wrong shape", `JSON.stringify({ cols: "nope" })`],
    ["unknown panel names", `JSON.stringify({ cols: [[{ name: 'ghost', hf: 1 }], [], [], []] })`],
  ]) {
    await ev(`(localStorage.setItem(layout._LS_KEY, ${value}), true)`);
    await reloadPage(cdp);
    await t.check(`recovers from persisted state that is ${label}`, async () => {
      const i = await js("window.__inv()");
      const live = await ev(`fluid.active === true`);
      return live && i.count === PANELS && i.unique === PANELS && !i.overlap;
    }, async () => JSON.stringify(await js("window.__inv()")));
    // __inv is defined per-document, so reinstall it after every reload.
  }
  await ev(`(localStorage.removeItem(layout._LS_KEY), true)`);
  await reloadPage(cdp);
  await reset();

  // ── a failed save must not corrupt memory ─────────────────────────────────
  t.section("persistence: failed save");
  const preSave = await cols();
  // Pick a panel that genuinely has somewhere to go. Targeting a fixed panel
  // meant testing alt+ArrowUp on one already at the top of its column, where the
  // handler correctly returns before saving anything — so the test proved
  // nothing and still passed its weaker assertions.
  const movable = await ev(`(() => {
    for (const c of layout._cols) { if (c.length > 1) return c[1].name; } return null; })()`);
  await t.require("there is a panel with somewhere to move", () => movable !== null,
    "chose: " + movable);
  const movedFrom = (await whereIs(movable)).idx;
  await cdp.withPatch(
    `(() => { window.__realSet = localStorage.setItem.bind(localStorage);
       window.__saveThrew = 0;
       localStorage.setItem = () => { window.__saveThrew++; throw new Error('quota exceeded'); };
       return true; })()`,
    `(() => { if (window.__realSet) localStorage.setItem = window.__realSet; return true; })()`,
    async () => {
      await focusHeader(movable);
      await cdp.key("ArrowUp", { alt: true });
      await cdp.settled();
      await t.check("the save was actually attempted and did throw",
        async () => (await ev(`window.__saveThrew`)) > 0,
        async () => (await ev(`window.__saveThrew`)) + " throwing calls");
      // The point of the test: the move still applied in memory. Asserting only
      // "10 unique names" would pass even if the move had been silently rolled
      // back or never made.
      const movedTo = (await whereIs(movable)).idx;
      await t.check("the move still applied in memory despite the save failing",
        () => movedTo === movedFrom - 1, `index ${movedFrom} -> ${movedTo}`);
      await t.check("the layout is not left half-applied",
        async () => (await invariantsHold()).ok,
        async () => (await invariantsHold()).why);
      await t.check("the previous layout was not silently restored",
        async () => JSON.stringify(await cols()) !== JSON.stringify(preSave));
    });
  await t.check("localStorage works again once the failure is removed", () => ev(
    `(() => { try { localStorage.setItem('__probe', '1'); localStorage.removeItem('__probe');
       return true; } catch (e) { return false; } })()`));

  // ── reduced motion ────────────────────────────────────────────────────────
  // Driven through the media query, so the app's own matchMedia listener is
  // what flips the flag. Setting fluid._reduced by hand tested nothing but the
  // branch it was set for.
  t.section("reduced motion");
  await reset();
  await cdp.send("Emulation.setEmulatedMedia",
    { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
  try {
    await t.check("the engine observes the media query itself",
      () => cdp.waitFor(`fluid._reduced === true`,
        { timeout: 4000, label: "fluid._reduced follows the media query" }).then(() => true).catch(() => false),
      () => ev(`'fluid._reduced=' + fluid._reduced`));
    await ev(`(layout._cols = layout._DEFAULT_COLS.map(c => c.map(s => ({ ...s }))), fluid.request(), true)`);
    await cdp.settled();
    await t.check("reduced motion snaps to the target instead of easing", () => ev(`(() => {
      const t = fluid._solve(); let worst = 0;
      for (const [name, r] of t) {
        const e = fluid._panels.get(name); if (!e || !e.cur) continue;
        worst = Math.max(worst, Math.abs(e.cur.y - r.y));
      } return worst < 1.5; })()`));
  } finally {
    await cdp.send("Emulation.setEmulatedMedia", { features: [] });
    await cdp.waitFor(`fluid._reduced === false`, { timeout: 4000 }).catch(() => {});
  }
  await t.check("motion is restored when the preference is cleared",
    async () => (await ev(`fluid._reduced`)) === false);

  // ── responsive ────────────────────────────────────────────────────────────
  t.section("responsive");
  await reset();
  await cdp.send("Emulation.setDeviceMetricsOverride",
    { width: 700, height: 900, deviceScaleFactor: 1, mobile: false });
  try {
    // `_engaged()` reads breakpoint flags that layout's own 60ms resize handler
    // updates, but the engine hands the panels back on a 110ms debounce. Waiting
    // on the predicate therefore races the release it is supposed to observe;
    // the class going away is the signal that _release() actually ran.
    await t.check("the engine disengages on narrow viewports",
      () => cdp.waitFor(
        `!fluid._engaged() && !document.getElementById('main').classList.contains('fluid-on')`,
        { timeout: 6000, label: "engine released the panels" })
        .then(() => true).catch(() => false));
    await t.check("it clears the coordinates it owned rather than freezing them",
      () => ev(`[...fluid._panels.values()].every(e => !e.el.style.transform)`),
      () => ev(`[...fluid._panels.values()].map(e => e.el.style.transform).find(Boolean) || '(all clear)'`));
    await t.check("it drops the fluid-on class",
      () => ev(`!document.getElementById('main').classList.contains('fluid-on')`));
    await t.check("panel headers stop suppressing touch scroll below the breakpoint",
      () => ev(`getComputedStyle(document.querySelector('[data-panel="chain"] .ph')).touchAction !== 'none'`),
      () => ev(`getComputedStyle(document.querySelector('[data-panel="chain"] .ph')).touchAction`));
  } finally {
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: 1920, height: 1200, deviceScaleFactor: 1, mobile: false });
  }
  await t.check("it re-engages, repaints and restores the grab surface on return to desktop",
    () => cdp.waitFor(
      `fluid._engaged() && document.getElementById('main').classList.contains('fluid-on') &&
       getComputedStyle(document.querySelector('[data-panel="chain"] .ph')).touchAction === 'none' &&
       [...fluid._panels.values()].every(e => !!e.el.style.transform)`,
      { timeout: 8000, label: "re-engaged" }).then(() => true).catch(() => false));
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await cdp.settled({ timeout: 12000 }).catch(() => {});
  await checkInvariants("layout invariants hold after viewport changes");

  // ── hide and restore ──────────────────────────────────────────────────────
  // The defect this guards: a CSS animation on `transform` outranked the inline
  // transform and dropped the panel to the container's origin for a few frames.
  t.section("hide and restore");
  await reset();
  const origin = await js(
    `(() => { const r = document.getElementById('main').getBoundingClientRect();
       return { x: Math.round(r.left), y: Math.round(r.top) }; })()`);
  const slot = await posOf("services");
  // "At the origin" is measured against the real container, not a hardcoded box.
  const nearOrigin = (f) => Math.abs(f.x - origin.x) < 40 && Math.abs(f.y - origin.y) < 40;
  await t.require("the panel's resting slot is not itself near the container origin",
    () => !nearOrigin(slot), `slot ${JSON.stringify(slot)} vs origin ${JSON.stringify(origin)}`);

  const sampler = (name, ms) => `(async () => {
    const el = layout._panel('${name}'); const out = []; const t0 = performance.now();
    return await new Promise(res => { const step = () => {
      const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
      out.push({ x: Math.round(r.left), y: Math.round(r.top),
                 vis: cs.display === 'none' ? 'none' : cs.visibility });
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(step); else res(JSON.stringify(out));
    }; requestAnimationFrame(step); }); })()`;

  const hideP = ev(sampler("services", 700));
  // minimize() does its bookkeeping inside an animation callback, so the state
  // it changes is not observable when the call returns.
  await ev(`(layout.minimize(layout._panel('services')), true)`);
  await cdp.waitFor(`layout._minimized.has(layout._panel('services'))`,
    { timeout: 5000, label: "panel minimized" }).catch(() => {});
  const hideFrames = JSON.parse(await hideP);
  const badHide = hideFrames.filter((f) => f.vis !== "none" && nearOrigin(f));
  await t.check("hiding a panel never renders it at the container origin",
    () => badHide.length === 0, `${badHide.length} bad frames of ${hideFrames.length}`);
  await t.check("the panel does end up hidden",
    () => ev(`layout._minimized.has(layout._panel('services'))`));
  await t.check("its chip appears in the restore bar", () => ev(
    `[...document.querySelectorAll('#rb-chips .rb-chip')].some(c => /services/i.test(c.textContent))`));
  await checkInvariants("layout invariants hold with a panel hidden");

  const showP = ev(sampler("services", 900));
  await ev(`(layout.restore(layout._panel('services')), true)`);
  await cdp.waitFor(`!layout._minimized.has(layout._panel('services'))`,
    { timeout: 5000, label: "panel restored" }).catch(() => {});
  const showFrames = JSON.parse(await showP);
  const shown = showFrames.filter((f) => f.vis !== "none");
  await t.check("restoring a panel never renders it at the container origin",
    () => shown.length > 0 && shown.filter(nearOrigin).length === 0,
    `${shown.filter(nearOrigin).length} bad frames of ${shown.length}`);
  await t.check("a restored panel appears in place rather than flying in",
    () => shown.length > 2 &&
      Math.abs(shown[0].y - shown[shown.length - 1].y) < 4 &&
      Math.abs(shown[0].x - shown[shown.length - 1].x) < 4,
    shown.length ? `${JSON.stringify(shown[0])} -> ${JSON.stringify(shown[shown.length - 1])}` : "never shown");
  // Checked here, before the next reset() rebuilds the columns from the
  // defaults and erases any drift. Without this, making layout._normaliseHf()
  // a no-op — so a restored panel never gets its share of the column back —
  // produced a full-green run.
  await checkInvariants("layout invariants hold after restoring a hidden panel");
  await t.check("the spawn animation does not touch transform in fluid mode", () => ev(`(() => {
    const el = layout._panel('services');
    el.classList.add('p-spawn');
    const t = getComputedStyle(el).transform;
    el.classList.remove('p-spawn');
    // A hijacked transform collapses to the identity or a bare scale.
    return t !== 'none' && !/^matrix\\(1, 0, 0, 1, 0, 0\\)$/.test(t); })()`),
    () => ev(`getComputedStyle(layout._panel('services')).transform`));

  // ── a hide interrupted part-way ───────────────────────────────────────────
  // minimize() does its bookkeeping in a 180ms animation callback. Until that
  // callback was made cancellable, resetting or restoring during the animation
  // let it fire afterwards and hide a panel the user had just brought back —
  // and the engine then solved for nine panels instead of ten.
  t.section("hide interrupted mid-animation");
  await reset();
  await ev(`(layout.minimize(layout._panel('services')), true)`);
  // Deliberately no wait: interrupt while the hide is still animating.
  await ev(`(layout._reset(), true)`);
  await new Promise((r) => setTimeout(r, 400)); // well past the 180ms callback
  await t.check("resetting during a hide animation leaves the panel visible",
    async () => (await ev(`layout._minimized.size`)) === 0 &&
      (await ev(`getComputedStyle(layout._panel('services')).display !== 'none'`)) === true,
    () => ev(`'minimized=' + layout._minimized.size + ' display=' +
      getComputedStyle(layout._panel('services')).display`));

  await reset();
  await ev(`(layout.minimize(layout._panel('services')), true)`);
  await ev(`(layout.restore(layout._panel('services')), true)`);
  await new Promise((r) => setTimeout(r, 400));
  await t.check("restoring during its own hide animation wins",
    async () => (await ev(`layout._minimized.size`)) === 0 &&
      (await ev(`getComputedStyle(layout._panel('services')).display !== 'none'`)) === true,
    () => ev(`'minimized=' + layout._minimized.size + ' display=' +
      getComputedStyle(layout._panel('services')).display`));
  // Two minimize() calls inside the animation window used to queue two timers,
  // so the completion callback ran twice and _redistributeHf gave the hidden
  // panel's share away twice. The column's active panels then summed to 1.16
  // and the survivor was laid out 16% taller than its column.
  await reset();
  await ev(`(layout.minimize(layout._panel('services')),
             layout.minimize(layout._panel('services')), true)`);
  await cdp.waitFor(`layout._minimized.has(layout._panel('services'))`,
    { timeout: 5000, label: "minimize landed" });
  await new Promise((r) => setTimeout(r, 250)); // past a second, duplicate timer
  await cdp.settled();
  await t.check("a repeated minimize does not redistribute the height twice",
    async () => (await js("window.__inv()")).badSum === null,
    async () => { const i = await js("window.__inv()");
      return i.badSum === null ? "active hf sums to 1"
        : `column ${i.badCol} sums to ${i.badSum} [${i.dump}]`; });

  await cdp.settled();
  await checkInvariants("an interrupted hide leaves the columns intact");
  await reset();

  // ── panel-count independence ──────────────────────────────────────────────
  // Nothing in the engine may assume ten panels or four occupied columns.
  t.section("panel-count independence");
  await reset();
  await ev(`(['services','chain','mempool-viz','mining','blocks','peers']
    .forEach(n => layout.minimize(layout._panel(n))), true)`);
  await cdp.waitFor(`layout._minimized.size === 6`,
    { timeout: 6000, label: "six panels minimized" });
  await cdp.settled();
  await t.check("the engine still solves a valid layout with most panels hidden", async () => {
    const i = await js("window.__inv()");
    return !i.overlap && !i.outside && i.badSum === null;
  }, async () => JSON.stringify(await js("window.__inv()")));
  await t.check("visible panels fill the space rather than leaving a dead band", () => ev(
    `Math.min(...[...fluid._solve()].map(([, r]) => Math.round(r.x))) === layout._dataArea().left`),
    () => ev(`'leftmost ' + Math.min(...[...fluid._solve()].map(([, r]) => Math.round(r.x))) +
      ' vs dataArea.left ' + layout._dataArea().left`));
  // Restore them one by one rather than via reset(): reset() rebuilds the
  // columns from the defaults, which would hide any height drift the
  // hide/restore round trip introduced instead of measuring it.
  await ev(`([...layout._minimized.keys()].forEach(p => layout.restore(p)), true)`);
  await cdp.waitFor("layout._minimized.size === 0",
    { timeout: 8000, label: "all six restored" });
  await cdp.settled();
  await t.check("everything comes back after restoring them all",
    async () => (await ev(`layout._minimized.size`)) === 0);
  await checkInvariants("a six-panel hide/restore round trip leaves the columns intact");
  await reset();

  // ── listener and wrapper leaks ────────────────────────────────────────────
  t.section("idempotence");
  await cdp.withPatch(
    `(() => { window.__added = 0; window.__origAdd = window.addEventListener;
       window.addEventListener = function (t, ...a) { window.__added++; return window.__origAdd.call(this, t, ...a); };
       return true; })()`,
    `(() => { if (window.__origAdd) window.addEventListener = window.__origAdd; return true; })()`,
    async () => {
      await ev(`(fluid.start(), fluid.start(), true)`);
      await t.check("repeat start() adds no window listeners",
        async () => (await ev(`window.__added`)) === 0,
        async () => (await ev(`window.__added`)) + " listeners added");
    });
  await t.check("repeat engage() does not re-wrap layout.restore", () => ev(`(() => {
    const before = layout.restore; fluid.engage(); fluid.engage();
    return layout.restore === before; })()`));
  await t.check("the panel registry is unchanged by repeat start()",
    async () => (await ev(`fluid._panels.size`)) === PANELS);

  // ── accessibility and pointer/keyboard interplay ──────────────────────────
  t.section("accessibility");
  await t.check("the header carries no button role while containing real buttons", () => ev(`(() => {
    const phs = [...document.querySelectorAll('.panel .ph')];
    return phs.some(p => p.querySelector('button')) && phs.every(p => !p.getAttribute('role')); })()`),
    () => ev(`'role=' + document.querySelector('.panel .ph').getAttribute('role')`));
  await t.check("the header advertises its keyboard shortcuts",
    () => ev(`!!document.querySelector('.panel .ph').getAttribute('aria-keyshortcuts')`));
  await reset();
  await ensureFocus(cdp);
  await ev(`(document.activeElement.blur(), true)`);
  const phBox = await headerAt("chain");
  await cdp.mouse("mousePressed", phBox.x, phBox.y);
  await cdp.mouse("mouseReleased", phBox.x, phBox.y);
  await t.check("clicking a header focuses it, so alt+arrow is mouse-reachable",
    () => cdp.waitFor(
      `document.activeElement === document.querySelector('[data-panel="chain"] .ph')`,
      { timeout: 2000, label: "header focused by click" }).then(() => true).catch(() => false),
    () => ev(`(() => {
      const el = document.elementFromPoint(${Math.round(phBox.x)}, ${Math.round(phBox.y)});
      return 'clicked (' + ${Math.round(phBox.x)} + ',' + ${Math.round(phBox.y)} + ') hit ' +
        (el ? el.tagName + '.' + el.className + ' in ' +
          (el.closest('[data-panel]') || {}).dataset?.panel : 'nothing') +
        '; focus is ' + document.activeElement.tagName + '.' + document.activeElement.className; })()`));

  // A synthetic _drag is installed and removed under a finally: leaving one
  // behind would strand the engine for every later check.
  await cdp.withPatch(
    `(() => { window.__dragSnap = JSON.stringify(layout._cols.map(c => c.map(s => s.name)));
       fluid._drag = { name: 'chain', cx: 0, cy: 0, grabX: 0, grabY: 0, ci: 1, idx: 0, homeCi: 1 };
       return true; })()`,
    `(() => { fluid._drag = null; return true; })()`,
    async () => {
      await focusHeader("chain");
      await cdp.key("ArrowRight", { alt: true });
      await t.check("alt+arrow is ignored while a pointer drag is live",
        () => ev(`window.__dragSnap === JSON.stringify(layout._cols.map(c => c.map(s => s.name)))`));
    });

  await cdp.withPatch(
    `(() => { const p = layout._panel('node'); p.classList.add('fluid-resizing');
       fluid._resize = { name: 'node', prevCols: layout._cols.map(c => c.map(s => ({ ...s }))) };
       return true; })()`,
    `(() => { fluid._resize = null;
       layout._panel('node').classList.remove('fluid-resizing'); return true; })()`,
    async () => {
      await ev(`(fluid._cancelResize(), true)`);
      await t.check("cancelling a resize clears its class and state",
        () => ev(`!fluid._resize && !layout._panel('node').classList.contains('fluid-resizing')`));
    });

  await reset();
  await ev(`(layout.minimize(layout._panel('services')), true)`);
  // minimize() completes in a 180ms animation callback. Interrupting it is now
  // safe and covered by its own section below; this wait is here so that what
  // alt+Home is being tested on is unambiguously a hidden panel.
  await cdp.waitFor(`layout._minimized.has(layout._panel('services'))`,
    { timeout: 5000, label: "minimize landed" });
  await cdp.settled();
  await focusHeader("chain");
  await cdp.key("Home", { alt: true });
  await cdp.settled();
  await t.check("alt+Home also un-hides minimized panels",
    async () => (await ev(`layout._minimized.size`)) === 0,
    async () => "still minimized: " + await ev(`layout._minimized.size`));

  // ── failure containment ───────────────────────────────────────────────────
  // The motivating defect: engage() claimed the panels and replaced
  // layout._render before setting `active`, so a throw in between left no
  // working renderer while layout.init() had already hidden every panel.
  t.section("failure containment");
  await reset();
  await t.require("all panels visible before the teardown checks",
    async () => (await ev(
      `[...document.querySelectorAll('.panel')].filter(p => getComputedStyle(p).display !== 'none').length`
    )) === PANELS);

  // Reproduce the old failure shape directly: hide every panel with the engine
  // marked inactive, then require the plain renderer to bring them back. The
  // previous version of this check performed the same setup and then returned
  // `true` unconditionally, so it could not fail.
  await ev(`(() => { window.__wasActive = fluid.active; fluid.active = false;
    document.querySelectorAll('.panel').forEach(p => { p.style.display = 'none'; });
    layout._render(); return true; })()`);
  await t.check("the plain renderer restores every panel when the engine is inactive",
    async () => (await ev(
      `[...document.querySelectorAll('.panel')].filter(p => getComputedStyle(p).display !== 'none').length`
    )) === PANELS,
    async () => await ev(
      `[...document.querySelectorAll('.panel')].filter(p => getComputedStyle(p).display !== 'none').length + ' visible'`));
  await ev(`(fluid.active = window.__wasActive, true)`);

  await ev(`(fluid.disengage(), true)`);
  await ev(`(layout._render(), true)`);
  await t.check("disengage() returns a renderer that actually shows the panels",
    async () => (await ev(
      `[...document.querySelectorAll('.panel')].filter(p => getComputedStyle(p).display !== 'none').length`
    )) === PANELS,
    async () => await ev(
      `[...document.querySelectorAll('.panel')].filter(p => getComputedStyle(p).display !== 'none').length + ' visible'`));
  await t.check("disengage() stops the engine and lets layout place directly",
    () => ev(`fluid.active === false && typeof layout._renderPanels === 'function'`));
  await t.check("disengage() leaves no engine transform for the classic renderer to fight",
    () => ev(`[...document.querySelectorAll('.panel')].every(p => !p.style.transform)`),
    () => ev(`[...document.querySelectorAll('.panel')].map(p => p.style.transform).find(Boolean) || '(none)'`));
  await t.check("panels stay correctly placed with the engine disengaged", () => ev(`(() => {
    const da = layout._dataArea();
    return [...document.querySelectorAll('.panel')].every(p => {
      const r = p.getBoundingClientRect();
      return r.width > 40 && r.height > 20 && r.left >= da.left - 8; }); })()`));

  await t.check("engage() works again after a disengage", () => ev(`fluid.engage() === true`));
  await ev(`(fluid.start(), true)`);
  await cdp.settled();
  // Waited for, not sampled. `settled()` only says no frame is pending; after a
  // re-engage the first paint can still be one frame away, and sampling here
  // failed roughly one run in three while the engine was working correctly.
  await t.check("panels are painted again after re-engaging",
    () => cdp.waitFor(
      `fluid._panels.size === ${PANELS} &&
       [...fluid._panels.values()].every(e => !!e.el.style.transform)`,
      { timeout: 5000, label: "every panel repainted" }).then(() => true).catch(() => false),
    () => ev(`fluid._panels.size + ' registered, unpainted: ' +
      ([...fluid._panels.values()].filter(e => !e.el.style.transform)
        .map(e => e.el.dataset.panel).join(',') || 'none')`));
  await checkInvariants("layout invariants hold after a full disengage/re-engage cycle");

  // Leave the app in a clean, default state for whatever runs next.
  await reset();
}

// A reload discards the page context, so anything the suite installed there has
// to be reinstalled. Waiting on the engine rather than on a fixed sleep is what
// makes this reliable on a loaded machine.
async function reloadPage(cdp) {
  await cdp.eval(`(location.reload(), true)`).catch(() => {});
  await cdp.waitFor(
    "typeof fluid !== 'undefined' && fluid.active === true && fluid._panels.size > 0",
    { timeout: 30000, interval: 200, label: "app ready after reload" });
  await cdp.settled({ timeout: 15000 }).catch(() => {});
  // Reinstall the invariant probe lost with the old document.
  await cdp.eval(INV_PROBE);
}
