const express = require("express");
const fs = require("fs");
const path = require("path");

const electron = require("./shims/electron");
const {
  getKeyValue,
  setKeyValue,
  queryOne,
  run,
} = require("./backend/utils/db");
const { pipeline } = require("stream/promises");
const got = require("got").default || require("got");

const router = express.Router();

router.get("/api/proxy-headers", (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: "URL is required" });
  try {
    const proxyHeaders = require("./backend/utils/proxyHeaders");
    const headers = proxyHeaders.getHeaders(url);
    res.json(headers || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const sseClients = new Set();
let pendingBypassRequest = null;

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

  if (pendingBypassRequest) {
    const payload = `data: ${JSON.stringify({ channel: "cf-bypass-request", data: pendingBypassRequest })}\n\n`;
    res.write(payload);
  }

  sseClients.add(res);
  const keepAlive = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch (_) {
      //
    }
  }, 25000);
  req.on("close", () => {
    clearInterval(keepAlive);
    sseClients.delete(res);
  });
});

router.post(
  "/api/ipc/:channel",
  express.json({ limit: "5mb" }),
  async (req, res) => {
    const { channel } = req.params;
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    try {
      const result = await electron.__invokeIpcHandler(channel, args);
      res.json({ ok: true, result: result === undefined ? null : result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  },
);

function registerMobileHandlers({ appVersion, repoSlug }) {
  const { ipcMain } = electron;

  ipcMain.handle("get-app-version", () => appVersion);

  ipcMain.handle("check-whats-new", async () => {
    try {
      const lastSeen = getKeyValue("Settings", "whatsNewSeenVersion");
      const disabled = getKeyValue("Settings", "whatsNewDisabled");
      if (disabled === true || lastSeen === appVersion) return null;

      const changelogPath = path.join(__dirname, "CHANGELOG.md");
      if (!fs.existsSync(changelogPath)) return null;
      const changelog = fs.readFileSync(changelogPath, "utf-8");

      setKeyValue("Settings", "whatsNewSeenVersion", appVersion);
      return { version: appVersion, changelog };
    } catch (e) {
      return null;
    }
  });

  ipcMain.handle("disable-whats-new", async () => {
    try {
      setKeyValue("Settings", "whatsNewDisabled", true);
      return { success: true };
    } catch (e) {
      return { success: false };
    }
  });

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

  async function runBackgroundDownload(url, destPath) {
    try {
      const downloadStream = got.stream(url);
      const writeStream = fs.createWriteStream(destPath);
      const startTime = Date.now();

      downloadStream.on("downloadProgress", (progress) => {
        const timeElapsed = (Date.now() - startTime) / 1000;
        const bytesPerSecond =
          timeElapsed > 0 ? progress.transferred / timeElapsed : 0;
        broadcast("update-download-progress", {
          percent: Math.round((progress.percent || 0) * 100),
          transferred: progress.transferred,
          total: progress.total,
          bytesPerSecond: bytesPerSecond,
        });
      });

      await pipeline(downloadStream, writeStream);
      broadcast("update-downloaded");
    } catch (err) {
      console.error("[bridge] update download failed:", err.message);
      broadcast("update-error", { message: err.message });
    }
  }

  ipcMain.handle("download-update", async () => {
    const release = latestReleaseCache;
    const apkAsset = release?.assets?.find((a) => a.name?.endsWith(".apk"));
    const url = apkAsset?.browser_download_url;
    if (!url) {
      return { success: false, error: "No APK asset found in latest release" };
    }

    const tempDir = process.env.STRAWVERSE_TEMP_DIR;
    const destPath = path.join(tempDir, "update.apk");

    runBackgroundDownload(url, destPath);
    return { success: true };
  });

  ipcMain.handle("install-update", () => {
    const tempDir = process.env.STRAWVERSE_TEMP_DIR;
    const destPath = path.join(tempDir, "update.apk");
    broadcast("trigger-install", { path: destPath });
    return { success: true };
  });

  ipcMain.on("marketplace", (event, AnimeManga) => {
    broadcast("open-marketplace", { type: AnimeManga });
  });

  global.sendNativeRequest = (config) => {
    return new Promise((resolve, reject) => {
      const requestId = Math.random().toString(36).substring(7);
      global.pendingRequests.set(requestId, { resolve, reject });

      let body = config.data;
      if (body && typeof body === "object") {
        body = JSON.stringify(body);
      }

      const headers =
        typeof config.headers?.toJSON === "function"
          ? config.headers.toJSON()
          : { ...(config.headers || {}) };

      broadcast("native-request", {
        requestId,
        url: config.url,
        method: config.method || "GET",
        headers,
        body,
      });
    });
  };

  ipcMain.handle("ensure-cf-bypass", async (event, targetUrl) => {
    if (!targetUrl) return { ok: true, success: true };
    const domain = new URL(targetUrl).hostname.replace("www.", "");
    broadcast("cf-bypass-request", { url: targetUrl });
    for (let i = 0; i < 15; i++) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const row = queryOne(
        "SELECT value FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (? = domain OR ? LIKE '%.' || domain)) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
        [`${domain}-cf_clearance`, domain, domain],
      );
      if (row) {
        return { ok: true, success: true };
      }
    }
    return { ok: false, success: false, reason: "timeout" };
  });

  ipcMain.handle(
    "save-cf-cookies",
    async (event, targetUrl, cookieString) => {
      if (!cookieString || !targetUrl) return { ok: false };
      const domain = new URL(targetUrl).hostname.replace("www.", "");
      const pairs = cookieString.split(";");
      let savedClearance = false;

      const expiry = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
      const upsertSql = `
        INSERT INTO cookie (id, value, name, domain, url, path, secure, httpOnly, expirationDate, local_saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          value=excluded.value,
          expirationDate=excluded.expirationDate,
          local_saved_at=excluded.local_saved_at
      `;

      try {
        // Save all cookies
        for (const pair of pairs) {
          const parts = pair.trim().split("=");
          if (parts.length >= 2) {
            const name = parts[0].trim();
            const value = parts.slice(1).join("=").trim();

            run(upsertSql, [
              `${domain}-${name}`,
              value,
              name,
              domain,
              targetUrl,
              "/",
              "true",
              "false",
              expiry,
              Date.now(),
            ]);

            if (name === "cf_clearance") {
              savedClearance = true;
            }
          }
        }

        if (global.clearCookieCache) {
          global.clearCookieCache(domain);
        }
      } catch (e) {
        console.error("[bridge] Failed to save cookies:", e.message);
      }

      return { ok: savedClearance };
    },
  );

  global.pendingRequests = new Map();

  ipcMain.handle(
    "native-response",
    async (event, requestId, success, response, error) => {
      const pending = global.pendingRequests.get(requestId);
      if (pending) {
        global.pendingRequests.delete(requestId);
        if (success) {
          pending.resolve(response);
        } else {
          pending.reject(new Error(error));
        }
      }
      return { ok: true };
    },
  );

  global.cloudflarebypass = async (targetUrl, silent, referer, userAgent) => {
    if (!targetUrl) return;
    const domain = new URL(targetUrl).hostname.replace("www.", "");

    try {
      run(
        "DELETE FROM cookie WHERE id IN (?, ?) OR ((name IN ('cf_clearance', 'cf_user_agent') OR name LIKE 'sec-ch-ua%') AND (? = domain OR ? LIKE '%.' || domain))",
        [`${domain}-cf_clearance`, `${domain}-cf-user-agent`, domain, domain],
      );
      if (global.clearCookieCache) {
        global.clearCookieCache(domain);
      }
    } catch (e) {
      console.error(
        "[bridge] Failed to clear stale cookies from db:",
        e.message,
      );
    }

    pendingBypassRequest = { url: targetUrl, userAgent: userAgent };
    broadcast("cf-bypass-request", pendingBypassRequest);

    try {
      for (let i = 0; i < 20; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const row = queryOne(
          "SELECT value FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (? = domain OR ? LIKE '%.' || domain)) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
          [`${domain}-cf_clearance`, domain, domain],
        );
        if (row?.value) {
          if (global.clearCookieCache) {
            global.clearCookieCache(domain);
          }
          return true;
        }
      }
      throw new Error("Cloudflare bypass timeout");
    } finally {
      pendingBypassRequest = null;
    }
  };
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
