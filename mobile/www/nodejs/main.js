/**
 * StrawVerse Android entrypoint.
 *
 * This file replaces src/gui.js on mobile. It:
 *   1. Installs module hooks so `electron`, `node:sqlite`, `discord-rpc` and
 *      `ffmpeg-static` resolve to Android-compatible shims.
 *   2. Receives runtime config (data dir, ffmpeg path, app version) from the
 *      native layer through the capacitor-nodejs channel.
 *   3. Boots the shared Express backend (synced from src/backend) on a fixed
 *      localhost port and serves the built React GUI.
 *   4. Signals "ready" back to the native loader page, which then navigates
 *      the WebView to http://localhost:<PORT>.
 */

const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 3459;

// ---------------------------------------------------------------------------
// 1. Module hooks (must run before anything requires backend code)
// ---------------------------------------------------------------------------
const shimMap = {
  electron: path.join(__dirname, "shims", "electron.js"),
  "node:sqlite": path.join(__dirname, "shims", "node-sqlite.js"),
  "discord-rpc": path.join(__dirname, "shims", "discord-rpc.js"),
  "ffmpeg-static": path.join(__dirname, "shims", "ffmpeg-static.js"),
};

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (shimMap[request]) return shimMap[request];
  return originalResolve.call(this, request, ...rest);
};

// ---------------------------------------------------------------------------
// 2. Runtime config
//    The loader page starts the Node runtime via NodeJS.start({ env }) and
//    passes STRAWVERSE_* environment variables (ffmpeg path, app version).
//    Storage paths default to the capacitor-nodejs per-user data directory.
// ---------------------------------------------------------------------------
let channel = null;
let getDataPath = null;
try {
  // Built-in module provided by the capacitor-nodejs runtime.
  ({ channel, getDataPath } = require("bridge"));
} catch (_) {
  channel = null; // running outside the app (local dev / tests)
}

function applyDefaultPaths() {
  const base = getDataPath
    ? getDataPath()
    : path.join(__dirname, "strawverse-data");
  if (!process.env.STRAWVERSE_DATA_DIR) {
    process.env.STRAWVERSE_DATA_DIR = path.join(base, "userData");
  }
  if (!process.env.STRAWVERSE_DOWNLOADS_DIR) {
    process.env.STRAWVERSE_DOWNLOADS_DIR = path.join(base, "Downloads");
  }
  if (!process.env.STRAWVERSE_TEMP_DIR) {
    process.env.STRAWVERSE_TEMP_DIR = getDataPath
      ? os.tmpdir()
      : path.join(base, "tmp");
  }
  if (!process.env.STRAWVERSE_APP_VERSION) {
    process.env.STRAWVERSE_APP_VERSION = readOwnVersion();
  }

  // Ensure the default downloads folder exists on Android.
  // getDownloadsFolder() in the backend returns os.homedir() + "/Downloads",
  // which does not exist on Android. Create it so ensureDirectoryExists()
  // inside settingfetch() won't throw on every call.
  const defaultDownloads = path.join(os.homedir(), "Downloads");
  try {
    fs.mkdirSync(defaultDownloads, { recursive: true });
  } catch (_) {
    // best-effort; if homedir is unwritable, settingfetch will handle it
  }

  // Also create the app data and downloads dirs
  try {
    fs.mkdirSync(process.env.STRAWVERSE_DATA_DIR, { recursive: true });
    fs.mkdirSync(process.env.STRAWVERSE_DOWNLOADS_DIR, { recursive: true });
  } catch (_) {}
}

function readOwnVersion() {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, "package.json"), "utf-8"),
    ).version;
  } catch (_) {
    return "0.0.0";
  }
}

// ---------------------------------------------------------------------------
// 3. Boot
// ---------------------------------------------------------------------------
let booted = false;

async function boot() {
  if (booted) return;
  booted = true;

  applyDefaultPaths();
  process.env.PLATFORM = "android";

  // Pre-initialize sql.js only when better-sqlite3 isn't available, so the
  // synchronous DatabaseSync constructor in the shim can use it.
  try {
    require.resolve("better-sqlite3");
  } catch (_) {
    const initSqlJs = require("sql.js");
    global.__sqljs = await initSqlJs({
      locateFile: (file) => path.join(__dirname, file),
    });
  }

  const electron = require("./shims/electron");
  const bridge = require("./bridge");

  // Native message sink used by the electron shim (open-external etc.).
  // Delivered to the GUI as SSE events; the WebView opens external URLs
  // natively via shouldOverrideUrlLoading.
  global.__sendToNative = (channelName, data) => {
    bridge.broadcast(channelName, data);
    if (channel) channel.send(channelName, data);
  };

  // Backend modules use global.win.webContents.send for push notifications.
  global.win = bridge.fakeWindow;
  global.PORT = PORT;

  // -------------------------------------------------------------------------
  // Expose bundled modules to dynamically loaded scrapers.
  // Scrapers are downloaded at runtime and do require("cheerio") etc.
  // After bundling, node_modules is deleted, so we intercept these requires
  // and serve the bundled versions instead.
  // -------------------------------------------------------------------------
  const bundledModules = {};
  try {
    bundledModules["cheerio"] = require("cheerio");
  } catch (_) {}
  try {
    bundledModules["axios"] = require("axios");
  } catch (_) {}

  if (Object.keys(bundledModules).length > 0) {
    const origLoad = Module._load;
    Module._load = function (request, parent, isMain) {
      if (bundledModules[request]) return bundledModules[request];
      return origLoad.call(this, request, parent, isMain);
    };
  }

  const { logger } = require("./backend/utils/AppLogger");
  logger.info(
    `[android] Booting StrawVerse backend (sqlite backend: ${
      require("./shims/node-sqlite").__backend
    })`,
  );

  // Order mirrors src/gui.js: DB first, then settings/providers, then routes.
  require("./backend/utils/db");
  const { settingfetch } = require("./backend/utils/settings");
  try {
    await settingfetch();
  } catch (e) {
    logger.error("[android] settingfetch failed (first boot?): " + e.message);
  }

  const { registerSharedStateHandlers } = require("./backend/sharedState");
  registerSharedStateHandlers();

  bridge.registerMobileHandlers({
    appVersion: process.env.STRAWVERSE_APP_VERSION,
    repoSlug: process.env.STRAWVERSE_REPO || "TheYogMehta/StrawVerse",
  });

  const express = require("express");
  const appExpress = express();

  // CORS: the WebView loads from http://localhost but Express listens on
  // http://localhost:3459 — different port = cross-origin.
  appExpress.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header(
      "Access-Control-Allow-Methods",
      "GET,POST,PUT,DELETE,PATCH,OPTIONS",
    );
    res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    if (_req.method === "OPTIONS") return res.sendStatus(204);
    next();
  });

  appExpress.use(express.urlencoded({ extended: true }));
  appExpress.use(express.json());
  appExpress.use(bridge.router);
  appExpress.get("/health", (_req, res) => res.json({ ok: true }));
  appExpress.use(express.static(path.join(__dirname, "gui", "dist")));

  const routes = require("./backend/routes");
  appExpress.use(routes);

  appExpress.listen(PORT, "127.0.0.1", () => {
    logger.info(`[android] Express listening on http://127.0.0.1:${PORT}`);
    if (channel) channel.send("server-ready", { port: PORT });
  });

  // Background maintenance mirrors desktop startup (fire-and-forget).
  try {
    const {
      checkForMappingUpdates,
    } = require("./backend/utils/mappingUpdater");
    checkForMappingUpdates().catch((e) =>
      logger.error("[android] mapping update failed: " + e.message),
    );
  } catch (e) {
    logger.error("[android] mapping updater unavailable: " + e.message);
  }
}

// ---------------------------------------------------------------------------
// 4. Boot immediately. Runtime config (ffmpeg path, app version, storage
//    overrides) arrives via env vars set by NodeJS.start({ env }) in the
//    native loader, so there is nothing to wait for.
// ---------------------------------------------------------------------------
boot().catch((e) => {
  console.error("[android] boot failed:", e);
  if (channel) channel.send("boot-error", { message: e.message });
  else process.exit(1);
});
