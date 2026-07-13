if (!process.env.NODEJS_MOBILE_DATA_DIR && process.env.DATADIR) {
  process.env.NODEJS_MOBILE_DATA_DIR = process.env.DATADIR;
}

if (typeof global.File === "undefined") {
  const { Blob } = require("buffer");
  global.File = class File extends Blob {
    constructor(parts, filename, options = {}) {
      super(parts, options);
      this.name = filename;
      this.lastModified = options.lastModified || Date.now();
    }
  };
}

const Module = require("module");
const path = require("path");
const fs = require("fs");
const os = require("os");
os.homedir = () => "/data/data/app.strawverse.android/files";
const cheerio = require("cheerio");
const axios = require("axios");
const got = require("got");
const PORT = 3459;

const sseClients = new Set();
let pendingBypassRequest = null;
const activeBypasses = new Map();
let PageHistory = [];
global.pendingRequests = new Map();

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

function normalizeHostname(value) {
  if (!value) return "";
  return value.startsWith("www.") ? value.slice(4) : value;
}

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "cheerio" || request === "axios" || request === "got") {
    return request;
  }
  return originalResolve.call(this, request, ...rest);
};

const originalLoad = Module._load;
Module._load = function (request, ...rest) {
  if (request === "cheerio") return cheerio;
  if (request === "axios") return axios;
  if (request === "got") return got;
  return originalLoad.call(this, request, ...rest);
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

  global.__sendToNative = (channelName, data) => {
    broadcast(channelName, data);
    if (channel) channel.send(channelName, data);
  };

  global.win = fakeWindow;
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
    "[android] Booting StrawVerse backend (sqlite backend: native Java bridge)",
  );

  const { initDatabase, run } = require("./backend/utils/db");
  await initDatabase();
  logger.info("[android] Database initialized via Java bridge");

  try {
    await run(
      "DELETE FROM cookie WHERE name = 'user_agent' OR name = 'client_hints'",
    );
    logger.info(
      "[android] Cleared stale User-Agent and Client Hints from database",
    );
  } catch (dbCleanupErr) {
    logger.error(
      "[android] Failed to clear stale cookies on startup: " +
        dbCleanupErr.message,
    );
  }

  try {
    const axios = require("axios");
    // axios v1 exposes defaults.adapter as a list of adapter names, not a
    // callable function. Resolve it to a real adapter function so we can
    // invoke it directly for requests that bypass the native bridge.
    const defaultAdapter =
      typeof axios.getAdapter === "function"
        ? axios.getAdapter(axios.defaults.adapter)
        : axios.defaults.adapter;

    global.pendingRequests = new Map();
    let nativeRequestCounter = 0;
    const cancellationError = () => {
      const error = new Error(
        "Native request cancelled because the active view changed",
      );
      error.code = "NATIVE_REQUEST_CANCELLED";
      return error;
    };

    global.cancelNativeRequests = () => {
      const error = cancellationError();
      const activeIds = Array.from(global.pendingRequests.keys());
      if (activeIds.length > 0) {
        broadcast("native-cancel", { requestIds: activeIds });
      }
      for (const requestId of activeIds) {
        global.pendingRequests.get(requestId)?.reject(error);
      }
      return activeIds.length;
    };

    global.sendNativeRequest = (config) =>
      new Promise((resolve, reject) => {
        const requestId = ++nativeRequestCounter;
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          global.pendingRequests.delete(requestId);
          callback(value);
        };
        const timeout = setTimeout(() => {
          broadcast("native-cancel", { requestIds: [requestId] });
          finish(reject, new Error(`Native request timeout for ${config.url}`));
        }, 30000);

        global.pendingRequests.set(requestId, {
          resolve: (response) => finish(resolve, response),
          reject: (error) => finish(reject, error),
        });

        broadcast("native-request", {
          requestId,
          url: config.url,
          method: config.method || "GET",
          headers: config.headers || {},
          body: config.data || null,
        });
      });

    const nativeAxiosAdapter = async (config) => {
      // Requests flagged with strawverseDirectHttp (e.g. image proxy fetches
      // for CDN thumbnails) must NOT be routed through the WebView native
      // bridge - fetch them directly from the Node runtime instead. This
      // avoids clogging the bridge with binary payloads and the 30s
      // timeout/retry loop that breaks image loading on paginated lists.
      if (config.strawverseDirectHttp === true) {
        return defaultAdapter(config);
      }
      if (global.sendNativeRequest) {
        try {
          const res = await global.sendNativeRequest(config);

          const parsedHeaders = {};
          if (res.headers) {
            for (const [key, val] of Object.entries(res.headers)) {
              parsedHeaders[key.toLowerCase()] = val;
            }
          }

          let responseData = res.data;
          if (res.isBase64) {
            const buf = Buffer.from(responseData, "base64");
            if (config.responseType === "arraybuffer") {
              responseData = buf;
            } else {
              responseData = buf.toString("utf-8");
              if (typeof responseData === "string") {
                try {
                  responseData = JSON.parse(responseData);
                } catch (e) {}
              }
            }
          } else if (typeof responseData === "string") {
            try {
              responseData = JSON.parse(responseData);
            } catch (e) {}
          }

          const axiosResponse = {
            data: responseData,
            status: res.status,
            statusText: "",
            headers: parsedHeaders,
            config: config,
            request: {},
          };

          if (res.status >= 200 && res.status < 300) {
            return axiosResponse;
          } else {
            const error = new Error(
              `Request failed with status code ${res.status}`,
            );
            error.response = axiosResponse;
            error.config = config;
            throw error;
          }
        } catch (err) {
          const isBridgeTimeout = String(err?.message || "").startsWith(
            "Native request timeout",
          );
          const method = String(config.method || "GET").toUpperCase();
          if (isBridgeTimeout && method === "GET" && !config._nativeRetry) {
            config._nativeRetry = true;
            return nativeAxiosAdapter(config);
          }
          throw err;
        }
      }
      return defaultAdapter(config);
    };

    global.axios = axios.create({
      timeout: 20000,
      adapter: nativeAxiosAdapter,
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
          console.log(
            `[android] Initial request headers:`,
            JSON.stringify(config.headers || {}),
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
            console.log(
              `[android] Freshly fetched bypass headers:`,
              JSON.stringify(newHeaders),
            );
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
            console.log(
              `[android] Final retry request headers:`,
              JSON.stringify(config.headers),
            );
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

  const { queryOne, run: dbRun } = require("./backend/utils/db");

  global.cloudflarebypass = async (targetUrl, silent, referer, userAgent) => {
    if (!targetUrl) return;
    const domain = normalizeHostname(new URL(targetUrl).hostname).toLowerCase();
    if (activeBypasses.has(domain)) return activeBypasses.get(domain);

    const bypassPromise = (async () => {
      try {
        await dbRun(
          "DELETE FROM cookie WHERE id IN (?, ?) OR ((name IN ('cf_clearance', 'cf_user_agent') OR name LIKE 'sec-ch-ua%') AND (LTRIM(?, '.') = LTRIM(domain, '.') OR LTRIM(?, '.') LIKE '%.' || LTRIM(domain, '.')))",
          [`${domain}-cf_clearance`, `${domain}-cf-user-agent`, domain, domain],
        );
        if (global.clearCookieCache) global.clearCookieCache(domain);
      } catch (e) {
        console.error("[main] Failed to clear stale cookies:", e.message);
      }

      const request = { url: targetUrl, userAgent, referer };
      pendingBypassRequest = request;
      broadcast("cf-bypass-request", request);

      try {
        for (let i = 0; i < 120; i++) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          const row = await queryOne(
            "SELECT value FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (LTRIM(?, '.') = LTRIM(domain, '.') OR LTRIM(?, '.') LIKE '%.' || LTRIM(domain, '.'))) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
            [`${domain}-cf_clearance`, domain, domain],
          );
          if (row?.value) {
            if (global.clearCookieCache) global.clearCookieCache(domain);
            return true;
          }
        }
        throw new Error("Cloudflare bypass timeout");
      } finally {
        if (pendingBypassRequest === request) pendingBypassRequest = null;
      }
    })();

    activeBypasses.set(domain, bypassPromise);
    try {
      return await bypassPromise;
    } finally {
      if (activeBypasses.get(domain) === bypassPromise)
        activeBypasses.delete(domain);
    }
  };

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

  appExpress.use(express.urlencoded({ limit: "50mb", extended: true }));
  appExpress.use(express.json({ limit: "50mb" }));
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

  router.get("/api/ipc/events", (req, res) => {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });
    res.write(": connected\n\n");

    if (pendingBypassRequest) {
      res.write(
        `data: ${JSON.stringify({ channel: "cf-bypass-request", data: pendingBypassRequest })}\n\n`,
      );
    }

    sseClients.add(res);
    const keepAlive = setInterval(() => {
      try {
        res.write(": ping\n\n");
      } catch (_) {}
    }, 25000);

    req.on("close", () => {
      clearInterval(keepAlive);
      sseClients.delete(res);
    });
  });

  router.get("/api/version", (req, res) => {
    res.json({
      ok: true,
      result: process.env.STRAWVERSE_APP_VERSION || "1.0.0",
    });
  });

  router.get("/api/state/history", (req, res) => {
    res.json({ ok: true, result: PageHistory });
  });

  router.post("/api/state/history", (req, res) => {
    PageHistory = req.body.args?.[0] || [];
    res.json({ ok: true, result: PageHistory });
  });

  router.post("/api/extensions", async (req, res) => {
    try {
      const [TaskType, AnimeManga, ExtentionName] = req.body.args || [];
      const { HandleExtensions } = require("./backend/utils/settings");
      const result = await HandleExtensions(
        TaskType,
        AnimeManga,
        ExtentionName,
      );
      res.json({ ok: true, result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.get("/api/whats-new", async (req, res) => {
    try {
      const appVersion = process.env.STRAWVERSE_APP_VERSION || "1.0.0";
      const { getKeyValue, setKeyValue } = require("./backend/utils/db");
      const lastSeen = await getKeyValue("Settings", "whatsNewSeenVersion");
      const disabled = await getKeyValue("Settings", "whatsNewDisabled");
      if (disabled === true || lastSeen === appVersion) {
        return res.json({ ok: true, result: null });
      }

      const changelogPath = path.join(__dirname, "CHANGELOG.md");
      if (!fs.existsSync(changelogPath)) {
        return res.json({ ok: true, result: null });
      }
      const changelog = fs.readFileSync(changelogPath, "utf-8");

      await setKeyValue("Settings", "whatsNewSeenVersion", appVersion);
      res.json({ ok: true, result: { version: appVersion, changelog } });
    } catch (e) {
      res.json({ ok: true, result: null });
    }
  });

  router.post("/api/whats-new/disable", async (req, res) => {
    try {
      const { setKeyValue } = require("./backend/utils/db");
      await setKeyValue("Settings", "whatsNewDisabled", true);
      res.json({ ok: true, result: { success: true } });
    } catch (e) {
      res.json({ ok: true, result: { success: false } });
    }
  });

  router.get("/api/update/check", (req, res) =>
    res.json({ ok: true, result: null }),
  );
  router.post("/api/update/download", (req, res) =>
    res.json({ ok: true, result: null }),
  );
  router.post("/api/update/install", (req, res) =>
    res.json({ ok: true, result: null }),
  );

  router.post("/api/device/user-agent", (req, res) => {
    let ua = req.body.args?.[0];
    if (ua) {
      ua = ua
        .replace(/\s*;?\s*wv\b/gi, "")
        .replace(/Version\/[0-9.]+\s+/gi, "");
    }
    global.deviceUserAgent = ua;
    res.json({ ok: true, result: { ok: true } });
  });

  router.post("/api/cf-bypass", async (req, res) => {
    try {
      const [targetUrl, referer, userAgent] = req.body.args || [];
      if (!targetUrl)
        return res.json({ ok: true, result: { ok: true, success: true } });
      const domain = normalizeHostname(
        new URL(targetUrl).hostname,
      ).toLowerCase();
      broadcast("cf-bypass-request", { url: targetUrl, referer, userAgent });

      for (let i = 0; i < 15; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        const row = await queryOne(
          "SELECT value, expirationDate, local_saved_at FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (LTRIM(?, '.') = LTRIM(domain, '.') OR LTRIM(?, '.') LIKE '%.' || LTRIM(domain, '.'))) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
          [`${domain}-cf_clearance`, domain, domain],
        );
        const now = Date.now();
        const isCurrent =
          row?.value &&
          (Number(row.expirationDate) > now ||
            (Number(row.local_saved_at) > 0 &&
              now - Number(row.local_saved_at) < 2 * 60 * 60 * 1000));
        if (isCurrent) {
          return res.json({ ok: true, result: { ok: true, success: true } });
        }
      }
      res.json({
        ok: true,
        result: { ok: false, success: false, reason: "timeout" },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/api/cf-bypass/save", async (req, res) => {
    try {
      const [targetUrl, cookieString, userAgent, clientHints] =
        req.body.args || [];
      if (!cookieString || !targetUrl)
        return res.json({ ok: true, result: { ok: false } });
      const domain = normalizeHostname(
        new URL(targetUrl).hostname,
      ).toLowerCase();
      const pairs = cookieString.split(";");
      let savedClearance = false;

      const expiry = Date.now() + 1000 * 60 * 60 * 24 * 30; // 30 days
      const upsertSql = `
        INSERT INTO cookie (id, value, name, domain, url, path, secure, httpOnly, expirationDate, local_saved_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          value = excluded.value,
          expirationDate = excluded.expirationDate,
          local_saved_at = excluded.local_saved_at
      `;

      for (const pair of pairs) {
        const idx = pair.indexOf("=");
        if (idx === -1) continue;
        const name = pair.substring(0, idx).trim();
        const value = pair.substring(idx + 1).trim();

        if (name === "cf_clearance") {
          await dbRun(upsertSql, [
            `${domain}-cf_clearance`,
            value,
            name,
            domain,
            targetUrl,
            "/",
            1,
            1,
            expiry.toString(),
            Date.now().toString(),
          ]);
          savedClearance = true;
        }
        if (name === "cf_user_agent" || name === "user_agent") {
          await dbRun(upsertSql, [
            `${domain}-cf_user_agent`,
            value,
            "user_agent",
            domain,
            targetUrl,
            "/",
            1,
            1,
            expiry.toString(),
            Date.now().toString(),
          ]);
        }
        if (name.startsWith("sec-ch-ua")) {
          await dbRun(upsertSql, [
            `${domain}-${name}`,
            value,
            name,
            domain,
            targetUrl,
            "/",
            1,
            1,
            expiry.toString(),
            Date.now().toString(),
          ]);
        }
      }

      if (userAgent) {
        await dbRun(upsertSql, [
          `${domain}-user_agent`,
          userAgent,
          "user_agent",
          domain,
          targetUrl,
          "/",
          1,
          1,
          expiry.toString(),
          Date.now().toString(),
        ]);
      }

      if (clientHints) {
        await dbRun(upsertSql, [
          `${domain}-client_hints`,
          typeof clientHints === "string"
            ? clientHints
            : JSON.stringify(clientHints),
          "client_hints",
          domain,
          targetUrl,
          "/",
          1,
          1,
          expiry.toString(),
          Date.now().toString(),
        ]);
      }

      res.json({ ok: true, result: { ok: savedClearance } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/api/settings/get", async (req, res) => {
    try {
      const [keys] = req.body.args || [];
      const {
        settingfetch,
        getScraperIconsPath,
      } = require("./backend/utils/settings");
      const { MalCreateUrl } = require("./backend/utils/mal");

      const setting = await settingfetch();
      let settingsObj = {};

      const getProviders = () => ({
        Anime: global.Anime_providers
          ? Object.keys(global.Anime_providers)
          : [],
        Manga: global.Manga_providers
          ? Object.keys(global.Manga_providers)
          : [],
      });

      const getIconUrl = (name, valScraper) => {
        if (valScraper?.logo) return valScraper.logo;
        const iconsDir = getScraperIconsPath();
        if (iconsDir) {
          const iconPath = require("path").join(iconsDir, `${name}.ico`);
          if (require("fs").existsSync(iconPath)) {
            return `/api/image?url=${encodeURIComponent(`file://${iconPath}`)}`;
          }
        }
        return null;
      };

      const getInstalledExtensions = () => ({
        Anime: global.Anime_providers
          ? Object.entries(global.Anime_providers).map(([key, val]) => ({
              name: key,
              version: val.version || "1.0.0",
              icon: getIconUrl(key, val),
            }))
          : [],
        Manga: global.Manga_providers
          ? Object.entries(global.Manga_providers).map(([key, val]) => ({
              name: key,
              version: val.version || "1.0.0",
              icon: getIconUrl(key, val),
            }))
          : [],
      });

      if (Array.isArray(keys)) {
        for (const k of keys) {
          if (k === "malUsername") {
            settingsObj[k] = setting?.malUsername || global.malUsername || null;
          } else if (k === "providers") {
            settingsObj[k] = getProviders();
          } else if (k === "installedExtensions") {
            settingsObj[k] = getInstalledExtensions();
          } else {
            settingsObj[k] = setting[k];
          }
        }
      } else {
        settingsObj = {
          ...setting,
          providers: getProviders(),
          installedExtensions: getInstalledExtensions(),
        };
      }

      let url = null;
      if (
        !Array.isArray(keys) &&
        (!setting.mal_on_off || setting.mal_on_off === null)
      ) {
        url = await MalCreateUrl();
      }

      res.json({
        ok: true,
        result: {
          settings: settingsObj,
          url: url,
          MalLoggedIn: global.MalLoggedIn || false,
          malUsername: setting?.malUsername || global.malUsername || null,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/api/settings/update", async (req, res) => {
    try {
      const [key, value] = req.body.args || [];
      const { settingupdate } = require("./backend/utils/settings");
      await settingupdate({ [key]: value });
      res.json({ ok: true, result: { success: true } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/api/settings/update-multiple", async (req, res) => {
    try {
      const [settingsObj] = req.body.args || [];
      const { settingupdate } = require("./backend/utils/settings");
      await settingupdate(settingsObj);
      res.json({ ok: true, result: { success: true } });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  router.post("/api/ipc/native-response", (req, res) => {
    const [requestId, success, response, error] = req.body.args || [];
    const pending = global.pendingRequests.get(requestId);
    if (pending) {
      if (success) {
        pending.resolve(response);
      } else {
        pending.reject(new Error(error));
      }
    }
    res.json({ ok: true, result: { ok: true } });
  });

  router.post("/api/ipc/native-cancel", (_req, res) => {
    const cancelled = global.cancelNativeRequests?.() || 0;
    res.json({ ok: true, result: { cancelled } });
  });

  router.get("/api/update/health", (req, res) =>
    res.json({ ok: true, result: { ok: true } }),
  );

  appExpress.use(router);
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
