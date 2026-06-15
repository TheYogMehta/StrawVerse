const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("sharedStateAPI", {
  get: () => ipcRenderer.invoke("get-shared-state"),
  set: (newState) => ipcRenderer.invoke("set-shared-state", newState),
  discordrpc: (AnimeName, Episode) =>
    ipcRenderer.invoke("update-discordrpc", AnimeName, Episode),
  on: (channel, callback) => {
    ipcRenderer.on(channel, (_event, data) => callback(data));
  },
  marketplace: (AnimeManga) => ipcRenderer.send("marketplace", AnimeManga),
  extensions: (TaskType, AnimeManga, ExtentionName) =>
    ipcRenderer.invoke("extensions", TaskType, AnimeManga, ExtentionName),
  checkWhatsNew: () => ipcRenderer.invoke("check-whats-new"),
  ensureCfBypass: (url, referer) =>
    ipcRenderer.invoke("ensure-cf-bypass", url, referer),
});
