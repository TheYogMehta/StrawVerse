/**
 * Platform API Adapter
 * Bridges Electron IPC and Capacitor HTTP/native plugins smoothly.
 */

export const isElectron =
  typeof window !== "undefined" && Boolean(window.sharedStateAPI);

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
  if (isElectron) {
    const res = await window.sharedStateAPI.getSettings(keys);
    return res.settings;
  }
  const res = await fetchApi("/api/settings");
  return res;
}

export async function updateSetting(key, value) {
  if (isElectron) {
    return window.sharedStateAPI.updateSetting(key, value);
  }
  return fetchApi("/api/settings/update", {
    method: "POST",
    body: JSON.stringify({ [key]: value }),
  });
}

export function subscribeIPC(channel, callback) {
  if (isElectron && window.sharedStateAPI?.on) {
    return window.sharedStateAPI.on(channel, callback);
  }
  return () => {};
}
