const { contextBridge, ipcRenderer } = require("electron");

const ALLOWED_IPC_CHANNELS = new Set([
  "download-logger",
  "mal",
  "shared-state-updated",
  "update-available",
  "update-downloaded",
  "mpv-started",
  "mpv-closed",
  "mpv-error",
  "mpv-action",
  "mpv-setting-changed",
  "mpv-progress",
  "mal-sync-notification",
  "download-complete",
  "extention-updated",
  "update-not-available",
  "update-download-progress",
  "update-error",
]);

contextBridge.exposeInMainWorld("sharedStateAPI", {
  get: () => ipcRenderer.invoke("get-shared-state"),
  set: (newState) => ipcRenderer.invoke("set-shared-state", newState),
  discordrpc: (AnimeName, Episode) =>
    ipcRenderer.invoke("update-discordrpc", AnimeName, Episode),
  on: (channel, callback) => {
    if (!ALLOWED_IPC_CHANNELS.has(channel)) {
      console.warn(
        `[Security Warning] Blocked subscription to unauthorized IPC channel: ${channel}`,
      );
      return () => {};
    }
    const listener = (_event, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => {
      ipcRenderer.removeListener(channel, listener);
    };
  },
  marketplace: (AnimeManga) => ipcRenderer.send("marketplace", AnimeManga),
  extensions: (TaskType, AnimeManga, ExtentionName) =>
    ipcRenderer.invoke("extensions", TaskType, AnimeManga, ExtentionName),
  checkWhatsNew: () => ipcRenderer.invoke("check-whats-new"),
  disableWhatsNew: () => ipcRenderer.invoke("disable-whats-new"),
  ensureCfBypass: (url, referer) =>
    ipcRenderer.invoke("ensure-cf-bypass", url, referer),
  getSettings: (keys) => ipcRenderer.invoke("get-settings", keys),
  updateSetting: (key, value) =>
    ipcRenderer.invoke("update-setting", key, value),
  updateSettings: (settingsObj) =>
    ipcRenderer.invoke("update-settings", settingsObj),
  checkForUpdate: () => ipcRenderer.invoke("check-for-update"),
  downloadUpdate: () => ipcRenderer.invoke("download-update"),
  installUpdate: () => ipcRenderer.invoke("install-update"),
  getAppVersion: () => ipcRenderer.invoke("get-app-version"),
  playInMpv: (options) => ipcRenderer.invoke("play-in-mpv", options),
  controlMpv: (command, args) =>
    ipcRenderer.invoke("control-mpv", command, args),
});
