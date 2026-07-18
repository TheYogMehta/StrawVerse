const { queryOne, run } = require("./db");

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

function saveStreamReferer(domain, referer) {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedReferer = normalizeReferer(referer);
  if (!normalizedDomain || !normalizedReferer) return;
  if (refererCache[normalizedDomain] === normalizedReferer) return;
  refererCache[normalizedDomain] = normalizedReferer;

  try {
    run(
      "INSERT INTO StreamReferer (domain, referer, updatedAt) VALUES (?, ?, ?) ON CONFLICT(domain) DO UPDATE SET referer = excluded.referer, updatedAt = excluded.updatedAt",
      [normalizedDomain, normalizedReferer, Date.now()],
    );
    run(
      `DELETE FROM StreamReferer
         WHERE domain NOT IN (
           SELECT domain FROM StreamReferer
           ORDER BY CASE WHEN domain = ? THEN 1 ELSE 0 END DESC, updatedAt DESC
           LIMIT ?
         )`,
      ["__fallback__", 500],
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
    const { queryAll } = require("./db");

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
      } else if (name === "cf_clearance") {
        const exp = Number(row.expirationDate);
        const savedAt = Number(row.local_saved_at);
        const now = Date.now();
        let isValid = false;
        let expiryTime = now + 10 * 60 * 1000;
        if (exp > now) {
          isValid = true;
          expiryTime = exp;
        } else if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) {
          isValid = true;
          expiryTime = savedAt + 2 * 60 * 60 * 1000;
        }
        if (isValid) {
          cookieCache[domain] = { value, expiry: expiryTime };
        }
      }
    }
  } catch (e) {
    console.error("[proxyHeaders] Failed to init memory cache:", e.message);
  }
}

function updateCache(domain, name, value, expirationDate, local_saved_at) {
  if (!domain) return;
  const cleanDom = domain.replace("www.", "").toLowerCase();
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
  } else if (name === "cf_clearance") {
    const exp = Number(expirationDate);
    const savedAt = Number(local_saved_at);
    const now = Date.now();
    let isValid = false;
    let expiryTime = now + 10 * 60 * 1000;
    if (exp > now) {
      isValid = true;
      expiryTime = exp;
    } else if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) {
      isValid = true;
      expiryTime = savedAt + 2 * 60 * 60 * 1000;
    }
    if (isValid) {
      cookieCache[cleanDom] = { value, expiry: expiryTime };
    }
  }
}

function getHeaders(url, method = "GET") {
  let cookieDomain = "";
  try {
    cookieDomain = new URL(url).hostname;
  } catch (e) {}
  console.log(
    `[proxyHeaders] getHeaders called for: ${url}, method=${method}, cookieCacheKeys=${Object.keys(cookieCache)}`,
  );

  let cleanDomain = "";
  if (cookieDomain) {
    cleanDomain = cookieDomain.replace("www.", "").toLowerCase();
    if (cleanDomain.includes("animepahe")) {
      let tld = "pw";
      for (const cachedDomain of Object.keys(cookieCache)) {
        if (cachedDomain.includes("animepahe")) {
          const matchedDomain = cachedDomain.replace(/^\./, "");
          const domainParts = matchedDomain.split(".");
          tld = domainParts[domainParts.length - 1] || "pw";
          break;
        }
      }
      const hostParts = cookieDomain.split(".");
      hostParts[hostParts.length - 1] = tld;
      cookieDomain = hostParts.join(".");
      cleanDomain = cookieDomain;
    } else if (
      cleanDomain.includes("kwik.cx") ||
      cleanDomain.includes("owocdn.top") ||
      cleanDomain.includes("uwucdn.top")
    ) {
      cleanDomain = "animepahe.pw";
    }
  }

  const chromeVer = process.versions.chrome || "148.0.7778.218";
  let userAgent = global.deviceUserAgent;
  if (!userAgent) {
    if (process.platform === "linux") {
      userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else if (process.platform === "darwin") {
      userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
    } else {
      userAgent = `Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Mobile Safari/537.36`;
    }
  }

  // Load custom User-Agent if bypassed
  if (cookieDomain) {
    const normTarget = cleanDomain.replace(/^\./, "").toLowerCase();
    let matchedUA = null;
    for (const [dom, uaVal] of Object.entries(uaCache)) {
      const normDom = dom.replace(/^\./, "").toLowerCase();
      if (normTarget === normDom || normTarget.endsWith("." + normDom)) {
        matchedUA = uaVal;
        break;
      }
    }
    if (matchedUA) {
      userAgent = matchedUA;
    }
  }

  const headers = {
    "User-Agent": userAgent,
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };

  // Load Client Hints if bypassed
  if (cookieDomain) {
    const normTarget = cleanDomain.replace(/^\./, "").toLowerCase();
    let matchedHints = null;
    for (const [dom, hintsVal] of Object.entries(hintsCache)) {
      const normDom = dom.replace(/^\./, "").toLowerCase();
      if (normTarget === normDom || normTarget.endsWith("." + normDom)) {
        matchedHints = hintsVal;
        break;
      }
    }
    if (matchedHints) {
      for (const [k, v] of Object.entries(matchedHints)) {
        headers[k] = v;
      }
    }
  }

  // kwik - animepahe
  if (url.includes("owocdn.top") || url.includes("uwucdn.top")) {
    headers.Referer = "https://kwik.cx/";
  } else if (url.includes("kwik.cx")) {
    headers.Referer = "https://animepahe.pw/";
  }
  // animepahe
  else if (url.includes("animepahe")) {
    headers.Referer = "https://animepahe.pw/";
  }
  // weebcentral
  else if (
    url.includes("temp.compsci88.com") ||
    url.startsWith("https://temp.compsci88.com/")
  ) {
    headers.Referer = "https://weebcentral.com/";
  }
  // megaplay - anikoto
  else if (url.includes("anikototv.to") || url.includes("megaplay.buzz")) {
    headers.Referer = "https://anikototv.to/";
  } else if (url.includes("watching.onl") || url.includes("nekostream.site")) {
    headers.Referer = "https://megaplay.buzz/";
  }
  // all manga
  else if (
    url.includes("allmanga.to") ||
    url.includes("allanime.day") ||
    url.includes("youtube-anime.com")
  ) {
    headers.Referer = "https://allmanga.to/";
  }

  if (!headers.Referer) {
    try {
      const domain = new URL(url).hostname.replace("www.", "");
      const ref = getStoredStreamReferer(domain);
      if (ref) headers.Referer = ref;
    } catch (e) {}
  }

  if (!headers.Referer) {
    if (refererCache["__fallback__"]) {
      headers.Referer = refererCache["__fallback__"];
    }
  }

  const targetCookieDomain = cookieDomain;

  if (targetCookieDomain) {
    const normTarget = targetCookieDomain.replace(/^\./, "").toLowerCase();
    let cached = null;
    for (const [dom, cacheVal] of Object.entries(cookieCache)) {
      const normDom = dom.replace(/^\./, "").toLowerCase();
      if (normTarget === normDom || normTarget.endsWith("." + normDom)) {
        cached = cacheVal;
        break;
      }
    }
    if (cached && cached.expiry > Date.now()) {
      if (cached.value) {
        headers.Cookie = `cf_clearance=${cached.value};`;
      }
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
  const normalized = domain.replace(/^www\./, "").toLowerCase();
  for (const key of Object.keys(cookieCache)) {
    const normKey = key.replace(/^www\./, "").toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete cookieCache[key];
    }
  }
  for (const key of Object.keys(uaCache)) {
    const normKey = key.replace(/^www\./, "").toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete uaCache[key];
    }
  }
  for (const key of Object.keys(hintsCache)) {
    const normKey = key.replace(/^www\./, "").toLowerCase();
    if (
      normKey === normalized ||
      normKey.endsWith("." + normalized) ||
      normalized.endsWith("." + normKey)
    ) {
      delete hintsCache[key];
    }
  }
};

module.exports = {
  getHeaders,
  initCache,
  updateCache,
};
