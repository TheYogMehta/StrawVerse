let app = null;
let BrowserWindow = null;
let net = null;
let session = null;

try {
  const electron = require("electron");
  app = electron.app;
  BrowserWindow = electron.BrowserWindow;
  net = electron.net;
  session = electron.session;
} catch (_) {}

const isElectron = Boolean(process.versions?.electron && net && session);
const axios = require("axios");
const { Readable } = require("stream");
const { getHeaders } = require("./proxyHeaders");
const { run, queryAll, queryOne } = require("./db");
const {
  isBypassableUrl,
  isExtensionPageLoaded,
  getCookieDomains,
} = require("./extensionRegistry");

let isQuitting = false;
let activeBypasses = {};
let bypassCooldowns = {};
let bypassQueue = [];
let bypassBusy = false;

if (app && typeof app.on === "function") {
  app.on("before-quit", () => {
    isQuitting = true;
  });
}

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

function getDomain(u) {
  try {
    const h = new URL(u).hostname.replace(/^www\./, "");
    const p = h.split(".");
    return p.length > 2 ? p.slice(-2).join(".") : p.join(".");
  } catch (_) {
    return u;
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

function isCloudflareCookie(name) {
  if (!name || typeof name !== "string") return false;
  const n = name.toLowerCase();
  return n === "cf_clearance" || n.startsWith("__cf") || n.startsWith("cf_");
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
  if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) return;
  const session = global.ScrapperWindow.webContents?.session;
  if (!session) return;
  const cookies = await session.cookies.get({});
  const allTargetDoms = [domain, ...getCookieDomains(domain)];
  if (global.clearCookieCache) {
    for (const d of allTargetDoms) {
      global.clearCookieCache(d);
    }
  }
  for (const cookie of cookies) {
    const extraDoms = getCookieDomains(domain);
    const matchesExtra = extraDoms.some((ed) =>
      cookieMatchesDomain(cookie.domain, ed),
    );
    if (cookieMatchesDomain(cookie.domain, domain) || matchesExtra) {
      try {
        const cookieDomain = normalizeHostname(cookie.domain);
        const key = `${cookieDomain}-${cookie.name}`;
        const expiry = cookie.expirationDate
          ? cookie.expirationDate * 1000
          : Date.now() + 1000 * 60 * 60 * 24;
        await run(COOKIE_UPSERT, [
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
        if (global.updateCookieCache) {
          global.updateCookieCache(
            cookieDomain,
            cookie.name,
            cookie.value,
            cookie.expirationDate,
            Date.now(),
          );
        }
      } catch (dbErr) {
        console.error("Failed to save cookie to database:", dbErr);
      }
    }
  }
  try {
    const ua = global.ScrapperWindow?.webContents?.getUserAgent();
    if (ua) {
      await run(COOKIE_UPSERT, [
        `${domain}-user_agent`,
        "user_agent",
        domain,
        "/",
        ua,
        "/",
        "false",
        "false",
        Date.now() + 1000 * 60 * 60 * 24 * 365,
        Date.now(),
      ]);
      if (global.updateCookieCache) {
        global.updateCookieCache(domain, "user_agent", ua);
        for (const ed of getCookieDomains(domain)) {
          global.updateCookieCache(ed, "user_agent", ua);
        }
      }
    }
  } catch (e) {}
}

async function clearCookiesForDomain(domain) {
  await run(
    "DELETE FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (? = domain OR ? = LTRIM(domain, '.') OR ? LIKE '%.' || LTRIM(domain, '.') OR domain LIKE '%.' || ?))",
    [`${domain}-cf_clearance`, domain, domain, domain, domain],
  );
  if (global.clearCookieCache) {
    global.clearCookieCache(domain);
  }

  if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) return 0;
  const session = global.ScrapperWindow.webContents?.session;
  if (!session) return 0;
  let cleared = 0;
  try {
    const sessionCookies = await session.cookies.get({});
    for (const cookie of sessionCookies) {
      if (
        cookieMatchesDomain(cookie.domain, domain) ||
        (cookie.name === "cf_clearance" && isCloudflareCookie(cookie.name))
      ) {
        const norm = cookie.domain ? cookie.domain.replace(/^\./, "") : domain;
        const p = cookie.path || "/";
        await session.cookies
          .remove(`https://${norm}${p}`, cookie.name)
          .catch(() => {});
        await session.cookies
          .remove(`http://${norm}${p}`, cookie.name)
          .catch(() => {});
        cleared++;
      }
    }
  } catch (_) {}
  return cleared;
}

function isVideoStreamUrl(urlStr, cfg) {
  if (cfg?.responseType === "stream") return true;
  if (!urlStr) return false;
  const u = String(urlStr).toLowerCase();
  return (
    u.includes(".m3u8") ||
    u.includes(".ts") ||
    u.includes(".m4s") ||
    u.includes(".mp4") ||
    u.includes(".mkv") ||
    u.includes("/api/stream/") ||
    u.includes("/stream/")
  );
}

function isMediaUrl(urlStr, cfg) {
  if (isVideoStreamUrl(urlStr, cfg)) return false;
  if (cfg?.responseType === "arraybuffer" || cfg?.responseType === "buffer") {
    return true;
  }
  if (!urlStr) return false;
  const url = String(urlStr).toLowerCase();
  return (
    url.includes(".webp") ||
    url.includes(".jpg") ||
    url.includes(".jpeg") ||
    url.includes(".png") ||
    url.includes(".gif") ||
    url.includes(".css") ||
    url.includes(".js") ||
    url.includes("/uploads/") ||
    url.includes("/snapshots/") ||
    url.includes("/posters/") ||
    url.includes("/covers/")
  );
}

function shouldBypassUrl(urlStr, refererStr) {
  if (!urlStr && !refererStr) return false;
  return isBypassableUrl(urlStr, refererStr);
}

function isCloudflareResponse(response) {
  if (!response) return false;
  const status = response.status;
  if (status !== 403 && status !== 503) return false;
  const headers = response.headers || {};
  const server = String(headers["server"] || "").toLowerCase();
  if (server.includes("cloudflare")) return true;
  if (
    headers["cf-ray"] ||
    headers["cf-mitigated"] ||
    headers["cf-cache-status"] ||
    headers["cf-chl-bypass"]
  ) {
    return true;
  }
  if (typeof response.data === "string") {
    return isCloudflareChallengeText(response.data);
  }
  return false;
}

function isCloudflareChallengeText(text) {
  if (!text || typeof text !== "string") return false;
  const lower = text.toLowerCase();
  return (
    lower.includes("just a moment") ||
    lower.includes("attention required") ||
    lower.includes("enable javascript") ||
    lower.includes("cf-challenge") ||
    lower.includes("challenge-running") ||
    lower.includes("challenge-stage") ||
    lower.includes("turnstile-wrapper") ||
    lower.includes("cf-chl-widget") ||
    lower.includes("cf-challenge-running") ||
    lower.includes('class="challenge-form"') ||
    lower.includes("cf-turnstile") ||
    lower.includes("challenges.cloudflare.com") ||
    lower.includes("verifying you are human") ||
    lower.includes("checking your browser")
  );
}

function isPageLoadedForDomain(domain, title, html) {
  if (!html || typeof html !== "string") return false;
  if (isCloudflareChallengeText(title) || isCloudflareChallengeText(html)) {
    return false;
  }
  return isExtensionPageLoaded(domain, title, html);
}

function pageLooksLikeChallenge(title, html, domain = "") {
  const checkTitle =
    title && title.startsWith("StrawVerse -") ? "" : title || "";
  // Always check Cloudflare challenge signatures first!
  if (isCloudflareChallengeText(checkTitle)) return true;
  if (isCloudflareChallengeText(html)) return true;

  if (domain && isPageLoadedForDomain(domain, checkTitle, html)) return false;

  if (html) {
    const trimmed = html.trim().toLowerCase();
    if (
      trimmed.includes("<pre") ||
      trimmed.startsWith("{") ||
      trimmed.startsWith("[")
    ) {
      return false;
    }
  }

  const isChallengeStatus =
    global.LastScrapperResponseCode === 403 ||
    global.LastScrapperResponseCode === 503;
  return (
    isChallengeStatus &&
    (!checkTitle ||
      checkTitle.toLowerCase().includes("just a moment") ||
      checkTitle.toLowerCase().includes("cloudflare") ||
      checkTitle.toLowerCase().includes("attention required"))
  );
}

function pageLooksLikeError(title, html, domain = "") {
  if (domain && isPageLoadedForDomain(domain, title, html)) return false;
  if (isCloudflareChallengeText(title) || isCloudflareChallengeText(html)) {
    return false;
  }
  const lowerTitle = (title || "").toLowerCase();
  const lowerHtml = (html || "").toLowerCase();
  if (html && html.length > 300) {
    return (
      lowerTitle.includes("403") ||
      lowerTitle.includes("forbidden") ||
      lowerTitle.includes("404") ||
      lowerTitle.includes("not found") ||
      lowerHtml.includes("access denied") ||
      lowerHtml.includes("error code 1020")
    );
  }
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
    const rows = await queryAll(
      "SELECT name, value, domain, path, secure, httpOnly, expirationDate, local_saved_at FROM cookie",
    );
    if (!rows || rows.length === 0) return;
    if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) return;

    const sess = global.ScrapperWindow.webContents?.session;
    if (!sess) return;
    const now = Date.now();
    let restoredCount = 0;

    for (const row of rows) {
      if (!row.name || !row.value || !row.domain) continue;
      const exp = Number(row.expirationDate);
      if (exp && exp < now) continue;
      const savedAt = Number(row.local_saved_at);
      if (
        row.name === "cf_clearance" &&
        savedAt &&
        Math.abs(now - savedAt) > 2 * 60 * 60 * 1000
      ) {
        continue;
      }

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
  if (!isElectron || !BrowserWindow) {
    // On Android/Capacitor, bypass is handled natively via global.cloudflarebypass
    return;
  }
  global.LastScrapperResponseCode = 200;
  const winOpts = {
    width: 850,
    height: 650,
    center: true,
    title: "StrawVerse - Verification",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true,
      backgroundThrottling: false,
      partition: "persist:scrapper",
      autoplayPolicy: "user-gesture-required",
    },
  };
  if (global.win && !global.win.isDestroyed()) {
    winOpts.parent = global.win;
  }
  global.ScrapperWindow = new BrowserWindow(winOpts);

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
      try {
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
        } else if (!rawReferer && referer) {
          setRefererHeaders(details.requestHeaders, referer);
        }
        if (userAgent) {
          takeHeaderCaseInsensitive(details.requestHeaders, "user-agent");
          details.requestHeaders["User-Agent"] = userAgent;
        }
        if (secChUa) details.requestHeaders["sec-ch-ua"] = secChUa;
        if (secChMobile)
          details.requestHeaders["sec-ch-ua-mobile"] = secChMobile;
        if (secChPlatform)
          details.requestHeaders["sec-ch-ua-platform"] = secChPlatform;
        mergeCookie(details.requestHeaders, Cookie);

        callback({ requestHeaders: details.requestHeaders });
      } catch (_) {
        callback({ requestHeaders: details.requestHeaders });
      }
    },
  );

  global.ScrapperWindow.webContents.session.webRequest.onHeadersReceived(
    { urls: ["*://*/*"] },
    (details, callback) => {
      try {
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
      } catch (_) {
        callback({ responseHeaders: details.responseHeaders });
      }
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
      hideScrapperWindow();
    }
  });

  global.ScrapperWindow.on("closed", () => {
    global.ScrapperWindow = null;
  });
}

function showScrapperWindow() {
  if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) return;
  try {
    if (global.win && !global.win.isDestroyed()) {
      try {
        global.ScrapperWindow.setParentWindow(global.win);
      } catch (_) {}
    }
    global.ScrapperWindow.setTitle("StrawVerse - Verification");
    global.ScrapperWindow.setAlwaysOnTop(true);
    if (global.ScrapperWindow.isMinimized()) {
      global.ScrapperWindow.restore();
    }
    global.ScrapperWindow.show();
    global.ScrapperWindow.focus();
    global.ScrapperWindow.moveTop();
  } catch (e) {
    console.error("[ScrapperWindow] Failed to show window:", e);
  }
}

function hideScrapperWindow() {
  if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) return;
  try {
    global.ScrapperWindow.setAlwaysOnTop(false);
    try {
      global.ScrapperWindow.setParentWindow(null);
    } catch (_) {}
    global.ScrapperWindow.hide();
  } catch (_) {}
}

async function safeNavigateWindow(
  win,
  url,
  referrer = null,
  timeoutMs = 10000,
) {
  if (!win || win.isDestroyed()) return false;
  const navOpts = {};
  if (referrer) navOpts.httpReferrer = referrer;
  let timer = null;
  const timeoutPromise = new Promise((resolve) => {
    timer = setTimeout(() => resolve("timeout"), timeoutMs);
  });
  const loadPromise = win.loadURL(url, navOpts).catch(() => null);
  try {
    const res = await Promise.race([loadPromise, timeoutPromise]);
    return res !== "timeout";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const BYPASS_TASK_TIMEOUT_MS = 90000;
let currentBypassTaskId = 0;

async function processBypassQueue() {
  if (bypassBusy || bypassQueue.length === 0) return;
  bypassBusy = true;
  const taskId = ++currentBypassTaskId;
  const { runBypass, resolve, reject } = bypassQueue.shift();
  let done = false;
  const finish = (fn, val) => {
    if (done) return;
    done = true;
    clearTimeout(timer);
    fn(val);
  };
  const timer = setTimeout(() => {
    if (!done && currentBypassTaskId === taskId) {
      finish(reject, new Error("Bypass queue task timed out after 90s"));
      bypassBusy = false;
      processBypassQueue();
    }
  }, BYPASS_TASK_TIMEOUT_MS);
  // Unref so a wedged task alone never keeps the process alive.
  if (timer && typeof timer.unref === "function") timer.unref();
  try {
    const result = await runBypass();
    if (!done && currentBypassTaskId === taskId) {
      finish(resolve, result);
    }
  } catch (err) {
    if (!done && currentBypassTaskId === taskId) {
      finish(reject, err);
    }
  } finally {
    if (currentBypassTaskId === taskId && bypassBusy) {
      clearTimeout(timer);
      bypassBusy = false;
      processBypassQueue();
    }
  }
}

function queueBypass(runBypass) {
  return new Promise((resolve, reject) => {
    bypassQueue.push({ runBypass, resolve, reject });
    processBypassQueue();
  });
}

async function hasValidClearance(domain) {
  try {
    const cleanDom = normalizeHostname(domain);
    const row = await queryOne(
      "SELECT expirationDate, local_saved_at FROM cookie WHERE (id = ? OR name = 'cf_clearance' OR domain = ? OR domain = '.' || ? OR ? LIKE '%.' || domain OR domain LIKE '%.' || ?) AND name != 'user_agent' ORDER BY CAST(local_saved_at AS REAL) DESC LIMIT 1",
      [`${cleanDom}-cf_clearance`, cleanDom, cleanDom, cleanDom, cleanDom],
    );
    if (row) {
      const savedAt = Number(row.local_saved_at);
      const now = Date.now();
      if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) return true;
    }
  } catch (e) {}
  return false;
}

global.cloudflarebypass = async (targetUrl, force = false, referer = null) => {
  if (!global.ScrapperWindow)
    throw new Error("Global ScrapperWindow is not initialized");

  const domain = getDomain(targetUrl);
  let isValid = false;

  try {
    const row = await queryOne(
      "SELECT expirationDate, local_saved_at FROM cookie WHERE id = ? OR (name = 'cf_clearance' AND (? = domain OR ? = LTRIM(domain, '.') OR ? LIKE '%.' || LTRIM(domain, '.'))) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
      [`${domain}-cf_clearance`, domain, domain, domain],
    );
    if (row) {
      const savedAt = Number(row.local_saved_at);
      const now = Date.now();
      if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) {
        isValid = true;
      }

      if (savedAt && Math.abs(now - savedAt) < 60 * 1000 && !force) {
        console.log(
          `[Bypass] Clearance for ${domain} was obtained recently (${Math.round(Math.abs(now - savedAt) / 1000)}s ago), skipping redundant bypass.`,
        );
        return;
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
    !force &&
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

      let navUrl = targetUrl;

      if (force) {
        showScrapperWindow();
      }

      // Reset window state so title and DOM do not retain stale state
      try {
        await safeNavigateWindow(
          global.ScrapperWindow,
          "about:blank",
          null,
          2000,
        );
        global.ScrapperWindow.setTitle("StrawVerse - Verification");
      } catch (_) {}

      const navReferer = referer || navUrl;
      const navOk = await safeNavigateWindow(
        global.ScrapperWindow,
        navUrl,
        navReferer,
        15000,
      );

      const curUrl = global.ScrapperWindow.webContents.getURL() || "";
      if (
        !navOk &&
        (!curUrl ||
          curUrl === "about:blank" ||
          curUrl.startsWith("chrome-error://"))
      ) {
        console.warn(
          `[Bypass] Could not navigate to ${navUrl} (host unreachable). Aborting bypass.`,
        );
        return;
      }

      let initialClearanceValue = null;
      try {
        const preCookies =
          await global.ScrapperWindow.webContents.session.cookies.get({});
        initialClearanceValue =
          preCookies.find(
            (c) =>
              c.name === "cf_clearance" &&
              cookieMatchesDomain(c.domain, domain),
          )?.value || null;
      } catch (_) {}

      for (let i = 0; i < 60; i++) {
        const sessionCookies =
          await global.ScrapperWindow.webContents.session.cookies.get({});
        const clearanceCookie = sessionCookies.find(
          (cookie) =>
            cookie.name === "cf_clearance" &&
            cookieMatchesDomain(cookie.domain, domain),
        );
        const hasFreshClearance =
          Boolean(clearanceCookie) &&
          (!initialClearanceValue ||
            clearanceCookie.value !== initialClearanceValue);

        const title = global.ScrapperWindow.getTitle() || "";

        let html = "";
        try {
          html = await global.ScrapperWindow.webContents.executeJavaScript(
            "document.documentElement.outerHTML",
          );
        } catch (e) {}

        const isChallenge = pageLooksLikeChallenge(title, html, domain);
        const isHttpBlocked =
          global.LastScrapperResponseCode === 403 ||
          global.LastScrapperResponseCode === 503;

        if (isChallenge || isHttpBlocked) {
          showScrapperWindow();
        }

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

        const currentWebUrl = global.ScrapperWindow.webContents.getURL() || "";
        const isNotInitialShell =
          Boolean(currentWebUrl) &&
          currentWebUrl !== "about:blank" &&
          !currentWebUrl.startsWith("chrome-error://");

        const isExtLoaded = isPageLoadedForDomain(domain, title, html);

        if (!isChallenge && !isHttpBlocked) {
          if (hasFreshClearance || clearanceCookie) {
            console.log(
              `[Bypass] Solved challenge and obtained cf_clearance for ${domain}: "${title}"`,
            );
            break;
          }

          if (
            isExtLoaded ||
            (isNotInitialShell &&
              !isWindowLoading &&
              html &&
              html.length > 500 &&
              !pageLooksLikeError(title, html, domain))
          ) {
            console.log(`[Bypass] Destination page ready: "${title}"`);
            break;
          }

          if (pageLooksLikeError(title, html, domain) && i >= 5) {
            console.warn(
              `[Bypass] Non-challenge error encountered on ${navUrl} ("${title}"). Aborting bypass.`,
            );
            break;
          }
        }

        await sleep(1000);
      }

      await saveClearanceCookiesForDomain(domain);

      const finalCookies =
        await global.ScrapperWindow.webContents.session.cookies.get({});
      const gotClearance = finalCookies.some(
        (c) =>
          c.name === "cf_clearance" && cookieMatchesDomain(c.domain, domain),
      );
      const title = global.ScrapperWindow.getTitle() || "";
      let finalHtml = "";
      try {
        finalHtml = await global.ScrapperWindow.webContents.executeJavaScript(
          "document.documentElement.outerHTML",
        );
      } catch (_) {}
      const isExtLoaded = isPageLoadedForDomain(domain, title, finalHtml);
      const isStillChallenge =
        pageLooksLikeChallenge(title, finalHtml, domain) ||
        (!gotClearance &&
          (global.LastScrapperResponseCode === 403 ||
            global.LastScrapperResponseCode === 503));

      hideScrapperWindow();

      if (
        (gotClearance ||
          (!isStillChallenge &&
            isExtLoaded &&
            global.LastScrapperResponseCode === 200) ||
          (!pageLooksLikeError(title, finalHtml, domain) &&
            finalHtml.length > 500 &&
            global.LastScrapperResponseCode === 200)) &&
        !isStillChallenge
      ) {
        delete bypassCooldowns[domain];
        console.log(
          `[Bypass] Successfully bypassed / loaded destination page for ${domain} (title: "${title}")`,
        );
      } else {
        bypassCooldowns[domain] = Date.now() + 15 * 1000;
        console.warn(
          `[Bypass] Failed to solve challenge for ${domain}. Cooldown set for 15s.`,
        );
        if (global.ScrapperWindow && !global.ScrapperWindow.isDestroyed()) {
          global.ScrapperWindow.loadURL("about:blank").catch(() => {});
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

global.scrapperFetch = (url, options = {}) => {
  return queueBypass(async () => {
    if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) {
      throw new Error("ScrapperWindow is not initialized");
    }
    const fetchOptions = { ...options, credentials: "include" };
    try {
      const parentDom = getDomain(url);
      const targetOrigin = parentDom
        ? `https://${parentDom}`
        : new URL(url).origin;
      const currentUrl = global.ScrapperWindow.webContents.getURL() || "";

      const isGet =
        !fetchOptions.method || fetchOptions.method.toUpperCase() === "GET";
      const cleanCurrent = currentUrl.replace(/#.*$/, "").replace(/\/$/, "");
      const cleanTarget = url.replace(/#.*$/, "").replace(/\/$/, "");
      if (isGet && cleanCurrent === cleanTarget) {
        const domHtml =
          await global.ScrapperWindow.webContents.executeJavaScript(
            "document.documentElement ? document.documentElement.outerHTML : ''",
          );
        if (
          domHtml &&
          domHtml.length > 500 &&
          !pageLooksLikeChallenge("", domHtml, parentDom)
        ) {
          return domHtml;
        }
      }

      if (!currentUrl.startsWith(targetOrigin)) {
        await safeNavigateWindow(
          global.ScrapperWindow,
          targetOrigin + "/",
          null,
          10000,
        );
        for (let w = 0; w < 20; w++) {
          const t = global.ScrapperWindow.getTitle() || "";
          let readyState = "loading";
          try {
            readyState =
              await global.ScrapperWindow.webContents.executeJavaScript(
                "document.readyState",
              );
          } catch (e) {}
          if (
            t &&
            !isCloudflareChallengeText(t) &&
            !global.ScrapperWindow.webContents.isLoading() &&
            readyState !== "loading"
          ) {
            break;
          }
          await sleep(500);
        }

        const currentTitle = global.ScrapperWindow.getTitle() || "";
        if (isCloudflareChallengeText(currentTitle)) {
          return null;
        }
      }
    } catch (e) {}

    if (fetchOptions.headers) {
      const sanitized = {};
      for (const [k, v] of Object.entries(fetchOptions.headers)) {
        const kl = k.toLowerCase();
        if (kl !== "referer" && kl !== "cookie" && kl !== "host") {
          sanitized[k] = v;
        }
      }
      fetchOptions.headers = sanitized;
    }

    const js = `
      (async () => {
        try {
          const ctrl = new AbortController();
          const t = setTimeout(() => ctrl.abort(), 25000);
          const res = await fetch(${JSON.stringify(url)}, { ...${JSON.stringify(fetchOptions)}, signal: ctrl.signal });
          clearTimeout(t);
          return JSON.stringify({ status: res.status, headers: Object.fromEntries(res.headers.entries()), text: await res.text() });
        } catch (err) {
          return "__FETCH_ERR__:" + err.message;
        }
      })()
    `;

    try {
      const raw = await Promise.race([
        global.ScrapperWindow.webContents.executeJavaScript(js),
        sleep(30000).then(() => "__FETCH_ERR__:execute timeout"),
      ]);
      if (typeof raw === "string" && raw.startsWith("__FETCH_ERR__:")) {
        console.error(`[scrapperFetch] Browser fetch failed:`, raw);
        return null;
      }
      try {
        const parsed = JSON.parse(raw);
        if (parsed.status && parsed.status >= 400) {
          console.warn(
            `[scrapperFetch] In-page fetch returned status ${parsed.status} for URL: ${url}`,
          );
          if (parsed.status === 403 || parsed.status === 503) {
            return null;
          }
          return JSON.stringify(parsed);
        }
        return parsed.text;
      } catch (e) {
        return raw;
      }
    } catch (e) {
      console.error(`[scrapperFetch] executeJavaScript failed:`, e.message);
      return null;
    }
  });
};

global.scrapperFetchDataUrl = (url) => {
  return queueBypass(async () => {
    try {
      const resolvedHeaders = getHeaders(url);
      const res = await net.fetch(url, {
        headers: {
          ...resolvedHeaders,
          Accept:
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      });
      if (res.ok) {
        const buffer = await res.arrayBuffer();
        const ct = res.headers.get("content-type") || "image/jpeg";
        const base64 = Buffer.from(buffer).toString("base64");
        return `data:${ct};base64,${base64}`;
      }
    } catch (_) {}

    if (!global.ScrapperWindow || global.ScrapperWindow.isDestroyed()) {
      return null;
    }
    try {
      const parentDom = getDomain(url);
      const targetOrigin = parentDom
        ? `https://${parentDom}`
        : new URL(url).origin;
      const currentUrl = global.ScrapperWindow.webContents.getURL() || "";
      if (!currentUrl.startsWith(targetOrigin)) {
        await safeNavigateWindow(
          global.ScrapperWindow,
          targetOrigin + "/",
          null,
          10000,
        );
      }
      const js = `
        (async () => {
          try {
            const ctrl = new AbortController();
            const t = setTimeout(() => ctrl.abort(), 6000);
            const res = await fetch(${JSON.stringify(url)}, { credentials: "include", signal: ctrl.signal });
            clearTimeout(t);
            if (res.ok) {
              const blob = await res.blob();
              return new Promise((resolve) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.onerror = () => resolve(null);
                reader.readAsDataURL(blob);
              });
            }
          } catch (_) {}
          return null;
        })()
      `;
      const dataUrl = await Promise.race([
        global.ScrapperWindow.webContents.executeJavaScript(js),
        sleep(8000).then(() => null),
      ]);
      return dataUrl;
    } catch (_) {
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

function shouldUseDirectHttp(config) {
  return config?.strawverseDirectHttp === true;
}

async function directHttpRequest(config, requestHeaders) {
  const options = {
    method: String(config.method || "get").toUpperCase(),
    headers: requestHeaders,
  };

  if (config.data) {
    options.body =
      typeof config.data === "object"
        ? JSON.stringify(config.data)
        : config.data;
  }

  const controller = new AbortController();
  options.signal = controller.signal;
  const timeoutMs = config.timeout > 0 ? config.timeout : 20000;
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await globalThis.fetch(config.url, options);
    const responseHeaders = {};
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
    const responseData =
      config.responseType === "arraybuffer"
        ? Buffer.from(await res.arrayBuffer())
        : await res.text();
    const response = {
      data: responseData,
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      config,
      request: null,
    };

    if (!res.ok) {
      const error = new Error(`Request failed with status code ${res.status}`);
      error.response = response;
      error.config = config;
      throw error;
    }

    return response;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(`timeout of ${timeoutMs}ms exceeded`);
      timeoutError.code = "ECONNABORTED";
      timeoutError.config = config;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function androidNativeAdapter(config) {
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

      if (shouldUseDirectHttp(config)) {
        resolve(await directHttpRequest(config, requestHeaders));
        return;
      }

      if (global.sendNativeRequest) {
        try {
          const nativeConfig = {
            url,
            method: method.toUpperCase(),
            headers: requestHeaders,
            data: typeof data === "object" ? JSON.stringify(data) : data,
            responseType: "arraybuffer",
          };
          const res = await global.sendNativeRequest(nativeConfig);
          const responseHeaders = {};
          if (res.headers) {
            for (const [k, v] of Object.entries(res.headers)) {
              responseHeaders[k.toLowerCase()] = v;
            }
          }

          let responseData;
          const buf = Buffer.from(res.data, res.isBase64 ? "base64" : "utf-8");
          if (responseType === "arraybuffer") {
            responseData = buf;
          } else {
            const text = buf.toString("utf-8");
            const contentType = responseHeaders["content-type"] || "";
            if (contentType.includes("application/json")) {
              try {
                responseData = JSON.parse(text);
              } catch (e) {
                responseData = text;
              }
            } else {
              responseData = text;
            }
          }

          const response = {
            data: responseData,
            status: res.status,
            statusText: "",
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
          return;
        } catch (err) {
          if (err.response) {
            const res = err.response;
            const responseHeaders = {};
            if (res.headers) {
              for (const [k, v] of Object.entries(res.headers)) {
                responseHeaders[k.toLowerCase()] = v;
              }
            }
            const buf = Buffer.from(
              res.data,
              res.isBase64 ? "base64" : "utf-8",
            );
            const response = {
              data:
                responseType === "arraybuffer" ? buf : buf.toString("utf-8"),
              status: res.status,
              statusText: "",
              headers: responseHeaders,
              config,
              request: null,
            };
            const error = new Error(
              `Request failed with status code ${res.status}`,
            );
            error.response = response;
            error.config = config;
            reject(error);
          } else {
            logger.warn(
              `[scrapper] Native request failed for ${url} (${err.message}). Falling back to direct HTTP fetch...`,
            );
            try {
              resolve(await directHttpRequest(config, requestHeaders));
              return;
            } catch (fallbackErr) {
              reject(err);
              return;
            }
          }
          return;
        }
      }

      // Fallback if not running inside Android
      const options = {
        method: method.toUpperCase(),
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

      let timeoutId;
      if (timeout && timeout > 0) {
        const controller = new AbortController();
        options.signal = controller.signal;
        timeoutId = setTimeout(() => {
          controller.abort();
        }, timeout);
      }

      try {
        const res = await globalThis.fetch(url, options);
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

      const reqReferer =
        requestHeaders.Referer ||
        requestHeaders.referer ||
        getHeaderCaseInsensitive(requestHeaders, "referer") ||
        "";

      try {
        const domain = new URL(url).hostname.replace("www.", "");
        const hasClearance =
          (await hasValidClearance(domain)) || Boolean(config._retry);

        if (
          shouldBypassUrl(url, reqReferer) &&
          !isMediaUrl(url, config) &&
          !isVideoStreamUrl(url, config) &&
          global.scrapperFetch &&
          hasClearance
        ) {
          const fetchHeaders = {
            Accept: "application/json, text/plain, */*",
          };
          for (const [k, v] of Object.entries(requestHeaders)) {
            const kl = k.toLowerCase();
            if (
              kl === "x-requested-with" ||
              kl === "accept" ||
              kl === "content-type"
            ) {
              fetchHeaders[k] = v;
            }
          }
          const fetchOpts = {
            headers: fetchHeaders,
          };
          if (method && method.toUpperCase() !== "GET") {
            fetchOpts.method = method.toUpperCase();
            if (data) {
              fetchOpts.body =
                typeof data === "string" ? data : JSON.stringify(data);
            }
          }
          const resultText = await global.scrapperFetch(url, fetchOpts);
          if (resultText && !isCloudflareChallengeText(resultText)) {
            let responseData = resultText;
            if (responseType !== "arraybuffer") {
              try {
                responseData = JSON.parse(resultText);
              } catch (e) {}
            }
            if (
              responseData &&
              typeof responseData === "object" &&
              responseData.status &&
              responseData.status >= 400
            ) {
              const statusErr = new Error(
                `Request failed with status code ${responseData.status}`,
              );
              statusErr.response = {
                status: responseData.status,
                data: responseData.text || responseData,
                headers: responseData.headers || {},
              };
              statusErr.config = config;
              return reject(statusErr);
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
        if (
          lower.startsWith("sec-") ||
          lower === "host" ||
          lower === "origin" ||
          lower === "connection" ||
          lower === "keep-alive" ||
          lower === "accept-encoding" ||
          (method &&
            method.toUpperCase() === "GET" &&
            lower === "content-length")
        ) {
          delete requestHeaders[key];
        }
      });

      if (reqReferer) {
        delete requestHeaders.referer;
        requestHeaders["x-proxy-referer"] = reqReferer;
        requestHeaders["Referer"] = reqReferer;
      }

      const targetSession = session.fromPartition("persist:scrapper");
      const userAgentToUse =
        requestHeaders["User-Agent"] ||
        requestHeaders["user-agent"] ||
        global.deviceUserAgent;
      if (userAgentToUse && typeof targetSession.setUserAgent === "function") {
        targetSession.setUserAgent(userAgentToUse);
      }

      const options = {
        method: method.toUpperCase(),
        session: targetSession,
        credentials: "include",
        headers: requestHeaders,
      };

      if (reqReferer) {
        options.referrer = reqReferer;
        options.referrerPolicy = "unsafe-url";
      }

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
          err.config = config;
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
  adapter: isElectron ? electronNetAdapter : androidNativeAdapter,
  timeout: 20000,
});
global.axios.interceptors.request.use(
  async (config) => {
    const headers = getHeaders(config.url, config.method);
    if (config.headers) {
      if (headers["User-Agent"]) {
        const callerUA = getHeaderCaseInsensitive(config.headers, "user-agent");
        takeHeaderCaseInsensitive(config.headers, "user-agent");
        if (callerUA) headers["User-Agent"] = callerUA;
      }
      const callerRef = getHeaderCaseInsensitive(config.headers, "referer");
      takeHeaderCaseInsensitive(config.headers, "referer");
      if (callerRef) headers["Referer"] = callerRef;
      const callerCookie = getHeaderCaseInsensitive(config.headers, "cookie");
      if (config.skipCookie || callerCookie === "") {
        delete headers["Cookie"];
        takeHeaderCaseInsensitive(config.headers, "cookie");
      } else if (headers["Cookie"]) {
        const existingCookie = takeHeaderCaseInsensitive(
          config.headers,
          "cookie",
        );
        if (existingCookie) {
          mergeCookie(headers, existingCookie);
        }
      }
      const callerAccept = getHeaderCaseInsensitive(config.headers, "accept");
      if (callerAccept) {
        headers["Accept"] = callerAccept;
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
  const callerReferer =
    existing.Referer ||
    existing.referer ||
    getHeaderCaseInsensitive(existing, "referer") ||
    "";
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
  const fresh = { ...existing, ...getHeaders(url, method) };
  if (callerReferer) {
    takeHeaderCaseInsensitive(fresh, "referer");
    fresh["Referer"] = callerReferer;
  }
  return fresh;
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
    const reqReferer =
      config?.headers?.Referer ||
      config?.headers?.referer ||
      (config?.headers?.get && config.headers.get("referer")) ||
      "";

    if (
      response &&
      (response.status === 403 || response.status === 503) &&
      isCloudflareResponse(response) &&
      config &&
      !config._retry &&
      !config.skipBypass &&
      !isVideoStreamUrl(config.url, config) &&
      !isMediaUrl(config.url, config) &&
      global?.cloudflarebypass &&
      shouldBypassUrl(config.url, reqReferer)
    ) {
      config._retry = true;
      try {
        const domain = new URL(config.url).hostname.replace("www.", "");
        if (global.clearCookieCache) global.clearCookieCache(domain);
      } catch (e) {}
      console.log(
        `Cloudflare challenge detected (status: ${response.status}) for ${config.url}. Retrying with bypass...`,
      );
      try {
        const referer = reqReferer;
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
