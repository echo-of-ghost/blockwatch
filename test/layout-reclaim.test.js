"use strict";
// Horizontal reclaim and restore-bar reachability.
//
// Reclaim is the behaviour that makes an emptied column disappear instead of
// leaving a dead band: the remaining columns must widen to fill the space, and
// the emptied one must still be a valid drop target so the user can put a panel
// back. Those two pull against each other, which is why both are asserted here.

const { connect, focusAndPrime, ensureFocus } = require("./lib/cdp");
const { runSuite } = require("./lib/harness");

const PORT = process.env.BW_PORT || 3020;
const CDP = process.env.BW_CDP || 9333;
const GAP = 16; // layout.GAP; asserted below rather than assumed.

runSuite("horizontal reclaim + restore bar", async (t) => {
  t.expect(21);

  const cdp = await connect({ cdpPort: CDP, dashboardPort: PORT });
  try {
    await focusAndPrime(cdp);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    await run(t, cdp);
  } finally {
    // Always hand the app back at its default size and layout, however this
    // suite ended. A left-over device-metrics override would break every suite
    // that ran afterwards against the same instance.
    try {
      await cdp.send("Emulation.clearDeviceMetricsOverride");
      await cdp.eval(`([...layout._minimized.keys()].forEach(p => layout.restore(p)),
        layout._cols = layout._DEFAULT_COLS.map(c => c.map(s => ({ ...s }))),
        layout._save(), fluid.request(), true)`);
    } catch (_) { /* the page may already be gone */ }
    await cdp.close();
  }
});

async function run(t, cdp) {
  const ev = (e) => cdp.eval(e);
  const js = (e) => cdp.json(e);

  const reset = async () => {
    await ev(`([...layout._minimized.keys()].forEach(p => layout.restore(p)),
      layout._cols = layout._DEFAULT_COLS.map(c => c.map(s => ({ ...s }))),
      layout._save(), fluid.request(), true)`);
    await cdp.settled();
  };
  const boxes = () => js(`fluid._colBoxes(fluid._workingCols(), layout._dataArea())`);

  await reset();
  await t.require("the engine is engaged", () => ev(`fluid.active === true`));
  await t.check("the gap constant this suite assumes matches the app",
    async () => (await ev(`layout.GAP`)) === GAP,
    async () => `layout.GAP = ${await ev(`layout.GAP`)}, suite assumes ${GAP}`);

  // ── horizontal reclaim ────────────────────────────────────────────────────
  t.section("horizontal reclaim");
  const da = await js(`layout._dataArea()`);
  await t.check("all four columns are occupied at rest",
    async () => (await boxes()).every((b) => b.w > 0),
    async () => JSON.stringify((await boxes()).map((b) => Math.round(b.w))));
  const w0 = (await boxes())[0].w;

  // Move one of column 0's two panels out. The column still has a panel, so its
  // width must not change at all.
  await ev(`(fluid._applyMove('services', 1, 0), fluid.request(), true)`);
  await cdp.settled();
  await t.check("a column that still has panels keeps its width",
    async () => Math.abs((await boxes())[0].w - w0) < 2,
    async () => `${Math.round(w0)} -> ${Math.round((await boxes())[0].w)}`);

  // Now empty it completely.
  await ev(`(fluid._applyMove('node', 1, 0), fluid.request(), true)`);
  await cdp.settled();
  const b = await boxes();
  await t.check("an emptied column collapses to zero width", () => b[0].w === 0,
    JSON.stringify(b.map((x) => Math.round(x.w))));
  await t.check("its space is reclaimed — no dead band on the left",
    () => Math.abs(b[1].x - da.left) < 1, `col1 x=${Math.round(b[1].x)}, dataArea.left=${da.left}`);
  const live = b.filter((x) => x.w > 0);
  const total = live.reduce((s, x) => s + x.w, 0) + GAP * (live.length - 1);
  await t.check("the reclaimed width is shared out, not left as a gap",
    () => Math.abs(total - da.width) <= 2, `sum ${Math.round(total)} vs ${da.width}`);
  await t.check("panels are actually painted into the reclaimed space", () => ev(
    `Math.min(...[...fluid._solve()].map(([, r]) => Math.round(r.x))) === layout._dataArea().left`),
    () => ev(`'leftmost ' + Math.min(...[...fluid._solve()].map(([, r]) => Math.round(r.x))) +
      ' vs ' + layout._dataArea().left`));
  await t.check("no panel overlaps another after the collapse", () => ev(`(() => {
    const bx = [...fluid._solve()].map(([n, r]) => ({ n, ...r }));
    for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
      const a = bx[i], c = bx[j];
      const ox = Math.min(a.x + a.w, c.x + c.w) - Math.max(a.x, c.x);
      const oy = Math.min(a.y + a.h, c.y + c.h) - Math.max(a.y, c.y);
      if (ox > 1 && oy > 1) return false;
    } return true; })()`));

  // A collapsed column must remain reachable, or the user can never undo this.
  // The synthetic _drag is removed in a finally: leaving one installed strands
  // the engine for every later check in the run.
  await cdp.withPatch(
    `(() => { fluid._drag = { name: 'node',
        cx: layout._dataArea().left + 20, cy: layout._dataArea().top + 200,
        grabX: 0, grabY: 0, ci: -1, idx: -1, homeCi: 1 };
      fluid._solve(); return true; })()`,
    `(() => { fluid._drag = null; return true; })()`,
    async () => {
      await t.check("an emptied column can still be dropped into",
        async () => (await ev(`fluid._drag.ci`)) === 0,
        async () => "resolved to column " + await ev(`fluid._drag.ci`));
    });
  await t.check("no drag state is left behind", () => ev(`!fluid._drag`));
  await reset();

  // ── restore bar reachability ──────────────────────────────────────────────
  // Nine chips in a bar with a max-width will overflow at narrow widths. The
  // requirement is not "it fits" but "every chip can be reached", so the check
  // scrolls the bar and confirms the last chip comes into view.
  t.section("restore bar reachability");
  await ensureFocus(cdp);
  const HIDE = ["services", "chain", "mempool-viz", "block-timing", "mining",
                "block-detail", "peer-detail", "blocks", "peers"];
  for (const W of [1920, 1280, 1100]) {
    await cdp.send("Emulation.setDeviceMetricsOverride",
      { width: W, height: 1000, deviceScaleFactor: 1, mobile: false });
    await cdp.settled({ timeout: 12000 }).catch(() => {});
    await reset();
    await ev(`(${JSON.stringify(HIDE)}.forEach(n => layout.minimize(layout._panel(n))), true)`);
    await cdp.waitFor(`layout._minimized.size === ${HIDE.length}`,
      { timeout: 6000, label: "panels minimized" });
    await cdp.settled({ timeout: 12000 }).catch(() => {});

    const r = await js(`(() => {
      const inner = document.getElementById('rb-chips');
      const chips = [...inner.querySelectorAll('.rb-chip')];
      const overflowing = inner.scrollWidth > inner.clientWidth + 1;
      // scroll-behavior is smooth, so jump without animation before measuring.
      inner.scrollTo({ left: inner.scrollWidth, behavior: 'instant' });
      const br = inner.getBoundingClientRect();
      const lastVisible = chips.length ? (() => {
        const q = chips[chips.length - 1].getBoundingClientRect();
        return q.right <= br.right + 2 && q.left >= br.left - 2; })() : false;
      inner.scrollTo({ left: 0, behavior: 'instant' });
      return { chips: chips.length, overflowing, lastReachable: !!lastVisible,
               fade: inner.classList.contains('rb-more'),
               scrollW: Math.round(inner.scrollWidth), clientW: Math.round(inner.clientWidth) }; })()`);

    await t.check(`${W}px: every hidden panel has a chip`,
      () => r.chips === HIDE.length, `${r.chips} chips`);
    await t.check(`${W}px: the last chip can be reached`, () => r.lastReachable,
      `overflowing=${r.overflowing} scroll=${r.scrollW}/${r.clientW}`);
    // Counted unconditionally so the assertion total cannot drift with the
    // viewport. When the bar does not overflow, "no fade" is the correct state.
    await t.check(`${W}px: the fade cue matches whether the bar overflows`,
      () => r.fade === r.overflowing, `fade=${r.fade} overflowing=${r.overflowing}`);
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride");
  await cdp.settled({ timeout: 12000 }).catch(() => {});
  await reset();
  await t.check("every panel is restored at the end",
    async () => (await ev(`layout._minimized.size`)) === 0);
}
