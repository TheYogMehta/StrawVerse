const { app, BrowserWindow, net, session } = require("electron");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const { Readable } = require("stream");
const { getHeaders } = require("./proxyHeaders");
const { run, queryAll, queryOne } = require("./db");

let isQuitting = false;
let activeBypasses = {};
let bypassCooldowns = {};
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

function mergeCookie(headers, requestCookieStr) {
  if (!requestCookieStr) return;
  const dbCookieStr = takeHeaderCaseInsensitive(headers, "cookie") || "";
  if (!dbCookieStr) {
    headers.Cookie = requestCookieStr;
    return;
  }

  const cookieMap = {};
  requestCookieStr.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) cookieMap[key] = val;
    }
  });

  dbCookieStr.split(";").forEach((pair) => {
    const idx = pair.indexOf("=");
    if (idx > 0) {
      const key = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (key) cookieMap[key] = val;
    }
  });

  headers.Cookie = Object.entries(cookieMap)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
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

const COOKIE_UPSERT = `
  INSERT INTO cookie (id, name, domain, url, value, path, secure, httpOnly, expirationDate, local_saved_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(id) DO UPDATE SET
    value = excluded.value,
    expirationDate = excluded.expirationDate,
    local_saved_at = excluded.local_saved_at
`;

async function saveClearanceCookiesForDomain(domain) {
  const cookies = await global.ScrapperWindow.webContents.session.cookies.get(
    {},
  );
  for (const cookie of cookies) {
    if (cookieMatchesDomain(cookie.domain, domain)) {
      try {
        const cookieDomain = normalizeHostname(cookie.domain);
        const key = `${cookieDomain}-${cookie.name}`;
        const expiry = cookie.expirationDate
          ? cookie.expirationDate * 1000
          : Date.now() + 1000 * 60 * 60 * 24;
        run(COOKIE_UPSERT, [
          key,
          cookie.name,
          cookieDomain,
          cookie.path || "/",
          cookie.value,
          cookie.path || "/",
          cookie.secure ? "true" : "false",
          cookie.httpOnly ? "true" : "false",
          expiry,
          Date.now(),
        ]);
        if (global.clearCookieCache) {
          global.clearCookieCache(domain);
        }
      } catch (dbErr) {
        console.error("Failed to save cookie to database:", dbErr);
      }
    }
  }
}

async function clearCookiesForDomain(domain) {
  run(
    "DELETE FROM cookie WHERE id = ? OR (? = domain OR ? LIKE '%.' || domain OR domain LIKE '%.' || ?)",
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

async function loadSavedCookiesIntoSession() {
  try {
    const rows = queryAll(
      "SELECT name, value, domain, path, secure, httpOnly, expirationDate FROM cookie",
    );
    if (!rows || rows.length === 0) return;

    const sess = global.ScrapperWindow.webContents.session;
    const now = Date.now();
    let restoredCount = 0;

    for (const row of rows) {
      if (!row.name || !row.value || !row.domain) continue;
      const exp = Number(row.expirationDate);
      if (exp && exp < now) continue;

      const domain = normalizeHostname(row.domain);
      const url = `http${row.secure === "true" ? "s" : ""}://${domain}${row.path || "/"}`;

      try {
        await sess.cookies.set({
          url: url,
          name: row.name,
          value: row.value,
          domain: "." + domain,
          path: row.path || "/",
          secure: row.secure === "true",
          httpOnly: row.httpOnly === "true",
          expirationDate: exp ? Math.floor(exp / 1000) : undefined,
        });
        restoredCount++;
      } catch (e) {}
    }
    if (restoredCount > 0) {
      console.log(
        `[ScrapperWindow] Restored ${restoredCount} saved cookies from DB into session.`,
      );
    }
  } catch (err) {
    console.error("Failed to restore saved cookies into session:", err);
  }
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

  loadSavedCookiesIntoSession();

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
        "Sec-CH-UA": secChUa,
        "Sec-CH-UA-Mobile": secChMobile,
        "Sec-CH-UA-Platform": secChPlatform,
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
      if (secChUa) details.requestHeaders["sec-ch-ua"] = secChUa;
      if (secChMobile) details.requestHeaders["sec-ch-ua-mobile"] = secChMobile;
      if (secChPlatform)
        details.requestHeaders["sec-ch-ua-platform"] = secChPlatform;
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

function hasValidClearance(domain) {
  try {
    const row = queryOne(
      "SELECT expirationDate, local_saved_at FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (? = domain OR ? LIKE '%.' || domain)) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
      [`${domain}-cf_clearance`, domain, domain],
    );
    if (row) {
      const exp = Number(row.expirationDate);
      const savedAt = Number(row.local_saved_at);
      const now = Date.now();
      if (exp > now) return true;
      if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) return true;
    }
  } catch (e) {}
  return false;
}

global.cloudflarebypass = async (targetUrl, force = false, referer = null) => {
  if (!global.ScrapperWindow)
    throw new Error("Global ScrapperWindow is not initialized");

  const domain = new URL(targetUrl).hostname.replace("www.", "");

  try {
    const row = queryOne(
      "SELECT expirationDate, local_saved_at FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (? = domain OR ? LIKE '%.' || domain)) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
      [`${domain}-cf_clearance`, domain, domain],
    );
    if (row) {
      const exp = Number(row.expirationDate);
      const savedAt = Number(row.local_saved_at);
      const now = Date.now();
      let isValid = false;
      if (exp > now) {
        isValid = true;
      } else if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) {
        isValid = true;
      }
      if (isValid && !force) {
        return;
      }
    }
  } catch (e) {
    console.error("Failed to check cookie expiration in DB:", e);
  }

  if (activeBypasses[domain]) return activeBypasses[domain];

  if (
    force &&
    bypassCooldowns[domain] &&
    Date.now() < bypassCooldowns[domain]
  ) {
    console.log(
      `[Bypass] Skipping bypass for ${domain} — cooldown active (${Math.round((bypassCooldowns[domain] - Date.now()) / 1000)}s remaining)`,
    );
    return;
  }

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

      let navUrl;
      try {
        const parsed = new URL(targetUrl);
        navUrl = parsed.origin + "/";
      } catch (e) {
        navUrl = targetUrl;
      }

      if (force && !global.ScrapperWindow.isVisible()) {
        global.ScrapperWindow.show();
      }

      try {
        const navReferer = referer || navUrl;
        await global.ScrapperWindow.loadURL(navUrl, {
          httpReferrer: navReferer,
          timeout: 30000,
        });
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
              (i > 3 && !isWindowLoading)
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

      const finalCookies =
        await global.ScrapperWindow.webContents.session.cookies.get({});
      const gotClearance = finalCookies.some(
        (c) =>
          c.name === "cf_clearance" && cookieMatchesDomain(c.domain, domain),
      );
      if (!gotClearance) {
        bypassCooldowns[domain] = Date.now() + 90 * 1000;
        console.warn(
          `[Bypass] Failed to solve challenge for ${domain}. Cooldown set for 90s.`,
        );
      } else {
        delete bypassCooldowns[domain];
        console.log(
          `[Bypass] Successfully obtained cf_clearance for ${domain}`,
        );
      }

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

global.scrapperFetch = (url, options = {}) => {
  return queueBypass(async () => {
    if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) {
      throw new Error("ScrapperWindow is not initialized");
    }
    try {
      const targetOrigin = new URL(url).origin;
      const currentUrl = global.ScrapperWindow.webContents.getURL() || "";
      if (!currentUrl.startsWith(targetOrigin)) {
        await global.ScrapperWindow.loadURL(targetOrigin + "/").catch(() => {});
        await sleep(300);
      }
    } catch (e) {}

    const js = `
      (async () => {
        try {
          const res = await fetch(${JSON.stringify(url)}, ${JSON.stringify(options)});
          return await res.text();
        } catch (err) {
          return null;
        }
      })()
    `;

    try {
      const text =
        await global.ScrapperWindow.webContents.executeJavaScript(js);
      return text;
    } catch (e) {
      return null;
    }
  });
};

global.scrapperFetchDataUrl = (url) => {
  return queueBypass(async () => {
    if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) {
      return null;
    }
    try {
      const targetOrigin = new URL(url).origin;
      const currentUrl = global.ScrapperWindow.webContents.getURL() || "";
      if (!currentUrl.startsWith(targetOrigin)) {
        await global.ScrapperWindow.loadURL(targetOrigin + "/").catch(() => {});
        await sleep(300);
      }
    } catch (e) {}

    const js = `
      (async () => {
        try {
          const res = await fetch(${JSON.stringify(url)});
          if (!res.ok) return null;
          const blob = await res.blob();
          return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = () => resolve(null);
            reader.readAsDataURL(blob);
          });
        } catch (err) {
          return null;
        }
      })()
    `;

    try {
      const dataUrl =
        await global.ScrapperWindow.webContents.executeJavaScript(js);
      return dataUrl;
    } catch (e) {
      return null;
    }
  });
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

      const shouldBypassUrl = (urlStr, refererStr) => {
        if (!urlStr && !refererStr) return false;
        const urlLower = (urlStr || "").toLowerCase();
        const refLower = (refererStr || "").toLowerCase();
        return (
          urlLower.includes("animepahe") ||
          urlLower.includes("kwik.cx") ||
          urlLower.includes("anikoto") ||
          urlLower.includes("anineko") ||
          urlLower.includes("weebcentral") ||
          urlLower.includes("megaplay") ||
          urlLower.includes("vidplay") ||
          urlLower.includes("vidstream") ||
          urlLower.includes("vidtub") ||
          urlLower.includes("megap")
        );
      };

      const isMediaUrl = (urlStr) => {
        if (!urlStr) return false;
        const urlLower = urlStr.toLowerCase();
        return (
          urlLower.includes(".webp") ||
          urlLower.includes(".jpg") ||
          urlLower.includes(".jpeg") ||
          urlLower.includes(".png") ||
          urlLower.includes(".gif") ||
          urlLower.includes(".css") ||
          urlLower.includes(".js") ||
          urlLower.includes(".m3u8") ||
          urlLower.includes(".ts") ||
          urlLower.includes("/uploads/") ||
          urlLower.includes("/snapshots/") ||
          urlLower.includes("/posters/") ||
          urlLower.includes("/covers/")
        );
      };

      try {
        const domain = new URL(url).hostname.replace("www.", "");
        const reqReferer =
          requestHeaders.Referer || requestHeaders.referer || "";

        if (
          shouldBypassUrl(url, reqReferer) &&
          !isMediaUrl(url) &&
          global.scrapperFetch &&
          hasValidClearance(domain)
        ) {
          const referer = reqReferer;
          const resultText = await global.scrapperFetch(url, {
            headers: {
              ...(referer ? { Referer: referer } : {}),
              Accept: "application/json, text/plain, */*",
            },
          });
          if (
            resultText &&
            !resultText.includes("Just a moment...") &&
            !resultText.includes("Enable JavaScript") &&
            !resultText.includes("cf-challenge")
          ) {
            let responseData = resultText;
            if (responseType !== "arraybuffer") {
              try {
                responseData = JSON.parse(resultText);
              } catch (e) {}
            }
            return resolve({
              data: responseData,
              status: 200,
              statusText: "OK",
              headers: {},
              config,
              request: null,
            });
          }
        }
      } catch (e) {}

      Object.keys(requestHeaders).forEach((key) => {
        const lower = key.toLowerCase();
        if (lower.startsWith("sec-fetch-") || lower === "host") {
          delete requestHeaders[key];
        }
      });

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
        if (responseType === "arraybuffer" || responseType === "buffer") {
          const buffer = await res.arrayBuffer();
          responseData = Buffer.from(buffer);
        } else if (responseType === "stream") {
          if (res.body && typeof res.body.pipe === "function") {
            responseData = res.body;
          } else if (res.body && typeof Readable.fromWeb === "function") {
            responseData = Readable.fromWeb(res.body);
          } else if (res.body && typeof Readable.from === "function") {
            responseData = Readable.from(res.body);
          } else {
            responseData = res.body;
          }
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
          const newHeaders = getHeaders(
            response.config.url,
            response.config.method,
          );
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

    const isMediaUrl = (urlStr) => {
      if (!urlStr) return false;
      const url = urlStr.toLowerCase();
      return (
        url.includes(".webp") ||
        url.includes(".jpg") ||
        url.includes(".jpeg") ||
        url.includes(".png") ||
        url.includes(".gif") ||
        url.includes(".css") ||
        url.includes(".js") ||
        url.includes(".m3u8") ||
        url.includes(".ts") ||
        url.includes("/uploads/") ||
        url.includes("/snapshots/") ||
        url.includes("/posters/") ||
        url.includes("/covers/")
      );
    };

    if (
      response &&
      (response.status === 403 || response.status === 503) &&
      config &&
      !config._retry &&
      !isMediaUrl(config.url) &&
      global?.cloudflarebypass
    ) {
      config._retry = true;

      try {
        const domain = new URL(config.url).hostname.replace("www.", "");
        if (global.clearCookieCache) global.clearCookieCache(domain);
      } catch (e) {}

      console.log(
        `[Axios Interceptor] Cloudflare 403 detected for ${config.url}. Checking scrapperFetch...`,
      );
      try {
        const referer =
          config.headers?.Referer ||
          config.headers?.referer ||
          (config.headers?.get && config.headers.get("referer")) ||
          "";

        if (global.scrapperFetch) {
          const resultText = await global.scrapperFetch(config.url, {
            headers: {
              ...(referer ? { Referer: referer } : {}),
              Accept: "application/json, text/plain, */*",
            },
          });
          if (
            resultText &&
            !resultText.includes("Just a moment...") &&
            !resultText.includes("Enable JavaScript") &&
            !resultText.includes("cf-challenge")
          ) {
            let parsedData = resultText;
            try {
              parsedData = JSON.parse(resultText);
            } catch (e) {}

            return {
              data: parsedData,
              status: 200,
              statusText: "OK",
              headers: {},
              config: config,
              request: null,
            };
          }
        }

        await global.cloudflarebypass(config.url, true, referer);

        if (global.scrapperFetch) {
          const resultText = await global.scrapperFetch(config.url, {
            headers: {
              ...(referer ? { Referer: referer } : {}),
              Accept: "application/json, text/plain, */*",
            },
          });
          if (
            resultText &&
            !resultText.includes("Just a moment...") &&
            !resultText.includes("Enable JavaScript") &&
            !resultText.includes("cf-challenge")
          ) {
            let parsedData = resultText;
            try {
              parsedData = JSON.parse(resultText);
            } catch (e) {}

            return {
              data: parsedData,
              status: 200,
              statusText: "OK",
              headers: {},
              config: config,
              request: null,
            };
          }
        }

        takeHeaderCaseInsensitive(config.headers, "cookie");
        const newHeaders = getHeaders(config.url, config.method);
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
