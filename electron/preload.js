"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Adds the `electron` class to <body> so CSS can apply drag regions.
// document is shared between the isolated preload context and the page.
document.addEventListener("DOMContentLoaded", () => {
  document.body.classList.add("electron");
  document.body.classList.add("platform-" + process.platform);
});

// Relay Ctrl+` from main process into the page via document.
// window is NOT shared across contextIsolation — document is.
ipcRenderer.on("terminal:toggle", () => {
  document.dispatchEvent(new CustomEvent("terminal:toggle"));
});

// Expose terminal RPC bridge — renderer can invoke bitcoin-cli style commands
// through the main process where RPC credentials live. No credentials are ever
// passed to or accessible from the renderer.
contextBridge.exposeInMainWorld("terminal", {
  exec: (method, params) => ipcRenderer.invoke("terminal:exec", method, params),
});
