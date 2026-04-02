'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// TERMINAL DRAWER
// Ctrl+` toggles the drawer. Commands are passed to bitcoind via Electron IPC.
// ═══════════════════════════════════════════════════════════════════════════════

const terminalDrawer = (() => {
  let _open = false;
  let _busy = false;
  const _history = [];
  let _histIdx = -1;
  let _draft = '';

  // ── DOM refs ──────────────────────────────────────────────────────────────
  const _el     = () => document.getElementById('terminal-drawer');
  const _output = () => document.getElementById('term-output');
  const _input  = () => document.getElementById('term-input');

  // ── Parse input into { method, params[] } ────────────────────────────────
  function _parse(raw) {
    const tokens = raw.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) || [];
    const method = tokens[0] || '';
    const params = tokens.slice(1).map(t => {
      const s = t.replace(/^['"]|['"]$/g, '');
      try { return JSON.parse(s); } catch (_) { return s; }
    });
    return { method, params };
  }

  // ── JSON pretty-printer with color spans ─────────────────────────────────
  function _esc(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function _pretty(val, depth) {
    const pad  = '  '.repeat(depth);
    const pad1 = '  '.repeat(depth + 1);
    if (val === null)             return '<span class="tj-null">null</span>';
    if (val === true)             return '<span class="tj-bool">true</span>';
    if (val === false)            return '<span class="tj-bool">false</span>';
    if (typeof val === 'number')  return '<span class="tj-num">' + val + '</span>';
    if (typeof val === 'string')  return '<span class="tj-str">"' + _esc(val) + '"</span>';
    if (Array.isArray(val)) {
      if (!val.length) return '[]';
      return '[\n' +
        val.map(v => pad1 + _pretty(v, depth + 1)).join(',\n') +
        '\n' + pad + ']';
    }
    if (typeof val === 'object') {
      const keys = Object.keys(val);
      if (!keys.length) return '{}';
      return '{\n' +
        keys.map(k =>
          pad1 + '<span class="tj-key">"' + _esc(k) + '"</span>: ' +
          _pretty(val[k], depth + 1)
        ).join(',\n') +
        '\n' + pad + '}';
    }
    return _esc(String(val));
  }

  // ── Append an entry to the output area ───────────────────────────────────
  function _append(cmd, content, isError) {
    const out = _output();
    if (!out) return;
    const entry = document.createElement('div');
    entry.className = 'term-entry';
    entry.innerHTML =
      '<div class="term-echo"><span class="term-prompt-char">›</span> ' +
      _esc(cmd) + '</div>' +
      '<div class="term-result' + (isError ? ' term-result-err' : '') + '">' +
      content + '</div>';
    out.appendChild(entry);
    out.scrollTop = out.scrollHeight;
  }

  // ── Execute a command ─────────────────────────────────────────────────────
  async function _exec(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    // Local commands
    if (trimmed === 'clear') { const o = _output(); if (o) o.innerHTML = ''; return; }
    if (trimmed === 'help') {
      _append('help',
        '<span class="tj-str">common commands:</span>\n' +
        [
          'getblockchaininfo', 'getblockcount', 'getblockhash &lt;height&gt;',
          'getblockheader &lt;hash&gt;', 'getmempoolinfo', 'getrawmempool',
          'getpeerinfo', 'getnetworkinfo', 'getwalletinfo',
          'listbanned', 'getmininginfo', 'uptime',
          'clear  — clear output', 'help   — this message',
        ].map(c => '  <span class="tj-key">' + c + '</span>').join('\n'),
        false
      );
      return;
    }

    if (trimmed.length > 10000) {
      _append(trimmed.slice(0, 40) + '…', 'input too long', true);
      return;
    }

    _history.unshift(trimmed);
    if (_history.length > 100) _history.pop();
    _histIdx = -1;
    _draft = '';

    const { method, params } = _parse(trimmed);
    if (!method) return;

    _busy = true;
    const inp = _input();
    if (inp) inp.disabled = true;

    try {
      const res = await window.terminal.exec(method, params);
      if (res.ok) {
        const rendered = (res.result === null || res.result === undefined)
          ? '<span class="tj-null">null</span>'
          : (typeof res.result === 'object')
            ? _pretty(res.result, 0)
            : _pretty(res.result, 0);
        _append(trimmed, rendered, false);
      } else {
        _append(trimmed, _esc(res.error || 'unknown error'), true);
      }
    } catch (e) {
      _append(trimmed, _esc(e.message), true);
    } finally {
      _busy = false;
      if (inp) { inp.disabled = false; inp.focus(); }
    }
  }

  // ── Show / hide / toggle ──────────────────────────────────────────────────
  function show() {
    const el = _el();
    if (!el || _open) return;
    _open = true;
    el.style.display = 'flex';
    requestAnimationFrame(() => el.classList.add('term-visible'));
    setTimeout(() => { const inp = _input(); if (inp) inp.focus(); }, 50);
  }

  function hide() {
    const el = _el();
    if (!el || !_open) return;
    _open = false;
    el.classList.remove('term-visible');
    setTimeout(() => { if (!_open) el.style.display = 'none'; }, 300);
    const inp = _input();
    if (inp) inp.blur();
  }

  function toggle() { _open ? hide() : show(); }
  function isOpen() { return _open; }

  // ── Wire input events ─────────────────────────────────────────────────────
  function init() {
    const inp = _input();
    if (!inp) return;

    inp.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.preventDefault();
        if (!_busy) _exec(inp.value);
        inp.value = '';
        _histIdx = -1;
        _draft = '';
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); hide(); return; }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        if (_histIdx === -1) _draft = inp.value;
        if (_histIdx < _history.length - 1) {
          _histIdx++;
          inp.value = _history[_histIdx];
          inp.setSelectionRange(inp.value.length, inp.value.length);
        }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        if (_histIdx > 0) {
          _histIdx--;
          inp.value = _history[_histIdx];
        } else if (_histIdx === 0) {
          _histIdx = -1;
          inp.value = _draft;
        }
        inp.setSelectionRange(inp.value.length, inp.value.length);
        return;
      }
    });

    document.getElementById('term-close')
      ?.addEventListener('click', () => hide());

    const maxBtn = document.getElementById('term-maximize');
    maxBtn?.addEventListener('click', () => {
      const el = _el();
      if (!el) return;
      const full = el.classList.toggle('term-fullscreen');
      maxBtn.textContent = full ? '⤡' : '⤢';
      maxBtn.setAttribute('aria-label', full ? 'Restore terminal' : 'Maximize terminal');
    });
  }

  return { init, show, hide, toggle, isOpen };
})();
