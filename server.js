const http = require("http"),
  fs = require("fs"),
  path = require("path"),
  os = require("os"),
  readline = require("readline"),
  crypto = require("crypto");
const RPC_HOST = process.env.BITCOIN_RPC_HOST || "127.0.0.1";
let RPC_PORT = parseInt(process.env.BITCOIN_RPC_PORT || "0");
const SERVER_PORT = parseInt(process.env.PORT || "3000");
const SERVER_HOST = process.env.HOST || "127.0.0.1";

// HTTP server is enabled when running inside Electron (always) or when the
// BLOCKWATCH_HTTP=1 env var is explicitly set (browser/self-hosted mode).
const HTTP_ENABLED = !!process.versions.electron || process.env.BLOCKWATCH_HTTP === "1";
const ZMQ_HOST = process.env.ZMQ_HOST || "127.0.0.1";
const ZMQ_PORT = parseInt(process.env.ZMQ_PORT || "28332");

let RPC_USER = "",
  RPC_PASS = "";

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
function getAuth() {
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

async function loadAuth() {
  if (process.env.BITCOIN_RPC_USER && process.env.BITCOIN_RPC_PASS) {
    RPC_USER = process.env.BITCOIN_RPC_USER;
    RPC_PASS = process.env.BITCOIN_RPC_PASS;
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
  process.stdout.write(
    "  " +
      c(A.pos, "! ") +
      c(A.t2, "no cookie found — enter RPC credentials") +
      "\n\n",
  );
  RPC_USER = await prompt("  " + c(A.t3, "rpc user".padEnd(14)) + "  ");
  RPC_PASS = await prompt("  " + c(A.t3, "rpc pass".padEnd(14)) + "  ", true);
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
    "panels/fees.js",
    "panels/peers.js",
    "panels/mining.js",
    "panels/mempool.js",
    "terminal.js",
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

function rpc(method, params = [], timeoutMs) {
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
    req.write(body);
    req.end();
  });
}

const safe = (m, p) =>
  rpc(m, p).catch((e) => {
    console.error("[warn]", m, e.message);
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

function broadcast() {
  if (!_state) return;
  const payload = "data: " + JSON.stringify(_state) + "\n\n";
  _sseClients = _sseClients.filter((r) => !r.writableEnded);
  for (const r of _sseClients) r.write(payload);
}

// SSE heartbeat — keeps proxies and load balancers from closing idle connections.
setInterval(() => {
  _sseClients = _sseClients.filter((r) => !r.writableEnded);
  for (const r of _sseClients) r.write(": ping\n\n");
}, 15000);

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

function normalizeBlock(hash, hdr, st) {
  hdr = hdr || {};
  st = st || {};
  return {
    height: hdr.height ?? 0,
    hash,
    txs: st.txs ?? 0,
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
function normalizeFees(fast, med, slow, eco) {
  return {
    fast: fast?.feerate ? Math.round(fast.feerate * 1e5) : null,
    fast_target: 1,
    med: med?.feerate ? Math.round(med.feerate * 1e5) : null,
    med_target: 6,
    slow: slow?.feerate ? Math.round(slow.feerate * 1e5) : null,
    slow_target: 144,
    eco: eco?.feerate ? Math.round(eco.feerate * 1e5) : null,
    eco_target: 1008,
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

  const [peerInfo, netTotals, uptime, deploymentInfo, chainTxStats, chainTips] =
    await Promise.all([
      safe("getpeerinfo"),
      safe("getnettotals"),
      safe("uptime"),
      safe("getdeploymentinfo"),
      blockchain.blocks >= 1
        ? safe("getchaintxstats", [Math.min(2016, blockchain.blocks)])
        : Promise.resolve(null),
      safe("getchaintips"),
    ]);

  const [feeFast, feeMed, feeSlow, feeEco] = ibd
    ? [null, null, null, null]
    : await Promise.all([
        safe("estimatesmartfee", [1]),
        safe("estimatesmartfee", [6]),
        safe("estimatesmartfee", [144]),
        safe("estimatesmartfee", [1008]),
      ]);

  const tipHeight = blockchain.blocks;
  const count = Math.min(ibd ? 8 : 16, tipHeight + 1);
  const heights = Array.from({ length: count }, (_, i) => tipHeight - i).filter(
    (h) => h >= 0,
  );

  const hashes = heights.length
    ? await Promise.all(heights.map((h) => safe("getblockhash", [h])))
    : [];

  const [headers, stats] = heights.length
    ? await Promise.all([
        Promise.all(
          hashes.map((h) => (h ? safe("getblockheader", [h, true]) : null)),
        ),
        ibd
          ? Promise.resolve(heights.map(() => null))
          : Promise.all(
              hashes.map((h) =>
                h ? safe("getblockstats", [h, BLOCK_STATS_FIELDS]) : null,
              ),
            ),
      ])
    : [[], []];

  const blocks = hashes
    .map((hash, i) => (hash ? normalizeBlock(hash, headers[i], stats[i]) : null))
    .filter(Boolean);

  const ni = networkInfo || {};
  _state = {
    blockchain,
    networkInfo: ni,
    mempoolInfo: mempoolInfo || {},
    peers: Array.isArray(peerInfo) ? peerInfo : [],
    blocks,
    chainTxStats: chainTxStats || {},
    fees: normalizeFees(feeFast, feeMed, feeSlow, feeEco),
    netTotals: netTotals || {},
    uptime: uptime || 0,
    deploymentInfo: deploymentInfo || {},
    chainTips: Array.isArray(chainTips) ? chainTips : [],
    minrelaytxfee: ni.relayfee ?? ni.minrelaytxfee ?? null,
    incrementalfee: ni.incrementalfee ?? null,
    networkWarnings: Array.isArray(ni.warnings)
      ? ni.warnings.join(" ")
      : ni.warnings || "",
    ts: Date.now(),
    rpcNode: RPC_HOST + ":" + RPC_PORT,
    zmqMode: _pollFallbackActive ? "poll" : "zmq",
  };
}

// ── Per-block refresh ─────────────────────────────────────────────────────────
// Triggered by ZMQ hashblock or the poll fallback. Fetches only the new block
// and a handful of summary calls — not the full 30-call batch.
let _blockRefreshInFlight = false;

async function onNewBlock() {
  if (_blockRefreshInFlight) return;
  _blockRefreshInFlight = true;
  try {
    if (!_state) return;

    const bc = await safe("getblockchaininfo");
    if (!bc) return;

    if (_state.blockchain?.chain && bc.chain !== _state.blockchain.chain) {
      await initState();
      if (_state && !_state.error) broadcast();
      return;
    }

    // Dedup: skip if we've already processed this height
    if (bc.blocks <= (_state.blocks[0]?.height ?? -1)) return;

    const blockHash = bc.bestblockhash;
    if (!blockHash) return;

    const ibd = bc.initialblockdownload || false;
    const [hdr, st, mi, cts] = await Promise.all([
      safe("getblockheader", [blockHash, true]),
      ibd
        ? Promise.resolve(null)
        : safe("getblockstats", [blockHash, BLOCK_STATS_FIELDS]),
      safe("getmempoolinfo"),
      safe("getchaintxstats", [Math.min(2016, bc.blocks || 1)]),
    ]);

    // If the block header failed, skip the block update rather than pushing
    // a broken entry into state. blockchain + mempool still update below.
    if (!hdr) {
      _state.blockchain = bc;
      if (mi) _state.mempoolInfo = mi;
      if (cts) _state.chainTxStats = cts;
      delete _state.error;
      _state.ts = Date.now();
      broadcast();
      return;
    }

    const newBlock = normalizeBlock(blockHash, hdr, st);
    const maxBlocks = ibd ? 8 : 16;

    _state.blockchain = bc;
    _state.blocks = [newBlock, ..._state.blocks].slice(0, maxBlocks);
    if (mi) _state.mempoolInfo = mi;
    if (cts) _state.chainTxStats = cts;
    delete _state.error;
    _state.ts = Date.now();

    broadcast();
  } finally {
    _blockRefreshInFlight = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// ZMQ INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════════

let _pollFallbackActive = false;
let _zmqSocket = null;

async function initZmq() {
  let Subscriber;
  try {
    ({ Subscriber } = require("zeromq"));
  } catch (_) {
    row("zmq", "module not found — falling back to polling", A.pos);
    startPollFallback();
    return;
  }

  try {
    const sock = new Subscriber();
    _zmqSocket = sock;
    sock.connect(`tcp://${ZMQ_HOST}:${ZMQ_PORT}`);
    sock.subscribe("hashblock");
    row("zmq", `tcp://${ZMQ_HOST}:${ZMQ_PORT}`, A.grn);

    for await (const [topicBuf] of sock) {
      if (topicBuf.toString() !== "hashblock") continue;
      try {
        await onNewBlock();
      } catch (e) {
        row("zmq", "onNewBlock error: " + e.message, A.neg);
      }
    }
  } catch (e) {
    _zmqSocket = null;
    row("zmq", "error: " + e.message + " — falling back to polling", A.pos);
    startPollFallback();
  }
}

// ── Chain watcher — detects node switches regardless of ZMQ state ─────────────
// Runs always alongside ZMQ. One cheap getblockchaininfo every 10s is enough
// to catch a chain change within 10s, matching the pre-ZMQ behaviour.
function startChainWatcher() {
  setInterval(async () => {
    if (!_state || _state.error) return;
    const bc = await safe("getblockchaininfo");
    if (!bc || !_state.blockchain?.chain) return;
    if (bc.chain !== _state.blockchain.chain) {
      await initState();
      if (_state && !_state.error) broadcast();
    }
  }, 10000);
}

// ── Poll fallback — used when ZMQ is unavailable ──────────────────────────────
// Checks for new blocks every 10s. If the node is mid-IBD this also provides
// the regular blockchain-state updates that ZMQ alone doesn't cover.
function startPollFallback() {
  if (_pollFallbackActive) return;
  _pollFallbackActive = true;
  if (_state) { _state.zmqMode = "poll"; broadcast(); }

  setInterval(async () => {
    if (!_state) return;
    const bc = await safe("getblockchaininfo");
    if (!bc) return;
    if (_state.blockchain?.chain && bc.chain !== _state.blockchain.chain) {
      // Chain switched — full re-init so blocks, peers, fees all reset cleanly.
      await initState();
      if (_state && !_state.error) broadcast();
      return;
    }
    if (bc.blocks > (_state.blocks[0]?.height ?? -1)) {
      // New block found — do the full per-block refresh.
      await onNewBlock();
    } else {
      // No new block — still update blockchain state so stale indicators stay fresh.
      _state.blockchain = bc;
      _state.ts = Date.now();
      broadcast();
    }
  }, 10000);
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
      const feeReqs = ibd
        ? []
        : [
            safe("estimatesmartfee", [1]),
            safe("estimatesmartfee", [6]),
            safe("estimatesmartfee", [144]),
            safe("estimatesmartfee", [1008]),
          ];

      const results = await Promise.all([...base, ...feeReqs]);
      const [peers, ni, tips, uptime] = results;
      const feeResults = results.slice(4);

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
      if (!ibd && feeResults.length === 4)
        _state.fees = normalizeFees(...feeResults);
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

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const origin = req.headers.origin || "";
  // CSRF defence: browsers always send an Origin header on cross-origin requests.
  // Rejecting any Origin that isn't localhost means a malicious page open in the
  // same browser cannot reach this server — even if it's on 127.0.0.1.
  if (origin && !origin.match(/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  // Security headers on every response
  res.setHeader("Access-Control-Allow-Origin", origin || "http://localhost");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
        blockSource: _pollFallbackActive ? "poll" : "zmq",
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
      const [hdr, st] = await Promise.all([
        safe("getblockheader", [hash, true]),
        safe("getblockstats", [hash, BLOCK_STATS_FIELDS]),
      ]);
      if (!hdr) throw new Error("block not found");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(normalizeBlock(hash, hdr, st)));
    } catch (e) {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: e.message }));
    }
    return;
  }

  // ── /api/rpc — privileged loopback-only proxy for peer management ──────────
  if (url.pathname === "/api/rpc" && req.method === "POST") {
    // SECURITY: proxies disconnect and ban calls. Only allow loopback connections.
    // If HOST=0.0.0.0, do not expose this to untrusted networks.
    const remote = req.socket.remoteAddress;
    const isLoopback = (() => {
      if (!remote) return false;
      if (remote === "::1") return true;
      const ipv4 = remote.startsWith("::ffff:") ? remote.slice(7) : remote;
      const parts = ipv4.split(".");
      if (parts.length !== 4) return false;
      const nums = parts.map(Number);
      return (
        nums.every((n, i) => Number.isInteger(n) && n >= 0 && n <= 255) &&
        nums[0] === 127
      );
    })();
    if (!isLoopback) {
      res.writeHead(403, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "forbidden" }));
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
        rpcMethod = null;
      try {
        const { method, params } = JSON.parse(body);
        const ALLOWED_METHODS = new Set([
          "disconnectnode",
          "setban",
          "listbanned",
          "gettxoutsetinfo",
        ]);
        if (!ALLOWED_METHODS.has(method))
          throw new Error("method not allowed: " + method);
        result = { result: await rpc(method, params || []) };
        rpcMethod = method;
      } catch (e) {
        result = { error: e.message };
        status = 500;
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
  res.writeHead(404);
  res.end("not found");
});

// ═══════════════════════════════════════════════════════════════════════════════
// STARTUP
// ═══════════════════════════════════════════════════════════════════════════════

async function start() {
  printBanner();
  await loadAuth();

  // Build the initial state snapshot before accepting connections so the first
  // SSE client always receives a complete payload. If bitcoind is unreachable,
  // _state will hold an error payload and startFastRefresh will retry every 30s.
  await initState();

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
  startChainWatcher();

  return new Promise((resolve) => {
    server.listen(SERVER_PORT, SERVER_HOST, () => {
      if (SERVER_HOST !== "127.0.0.1" && SERVER_HOST !== "localhost") {
        row(
          "warning",
          "dashboard exposed on " + SERVER_HOST + " — ensure firewall is set",
          A.neg,
        );
      }
      row("node", RPC_HOST + ":" + RPC_PORT);
      const bar = c(A.t4, "-".repeat(Math.min(W - 4, 38)));
      process.stdout.write("  " + bar + "\n");
      row("dashboard", "http://" + SERVER_HOST + ":" + SERVER_PORT, A.pos);
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
  if (!HTTP_ENABLED) {
    console.log("blockwatch: use the Electron app, or set BLOCKWATCH_HTTP=1 to enable browser mode.");
    process.exit(0);
  }
  start().catch((e) => { console.error(e); process.exit(1); });
}

// ═══════════════════════════════════════════════════════════════════════════════
// SHUTDOWN
// ═══════════════════════════════════════════════════════════════════════════════

// SIGTERM: sent by systemd, Docker, Umbrel on stop/restart/update
// SIGINT:  sent by Ctrl+C in a terminal
let _shuttingDown = false;
function shutdown() {
  if (_shuttingDown) return;
  _shuttingDown = true;
  // Drain in-flight SSE writes before exiting. Give up to 5s.
  const force = setTimeout(() => {
    console.error("[blockwatch] shutdown timeout — forcing exit");
    process.exit(1);
  }, 5000);
  if (_zmqSocket) { try { _zmqSocket.close(); } catch (_) {} _zmqSocket = null; }
  _sseClients.forEach((r) => { try { r.destroy(); } catch (_) {} });
  _sseClients = [];
  server.close(() => {
    _rpcAgent.destroy();
    clearTimeout(force);
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
process.on("unhandledRejection", (reason) => {
  console.error("[unhandled rejection]", reason);
  shutdown();
});
process.on("uncaughtException", (err) => {
  console.error("[uncaught exception]", err);
  shutdown();
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

module.exports = { start, stop, rpc };
