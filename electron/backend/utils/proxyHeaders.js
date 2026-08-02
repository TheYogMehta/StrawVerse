const { queryOne, queryAll, run } = require("./db");

const cookieCache = {};
const refererCache = {};

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

  for (const candidate of candidates) {
    try {
      const row = queryOne(
        "SELECT referer FROM StreamReferer WHERE domain = ? LIMIT 1",
        [candidate],
      );
      if (row?.referer) {
        refererCache[candidate] = row.referer;
        return row.referer;
      }
    } catch (e) {}
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

function getHeaders(url, method = "GET") {
  const chromeVer = process.versions.chrome || "148.0.7778.218";
  let userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  if (process.platform === "linux") {
    userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  } else if (process.platform === "darwin") {
    userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  }

  const headers = {
    "User-Agent": userAgent,
    Accept: "application/json, text/plain, text/html, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Sec-CH-UA": `"Chromium";v="${chromeVer.split(".")[0]}", "Not=A?Brand";v="24"`,
    "Sec-CH-UA-Mobile": "?0",
    "Sec-CH-UA-Platform":
      process.platform === "win32"
        ? '"Windows"'
        : process.platform === "darwin"
          ? '"macOS"'
          : '"Linux"',
    "Sec-Fetch-Site": "same-origin",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
  };

  // 1. Prioritize dynamically learned referer headers from extensions/scrapers/player
  try {
    const domain = new URL(url).hostname.replace("www.", "");
    const ref = getStoredStreamReferer(domain);
    if (ref) headers.Referer = ref;
  } catch (e) {}

  // 2. Known static defaults (fallback if not dynamically stored yet)
  if (!headers.Referer) {
    if (url.includes("owocdn.top") || url.includes("uwucdn.top")) {
      headers.Referer = "https://kwik.cx/";
    } else if (url.includes("kwik.cx") || url.includes("animepahe")) {
      headers.Referer = "https://animepahe.pw/";
    } else if (
      url.includes("temp.compsci88.com") ||
      url.includes("weebcentral")
    ) {
      headers.Referer = "https://weebcentral.com/";
    } else if (url.includes("anikoto") || url.includes("megaplay.buzz")) {
      headers.Referer = "https://anikoto.to/";
    } else if (url.includes("anineko")) {
      headers.Referer = "https://anineko.to/";
    } else if (
      url.includes("allmanga") ||
      url.includes("allanime") ||
      url.includes("youtube-anime.com")
    ) {
      headers.Referer = "https://allmanga.to/";
    } else if (
      url.includes("watching.onl") ||
      url.includes("nekostream.site") ||
      url.includes("kotocdn.site") ||
      url.includes("livedns.my") ||
      url.includes("sugevideo.xyz") ||
      url.includes("trycloud.pro")
    ) {
      headers.Referer = "https://megaplay.buzz/";
    }
  }

  if (!headers.Referer) {
    try {
      const urlObj = new URL(url);
      if (urlObj.protocol === "http:" || urlObj.protocol === "https:") {
        headers.Referer = urlObj.origin + "/";
      }
    } catch (e) {}
  }

  if (!headers.Referer) {
    if (refererCache["__fallback__"]) {
      headers.Referer = refererCache["__fallback__"];
    } else {
      try {
        const hostname = new URL(url).hostname;
        if (!hostname.includes("localhost")) {
          const row = queryOne(
            "SELECT referer FROM StreamReferer WHERE domain = ? LIMIT 1",
            ["__fallback__"],
          );
          if (row?.referer) {
            refererCache["__fallback__"] = row.referer;
            headers.Referer = row.referer;
          }
        }
      } catch (e) {}
    }
  }

  let cookieDomain = "";
  try {
    cookieDomain = new URL(url).hostname;
  } catch (e) {}

  if (cookieDomain) {
    const cached = cookieCache[cookieDomain];
    if (cached && cached.expiry > Date.now() && cached.value) {
      headers.Cookie = cached.value;
    } else {
      try {
        let parentDomain = cookieDomain;
        if (
          cookieDomain.includes("owocdn.top") ||
          cookieDomain.includes("uwucdn.top")
        ) {
          parentDomain = "kwik.cx";
        } else if (cookieDomain.includes("animepahe")) {
          parentDomain = "animepahe.pw";
        }

        const rows = queryAll(
          `SELECT name, value, expirationDate, local_saved_at FROM cookie 
           WHERE (? = domain OR ? LIKE '%.' || domain OR ? = domain OR ? LIKE '%.' || domain)`,
          [cookieDomain, cookieDomain, parentDomain, parentDomain],
        );
        const validCookies = [];
        const seenNames = new Set();
        const now = Date.now();

        if (rows && rows.length > 0) {
          for (const row of rows) {
            if (!row.name || !row.value || seenNames.has(row.name)) continue;
            const exp = Number(row.expirationDate);
            const savedAt = Number(row.local_saved_at);
            let isValid = false;

            if (exp && exp > now) {
              isValid = true;
            } else if (
              savedAt &&
              Math.abs(now - savedAt) < 4 * 60 * 60 * 1000
            ) {
              isValid = true;
            } else if (!exp && !savedAt) {
              isValid = true;
            }

            if (isValid) {
              seenNames.add(row.name);
              validCookies.push(`${row.name}=${row.value}`);
            }
          }
        }

        if (validCookies.length > 0) {
          const cookieStr = validCookies.join("; ");
          headers.Cookie = cookieStr;
          cookieCache[cookieDomain] = {
            value: cookieStr,
            expiry: now + 5 * 60 * 1000,
          };
        }
      } catch (e) {
        // ignore
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
};

module.exports = {
  getHeaders,
};
