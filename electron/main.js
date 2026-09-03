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
  const { start, rpc } = require("../server");
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
  let _lastExec = 0;
  ipcMain.handle("terminal:exec", async (event, method, params) => {
    // Only the dashboard's own main frame may drive RPC.
    if (!_win || event.sender !== _win.webContents || event.senderFrame !== _win.webContents.mainFrame)
      return { ok: false, error: "unauthorized sender" };
    if (typeof method !== "string" || !/^[a-z0-9]{1,64}$/.test(method))
      return { ok: false, error: "invalid method name" };
    if (params != null && !Array.isArray(params))
      return { ok: false, error: "params must be an array" };
    const now = Date.now();
    if (now - _lastExec < 200) return { ok: false, error: "rate limited" };
    _lastExec = now;
    try {
      const result = await rpc(method, params || []);
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e.message };
    }
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
