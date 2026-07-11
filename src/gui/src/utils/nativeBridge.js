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
  }).then(async (res) => {
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
  console.log("[nativeBridge] Initializing EventSource to /api/ipc/events");
  eventSource = new EventSource("/api/ipc/events");

  eventSource.onopen = () => {
    console.log("[nativeBridge] EventSource connection opened successfully");
  };

  eventSource.onmessage = (event) => {
    try {
      console.log(
        "[nativeBridge] EventSource received message raw:",
        event.data,
      );
      const { channel, data } = JSON.parse(event.data);
      console.log(
        `[nativeBridge] EventSource parsed message: channel=${channel}`,
        data,
      );

      const listeners = eventListeners.get(channel);
      if (listeners) {
        for (const cb of listeners) cb(data);
      }

      if (channel === "open-external" && data?.url) {
        console.log("[nativeBridge] Handling open-external for URL:", data.url);
        window.open(data.url, "_blank", "noopener");
      }

      if (channel === "cf-bypass-request" && data?.url) {
        console.log(
          "[nativeBridge] Handling cf-bypass-request for URL:",
          data.url,
        );
        const CloudflareBypass = window.Capacitor?.Plugins?.CloudflareBypass;
        if (CloudflareBypass) {
          console.log(
            "[nativeBridge] Found CloudflareBypass plugin, invoking bypass()",
          );
          CloudflareBypass.bypass({ url: data.url, userAgent: data.userAgent })
            .then((res) => {
              console.log(
                "[nativeBridge] CloudflareBypass resolved, cookies length:",
                res.cookies ? res.cookies.length : 0,
              );
              if (res.cookies) {
                invoke("save-cf-cookies", data.url, res.cookies)
                  .then(() =>
                    console.log(
                      "[nativeBridge] cookies saved to backend successfully",
                    ),
                  )
                  .catch((err) =>
                    console.error(
                      "[nativeBridge] Failed to save-cf-cookies:",
                      err,
                    ),
                  );
              }
            })
            .catch((err) => {
              console.error(
                "[nativeBridge] Cloudflare bypass plugin invocation rejected:",
                err,
              );
            });
        } else {
          console.error(
            "[nativeBridge] window.Capacitor.Plugins.CloudflareBypass is UNDEFINED!",
          );
        }
      }

      if (channel === "trigger-install" && data?.path) {
        console.log(
          "[nativeBridge] Handling trigger-install for path:",
          data.path,
        );
        const CloudflareBypass = window.Capacitor?.Plugins?.CloudflareBypass;
        if (CloudflareBypass) {
          CloudflareBypass.installApk({ path: data.path }).catch((err) => {
            console.error("[nativeBridge] Install APK plugin error:", err);
          });
        } else {
          console.error(
            "[nativeBridge] window.Capacitor.Plugins.CloudflareBypass is UNDEFINED for installApk!",
          );
        }
      }
    } catch (e) {
      console.error("[nativeBridge] Error handling EventSource message:", e);
    }
  };

  eventSource.onerror = (err) => {
    console.error(
      "[nativeBridge] EventSource encountered error. ReadyState:",
      eventSource.readyState,
      err,
    );
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
    ensureCfBypass: (url, referer) => invoke("ensure-cf-bypass", url, referer),
    getSettings: (keys) => invoke("get-settings", keys),
    updateSetting: (key, value) => invoke("update-setting", key, value),
    updateSettings: (settingsObj) => invoke("update-settings", settingsObj),
    checkForUpdate: () => invoke("check-for-update"),
    downloadUpdate: () => invoke("download-update"),
    installUpdate: () => invoke("install-update"),
    getAppVersion: () => invoke("get-app-version"),
    checkWtHealth: (url) => invoke("check-wt-health", url),
  };
}

// Only install the polyfill when Electron's preload didn't provide the API.
if (typeof window !== "undefined" && !window.sharedStateAPI) {
  window.sharedStateAPI = createPolyfill();
  window.__STRAWVERSE_MOBILE__ = true;
  setTimeout(() => {
    ensureEventSource();
  }, 1000);
}

export const isMobileApp = () =>
  typeof window !== "undefined" && window.__STRAWVERSE_MOBILE__ === true;
