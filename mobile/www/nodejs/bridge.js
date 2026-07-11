/**
 * HTTP <-> IPC bridge for the Android runtime.
 *
 * The desktop GUI talks to the Electron main process through
 * `window.sharedStateAPI` (contextBridge + ipcRenderer). On Android there is
 * no preload script, so the GUI loads a polyfill (src/gui/src/utils/
 * nativeBridge.js) that maps the same API onto:
 *
 *   POST /api/ipc/:channel   -> invoke an ipcMain handler, JSON in/out
 *   GET  /api/ipc/events     -> Server-Sent Events stream replacing
 *                               webContents.send() push messages
 *
 * This file also registers the mobile implementations of handlers that live
 * in gui.js on desktop (updates, changelog, app version, marketplace).
 */

const express = require("express");
const fs = require("fs");
const path = require("path");

const electron = require("./shims/electron");

const router = express.Router();

// ---------------------------------------------------------------------------
// SSE hub - replaces global.win.webContents.send(channel, data)
// ---------------------------------------------------------------------------
const sseClients = new Set();

function broadcast(channel, data) {
  const payload = `data: ${JSON.stringify({ channel, data })}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(payload);
    } catch (_) {
      sseClients.delete(res);
    }
  }
}

/** A `global.win` stand-in so backend `global.win.webContents.send` works. */
const fakeWindow = {
  webContents: {
    send: (channel, data) => broadcast(channel, data),
  },
  isDestroyed: () => false,
  show: () => {},
  focus: () => {},
};

router.get("/api/ipc/events", (req, res) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.write(": connected\n\n");
  sseClients.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (_) {
      /* handled by close */
    }
  }, 25000);
  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

router.post("/api/ipc/:channel", express.json({ limit: "5mb" }), async (req, res) => {
  const { channel } = req.params;
  const args = Array.isArray(req.body?.args) ? req.body.args : [];
  try {
    const result = await electron.__invokeIpcHandler(channel, args);
    res.json({ ok: true, result: result === undefined ? null : result });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---------------------------------------------------------------------------
// Mobile implementations of gui.js-owned IPC handlers
// ---------------------------------------------------------------------------
function registerMobileHandlers({ appVersion, repoSlug }) {
  const { ipcMain } = electron;

  ipcMain.handle("get-app-version", () => appVersion);

  // --- "What's new" changelog dialog -------------------------------------
  ipcMain.handle("check-whats-new", async () => {
    try {
      const { getKeyValue } = require("./backend/utils/db");
      const lastSeen = getKeyValue("Settings", "whatsNewSeenVersion");
      const disabled = getKeyValue("Settings", "whatsNewDisabled");
      if (disabled === true || lastSeen === appVersion) return null;

      const changelogPath = path.join(__dirname, "CHANGELOG.md");
      if (!fs.existsSync(changelogPath)) return null;
      const changelog = fs.readFileSync(changelogPath, "utf-8");

      const { setKeyValue } = require("./backend/utils/db");
      setKeyValue("Settings", "whatsNewSeenVersion", appVersion);
      return { version: appVersion, changelog };
    } catch (e) {
      return null;
    }
  });

  ipcMain.handle("disable-whats-new", async () => {
    try {
      const { setKeyValue } = require("./backend/utils/db");
      setKeyValue("Settings", "whatsNewDisabled", true);
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  });

  // --- Updates: check GitHub releases, open the APK in the browser --------
  let latestReleaseCache = null;

  ipcMain.handle("check-for-update", async () => {
    try {
      const res = await fetch(
        `https://api.github.com/repos/${repoSlug}/releases/latest`,
        { headers: { Accept: "application/vnd.github+json" } },
      );
      if (!res.ok) throw new Error(`GitHub API responded ${res.status}`);
      const release = await res.json();
      latestReleaseCache = release;
      const latest = String(release.tag_name || "").replace(/^v/, "");
      const isNewer = compareVersions(latest, appVersion) > 0;
      if (isNewer) {
        broadcast("update-available", {
          version: latest,
          releaseNotes: release.body || "",
          isAndroid: true,
        });
        return { updateAvailable: true, version: latest };
      }
      broadcast("update-not-available");
      return { updateAvailable: false };
    } catch (e) {
      broadcast("update-error", { message: e.message });
      return { updateAvailable: false, error: e.message };
    }
  });

  ipcMain.handle("download-update", async () => {
    // No silent install on Android - open the release APK in the browser.
    const release = latestReleaseCache;
    const apkAsset = release?.assets?.find((a) => a.name?.endsWith(".apk"));
    const url =
      apkAsset?.browser_download_url ||
      release?.html_url ||
      `https://github.com/${repoSlug}/releases/latest`;
    if (typeof global.__sendToNative === "function") {
      global.__sendToNative("open-external", { url });
    }
    return { opened: true };
  });

  ipcMain.handle("install-update", () => {
    return { supported: false };
  });

  // --- Marketplace: desktop opens a second window; mobile pushes an event -
  ipcMain.on("marketplace", (event, AnimeManga) => {
    broadcast("open-marketplace", { type: AnimeManga });
  });

  // --- Cloudflare bypass needs a real browser window - degrade gracefully -
  if (!electron.__ipcHandlers.has("ensure-cf-bypass")) {
    ipcMain.handle("ensure-cf-bypass", async () => {
      return { success: false, reason: "cf-bypass-unavailable-on-android" };
    });
  }
}

function compareVersions(a, b) {
  const pa = String(a).split(".").map(Number);
  const pb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

module.exports = { router, broadcast, fakeWindow, registerMobileHandlers };
