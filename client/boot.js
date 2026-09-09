'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · boot.js
// Render orchestration, event wiring, module init, start polling
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// RENDER ORCHESTRATION
// ═══════════════════════════════════════════════════════════════════════════════
function safeRender(name, fn) {
  try { fn(); }
  catch (e) { console.error('[render:' + name + ']', e.message, e.stack); }
}

let _firstRender = true;
let _staleToastFired = false;

function renderAll(d) {
  // Core unreachable: the payload is zero-filled, not measured. Rendering it
  // would replace every real value on screen with a convincing-looking zero.
  // Leave the panels alone and say so instead.
  if (d && d.error) {
    nodeState.down(d.error, d.errorDetail);
    return;
  }
  nodeState.up();

  poller.setSync(d.blockchain?.initialblockdownload || false);

  safeRender('hero',    () => heroStrip.render(d));
  safeRender('node',    () => nodePanel.render(d));
  // Chain tip age — inline, chainPanel module removed
  const _blocks = d.blocks || [];
  const _now = Date.now() / 1000;
  setText("ch-tip-age", _blocks.length && _blocks[0].time ? utils.fmtAgeAgo(_now - _blocks[0].time) : "—");
  safeRender('mempool', () => mempoolPanel.render(d));
  safeRender('network', () => network.render(d.netIn, d.netOut, d.totalRecv, d.totalSent));
  safeRender('peers',   () => peersPanel.render(d));
  safeRender('blocks',  () => blocksPanel.render(d));

  if (!document.hidden) {
    const drawCharts = () => {
      safeRender('mempoolViz',  () => charts.mempoolViz.draw(network._mempoolHistory));
      safeRender('blockTiming', () => charts.blockTiming.draw(d.blocks || []));
    };
    if (window.innerWidth < 1024) requestAnimationFrame(drawCharts);
    else drawCharts();
  }

  if (_firstRender) {
    _firstRender = false;
  }
}


// ═══════════════════════════════════════════════════════════════════════════════
// BOOT — wire events, init modules, start polling
// ═══════════════════════════════════════════════════════════════════════════════

// Restore chain theme before first fetch (applied early to avoid flash)
try {
  const savedChain = localStorage.getItem('bw-chain');
  if (savedChain && savedChain !== 'main') chainTheme.apply(savedChain);
} catch (_) {}

// Layout. The fluid engine owns panel placement and interaction; layout owns
// what the arrangement IS. engage() must run before layout.init() so the first
// render already goes through the engine.
let _fluidEngaged = false;
if (typeof fluid !== 'undefined') {
  try { _fluidEngaged = fluid.engage(); }
  catch (e) { console.error('[fluid] engage failed', e); _fluidEngaged = false; }
}

layout.init();

if (_fluidEngaged) {
  try {
    fluid.start();
  } catch (e) {
    // Disengaging returns placement to layout._renderPanels. There is no drag
    // without the engine, but a dashboard you cannot rearrange still beats one
    // you cannot see.
    console.error('[fluid] start failed, falling back to direct placement', e);
    try { fluid.disengage(); layout._render(); }
    catch (e2) { console.error('[fluid] fallback render failed', e2); }
  }
}

// Charts resize observers
charts.init();

// Bandwidth chart hover
network._initHover();

// Services badge description. Driven by focus as well as hover: the badges
// are the only tooltip-bearing elements in the app that were pointer-only,
// which left keyboard and touch users with no way to read them at all.
function _svcShow(target) {
  const badge = target?.closest?.('.svc-tip[data-svc-tip]');
  const desc = $('svc-desc');
  if (!desc) return;
  if (badge && badge.dataset.svcTip) {
    desc.textContent = badge.dataset.svcTip;
    desc.classList.add('svc-desc-visible');
  } else if (!target?.closest?.('.svc-with-tips')) {
    desc.classList.remove('svc-desc-visible');
  }
}
// Hiding is decided by where the pointer or focus is going, not where it
// came from: the element being left is itself inside the badge group, so
// testing it would never hide anything.
function _svcHideIfLeaving(destination) {
  if (destination?.closest?.('.svc-with-tips')) return;
  const desc = $('svc-desc');
  if (desc) desc.classList.remove('svc-desc-visible');
}
document.addEventListener('mouseover', e => _svcShow(e.target));
document.addEventListener('mouseout',  e => _svcHideIfLeaving(e.relatedTarget));
// focusin/focusout rather than focus/blur: these bubble, so one delegated
// listener covers badges that are re-rendered on every state update.
document.addEventListener('focusin',  e => _svcShow(e.target));
document.addEventListener('focusout', e => _svcHideIfLeaving(e.relatedTarget));

// Global copy-to-clipboard delegation
document.addEventListener('click', e => {
  const el = e.target.closest('[data-copy]');
  if (!el || !el.dataset.copy) return;
  if (e.target.closest('a')) return;
  e.stopPropagation();
  utils.copyToClipboard(el.dataset.copy, el);
});

document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target.closest('.copy-icon[data-copy]');
  if (!el) return;
  e.preventDefault();
  utils.copyToClipboard(el.dataset.copy, el);
});

// `c` on a focused table row copies its hash or address. Clicking the hash cell
// already did this, but the cell is deliberately not a tab stop — 24 block rows
// would put 24 stops back into the tab order — so this is how the same action
// stays available to the keyboard.
document.addEventListener('keydown', e => {
  if (e.key !== 'c' || e.ctrlKey || e.metaKey || e.altKey) return;
  const row = e.target.closest && e.target.closest('tr[data-pid], tr[data-bheight]');
  if (!row) return;
  const src = row.querySelector('[data-copy]');
  if (!src || !src.dataset.copy) return;
  e.preventDefault();
  utils.copyToClipboard(src.dataset.copy, src);
});

// A11y: copy icons
function a11yCopyIcons(root = document) {
  root.querySelectorAll('.copy-icon:not([role])').forEach(el => {
    el.setAttribute('role', 'button');
    el.setAttribute('tabindex', '0');
    el.setAttribute('aria-label', 'Copy to clipboard');
  });
}
a11yCopyIcons();
new MutationObserver(() => a11yCopyIcons()).observe(document.body, { childList: true, subtree: true });

// Context menu dismiss
document.addEventListener('click', () => contextMenu.hide());
document.addEventListener('keydown', e => { if (e.key === 'Escape') contextMenu.hide(); });

// Terminal drawer
terminalDrawer.init();
contextMenu.initGlobal();
shortcutsOverlay.init();
settingsOverlay.init();
// Horizontal scroll cue on the data tables (see overflowCue).
document.querySelectorAll('#main .scroll-area').forEach((el) => overflowCue.wire(el));
// Primary: globalShortcut in main relays via IPC → preload → document CustomEvent
document.addEventListener('terminal:toggle', () => terminalDrawer.toggle());
// Fallback: direct keydown
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === '`') { e.preventDefault(); terminalDrawer.toggle(); }
});

// ── Discoverability ─────────────────────────────────────────────────────────
// Almost everything powerful in this app is invisible, so the titlebar carries
// one badge for the terminal and one for the shortcuts sheet that documents it.
$('terminal-btn')?.addEventListener('click', () => terminalDrawer.toggle());
$('shortcuts-btn')?.addEventListener('click', () => shortcutsOverlay.toggle());
$('settings-btn')?.addEventListener('click', () => settingsOverlay.toggle());

// Typing in a field must never be hijacked — "?" is a character there.
function _typingInField(t) {
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}
// Whichever sheet is open owns Escape and Tab. Settings is checked first
// because it can be opened from the shortcuts sheet's own trigger.
document.addEventListener('keydown', e => {
  const openSheet = settingsOverlay.isOpen() ? settingsOverlay
                  : shortcutsOverlay.isOpen() ? shortcutsOverlay
                  : null;
  if (openSheet) {
    if (e.key === 'Escape') { e.preventDefault(); openSheet.close(); return; }
    openSheet._trapFocus(e);
    return;
  }
  if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !_typingInField(e.target)) {
    e.preventDefault();
    shortcutsOverlay.open();
    return;
  }
  // Escape backs out of a selected peer. Deliberately last: the sheets above
  // have already returned, the peer filter and the terminal own Escape while
  // focused, and this only fires when a peer is actually selected.
  if (e.key === 'Escape' && !_typingInField(e.target) && !terminalDrawer.isOpen()
      && peersPanel._selectedId != null) {
    e.preventDefault();
    peersPanel.deselect();
  }
});

// Peer table click delegation
$('peer-table-body')?.addEventListener('click', e => {
  const row = e.target.closest('tr');
  if (!row || !row.dataset.pid) return;
  peersPanel.selectById(parseInt(row.dataset.pid, 10));
});

// Peer table keyboard navigation
$('peer-table-body')?.addEventListener('keydown', e => {
  const row = e.target.closest('tr[data-pid]');
  if (!row) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    peersPanel.selectById(parseInt(row.dataset.pid, 10));
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = [...$$('#peer-table-body tr[data-pid]')];
    const idx = rows.indexOf(row);
    const next = e.key === 'ArrowDown' ? rows[idx + 1] : rows[idx - 1];
    if (next) { rovingRows.moveTo(next); next.focus(); peersPanel.selectById(parseInt(next.dataset.pid, 10)); }
  }
});

// Block table click delegation
$('blk-body')?.addEventListener('click', e => {
  if (e.target.closest('a')) return;
  const row = e.target.closest('tr[data-bheight]');
  if (!row) return;
  blocksPanel.selectByHeight(parseInt(row.dataset.bheight, 10));
});

// Block table keyboard navigation
$('blk-body')?.addEventListener('keydown', e => {
  const row = e.target.closest('tr[data-bheight]');
  if (!row) return;
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    blocksPanel.selectByHeight(parseInt(row.dataset.bheight, 10));
  } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const rows = [...$$('#blk-body tr[data-bheight]')];
    const idx = rows.indexOf(row);
    const next = e.key === 'ArrowDown' ? rows[idx + 1] : rows[idx - 1];
    if (next) { rovingRows.moveTo(next); next.focus(); blocksPanel.selectByHeight(parseInt(next.dataset.bheight, 10)); }
  }
});

// Button listeners
$('pd-back')?.addEventListener('click', () => peersPanel.deselect());
$('conn-retry')?.addEventListener('click', () => poller.retryNow());
$('la-reveal-btn')?.addEventListener('click', () => nodePanel.toggleLocalAddrs());
$('peers-tsv-btn')?.addEventListener('click', () => peersPanel.exportTSV());
$('blocks-tsv-btn')?.addEventListener('click', () => blocksPanel.exportTSV());
$('snapshot-btn')?.addEventListener('click', () => poller.exportJSON());

// Peer filter
(function initPeerFilter() {
  const input = $('peer-filter');
  if (!input) return;

  input.addEventListener('input', () => {
    peersPanel._filterTerm = input.value.toLowerCase().trim();
    peersPanel._applyFilter();
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      input.value = '';
      peersPanel._filterTerm = '';
      peersPanel._applyFilter();
      input.blur();
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      const first = $q('#peer-table-body tr[data-pid]');
      if (first) first.focus();
    }
  });
})();

// Ban list — immediate + every 60s
banList.refresh();
setInterval(() => banList.refresh(), 60000);

// Staleness indicator — every second
setInterval(() => {
  mobileBar.tickClock();
  // Keep the UTXO scan's age honest between scans.
  nodePanel._renderUtxo();

  // Tick tip age elements every second so they stay live between SSE events
  const _tipTime = poller._lastData?.blocks?.[0]?.time;
  if (_tipTime) {
    const _tipAge = utils.fmtAgeAgo(Date.now() / 1000 - _tipTime);
    setText('ch-tip-age', _tipAge);
    const _heroAge = $('hero-tip-age');
    if (_heroAge) _heroAge.textContent = _tipAge;
  }

  const stale = $('sb-stale');
  if (!stale) return;

  const lastAt = poller.getLastFetchAt();
  if (!lastAt) { stale.textContent = ''; return; }

  const age = Math.floor((Date.now() - lastAt) / 1000);
  const dot = $('live-dot');

  // Data is still arriving while Core is unreachable — it just says so. Age
  // alone would therefore report a healthy green dot next to an "Unreachable"
  // badge, so the explicit state wins.
  if (nodeState.isDown()) {
    stale.textContent = 'no node';
    stale.className = 'sb-stale warn';
    if (dot) dot.className = 'dot err';
    mobileBar.updateStale(age);
    return;
  }

  if (age < 30) {
    stale.textContent = '';
    stale.className = 'sb-stale';
    if (dot) dot.className = 'dot ok';
    _staleToastFired = false;
  } else if (age < 60) {
    stale.textContent = age + 's ago';
    stale.className = 'sb-stale';
    if (dot) dot.className = 'dot warn';
  } else {
    stale.textContent = Math.floor(age / 60) + 'm ago';
    stale.className = 'sb-stale warn';
    if (dot) dot.className = 'dot err';
    if (!_staleToastFired) {
      _staleToastFired = true;
      toastStack.add('bitcoind unreachable', 'warn');
    }
  }

  mobileBar.updateStale(age);
}, 1000);

// Tab visibility — keep polling so history stays live; skip canvas renders when hidden
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    safeRender('mempoolViz',  () => charts.mempoolViz.draw(network._mempoolHistory));
    safeRender('blockTiming', () => charts.blockTiming.draw(poller._lastData?.blocks || []));
    safeRender('bandwidth',   () => network._drawSpark());
  }
});

// Start
tooltipEngine.init();
heroStrip._initSound();
poller.start();
