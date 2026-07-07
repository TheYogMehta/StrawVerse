const { queryOne, run } = require("./db");

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

function getHeaders(url) {
  const chromeVer = process.versions.chrome || "148.0.7778.218";
  let userAgent = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  if (process.platform === "linux") {
    userAgent = `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  } else if (process.platform === "darwin") {
    userAgent = `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${chromeVer} Safari/537.36`;
  }

  const headers = {
    "User-Agent": userAgent,
  };

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
    if (cached && cached.expiry > Date.now()) {
      if (cached.value) {
        headers.Cookie = `cf_clearance=${cached.value};`;
      }
    } else {
      try {
        const row = queryOne(
          "SELECT value, expirationDate, local_saved_at FROM cookie WHERE (id = ? OR (name = 'cf_clearance' AND (? = domain OR ? LIKE '%.' || domain))) ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
          [`${cookieDomain}-cf_clearance`, cookieDomain, cookieDomain],
        );
        let isValid = false;
        let expiryTime = Date.now() + 10 * 60 * 1000;

        if (row && row.value) {
          const exp = Number(row.expirationDate);
          const savedAt = Number(row.local_saved_at);
          const now = Date.now();

          if (exp > now) {
            isValid = true;
            expiryTime = exp;
          } else if (savedAt && Math.abs(now - savedAt) < 2 * 60 * 60 * 1000) {
            isValid = true;
            expiryTime = savedAt + 2 * 60 * 60 * 1000;
          }
        }

        if (row && row.value && isValid) {
          headers.Cookie = `cf_clearance=${row.value};`;
          cookieCache[cookieDomain] = {
            value: row.value,
            expiry: expiryTime,
          };
        } else {
          cookieCache[cookieDomain] = {
            value: null,
            expiry: Date.now() + 30 * 1000,
          };
        }
      } catch (e) {
        // ignore
      }
    }
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
