const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sharedStateAPI", {
  get: () => ipcRenderer.invoke("get-shared-state"),
  set: (newState) => ipcRenderer.invoke("set-shared-state", newState),
  discordrpc: (AnimeName, Episode) =>
    ipcRenderer.invoke("update-discordrpc", AnimeName, Episode),
  on: (channel, callback) => {
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
  checkWtHealth: (url) => ipcRenderer.invoke("check-wt-health", url),
});
