"use strict";

const { app, BrowserWindow, shell, ipcMain, globalShortcut, dialog } = require("electron");

const path = require("path");

let _win = null;
let _serverPort = null;

const TERMINAL_SHORTCUT = "CommandOrControl+`";
const localOrigin = () => `http://127.0.0.1:${_serverPort}`;

function registerTerminalShortcut() {
  // Registered at OS level so it works even where the desktop environment
  // would otherwise intercept it — but only while blockwatch is focused, so
  // it does not steal Ctrl+` from other applications (e.g. VS Code's terminal).
  try {
    if (!globalShortcut.isRegistered(TERMINAL_SHORTCUT)) {
      globalShortcut.register(TERMINAL_SHORTCUT, () => {
        if (_win) _win.webContents.send("terminal:toggle");
      });
    }
  } catch (_) {}
}
function unregisterTerminalShortcut() {
  try {
    globalShortcut.unregister(TERMINAL_SHORTCUT);
  } catch (_) {}
}

async function createWindow(port) {
  _win = new BrowserWindow({
    width: 1920,
    height: 1200,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    titleBarStyle: "hiddenInset", // macOS: native traffic lights, inset into content
    backgroundColor: "#080808",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  _win.loadURL(`http://127.0.0.1:${port}`);

  // Open external links in the system browser, not Electron. Only web URLs:
  // shell.openExternal would otherwise hand arbitrary schemes to the OS.
  _win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: "deny" };
  });

  // The renderer must never navigate away from the local server. A foreign
  // page loaded in this window would inherit the preload bridge
  // (window.terminal.exec) and with it unrestricted RPC access to the node.
  _win.webContents.on("will-navigate", (e, url) => {
    if (!url.startsWith(localOrigin() + "/") && url !== localOrigin()) e.preventDefault();
  });

  _win.on("focus", registerTerminalShortcut);
  _win.on("blur", unregisterTerminalShortcut);
  _win.on("closed", () => {
    unregisterTerminalShortcut();
    _win = null;
  });
  if (_win.isFocused()) registerTerminalShortcut();
}

app.whenReady().then(async () => {
  const { start, rpcCancellable } = require("../server");
  try {
    _serverPort = await start();
  } catch (e) {
    // No terminal in a packaged app: without this the window never appears
    // and the user gets no explanation (e.g. no cookie + no credentials).
    dialog.showErrorBox("blockwatch cannot start", String((e && e.message) || e));
    app.exit(1);
    return;
  }

  // Terminal IPC — renderer sends a bitcoin-cli style command, we call RPC
  // directly in the main process where credentials live.
  //
  // Single-flight rather than a time window: the console runs one command at a
  // time by construction, so a 200ms rate limit only ever produced spurious
  // "rate limited" errors on fast input. In-flight calls are tracked by id so
  // the renderer can cancel a long one (gettxoutsetinfo runs for minutes).
  const _inflight = new Map();

  const fromDashboard = (event) =>
    _win &&
    event.sender === _win.webContents &&
    event.senderFrame === _win.webContents.mainFrame;

  ipcMain.handle("terminal:exec", async (event, id, method, params) => {
    // Only the dashboard's own main frame may drive RPC.
    if (!fromDashboard(event)) return { ok: false, error: "unauthorized sender", kind: "input" };
    if (!Number.isInteger(id)) return { ok: false, error: "invalid call id", kind: "input" };
    if (typeof method !== "string" || !/^[a-z0-9]{1,64}$/.test(method))
      return { ok: false, error: "invalid method name", kind: "input" };
    if (params != null && !Array.isArray(params))
      return { ok: false, error: "params must be an array", kind: "input" };
    if (_inflight.size > 0) return { ok: false, error: "a command is already running", kind: "input" };

    const call = rpcCancellable(method, params || []);
    _inflight.set(id, call);
    try {
      const result = await call.promise;
      return { ok: true, result };
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      // Separate what the node rejected from what never reached it, so the
      // console can present them differently.
      const kind = /cancelled/.test(msg)
        ? "cancelled"
        : /ECONNREFUSED|EHOSTUNREACH|ENOTFOUND|ETIMEDOUT|socket hang up|timeout|Unauthorized/i.test(msg)
          ? "transport"
          : "rpc";
      return { ok: false, error: msg, kind };
    } finally {
      _inflight.delete(id);
    }
  });

  ipcMain.handle("terminal:cancel", (event, id) => {
    if (!fromDashboard(event)) return { ok: false };
    const call = _inflight.get(id);
    if (!call) return { ok: false };
    call.cancel();
    return { ok: true };
  });

  await createWindow(_serverPort);

  // macOS: re-open window when dock icon is clicked with no windows open
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(_serverPort);
  });
});

app.on("window-all-closed", () => app.quit());
app.on("will-quit", () => globalShortcut.unregisterAll());

app.on("before-quit", async (e) => {
  e.preventDefault();
  const { stop } = require("../server");
  await stop();
  app.exit(0);
});
