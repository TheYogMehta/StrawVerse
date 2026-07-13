const routeMap = {
  "get-shared-state": { path: "/api/state/history", method: "GET" },
  "set-shared-state": { path: "/api/state/history", method: "POST" },
  extensions: { path: "/api/extensions", method: "POST" },
  "check-whats-new": { path: "/api/whats-new", method: "GET" },
  "disable-whats-new": { path: "/api/whats-new/disable", method: "POST" },
  "check-for-update": { path: "/api/update/check", method: "GET" },
  "download-update": { path: "/api/update/download", method: "POST" },
  "install-update": { path: "/api/update/install", method: "POST" },
  "set-device-user-agent": { path: "/api/device/user-agent", method: "POST" },
  "ensure-cf-bypass": { path: "/api/cf-bypass", method: "POST" },
  "save-cf-cookies": { path: "/api/cf-bypass/save", method: "POST" },
  "get-settings": { path: "/api/settings/get", method: "POST" },
  "update-setting": { path: "/api/settings/update", method: "POST" },
  "update-settings": { path: "/api/settings/update-multiple", method: "POST" },
  "native-response": { path: "/api/ipc/native-response", method: "POST" },
  "check-wt-health": { path: "/api/update/health", method: "GET" },
  "get-app-version": { path: "/api/version", method: "GET" },
};

function invoke(channel, ...args) {
  const route = routeMap[channel];
  if (!route) {
    return Promise.reject(new Error(`Unknown REST action: ${channel}`));
  }

  const fetchOptions = {
    method: route.method,
    headers: { "Content-Type": "application/json" },
  };

  let url = route.path;
  if (route.method === "POST") {
    fetchOptions.body = JSON.stringify({ args });
  } else if (args.length > 0) {
    url +=
      "?" +
      new URLSearchParams(
        args.map((a, i) => [
          `arg${i}`,
          typeof a === "object" ? JSON.stringify(a) : a,
        ]),
      ).toString();
  }

  return fetch(url, fetchOptions).then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.ok === false) {
      throw new Error(body.error || `REST request to "${route.path}" failed`);
    }
    return body.result;
  });
}

let eventSource = null;
const eventListeners = new Map(); // channel -> Set<callback>
const activeCaptchaDialogs = new Map();
const nativeRequestQueue = [];
let activeNativeRequests = 0;
const MAX_NATIVE_REQUESTS = 2;

function getRequestDomain(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch (_) {
    return url;
  }
}

function drainNativeRequestQueue() {
  while (
    activeNativeRequests < MAX_NATIVE_REQUESTS &&
    nativeRequestQueue.length > 0
  ) {
    activeNativeRequests += 1;
    const run = nativeRequestQueue.shift();
    run().finally(() => {
      activeNativeRequests -= 1;
      drainNativeRequestQueue();
    });
  }
}

function queueNativeRequest(data) {
  nativeRequestQueue.push(async () => {
    const plugin = window.Capacitor?.Plugins?.CloudflareBypass;
    if (!plugin) {
      await invoke(
        "native-response",
        data.requestId,
        false,
        null,
        "CloudflareBypass plugin is unavailable",
      );
      return;
    }

    try {
      const response = await plugin.nativeRequest({
        url: data.url,
        method: data.method || "GET",
        headers: data.headers || {},
        body: data.body ?? null,
      });
      await invoke("native-response", data.requestId, true, response, null);
    } catch (error) {
      await invoke(
        "native-response",
        data.requestId,
        false,
        null,
        error?.message || String(error),
      );
    }
  });
  drainNativeRequestQueue();
}

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
        console.log("[nativeBridge] Handling open-external for URL:", data.url);
        window.open(data.url, "_blank", "noopener");
      }

      if (channel === "native-request" && data?.requestId && data?.url) {
        queueNativeRequest(data);
      }

      if (channel === "cf-bypass-request" && data?.url) {
        console.log(
          "[nativeBridge] Handling cf-bypass-request for URL:",
          data.url,
        );
        const CloudflareBypass = window.Capacitor?.Plugins?.CloudflareBypass;
        if (CloudflareBypass) {
          const domain = getRequestDomain(data.url);
          if (activeCaptchaDialogs.has(domain)) return;

          console.log(
            "[nativeBridge] Found CloudflareBypass plugin, invoking bypass()",
          );
          const solvePromise = CloudflareBypass.bypass({
            url: data.url,
            userAgent: data.userAgent,
            referer: data.referer,
          })
            .then(async (res) => {
              console.log(
                "[nativeBridge] CloudflareBypass resolved, cookies length:",
                res.cookies ? res.cookies.length : 0,
              );
              if (res.cookies && res.userAgent) {
                await invoke(
                  "save-cf-cookies",
                  data.url,
                  res.cookies,
                  res.userAgent,
                  res.clientHints || {},
                );
                console.log(
                  "[nativeBridge] cookies saved to backend successfully",
                );
              }
            })
            .catch((err) => {
              console.error(
                "[nativeBridge] Cloudflare bypass plugin invocation rejected:",
                err,
              );
            })
            .finally(() => {
              if (activeCaptchaDialogs.get(domain) === solvePromise) {
                activeCaptchaDialogs.delete(domain);
              }
            });
          activeCaptchaDialogs.set(domain, solvePromise);
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
    invoke("set-device-user-agent", navigator.userAgent).catch((err) => {
      console.error("[nativeBridge] Failed to set device User-Agent:", err);
    });
  }, 1000);
}

export const isMobileApp = () =>
  typeof window !== "undefined" && window.__STRAWVERSE_MOBILE__ === true;
