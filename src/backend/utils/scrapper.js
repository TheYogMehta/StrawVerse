const { app, BrowserWindow } = require("electron");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const {
  getHeaders,
  shouldAllowScrapingRequest,
  getBypassCheck,
} = require("./proxyHeaders");
const { run, queryAll, queryOne } = require("./db");

let isQuitting = false;
let activeBypasses = {};
let bypassQueue = [];
let bypassBusy = false;

app.on("before-quit", () => {
  isQuitting = true;
});

// Create Scrapping Window
function createScrapperWindow() {
  global.ScrapperWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: "persist:scrapper",
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  const defaultUA = global.ScrapperWindow.webContents.userAgent;
  global.userAgent = defaultUA
    .replace(/Electron\/[\d\.]+ /g, "")
    .replace(/strawverse\/[\d\.]+ /g, "");
  global.ScrapperWindow.webContents.userAgent = global.userAgent;

  global.ScrapperWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (global.IsBypassingCloudflare) {
        callback({ cancel: false });
        return;
      }
      if (
        !details.url.startsWith("http://") &&
        !details.url.startsWith("https://")
      ) {
        callback({ cancel: false });
        return;
      }
      if (details.url.includes(".m3u8") && !details.url.includes("ping.gif")) {
        global.LastM3u8 = details.url;
      }
      if (shouldAllowScrapingRequest(details.url, details.resourceType)) {
        callback({ cancel: false });
      } else {
        callback({ cancel: true });
      }
    },
  );

  global.ScrapperWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (details.requestHeaders["User-Agent"]) {
        details.requestHeaders["User-Agent"] = details.requestHeaders[
          "User-Agent"
        ]
          .replace(/Electron\/[\d\.]+ /g, "")
          .replace(/strawverse\/[\d\.]+ /g, "");
      }
      if (details.requestHeaders["sec-ch-ua"]) {
        details.requestHeaders["sec-ch-ua"] = details.requestHeaders[
          "sec-ch-ua"
        ]
          .replace(/"Electron";v="[\d\.]+",?/g, "")
          .replace(/,?\s*"Electron";v="[\d\.]+"/g, "");
      }

      const { Referer: referer, "User-Agent": userAgent } = getHeaders(
        details.url,
      );
      if (referer) details.requestHeaders["Referer"] = referer;
      if (userAgent) details.requestHeaders["User-Agent"] = userAgent;
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  global.ScrapperWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `Failed to load ${validatedURL}: ${errorCode} - ${errorDescription}`,
      );
    },
  );

  global.ScrapperWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      global.ScrapperWindow.hide();
    }
  });

  global.ScrapperWindow.on("closed", () => {
    global.ScrapperWindow = null;
  });
}

async function processBypassQueue() {
  if (bypassBusy || bypassQueue.length === 0) return;
  bypassBusy = true;
  const { runBypass, resolve, reject } = bypassQueue.shift();
  try {
    const result = await runBypass();
    resolve(result);
  } catch (err) {
    reject(err);
  } finally {
    bypassBusy = false;
    processBypassQueue();
  }
}

function queueBypass(runBypass) {
  return new Promise((resolve, reject) => {
    bypassQueue.push({ runBypass, resolve, reject });
    processBypassQueue();
  });
}

global.cloudflarebypass = async (targetUrl, successCheckFn, force = false) => {
  if (!global.ScrapperWindow) {
    throw new Error("Global ScrapperWindow is not initialized");
  }

  const win = global.ScrapperWindow;
  const domain = new URL(targetUrl).hostname.replace("www.", "");
  const dbKey = `${domain}-cf_clearance`;

  // 1. Check database for valid cookie expiration date
  try {
    const row = queryOne("SELECT expirationDate FROM cookie WHERE id = ?", [
      dbKey,
    ]);
    if (
      row &&
      row.expirationDate &&
      row.expirationDate > Date.now() &&
      !force
    ) {
      return;
    }
  } catch (e) {
    console.error("Failed to check cookie expiration in DB:", e);
  }

  if (activeBypasses[domain]) {
    return activeBypasses[domain];
  }

  activeBypasses[domain] = queueBypass(async () => {
    global.IsBypassingCloudflare = true;

    try {
      run("DELETE FROM cookie WHERE id = ?", [dbKey]);
      await win.webContents.session.cookies.remove(targetUrl, "cf_clearance");
    } catch (e) {
      console.error("[Bypass] Failed to clear cookie before bypass:", e);
    }

    try {
      await win.loadURL(targetUrl);

      let passed = false;
      for (let i = 0; i < 60; i++) {
        const title = await win.webContents
          .executeJavaScript("document.title")
          .catch(() => "");
        const html = await win.webContents
          .executeJavaScript("document.documentElement.outerHTML")
          .catch(() => "");

        if (successCheckFn(title, html)) {
          passed = true;
          break;
        } else if (title) {
          if (!global.ScrapperWindow.isVisible()) win.show();
        }
        await new Promise((r) => setTimeout(r, 1000));
      }

      if (!passed) {
        win.hide();
        throw new Error(
          `Timeout waiting for Cloudflare captcha on ${targetUrl}`,
        );
      }

      win.hide();

      // Retrieve cookies from session and find cf_clearance to store its expiration
      const cookies = await win.webContents.session.cookies.get({});
      const cfClearance = cookies.find(
        (c) =>
          c.name === "cf_clearance" &&
          c.domain.includes(domain.replace("www.", "")),
      );

      const expiry =
        cfClearance && cfClearance.expirationDate
          ? cfClearance.expirationDate * 1000 // Convert Unix seconds to MS
          : Date.now() + 1000 * 60 * 10; // Fallback to 10 minutes from now

      if (cfClearance) {
        try {
          run(
            `INSERT OR REPLACE INTO cookie (id, value, name, domain, url, path, secure, httpOnly, expirationDate) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              dbKey,
              cfClearance.value,
              "cf_clearance",
              domain,
              "",
              "",
              "",
              "",
              expiry,
            ],
          );
        } catch (dbErr) {
          console.error("Failed to save cf_clearance to database:", dbErr);
        }
      }
    } finally {
      global.IsBypassingCloudflare = false;
    }
  });

  try {
    await activeBypasses[domain];
  } finally {
    delete activeBypasses[domain];
  }
};

async function ExitScrapperWindow() {
  if (global.ScrapperWindow && !global.ScrapperWindow.isDestroyed()) {
    isQuitting = true;
    global.ScrapperWindow.close();
    global.ScrapperWindow = null;
  }
}

global.axios = axios.create();
global.axios.interceptors.request.use(
  async (config) => {
    const { cookieRequired, ...headers } = getHeaders(config.url);
    config.headers = { ...config.headers, ...headers };
    if (cookieRequired && !headers.Cookie) {
      const bypass = getBypassCheck(config.url);
      if (bypass && global.cloudflarebypass) {
        try {
          await global.cloudflarebypass(bypass.baseUrl, bypass.check);
          const { cookieRequired: _, ...newHeaders } = getHeaders(config.url);
          config.headers = { ...config.headers, ...newHeaders };
        } catch (err) {
          console.error("Failed pre-emptive Cloudflare bypass:", err.message);
        }
      }
    }
    return config;
  },
  (error) => Promise.reject(error),
);

global.axios.interceptors.response.use(
  (response) => {
    const data = response.data;
    if (
      data &&
      data.errors &&
      data.errors.some((e) => e.message === "NEED_CAPTCHA") &&
      !response.config._retry
    ) {
      response.config._retry = true;
      const bypass = getBypassCheck(response.config.url);
      if (bypass && global.cloudflarebypass) {
        return global
          .cloudflarebypass(bypass.baseUrl, bypass.check, true)
          .then(() => {
            const { cookieRequired, ...newHeaders } = getHeaders(
              response.config.url,
            );
            response.config.headers = {
              ...response.config.headers,
              ...newHeaders,
            };
            return global.axios(response.config);
          });
      }
    }
    return response;
  },
  async (error) => {
    const { config, response } = error;
    if (
      response &&
      (response.status === 403 || response.status === 503) &&
      config &&
      !config._retry
    ) {
      config._retry = true;
      const bypass = getBypassCheck(config.url);
      if (bypass && global.cloudflarebypass) {
        console.log(
          `Cloudflare challenge detected (status: ${response.status}) for ${config.url}. Retrying with bypass...`,
        );
        try {
          await global.cloudflarebypass(bypass.baseUrl, bypass.check, true);
          const { cookieRequired, ...newHeaders } = getHeaders(config.url);
          config.headers = {
            ...config.headers,
            ...newHeaders,
          };
          return global.axios(config);
        } catch (bypassErr) {
          return Promise.reject(bypassErr);
        }
      }
    }
    return Promise.reject(error);
  },
);

module.exports = {
  createScrapperWindow,
  ExitScrapperWindow,
};
