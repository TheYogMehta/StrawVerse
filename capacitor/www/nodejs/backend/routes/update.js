const express = require("express");
const path = require("path");
const fs = require("fs");
const axios = require("axios");
const { logger } = require("../utils/AppLogger");
const { sendToRenderer } = require("../utils/rendererIPC");

const router = express.Router();

let cachedUpdateInfo = null;
let isDownloading = false;
let downloadedApkPath = null;

// Semver compare helper: returns true if latest > current
function isNewerVersion(currentVersion, latestVersion) {
  if (!latestVersion) return false;
  const cleanCurr = (currentVersion || "0.0.0").replace(/^v/i, "").trim();
  const cleanLatest = latestVersion.replace(/^v/i, "").trim();

  const cParts = cleanCurr.split(".").map((n) => parseInt(n, 10) || 0);
  const lParts = cleanLatest.split(".").map((n) => parseInt(n, 10) || 0);

  const maxLen = Math.max(cParts.length, lParts.length);
  for (let i = 0; i < maxLen; i++) {
    const c = cParts[i] || 0;
    const l = lParts[i] || 0;
    if (l > c) return true;
    if (l < c) return false;
  }
  return false;
}

// Get current app version
function getCurrentAppVersion() {
  try {
    const pkgPath = path.join(__dirname, "..", "..", "package.json");
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
      if (pkg.version) return pkg.version;
    }
  } catch (_) {}
  return process.env.STRAWVERSE_APP_VERSION || "9.1.2";
}

// Helper to get /Strawverse/apk target directory
function getApkStorageDir() {
  let targetDir = "/storage/emulated/0/Strawverse/apk";
  if (!fs.existsSync(targetDir)) {
    try {
      fs.mkdirSync(targetDir, { recursive: true });
    } catch (_) {
      targetDir = path.join(process.cwd(), "apk");
      fs.mkdirSync(targetDir, { recursive: true });
    }
  }
  return targetDir;
}

// Clean up older or same version APK files from /Strawverse/apk directory
function cleanupOldApks(currentVersion) {
  try {
    const dir = getApkStorageDir();
    if (!fs.existsSync(dir)) return;

    const files = fs.readdirSync(dir);
    for (const file of files) {
      if (!file.endsWith(".apk")) continue;
      const filePath = path.join(dir, file);

      const match = file.match(/v?(\d+\.\d+(?:\.\d+)?)/i);
      if (match && match[1]) {
        const fileVersion = match[1];
        if (!isNewerVersion(currentVersion, fileVersion)) {
          logger.info(
            `[AutoUpdater] Cleaning up old/matching APK: ${file} (file v${fileVersion} <= installed v${currentVersion})`,
          );
          fs.unlinkSync(filePath);
        }
      } else {
        if (!cachedUpdateInfo?.updateAvailable && !isDownloading) {
          logger.info(`[AutoUpdater] Cleaning up obsolete APK file: ${file}`);
          fs.unlinkSync(filePath);
        }
      }
    }
  } catch (err) {
    logger.warn(`[AutoUpdater] Cleanup old APKs failed: ${err.message}`);
  }
}

// Check for updates via GitHub API
async function checkForUpdateLogic() {
  const currentVersion = getCurrentAppVersion();
  logger.info(
    `[AutoUpdater] Checking for updates... Current version: ${currentVersion}`,
  );

  cleanupOldApks(currentVersion);

  try {
    const response = await axios.get(
      "https://api.github.com/repos/TheYogMehta/StrawVerse/releases/latest",
      {
        headers: {
          "User-Agent": `StrawVerse-Android/${currentVersion}`,
          Accept: "application/vnd.github.v3+json",
        },
        timeout: 15000,
      },
    );

    const data = response.data;
    const latestVersion = (data.tag_name || "").replace(/^v/i, "").trim();
    const assets = data.assets || [];

    // Find APK asset
    const apkAsset =
      assets.find((a) => a.name && a.name.endsWith(".apk")) ||
      assets.find(
        (a) =>
          a.browser_download_url && a.browser_download_url.endsWith(".apk"),
      );

    const updateAvailable = isNewerVersion(currentVersion, latestVersion);

    cachedUpdateInfo = {
      updateAvailable,
      latestVersion,
      currentVersion,
      downloadUrl: apkAsset ? apkAsset.browser_download_url : null,
      releaseNotes: data.body || "",
      releaseUrl: data.html_url || "",
      apkName: apkAsset ? apkAsset.name : `StrawVerse_v${latestVersion}.apk`,
    };

    if (!updateAvailable) {
      cleanupOldApks(currentVersion);
    }

    if (updateAvailable && apkAsset) {
      logger.info(`[AutoUpdater] New update available: ${latestVersion}`);
      sendToRenderer("update-available", {
        version: latestVersion,
        releaseNotes: cachedUpdateInfo.releaseNotes,
        releaseUrl: cachedUpdateInfo.releaseUrl,
        downloadUrl: cachedUpdateInfo.downloadUrl,
        apkName: cachedUpdateInfo.apkName,
      });
      return { success: true, version: latestVersion, updateAvailable: true };
    } else {
      logger.info("[AutoUpdater] App is up to date.");
      sendToRenderer("update-not-available");
      return {
        success: true,
        version: currentVersion,
        updateAvailable: false,
      };
    }
  } catch (err) {
    logger.error(`[AutoUpdater] Check failed: ${err.message}`);
    sendToRenderer("update-error", { message: err.message });
    return { success: false, error: err.message };
  }
}

// GET /api/update/check
router.get("/api/update/check", async (req, res) => {
  try {
    const result = await checkForUpdateLogic();
    res.json({ ok: true, result });
  } catch (err) {
    res.json({ ok: true, result: { success: false, error: err.message } });
  }
});

// POST /api/update/download
router.post("/api/update/download", async (req, res) => {
  if (!cachedUpdateInfo || !cachedUpdateInfo.downloadUrl) {
    const checkRes = await checkForUpdateLogic();
    if (!checkRes.success || !cachedUpdateInfo?.downloadUrl) {
      const errStr = "No update download URL available.";
      sendToRenderer("update-error", { message: errStr });
      return res.json({ ok: true, result: { success: false, error: errStr } });
    }
  }

  if (isDownloading) {
    return res.json({
      ok: true,
      result: { success: true, message: "Download already in progress" },
    });
  }

  isDownloading = true;
  const downloadUrl = cachedUpdateInfo.downloadUrl;
  logger.info(`[AutoUpdater] Starting download from: ${downloadUrl}`);

  try {
    const targetDir = getApkStorageDir();
    const apkFileName = cachedUpdateInfo.apkName || "StrawVerse.apk";
    const apkPath = path.join(targetDir, apkFileName);
    const writer = fs.createWriteStream(apkPath);

    const response = await axios({
      url: downloadUrl,
      method: "GET",
      responseType: "stream",
      headers: {
        "User-Agent": `StrawVerse-Android/${cachedUpdateInfo.currentVersion}`,
      },
      timeout: 60000,
    });

    const totalBytes = parseInt(response.headers["content-length"], 10) || 0;
    let transferredBytes = 0;
    let lastTime = Date.now();
    let lastBytes = 0;
    let lastEmitTime = 0;

    response.data.on("data", (chunk) => {
      transferredBytes += chunk.length;
      const now = Date.now();
      const timeDiff = (now - lastTime) / 1000;

      if (now - lastEmitTime > 300) {
        lastEmitTime = now;
        const bytesPerSecond =
          timeDiff > 0 ? (transferredBytes - lastBytes) / timeDiff : 0;
        const percent =
          totalBytes > 0 ? (transferredBytes / totalBytes) * 100 : 0;

        lastTime = now;
        lastBytes = transferredBytes;

        sendToRenderer("update-download-progress", {
          percent: Math.min(100, Math.max(0, percent)),
          bytesPerSecond,
          transferred: transferredBytes,
          total: totalBytes,
          apkName: apkFileName,
          version: cachedUpdateInfo.latestVersion,
        });
      }
    });

    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
      response.data.on("error", reject);
    });

    downloadedApkPath = apkPath;
    isDownloading = false;
    logger.info(`[AutoUpdater] APK successfully downloaded to: ${apkPath}`);

    sendToRenderer("update-download-progress", {
      percent: 100,
      bytesPerSecond: 0,
      transferred: totalBytes || transferredBytes,
      total: totalBytes || transferredBytes,
      apkName: apkFileName,
      version: cachedUpdateInfo.latestVersion,
    });

    sendToRenderer("update-downloaded", {
      path: apkPath,
      version: cachedUpdateInfo.latestVersion,
      apkName: apkFileName,
    });

    res.json({ ok: true, result: { success: true, path: apkPath } });
  } catch (err) {
    isDownloading = false;
    logger.error(`[AutoUpdater] Download failed: ${err.message}`);
    sendToRenderer("update-error", { message: err.message });
    res.json({ ok: true, result: { success: false, error: err.message } });
  }
});

// POST /api/update/install
router.post("/api/update/install", (req, res) => {
  let apkPath = req.body?.args?.[0] || req.body?.path || downloadedApkPath;

  if (!apkPath || !fs.existsSync(apkPath)) {
    const dir = getApkStorageDir();
    const defaultApk = path.join(dir, "update.apk");
    if (fs.existsSync(defaultApk)) {
      apkPath = defaultApk;
    } else if (fs.existsSync(dir)) {
      const apks = fs.readdirSync(dir).filter((f) => f.endsWith(".apk"));
      if (apks.length > 0) {
        apkPath = path.join(dir, apks[0]);
      }
    }
  }

  if (!apkPath || !fs.existsSync(apkPath)) {
    const errStr = `APK file not found at path: ${apkPath}`;
    logger.error(`[AutoUpdater] Install error: ${errStr}`);
    sendToRenderer("update-error", { message: errStr });
    return res.json({ ok: true, result: { success: false, error: errStr } });
  }

  logger.info(
    `[AutoUpdater] Triggering native package installer for: ${apkPath}`,
  );
  sendToRenderer("trigger-install", { path: apkPath });
  res.json({ ok: true, result: { success: true, path: apkPath } });
});

// Auto check trigger on startup (delay 10s)
setTimeout(() => {
  checkForUpdateLogic().catch((err) => {
    logger.warn(`[AutoUpdater] Startup check ignored: ${err.message}`);
  });
}, 10000);

module.exports = router;
