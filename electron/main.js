"use strict";

const { app, BrowserWindow, shell, ipcMain, globalShortcut } = require("electron");

const path = require("path");

let _win = null;
let _serverPort = null;

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

  // Open external links in the system browser, not Electron
  _win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  _win.on("closed", () => { _win = null; });
}

app.whenReady().then(async () => {
  const { start, rpc } = require("../server");
  _serverPort = await start();

  // Terminal IPC — renderer sends a bitcoin-cli style command, we call RPC
  // directly in the main process where credentials live.
  let _lastExec = 0;
  ipcMain.handle("terminal:exec", async (_, method, params) => {
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

  // Ctrl+T — registered at OS level so it works even if the system would
  // otherwise intercept it (e.g. Ubuntu desktop environments).
  globalShortcut.register("CommandOrControl+`", () => {
    if (_win) _win.webContents.send("terminal:toggle");
  });

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
