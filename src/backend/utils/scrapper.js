const { app, BrowserWindow } = require("electron");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { getHeaders } = require("./proxyHeaders");
const { run, queryAll, queryOne } = require("./db");

let isQuitting = false;
let activeBypasses = {};
let bypassQueue = [];
let bypassBusy = false;

const CF_CLEARANCE_UPSERT = `INSERT OR REPLACE INTO cookie (id, value, name, domain, url, path, secure, httpOnly, expirationDate)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;

app.on("before-quit", () => {
  isQuitting = true;
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stripElectronBrands(value = "") {
  return value
    .replace(/,?\s*"Electron";v="[^"]+"/g, "")
    .replace(/"Electron";v="[^"]+",?\s*/g, "");
}

function normalizeHostname(value) {
  return String(value || "").replace(/^\./, "").replace(/^www\./, "");
}

function normalizeOrigin(value) {
  if (!value) return null;
  try {
    return new URL(value).origin + "/";
  } catch (e) {
    return null;
  }
}

function getHeaderCaseInsensitive(headers, name) {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === wanted);
  return key ? headers[key] : null;
}

function takeHeaderCaseInsensitive(headers, name) {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers || {}).find((k) => k.toLowerCase() === wanted);
  if (!key) return null;
  const value = headers[key];
  delete headers[key];
  return value;
}

function isSameOriginReferer(targetUrl, referer) {
  if (!referer) return false;
  try {
    return (
      normalizeHostname(new URL(targetUrl).hostname) ===
      normalizeHostname(new URL(referer).hostname)
    );
  } catch (e) {
    return false;
  }
}

function setRefererHeaders(headers, referer, includeOrigin = false) {
  const originReferer = normalizeOrigin(referer);
  if (originReferer) {
    headers.Referer = originReferer;
    if (includeOrigin) headers.Origin = originReferer.slice(0, -1);
  } else if (referer) {
    headers.Referer = referer;
  }
}

function mergeCookie(headers, cookie) {
  if (!cookie) return;
  const existingCookie = headers.Cookie || headers.cookie || "";
  if (!existingCookie) {
    headers.Cookie = cookie;
    return;
  }
  if (!existingCookie.includes("cf_clearance=")) {
    headers.Cookie = existingCookie + "; " + cookie;
    return;
  }
  headers.Cookie = existingCookie.replace(
    /cf_clearance=[^;]+/g,
    cookie.trim().replace(/;$/, ""),
  );
}

function cookieMatchesDomain(cookieDomain, domain) {
  const normalizedCookieDomain = normalizeHostname(cookieDomain);
  return (
    domain === normalizedCookieDomain ||
    domain.endsWith("." + normalizedCookieDomain) ||
    normalizedCookieDomain.endsWith("." + domain)
  );
}

function saveClearanceCookie(cookie) {
  if (cookie.name !== "cf_clearance") return;
  const cookieDomain = normalizeHostname(cookie.domain);
  const expiry = cookie.expirationDate
    ? cookie.expirationDate * 1000
    : Date.now() + 1000 * 60 * 10;
  const key = `${cookieDomain}-cf_clearance`;
  run(CF_CLEARANCE_UPSERT, [
    key,
    cookie.value,
    "cf_clearance",
    cookieDomain,
    "",
    "",
    "",
    "",
    expiry,
  ]);
}

async function saveClearanceCookiesForDomain(domain) {
  const cookies = await global.ScrapperWindow.webContents.session.cookies.get({});
  for (const cookie of cookies) {
    if (
      cookie.name === "cf_clearance" &&
      cookieMatchesDomain(cookie.domain, domain)
    ) {
      try {
        saveClearanceCookie(cookie);
      } catch (dbErr) {
        console.error("Failed to save cf_clearance to database:", dbErr);
      }
    }
  }
}

async function clearCookiesForDomain(domain) {
  run(
    "DELETE FROM cookie WHERE id = ? OR (? = domain OR ? LIKE '%.' || domain OR domain LIKE '%.' || ?)",
    [`${domain}-cf_clearance`, domain, domain, domain],
  );

  const sessionCookies =
    await global.ScrapperWindow.webContents.session.cookies.get({});
  const domainCookies = sessionCookies.filter((cookie) =>
    cookieMatchesDomain(cookie.domain, domain),
  );
  for (const cookie of domainCookies) {
    const cookieUrl = `http${cookie.secure ? "s" : ""}://${normalizeHostname(cookie.domain)}${cookie.path || "/"}`;
    await global.ScrapperWindow.webContents.session.cookies
      .remove(cookieUrl, cookie.name)
      .catch(() => {});
  }
  return domainCookies.length;
}

function pageLooksLikeChallenge(title, html) {
  const lowerTitle = (title || "").toLowerCase();
  const lowerHtml = (html || "").toLowerCase();
  return (
    lowerTitle.includes("just a moment") ||
    lowerTitle.includes("cloudflare") ||
    lowerTitle.includes("captcha") ||
    lowerHtml.includes("just a moment") ||
    lowerHtml.includes("cloudflare") ||
    lowerHtml.includes("captcha")
  );
}

function pageLooksLikeError(title, html) {
  const lowerTitle = (title || "").toLowerCase();
  const lowerHtml = (html || "").toLowerCase();
  return (
    global.LastScrapperResponseCode >= 400 ||
    lowerTitle.includes("403") ||
    lowerTitle.includes("forbidden") ||
    lowerTitle.includes("404") ||
    lowerTitle.includes("not found") ||
    lowerHtml.includes("blocked")
  );
}

// Create Scrapping Window
function createScrapperWindow() {
  global.LastScrapperResponseCode = 200;
  global.ScrapperWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      partition: "persist:scrapper",
      autoplayPolicy: "user-gesture-required",
    },
  });

  global.ScrapperWindow.webContents.session.on(
    "will-download",
    (event, item) => {
      event.preventDefault();
      if (!app.isPackaged) {
        console.log(`[ScrapperWindow] Blocked download of: ${item.getURL()}`);
      }
    },
  );

  global.ScrapperWindow.webContents.setUserAgent(
    getHeaders("https://google.com")["User-Agent"],
  );

  global.ScrapperWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (details.url.includes(".m3u8") && !details.url.includes("ping.gif")) {
        global.LastM3u8 = details.url;
      }
      callback({ cancel: false });
    },
  );

  global.ScrapperWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["*://*/*"] },
    (details, callback) => {
      const proxyReferer = takeHeaderCaseInsensitive(
        details.requestHeaders,
        "x-proxy-referer",
      );

      if (details.requestHeaders["sec-ch-ua"]) {
        details.requestHeaders["sec-ch-ua"] = stripElectronBrands(
          details.requestHeaders["sec-ch-ua"],
        );
      }
      if (details.requestHeaders["sec-ch-ua-full-version-list"]) {
        details.requestHeaders["sec-ch-ua-full-version-list"] =
          stripElectronBrands(
            details.requestHeaders["sec-ch-ua-full-version-list"],
          );
      }

      const rawReferer =
        details.requestHeaders["Referer"] ||
        details.requestHeaders["referer"] ||
        proxyReferer;
      const isSameOrigin = isSameOriginReferer(details.url, rawReferer);

      const {
        Referer: referer,
        "User-Agent": userAgent,
        Cookie: Cookie,
      } = getHeaders(details.url);
      if (proxyReferer) {
        setRefererHeaders(details.requestHeaders, proxyReferer, true);
      } else if (referer && !isSameOrigin) {
        setRefererHeaders(details.requestHeaders, referer);
      }
      if (userAgent) details.requestHeaders["User-Agent"] = userAgent;
      mergeCookie(details.requestHeaders, Cookie);

      callback({ requestHeaders: details.requestHeaders });
    },
  );

  global.ScrapperWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (details.resourceType === "mainFrame") {
        global.LastScrapperResponseCode = details.statusCode;
      }
      const responseHeaders = { ...details.responseHeaders };
      const urlLower = details.url.toLowerCase();

      const isMedia =
        urlLower.includes(".m3u8") ||
        urlLower.includes(".ts") ||
        urlLower.includes(".mp4") ||
        urlLower.includes(".mkv") ||
        urlLower.includes(".avi") ||
        urlLower.includes(".css") ||
        urlLower.includes(".vtt");

      const contentType = String(
        getHeaderCaseInsensitive(responseHeaders, "content-type") || "",
      );
      const isHtml = contentType.toLowerCase().includes("text/html");

      const isErrorOrChallenge = details.statusCode >= 400 || isHtml;

      if (isMedia && !isErrorOrChallenge) {
        for (const key of Object.keys(responseHeaders)) {
          if (key.toLowerCase() === "content-disposition") {
            responseHeaders[key] = ["inline"];
          }
          if (key.toLowerCase() === "content-type") {
            responseHeaders[key] = ["text/plain"];
          }
        }
      }
      callback({ responseHeaders });
    },
  );

  global.ScrapperWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `Failed to load ${validatedURL}: ${errorCode} - ${errorDescription}`,
      );
      global.LastScrapperResponseCode = 599;
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

global.cloudflarebypass = async (targetUrl, force = false, referer = null) => {
  if (!global.ScrapperWindow)
    throw new Error("Global ScrapperWindow is not initialized");

  const domain = new URL(targetUrl).hostname.replace("www.", "");

  try {
    const row = queryOne(
      "SELECT expirationDate FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (? = domain OR ? LIKE '%.' || domain)) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
      [`${domain}-cf_clearance`, domain, domain],
    );
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

  if (activeBypasses[domain]) return activeBypasses[domain];

  activeBypasses[domain] = queueBypass(async () => {
    global.IsBypassingCloudflare = true;

    try {
      const clearedCount = await clearCookiesForDomain(domain);
      if (clearedCount > 0) {
        console.log(
          `[Bypass] Cleared ${clearedCount} cookies for domain ${domain}`,
        );
      }
    } catch (e) {
      console.error("[Bypass] Failed to clear cookies before bypass:", e);
    }

    try {
      global.LastScrapperResponseCode = 200;
      try {
        if (referer) {
          await global.ScrapperWindow.loadURL(targetUrl, {
            httpReferrer: referer,
          });
        } else {
          await global.ScrapperWindow.loadURL(targetUrl);
        }
      } catch (err) {}

      for (let i = 0; i < 60; i++) {
        const sessionCookies =
          await global.ScrapperWindow.webContents.session.cookies.get({});
        const hasClearanceForDomain = sessionCookies.some(
          (cookie) =>
            cookie.name === "cf_clearance" &&
            cookieMatchesDomain(cookie.domain, domain),
        );

        if (hasClearanceForDomain) {
          break;
        }

        const title = global.ScrapperWindow.webContents.getTitle() || "";

        let html = "";
        try {
          html = await global.ScrapperWindow.webContents.executeJavaScript(
            "document.documentElement.outerHTML",
          );
        } catch (e) {}

        if (pageLooksLikeChallenge(title, html)) {
          if (!global.ScrapperWindow.isVisible()) {
            global.ScrapperWindow.show();
          }
        } else {
          if (html && !pageLooksLikeError(title, html)) {
            if (!force || hasClearanceForDomain || i > 5) {
              break;
            }
          }
        }

        await sleep(1000);
      }

      global.ScrapperWindow.hide();
      global.ScrapperWindow.loadURL("about:blank").catch(() => {});

      await saveClearanceCookiesForDomain(domain);
      global.ScrapperWindow.loadURL("about:blank").catch(() => {});
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

global.scrapperLoad = (url, referer = null) => {
  return queueBypass(async () => {
    if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) {
      throw new Error("ScrapperWindow is not initialized");
    }
    try {
      if (referer) {
        await global.ScrapperWindow.loadURL(url, {
          httpReferrer: normalizeOrigin(referer) || referer,
        });
      } else {
        await global.ScrapperWindow.loadURL(url);
      }
    } catch (err) {
      if (!err.message.includes("ERR_ABORTED")) {
        console.error(`[Scrapper Load] Load failed:`, err.message);
      }
    }
    await sleep(1800);
    let text = "";
    try {
      text = await global.ScrapperWindow.webContents.executeJavaScript(
        "document.body.innerText",
      );
    } catch (e) {}

    try {
      const domain = new URL(url).hostname.replace("www.", "");
      await saveClearanceCookiesForDomain(domain);
    } catch (e) {}

    global.ScrapperWindow.loadURL("about:blank").catch(() => {});
    return text;
  });
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
    const headers = getHeaders(config.url);
    config.headers = {
      ...config.headers,
      ...headers,
    };
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
      !response.config._retry &&
      global.cloudflarebypass
    ) {
      response.config._retry = true;

      const referer =
        response.config.headers?.Referer ||
        (response.config.headers?.get &&
          response.config.headers.get("referer")) ||
        "";

      return global.cloudflarebypass(response.config.url, true, referer).then(() => {
        const newHeaders = getHeaders(response.config.url);
        response.config.headers = {
          ...response.config.headers,
          ...newHeaders,
        };
        return global.axios(response.config);
      });
    }

    return response;
  },
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
        `Cloudflare challenge detected (status: ${response.status}) for ${config.url}. Retrying with bypass...`,
      );
      try {
        const referer =
          config.headers?.Referer ||
          config.headers?.referer ||
          (config.headers?.get && config.headers.get("referer")) ||
          "";
        await global.cloudflarebypass(config.url, true, referer);
        const newHeaders = getHeaders(config.url);
        config.headers = {
          ...config.headers,
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

module.exports = {
  createScrapperWindow,
  ExitScrapperWindow,
};
