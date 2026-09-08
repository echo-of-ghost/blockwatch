"use strict";
// Drag performance probe. Not part of `run.sh` — it reports numbers rather than
// asserting behaviour, and it deliberately perturbs the page to measure it.
//
//   node test/perf.js                 measure and report
//   BW_PERF_MAX_DROPPED=0 node ...    also fail if any frame exceeds 33ms
//
// Two measurement traps this avoids, both of which produced meaningless numbers
// before they were understood:
//
//   1. Double-wrapping `_solve` counts every call more than once and adds a
//      layer of indirection to every frame. The wrapper is removed in a
//      `finally`, and the guard below refuses to start if an interrupted run
//      left one behind.
//   2. Live data rendering dominates the sample. A block or mempool update
//      arriving mid-drag re-renders every panel, table and chart, and that cost
//      belongs to the dashboard, not the layout engine. With it left in,
//      identical code measured between 1 and 36 dropped frames.
//
// Every page-side patch is undone in a `finally`, so a failed run leaves a
// usable app behind rather than one with a wrapped solver and no data.

const { connect, focusAndPrime } = require("./lib/cdp");

const PORT = process.env.BW_PORT || 3020;
const CDP = process.env.BW_CDP || 9333;
const MAX_DROPPED = process.env.BW_PERF_MAX_DROPPED === undefined
  ? null : Number(process.env.BW_PERF_MAX_DROPPED);

(async () => {
  const cdp = await connect({ cdpPort: CDP, dashboardPort: PORT });
  let code = 0;
  try {
    await focusAndPrime(cdp);
    await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => {});

    // Reset layout AND persistence: a saved arrangement can make the scripted
    // drag a no-op, and then the numbers describe nothing.
    await cdp.eval(`([...layout._minimized.keys()].forEach(q => layout.restore(q)),
      layout._cols = layout._DEFAULT_COLS.map(c => c.map(s => ({ ...s }))),
      layout._save(), fluid.request(), true)`);
    await cdp.settled({ timeout: 15000 });

    // Refuse only if a previous run left the solver wrapped — that is the real
    // hazard, and it can only happen if a run was killed before its `finally`.
    // Repeat runs against the same instance are otherwise fine, because the
    // wrapper is always removed.
    if (await cdp.eval("!!window.__realSolve")) {
      console.error("The solver is still wrapped from an interrupted run. Relaunch the app.");
      process.exit(2);
    }

    const stats = await measure(cdp);

    console.log("frame stats: " + JSON.stringify(stats));
    console.log(`=> p50 ${stats.p50}ms, p95 ${stats.p95}ms, worst ${stats.max}ms`);
    console.log(`=> frames over 20ms: ${stats.over20}/${stats.frames}` +
                `, over 33ms (dropped): ${stats.over33}`);
    console.log(`=> solver calls: ${stats.solves} (one per animated frame)`);

    if (MAX_DROPPED !== null) {
      if (stats.over33 > MAX_DROPPED) {
        console.error(`FAIL: ${stats.over33} dropped frames exceeds the budget of ${MAX_DROPPED}`);
        code = 1;
      } else {
        console.log(`PASS: ${stats.over33} dropped frames within the budget of ${MAX_DROPPED}`);
      }
    }
  } catch (e) {
    console.error("ERROR: " + e.message);
    code = 1;
  } finally {
    await cdp.close();
  }
  process.exit(code);
})();

async function measure(cdp) {
  // Suspend live data rendering and wrap the solver, then put both back
  // whatever happens. `__realSolve` is stored on the page so a hard failure
  // mid-run can still be undone by hand from the console.
  await cdp.eval(`(() => {
    window.__realRenderAll = window.renderAll;
    window.renderAll = () => {};
    window.__realSolve = fluid._solve.bind(fluid);
    window.__solves = 0;
    fluid._solve = () => { window.__solves++; return window.__realSolve(); };
    window.__f = []; window.__stop = false;
    let last = performance.now();
    const loop = (ts) => { window.__f.push(ts - last); last = ts;
      if (!window.__stop) requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    return true; })()`);

  try {
    const h = await cdp.json(
      `(() => { const r = document.querySelector('[data-panel="services"] .ph').getBoundingClientRect();
         return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) }; })()`);

    // A long continuous traverse: a loop that crosses every column twice.
    const pts = [];
    for (let i = 0; i <= 90; i++) {
      const th = (i / 90) * Math.PI * 2;
      pts.push({ x: 400 + Math.cos(th) * 520 + i * 8, y: 600 + Math.sin(th) * 340 });
    }

    await cdp.mouse("mousePressed", h.x, h.y);
    const t0 = Date.now();
    for (const q of pts) {
      await cdp.mouse("mouseMoved", q.x, q.y);
      await new Promise((r) => setTimeout(r, 8));
    }
    const t1 = Date.now();
    await cdp.mouse("mouseReleased", pts[pts.length - 1].x, pts[pts.length - 1].y);
    await cdp.settled({ timeout: 10000 }).catch(() => {});
    console.log(`drag duration: ${t1 - t0}ms over ${pts.length} pointer moves`);

    return await cdp.json(`(() => {
      window.__stop = true;
      const f = window.__f.filter(x => x > 0 && x < 500).sort((a, b) => a - b);
      if (!f.length) return { frames: 0, p50: 0, p95: 0, max: 0, over20: 0, over33: 0, solves: window.__solves };
      const q = (p) => f[Math.min(f.length - 1, Math.floor(f.length * p))];
      return { frames: f.length, p50: +q(.5).toFixed(2), p95: +q(.95).toFixed(2),
        max: +f[f.length - 1].toFixed(2), over20: f.filter(x => x > 20).length,
        over33: f.filter(x => x > 33).length, solves: window.__solves }; })()`);
  } finally {
    // Unwrap the solver and restore data rendering. Leaving either in place
    // makes every later measurement — and the app itself — wrong.
    await cdp.eval(`(() => {
      window.__stop = true;
      if (window.__realSolve) { fluid._solve = window.__realSolve; window.__realSolve = null; }
      if (window.__realRenderAll) { window.renderAll = window.__realRenderAll; window.__realRenderAll = null; }
      window.__f = [];
      return true; })()`).catch((e) => console.error("  [warn] could not restore page: " + e.message));
  }
}
