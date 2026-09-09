const http = require("http"),
  fs = require("fs"),
  net = require("net"),
  path = require("path"),
  os = require("os"),
  readline = require("readline"),
  crypto = require("crypto");
const RPC_HOST = process.env.BITCOIN_RPC_HOST || "127.0.0.1";
let RPC_PORT = parseInt(process.env.BITCOIN_RPC_PORT || "0");
const SERVER_PORT = parseInt(process.env.PORT || "3000");

// Remote mode: BLOCKWATCH_REMOTE=1 binds to 0.0.0.0 and enables basic auth.
// Default is loopback-only (Electron window accesses it directly).
const REMOTE_MODE = process.env.BLOCKWATCH_REMOTE === "1";
const SERVER_HOST = process.env.HOST || (REMOTE_MODE ? "0.0.0.0" : "127.0.0.1");

const ZMQ_HOST = process.env.ZMQ_HOST || "127.0.0.1";
const ZMQ_PORT = parseInt(process.env.ZMQ_PORT || "28332");

let RPC_USER = "",
  RPC_PASS = "";

// Remote dashboard credentials — only used when REMOTE_MODE is enabled.
let REMOTE_USER = process.env.BLOCKWATCH_USER || "";
let REMOTE_PASS = process.env.BLOCKWATCH_PASS || "";

// Timing-safe credential comparison (hashes both sides to equalise length).
function _credEq(a, b) {
  const ha = crypto.createHash("sha256").update(String(a)).digest();
  const hb = crypto.createHash("sha256").update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function checkRemoteAuth(req, res) {
  if (!REMOTE_MODE) return true;
  const header = req.headers.authorization || "";
  if (!header.startsWith("Basic ")) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="blockwatch"', "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return false;
  }
  const decoded = Buffer.from(header.slice(6), "base64").toString();
  const colon = decoded.indexOf(":");
  const u = colon >= 0 ? decoded.slice(0, colon) : decoded;
  const p = colon >= 0 ? decoded.slice(colon + 1) : "";
  if (!_credEq(u, REMOTE_USER) || !_credEq(p, REMOTE_PASS)) {
    res.writeHead(401, { "WWW-Authenticate": 'Basic realm="blockwatch"', "Content-Type": "text/plain" });
    res.end("Unauthorized");
    return false;
  }
  return true;
}

const COOKIE_CANDIDATES = [
  process.env.BITCOIN_COOKIE_FILE
    ? {
        port: parseInt(process.env.BITCOIN_RPC_PORT || "8332"),
        cookie: process.env.BITCOIN_COOKIE_FILE,
      }
    : null,
  { port: 8332, cookie: path.join(os.homedir(), ".bitcoin", ".cookie") },
  {
    port: 8332,
    cookie: path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Bitcoin",
      ".cookie",
    ),
  },
  {
    port: 8332,
    cookie: path.join(
      os.homedir(),
      "snap",
      "bitcoin-core",
      "current",
      ".bitcoin",
      ".cookie",
    ),
  },
  {
    port: 48332,
    cookie: path.join(os.homedir(), ".bitcoin", "testnet4", ".cookie"),
  },
  {
    port: 48332,
    cookie: path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Bitcoin",
      "testnet4",
      ".cookie",
    ),
  },
  {
    port: 48332,
    cookie: path.join(
      os.homedir(),
      "snap",
      "bitcoin-core",
      "current",
      ".bitcoin",
      "testnet4",
      ".cookie",
    ),
  },
  {
    port: 38332,
    cookie: path.join(os.homedir(), ".bitcoin", "signet", ".cookie"),
  },
  {
    port: 38332,
    cookie: path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Bitcoin",
      "signet",
      ".cookie",
    ),
  },
  {
    port: 38332,
    cookie: path.join(
      os.homedir(),
      "snap",
      "bitcoin-core",
      "current",
      ".bitcoin",
      "signet",
      ".cookie",
    ),
  },
  {
    port: 18443,
    cookie: path.join(os.homedir(), ".bitcoin", "regtest", ".cookie"),
  },
  {
    port: 18443,
    cookie: path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "Bitcoin",
      "regtest",
      ".cookie",
    ),
  },
  {
    port: 18443,
    cookie: path.join(
      os.homedir(),
      "snap",
      "bitcoin-core",
      "current",
      ".bitcoin",
      "regtest",
      ".cookie",
    ),
  },
  // Windows — %APPDATA%\Bitcoin\ (undefined on Linux/macOS, filtered out below)
  process.env.APPDATA
    ? {
        port: 8332,
        cookie: path.join(process.env.APPDATA, "Bitcoin", ".cookie"),
      }
    : null,
  process.env.APPDATA
    ? {
        port: 48332,
        cookie: path.join(
          process.env.APPDATA,
          "Bitcoin",
          "testnet4",
          ".cookie",
        ),
      }
    : null,
  process.env.APPDATA
    ? {
        port: 38332,
        cookie: path.join(process.env.APPDATA, "Bitcoin", "signet", ".cookie"),
      }
    : null,
  process.env.APPDATA
    ? {
        port: 18443,
        cookie: path.join(process.env.APPDATA, "Bitcoin", "regtest", ".cookie"),
      }
    : null,
].filter(Boolean);

function tryCookie() {
  if (process.env.BITCOIN_RPC_PORT) {
    const explicitPort = parseInt(process.env.BITCOIN_RPC_PORT);
    for (const { port, cookie } of COOKIE_CANDIDATES) {
      if (port !== explicitPort) continue;
      try {
        const r = fs.readFileSync(cookie, "utf8").trim(),
          i = r.indexOf(":");
        if (i < 1) continue;
        return {
          user: r.slice(0, i),
          pass: r.slice(i + 1),
          file: cookie,
          port,
        };
      } catch (_) {}
    }
    return null;
  }
  // No port set — pick most recently modified cookie (= most recently started node)
  let best = null;
  for (const { port, cookie } of COOKIE_CANDIDATES) {
    try {
      const mtimeMs = fs.statSync(cookie).mtimeMs;
      const r = fs.readFileSync(cookie, "utf8").trim(),
        i = r.indexOf(":");
      if (i < 1) continue;
      if (!best || mtimeMs > best.mtimeMs)
        best = {
          user: r.slice(0, i),
          pass: r.slice(i + 1),
          file: cookie,
          port,
          mtimeMs,
        };
    } catch (_) {}
  }
  return best;
}

// Cache cookie auth for 5s so a full refresh only hits disk once per batch.
let _authCache = null,
  _authCacheAt = 0;
const AUTH_TTL_MS = 5000;
// Set once credentials come from the environment or an interactive prompt.
// Explicit credentials always win over a cookie file that happens to exist.
let _explicitCreds = false;
function getAuth() {
  if (_explicitCreds) {
    if (!RPC_PORT) RPC_PORT = 8332;
    return { user: RPC_USER, pass: RPC_PASS };
  }
  const now = Date.now();
  if (_authCache && now - _authCacheAt < AUTH_TTL_MS) return _authCache;
  const cookie = tryCookie();
  if (cookie) {
    if (!process.env.BITCOIN_RPC_PORT) RPC_PORT = cookie.port;
    _authCache = { user: cookie.user, pass: cookie.pass };
  } else {
    if (!RPC_PORT) RPC_PORT = 8332;
    _authCache = { user: RPC_USER, pass: RPC_PASS };
  }
  _authCacheAt = now;
  return _authCache;
}

function prompt(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    if (hidden) {
      if (!process.stdin.isTTY) {
        process.stdout.write(
          question + "(warning: stdin is not a TTY — password will echo)\n",
        );
        rl.question("", (ans) => {
          rl.close();
          resolve(ans.trim());
        });
        return;
      }
      process.stdout.write(question);
      process.stdin.setRawMode(true);
      let val = "";
      process.stdin.resume();
      process.stdin.setEncoding("utf8");
      const onData = (ch) => {
        if (ch === "\u0003") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          rl.close();
          process.stdout.write("\n");
          process.exit(0);
        } else if (ch === "\n" || ch === "\r") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onData);
          process.stdout.write("\n");
          rl.close();
          resolve(val);
        } else if (ch === "\u007f" || ch === "\b") {
          if (val.length > 0) {
            val = val.slice(0, -1);
            process.stdout.write("\b \b");
          }
        } else if (val.length < 256) {
          val += ch;
          process.stdout.write("*");
        }
      };
      process.stdin.on("data", onData);
    } else {
      rl.question(question, (ans) => {
        rl.close();
        resolve(ans.trim());
      });
    }
  });
}

// -- ANSI theme matching the UI --
const A = {
  reset: "\x1b[0m",
  orange: "\x1b[38;2;240;112;32m",
  pos: "\x1b[38;2;196;137;74m",
  t1: "\x1b[38;2;232;232;232m",
  t2: "\x1b[38;2;168;168;168m",
  t3: "\x1b[38;2;104;104;104m",
  t4: "\x1b[38;2;64;64;64m",
  grn: "\x1b[38;2;90;170;106m",
  neg: "\x1b[38;2;208;88;88m",
  bold: "\x1b[1m",
};
const c = (col, s) => col + s + A.reset;
const W = process.stdout.columns || 72;
function row(label, value, col = A.t2) {
  process.stdout.write(
    "  " + c(A.t3, (label + ":").padEnd(15)) + "  " + c(col, value) + "\n",
  );
}

function printBanner() {
  const contentWidth = 15 + 2 + 20;
  const barLen = Math.min(Math.max(contentWidth, W - 4), 56);
  const bar = c(A.t4, "-".repeat(barLen));
  process.stdout.write("\n");
  process.stdout.write("  " + c(A.t1, "BLOCKWATCH") + "\n");
  process.stdout.write("  " + bar + "\n");
}

// Prompting only works with an interactive terminal. Under systemd, launchd or
// a packaged AppImage stdin is not a TTY and readline would wait forever.
function requireTTY(what) {
  if (process.stdin.isTTY) return;
  throw new Error(
    what +
      " required but stdin is not a TTY, so blockwatch cannot prompt. " +
      "Set BITCOIN_COOKIE_FILE, or BITCOIN_RPC_USER and BITCOIN_RPC_PASS" +
      (REMOTE_MODE ? ", and BLOCKWATCH_USER / BLOCKWATCH_PASS" : "") +
      " in the environment.",
  );
}

async function loadAuth() {
  // Remote dashboard credentials
  if (REMOTE_MODE) {
    if (!REMOTE_USER || !REMOTE_PASS) {
      requireTTY("dashboard credentials");
      process.stdout.write("  " + c(A.pos, "! ") + c(A.t2, "remote mode — set dashboard credentials") + "\n\n");
      REMOTE_USER = await prompt("  " + c(A.t3, "dashboard user".padEnd(14)) + "  ");
      REMOTE_PASS = await prompt("  " + c(A.t3, "dashboard pass".padEnd(14)) + "  ", true);
      process.stdout.write("\n");
    } else {
      row("remote auth", "env vars  " + c(A.t4, "(" + REMOTE_USER + ")"), A.grn);
    }
  }

  if (process.env.BITCOIN_RPC_USER && process.env.BITCOIN_RPC_PASS) {
    RPC_USER = process.env.BITCOIN_RPC_USER;
    RPC_PASS = process.env.BITCOIN_RPC_PASS;
    _explicitCreds = true;
    if (!RPC_PORT) RPC_PORT = 8332;
    row("auth", "env vars  " + c(A.t4, "(" + RPC_USER + ")"), A.grn);
    return;
  }
  const cookie = tryCookie();
  if (cookie) {
    const netLabel = {
      8332: "mainnet",
      48332: "testnet4",
      38332: "signet",
      18443: "regtest",
    };
    const net = netLabel[cookie.port] || "port " + cookie.port;
    if (!process.env.BITCOIN_RPC_PORT) RPC_PORT = cookie.port;
    row("auth", "cookie  " + c(A.t4, cookie.file), A.grn);
    row("network", net, cookie.port === 8332 ? A.t2 : A.pos);
    return;
  }
  requireTTY("no RPC cookie found; RPC credentials");
  process.stdout.write(
    "  " +
      c(A.pos, "! ") +
      c(A.t2, "no cookie found — enter RPC credentials") +
      "\n\n",
  );
  RPC_USER = await prompt("  " + c(A.t3, "rpc user".padEnd(14)) + "  ");
  RPC_PASS = await prompt("  " + c(A.t3, "rpc pass".padEnd(14)) + "  ", true);
  _explicitCreds = true;
  if (!RPC_PORT) RPC_PORT = 8332;
  process.stdout.write("\n");
}

const _rpcAgent = new http.Agent({
  keepAlive: true,
  maxSockets: 8,
  keepAliveMsecs: 3000,
});

// Static file cache — loaded once at startup, served from memory.
const _static = {};
function loadStaticFiles() {
  const CLIENT_SCRIPTS = [
    "shared.js",
    "network.js",
    "charts.js",
    "ui.js",
    "panels/node.js",
    "panels/peers.js",
    "panels/mining.js",
    "panels/mempool.js",
    "terminal.js",
    "fluid.js",
    "boot.js",
  ];
  const files = [
    {
      path: path.join(__dirname, "index.html"),
      mime: "text/html",
      key: "/index.html",
      noStore: true,
    },
    {
      path: path.join(__dirname, "blockwatch.css"),
      mime: "text/css",
      key: "/blockwatch.css",
      noStore: false,
    },
    {
      path: path.join(__dirname, "robots.txt"),
      mime: "text/plain",
      key: "/robots.txt",
      noStore: false,
      optional: true,
    },
    {
      path: path.join(__dirname, "Geist-Regular.woff2"),
      mime: "font/woff2",
      key: "/Geist-Regular.woff2",
      noStore: false,
      optional: true,
    },
    {
      path: path.join(__dirname, "GeistMono-Regular.woff2"),
      mime: "font/woff2",
      key: "/GeistMono-Regular.woff2",
      noStore: false,
      optional: true,
    },
    ...CLIENT_SCRIPTS.map((s) => ({
      path: path.join(__dirname, "client", s),
      mime: "application/javascript",
      key: "/client/" + s,
      noStore: false,
    })),
  ];
  const REQUIRED_KEYS = new Set([
    "/index.html",
    "/blockwatch.css",
    ...CLIENT_SCRIPTS.map((s) => "/client/" + s),
  ]);
  for (const f of files) {
    try {
      const buf = fs.readFileSync(f.path);
      const etag =
        '"' +
        crypto.createHash("sha256").update(buf).digest("hex").slice(0, 16) +
        '"';
      _static[f.key] = { buf, mime: f.mime, etag, noStore: f.noStore };
    } catch (e) {
      if (REQUIRED_KEYS.has(f.key))
        console.error(
          "[error] required static file missing " + f.path + ": " + e.message,
        );
      else if (!f.optional)
        console.error("[warn] could not preload " + f.path + ": " + e.message);
    }
  }
  // Cache-bust the assets index.html pulls in. index.html itself is no-store,
  // but the scripts and stylesheet are cached for an hour, so after an upgrade
  // a browser can pair new HTML with a stale module or stale styles. Stamp each
  // URL with that file's own ETag; the static lookup ignores the query string.
  const idx = _static["/index.html"];
  if (idx) {
    const stamp = (src) => {
      const entry = _static["/" + src];
      const v = entry ? entry.etag.replace(/"/g, "") : "";
      return v ? src + "?v=" + v : src;
    };
    const html = idx.buf
      .toString("utf8")
      .replace(/(<script\s+src=")([^"?>]+\.js)(")/g, (m, pre, src, post) => pre + stamp(src) + post)
      .replace(/(<link\b[^>]*\bhref=")([^"?>]+\.css)(")/g, (m, pre, src, post) => pre + stamp(src) + post);
    idx.buf = Buffer.from(html, "utf8");
  }
}
loadStaticFiles();

// Commands that can legitimately take minutes to hours
const SLOW_RPC_METHODS = new Set([
  "gettxoutsetinfo",   // full UTXO set scan
  "scantxoutset",      // UTXO scan for descriptors
  "dumptxoutset",      // write UTXO snapshot to disk
  "rescanblockchain",  // replay blocks for wallet
  "importwallet",      // import + rescan
  "importprivkey",     // triggers rescan
  "importaddress",     // triggers rescan
  "importpubkey",      // triggers rescan
  "importmulti",       // triggers rescan
  "importdescriptors", // triggers rescan
  "verifychain",       // verifies all block files
]);

// Cancellable variant of rpc(). Returns the same promise plus a cancel handle
// that destroys the underlying request, so the terminal can abort a call like
// gettxoutsetinfo rather than holding its input for the 11-minute timeout.
// rpc() below is left exactly as it was: it is on the audited hot path and
// covered by the harness, so this is additive rather than a refactor.
function rpcCancellable(method, params = [], timeoutMs) {
  let req = null;
  let cancelled = false;
  const promise = rpc(method, params, timeoutMs, (r) => {
    req = r;
    // cancel() may have been called before the request object existed
    if (cancelled) try { r.destroy(new Error("cancelled")); } catch (_) {}
  });
  return {
    promise,
    cancel() {
      cancelled = true;
      if (req) try { req.destroy(new Error("cancelled")); } catch (_) {}
    },
  };
}

function rpc(method, params = [], timeoutMs, onRequest) {
  const ms = timeoutMs ?? (SLOW_RPC_METHODS.has(method) ? 660000 : 12000);
  return new Promise((resolve, reject) => {
    const { user, pass } = getAuth();
    const body = JSON.stringify({ jsonrpc: "1.0", id: method, method, params });
    const req = http.request(
      {
        hostname: RPC_HOST,
        port: RPC_PORT,
        path: "/",
        method: "POST",
        timeout: ms,
        agent: _rpcAgent,
        headers: {
          Authorization:
            "Basic " + Buffer.from(user + ":" + pass).toString("base64"),
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let raw = "";
        res.on("data", (chunk) => (raw += chunk));
        res.on("end", () => {
          if (res.statusCode === 401)
            return reject(
              new Error(
                "401 Unauthorized – check your RPC credentials or cookie file",
              ),
            );
          if (!raw) return reject(new Error("Empty response: " + method));
          try {
            const j = JSON.parse(raw);
            if (j.error)
              return reject(new Error(method + ": " + j.error.message));
            resolve(j.result);
          } catch (e) {
            reject(new Error("Parse failed: " + raw.slice(0, 100)));
          }
        });
      },
    );
    req.on("error", (e) => reject(new Error(method + ": " + e.message)));
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(method + " timeout"));
    });
    // Hand the request to rpcCancellable so it can destroy it on demand.
    if (typeof onRequest === "function") onRequest(req);
    req.write(body);
    req.end();
  });
}

// The last transport-level failure, so the client can say *why* the node is
// unreachable rather than only that it is. Cleared on the next success.
let _lastRpcError = null;

const safe = (m, p) =>
  rpc(m, p)
    .then((r) => {
      _lastRpcError = null;
      return r;
    })
    .catch((e) => {
      console.error("[warn]", m, e.message);
      _lastRpcError = e.message;
      return null;
    });

// ═══════════════════════════════════════════════════════════════════════════════
// STATE MACHINE
// ═══════════════════════════════════════════════════════════════════════════════

// _state holds the last known full snapshot — same shape as the former /api/data
// response. Initialised once at startup, then patched in-place by each event.
let _state = null;

// Active SSE response objects. Pruned on each broadcast.
let _sseClients = [];

// A client that stops reading (laptop asleep, half-open TCP) would otherwise
// accumulate every broadcast in process memory until the kernel gives up on
// the socket. Drop it once its unsent backlog exceeds this many bytes.
const SSE_MAX_BUFFER =
  parseInt(process.env.BLOCKWATCH_SSE_MAX_BUFFER || "0") || 8 * 1024 * 1024;

function pruneSseClients() {
  _sseClients = _sseClients.filter((r) => {
    if (r.writableEnded || r.destroyed) return false;
    if (r.writableLength > SSE_MAX_BUFFER) {
      console.error(
        "[sse] dropping stalled client with " + r.writableLength + " bytes unsent",
      );
      try {
        r.destroy();
      } catch (_) {}
      return false;
    }
    return true;
  });
}

function broadcast() {
  if (!_state) return;
  _state.zmqMode = blockSource();
  const payload = "data: " + JSON.stringify(_state) + "\n\n";
  pruneSseClients();
  for (const r of _sseClients) r.write(payload);
}

// SSE heartbeat — keeps proxies and load balancers from closing idle connections.
setInterval(() => {
  pruneSseClients();
  for (const r of _sseClients) r.write(": ping\n\n");
}, 15000);

// Valid getchaintxstats windows. Core requires 0 < nblocks < tip height.
function txStatsWindow(blocks) {
  return blocks >= 2 ? Math.min(2016, blocks - 1) : 0;
}
// Window covering only the current difficulty period (blocks since the last
// retarget), so the client can estimate the next adjustment the way Core
// computes it, rather than from a trailing window that spans the previous period.
function retargetWindow(blocks) {
  return blocks >= 2 ? Math.min(blocks % 2016, blocks - 1) : 0;
}
const chainTxStats = (blocks) => {
  const w = txStatsWindow(blocks);
  return w ? safe("getchaintxstats", [w]) : Promise.resolve(null);
};
const retargetStats = (blocks) => {
  const w = retargetWindow(blocks);
  return w ? safe("getchaintxstats", [w]) : Promise.resolve(null);
};

// Fields requested from getblockstats — extracted so initState and onNewBlock
// always request exactly the same set.
const BLOCK_STATS_FIELDS = [
  "txs",
  "total_size",
  "total_weight",
  "time",
  "height",
  "avgfee",
  "avgfeerate",
  "ins",
  "outs",
  "subsidy",
  "totalfee",
  "feerate_percentiles",
];

function normalizeBlock(hash, hdr, st, pruned = false) {
  hdr = hdr || {};
  st = st || {};
  return {
    height: hdr.height ?? 0,
    hash,
    previousblockhash: hdr.previousblockhash ?? "",
    // getblockheader carries nTx for free, so IBD (no getblockstats) and
    // pruned blocks still show a transaction count.
    txs: st.txs ?? hdr.nTx ?? 0,
    pruned,
    size: st.total_size ?? 0,
    weight: st.total_weight ?? 0,
    time: hdr.time ?? st.time ?? 0,
    version: hdr.version ?? 0,
    bits: hdr.bits ?? "",
    nonce: hdr.nonce ?? 0,
    difficulty: hdr.difficulty ?? 0,
    avgfee: st.avgfee ?? 0,
    avgfeerate: st.avgfeerate ?? 0,
    ins: st.ins ?? 0,
    outs: st.outs ?? 0,
    subsidy: st.subsidy ?? 0,
    totalfee: st.totalfee ?? 0,
    mediantime: hdr.mediantime ?? 0,
    chainwork: hdr.chainwork ?? "",
    feePercentiles: st.feerate_percentiles ?? null,
  };
}

// conf_target values are included so the client label always matches what was
// requested. If you change the targets here, the client labels update automatically.
function normalizeFees(fast) {
  return {
    fast: fast?.feerate ? Math.round(fast.feerate * 1e5) : null,
    fast_target: 1,
  };
}

// ── Initial full-state snapshot ───────────────────────────────────────────────
// Runs once at startup (and on retry if bitcoind was unreachable). Populates
// _state so the first SSE client always receives a complete payload immediately.
async function initState() {
  const [blockchain, networkInfo, mempoolInfo] = await Promise.all([
    safe("getblockchaininfo"),
    safe("getnetworkinfo"),
    safe("getmempoolinfo"),
  ]);

  if (!blockchain || typeof blockchain !== "object" || blockchain.blocks == null) {
    _state = {
      error: "getblockchaininfo unavailable",
      // The underlying cause: "connection refused", "401", "in warmup" and a
      // timeout are four very different situations for the operator, and the
      // generic string above cannot tell them apart.
      errorDetail: _lastRpcError || null,
      blockchain: blockchain || {},
      networkInfo: networkInfo || {},
      mempoolInfo: mempoolInfo || {},
      peers: [],
      blocks: [],
      chainTxStats: {},
      fees: {},
      netTotals: {},
      uptime: 0,
      deploymentInfo: {},
      chainTips: [],
      ts: Date.now(),
      rpcNode: RPC_HOST + ":" + RPC_PORT,
    };
    return;
  }

  const ibd = blockchain.initialblockdownload || false;
  const ni = networkInfo || {};

  // Publish the headline data now rather than at the end. getblockchaininfo
  // answers in milliseconds and already carries height, chain and sync
  // progress, but the remaining stages are sequential round trips that take a
  // second or two on a healthy node and far longer on one under IBD load.
  // Holding everything back until the last stage meant the dashboard sat empty
  // for all of it. Each stage below broadcasts as it lands, so the UI fills in
  // progressively instead of appearing all at once.
  _state = {
    blockchain,
    networkInfo: ni,
    mempoolInfo: mempoolInfo || {},
    peers: [],
    blocks: [],
    chainTxStats: {},
    retargetStats: null,
    fees: {},
    netTotals: {},
    uptime: 0,
    deploymentInfo: {},
    chainTips: [],
    minrelaytxfee: ni.relayfee ?? ni.minrelaytxfee ?? null,
    incrementalfee: ni.incrementalfee ?? null,
    networkWarnings: Array.isArray(ni.warnings)
      ? ni.warnings.join(" ")
      : ni.warnings || "",
    ts: Date.now(),
    rpcNode: RPC_HOST + ":" + RPC_PORT,
    zmqMode: blockSource(),
  };
  broadcast();

  // Blocks are what the eye goes to first, so fetch them next rather than
  // last, and run the peer/network batch alongside instead of after it.
  const tipHeight = blockchain.blocks;
  const count = Math.min(ibd ? 8 : 24, tipHeight + 1);
  const heights = Array.from({ length: count }, (_, i) => tipHeight - i).filter(
    (h) => h >= 0,
  );

  const blocksPromise = (async () => {
    if (!heights.length) return [];
    const hashes = await Promise.all(heights.map((h) => safe("getblockhash", [h])));
    const [headers, stats] = await Promise.all([
      Promise.all(hashes.map((h) => (h ? safe("getblockheader", [h, true]) : null))),
      ibd
        ? Promise.resolve(heights.map(() => null))
        : Promise.all(
            hashes.map((h) =>
              h ? safe("getblockstats", [h, BLOCK_STATS_FIELDS]) : null,
            ),
          ),
    ]);
    return hashes
      .map((hash, i) => (hash ? normalizeBlock(hash, headers[i], stats[i]) : null))
      .filter(Boolean);
  })();

  const restPromise = Promise.all([
    safe("getpeerinfo"),
    safe("getnettotals"),
    safe("uptime"),
    safe("getdeploymentinfo"),
    chainTxStats(blockchain.blocks),
    retargetStats(blockchain.blocks),
    safe("getchaintips"),
    ibd ? Promise.resolve(null) : safe("estimatesmartfee", [1]),
  ]);

  const blocks = await blocksPromise;
  if (blocks.length) {
    _state.blocks = blocks;
    _state.ts = Date.now();
    broadcast();
  }

  const [peerInfo, netTotals, uptime, deploymentInfo, cts, rts, chainTips, feeFast] =
    await restPromise;

  // Merge rather than replace: a ZMQ block event or the tip watcher may have
  // already updated _state.blocks while these calls were in flight.
  if (Array.isArray(peerInfo)) _state.peers = peerInfo;
  if (netTotals) _state.netTotals = netTotals;
  if (uptime != null) _state.uptime = uptime;
  if (deploymentInfo) _state.deploymentInfo = deploymentInfo;
  if (cts) _state.chainTxStats = cts;
  _state.retargetStats = rts || null;
  if (Array.isArray(chainTips)) _state.chainTips = chainTips;
  _state.fees = normalizeFees(feeFast);
  _state.ts = Date.now();
  broadcast();
}

// ── Per-block refresh ─────────────────────────────────────────────────────────
// Triggered by ZMQ hashblock or the poll fallback. Fetches only the new block
// and a handful of summary calls — not the full 30-call batch.
let _blockRefreshInFlight = false;
let _blockRefreshPending = false;

// Serialises tip refreshes. A trigger that arrives mid-refresh (ZMQ and the
// tip watcher can both fire) is not dropped — it re-runs once the current
// refresh finishes, so the state never lags behind a known-newer tip.
async function onNewBlock() {
  if (_blockRefreshInFlight) {
    _blockRefreshPending = true;
    return;
  }
  _blockRefreshInFlight = true;
  try {
    do {
      _blockRefreshPending = false;
      await refreshTip();
    } while (_blockRefreshPending);
  } finally {
    _blockRefreshInFlight = false;
  }
}

// Fetch hash + header for `count` heights walking down from `from`.
async function fetchHeaders(from, count) {
  const heights = Array.from({ length: count }, (_, i) => from - i).filter(
    (h) => h >= 0,
  );
  const hashes = await Promise.all(heights.map((h) => safe("getblockhash", [h])));
  const headers = await Promise.all(
    hashes.map((h) => (h ? safe("getblockheader", [h, true]) : null)),
  );
  return heights.map((height, i) => ({ height, hash: hashes[i], hdr: headers[i] }));
}

async function refreshTip() {
  if (!_state) return;

  const bc = await safe("getblockchaininfo");
  if (!bc) return;

  if (_state.blockchain?.chain && bc.chain !== _state.blockchain.chain) {
    await initState();
    if (_state && !_state.error) broadcast();
    return;
  }

  // IBD just finished: the held blocks were fetched without getblockstats and
  // the window was trimmed to 8. Rebuild the full snapshot so sizes, fees and
  // the 24-block window come back immediately instead of refilling one block
  // at a time over the next four hours.
  if (_state.blockchain?.initialblockdownload && !bc.initialblockdownload) {
    await initState();
    if (_state && !_state.error) broadcast();
    return;
  }

  // Dedup on the tip *hash*, not the height: a same-height reorg replaces the
  // tip block without changing bc.blocks.
  const known = _state.blocks[0];
  const knownHeight = known?.height ?? -1;
  if (known && bc.bestblockhash && bc.bestblockhash === known.hash) {
    _state.blockchain = bc;
    return;
  }

  const ibd = bc.initialblockdownload || false;
  const maxBlocks = ibd ? 8 : 24;

  // Gap fill: fetch every height we have not seen. A reorg to the same or a
  // lower height still needs at least the new tip.
  const gap = bc.blocks - knownHeight;
  let fetched = await fetchHeaders(bc.blocks, Math.max(1, Math.min(gap, maxBlocks)));

  // Reorg check: the lowest fetched header must link (previousblockhash) to
  // the block we already hold directly beneath it. If it does not, the held
  // block was orphaned — keep walking down until the chains join or we have
  // replaced the whole window.
  for (;;) {
    const low = fetched[fetched.length - 1];
    if (!low || !low.hdr || low.height === 0 || fetched.length >= maxBlocks) break;
    const held = _state.blocks.find((b) => b.height === low.height - 1);
    if (!held || held.hash === low.hdr.previousblockhash) break;
    const more = await fetchHeaders(
      low.height - 1,
      Math.min(4, maxBlocks - fetched.length),
    );
    if (!more.length) break;
    fetched = fetched.concat(more);
  }

  const pruneHeight = bc.pruned ? bc.pruneheight ?? 0 : 0;
  const [stats, mi, cts, rts] = await Promise.all([
    ibd
      ? Promise.resolve(fetched.map(() => null))
      : Promise.all(
          fetched.map((f) =>
            f.hash && f.height >= pruneHeight
              ? safe("getblockstats", [f.hash, BLOCK_STATS_FIELDS])
              : null,
          ),
        ),
    safe("getmempoolinfo"),
    chainTxStats(bc.blocks),
    retargetStats(bc.blocks),
  ]);

  const newBlocks = fetched
    .map((f, i) =>
      f.hash && f.hdr
        ? normalizeBlock(f.hash, f.hdr, stats[i], !ibd && !stats[i] && f.height < pruneHeight)
        : null,
    )
    .filter(Boolean);

  _state.blockchain = bc;
  if (mi) _state.mempoolInfo = mi;
  if (cts) _state.chainTxStats = cts;
  _state.retargetStats = rts || null;
  delete _state.error;
  _state.ts = Date.now();

  // If the tip header failed, still publish blockchain + mempool.
  if (!newBlocks.length) {
    broadcast();
    return;
  }

  const lowestNew = newBlocks[newBlocks.length - 1].height;
  const replaced = _state.blocks.filter(
    (b) =>
      b.height >= lowestNew &&
      !newBlocks.some((n) => n.height === b.height && n.hash === b.hash),
  );
  if (replaced.length) {
    console.error(
      "[reorg] " +
        replaced.length +
        " block(s) replaced from height " +
        replaced[replaced.length - 1].height +
        " (old tip " +
        (known ? known.hash.slice(0, 12) : "?") +
        " → new tip " +
        bc.bestblockhash.slice(0, 12) +
        ")",
    );
  }
  _state.blocks = [
    ...newBlocks,
    ..._state.blocks.filter((b) => b.height < lowestNew),
  ].slice(0, maxBlocks);

  broadcast();
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZMQ INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

let _pollFallbackActive = false; // zeromq module missing or socket failed
let _zmqConnected = false; // transport-level connect event seen
let _zmqSeen = false; // at least one hashblock message received
let _zmqSocket = null;

// What is actually delivering block events right now. ZMQ connect() never
// fails (it retries in the background forever), so "zmq" is only claimed once
// the socket has connected or a message has arrived; until then the tip
// watcher below is doing the work and we say so.
function blockSource() {
  return !_pollFallbackActive && (_zmqConnected || _zmqSeen) ? "zmq" : "poll";
}

async function initZmq() {
  let Subscriber;
  try {
    ({ Subscriber } = require("zeromq"));
  } catch (_) {
    row("zmq", "module not found — using 10s polling", A.pos);
    startPollFallback();
    return;
  }

  try {
    const sock = new Subscriber();
    _zmqSocket = sock;
    // Transport events let us report an honest block source and notice when
    // bitcoind goes away (the tip watcher keeps blocks flowing meanwhile).
    try {
      sock.events.on("connect", () => {
        _zmqConnected = true;
      });
      sock.events.on("disconnect", () => {
        _zmqConnected = false;
        _zmqSeen = false;
      });
    } catch (_) {}
    sock.connect(`tcp://${ZMQ_HOST}:${ZMQ_PORT}`);
    sock.subscribe("hashblock");
    row("zmq", `tcp://${ZMQ_HOST}:${ZMQ_PORT}` + c(A.t4, "  (10s poll safety net always on)"), A.grn);

    for await (const [topicBuf] of sock) {
      if (topicBuf.toString() !== "hashblock") continue;
      _zmqSeen = true;
      try {
        await onNewBlock();
      } catch (e) {
        row("zmq", "onNewBlock error: " + e.message, A.neg);
      }
    }
  } catch (e) {
    _zmqSocket = null;
    row("zmq", "error: " + e.message + " — using 10s polling", A.pos);
    startPollFallback();
  }
}

// ── Tip watcher — always runs, regardless of ZMQ state ────────────────────────
// One cheap getblockchaininfo every 10s. It (a) detects a node/chain switch,
// (b) refreshes headers/verificationprogress/warnings between blocks, and
// (c) is the safety net for new blocks when ZMQ is misconfigured, disconnected
// or simply not enabled in bitcoin.conf — ZMQ only makes delivery faster.
let _tipWatchInFlight = false;
function startTipWatcher() {
  setInterval(async () => {
    if (!_state || _state.error || _tipWatchInFlight) return;
    _tipWatchInFlight = true;
    try {
      const bc = await safe("getblockchaininfo");
      if (!bc || !_state.blockchain?.chain) return;
      if (bc.chain !== _state.blockchain.chain) {
        // Chain switched — full re-init so blocks, peers, fees all reset cleanly.
        await initState();
        if (_state && !_state.error) broadcast();
        return;
      }
      // New tip, or IBD just finished (which needs the full snapshot rebuilt).
      // Hand both to refreshTip rather than overwriting _state.blockchain here,
      // which would swallow the transition.
      if (
        (bc.bestblockhash && bc.bestblockhash !== _state.blocks[0]?.hash) ||
        (_state.blockchain?.initialblockdownload && !bc.initialblockdownload)
      ) {
        await onNewBlock();
        return;
      }
      // No new block — keep chain state fresh; the 5s fast refresh broadcasts it.
      _state.blockchain = bc;
    } finally {
      _tipWatchInFlight = false;
    }
  }, 10000);
}

// ── Poll fallback — ZMQ unavailable; the tip watcher is the only block source ─
function startPollFallback() {
  if (_pollFallbackActive) return;
  _pollFallbackActive = true;
  if (_state) broadcast();
}

// ── Fast refresh — bandwidth + mempool every 5s ───────────────────────────────
// getnettotals and getmempoolinfo are memory-only calls; trivially cheap.
// Running every 5s gives the bandwidth chart its full 10-minute window at 5s
// resolution (120 samples × 5s) and keeps mempool stats fresher than any block event.
let _fastRefreshInFlight = false;
let _initRetryAt = 0;

function startFastRefresh() {
  setInterval(async () => {
    // If initState never produced valid data (bitcoind was down at startup),
    // retry the full snapshot. Throttled to at most once per 30s.
    if (!_state || _state.error || !_state.blockchain?.blocks) {
      const now = Date.now();
      if (now - _initRetryAt >= 30000) {
        _initRetryAt = now;
        await initState();
        if (_state && !_state.error) broadcast();
      }
      return;
    }

    if (_fastRefreshInFlight) return;
    _fastRefreshInFlight = true;
    try {
      const [netTotals, mempoolInfo] = await Promise.all([
        safe("getnettotals"),
        safe("getmempoolinfo"),
      ]);
      if (!netTotals && !mempoolInfo) return;
      if (netTotals) _state.netTotals = netTotals;
      if (mempoolInfo) _state.mempoolInfo = mempoolInfo;
      _state.ts = Date.now();
      broadcast();
    } finally {
      _fastRefreshInFlight = false;
    }
  }, 5000);
}

// ── Sparse refresh — peers, fees, network info every 60s ─────────────────────
let _sparseRefreshInFlight = false;

function startSparseRefresh() {
  setInterval(async () => {
    if (!_state || _state.error) return;
    if (_sparseRefreshInFlight) return;
    _sparseRefreshInFlight = true;
    try {
      const ibd = _state.blockchain?.initialblockdownload || false;
      const base = [
        safe("getpeerinfo"),
        safe("getnetworkinfo"),
        safe("getchaintips"),
        safe("uptime"),
      ];
      const results = await Promise.all(base);
      const [peers, ni, tips, uptime] = results;

      if (peers) _state.peers = peers;
      if (ni) {
        _state.networkInfo = ni;
        _state.minrelaytxfee = ni.relayfee ?? ni.minrelaytxfee ?? _state.minrelaytxfee;
        _state.incrementalfee = ni.incrementalfee ?? _state.incrementalfee;
        _state.networkWarnings = Array.isArray(ni.warnings)
          ? ni.warnings.join(" ")
          : ni.warnings || "";
      }
      if (tips) _state.chainTips = tips;
      if (uptime != null) _state.uptime = uptime;
      if (!ibd) {
        const feeFast = await safe("estimatesmartfee", [1]);
        _state.fees = normalizeFees(feeFast);
      }
      if (!peers && !ni && !tips && uptime == null) return;
      _state.ts = Date.now();
      broadcast();
    } finally {
      _sparseRefreshInFlight = false;
    }
  }, 60000);
}

// ── Deployment refresh — softfork state every 5 minutes ──────────────────────
// getdeploymentinfo only changes at activation events; near-static in practice.
function startDeploymentRefresh() {
  setInterval(async () => {
    if (!_state || _state.error) return;
    const d = await safe("getdeploymentinfo");
    if (d) {
      _state.deploymentInfo = d;
      broadcast();
    }
  }, 300000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// HTTP SERVER
// ═══════════════════════════════════════════════════════════════════════════════

// Host header must name this machine in local mode. Without this, DNS
// rebinding (attacker.com → 127.0.0.1) lets any website read the SSE stream
// and /api/data as same-origin GETs, which carry no Origin header.
function isLocalHostHeader(host) {
  if (!host) return false;
  const h = host.toLowerCase().replace(/:\d+$/, "");
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]";
}

// Origin, when a browser sends one, must match the Host the request arrived
// on. Applies in both modes: in remote mode browsers attach cached Basic
// credentials to cross-site requests, so auth alone is not a CSRF defence.
function originMatchesHost(req) {
  const origin = req.headers.origin;
  if (origin == null) return true; // same-origin GET / non-browser client
  if (origin === "null") return false;
  try {
    return new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase();
  } catch (_) {
    return false;
  }
}

// Parameter shapes accepted by /api/rpc. The allowlisted methods are
// privileged (they change the node's peer set or cost minutes of I/O), so the
// arguments are pinned to exactly what the dashboard needs.
function isBanTarget(s) {
  if (typeof s !== "string" || s.length > 64) return false;
  const [ip, prefix, extra] = s.split("/");
  if (extra !== undefined) return false;
  const fam = net.isIP(ip);
  if (!fam) return false;
  if (prefix === undefined) return true;
  if (!/^\d{1,3}$/.test(prefix)) return false;
  const n = +prefix;
  // No wildcard-sized bans through the dashboard proxy.
  return fam === 4 ? n >= 16 && n <= 32 : n >= 32 && n <= 128;
}
const RPC_PARAM_RULES = {
  listbanned: (p) => p.length === 0,
  gettxoutsetinfo: (p) => p.length === 0,
  disconnectnode: (p) =>
    (p.length === 1 && typeof p[0] === "string" && p[0].length > 0 && p[0].length <= 300) ||
    (p.length === 2 && p[0] === "" && Number.isInteger(p[1]) && p[1] >= 0),
  setban: (p) => {
    if (p.length < 2 || p.length > 4 || !isBanTarget(p[0])) return false;
    if (p[1] === "remove") return p.length === 2;
    if (p[1] !== "add") return false;
    if (p.length >= 3 && !(Number.isInteger(p[2]) && p[2] >= 0)) return false;
    if (p.length === 4 && typeof p[3] !== "boolean") return false;
    return true;
  },
};
let _utxoScanInFlight = false;

// Nothing in the request handler may reject: an unhandled rejection is
// treated as fatal by the process-level handler below, so a single malformed
// request-target (new URL() throws on e.g. "GET http://[::1 HTTP/1.1") would
// take the whole server down — before authentication.
const server = http.createServer((req, res) => {
  handleRequest(req, res).catch((e) => {
    const bad = e && e.code === "ERR_INVALID_URL";
    if (!bad) console.error("[http]", e && e.stack ? e.stack : e);
    try {
      if (!res.headersSent)
        res.writeHead(bad ? 400 : 500, { "Content-Type": "text/plain" });
      res.end(bad ? "bad request" : "internal error");
    } catch (_) {
      try {
        req.socket.destroy();
      } catch (_) {}
    }
  });
});

async function handleRequest(req, res) {
  const url = new URL(req.url, "http://localhost");

  // Remote mode: basic auth gates all requests. Check before anything else.
  if (!checkRemoteAuth(req, res)) return;

  if (!REMOTE_MODE && !isLocalHostHeader(req.headers.host)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden: unexpected Host header");
    return;
  }
  if (!originMatchesHost(req)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end("forbidden: cross-origin request");
    return;
  }
  // Security headers on every response. No CORS headers: the dashboard is
  // strictly same-origin, so nothing legitimate needs a cross-origin read.
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; " +
      "script-src 'self'; " +
      "style-src 'self' 'unsafe-inline'; " +
      "font-src 'self'; " +
      "img-src 'self' data:; " +
      "connect-src 'self'; " +
      "frame-ancestors 'none'; " +
      "base-uri 'self'; " +
      "form-action 'self'",
  );
  res.setHeader(
    "Permissions-Policy",
    "camera=(),microphone=(),geolocation=(),payment=()",
  );
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  // ── Health endpoint — live RPC check, intentionally bypasses _state ────────
  if (url.pathname === "/health" || url.pathname === "/api/health") {
    let hstatus = 200,
      hbody;
    try {
      const bc = await rpc("getblockchaininfo");
      hbody = {
        ok: true,
        height: bc.blocks ?? null,
        chain: bc.chain ?? null,
        synced: !bc.initialblockdownload,
        ibd: bc.initialblockdownload || false,
        progress:
          bc.verificationprogress != null
            ? +(bc.verificationprogress * 100).toFixed(3)
            : null,
        headers: bc.headers ?? null,
        blockSource: blockSource(),
        ts: Date.now(),
      };
    } catch (e) {
      hstatus = 503;
      hbody = { ok: false, error: e.message, ts: Date.now() };
    }
    res.writeHead(hstatus, { "Content-Type": "application/json" });
    res.end(JSON.stringify(hbody));
    return;
  }

  // ── SSE stream — primary client transport ─────────────────────────────────
  if (url.pathname === "/api/stream") {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      // Instruct nginx/caddy not to buffer the stream
      "X-Accel-Buffering": "no",
    });
    // Detect dead peers (sleeping laptops, dropped links) instead of holding
    // the socket — and its growing write backlog — until the kernel gives up.
    try {
      req.socket.setKeepAlive(true, 30000);
      req.socket.setNoDelay(true);
    } catch (_) {}
    // Flush headers immediately so the browser considers the connection open
    res.write("\n");

    // Send the full current state as the first event so the client renders
    // immediately without waiting for the next ZMQ or timer event.
    if (_state) res.write("data: " + JSON.stringify(_state) + "\n\n");

    _sseClients.push(res);
    req.on("close", () => {
      _sseClients = _sseClients.filter((r) => r !== res);
    });
    return;
  }

  // ── /api/data — snapshot of current state (used by snapshot button) ────────
  if (url.pathname === "/api/data") {
    res.writeHead(_state ? 200 : 503, { "Content-Type": "application/json" });
    res.end(JSON.stringify(_state || { error: "initializing" }));
    return;
  }

  // ── /api/block/:height — fetch a single block by height ───────────────────
  const blockMatch = url.pathname.match(/^\/api\/block\/(\d+)$/);
  if (blockMatch && req.method === "GET") {
    const height = parseInt(blockMatch[1], 10);
    if (!Number.isInteger(height) || height < 0) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "invalid height" }));
      return;
    }
    try {
      const hash = await rpc("getblockhash", [height]);
      const bc = _state?.blockchain || {};
      const pruned = !!bc.pruned && height < (bc.pruneheight ?? 0);
      const [hdr, st] = await Promise.all([
        safe("getblockheader", [hash, true]),
        pruned ? null : safe("getblockstats", [hash, BLOCK_STATS_FIELDS]),
      ]);
      if (!hdr) throw new Error("block not found");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(normalizeBlock(hash, hdr, st, pruned || (!st && !!bc.pruned))));
    } catch (e) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── /api/rpc — privileged proxy for peer management ──────────────────────
  if (url.pathname === "/api/rpc" && req.method === "POST") {
    // In remote mode, basic auth (already checked above) is the gate.
    // In local mode, restrict to loopback connections only.
    if (!REMOTE_MODE) {
      const remote = req.socket.remoteAddress;
      const isLoopback = (() => {
        if (!remote) return false;
        if (remote === "::1") return true;
        const ipv4 = remote.startsWith("::ffff:") ? remote.slice(7) : remote;
        const parts = ipv4.split(".");
        if (parts.length !== 4) return false;
        const nums = parts.map(Number);
        return (
          nums.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
          nums[0] === 127
        );
      })();
      if (!isLoopback) {
        res.writeHead(403, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "forbidden" }));
        return;
      }
    }
    // A JSON content type cannot be produced by an HTML form, which closes the
    // text/plain CSRF route; the dashboard's fetch() always sends it.
    const ctype = String(req.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
    if (ctype !== "application/json") {
      res.writeHead(415, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "content-type must be application/json" }));
      return;
    }
    let body = "",
      done = false;
    req.on("data", (chunk) => {
      if (done) return;
      body += chunk;
      if (body.length > 65536) {
        done = true;
        res.writeHead(413, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "request too large" }));
      }
    });
    req.on("end", async () => {
      if (done) return;
      done = true;
      let result,
        status = 200,
        rpcMethod = null,
        utxoScan = false;
      try {
        const parsed = JSON.parse(body);
        const method = parsed && parsed.method;
        const params = parsed && parsed.params != null ? parsed.params : [];
        const rule = Object.prototype.hasOwnProperty.call(RPC_PARAM_RULES, method)
          ? RPC_PARAM_RULES[method]
          : null;
        if (!rule) {
          status = 403;
          throw new Error("method not allowed: " + method);
        }
        if (!Array.isArray(params) || !rule(params)) {
          status = 400;
          throw new Error("invalid params for " + method);
        }
        if (method === "gettxoutsetinfo") {
          // Minutes of CPU/disk on the node — never run two at once.
          if (_utxoScanInFlight) {
            status = 409;
            throw new Error("gettxoutsetinfo already running");
          }
          _utxoScanInFlight = utxoScan = true;
        }
        result = { result: await rpc(method, params) };
        rpcMethod = method;
      } catch (e) {
        result = { error: e.message };
        if (status === 200) status = 500;
      } finally {
        if (utxoScan) _utxoScanInFlight = false;
      }

      // Send response immediately
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(result));

      // Refresh peers in background after disconnect/ban (don't block response)
      if (status === 200 && (rpcMethod === "disconnectnode" || rpcMethod === "setban") && _state) {
        await new Promise(resolve => setTimeout(resolve, 100));
        const peers = await safe("getpeerinfo");
        if (peers) {
          _state.peers = peers;
          _state.ts = Date.now();
          broadcast();
        }
      }
    });
    return;
  }

  // ── Static files ───────────────────────────────────────────────────────────
  const _staticKey = url.pathname === "/" ? "/index.html" : url.pathname;
  if (_static[_staticKey]) {
    const _entry = _static[_staticKey];
    if (_entry.noStore) {
      res.writeHead(200, {
        "Content-Type": _entry.mime,
        "Cache-Control": "no-store",
      });
      res.end(_entry.buf);
    } else {
      if (req.headers["if-none-match"] === _entry.etag) {
        res.writeHead(304);
        res.end();
      } else {
        res.writeHead(200, {
          "Content-Type": _entry.mime,
          "Cache-Control": "public, max-age=3600",
          ETag: _entry.etag,
        });
        res.end(_entry.buf);
      }
    }
    return;
  }
  if (_staticKey === "/index.html" || _staticKey === "/blockwatch.css") {
    res.writeHead(500);
    res.end(_staticKey.slice(1) + " not found");
    return;
  }

  // ── /assets/* — user-placed files (e.g. block.mp3 for sounds) ─────────────
  if (url.pathname.startsWith("/assets/")) {
    const filename = path.basename(url.pathname); // basename strips traversal
    const assetPath = path.join(__dirname, "assets", filename);
    try {
      const buf = fs.readFileSync(assetPath);
      const ext = path.extname(filename).toLowerCase();
      const mime = ext === ".mp3" ? "audio/mpeg" : ext === ".wav" ? "audio/wav" : ext === ".ogg" ? "audio/ogg" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": mime, "Cache-Control": "public, max-age=3600" });
      res.end(buf);
    } catch (_) {
      res.writeHead(404);
      res.end("not found");
    }
    return;
  }

  res.writeHead(404);
  res.end("not found");
}

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

async function start() {
  printBanner();
  if (!REMOTE_MODE && !["127.0.0.1", "localhost", "::1"].includes(SERVER_HOST)) {
    throw new Error(
      "HOST=" +
        SERVER_HOST +
        " would expose the dashboard on a non-loopback interface with no authentication. " +
        "Set BLOCKWATCH_REMOTE=1 (enables basic auth) or use HOST=127.0.0.1.",
    );
  }
  await loadAuth();

  // Build the first snapshot in the background rather than blocking startup on
  // it. A node under load answers slowly — on a mainnet node mid-IBD a single
  // getblockchaininfo can take seconds and getchaintips longer — and waiting
  // here delayed the HTTP listener, which in turn delayed the Electron window,
  // so the app appeared to hang with nothing on screen. The client already
  // renders a connecting overlay while _state is empty, /api/data answers 503
  // until then, and the SSE stream simply sends nothing until the first
  // broadcast. Stamping _initRetryAt keeps startFastRefresh from firing a
  // duplicate initState while this one is still in flight.
  _initRetryAt = Date.now();
  initState()
    .then(() => {
      if (_state && !_state.error) broadcast();
    })
    .catch((e) => {
      console.error("[warn] initial snapshot failed: " + e.message);
    });

  // ZMQ: non-blocking — fires onNewBlock on each hashblock event.
  // Falls back to 10s polling automatically if zeromq is missing or bitcoind
  // has no zmqpubhashblock configured.
  initZmq().catch((e) => {
    row("zmq", "fatal: " + e.message, A.neg);
    if (!_pollFallbackActive) startPollFallback();
  });

  startFastRefresh();
  startSparseRefresh();
  startDeploymentRefresh();
  startTipWatcher();

  return new Promise((resolve, reject) => {
    server.once("error", (e) =>
      reject(
        new Error(
          "cannot listen on " + SERVER_HOST + ":" + SERVER_PORT + ": " + e.message,
        ),
      ),
    );
    server.listen(SERVER_PORT, SERVER_HOST, () => {
      row("node", RPC_HOST + ":" + RPC_PORT);
      const bar = c(A.t4, "-".repeat(Math.min(W - 4, 38)));
      process.stdout.write("  " + bar + "\n");
      if (REMOTE_MODE) {
        row("mode", "remote  " + c(A.t4, "(basic auth enabled)"), A.pos);
        row("access", "http://<your-ip>:" + SERVER_PORT, A.pos);
        row(
          "warning",
          "ensure firewall restricts access as needed",
          A.neg,
        );
      } else {
        row("dashboard", "http://127.0.0.1:" + SERVER_PORT, A.pos);
      }
      row(
        "health",
        "http://" + SERVER_HOST + ":" + SERVER_PORT + "/api/health",
        A.t3,
      );
      process.stdout.write("\n");
      resolve(SERVER_PORT);
    });
  });
}

if (require.main === module) {
  start().catch((e) => {
    console.error("[blockwatch] " + (e && e.message ? e.message : e));
    process.exit(1);
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════════

// SIGTERM: sent by systemd, Docker, Umbrel on stop/restart/update
// SIGINT:  sent by Ctrl+C in a terminal
// Crash paths exit non-zero so systemd's Restart=on-failure actually restarts.
let _shuttingDown = false;
function shutdown(code = 0) {
  if (_shuttingDown) return;
  _shuttingDown = true;
  // Drain in-flight SSE writes before exiting. Give up to 5s.
  const force = setTimeout(() => {
    console.error("[blockwatch] shutdown timeout — forcing exit");
    process.exit(code || 1);
  }, 5000);
  if (_zmqSocket) { try { _zmqSocket.close(); } catch (_) {} _zmqSocket = null; }
  _sseClients.forEach((r) => { try { r.destroy(); } catch (_) {} });
  _sseClients = [];
  server.close(() => {
    _rpcAgent.destroy();
    clearTimeout(force);
    process.exit(code);
  });
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("unhandledRejection", (reason) => {
  console.error("[unhandled rejection]", reason);
  shutdown(1);
});
process.on("uncaughtException", (err) => {
  console.error("[uncaught exception]", err);
  shutdown(1);
});

// stop() — same as shutdown() but resolves a Promise instead of calling
// process.exit(). Used by the Electron main process so it can call app.exit()
// after cleanup rather than letting the server force-kill the process.
function stop() {
  if (_shuttingDown) return Promise.resolve();
  _shuttingDown = true;
  if (_zmqSocket) { try { _zmqSocket.close(); } catch (_) {} _zmqSocket = null; }
  _sseClients.forEach((r) => { try { r.destroy(); } catch (_) {} });
  _sseClients = [];
  return new Promise((resolve) => {
    const t = setTimeout(resolve, 5000);
    server.close(() => { _rpcAgent.destroy(); clearTimeout(t); resolve(); });
  });
}

module.exports = { start, stop, rpc, rpcCancellable };
