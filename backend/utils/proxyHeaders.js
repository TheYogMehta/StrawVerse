const { run, queryAll, runUpsertCompat } = require("./db");
const {
  getExtensionHeaderRules,
  getCookieDomains,
  getCanonicalDomain,
} = require("./extensionRegistry");

const cookieCache = global.proxyCookieCache || (global.proxyCookieCache = {});
const refererCache =
  global.proxyRefererCache || (global.proxyRefererCache = {});
const uaCache = global.proxyUaCache || (global.proxyUaCache = {});
const hintsCache = global.proxyHintsCache || (global.proxyHintsCache = {});

function normalizeDomain(domain) {
  if (!domain) return null;
  try {
    if (domain.startsWith("http://") || domain.startsWith("https://")) {
      return new URL(domain).hostname.replace(/^www\./, "");
    }
  } catch (e) {}
  return String(domain)
    .replace(/^www\./, "")
    .toLowerCase();
}

function normalizeReferer(referer) {
  if (!referer) return null;
  try {
    const refUrl = new URL(referer);
    if (refUrl.protocol !== "http:" && refUrl.protocol !== "https:") {
      return null;
    }
    return refUrl.origin + "/";
  } catch (e) {
    return null;
  }
}

function deleteHeaderCaseInsensitive(headers, name) {
  if (!headers || typeof headers !== "object") return;
  const target = String(name || "").toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === target) {
      delete headers[key];
    }
  }
}

function saveStreamReferer(domain, referer) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedReferer = normalizeReferer(referer);
  if (!normalizedDomain || !normalizedReferer) return;

  const domainsToSave = [normalizedDomain];
  const parts = normalizedDomain.split(".");
  if (parts.length > 2) {
    const rootDomain = parts.slice(-2).join(".");
    domainsToSave.push(rootDomain);
  }

  for (const d of domainsToSave) {
    if (refererCache[d] !== normalizedReferer) {
      refererCache[d] = normalizedReferer;
      try {
        runUpsertCompat(
          "INSERT INTO StreamReferer (domain, referer, updatedAt) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET referer = excluded.referer, updatedAt = excluded.updatedAt",
          [d, normalizedReferer, Date.now()],
          () =>
            run(
              "INSERT OR REPLACE INTO StreamReferer (domain, referer, updatedAt) VALUES (?, ?, ?)",
              [d, normalizedReferer, Date.now()],
            ),
        ).catch(() => {});
      } catch (e) {}
    }
  }

  try {
    run(
      `DELETE FROM StreamReferer
         WHERE domain NOT IN (
           SELECT domain FROM StreamReferer
           ORDER BY CASE WHEN domain = ? THEN 1 ELSE 0 END DESC, updatedAt DESC
           LIMIT ?
         )`,
      ["__fallback__", 1000],
    );
  } catch (e) {}
}

function getStoredStreamReferer(domain) {
  const normalizedDomain = normalizeDomain(domain);
  if (!normalizedDomain) return null;

  const parts = normalizedDomain.split(".");
  const candidates = [];
  for (let i = 0; i < parts.length - 1; i++) {
    candidates.push(parts.slice(i).join("."));
  }

  for (const candidate of candidates) {
    if (refererCache[candidate]) return refererCache[candidate];
  }
  return null;
}

global.setDynamicReferer = (domain, referer) => {
  saveStreamReferer(domain, referer);
};

global.setFallbackReferer = (referer) => {
  delete refererCache["__fallback__"];
  saveStreamReferer("__fallback__", referer);
};

async function initCache() {
  try {
    // Load referers
    const referers = await queryAll(
      "SELECT domain, referer FROM StreamReferer",
    );
    for (const ref of referers) {
      if (ref.domain && ref.referer) {
        refererCache[ref.domain] = ref.referer;
      }
    }

    // Load cookies, UAs, hints
    const now = Date.now();
    const rows = await queryAll(
      "SELECT id, name, domain, value, expirationDate, local_saved_at FROM cookie",
    );
    for (const row of rows) {
      const id = row.id;
      const name = row.name;
      const value = row.value;
      const domain =
        row.domain ||
        (id.endsWith("-user_agent")
          ? id.substring(0, id.length - 11)
          : id.substring(0, id.length - 13));

      if (name === "user_agent") {
        uaCache[domain] = value;
      } else if (name === "client_hints") {
        try {
          hintsCache[domain] = JSON.parse(value);
        } catch (e) {}
      } else if (name && value) {
        let exp = Number(row.expirationDate);
        if (exp > 0 && exp < 1e11) {
          exp = exp * 1000;
        }
        let savedAt = Number(row.local_saved_at);
        if (savedAt > 0 && savedAt < 1e11) {
          savedAt = savedAt * 1000;
        }
        let isValid = false;
        let expiryTime = 0;
        if (!isNaN(exp) && exp > 0) {
          if (exp > now) {
            isValid = true;
            expiryTime = exp;
          }
        } else if (!isNaN(savedAt) && savedAt > 0) {
          if (now - savedAt < 24 * 60 * 60 * 1000) {
            isValid = true;
            expiryTime = savedAt + 24 * 60 * 60 * 1000;
          }
        } else if (value) {
          isValid = true;
          expiryTime = now + 24 * 60 * 60 * 1000;
        }

        if (isValid) {
          const normDom = domain
            .replace(/^www\./, "")
            .replace(/^\./, "")
            .toLowerCase();
          cookieCache[normDom] = cookieCache[normDom] || {};
          cookieCache[normDom][name] = { value, expiry: expiryTime };
        }
      }
    }
  } catch (e) {
    console.error("[proxyHeaders] Failed to init memory cache:", e.message);
  }
}

function updateCache(domain, name, value, expirationDate, local_saved_at) {
  if (!domain) return;
  const cleanDom = domain
    .replace(/^www\./, "")
    .replace(/^\./, "")
    .toLowerCase();
  console.log(
    `[proxyHeaders] updateCache called: domain=${domain}, cleanDom=${cleanDom}, name=${name}, hasValue=${!!value}`,
  );

  if (name === "user_agent") {
    uaCache[cleanDom] = value;
  } else if (name === "client_hints") {
    try {
      hintsCache[cleanDom] =
        typeof value === "string" ? JSON.parse(value) : value;
    } catch (e) {}
  } else if (name) {
    if (!value) {
      if (cookieCache[cleanDom]) {
        delete cookieCache[cleanDom][name];
      }
      return;
    }
    let exp = Number(expirationDate);
    if (exp > 0 && exp < 1e11) {
      exp = exp * 1000;
    }
    let savedAt = Number(local_saved_at);
    if (savedAt > 0 && savedAt < 1e11) {
      savedAt = savedAt * 1000;
    }
    const now = Date.now();
    let isValid = false;
    let expiryTime = 0;
    if (!isNaN(exp) && exp > 0) {
      if (exp > now) {
        isValid = true;
        expiryTime = exp;
      }
    } else if (!isNaN(savedAt) && savedAt > 0) {
      if (now - savedAt < 24 * 60 * 60 * 1000) {
        isValid = true;
        expiryTime = savedAt + 24 * 60 * 60 * 1000;
      }
    } else if (value) {
      isValid = true;
      expiryTime = now + 24 * 60 * 60 * 1000;
    }

    if (isValid) {
      cookieCache[cleanDom] = cookieCache[cleanDom] || {};
      cookieCache[cleanDom][name] = { value, expiry: expiryTime };
    } else if (cookieCache[cleanDom]) {
      delete cookieCache[cleanDom][name];
    }
  }
}

function getHeaders(url, method = "GET") {
  let cookieDomain = "";
  try {
    cookieDomain = new URL(url).hostname;
  } catch (e) {}

  let cleanDomain = "";
  if (cookieDomain) {
    cleanDomain = cookieDomain.replace("www.", "").toLowerCase();
    cleanDomain = getCanonicalDomain(cleanDomain);
  }

  const chromeVer = process.versions.chrome || "148.0.7778.218";
  let userAgent = global.deviceUserAgent;
  if (!userAgent) {
    if (process.platform === "linux") {
      userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else if (process.platform === "darwin") {
      userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else if (process.platform === "win32") {
      userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else {
      userAgent = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Mobile Safari/537.36`;
    }
  }

  const targetDomains = Array.from(
    new Set([cleanDomain, cookieDomain].filter(Boolean)),
  ).map((d) =>
    d
      .replace(/^www\./, "")
      .replace(/^\./, "")
      .toLowerCase(),
  );

  const extraCookieDomains = getCookieDomains(cleanDomain);
  if (extraCookieDomains.length > 0) {
    targetDomains.push(...extraCookieDomains);
  }

  // Load custom User-Agent if bypassed
  if (targetDomains.length > 0) {
    let matchedUA = null;
    for (const target of targetDomains) {
      for (const [dom, uaVal] of Object.entries(uaCache)) {
        const normDom = dom
          .replace(/^www\./, "")
          .replace(/^\./, "")
          .toLowerCase();
        if (
          target === normDom ||
          target.endsWith("." + normDom) ||
          normDom.endsWith("." + target)
        ) {
          matchedUA = uaVal;
          break;
        }
      }
      if (matchedUA) break;
    }
    if (matchedUA) {
      userAgent = matchedUA;
    }
  }

  const urlLower = String(url || "").toLowerCase();
  const isImage =
    urlLower.includes(".webp") ||
    urlLower.includes(".jpg") ||
    urlLower.includes(".jpeg") ||
    urlLower.includes(".png") ||
    urlLower.includes(".gif") ||
    urlLower.includes(".avif") ||
    urlLower.includes("/snapshots/") ||
    urlLower.includes("/uploads/") ||
    urlLower.includes("/posters/") ||
    urlLower.includes("/covers/");

  const headers = {
    "User-Agent": userAgent,
    Accept: isImage
      ? "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8"
      : "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // Load Client Hints if bypassed
  if (targetDomains.length > 0) {
    let matchedHints = null;
    for (const target of targetDomains) {
      for (const [dom, hintsVal] of Object.entries(hintsCache)) {
        const normDom = dom
          .replace(/^www\./, "")
          .replace(/^\./, "")
          .toLowerCase();
        if (
          target === normDom ||
          target.endsWith("." + normDom) ||
          normDom.endsWith("." + target)
        ) {
          matchedHints = hintsVal;
          break;
        }
      }
      if (matchedHints) break;
    }
    if (matchedHints) {
      for (const [k, v] of Object.entries(matchedHints)) {
        headers[k] = v;
      }
    }
  }

  // 1. Prioritize dynamically learned referer headers from extensions/scrapers/player
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    const ref = getStoredStreamReferer(domain);
    if (ref) headers.Referer = ref;
  } catch (e) {}

  // 2. Query extension registry for extension header rules & subrequest headers
  const extRules = getExtensionHeaderRules(url);
  if (extRules) {
    if (extRules.headers) {
      for (const [k, v] of Object.entries(extRules.headers)) {
        if (k.toLowerCase() === "referer") {
          if (!headers.Referer) headers.Referer = v;
        } else {
          headers[k] = v;
        }
      }
    }
    if (Array.isArray(extRules.strip) && extRules.strip.length > 0) {
      for (const h of extRules.strip) {
        deleteHeaderCaseInsensitive(headers, h);
      }
      headers._strip = extRules.strip;
    }
  }

  // 3. Fallback to origin if Referer is not explicitly stripped
  const isRefererStripped = headers._strip?.some(
    (h) => h.toLowerCase() === "referer",
  );
  if (!headers.Referer && !isRefererStripped) {
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
        headers.Referer = urlObj.origin + "/";
      }
    } catch (e) {}
  }

  if (!headers.Referer && !isRefererStripped) {
    if (refererCache["__fallback__"]) {
      headers.Referer = refererCache["__fallback__"];
    }
  }

  if (targetDomains.length > 0) {
    const now = Date.now();
    const cookiePairs = [];
    const seenNames = new Set();

    for (const [dom, domCookies] of Object.entries(cookieCache)) {
      const normDom = dom
        .replace(/^www\./, "")
        .replace(/^\./, "")
        .toLowerCase();
      const isMatch = targetDomains.some(
        (normTarget) =>
          normTarget === normDom ||
          normTarget.endsWith("." + normDom) ||
          normDom.endsWith("." + normTarget),
      );
      if (isMatch) {
        if (domCookies && typeof domCookies === "object") {
          for (const [cookieName, cookieObj] of Object.entries(domCookies)) {
            if (!seenNames.has(cookieName) && cookieObj?.value) {
              if (!cookieObj.expiry || cookieObj.expiry > now) {
                seenNames.add(cookieName);
                cookiePairs.push(`${cookieName}=${cookieObj.value}`);
              }
            }
          }
        }
      }
    }
    if (cookiePairs.length > 0) {
      headers.Cookie = cookiePairs.join("; ");
    }
  }

  const reqMethod = String(method).toUpperCase();
  if (headers.Referer && reqMethod !== "GET" && reqMethod !== "HEAD") {
    try {
      const refUrl = new URL(headers.Referer);
      if (refUrl.protocol === "http:" || refUrl.protocol === "https:") {
        headers.Origin = refUrl.origin;
      }
    } catch (e) {}
  }

  return headers;
}

global.clearCookieCache = (domain) => {
  if (!domain) return;
  const normalized = domain
    .replace(/^www\./, "")
    .replace(/^\./, "")
    .toLowerCase();
  for (const key of Object.keys(cookieCache)) {
    const normKey = key
      .replace(/^www\./, "")
      .replace(/^\./, "")
      .toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete cookieCache[key];
    }
  }
  for (const key of Object.keys(uaCache)) {
    const normKey = key
      .replace(/^www\./, "")
      .replace(/^\./, "")
      .toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete uaCache[key];
    }
  }
  for (const key of Object.keys(hintsCache)) {
    const normKey = key
      .replace(/^www\./, "")
      .replace(/^\./, "")
      .toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete hintsCache[key];
    }
  }
};

global.updateCookieCache = updateCache;

if (global.db) {
  initCache().catch(() => {});
}

module.exports = {
  getHeaders,
  initCache,
  updateCache,
};
