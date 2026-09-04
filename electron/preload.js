"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Adds platform class to <body> for platform-specific CSS (e.g. macOS traffic lights).
document.addEventListener("DOMContentLoaded", () => {
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
  // id lets the renderer cancel a specific in-flight call.
  exec: (id, method, params) => ipcRenderer.invoke("terminal:exec", id, method, params),
  cancel: (id) => ipcRenderer.invoke("terminal:cancel", id),
});
