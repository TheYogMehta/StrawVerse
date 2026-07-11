const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");

const PORT = 3459;

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

let channel = null;
let getDataPath = null;
try {
  ({ channel, getDataPath } = require("bridge"));
} catch (_) {
  channel = null;
}

function applyDefaultPaths() {
  let base = null;
  if (getDataPath) {
    try {
      base = getDataPath();
    } catch (_) {}
  }
  if (!base || base === "/" || base === "/data") {
    base = path.resolve(__dirname, "..", "..");
  }

  if (!process.env.STRAWVERSE_DATA_DIR) {
    process.env.STRAWVERSE_DATA_DIR = path.join(base, "userData");
  }
  if (!process.env.STRAWVERSE_DOWNLOADS_DIR) {
    process.env.STRAWVERSE_DOWNLOADS_DIR = path.join(base, "Downloads");
  }
  if (!process.env.STRAWVERSE_TEMP_DIR) {
    process.env.STRAWVERSE_TEMP_DIR = os.tmpdir() || path.join(base, "tmp");
  }
  if (!process.env.STRAWVERSE_APP_VERSION) {
    process.env.STRAWVERSE_APP_VERSION = readOwnVersion();
  }

  const defaultDownloads = path.join(base, "Downloads");
  try {
    fs.mkdirSync(defaultDownloads, { recursive: true });
  } catch (_) {}

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

let booted = false;

async function boot() {
  if (booted) return;
  booted = true;

  applyDefaultPaths();
  process.env.PLATFORM = "android";

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

  global.__sendToNative = (channelName, data) => {
    bridge.broadcast(channelName, data);
    if (channel) channel.send(channelName, data);
  };

  global.win = bridge.fakeWindow;
  global.PORT = PORT;

  const bundledModules = {};
  try {
    const cheerio = require("cheerio");
    bundledModules["cheerio"] = cheerio.default || cheerio;
  } catch (_) {}
  try {
    const axios = require("axios");
    bundledModules["axios"] = axios.default || axios;
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

  require("./backend/utils/db");

  try {
    const axios = require("axios");
    global.axios = axios.create({
      timeout: 20000,
    });
    const { getHeaders } = require("./backend/utils/proxyHeaders");
    global.axios.interceptors.request.use(
      async (config) => {
        const headers = getHeaders(config.url, config.method);
        if (config.headers) {
          if (headers["User-Agent"]) {
            delete config.headers["user-agent"];
            delete config.headers["User-Agent"];
          }
          if (headers["Referer"]) {
            delete config.headers["referer"];
            delete config.headers["Referer"];
          }
          if (headers["Cookie"]) {
            const existingCookie =
              config.headers["cookie"] || config.headers["Cookie"];
            if (existingCookie) {
              const existingCookieClean = existingCookie || "";
              if (!existingCookieClean.includes("cf_clearance=")) {
                headers.Cookie = existingCookieClean + "; " + headers.Cookie;
              } else {
                headers.Cookie = existingCookieClean.replace(
                  /cf_clearance=[^;]+/g,
                  headers.Cookie.trim().replace(/;$/, ""),
                );
              }
            }
          }
        }
        config.headers = {
          ...config.headers,
          ...headers,
        };
        return config;
      },
      (error) => Promise.reject(error),
    );

    global.axios.interceptors.response.use(
      (response) => response,
      async (error) => {
        const { config, response } = error;
        if (
          response &&
          (response.status === 403 || response.status === 503) &&
          config &&
          !config._retry &&
          global?.cloudflarebypass
        ) {
          config._retry = true;
          console.log(
            `[android] Cloudflare challenge (status: ${response.status}) for ${config.url}. Retrying with bypass...`,
          );
          try {
            const referer =
              config.headers?.Referer || config.headers?.referer || "";
            const ua =
              config.headers["User-Agent"] ||
              config.headers["user-agent"] ||
              "";
            await global.cloudflarebypass(config.url, true, referer, ua);
            const newHeaders = getHeaders(config.url, config.method);
            const retryHeaders =
              typeof config.headers?.toJSON === "function"
                ? config.headers.toJSON()
                : { ...(config.headers || {}) };
            for (const key of Object.keys(retryHeaders)) {
              const lowerKey = key.toLowerCase();
              if (lowerKey === "cookie" || lowerKey === "user-agent") {
                delete retryHeaders[key];
              }
            }
            config.headers = {
              ...retryHeaders,
              ...newHeaders,
            };
            return global.axios(config);
          } catch (bypassErr) {
            return Promise.reject(bypassErr);
          }
        }
        return Promise.reject(error);
      },
    );
  } catch (err) {
    logger.error("[android] failed to initialize global.axios: " + err.message);
  }

  const {
    patchModulePaths,
    SettingsLoad,
    settingfetch,
    loadAllScrapers,
  } = require("./backend/utils/settings");

  try {
    await patchModulePaths();
    await SettingsLoad();
    await loadAllScrapers();
    await settingfetch();
  } catch (e) {
    logger.error("[android] settings initialization failed: " + e.message);
  }

  const { registerSharedStateHandlers } = require("./backend/sharedState");
  registerSharedStateHandlers();

  bridge.registerMobileHandlers({
    appVersion: process.env.STRAWVERSE_APP_VERSION,
    repoSlug: process.env.STRAWVERSE_REPO || "TheYogMehta/StrawVerse",
  });

  const express = require("express");
  const appExpress = express();

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

  setTimeout(() => {
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
  }, 10000);
}

boot().catch((e) => {
  console.error("[android] boot failed:", e);
  if (channel) channel.send("boot-error", { message: e.message });
  else process.exit(1);
});
