const { app, BrowserWindow, net, session } = require("electron");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { getHeaders } = require("./proxyHeaders");
const { run, queryAll, queryOne } = require("./db");

let isQuitting = false;
let activeBypasses = {};
let bypassQueue = [];
let bypassBusy = false;

const CF_CLEARANCE_UPSERT = `INSERT OR REPLACE INTO cookie (id, value, name, domain, url, path, secure, httpOnly, expirationDate, local_saved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

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
  return String(value || "")
    .replace(/^\./, "")
    .replace(/^www\./, "");
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
  const key = Object.keys(headers || {}).find(
    (k) => k.toLowerCase() === wanted,
  );
  return key ? headers[key] : null;
}

function takeHeaderCaseInsensitive(headers, name) {
  const wanted = name.toLowerCase();
  const key = Object.keys(headers || {}).find(
    (k) => k.toLowerCase() === wanted,
  );
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
  takeHeaderCaseInsensitive(headers, "referer");
  if (originReferer) {
    headers.Referer = originReferer;
    if (includeOrigin) {
      takeHeaderCaseInsensitive(headers, "origin");
      headers.Origin = originReferer.slice(0, -1);
    }
  } else if (referer) {
    headers.Referer = referer;
  }
}

function mergeCookie(headers, cookie) {
  if (!cookie) return;
  const existingCookie = takeHeaderCaseInsensitive(headers, "cookie") || "";
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
  const key = `${cookieDomain}-cf_clearance`;

  try {
    const existing = queryOne("SELECT value FROM cookie WHERE id = ? LIMIT 1", [
      key,
    ]);
    if (existing && existing.value === cookie.value) {
      return;
    }
  } catch (err) {}

  const expiry = cookie.expirationDate
    ? cookie.expirationDate * 1000
    : Date.now() + 1000 * 60 * 10;
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
    Date.now(),
  ]);
}

async function saveClearanceCookiesForDomain(domain) {
  const cookies = await global.ScrapperWindow.webContents.session.cookies.get(
    {},
  );
  for (const cookie of cookies) {
    if (
      cookie.name === "cf_clearance" &&
      cookieMatchesDomain(cookie.domain, domain)
    ) {
      try {
        saveClearanceCookie(cookie);
        if (global.clearCookieCache) {
          global.clearCookieCache(domain);
        }
      } catch (dbErr) {
        console.error("Failed to save cf_clearance to database:", dbErr);
      }
    }
  }
}

async function clearCookiesForDomain(domain) {
  run(
    "DELETE FROM cookie WHERE id = ? OR (LTRIM(?, '.') = LTRIM(domain, '.') OR LTRIM(?, '.') LIKE '%.' || LTRIM(domain, '.') OR LTRIM(domain, '.') LIKE '%.' || LTRIM(?, '.'))",
    [`${domain}-cf_clearance`, domain, domain, domain],
  );
  if (global.clearCookieCache) {
    global.clearCookieCache(domain);
  }

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
    lowerTitle.includes("not robot") ||
    lowerHtml.includes("just a moment") ||
    lowerHtml.includes("cloudflare") ||
    lowerHtml.includes("captcha") ||
    lowerHtml.includes("cf-challenge") ||
    lowerHtml.includes("turnstile") ||
    lowerHtml.includes("challenge-platform") ||
    lowerHtml.includes("challenge") ||
    global.LastScrapperResponseCode === 403 ||
    global.LastScrapperResponseCode === 503
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
        getHeaderCaseInsensitive(details.requestHeaders, "referer") ||
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
      if (userAgent) {
        takeHeaderCaseInsensitive(details.requestHeaders, "user-agent");
        details.requestHeaders["User-Agent"] = userAgent;
      }
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
    (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (isMainFrame && errorCode !== -3) {
        console.error(
          `Failed to load main frame ${validatedURL}: ${errorCode} - ${errorDescription}`,
        );
        global.LastScrapperResponseCode = 599;
      }
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
      "SELECT expirationDate, local_saved_at FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (LTRIM(?, '.') = LTRIM(domain, '.') OR LTRIM(?, '.') LIKE '%.' || LTRIM(domain, '.'))) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
      [`${domain}-cf_clearance`, domain, domain],
    );
    if (row && !force) {
      const exp = Number(row.expirationDate);
      const savedAt = Number(row.local_saved_at);
      const now = Date.now();
      let isValid = false;
      if (exp > now) {
        isValid = true;
      } else if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) {
        isValid = true;
      }
      if (isValid) {
        return;
      }
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
        const navUrl = targetUrl;
        if (referer) {
          await global.ScrapperWindow.loadURL(navUrl, {
            httpReferrer: referer,
            timeout: 30000,
          });
        } else {
          await global.ScrapperWindow.loadURL(navUrl, {
            timeout: 30000,
          });
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

        let readyState = "loading";
        try {
          readyState =
            await global.ScrapperWindow.webContents.executeJavaScript(
              "document.readyState",
            );
        } catch (e) {}

        const isWindowLoading =
          global.ScrapperWindow.webContents.isLoading() ||
          readyState === "loading";

        if (pageLooksLikeChallenge(title, html)) {
          if (!global.ScrapperWindow.isVisible()) {
            global.ScrapperWindow.show();
          }
        } else {
          if (html && !pageLooksLikeError(title, html)) {
            if (
              !force ||
              hasClearanceForDomain ||
              (i > 25 && !isWindowLoading)
            ) {
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

async function electronNetAdapter(config) {
  return new Promise(async (resolve, reject) => {
    try {
      const {
        method = "get",
        url,
        headers,
        data,
        timeout,
        responseType,
      } = config;

      const requestHeaders = {};
      if (headers) {
        if (typeof headers.toJSON === "function") {
          Object.assign(requestHeaders, headers.toJSON());
        } else {
          Object.assign(requestHeaders, headers);
        }
      }

      const options = {
        method: method.toUpperCase(),
        session: session.fromPartition("persist:scrapper"),
        headers: requestHeaders,
      };

      if (data) {
        options.body = typeof data === "object" ? JSON.stringify(data) : data;
        const contentTypeKey = Object.keys(requestHeaders).find(
          (k) => k.toLowerCase() === "content-type",
        );
        if (!contentTypeKey) {
          options.headers["Content-Type"] = "application/json";
        }
      }

      let signal;
      let timeoutId;
      if (timeout && timeout > 0) {
        const controller = new AbortController();
        signal = controller.signal;
        options.signal = signal;
        timeoutId = setTimeout(() => {
          controller.abort();
        }, timeout);
      }

      try {
        const res = await net.fetch(url, options);
        if (timeoutId) clearTimeout(timeoutId);

        const responseHeaders = {};
        res.headers.forEach((val, key) => {
          responseHeaders[key.toLowerCase()] = val;
        });

        let responseData;
        if (responseType === "arraybuffer") {
          const buffer = await res.arrayBuffer();
          responseData = Buffer.from(buffer);
        } else {
          const contentType = responseHeaders["content-type"] || "";
          if (contentType.includes("application/json")) {
            const text = await res.text();
            try {
              responseData = JSON.parse(text);
            } catch (e) {
              responseData = text;
            }
          } else {
            responseData = await res.text();
          }
        }

        const response = {
          data: responseData,
          status: res.status,
          statusText: res.statusText,
          headers: responseHeaders,
          config,
          request: null,
        };

        if (res.status >= 200 && res.status < 300) {
          resolve(response);
        } else {
          const error = new Error(
            `Request failed with status code ${res.status}`,
          );
          error.response = response;
          error.config = config;
          reject(error);
        }
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId);
        if (err.name === "AbortError") {
          const timeoutError = new Error(`timeout of ${timeout}ms exceeded`);
          timeoutError.code = "ECONNABORTED";
          timeoutError.config = config;
          reject(timeoutError);
        } else {
          reject(err);
        }
      }
    } catch (err) {
      reject(err);
    }
  });
}

axios.defaults.proxy = false;
global.axios = axios.create({
  proxy: false,
  adapter: electronNetAdapter,
  timeout: 20000,
});
global.axios.interceptors.request.use(
  async (config) => {
    const headers = getHeaders(config.url, config.method);
    if (config.headers) {
      if (headers["User-Agent"]) {
        takeHeaderCaseInsensitive(config.headers, "user-agent");
      }
      if (headers["Referer"]) {
        takeHeaderCaseInsensitive(config.headers, "referer");
      }
      if (headers["Cookie"]) {
        const existingCookie = takeHeaderCaseInsensitive(
          config.headers,
          "cookie",
        );
        if (existingCookie) {
          mergeCookie(headers, existingCookie);
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

function rebuildHeadersAfterBypass(existingHeaders, url, method) {
  const existing =
    typeof existingHeaders?.toJSON === "function"
      ? existingHeaders.toJSON()
      : { ...(existingHeaders || {}) };
  const browserIdentityHeaders = new Set([
    "cookie",
    "user-agent",
    "referer",
    "origin",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
  ]);
  for (const key of Object.keys(existing)) {
    if (browserIdentityHeaders.has(key.toLowerCase())) delete existing[key];
  }
  return { ...existing, ...getHeaders(url, method) };
}

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

      return global
        .cloudflarebypass(response.config.url, true, referer)
        .then(() => {
          response.config.headers = rebuildHeadersAfterBypass(
            response.config.headers,
            response.config.url,
            response.config.method,
          );
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
        config.headers = rebuildHeadersAfterBypass(
          config.headers,
          config.url,
          config.method,
        );
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
