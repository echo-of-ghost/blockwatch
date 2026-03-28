"use strict";

// ═══════════════════════════════════════════════════════════════════════════════
// blockwatch · panels/peers.js
// Peer table, peer detail drawer, RPC actions, ban list
// ═══════════════════════════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════════════════════════
// PEERS MODULE — peer table, peer detail, RPC actions
// ═══════════════════════════════════════════════════════════════════════════════
const peersPanel = {
  _cache: [],
  _selectedId: null,
  _activeTab: "conn",
  _filterTerm: "",
  _actionController: null,
  _renderedPeerId: null,

  async rpc(method, params) {
    try {
      const res = await fetch("/api/rpc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method, params }),
      });
      const j = await res.json();
      if (j.error) throw new Error(j.error);
      return j.result;
    } catch (e) {
      toastStack.add(method + ": " + e.message);
      console.error("[rpc:" + method + "]", e.message);
      throw e;
    }
  },

  render(d) {
    const peers = d.peers || [];
    const ni = d.networkInfo || {};
    const ibd = d.blockchain?.initialblockdownload || false;
    this._cache = peers;

    const peersIn = peers.filter((p) => p.inbound);
    const peersOut = peers.filter((p) => !p.inbound);
    const connIn =
      ni.connections_in != null ? ni.connections_in : peersIn.length;
    const connOut =
      ni.connections_out != null ? ni.connections_out : peersOut.length;
    setText("peer-in-ph", "↓ " + connIn + " in");
    setText("peer-out-ph", "↑ " + connOut + " out");

    const tbody = $("peer-table-body");
    if (!tbody) return;

    if (ibd && !peers.length) {
      tbody.innerHTML =
        '<tr><td colspan="2" class="ibd-placeholder">peer data unavailable during initial sync</td></tr>';
      return;
    }

    const maxSent = peers.reduce((m, p) => Math.max(m, p.bytessent || 0), 1);
    const maxRecv = peers.reduce((m, p) => Math.max(m, p.bytesrecv || 0), 1);
    const maxBW = Math.max(maxSent, maxRecv);

    tbody.innerHTML = peers
      .map((p) => {
        const net = utils.peerNet(p.addr || "", p.network || "");
        const isSel = p.id === this._selectedId;

        // Badges - compact labels
        const dirLabel = p.inbound ? "in" : "out";
        const dirBadgeClass = p.inbound ? "peer-badge-in" : "peer-badge-out";
        const netLabel = net.toUpperCase();
        const netBadgeClass =
          net === "onion"
            ? "peer-badge-onion"
            : net === "ipv6"
              ? "peer-badge-ipv6"
              : net === "i2p"
                ? "peer-badge-i2p"
                : "peer-badge-ipv4";

        // Address cell
        const addr = esc(
          (p.addr || "").replace(/:\d+$/, "").replace(/^\[(.+)\]$/, "$1"),
        );
        const ver = esc((p.subver || "").replace(/^\/|\/$/g, ""));
        const sentPct = (((p.bytessent || 0) / maxBW) * 100).toFixed(1);
        const recvPct = (((p.bytesrecv || 0) / maxBW) * 100).toFixed(1);

        // Ping
        const pc =
          p.pingtime > 0
            ? p.pingtime < 0.06
              ? "grn"
              : p.pingtime < 0.18
                ? "dim"
                : "neg"
            : "dim";
        const ping =
          p.pingtime > 0 ? Math.round(p.pingtime * 1000) + "ms" : "—";
        const pingCell = `<span class="ping-cell"><span class="ping-dot ${pc}"></span><span class="ping-val td-${pc}">${ping}</span></span>`;

        return `<tr data-pid="${p.id}" role="row" tabindex="0" aria-selected="${isSel}"
        class="${isSel ? "peer-sel" : ""}">
        <td class="td-peer-main">
          <div class="peer-row-top">
            <span class="peer-addr-text">${addr || "—"}</span>
            <span class="peer-badges">
              <span class="peer-badge ${dirBadgeClass}">${dirLabel}</span>
              <span class="peer-badge ${netBadgeClass}">${netLabel}</span>
            </span>
          </div>
          <span class="peer-ver-text">${ver}</span>
          <div class="peer-bars-group">
            <div class="peer-bar-row">
              <span class="peer-bar-lbl">sent</span>
              <div class="peer-bar-track"><div class="peer-bar-fill" style="width:${sentPct}%;background:var(--pos)"></div></div>
              <span class="peer-bar-val sent">↑ ${utils.fmtBytes(p.bytessent || 0)}</span>
            </div>
            <div class="peer-bar-row">
              <span class="peer-bar-lbl">recv</span>
              <div class="peer-bar-track"><div class="peer-bar-fill" style="width:${recvPct}%;background:var(--orange)"></div></div>
              <span class="peer-bar-val recv">↓ ${utils.fmtBytes(p.bytesrecv || 0)}</span>
            </div>
          </div>
        </td>
        <td class="td-peer-ping">${pingCell}</td>
      </tr>`;
      })
      .join("");

    if (this._filterTerm) {
      this._applyFilter();
    }

    if (this._selectedId != null) {
      const p = this._cache.find((x) => x.id === this._selectedId);
      if (p) this.renderDetail(p);
    }
  },

  _applyFilter() {
    const term = this._filterTerm;
    const rows = $$("#peer-table-body tr[data-pid]");
    let visible = 0;
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      const show = !term || text.includes(term);
      row.style.display = show ? "" : "none";
      if (show) visible++;
    });

    let countEl = $("peer-filter-count");
    const input = $("peer-filter");
    if (!countEl && input?.parentElement) {
      countEl = document.createElement("div");
      countEl.id = "peer-filter-count";
      countEl.className = "peer-filter-count";
      input.parentElement.appendChild(countEl);
    }
    if (countEl) {
      countEl.textContent = term ? `${visible} / ${rows.length} shown` : "";
    }
  },

  renderDetail(p) {
    const body = $("peer-detail-body");

    if (!p) {
      if (body)
        body.innerHTML = '<div class="pd-empty">click a peer to inspect</div>';
      setText("pd-ph", "—");
      this._renderedPeerId = null;
      return;
    }

    // Same peer already rendered — patch values in-place, no DOM rebuild
    if (this._renderedPeerId === p.id && body?.querySelector("[data-pd]")) {
      this._patchDetail(p, body);
      return;
    }
    this._renderedPeerId = p.id;

    const net = utils.peerNet(p.addr || "", p.network || "");
    const now = Date.now() / 1000;
    const svcs = utils.decodeServices(p.services);
    const addrDisplay = (p.addr || "")
      .replace(/:\d+$/, "")
      .replace(/^\[(.+)\]$/, "$1");
    setText("pd-ph", addrDisplay || "—");

    const netLabelClass =
      net === "onion"
        ? "net-onion"
        : net === "ipv6"
          ? "net-ipv6"
          : net === "i2p"
            ? "net-i2p"
            : "net-ipv4";

    const ct = p.connection_type || "";
    const CT_CLASS = {
      "outbound-full-relay": "ct-outbound",
      "block-relay-only": "ct-block-relay",
      inbound: "ct-inbound",
      feeler: "ct-feeler",
      "addr-fetch": "ct-feeler",
      manual: "ct-manual",
    };
    const ctClass = CT_CLASS[ct] || "";
    const ctLabel = ct.replace("outbound-full-relay", "full-relay") || "—";
    const verClean = esc((p.subver || "").replace(/^\/|\/$/g, ""));
    const asnStr = p.mapped_as != null ? "AS" + p.mapped_as : null;
    const isV2 = (p.transport_protocol_type || "").includes("v2");
    const pingMs = p.pingtime > 0 ? Math.round(p.pingtime * 1000) : null;
    const pingCls =
      pingMs == null
        ? "dim"
        : pingMs < 60
          ? "grn"
          : pingMs < 180
            ? "dim"
            : "neg";
    const lastSendStr =
      p.lastsend > 0 ? utils.fmtAgeAgo(now - p.lastsend) : "—";
    const lastRecvStr =
      p.lastrecv > 0 ? utils.fmtAgeAgo(now - p.lastrecv) : "—";
    const hdrBlkGap = (p.synced_headers || 0) - (p.synced_blocks || 0);
    const ff = p.minfeefilter ?? p.fee_filter;
    const permsArr = Array.isArray(p.permissions)
      ? p.permissions
      : p.permissions
        ? String(p.permissions)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : [];

    const svcHTML = svcs
      .map((s) => {
        const cls = ["NETWORK", "WITNESS"].includes(s)
          ? "svc-core"
          : ["BLOOM", "COMPACT_FILTERS", "P2P_V2"].includes(s)
            ? "svc-cap"
            : "svc-ltd";
        return `<span class="${cls}">${esc(s)}</span>`;
      })
      .join("");

    const sm = p.bytessent_per_msg || {},
      rm = p.bytesrecv_per_msg || {};
    const msgs = [...new Set([...Object.keys(sm), ...Object.keys(rm)])].sort();
    const msgRows = msgs.length
      ? `
      <div class="pd-section">
        <div class="pd-section-label">per-message bytes</div>
        <div class="pd-msg-grid">
          ${msgs
            .map(
              (k) => `
            <span class="pd-msg-name">${esc(k)}</span>
            <span class="pd-msg-sent">↑ ${utils.fmtBytes(sm[k] || 0)}</span>
            <span class="pd-msg-recv" data-pd="msg-${esc(k)}">↓ ${utils.fmtBytes(rm[k] || 0)}</span>`,
            )
            .join("")}
        </div>
      </div>`
      : "";

    const header = `
      <div class="pd-header">
        <div class="pd-header-top">
          <span class="pd-header-addr">${esc(addrDisplay || "—")}</span>
          <span class="pd-header-copy copy-icon" data-copy="${esc(p.addr || "")}">⎘</span>
        </div>
        <div class="pd-header-badges">
          <span class="pd-header-net ${netLabelClass}">${esc(net)}</span>
          <span class="pd-badge ${p.inbound ? "pd-badge-dir-in" : "pd-badge-dir-out"}">${p.inbound ? "← in" : "→ out"}</span>
          ${ct ? `<span class="pd-badge pd-badge-ct ${ctClass}">${esc(ctLabel)}</span>` : ""}
          ${verClean ? `<span class="pd-badge pd-badge-ua">${verClean}</span>` : ""}
          ${isV2 ? `<span class="pd-badge pd-badge-v2">v2 enc</span>` : ""}
          ${asnStr ? `<span class="pd-badge pd-badge-asn">${esc(asnStr)}</span>` : ""}
        </div>
      </div>`;

    const statGrid = `
      <div class="pd-stat-grid">
        <div class="pd-stat-cell">
          <span class="pd-stat-val ${pingCls}" data-pd="ping">${pingMs != null ? pingMs + "ms" : "—"}</span>
          <span class="pd-stat-lbl">ping${p.minping > 0 ? " · min " + Math.round(p.minping * 1000) + "ms" : ""}</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim" data-pd="conntime">${p.conntime ? utils.fmtAge(now - p.conntime) : "—"}</span>
          <span class="pd-stat-lbl">connected</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim">${p.version ? esc(String(p.version)) : "—"}</span>
          <span class="pd-stat-lbl">protocol</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim" data-pd="synced-headers">${p.synced_headers ? fb(p.synced_headers) : "—"}</span>
          <span class="pd-stat-lbl">headers</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim" data-pd="synced-blocks">${p.synced_blocks ? fb(p.synced_blocks) : "—"}</span>
          <span class="pd-stat-lbl">blocks</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim">${p.startingheight ? fb(p.startingheight) : "—"}</span>
          <span class="pd-stat-lbl">start height</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val sent" data-pd="bw-sent">↑ ${utils.fmtBytes(p.bytessent || 0)}</span>
          <span class="pd-stat-lbl">sent</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val recv" data-pd="bw-recv">↓ ${utils.fmtBytes(p.bytesrecv || 0)}</span>
          <span class="pd-stat-lbl">recv</span>
        </div>
        <div class="pd-stat-cell">
          <span class="pd-stat-val dim" data-pd="last-block-grid">${p.last_block > 0 ? utils.fmtAgeAgo(now - p.last_block) : "—"}</span>
          <span class="pd-stat-lbl">last block</span>
        </div>
      </div>`;

    const sections = `
      <div class="pd-body">
        <div class="pd-section">
          <div class="pd-section-label">sync</div>
          <div class="pd-kv"><span class="k">headers</span><span class="v dim" data-pd="synced-headers">${fb(p.synced_headers || 0)}</span></div>
          <div class="pd-kv"><span class="k">hdr–blk gap</span><span class="v ${hdrBlkGap > 10 ? "o" : "dim"}" data-pd="hdr-blk-gap">${fb(hdrBlkGap)}</span></div>
          <div class="pd-kv"><span class="k">start height</span><span class="v dim">${fb(p.startingheight || 0)}</span></div>
          <div class="pd-kv"><span class="k">HB to peer</span><span class="v ${p.bip152_hb_to ? "grn" : "dim"}">${p.bip152_hb_to != null ? (p.bip152_hb_to ? "high-bw" : "low-bw") : "—"}</span></div>
          <div class="pd-kv"><span class="k">HB from peer</span><span class="v ${p.bip152_hb_from ? "grn" : "dim"}">${p.bip152_hb_from != null ? (p.bip152_hb_from ? "high-bw" : "low-bw") : "—"}</span></div>
        </div>
        <div class="pd-section">
          <div class="pd-section-label">timing</div>
          <div class="pd-kv"><span class="k">last send</span><span class="v dim" data-pd="lastsend">${lastSendStr}</span></div>
          <div class="pd-kv"><span class="k">last recv</span><span class="v dim" data-pd="lastrecv">${lastRecvStr}</span></div>
          <div class="pd-kv"><span class="k">last block</span><span class="v dim" data-pd="last-block">${p.last_block > 0 ? utils.fmtAgeAgo(now - p.last_block) : "—"}</span></div>
          <div class="pd-kv"><span class="k">last tx</span><span class="v dim" data-pd="last-tx">${p.last_transaction > 0 ? utils.fmtAgeAgo(now - p.last_transaction) : "—"}</span></div>
          <div class="pd-kv"><span class="k">time offset</span><span class="v ${Math.abs(p.timeoffset || 0) > 70 ? "neg" : "dim"}">${p.timeoffset != null ? (p.timeoffset > 0 ? "+" : "") + p.timeoffset + "s" : "—"}</span></div>
          ${p.pingwait != null ? `<div class="pd-kv"><span class="k">ping wait</span><span class="v neg">${Math.round(p.pingwait * 1000)}ms in-flight</span></div>` : ""}
        </div>
        <div class="pd-section">
          <div class="pd-section-label">connection</div>
          <div class="pd-kv"><span class="k">transport</span><span class="v dim">${esc(p.transport_protocol_type || "—")}</span></div>
          ${p.session_id ? `<div class="pd-kv"><span class="k">session id</span><span class="v mono">${esc(p.session_id.slice(0, 16))}…</span></div>` : ""}
          <div class="pd-kv"><span class="k">relay txs</span><span class="v ${p.relaytxes === false ? "neg" : "dim"}">${p.relaytxes === false ? "no" : "yes"}</span></div>
          ${ff != null ? `<div class="pd-kv"><span class="k">fee filter</span><span class="v dim">${f(ff * 1e5, 2)} sat/vB</span></div>` : ""}
          ${p.addr_local ? `<div class="pd-kv"><span class="k">local addr</span><span class="v mono">${esc(p.addr_local)}</span></div>` : ""}
          ${permsArr.length ? `<div class="pd-kv"><span class="k">flags</span><span class="v dim">${esc(permsArr.join(", "))}</span></div>` : ""}
          <div class="pd-kv"><span class="k">addr processed</span><span class="v dim" data-pd="addr-processed">${p.addr_processed != null ? fb(p.addr_processed) : "—"}</span></div>
          ${p.addr_rate_limited > 0 ? `<div class="pd-kv"><span class="k">addr rate-lim</span><span class="v neg" data-pd="addr-rate-lim">${fb(p.addr_rate_limited)}</span></div>` : ""}
        </div>
        <div class="pd-section">
          <div class="pd-section-label">services</div>
          <div class="pd-svc">${svcHTML}</div>
        </div>
        ${msgRows}
        <div class="pd-section">
          <div class="pd-section-label">actions</div>
          <div class="peer-actions">
            <button type="button" class="pa-btn" data-pa="disconnect">disconnect</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban1h">ban 1h</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban24h">ban 24h</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban7d">ban 7d</button>
            <button type="button" class="pa-btn pa-ban" data-pa="ban30d">ban 30d</button>
            <button type="button" class="pa-btn pa-ban" data-pa="banperm">ban ∞</button>
          </div>
        </div>
      </div>`;

    if (body) body.innerHTML = header + statGrid + sections;
    this._wireActions(p, body);
  },

  // Patch live values in-place — no innerHTML rebuild, no scroll disruption
  _patchDetail(p, body) {
    const now = Date.now() / 1000;
    const set = (key, val) => {
      const el = body.querySelector(`[data-pd="${key}"]`);
      if (el && el.textContent !== val) el.textContent = val;
    };
    const pingMs = p.pingtime > 0 ? Math.round(p.pingtime * 1000) : null;
    set("ping", pingMs != null ? pingMs + "ms" : "—");
    set("conntime", p.conntime ? utils.fmtAge(now - p.conntime) : "—");
    set("synced-blocks", p.synced_blocks ? fb(p.synced_blocks) : "—");
    set("bw-sent", "↑ " + utils.fmtBytes(p.bytessent || 0));
    set("bw-recv", "↓ " + utils.fmtBytes(p.bytesrecv || 0));
    set("synced-headers", fb(p.synced_headers || 0));
    set("hdr-blk-gap", fb((p.synced_headers || 0) - (p.synced_blocks || 0)));
    set("lastsend", p.lastsend > 0 ? utils.fmtAgeAgo(now - p.lastsend) : "—");
    set("lastrecv", p.lastrecv > 0 ? utils.fmtAgeAgo(now - p.lastrecv) : "—");
    set(
      "last-block",
      p.last_block > 0 ? utils.fmtAgeAgo(now - p.last_block) : "—",
    );
    set(
      "last-block-grid",
      p.last_block > 0 ? utils.fmtAgeAgo(now - p.last_block) : "—",
    );
    set(
      "last-tx",
      p.last_transaction > 0 ? utils.fmtAgeAgo(now - p.last_transaction) : "—",
    );
    set(
      "addr-processed",
      p.addr_processed != null ? fb(p.addr_processed) : "—",
    );
    set(
      "addr-rate-lim",
      p.addr_rate_limited != null ? fb(p.addr_rate_limited) : "—",
    );
    const sm = p.bytessent_per_msg || {},
      rm = p.bytesrecv_per_msg || {};
    [...new Set([...Object.keys(sm), ...Object.keys(rm)])].forEach((k) =>
      set("msg-" + k, "↓ " + utils.fmtBytes(rm[k] || 0)),
    );
  },

  _wireActions(p, body) {
    if (!body) return;

    if (this._actionController) this._actionController.abort();
    this._actionController = new AbortController();
    const signal = this._actionController.signal;

    body.querySelectorAll(".pa-btn[data-pa]").forEach((btn) => {
      let pendingReset = null;

      btn.addEventListener(
        "click",
        async (e) => {
          e.stopPropagation();
          const action = btn.dataset.pa;

          if (action === "disconnect") {
            btn.classList.add("pa-working");
            try {
              await this.rpc("disconnectnode", [p.addr || ""]);
              this._selectedId = null;
              this.renderDetail(null);
              setTimeout(() => poller.fetchNow(), 600);
            } catch (_) {
              btn.classList.remove("pa-working");
            }
            return;
          }

          // Ban: require confirmation click within 3s
          if (btn.dataset.confirm !== "pending") {
            clearTimeout(pendingReset);
            const origText = btn.textContent;
            btn.dataset.origText = origText;
            btn.dataset.confirm = "pending";
            btn.textContent = "confirm?";
            btn.style.opacity = "1";
            pendingReset = setTimeout(() => {
              btn.dataset.confirm = "";
              btn.textContent = btn.dataset.origText || origText;
              btn.style.opacity = "";
            }, 3000);
            return;
          }

          // Confirmed
          clearTimeout(pendingReset);
          btn.dataset.confirm = "";
          btn.textContent = btn.dataset.origText || btn.textContent;
          btn.style.opacity = "";
          btn.classList.add("pa-working");

          try {
            const banAddr = (p.addr || "")
              .replace(/:(\d+)$/, "")
              .replace(/^\[(.+)\]$/, "$1");
            if (action === "banperm") {
              await this.rpc("setban", [banAddr, "add", 253370764800, true]);
            } else {
              const dur = {
                ban1h: 3600,
                ban24h: 86400,
                ban7d: 604800,
                ban30d: 2592000,
              }[action];
              await this.rpc("setban", [banAddr, "add", dur, false]);
            }
            this._selectedId = null;
            this.renderDetail(null);
            banList.refresh();
            setTimeout(() => poller.fetchNow(), 600);
          } catch (_) {
            btn.classList.remove("pa-working");
          }
        },
        { signal },
      );
    });
  },

  selectById(pid) {
    this._selectedId = pid;
    this._renderedPeerId = null;
    $("peer-table-body")
      ?.querySelectorAll("tr")
      .forEach((r) =>
        r.classList.toggle("peer-sel", parseInt(r.dataset.pid, 10) === pid),
      );
    const p = this._cache.find((x) => x.id === pid);
    if (p) {
      this.renderDetail(p);
    } else {
      const body = $("peer-detail-body");
      if (body) body.innerHTML = '<div class="pd-empty">peer disconnected</div>';
      setText("pd-ph", "—");
      this._renderedPeerId = null;
    }
  },

  exportTSV() {
    const now = Date.now() / 1000;
    const cols = [
      "id",
      "addr",
      "network",
      "direction",
      "connection_type",
      "relaytxes",
      "version",
      "subver",
      "synced_blocks",
      "synced_headers",
      "startingheight",
      "pingtime_ms",
      "minping_ms",
      "conntime_age_s",
      "lastrecv_ago_s",
      "last_block_ago_s",
      "last_transaction_ago_s",
      "bytessent",
      "bytesrecv",
      "services",
      "minfeefilter",
      "addr_processed",
      "addr_rate_limited",
      "transport_protocol_type",
    ];

    const row = (p) =>
      [
        p.id,
        p.addr || "",
        utils.peerNet(p.addr || "", p.network || ""),
        p.inbound ? "inbound" : "outbound",
        p.connection_type || "",
        p.relaytxes === false ? "false" : "true",
        p.version || "",
        (p.subver || "").replace(/^\/|\/$/g, ""),
        p.synced_blocks ?? "",
        p.synced_headers ?? "",
        p.startingheight ?? "",
        p.pingtime > 0 ? Math.round(p.pingtime * 1000) : "",
        p.minping > 0 ? Math.round(p.minping * 1000) : "",
        p.conntime ? Math.round(now - p.conntime) : "",
        p.lastrecv ? Math.round(now - p.lastrecv) : "",
        p.last_block > 0 ? Math.round(now - p.last_block) : "",
        p.last_transaction > 0 ? Math.round(now - p.last_transaction) : "",
        p.bytessent ?? 0,
        p.bytesrecv ?? 0,
        p.services || "",
        p.minfeefilter ?? p.fee_filter ?? "",
        p.addr_processed ?? "",
        p.addr_rate_limited ?? "",
        p.transport_protocol_type || "",
      ]
        .map((v) => String(v).replace(/\t/g, " "))
        .join("\t");

    const tsv = [cols.join("\t"), ...this._cache.map(row)].join("\n");
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(
      new Blob([tsv], { type: "text/tab-separated-values" }),
    );
    a.download = `peers-${ts}.tsv`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
};

// ═══════════════════════════════════════════════════════════════════════════════
// BAN LIST MODULE
// ═══════════════════════════════════════════════════════════════════════════════
const banList = {
  async refresh() {
    const rowsEl = $("ban-rows");
    const phEl = $("ban-ph");
    if (!rowsEl) return;

    let bans = [];
    try {
      bans = await peersPanel.rpc("listbanned", []);
    } catch (_) {
      return;
    }

    if (!bans || !bans.length) {
      if (phEl) phEl.textContent = "—";
      rowsEl.innerHTML = '<div class="ban-empty">no bans</div>';
      return;
    }

    if (phEl)
      phEl.textContent =
        bans.length + (bans.length === 1 ? " address" : " addresses");

    rowsEl.innerHTML = bans
      .map(
        (b) =>
          '<div class="ban-row">' +
          '<span class="ban-row-addr">' +
          esc(b.address || "") +
          "</span>" +
          '<span class="ban-row-exp">' +
          utils.fmtBanLeft(b) +
          "</span>" +
          '<button type="button" class="pa-btn pa-unban" data-unban="' +
          esc(b.address || "") +
          '">unban</button>' +
          "</div>",
      )
      .join("");

    rowsEl.querySelectorAll(".pa-btn[data-unban]").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        e.stopPropagation();
        btn.classList.add("pa-working");
        try {
          await peersPanel.rpc("setban", [btn.dataset.unban, "remove"]);
          await this.refresh();
          setTimeout(() => poller.fetchNow(), 400);
        } catch (_) {
          btn.classList.remove("pa-working");
        }
      });
    });
  },
};
