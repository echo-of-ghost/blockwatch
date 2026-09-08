"use strict";
// Explorer URL builder — client/shared.js `utils.explorer`.
//
// A user-supplied string reaches an href here, so the hostile cases carry more
// weight than the happy path. Runs headless: loads shared.js into a vm with a
// fake localStorage, so it needs no node, no Electron and no network.
//
//   node test/explorer-url.test.js

const { runSuite } = require("./lib/harness");
const fs = require("fs");
const vm = require("vm");
const path = require("path");

const ROOT = path.join(__dirname, "..");
let store = {};
const ctx = {
  console, URL, AbortSignal, AbortController, setTimeout, clearTimeout,
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  document: { querySelectorAll: () => [], addEventListener() {}, getElementById: () => null },
  window: {},
  navigator: { clipboard: { writeText: () => Promise.resolve() } },
  fetch: () => Promise.reject(new Error("no network in this harness")),
};
ctx.globalThis = ctx;
vm.createContext(ctx);

// `const utils = {...}` lands in the script's global lexical scope rather than
// on the context object, so take it as the completion value.
const E = vm.runInContext(
  fs.readFileSync(path.join(ROOT, "client/shared.js"), "utf8") + "\n;utils.explorer;",
  ctx,
  { filename: "shared.js" },
);

const cfg = (o) => { store["bw-explorer"] = JSON.stringify(o); };
const HASH = "a".repeat(64);

runSuite("explorer URL validation", async (t) => {
  t.expect(50);
  // The shared harness rather than a local `ok`: it counts assertions so a
  // check that stops running is caught, and a throw becomes one failure
  // instead of taking the whole file down.
  const ok = (name, cond, detail) => t.check(name, cond, detail);

  // ── hostile input: only http(s) may ever reach an href ─────────────────────
  const HOSTILE = [
    "javascript:alert(1)",
    "JavaScript:alert(1)",
    "  javascript:alert(1)  ",
    // URL parsing strips newlines and tabs before reporting the protocol, and so
    // does HTML attribute parsing. A builder that returned the raw string here
    // would hand the DOM a live javascript: URL, which is why the check reads the
    // PARSED protocol rather than the leading characters.
    "java\nscript:alert(1)",
    "java\tscript:alert(1)",
    "jav\rascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "vbscript:msgbox(1)",
    // These carry a HOSTNAME, so the `!u.hostname` guard does not reject them —
    // only the scheme check does. Every other hostile case here is caught by
    // both, which meant deleting the scheme check broke just two assertions and
    // the suite still reported 44/46. `javascript://host/%0apayload` is the
    // classic form: `//` opens a JS comment, `%0a` ends it, the payload runs.
    "javascript://x.example/%0aalert(1)",
    "jAvAsCrIpT://x.example/%0aalert(1)",
    "data://x.example/y",
    "vbscript://x.example/y",
    "file:///etc/passwd",
    "blob:https://x.example/abc",
    "about:blank",
    "chrome://settings",
    "//evil.example",   // scheme-relative: not absolute, must not parse
    "/relative/path",
    "not a url at all",
    "", "   ",
    "https://",         // no host
    "http://",
  ];
  for (const bad of HOSTILE) {
    cfg({ mode: "custom", url: bad });
    const got = E.blockUrl(HASH, "main");
    await ok("rejected: " + JSON.stringify(bad).slice(0, 42), got === null, String(got));
  }
  const survivors = HOSTILE.map((u) => { cfg({ mode: "custom", url: u }); return E.blockUrl(HASH, "main"); })
    .filter(Boolean);
  await ok("no hostile input produced any URL at all", survivors.length === 0, JSON.stringify(survivors));

  // ── valid custom targets ───────────────────────────────────────────────────
  for (const [input, want] of [
    ["http://umbrel.local:3006", "http://umbrel.local:3006/block/" + HASH],
    ["https://mempool.local/", "https://mempool.local/block/" + HASH],
    ["https://x.example/path//", "https://x.example/path/block/" + HASH],
    ["https://blockstream.info", "https://blockstream.info/block/" + HASH],
    ["http://127.0.0.1:8080", "http://127.0.0.1:8080/block/" + HASH],
  ]) {
    cfg({ mode: "custom", url: input });
    await ok("builds " + input, E.blockUrl(HASH, "main") === want, String(E.blockUrl(HASH, "main")));
  }

  // {hash} placeholder, for explorers whose path is not /block/<hash>
  cfg({ mode: "custom", url: "https://x.example/b/{hash}?full=1" });
  await ok("placeholder substituted",
     E.blockUrl(HASH, "main") === "https://x.example/b/" + HASH + "?full=1",
     String(E.blockUrl(HASH, "main")));
  cfg({ mode: "custom", url: "javascript:x/{hash}" });
  await ok("placeholder does not bypass the scheme check", E.blockUrl(HASH, "main") === null);

  // ── the hash itself stays constrained ──────────────────────────────────────
  cfg({ mode: "custom", url: "https://x.example" });
  for (const bad of ['"><img src=x onerror=alert(1)>', "../../etc/passwd", "zzz", "",
                     null, undefined, "a".repeat(63), "a".repeat(65)]) {
    await ok("bad hash rejected: " + JSON.stringify(String(bad)).slice(0, 30),
       E.blockUrl(bad, "main") === null);
  }

  // ── mempool.space preset, including the regtest dead-link bug ──────────────
  cfg({ mode: "mempool", url: "" });
  await ok("mainnet preset", E.blockUrl(HASH, "main") === "https://mempool.space/block/" + HASH);
  await ok("signet preset", E.blockUrl(HASH, "signet") === "https://mempool.space/signet/block/" + HASH);
  await ok("testnet4 preset", E.blockUrl(HASH, "testnet4") === "https://mempool.space/testnet4/block/" + HASH);
  await ok("testnet preset", E.blockUrl(HASH, "test") === "https://mempool.space/testnet/block/" + HASH);
  // Previously fell through to a mainnet URL for a regtest hash: always dead.
  await ok("regtest gets no link instead of a dead mainnet one", E.blockUrl(HASH, "regtest") === null,
     String(E.blockUrl(HASH, "regtest")));
  await ok("unknown chain gets no link", E.blockUrl(HASH, "banana") === null);

  // ── none ───────────────────────────────────────────────────────────────────
  cfg({ mode: "none", url: "https://mempool.space" });
  await ok("none suppresses links even with a URL stored", E.blockUrl(HASH, "main") === null);

  // ── stored-config robustness ───────────────────────────────────────────────
  store["bw-explorer"] = "{not json";
  await ok("corrupt JSON falls back to the default", !!E.blockUrl(HASH, "main")?.startsWith("https://mempool.space/"));
  cfg({ mode: "wat", url: 42 });
  await ok("unknown mode falls back to mempool", !!E.blockUrl(HASH, "main")?.startsWith("https://mempool.space/"));
  store["bw-explorer"] = JSON.stringify(null);
  await ok("null config falls back", !!E.blockUrl(HASH, "main")?.startsWith("https://mempool.space/"));
  delete store["bw-explorer"];
  await ok("absent config keeps the default (mempool.space)",
     E.blockUrl(HASH, "main") === "https://mempool.space/block/" + HASH);
});
