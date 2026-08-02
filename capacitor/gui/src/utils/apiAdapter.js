/**
 * Platform API Adapter for Capacitor
 * Bridges Capacitor HTTP / bridge calls and Node API endpoints seamlessly.
 */

export const isCapacitor = true;

export async function fetchApi(endpoint, options = {}) {
  const response = await fetch(endpoint, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });
  return response.json();
}

export async function getSettings(keys) {
  const res = await fetchApi("/api/settings");
  return res;
}

export async function updateSetting(key, value) {
  return fetchApi("/api/settings/update", {
    method: "POST",
    body: JSON.stringify({ [key]: value }),
  });
}

export function subscribeIPC(channel, callback) {
  if (typeof window !== "undefined" && window.sharedStateAPI?.on) {
    return window.sharedStateAPI.on(channel, callback);
  }
  return () => {};
}
