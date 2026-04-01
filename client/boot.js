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
  poller.setSync(d.blockchain?.initialblockdownload || false);

  safeRender('hero',    () => heroStrip.render(d));
  safeRender('node',    () => nodePanel.render(d));
  safeRender('chain',   () => chainPanel.render(d));
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

// Layout
layout.init();

// Charts resize observers
charts.init();

// Bandwidth chart hover
network._initHover();

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
// Primary: globalShortcut in main relays via IPC → preload → document CustomEvent
document.addEventListener('terminal:toggle', () => terminalDrawer.toggle());
// Fallback: direct keydown
document.addEventListener('keydown', e => {
  if (e.ctrlKey && e.key === '`') { e.preventDefault(); terminalDrawer.toggle(); }
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
    if (next) { next.focus(); peersPanel.selectById(parseInt(next.dataset.pid, 10)); }
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
    if (next) { next.focus(); blocksPanel.selectByHeight(parseInt(next.dataset.bheight, 10)); }
  }
});

// Button listeners
$('conn-retry')?.addEventListener('click', () => poller.retryNow());
$('la-reveal-btn')?.addEventListener('click', () => nodePanel.toggleLocalAddrs());
$('peers-tsv-btn')?.addEventListener('click', () => peersPanel.exportTSV());
$('blocks-tsv-btn')?.addEventListener('click', () => blocksPanel.exportTSV());
$('snapshot-btn')?.addEventListener('click', () => poller.exportJSON());

// Reset layout button
$('reset-layout-btn')?.addEventListener('click', () => {
  layout._reset();
});

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

  const stale = $('sb-stale');
  if (!stale) return;

  const lastAt = poller.getLastFetchAt();
  if (!lastAt) { stale.textContent = ''; return; }

  const age = Math.floor((Date.now() - lastAt) / 1000);
  const dot = $('live-dot');

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
