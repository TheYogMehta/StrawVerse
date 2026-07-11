/**
 * sharedStateAPI polyfill for non-Electron environments (Android app, web).
 *
 * On desktop, Electron's preload script exposes `window.sharedStateAPI`
 * backed by ipcRenderer. On Android the same backend runs embedded via
 * nodejs-mobile and exposes the identical handlers over HTTP:
 *
 *   POST /api/ipc/:channel   { args: [...] } -> { ok, result }
 *   GET  /api/ipc/events     Server-Sent Events for push messages
 *
 * Importing this module is a no-op on desktop (the preload API wins).
 */

function invoke(channel, ...args) {
  return fetch(`/api/ipc/${encodeURIComponent(channel)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ args }),
  })
    .then(async (res) => {
      const body = await res.json().catch(() => ({}));
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || `IPC channel "${channel}" failed`);
      }
      return body.result;
    });
}

let eventSource = null;
const eventListeners = new Map(); // channel -> Set<callback>

function ensureEventSource() {
  if (eventSource) return;
  eventSource = new EventSource("/api/ipc/events");
  eventSource.onmessage = (event) => {
    try {
      const { channel, data } = JSON.parse(event.data);
      const listeners = eventListeners.get(channel);
      if (listeners) {
        for (const cb of listeners) cb(data);
      }
      if (channel === "open-external" && data?.url) {
        // The Android WebView intercepts non-localhost navigations and opens
        // them in the system browser.
        window.open(data.url, "_blank", "noopener");
      }
    } catch (_) {
      /* ignore malformed events */
    }
  };
  eventSource.onerror = () => {
    // EventSource auto-reconnects; nothing to do.
  };
}

function createPolyfill() {
  return {
    get: () => invoke("get-shared-state"),
    set: (newState) => invoke("set-shared-state", newState),
    discordrpc: (AnimeName, Episode) =>
      invoke("update-discordrpc", AnimeName, Episode),
    on: (channel, callback) => {
      ensureEventSource();
      if (!eventListeners.has(channel)) eventListeners.set(channel, new Set());
      eventListeners.get(channel).add(callback);
      return () => {
        eventListeners.get(channel)?.delete(callback);
      };
    },
    marketplace: (AnimeManga) => {
      invoke("marketplace", AnimeManga).catch(() => {});
    },
    extensions: (TaskType, AnimeManga, ExtentionName) =>
      invoke("extensions", TaskType, AnimeManga, ExtentionName),
    checkWhatsNew: () => invoke("check-whats-new"),
    disableWhatsNew: () => invoke("disable-whats-new"),
    ensureCfBypass: (url, referer) =>
      invoke("ensure-cf-bypass", url, referer),
    getSettings: (keys) => invoke("get-settings", keys),
    updateSetting: (key, value) => invoke("update-setting", key, value),
    updateSettings: (settingsObj) => invoke("update-settings", settingsObj),
    checkForUpdate: () => invoke("check-for-update"),
    downloadUpdate: () => invoke("download-update"),
    installUpdate: () => invoke("install-update"),
    getAppVersion: () => invoke("get-app-version"),
  };
}

// Only install the polyfill when Electron's preload didn't provide the API.
if (typeof window !== "undefined" && !window.sharedStateAPI) {
  window.sharedStateAPI = createPolyfill();
  window.__STRAWVERSE_MOBILE__ = true;
}

export const isMobileApp = () =>
  typeof window !== "undefined" && window.__STRAWVERSE_MOBILE__ === true;
