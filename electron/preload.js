const { contextBridge, ipcRenderer, webFrame } = require("electron");

try {
  webFrame.setVisualZoomLevelLimits(1, 1);
} catch (_) {}

const ALLOWED_IPC_CHANNELS = new Set([
  "download-logger",
  "mal",
  "shared-state-updated",
  "update-available",
  "update-downloaded",
  "mpv-started",
  "mpv-loading",
  "mpv-closed",
  "mpv-error",
  "mpv-action",
  "mpv-setting-changed",
  "mpv-progress",
  "mal-sync-notification",
  "download-complete",
  "download-error",
  "extention-updated",
  "update-not-available",
  "update-download-progress",
  "update-error",
  "catalog-loading-status",
  "info-loading-status",
  "open-settings-tab",
  "anime-id-updated",
  "reader-zoom",
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
  extensions: (
    TaskType,
    AnimeManga,
    ExtentionName,
    RepoOwner = "TheYogMehta",
    RepoBaseUrl,
    MinAppVersion,
  ) =>
    ipcRenderer.invoke(
      "extensions",
      TaskType,
      AnimeManga,
      ExtentionName,
      RepoOwner,
      RepoBaseUrl,
      MinAppVersion,
    ),
  getMarketplace: (activeType) =>
    ipcRenderer.invoke("get-marketplace", activeType),
  getExtensionRepos: () => ipcRenderer.invoke("get-extension-repos"),
  addExtensionRepo: (url) => ipcRenderer.invoke("add-extension-repo", url),
  removeExtensionRepo: (owner) =>
    ipcRenderer.invoke("remove-extension-repo", owner),
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
  openLocalPath: (targetPath, openFolder) =>
    ipcRenderer.invoke("open-local-path", targetPath, openFolder),
  selectDirectory: (currentPath) =>
    ipcRenderer.invoke("select-directory", currentPath),
  playInMpv: (options) => ipcRenderer.invoke("play-in-mpv", options),
  controlMpv: (command, args) =>
    ipcRenderer.invoke("control-mpv", command, args),
});

contextBridge.exposeInMainWorld("electron", true);
