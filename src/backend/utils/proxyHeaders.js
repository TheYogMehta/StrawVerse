const { queryOne } = require("./db");

const ALLOWED_SCRAPING_SUBSTRINGS = [
  "ddos-guard",
  "apdoesnthavelogotheysaidapistooplaintheysaid",
  "api/fsearch",
  "megaplay",
  "jquery",
  "jsdelivr",
  ".m3u8",
  "megacloud",
  "rabbitstream",
  "jwpcdn",
  "cloudflare",
  "cdn-cgi",
  "allmanga",
  "allanime",
  "youtube-anime",
  "ytimgf",
  "kwik",
];

/**
 * Shared utility for resolving stream headers (Referer & User-Agent)
 * dynamically based on target stream URLs.
 */
function getHeaders(url) {
  let referer = "";
  let userAgent =
    global.userAgent ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";
  let Cookie = "";
  let cookieDomain = "";
  let cookieRequired = false;

  // kwik - animepahe
  if (url.includes("owocdn.top")) {
    referer = "https://kwik.cx/";
  } else if (url.includes("kwik.cx")) {
    referer = "https://animepahe.pw/";
    cookieDomain = "kwik.cx";
    cookieRequired = true;
  }
  // animepahe
  else if (url.includes("animepahe")) {
    referer = "https://animepahe.pw/";
    cookieDomain = "animepahe.pw";
    cookieRequired = true;
  }
  // weebcentral
  else if (
    url.includes("temp.compsci88.com") ||
    url.startsWith("https://temp.compsci88.com/")
  ) {
    referer = "https://weebcentral.com/";
  }
  // megaplay - anikoto
  else if (url.includes("megaplay") || url.includes("anikototv.to")) {
    referer = "https://anikototv.to/";
    cookieDomain = "anikototv.to";
    cookieRequired = true;
  } else if (
    url.includes("mewstream.buzz") ||
    url.includes("orbitra.click") ||
    url.includes("lostproject.club") ||
    url.includes("/subtitles/") ||
    url.includes(".vtt") ||
    url.match(/\/anime\/[a-f0-9]{32}\/[a-f0-9]{32}\//)
  ) {
    referer = "https://megaplay.buzz/";
  }
  // all manga
  else if (
    url.includes("allmanga.to") ||
    url.includes("allanime.day") ||
    url.includes("youtube-anime.com")
  ) {
    referer = "https://allmanga.to/";
    cookieDomain = "allmanga.to";
    cookieRequired = true;
  }

  // Query cookies generically for any domain
  if (cookieDomain) {
    try {
      const row = queryOne(
        "SELECT value FROM cookie WHERE id = ? OR id = ? OR id = ? OR (domain LIKE ? AND name = 'cf_clearance') ORDER BY CAST(expirationDate AS REAL) DESC LIMIT 1",
        [
          `${cookieDomain}-cf_clearance`,
          `.${cookieDomain}:cf_clearance`,
          `${cookieDomain}:cf_clearance`,
          `%${cookieDomain}`,
        ],
      );
      if (row && row.value) {
        Cookie = `cf_clearance=${row.value};`;
      }
    } catch (e) {
      // ignore
    }
  }

  return {
    Referer: referer,
    "User-Agent": userAgent,
    Cookie: Cookie,
    cookieRequired: cookieRequired,
  };
}

/**
 * Filter requests within the scraping window to bypass Cloudflare
 * or allow only essential media/API queries.
 */
function shouldAllowScrapingRequest(url, resourceType) {
  if (resourceType === "mainFrame") return true;
  return ALLOWED_SCRAPING_SUBSTRINGS.some((substring) =>
    url.includes(substring),
  );
}

function getBypassCheck(url) {
  if (url.includes("animepahe")) {
    return {
      baseUrl: "https://animepahe.pw",
      check: (title, html) =>
        title.toLowerCase().includes("animepahe") &&
        !title.toLowerCase().includes("just a moment"),
    };
  }

  if (
    url.includes("allmanga") ||
    url.includes("allanime") ||
    url.includes("youtube-anime")
  ) {
    return {
      baseUrl: "https://allmanga.to/",
      check: (title, html) =>
        html.includes("__NUXT__") ||
        title.toLowerCase().includes("allmanga") ||
        title.toLowerCase().includes("allanime"),
    };
  }
  if (url.includes("anikoto")) {
    return {
      baseUrl: "https://anikototv.to",
      check: (title, html) =>
        title.toLowerCase().includes("anikoto") &&
        !title.toLowerCase().includes("just a moment"),
    };
  }
  return null;
}

module.exports = {
  getHeaders,
  shouldAllowScrapingRequest,
  getBypassCheck,
};
