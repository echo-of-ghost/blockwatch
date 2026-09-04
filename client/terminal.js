'use strict';

// ═══════════════════════════════════════════════════════════════════════════════
// TERMINAL — node operator console
// Ctrl+` toggles the drawer. Commands are passed to bitcoind via Electron IPC,
// which is the only place RPC credentials exist; the renderer never sees them.
//
// Design notes that are load-bearing rather than stylistic:
//
//  · Output is built as DOM nodes under an explicit budget. The previous
//    implementation concatenated one HTML string and assigned innerHTML, which
//    a getrawmempool (tens of thousands of txids) or getblock verbosity 2
//    (megabytes) would turn into a renderer freeze. Results past the budget are
//    summarised with an expand control; the raw value is kept off-DOM so copy
//    still yields everything.
//  · The tokenizer tracks quote state AND bracket depth, so a JSON argument
//    containing spaces survives. bitcoin-cli semantics: parse each token as
//    JSON, fall back to the raw string.
//  · One command runs at a time and can be cancelled, so a gettxoutsetinfo does
//    not hold the input for its eleven-minute timeout.
// ═══════════════════════════════════════════════════════════════════════════════

const terminalDrawer = (() => {
  const LS_HISTORY = 'bw-term-history';
  const LS_HEIGHT = 'bw-term-height';
  const LS_METHODS = 'bw-term-methods';
  const MAX_ENTRIES = 200;     // scrollback entries retained in the DOM
  const MAX_HISTORY = 300;     // commands remembered across sessions
  const RENDER_BUDGET = 4000;  // values rendered before summarising
  const MAX_DEPTH = 12;        // nesting rendered before collapsing

  let _open = false;
  let _busy = false;
  let _callId = 0;
  let _activeCall = null;
  let _busyRow = null;
  let _busyTimer = null;
  let _history = [];
  let _histIdx = -1;
  let _draft = '';
  let _methods = [];
  let _tabMatches = null;
  let _tabIdx = 0;
  let _stickBottom = true;
  let _searchTerm = '';
  let _searchHits = [];
  let _searchIdx = -1;

  const _el = () => document.getElementById('terminal-drawer');
  const _output = () => document.getElementById('term-output');
  const _input = () => document.getElementById('term-input');
  const _status = () => document.getElementById('term-status');

  // ── Persistence ───────────────────────────────────────────────────────────
  function _loadHistory() {
    try {
      const raw = localStorage.getItem(LS_HISTORY);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) _history = arr.filter((s) => typeof s === 'string').slice(0, MAX_HISTORY);
    } catch (_) {}
  }
  function _saveHistory() {
    try { localStorage.setItem(LS_HISTORY, JSON.stringify(_history.slice(0, MAX_HISTORY))); } catch (_) {}
  }
  function _loadMethods() {
    try {
      const raw = localStorage.getItem(LS_METHODS);
      const arr = raw ? JSON.parse(raw) : [];
      if (Array.isArray(arr)) _methods = arr.filter((s) => typeof s === 'string');
    } catch (_) {}
  }
  function _saveMethods() {
    try { localStorage.setItem(LS_METHODS, JSON.stringify(_methods)); } catch (_) {}
  }

  // ── Tokenizer ─────────────────────────────────────────────────────────────
  // Splits on whitespace, but never inside quotes or inside a bracketed JSON
  // value, so `getblockstats 800000 ["txs","height"]` and `{"a": 1}` both work.
  function _tokenize(raw) {
    const out = [];
    let cur = '';
    let quote = null;
    let depth = 0;
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];
      if (quote) {
        cur += ch;
        if (ch === '\\' && i + 1 < raw.length) { cur += raw[++i]; continue; }
        if (ch === quote) quote = null;
        continue;
      }
      if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
      if (ch === '[' || ch === '{') { depth++; cur += ch; continue; }
      if (ch === ']' || ch === '}') { depth = Math.max(0, depth - 1); cur += ch; continue; }
      if (/\s/.test(ch) && depth === 0) {
        if (cur) { out.push(cur); cur = ''; }
        continue;
      }
      cur += ch;
    }
    if (cur) out.push(cur);
    return out;
  }

  function _parse(raw) {
    const tokens = _tokenize(raw.trim());
    const method = (tokens[0] || '').toLowerCase();
    const params = tokens.slice(1).map((t) => {
      // Quoted strings stay strings; everything else is tried as JSON so
      // numbers, booleans, arrays and objects arrive with the right type.
      if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
        const inner = t.slice(1, -1);
        try { return JSON.parse('"' + inner.replace(/"/g, '\\"') + '"'); } catch (_) { return inner; }
      }
      try { return JSON.parse(t); } catch (_) { return t; }
    });
    return { method, params };
  }

  // ── Value renderer ────────────────────────────────────────────────────────
  // Builds real nodes into a fragment with a hard budget. Returns
  // { node, truncated } so the caller can offer an expand affordance.
  function _renderValue(val, opts) {
    const state = { budget: opts && opts.budget ? opts.budget : RENDER_BUDGET, truncated: false };
    const frag = document.createDocumentFragment();
    _emit(frag, val, 0, state);
    return { node: frag, truncated: state.truncated };
  }

  const _span = (cls, text) => {
    const s = document.createElement('span');
    if (cls) s.className = cls;
    s.textContent = text;
    return s;
  };

  function _emit(parent, val, depth, state) {
    if (state.budget <= 0) { state.truncated = true; return; }
    state.budget--;

    if (val === null) return parent.appendChild(_span('tj-null', 'null'));
    if (val === true || val === false) return parent.appendChild(_span('tj-bool', String(val)));
    if (typeof val === 'number') return parent.appendChild(_span('tj-num', String(val)));
    if (typeof val === 'string') return parent.appendChild(_span('tj-str', JSON.stringify(val)));

    const isArr = Array.isArray(val);
    if (!isArr && typeof val !== 'object') return parent.appendChild(_span('', String(val)));

    const keys = isArr ? null : Object.keys(val);
    const len = isArr ? val.length : keys.length;
    const open = isArr ? '[' : '{';
    const close = isArr ? ']' : '}';

    if (len === 0) return parent.appendChild(_span('', open + close));

    if (depth >= MAX_DEPTH) {
      state.truncated = true;
      return parent.appendChild(_span('tj-collapsed', open + '…' + close + ' ' + len + ' items'));
    }

    parent.appendChild(_span('', open));
    const pad = '  '.repeat(depth + 1);
    for (let i = 0; i < len; i++) {
      if (state.budget <= 0) {
        state.truncated = true;
        parent.appendChild(document.createTextNode('\n' + pad));
        parent.appendChild(_span('tj-collapsed', '… ' + (len - i) + ' more'));
        break;
      }
      parent.appendChild(document.createTextNode('\n' + pad));
      if (!isArr) {
        parent.appendChild(_span('tj-key', JSON.stringify(keys[i])));
        parent.appendChild(document.createTextNode(': '));
      }
      _emit(parent, isArr ? val[i] : val[keys[i]], depth + 1, state);
      if (i < len - 1) parent.appendChild(document.createTextNode(','));
    }
    parent.appendChild(document.createTextNode('\n' + '  '.repeat(depth)));
    parent.appendChild(_span('', close));
  }

  function _sizeOf(val) {
    try { return JSON.stringify(val).length; } catch (_) { return 0; }
  }
  function _countOf(val) {
    if (Array.isArray(val)) return val.length;
    if (val && typeof val === 'object') return Object.keys(val).length;
    return 1;
  }

  // ── Output entries ────────────────────────────────────────────────────────
  function _appendEntry(cmd) {
    const out = _output();
    if (!out) return null;
    const entry = document.createElement('div');
    entry.className = 'term-entry';
    const echo = document.createElement('div');
    echo.className = 'term-echo';
    echo.appendChild(_span('term-prompt-char', '›'));
    echo.appendChild(document.createTextNode(' ' + cmd));
    entry.appendChild(echo);
    out.appendChild(entry);
    while (out.childElementCount > MAX_ENTRIES) out.removeChild(out.firstElementChild);
    _scrollIfPinned();
    return entry;
  }

  function _setResult(entry, val, kind) {
    if (!entry) return;
    const body = document.createElement('div');
    body.className = 'term-result' + (kind ? ' term-result-' + kind : '');
    if (kind) {
      body.textContent = String(val);
    } else {
      entry._raw = val; // kept off-DOM so copy works even when truncated
      const { node, truncated } = _renderValue(val);
      body.appendChild(node);
      if (truncated) {
        const note = document.createElement('div');
        note.className = 'term-truncated';
        note.textContent =
          _countOf(val).toLocaleString('en-US') + ' items · ' +
          utils.fmtBytes(_sizeOf(val)) + ' — output truncated for display';
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'term-mini-btn';
        btn.textContent = 'render all';
        btn.addEventListener('click', () => {
          btn.disabled = true;
          btn.textContent = 'rendering…';
          // Yield first so the button state paints before the heavy work.
          setTimeout(() => {
            const full = _renderValue(val, { budget: Infinity });
            body.replaceChildren(full.node, note);
            btn.remove();
          }, 16);
        });
        note.appendChild(btn);
        body.appendChild(note);
      }
    }
    entry.appendChild(body);
    _scrollIfPinned();
  }

  function _scrollIfPinned() {
    const out = _output();
    if (out && _stickBottom) out.scrollTop = out.scrollHeight;
  }

  // ── Status line ───────────────────────────────────────────────────────────
  function _setStatus(text, cls) {
    const s = _status();
    if (!s) return;
    s.textContent = text || '';
    s.className = 'term-status' + (cls ? ' term-status-' + cls : '');
  }

  function _startBusy(cmd) {
    const out = _output();
    if (!out) return;
    _busyRow = document.createElement('div');
    _busyRow.className = 'term-busy';
    const t0 = Date.now();
    const tick = () => {
      const s = (Date.now() - t0) / 1000;
      _busyRow.textContent = 'running ' + cmd.split(/\s+/)[0] + ' — ' + s.toFixed(1) + 's  (ctrl+c to cancel)';
    };
    tick();
    _busyTimer = setInterval(tick, 100);
    out.appendChild(_busyRow);
    _scrollIfPinned();
  }

  function _endBusy() {
    if (_busyTimer) { clearInterval(_busyTimer); _busyTimer = null; }
    if (_busyRow) { _busyRow.remove(); _busyRow = null; }
  }

  // ── Execute ───────────────────────────────────────────────────────────────
  async function _exec(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return;

    if (trimmed === 'clear') { clearOutput(); return; }
    if (trimmed === 'help' || trimmed === '?') { _showHelp(); return; }
    if (trimmed.length > 10000) {
      _setResult(_appendEntry(trimmed.slice(0, 60) + '…'), 'input too long', 'input');
      return;
    }

    // History: newest first, no consecutive duplicates.
    if (_history[0] !== trimmed) {
      _history.unshift(trimmed);
      if (_history.length > MAX_HISTORY) _history.pop();
      _saveHistory();
    }
    _histIdx = -1;
    _draft = '';

    const { method, params } = _parse(trimmed);
    if (!method) return;

    const entry = _appendEntry(trimmed);
    const id = ++_callId;
    _busy = true;
    _activeCall = id;
    const inp = _input();
    if (inp) inp.disabled = true;
    _setStatus('running', 'busy');
    _startBusy(trimmed);

    try {
      const res = await window.terminal.exec(id, method, params);
      _endBusy();
      if (res && res.ok) {
        _setResult(entry, res.result === undefined ? null : res.result);
        _setStatus('ok', 'ok');
      } else {
        const kind = (res && res.kind) || 'rpc';
        _setResult(entry, (res && res.error) || 'unknown error', kind);
        _setStatus(kind === 'cancelled' ? 'cancelled' : kind === 'transport' ? 'node unreachable' : 'error', kind === 'cancelled' ? '' : 'err');
      }
    } catch (e) {
      _endBusy();
      _setResult(entry, e && e.message ? e.message : String(e), 'transport');
      _setStatus('error', 'err');
    } finally {
      _busy = false;
      _activeCall = null;
      if (inp) { inp.disabled = false; if (_open) inp.focus(); }
    }
  }

  async function _cancel() {
    if (!_busy || _activeCall == null) return;
    try { await window.terminal.cancel(_activeCall); } catch (_) {}
  }

  function _showHelp() {
    const entry = _appendEntry('help');
    const body = document.createElement('div');
    body.className = 'term-result';
    const lines = [
      ['any RPC method', 'run it — arguments parse as JSON, quoted text stays a string'],
      ['tab', 'complete a method name; press again to cycle'],
      ['↑ / ↓', 'command history (persists across sessions)'],
      ['ctrl+c', 'cancel the running command'],
      ['ctrl+l', 'clear output'],
      ['ctrl+f', 'search output'],
      ['esc', 'clear the input, or close when already empty'],
      ['clear', 'clear output'],
    ];
    for (const [k, v] of lines) {
      const row = document.createElement('div');
      row.className = 'term-help-row';
      row.appendChild(_span('term-help-key', k));
      row.appendChild(_span('term-help-desc', v));
      body.appendChild(row);
    }
    if (_methods.length) {
      const note = document.createElement('div');
      note.className = 'term-help-note';
      note.textContent = _methods.length + ' RPC methods available from this node';
      body.appendChild(note);
    }
    entry.appendChild(body);
    _scrollIfPinned();
  }

  // ── Autocomplete ──────────────────────────────────────────────────────────
  async function _fetchMethods() {
    if (_methods.length) return;
    try {
      const res = await window.terminal.exec(++_callId, 'help', []);
      if (!res || !res.ok || typeof res.result !== 'string') return;
      // Zero-argument methods print with no trailing space (getblockcount,
      // getmempoolinfo, and 30 others), so the terminator must be optional or
      // they are silently dropped from completion.
      _methods = res.result
        .split('\n')
        .map((l) => (l.match(/^([a-z][a-z0-9]*)(?:\s|$)/) || [])[1])
        .filter(Boolean)
        .sort();
      _saveMethods();
    } catch (_) {}
  }

  function _completeTab(shift) {
    const inp = _input();
    if (!inp) return;
    const value = inp.value;
    // Only complete the method name, which is the first token.
    if (/\s/.test(value.trim())) return;
    const prefix = value.trim().toLowerCase();
    if (!prefix) return;

    if (!_tabMatches || _tabMatches.prefix !== prefix) {
      const list = _methods.filter((m) => m.startsWith(prefix));
      if (!list.length) { _renderCandidates([]); return; }
      _tabMatches = { prefix, list };
      _tabIdx = 0;
    } else {
      _tabIdx = (_tabIdx + (shift ? -1 : 1) + _tabMatches.list.length) % _tabMatches.list.length;
    }
    const list = _tabMatches.list;
    if (list.length === 1) {
      inp.value = list[0] + ' ';
      _tabMatches = null;
      _renderCandidates([]);
    } else {
      inp.value = list[_tabIdx];
      _renderCandidates(list, _tabIdx);
    }
    inp.setSelectionRange(inp.value.length, inp.value.length);
  }

  function _renderCandidates(list, active) {
    const box = document.getElementById('term-candidates');
    if (!box) return;
    box.replaceChildren();
    if (!list.length) { box.style.display = 'none'; _scrollIfPinned(); return; }
    box.style.display = '';
    // The list takes height from the output area, so re-pin or the newest
    // line slides out of view exactly when the user is mid-command.
    requestAnimationFrame(_scrollIfPinned);
    list.slice(0, 40).forEach((m, i) => {
      const s = _span('term-cand' + (i === active ? ' term-cand-active' : ''), m);
      s.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const inp = _input();
        if (inp) { inp.value = m + ' '; inp.focus(); }
        _renderCandidates([]);
        _tabMatches = null;
      });
      box.appendChild(s);
    });
  }

  // ── Search ────────────────────────────────────────────────────────────────
  function _clearSearch() {
    _searchHits.forEach((el) => el.classList.remove('term-hit', 'term-hit-active'));
    _searchHits = [];
    _searchIdx = -1;
  }

  function _runSearch(term) {
    _clearSearch();
    _searchTerm = term;
    const out = _output();
    if (!out || !term) { _updateSearchCount(); return; }
    const needle = term.toLowerCase();
    // Highlight at entry granularity: cheap, and enough to navigate to.
    [...out.querySelectorAll('.term-entry')].forEach((entry) => {
      if (entry.textContent.toLowerCase().includes(needle)) {
        entry.classList.add('term-hit');
        _searchHits.push(entry);
      }
    });
    if (_searchHits.length) { _searchIdx = 0; _focusHit(); }
    _updateSearchCount();
  }

  function _focusHit() {
    _searchHits.forEach((el) => el.classList.remove('term-hit-active'));
    const el = _searchHits[_searchIdx];
    if (!el) return;
    el.classList.add('term-hit-active');
    _stickBottom = false;
    el.scrollIntoView({ block: 'center' });
    _updateSearchCount();
  }

  function _stepSearch(dir) {
    if (!_searchHits.length) return;
    _searchIdx = (_searchIdx + dir + _searchHits.length) % _searchHits.length;
    _focusHit();
  }

  function _updateSearchCount() {
    const c = document.getElementById('term-search-count');
    if (!c) return;
    c.textContent = _searchTerm
      ? (_searchHits.length ? (_searchIdx + 1) + '/' + _searchHits.length : 'no matches')
      : '';
  }

  function _toggleSearch(on) {
    const bar = document.getElementById('term-search');
    const field = document.getElementById('term-search-input');
    if (!bar) return;
    const show = on !== undefined ? on : bar.style.display === 'none';
    bar.style.display = show ? '' : 'none';
    if (show) { if (field) { field.focus(); field.select(); } }
    else { _clearSearch(); _searchTerm = ''; _updateSearchCount(); const inp = _input(); if (inp) inp.focus(); }
  }

  // ── Controls ──────────────────────────────────────────────────────────────
  function clearOutput() {
    const out = _output();
    if (out) out.replaceChildren();
    _clearSearch();
    _stickBottom = true;
    _setStatus('');
  }

  function _copyAll() {
    const out = _output();
    if (!out) return;
    const text = [...out.querySelectorAll('.term-entry')]
      .map((e) => {
        const raw = e._raw;
        const cmd = e.querySelector('.term-echo')?.textContent || '';
        return raw !== undefined ? cmd + '\n' + JSON.stringify(raw, null, 2) : e.textContent;
      })
      .join('\n\n');
    utils.copyToClipboard(text, null);
    _setStatus('copied', 'ok');
  }

  function _copyLast() {
    const out = _output();
    const last = out && out.lastElementChild;
    if (!last) return;
    const text = last._raw !== undefined ? JSON.stringify(last._raw, null, 2) : last.textContent;
    utils.copyToClipboard(text, null);
    _setStatus('copied', 'ok');
  }

  // ── Resize ────────────────────────────────────────────────────────────────
  function _initResize() {
    const el = _el();
    const handle = document.getElementById('term-resize');
    if (!el || !handle || handle._wired) return;
    handle._wired = true;

    try {
      const saved = parseInt(localStorage.getItem(LS_HEIGHT) || '0', 10);
      if (saved > 120) el.style.height = Math.min(saved, window.innerHeight - 60) + 'px';
    } catch (_) {}

    let startY = 0, startH = 0, dragging = false;
    const onMove = (e) => {
      if (!dragging) return;
      const h = Math.max(140, Math.min(window.innerHeight - 40, startH + (startY - e.clientY)));
      el.style.height = h + 'px';
    };
    const onUp = () => {
      if (!dragging) return;
      dragging = false;
      document.body.classList.remove('term-resizing');
      try { localStorage.setItem(LS_HEIGHT, String(parseInt(el.style.height, 10) || 0)); } catch (_) {}
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    handle.addEventListener('mousedown', (e) => {
      dragging = true;
      startY = e.clientY;
      startH = el.getBoundingClientRect().height;
      document.body.classList.add('term-resizing');
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      e.preventDefault();
    });
  }

  // ── Show / hide ───────────────────────────────────────────────────────────
  function show() {
    const el = _el();
    if (!el || _open) return;
    _open = true;
    el.style.display = 'flex';
    _initResize();
    requestAnimationFrame(() => el.classList.add('term-visible'));
    setTimeout(() => { const inp = _input(); if (inp) inp.focus(); }, 50);
    _updateNodeBadge();
    _fetchMethods();
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

  function _updateNodeBadge() {
    const b = document.getElementById('term-node');
    if (!b) return;
    const chain = (typeof nodePanel !== 'undefined' && nodePanel.currentChain) || 'main';
    const node = poller._lastData?.rpcNode || '';
    b.textContent = chain + (node ? ' · ' + node : '');
    b.className = 'term-node' + (chain === 'main' ? '' : ' term-node-alt');
  }

  // ── Wiring ────────────────────────────────────────────────────────────────
  function init() {
    _loadHistory();
    _loadMethods();

    const inp = _input();
    if (!inp) return;

    inp.addEventListener('keydown', (e) => {
      // Cancel takes priority over everything while a command is running.
      if (e.key === 'c' && e.ctrlKey) { e.preventDefault(); _cancel(); return; }
      if (e.key === 'l' && e.ctrlKey) { e.preventDefault(); clearOutput(); return; }
      if (e.key === 'f' && e.ctrlKey) { e.preventDefault(); _toggleSearch(true); return; }

      if (e.key === 'Enter') {
        e.preventDefault();
        const v = inp.value;
        if (!_busy) { inp.value = ''; _renderCandidates([]); _tabMatches = null; _stickBottom = true; _exec(v); }
        return;
      }
      if (e.key === 'Tab') { e.preventDefault(); _completeTab(e.shiftKey); return; }
      if (e.key === 'Escape') {
        e.preventDefault();
        // Clear a non-empty line first; only close when there is nothing to lose.
        if (inp.value) { inp.value = ''; _renderCandidates([]); _tabMatches = null; }
        else hide();
        return;
      }
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
        if (_histIdx > 0) { _histIdx--; inp.value = _history[_histIdx]; }
        else if (_histIdx === 0) { _histIdx = -1; inp.value = _draft; }
        inp.setSelectionRange(inp.value.length, inp.value.length);
        return;
      }
      // Any other key invalidates an in-progress tab cycle.
      if (e.key.length === 1) { _tabMatches = null; _renderCandidates([]); }
    });

    // Scroll lock: stop pinning to the bottom while the user reads back.
    const out = _output();
    if (out) {
      out.addEventListener('scroll', () => {
        const atBottom = out.scrollHeight - out.scrollTop - out.clientHeight < 24;
        _stickBottom = atBottom;
        const btn = document.getElementById('term-tobottom');
        if (btn) btn.style.display = atBottom ? 'none' : '';
      });
    }

    document.getElementById('term-close')?.addEventListener('click', hide);
    document.getElementById('term-clear')?.addEventListener('click', () => { clearOutput(); _input()?.focus(); });
    document.getElementById('term-copy')?.addEventListener('click', _copyAll);
    document.getElementById('term-tobottom')?.addEventListener('click', () => {
      _stickBottom = true;
      _scrollIfPinned();
      _input()?.focus();
    });

    const sInput = document.getElementById('term-search-input');
    sInput?.addEventListener('input', () => _runSearch(sInput.value));
    sInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.preventDefault(); _toggleSearch(false); }
      if (e.key === 'Enter') { e.preventDefault(); _stepSearch(e.shiftKey ? -1 : 1); }
    });
    document.getElementById('term-search-next')?.addEventListener('click', () => _stepSearch(1));
    document.getElementById('term-search-prev')?.addEventListener('click', () => _stepSearch(-1));
    document.getElementById('term-search-close')?.addEventListener('click', () => _toggleSearch(false));

    const maxBtn = document.getElementById('term-maximize');
    maxBtn?.addEventListener('click', () => {
      const el = _el();
      if (!el) return;
      const full = el.classList.toggle('term-fullscreen');
      maxBtn.textContent = full ? '⤡' : '⤢';
      maxBtn.setAttribute('aria-label', full ? 'Restore terminal' : 'Maximize terminal');
    });
  }

  return { init, show, hide, toggle, isOpen, clearOutput, _copyLast };
})();
