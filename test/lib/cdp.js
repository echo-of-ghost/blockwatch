"use strict";
// Shared Chrome DevTools Protocol client for the browser suites.
//
// Exists to fix three classes of problem that were duplicated across every
// suite: connecting to the wrong browser, waiting on fixed sleeps instead of
// conditions, and leaving monkey-patches installed when an assertion throws.

const DEFAULT_TIMEOUT = 20000;

class Cdp {
  constructor(ws) {
    this._ws = ws;
    this._id = 1;
    this._pending = new Map();
    this._closed = false;
    ws.addEventListener("message", (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      const p = this._pending.get(m.id);
      if (!p) return;
      this._pending.delete(m.id);
      clearTimeout(p.timer);
      m.error ? p.rej(new Error(m.method + ": " + JSON.stringify(m.error))) : p.res(m.result);
    });
  }

  // One listener for the socket rather than one per call, and the timeout is
  // cleared on settle. The old per-call pattern leaked a listener and a live
  // timer for every request that ever timed out.
  send(method, params = {}, timeout = DEFAULT_TIMEOUT) {
    if (this._closed) return Promise.reject(new Error("CDP connection closed"));
    const id = this._id++;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        this._pending.delete(id);
        rej(new Error("CDP timeout after " + timeout + "ms: " + method));
      }, timeout);
      this._pending.set(id, { res, rej, timer, method });
      this._ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async eval(expression, { awaitPromise = true } = {}) {
    const r = await this.send("Runtime.evaluate", {
      expression, returnByValue: true, awaitPromise,
    });
    if (r.exceptionDetails) {
      throw new Error("page threw: " +
        (r.exceptionDetails.exception?.description || r.exceptionDetails.text || "unknown"));
    }
    return r.result?.value;
  }

  json(expression) {
    return this.eval("JSON.stringify(" + expression + ")").then((s) =>
      s === undefined ? undefined : JSON.parse(s));
  }

  // ── input ────────────────────────────────────────────────────────────────
  mouse(type, x, y, button = "left") {
    return this.send("Input.dispatchMouseEvent", {
      type, x: Math.round(x), y: Math.round(y), button,
      buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, pointerType: "mouse",
    });
  }

  // Real key events through the browser, not synthetic DOM events. A
  // dispatchEvent(new KeyboardEvent(...)) bypasses the browser's own key
  // handling and cannot catch a listener bound to the wrong element.
  async key(key, { alt = false, shift = false, ctrl = false, meta = false } = {}) {
    const CODES = {
      ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
      Home: 36, End: 35, Escape: 27, Tab: 9, Enter: 13,
    };
    let modifiers = 0;
    if (alt) modifiers |= 1;
    if (ctrl) modifiers |= 2;
    if (meta) modifiers |= 4;
    if (shift) modifiers |= 8;
    const base = {
      modifiers, key,
      code: key,
      windowsVirtualKeyCode: CODES[key] || 0,
      nativeVirtualKeyCode: CODES[key] || 0,
      text: key.length === 1 ? key : undefined,
    };
    await this.send("Input.dispatchKeyEvent", { ...base, type: "keyDown" });
    await this.send("Input.dispatchKeyEvent", { ...base, type: "keyUp" });
  }

  // ── synchronisation ──────────────────────────────────────────────────────
  // Poll a page-side expression until it is truthy. Replaces the fixed sleeps
  // that made results depend on machine speed.
  async waitFor(expression, { timeout = 8000, interval = 50, label = expression } = {}) {
    const deadline = Date.now() + timeout;
    let last;
    for (;;) {
      try { last = await this.eval(expression); } catch (e) { last = "threw: " + e.message; }
      if (last) return last;
      if (Date.now() > deadline) {
        throw new Error(`waitFor timed out after ${timeout}ms: ${label} (last value: ${JSON.stringify(last)})`);
      }
      await new Promise((r) => setTimeout(r, interval));
    }
  }

  // The engine stops its rAF loop when every panel has reached its target, so
  // "settled" is an observable condition rather than a guess.
  settled({ timeout = 8000 } = {}) {
    return this.waitFor(
      "(typeof fluid !== 'undefined' && !fluid._raf && !fluid._drag && !fluid._resize)",
      { timeout, label: "layout settled" });
  }

  // ── safe patching ────────────────────────────────────────────────────────
  // Install a page-side patch, run body, and always undo it. Without the
  // finally, an assertion that throws mid-patch leaves the page poisoned for
  // every later test in the run.
  async withPatch(installExpr, restoreExpr, body) {
    await this.eval(installExpr);
    try {
      return await body();
    } finally {
      try { await this.eval(restoreExpr); }
      catch (e) { console.error("  [warn] failed to restore page patch: " + e.message); }
    }
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    for (const [, p] of this._pending) { clearTimeout(p.timer); }
    this._pending.clear();
    try { this._ws.close(); } catch (_) {}
  }
}

// Connect to the debugging port and pick the target that is unambiguously the
// dashboard we launched. Matching any localhost page meant another Electron or
// Chrome instance on the same port would be driven instead — synthetic mouse
// input into someone else's application.
async function connect({ cdpPort, dashboardPort, timeout = 20000 } = {}) {
  if (!cdpPort) throw new Error("connect() needs cdpPort");
  const want = dashboardPort ? `http://127.0.0.1:${dashboardPort}` : null;
  const deadline = Date.now() + timeout;
  let targets = [];

  for (;;) {
    try {
      const res = await fetch(`http://127.0.0.1:${cdpPort}/json`);
      targets = await res.json();
      const page = targets.find((t) =>
        t.type === "page" && (want ? t.url.startsWith(want) : t.url.startsWith("http://127.0.0.1")));
      if (page) {
        const ws = new WebSocket(page.webSocketDebuggerUrl);
        await new Promise((r, j) => {
          ws.addEventListener("open", r);
          ws.addEventListener("error", () => j(new Error("CDP websocket refused")));
        });
        const cdp = new Cdp(ws);
        await cdp.send("Page.enable");
        await cdp.send("Runtime.enable");
        return cdp;
      }
    } catch (_) { /* not up yet */ }

    if (Date.now() > deadline) {
      const seen = targets.map((t) => `${t.type} ${t.url}`).join(", ") || "none";
      throw new Error(
        `No dashboard target on CDP port ${cdpPort} for ${want || "any localhost page"} ` +
        `after ${timeout}ms.\n  Targets seen: ${seen}\n` +
        `  Is the app running? test/run.sh --app launches it for you.`);
    }
    await new Promise((r) => setTimeout(r, 150));
  }
}

// CDP input only reaches the compositor when the window is raised, and the
// first pointer event after raising is sometimes swallowed. Fronting alone is
// not enough, so this verifies a real gesture registers before any suite runs.
async function focusAndPrime(cdp) {
  await cdp.send("Page.bringToFront").catch(() => {});
  await cdp.waitFor("document.hasFocus()", { timeout: 5000, label: "window focused" })
    .catch(() => { throw new Error(
      "The app window never took focus. CDP input will not reach it.\n" +
      "  Another window may be grabbing focus, or the session has no display."); });

  // Prove input is actually landing: press and release on a panel header and
  // require the page to observe it. Retried, because the first one after a
  // raise can be dropped by the compositor.
  for (let attempt = 1; attempt <= 5; attempt++) {
    await cdp.eval("(window.__primed = false, document.addEventListener('pointerdown'," +
                   " () => { window.__primed = true; }, { once: true, capture: true }), true)");
    const box = await cdp.json(
      "(() => { const r = document.querySelector('.panel .ph').getBoundingClientRect();" +
      "  return { x: Math.round(r.left + 40), y: Math.round(r.top + r.height / 2) }; })()");
    await cdp.mouse("mousePressed", box.x, box.y);
    await cdp.mouse("mouseReleased", box.x, box.y);
    try {
      await cdp.waitFor("window.__primed === true", { timeout: 700, label: "input reaches the page" });
      return;
    } catch (_) { /* try again */ }
  }
  throw new Error("Input events are not reaching the page after 5 attempts. " +
                  "The window is probably not focused or is occluded.");
}

// Focus can be lost part-way through a run — another window takes it, or the
// compositor drops it after a device-metrics change. CDP input then still
// dispatches but stops reaching the page reliably, which shows up as a drag
// that never starts, or one that starts and then moves nothing. Cheap enough
// (one eval) to call before every pointer-driven section.
async function ensureFocus(cdp) {
  if (await cdp.eval("document.hasFocus()")) return true;
  await cdp.send("Page.bringToFront").catch(() => {});
  try {
    await cdp.waitFor("document.hasFocus()", { timeout: 3000, label: "window refocused" });
    return true;
  } catch (_) {
    return false;
  }
}

module.exports = { connect, focusAndPrime, ensureFocus, Cdp };
