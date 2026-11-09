let app = null;
try {
  ({ app } = require("electron"));
} catch (_) {}
const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");
const axios = require("axios");
const { logger } = require("./AppLogger");

const activeTempSubDirs = new Set();
const { updateHistory, parseSeconds } = require("./history");
const {
  providerFetch,
  isLanguagePreferred,
  settingfetch,
} = require("./settings");
const { getSourceById } = require("./Metadata");
const { processServer, fetchEpisodeSources } = require("./AnimeManga");
const { verifyStreamReachability } = require("./streamVerifier");
const { sortSourcesByPreferredQuality } = require("./constants");

async function fetchSkipTimes(malid, epNum, durationSecs = 1440) {
  if (!malid || !epNum) return null;
  const epLength = Math.max(300, Math.floor(Number(durationSecs) || 1440));
  try {
    const url = `https://api.aniskip.com/v2/skip-times/${malid}/${Number(epNum)}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=${epLength}`;
    const res = await axios.get(url, { timeout: 3000 });
    if (res.data && res.data.found && Array.isArray(res.data.results)) {
      let opStart = null;
      let opEnd = null;
      let edStart = null;
      let edEnd = null;

      for (const item of res.data.results) {
        if (item.skipType === "op" || item.skipType === "mixed-op") {
          if (
            item.interval?.startTime !== undefined &&
            item.interval?.endTime !== undefined
          ) {
            opStart = item.interval.startTime;
            opEnd = item.interval.endTime;
          }
        } else if (item.skipType === "ed" || item.skipType === "mixed-ed") {
          if (
            item.interval?.startTime !== undefined &&
            item.interval?.endTime !== undefined
          ) {
            edStart = item.interval.startTime;
            edEnd = item.interval.endTime;
          }
        }
      }
      return { opStart, opEnd, edStart, edEnd };
    }
  } catch (e) {
    logger.info(
      `[MPV] AniSkip timestamps not found or timed out for MalID ${malid} Ep ${epNum}`,
    );
  }
  return null;
}

function formatSubtitleLabel(sub) {
  return sub?.lang || sub?.label || sub?.name || "";
}

async function prepareSubtitles(validSubs, activeReferer) {
  if (!validSubs || !Array.isArray(validSubs) || validSubs.length === 0) {
    return [];
  }
  const tempDir = path.join(
    os.tmpdir(),
    `strawverse-subs-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  );
  try {
    fs.mkdirSync(tempDir, { recursive: true });
    activeTempSubDirs.add(tempDir);
  } catch (e) {}

  const headers = {};
  if (activeReferer) {
    headers["Referer"] = activeReferer;
  }
  headers["User-Agent"] =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  const results = await Promise.allSettled(
    validSubs.map(async (sub, idx) => {
      const cleanLang = formatSubtitleLabel(sub, idx);
      let rawUrl = resolvePathOrUrl(sub.url);
      if (rawUrl && rawUrl.startsWith("/subtitles?file=")) {
        const decodedPath = decodeURIComponent(
          rawUrl.slice("/subtitles?file=".length),
        );
        if (decodedPath && fs.existsSync(decodedPath)) {
          return { lang: cleanLang, path: decodedPath };
        }
      }
      if (!rawUrl || !rawUrl.startsWith("http")) {
        return { lang: cleanLang, path: rawUrl };
      }

      try {
        const resp = await axios.get(rawUrl, {
          headers,
          timeout: 4000,
          responseType: "text",
        });
        if (
          resp.status === 200 &&
          typeof resp.data === "string" &&
          resp.data.trim().length > 0
        ) {
          const safeName = `track_${idx}_${cleanLang.replace(/[^a-zA-Z0-9_-]/g, "_")}.vtt`;
          const filePath = path.join(tempDir, safeName);
          fs.writeFileSync(filePath, resp.data, "utf8");
          return { lang: cleanLang, path: filePath };
        }
      } catch (err) {
        logger.warn(
          `[MPV] Subtitle pre-fetch failed for ${cleanLang} (${rawUrl}): ${err.message}. Falling back to proxy URL.`,
        );
      }

      const customHeaders = activeReferer
        ? { Referer: activeReferer }
        : undefined;
      return {
        lang: cleanLang,
        path: toProxyUrl(rawUrl, customHeaders),
      };
    }),
  );

  return results.map((r, i) => {
    if (r.status === "fulfilled") return r.value;
    const cleanLang = formatSubtitleLabel(validSubs[i], i);
    const rawUrl = resolvePathOrUrl(validSubs[i].url);
    const customHeaders = activeReferer
      ? { Referer: activeReferer }
      : undefined;
    return {
      lang: cleanLang,
      path: rawUrl.startsWith("http")
        ? toProxyUrl(rawUrl, customHeaders)
        : rawUrl,
    };
  });
}

const getMpvPath = () => {
  const platform = process.platform;
  const platformDir = platform === "win32" ? "win32" : "linux";
  const exeName = platform === "win32" ? "mpv.exe" : "mpv";

  // 1. Check process.resourcesPath (production unpack)
  if (process.resourcesPath) {
    const prodPath = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "mpv",
      platformDir,
      exeName,
    );
    if (fs.existsSync(prodPath)) {
      return prodPath;
    }
  }

  // 2. Check local dev source paths
  try {
    const devPathInner = path.join(
      app.getAppPath(),
      "mpv",
      platformDir,
      exeName,
    );
    if (fs.existsSync(devPathInner)) {
      return devPathInner;
    }
    const devPathOuter = path.join(
      app.getAppPath(),
      "..",
      "mpv",
      platformDir,
      exeName,
    );
    const devPathRel = path.join(
      __dirname,
      "..",
      "..",
      "electron",
      "mpv",
      platformDir,
      exeName,
    );
    if (fs.existsSync(devPathRel)) {
      return devPathRel;
    }
  } catch (e) {}

  // 3. Fallback to system command
  return "mpv";
};

const getMpvConfigDir = () => {
  if (process.resourcesPath) {
    const prodPath = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "mpv",
      "config",
    );
    if (fs.existsSync(prodPath)) {
      return prodPath;
    }
  }

  try {
    const devPathInner = path.join(app.getAppPath(), "mpv", "config");
    if (fs.existsSync(devPathInner)) {
      return devPathInner;
    }
    const devPathOuter = path.join(app.getAppPath(), "..", "mpv", "config");
    if (fs.existsSync(devPathOuter)) {
      return devPathOuter;
    }
    const devConfigRel = path.join(
      __dirname,
      "..",
      "..",
      "electron",
      "mpv",
      "config",
    );
    if (fs.existsSync(devConfigRel)) {
      return devConfigRel;
    }
  } catch (e) {}

  return path.join(__dirname, "..", "mpv", "config");
};

const getIpcPath = () => {
  const rand = Math.random().toString(36).substring(2, 10);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mpvsocket-${rand}`;
  } else {
    return `/tmp/mpvsocket-${rand}`;
  }
};

const connectIpc = (ipcPath, retryCount = 0) => {
  return new Promise((resolve, reject) => {
    const client = net.connect(ipcPath);

    client.on("connect", () => {
      resolve(client);
    });

    client.on("error", (err) => {
      if (retryCount < 20) {
        setTimeout(() => {
          connectIpc(ipcPath, retryCount + 1)
            .then(resolve)
            .catch(reject);
        }, 150);
      } else {
        reject(
          new Error(
            `Failed to connect to MPV IPC socket after ${retryCount} attempts: ${err.message}`,
          ),
        );
      }
    });
  });
};

const resolvePathOrUrl = (rawUrl) => {
  if (!rawUrl) return "";
  if (path.isAbsolute(rawUrl) || fs.existsSync(rawUrl)) {
    return rawUrl;
  }
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }
  try {
    const urlObj = new URL(rawUrl, "http://localhost");
    const filePath =
      urlObj.searchParams.get("path") || urlObj.searchParams.get("file");
    if (filePath) {
      const decoded = decodeURIComponent(filePath);
      if (fs.existsSync(decoded)) {
        return decoded;
      }
      const altSrt = decoded.replace(/\.vtt$/i, ".srt");
      if (fs.existsSync(altSrt)) return altSrt;
      const altVtt = decoded.replace(/\.srt$/i, ".vtt");
      if (fs.existsSync(altVtt)) return altVtt;
      if (path.isAbsolute(decoded)) {
        return decoded;
      }
    }
  } catch (e) {}

  return `http://localhost:${global.PORT}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
};

// Proxy external URLs through local Express → Electron's net stack (bypasses Cloudflare).
const toProxyUrl = (url, customHeaders, prefQuality = "") => {
  if (!url || !url.startsWith("http")) return url;
  if (
    url.includes("127.0.0.1") ||
    url.includes("localhost") ||
    path.isAbsolute(url) ||
    fs.existsSync(url)
  ) {
    return url;
  }
  const base = `http://127.0.0.1:${global.PORT}/api/stream`;
  let ref = customHeaders?.Referer || customHeaders?.referer || "";
  if (!ref && global.fallbackReferer) {
    ref = global.fallbackReferer;
  }
  const refParam = ref ? `&referer=${encodeURIComponent(ref)}` : "";
  let targetQuality = prefQuality;
  if (!targetQuality) {
    try {
      const settingsPath = path.join(
        require("electron").app.getPath("userData"),
        "settings.json",
      );
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        if (settings.quality) targetQuality = settings.quality;
      }
    } catch (e) {}
  }
  const qualParam = targetQuality
    ? `&quality=${encodeURIComponent(targetQuality)}`
    : "";
  if (url.includes(".m3u8")) {
    return `${base}/m3u8?url=${encodeURIComponent(url)}${refParam}${qualParam}`;
  }
  return `${base}/segment.ts?url=${encodeURIComponent(url)}${refParam}`;
};

async function playInMpv(window, options) {
  if (!app || process.platform === "android") {
    throw new Error("MPV player is only supported on Desktop");
  }
  global.activePlayRequestId = (global.activePlayRequestId || 0) + 1;
  const currentRequestId = global.activePlayRequestId;

  let episode = options.episode || 1;
  if (typeof episode === "string") {
    if (episode.includes("|")) {
      const parts = episode.split("|");
      const firstPartNum = Number(parts[0]);
      episode = !isNaN(firstPartNum) && firstPartNum > 0 ? firstPartNum : 1;
    } else if (isNaN(Number(episode))) {
      episode = 1;
    }
  }
  let episodeId = options.episodeId || options.episode || episode;
  let title = options.title || "Anime";
  let mediaId = options.mediaId;
  if (mediaId && global.db) {
    try {
      const row = global.db
        .prepare("SELECT id FROM Anime WHERE id = ?")
        .get(mediaId);
      if (!row && malid) {
        const rowByMal = global.db
          .prepare("SELECT id FROM Anime WHERE MalID = ? LIMIT 1")
          .get(String(malid));
        if (rowByMal && rowByMal.id) {
          mediaId = rowByMal.id;
        }
      }
    } catch (_) {}
  }
  let image = options.image || "";
  let provider = options.provider || "";
  let malid = options.malid || "";
  let subdub = options.subdub || "sub";
  let url = options.url || "";

  function formatMpvColor(hex, defaultHex = "#ffffffff") {
    if (!hex || hex === "transparent" || hex === "none") return "#00000000";
    let str = String(hex).trim();
    if (str.startsWith("rgba") || str.startsWith("rgb")) {
      const match = str.match(
        /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/,
      );
      if (match) {
        const r = parseInt(match[1]).toString(16).padStart(2, "0");
        const g = parseInt(match[2]).toString(16).padStart(2, "0");
        const b = parseInt(match[3]).toString(16).padStart(2, "0");
        const a = Math.round(parseFloat(match[4] ?? 1) * 255)
          .toString(16)
          .padStart(2, "0");
        return `#${a}${r}${g}${b}`;
      }
    }
    if (str.startsWith("#")) str = str.substring(1);
    if (str.length === 6) return `#ff${str}`;
    if (str.length === 8) {
      const rr = str.substring(0, 2);
      const gg = str.substring(2, 4);
      const bb = str.substring(4, 6);
      const aa = str.substring(6, 8);
      return `#${aa}${rr}${gg}${bb}`;
    }
    if (str.length === 3) {
      const r = str[0],
        g = str[1],
        b = str[2];
      return `#ff${r}${r}${g}${g}${b}${b}`;
    }
    return defaultHex;
  }

  let autoSkipIntro = true;
  let autoPlayNextEpisode = true;
  let subFontSize = 46;
  let subColor = "#FFFFFF";
  let subBorderColor = "#000000";
  let subBorderSize = 3.0;
  let subBgColor = "transparent";

  let preferredSubLangs = ["English"];

  try {
    const appSettings = await settingfetch();
    if (appSettings) {
      if (Array.isArray(appSettings.preferredSubtitleLanguages)) {
        preferredSubLangs = appSettings.preferredSubtitleLanguages;
      } else if (appSettings.subtitleLang) {
        preferredSubLangs = [appSettings.subtitleLang];
      }
      if (appSettings.autoSkipIntro !== undefined)
        autoSkipIntro = appSettings.autoSkipIntro;
      if (appSettings.autoPlayNextEpisode !== undefined)
        autoPlayNextEpisode = appSettings.autoPlayNextEpisode;
      if (appSettings.subFontSize)
        subFontSize = Number(appSettings.subFontSize);
      if (appSettings.subColor) subColor = appSettings.subColor;
      if (appSettings.subBorderColor)
        subBorderColor = appSettings.subBorderColor;
      if (appSettings.subBorderSize !== undefined)
        subBorderSize = Number(appSettings.subBorderSize);
      if (appSettings.subBgColor) subBgColor = appSettings.subBgColor;
      if (appSettings.playerSpeed !== undefined && !options.speed) {
        const spd = parseFloat(appSettings.playerSpeed);
        if (!isNaN(spd) && spd > 0) {
          options.speed = spd;
        }
      }
    }
  } catch (e) {
    logger.error("Failed to load settings in mpvPlayer: " + e.message);
  }

  logger.info(
    `[MPV] Launch request #${currentRequestId} for anime "${title}" (Ep ${episode}), provider=${provider}, subdub=${subdub}`,
  );

  if (
    global.activeMpvClient &&
    !global.activeMpvClient.destroyed &&
    global.activeMpvProcess &&
    !global.activeMpvProcess.killed
  ) {
    try {
      global.activeMpvClient.write(
        JSON.stringify({ command: ["set_property", "pause", true] }) + "\n",
      );
      global.activeMpvClient.write(
        JSON.stringify({
          command: [
            "set_property",
            "user-data/strawverse-loading",
            `Loading Episode ${episode}...`,
          ],
        }) + "\n",
      );
    } catch (_) {}
  }

  let activeSources = Array.isArray(options.sources)
    ? [...options.sources]
    : [];
  let activeSubtitles = Array.isArray(options.subtitles)
    ? [...options.subtitles]
    : [];

  const isLocalExplicit = options.isDownloaded || provider === "local source";

  const tryCheckLocalFile = async () => {
    if (!mediaId) return false;
    try {
      const config = await settingfetch();
      const localData = await getSourceById(
        "Anime",
        config?.CustomDownloadLocationAnime,
        mediaId,
        episode,
        subdub,
        true,
      );
      if (
        localData &&
        localData.filepath &&
        fs.existsSync(localData.filepath)
      ) {
        logger.info(
          `[MPV] Found local downloaded file for Ep ${episode}: ${localData.filepath}`,
        );
        activeSources = [
          {
            url: localData.filepath,
            quality: "Local",
            server: "Local",
            provider: "Local",
          },
        ];
        if (
          Array.isArray(localData.subtitleFiles) &&
          localData.subtitleFiles.length > 0
        ) {
          activeSubtitles = localData.subtitleFiles;
        }
        return true;
      }
    } catch (e) {
      logger.info(`[MPV] Error checking local file: ${e.message}`);
    }
    return false;
  };

  if (isLocalExplicit && activeSources.length === 0) {
    const foundLocal = await tryCheckLocalFile();
    if (!foundLocal) {
      const errMsg = `Downloaded local video file for Episode ${episode} was not found on disk.`;
      logger.error(`[MPV Error] ${errMsg}`);
      if (window && window.webContents) {
        window.webContents.send("mpv-error", { message: errMsg });
      }
      return { error: errMsg };
    }
  }

  if (activeSources.length === 0 && url) {
    activeSources.push({
      url: url,
      quality: "default",
    });
  }

  let startSeek = options.currentTime !== undefined ? options.currentTime : 0;
  if ((mediaId || title) && global.db) {
    try {
      let queryIds = mediaId ? [mediaId] : [];
      try {
        if (mediaId) {
          const localRec = global.db
            .prepare("SELECT MalID FROM Anime WHERE id = ?")
            .get(mediaId);
          if (localRec && localRec.MalID) {
            const siblings = global.db
              .prepare("SELECT id FROM Anime WHERE MalID = ?")
              .all(localRec.MalID);
            siblings.forEach((s) => {
              if (s.id) queryIds.push(s.id);
            });
          }
        }
      } catch (e) {}
      queryIds = Array.from(new Set(queryIds));

      let historyRec = null;
      const parsedEp = parseFloat(episode || 1);
      const strEp = String(episode);

      if (queryIds.length > 0) {
        const placeholders = queryIds.map(() => "?").join(",");
        if (title && title !== "Anime") {
          historyRec = global.db
            .prepare(
              `SELECT id, WatchHistory.current_time AS current_time, duration, is_completed, episode_number, sub_dub FROM WatchHistory WHERE (anime_id IN (${placeholders}) OR LOWER(anime_title) = LOWER(?)) AND (episode_number = ? OR CAST(episode_number AS REAL) = ? OR episode_number = ?) ORDER BY last_watched DESC, id DESC LIMIT 1`,
            )
            .get(...queryIds, title, parsedEp, parsedEp, strEp);
        } else {
          historyRec = global.db
            .prepare(
              `SELECT id, WatchHistory.current_time AS current_time, duration, is_completed, episode_number, sub_dub FROM WatchHistory WHERE anime_id IN (${placeholders}) AND (episode_number = ? OR CAST(episode_number AS REAL) = ? OR episode_number = ?) ORDER BY last_watched DESC, id DESC LIMIT 1`,
            )
            .get(...queryIds, parsedEp, parsedEp, strEp);
        }
      } else if (title && title !== "Anime") {
        historyRec = global.db
          .prepare(
            `SELECT id, WatchHistory.current_time AS current_time, duration, is_completed, episode_number, sub_dub FROM WatchHistory WHERE LOWER(anime_title) = LOWER(?) AND (episode_number = ? OR CAST(episode_number AS REAL) = ? OR episode_number = ?) ORDER BY last_watched DESC, id DESC LIMIT 1`,
          )
          .get(title, parsedEp, parsedEp, strEp);
      }

      let fallbackRec = null;
      if (queryIds.length > 0) {
        const placeholders = queryIds.map(() => "?").join(",");
        if (title && title !== "Anime") {
          fallbackRec = global.db
            .prepare(
              `SELECT id, WatchHistory.current_time AS current_time, duration, is_completed, episode_number, sub_dub FROM WatchHistory WHERE (anime_id IN (${placeholders}) OR LOWER(anime_title) = LOWER(?)) ORDER BY last_watched DESC, id DESC LIMIT 1`,
            )
            .get(...queryIds, title);
        } else {
          fallbackRec = global.db
            .prepare(
              `SELECT id, WatchHistory.current_time AS current_time, duration, is_completed, episode_number, sub_dub FROM WatchHistory WHERE anime_id IN (${placeholders}) ORDER BY last_watched DESC, id DESC LIMIT 1`,
            )
            .get(...queryIds);
        }
      } else if (title && title !== "Anime") {
        fallbackRec = global.db
          .prepare(
            `SELECT id, WatchHistory.current_time AS current_time, duration, is_completed, episode_number, sub_dub FROM WatchHistory WHERE LOWER(anime_title) = LOWER(?) ORDER BY last_watched DESC, id DESC LIMIT 1`,
          )
          .get(title);
      }

      const activeRec = historyRec || fallbackRec;

      if (
        activeRec &&
        startSeek === 0 &&
        activeRec.current_time !== undefined &&
        activeRec.current_time !== null
      ) {
        const recEp = parseFloat(activeRec.episode_number);
        if (!isNaN(recEp) && Math.abs(recEp - parsedEp) < 0.01) {
          const isFormattedStr =
            typeof activeRec.current_time === "string" &&
            activeRec.current_time.includes(":");
          let rawSec = parseSeconds(activeRec.current_time);
          let recDur =
            parseSeconds(activeRec.duration) || options.duration || 0;

          // Migrate legacy formatted strings (e.g. "6:57") to raw seconds in DB
          if (isFormattedStr && activeRec.id && rawSec > 0) {
            try {
              global.db
                .prepare(
                  "UPDATE WatchHistory SET current_time = ? WHERE id = ?",
                )
                .run(rawSec, activeRec.id);
            } catch (_) {}
          }

          const isAtEnd = recDur > 0 ? rawSec >= recDur - 8 : false;
          if (rawSec <= 0 || isAtEnd || rawSec >= 10800) {
            startSeek = 0;
            logger.info(
              `[MPV] Starting from 00:00 for ${title} Ep ${episode}${isAtEnd ? ` (finished near end: ${Math.floor(rawSec)}s / ${Math.floor(recDur)}s)` : ""}`,
            );
          } else if (rawSec > 0) {
            if (recDur > 0 && rawSec > recDur) {
              rawSec = Math.max(0, recDur - 5);
            }
            startSeek = Math.max(0, rawSec - 5);
            logger.info(
              `[MPV] Restored seek time ${Math.floor(startSeek)}s (saved position ${Math.floor(rawSec)}s) for ${title} Ep ${episode}`,
            );
          }
        }
      }

      if (
        activeRec &&
        activeRec.sub_dub &&
        (!options.subdub || options.subdub === "sub")
      ) {
        subdub = activeRec.sub_dub;
        logger.info(
          `[MPV] Restored subdub preference "${subdub}" from WatchHistory for ${title}`,
        );
      }
    } catch (e) {
      logger.error(
        `[MPV] Error loading WatchHistory seek/subdub: ${e.message}`,
      );
    }
  }

  if (activeSources.length === 0 && (episodeId || episode)) {
    // Tell the GUI to show a loading overlay while we fetch sources from the network
    if (window && window.webContents && !window.isDestroyed()) {
      window.webContents.send("mpv-loading", {
        episode,
        title,
      });
    }
    try {
      const Animeprovider = await providerFetch("Anime", provider);
      const fetched = await fetchEpisodeSources(
        Animeprovider,
        episodeId,
        subdub,
      );
      if (fetched && Array.isArray(fetched.sources)) {
        activeSources = fetched.sources;
      }
      if (fetched && Array.isArray(fetched.subtitles)) {
        activeSubtitles = fetched.subtitles;
      }
      logger.info(
        `[MPV] Fetched ${activeSources.length} sources and ${activeSubtitles.length} subtitles from ${provider}`,
      );
    } catch (e) {
      logger.error(
        `[MPV Error] Failed to fetch episode sources: ${e.message}`,
        e,
      );
      return { error: `Failed to fetch episode sources: ${e.message}` };
    }
  }

  if (activeSources.length === 0 && mediaId) {
    await tryCheckLocalFile();
  }

  if (activeSources && activeSources.length > 1) {
    let preferredQuality = "highest";
    try {
      const settingsPath = path.join(
        require("electron").app.getPath("userData"),
        "settings.json",
      );
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        if (settings.quality) preferredQuality = settings.quality;
      }
    } catch (e) {}

    activeSources = sortSourcesByPreferredQuality(
      activeSources,
      preferredQuality,
    );
  }

  if (activeSources.length === 0) {
    const msg = `No video sources found for ${title} Episode ${episode}.`;
    logger.error(`[MPV Error] ${msg}`);
    return { error: msg };
  }

  let playTargetUrl = url;

  if (activeSources.length > 0) {
    let resolvedSuccess = false;
    let fallbackUnverifiedSource = null;
    for (let i = 0; i < activeSources.length; i++) {
      const src = activeSources[i];
      if (!src) continue;
      if (src.isUnresolved || !src.url) {
        try {
          logger.info(
            `[MPV Startup] Resolving server #${i + 1} "${src.name || src.quality}"...`,
          );
          const Animeprovider = await providerFetch("Anime", provider);
          const resolved = await processServer(Animeprovider, src);
          if (resolved && resolved.url) {
            try {
              const streamDomain = new URL(resolved.url).hostname;
              const ref =
                resolved.headers?.Referer ||
                resolved.headers?.referer ||
                (Animeprovider?.baseUrl ? Animeprovider.baseUrl + "/" : null);
              if (global.registerSubrequestHeaders && resolved.headers) {
                global.registerSubrequestHeaders(
                  streamDomain,
                  resolved.headers,
                );
              }
              if (ref && global.setDynamicReferer) {
                global.setDynamicReferer(streamDomain, ref);
                global.setFallbackReferer(ref);
              }
            } catch (e) {}
            if (
              Array.isArray(resolved.subtitles) &&
              resolved.subtitles.length > 0
            ) {
              if (!isLocalExplicit) {
                activeSubtitles = [...resolved.subtitles];
              } else {
                activeSubtitles.push(...resolved.subtitles);
              }
            }
            activeSources[i] = { ...src, ...resolved, isUnresolved: false };
            if (i > 0) {
              const [resolvedSrc] = activeSources.splice(i, 1);
              activeSources.unshift(resolvedSrc);
            }
            resolvedSuccess = true;
            break;
          } else {
            logger.warn(
              `[MPV Startup] Server #${i + 1} "${src.name || src.quality}" resolution failed or returned no stream URL.`,
            );
          }
        } catch (e) {
          logger.error(
            `Failed to resolve server #${i + 1} ${src.name || src.quality} for MPV: ${e.message}`,
          );
        }
      } else {
        if (!fallbackUnverifiedSource) {
          fallbackUnverifiedSource = src;
        }
        // If there's only 1 source, skip reachability probe to eliminate latency
        if (activeSources.length === 1) {
          resolvedSuccess = true;
          break;
        }
        // For already-resolved URLs, verify reachability
        let isStreamAlive = true;
        if (src.url.startsWith("http")) {
          const checkResult = await verifyStreamReachability(
            src.url,
            src.headers || {},
            src.isM3U8 !== false,
          );
          if (!checkResult.ok && !checkResult.isProtected) {
            isStreamAlive = false;
            logger.warn(
              `[MPV Startup] Server #${i + 1} "${src.name || src.quality}" check failed (${checkResult.message}). Trying next server...`,
            );
          } else if (checkResult.isProtected) {
            logger.info(
              `[MPV Startup] Server #${i + 1} "${src.name || src.quality}" is protected (${checkResult.message}). Proceeding as viable candidate.`,
            );
          }
        }
        if (!isStreamAlive) continue;

        resolvedSuccess = true;
        if (i > 0) {
          const [resolvedSrc] = activeSources.splice(i, 1);
          activeSources.unshift(resolvedSrc);
        }
        break;
      }
    }

    if (!resolvedSuccess && fallbackUnverifiedSource) {
      logger.warn(
        `[MPV Startup] All server reachability probes failed or were protected. Proceeding with candidate server "${fallbackUnverifiedSource.name || fallbackUnverifiedSource.quality}".`,
      );
      const idx = activeSources.indexOf(fallbackUnverifiedSource);
      if (idx > 0) {
        const [fallbackSrc] = activeSources.splice(idx, 1);
        activeSources.unshift(fallbackSrc);
      }
      resolvedSuccess = true;
    }

    if (!resolvedSuccess || !activeSources[0]?.url) {
      const errMsg = `Failed to resolve any valid stream source for ${title} Ep ${episode}.`;
      logger.error(`[MPV Error] ${errMsg}`);
      if (window && window.webContents) {
        window.webContents.send("mpv-error", { message: errMsg });
      }
      return { error: errMsg };
    }
    playTargetUrl = activeSources[0].url;
  } else if (!url) {
    const errMsg = `No video sources available to play for ${title} Ep ${episode}.`;
    logger.error(`[MPV Error] ${errMsg}`);
    if (window && window.webContents) {
      window.webContents.send("mpv-error", { message: errMsg });
    }
    return { error: errMsg };
  }

  const activeReferer =
    activeSources[0]?.headers?.Referer ||
    activeSources[0]?.headers?.referer ||
    "";

  if (Array.isArray(activeSubtitles) && activeSubtitles.length > 0) {
    activeSubtitles = Array.from(
      new Map(activeSubtitles.map((sub) => [sub.url || sub, sub])).values(),
    );

    activeSubtitles.forEach((sub) => {
      if (
        sub &&
        sub.url &&
        sub.url.startsWith("http") &&
        global.setDynamicReferer
      ) {
        try {
          const subDomain = new URL(sub.url).hostname;
          global.setDynamicReferer(subDomain, activeReferer);
        } catch (e) {}
      }
    });

    if (preferredSubLangs.length === 0) {
      logger.info(
        `[MPV] Subtitles disabled by user preference (0 preferred languages selected)`,
      );
      activeSubtitles = [];
    } else {
      const filtered = activeSubtitles.filter((sub) => {
        const sLang = formatSubtitleLabel(sub);
        return isLanguagePreferred(sLang, preferredSubLangs);
      });

      if (filtered.length > 0) {
        logger.info(
          `[MPV] Filtered ${filtered.length} subtitle tracks (from ${activeSubtitles.length}) matching preferred languages: [${preferredSubLangs.join(", ")}]`,
        );
        activeSubtitles = filtered;
      } else {
        logger.info(
          `[MPV] No subtitle tracks matched preferred languages: [${preferredSubLangs.join(", ")}]`,
        );
        activeSubtitles = [];
      }
    }
  }

  // Start AniSkip fetch asynchronously without blocking MPV spawn
  const skipTimesPromise = fetchSkipTimes(malid, episode, options.duration);

  const resolvedUrl = resolvePathOrUrl(playTargetUrl);
  const isExternal = resolvedUrl.startsWith("http");
  const isDirectVideo = Boolean(
    resolvedUrl.split("?")[0].match(/\.(mp4|mkv|webm|mov|avi)$/i),
  );
  const playUrl =
    isExternal && !isDirectVideo
      ? toProxyUrl(resolvedUrl, activeSources[0]?.headers)
      : resolvedUrl;
  const ipcPath = getIpcPath();
  const configDir = getMpvConfigDir();
  let shortTitle = title || "Anime";
  if (shortTitle.length > 40) {
    shortTitle = shortTitle.substring(0, 40) + "...";
  }
  const displayTitle = `Ep ${episode || 1} - ${shortTitle}`;

  const hasSubBg =
    subBgColor && subBgColor !== "transparent" && subBgColor !== "none";

  const args = [
    `--input-ipc-server=${ipcPath}`,
    `--title=StrawVerse - ${title || "Player"} - Episode ${episode || 1}`,
    `--force-media-title=${displayTitle}`,
    `--config-dir=${configDir}`,
    "--sub-ass-override=force",
    "--sub-font=sans-serif",
    `--sub-font-size=${subFontSize}`,
    `--sub-color=${formatMpvColor(subColor, "#ffffffff")}`,
    `--sub-border-color=${formatMpvColor(subBorderColor, "#ff000000")}`,
    `--sub-border-size=${subBorderSize}`,
    `--sub-back-color=${formatMpvColor(subBgColor, "#00000000")}`,
    hasSubBg
      ? "--sub-border-style=background-box"
      : "--sub-border-style=outline-and-shadow",
    "--sub-shadow-offset=0",
    "--sub-margin-y=36",
    "--profile=fast",
    "--hwdec=auto",
    "--video-sync=audio",
    "--audio-pitch-correction=yes",
    "--force-window=yes",
    "--idle=yes",
    "--keep-open=yes",
    "--fullscreen",
    "--no-ytdl",
    "--hls-bitrate=max",
    "--demuxer-lavf-analyzeduration=1",
    "--demuxer-lavf-probesize=1000000",
    "--demuxer-max-bytes=100M",
    "--demuxer-max-back-bytes=30M",
    "--demuxer-lavf-o=timeout=10000000,allowed_extensions=ALL,allowed_segment_extensions=ALL",
    "--osd-on-seek=msg",
    `--volume=${options.volume !== undefined ? Math.floor(options.volume) : 100}`,
    `--speed=${options.speed || 1.0}`,
    `--sub-visibility=${options.subsEnabled === false ? "no" : "yes"}`,
    `--brightness=${options.brightness || 0}`,
  ];

  const activeUserAgent =
    activeSources[0]?.headers?.["User-Agent"] ||
    activeSources[0]?.headers?.["user-agent"] ||
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

  if (activeReferer) {
    args.push(`--referrer=${activeReferer}`);
  }
  args.push(`--user-agent=${activeUserAgent}`);

  if (activeSources[0]?.headers) {
    for (const [hk, hv] of Object.entries(activeSources[0].headers)) {
      const hkl = hk.toLowerCase();
      if (hkl !== "referer" && hkl !== "user-agent" && typeof hv === "string") {
        args.push(`--http-header-fields=${hk}: ${hv.replace(/,/g, "%2C")}`);
      }
    }
  }

  if (options.hasNext === undefined || options.hasPrev === undefined) {
    let computedHasNext = true;
    let computedHasPrev = Number(episode) > 1;

    if (Array.isArray(options.episodes) && options.episodes.length > 0) {
      const idx = options.episodes.findIndex((e) => {
        const epNum =
          e.number !== undefined ? Number(e.number) : Number(e.episode);
        return (
          (!isNaN(epNum) && epNum === Number(episode)) ||
          String(e.id) === String(episodeId)
        );
      });
      if (idx !== -1) {
        computedHasNext = idx < options.episodes.length - 1;
        computedHasPrev = idx > 0;
      } else {
        computedHasNext = options.episodes.some((e) => {
          const epNum =
            e.number !== undefined ? Number(e.number) : Number(e.episode);
          return !isNaN(epNum) && epNum > Number(episode);
        });
        computedHasPrev = options.episodes.some((e) => {
          const epNum =
            e.number !== undefined ? Number(e.number) : Number(e.episode);
          return !isNaN(epNum) && epNum < Number(episode) && epNum > 0;
        });
      }
    }

    if (options.hasNext === undefined) options.hasNext = computedHasNext;
    if (options.hasPrev === undefined) options.hasPrev = computedHasPrev;
  }

  const scriptOpts = [
    `osc-autoskip_intro=${autoSkipIntro ? "yes" : "no"}`,
    `modernx-autoskip_intro=${autoSkipIntro ? "yes" : "no"}`,
    `osc-autoplay_next=${autoPlayNextEpisode ? "yes" : "no"}`,
    `modernx-autoplay_next=${autoPlayNextEpisode ? "yes" : "no"}`,
    `modernx-has-next=${options.hasNext ? "yes" : "no"}`,
    `modernx-has-prev=${options.hasPrev ? "yes" : "no"}`,
  ];

  // Quick check for AniSkip if it resolved within 50ms (e.g. cached), else IPC will inject
  const quickSkip = await Promise.race([
    skipTimesPromise,
    new Promise((resolve) => setTimeout(() => resolve(null), 50)),
  ]);
  if (quickSkip) {
    if (quickSkip.opStart !== null && quickSkip.opEnd !== null) {
      scriptOpts.push(`modernx-op-start=${Math.floor(quickSkip.opStart)}`);
      scriptOpts.push(`modernx-op-end=${Math.floor(quickSkip.opEnd)}`);
    }
    if (quickSkip.edStart !== null) {
      scriptOpts.push(`modernx-ed-start=${Math.floor(quickSkip.edStart)}`);
    }
    logger.info(
      `[MPV] Applied AniSkip timestamps for Ep ${episode}: OP (${quickSkip.opStart}s - ${quickSkip.opEnd}s), ED (${quickSkip.edStart}s)`,
    );
  }

  let sourcesStr = "";
  if (activeSources && activeSources.length > 0) {
    sourcesStr = activeSources
      .filter((s) => s && (s.url || s.name || s.quality))
      .map((s) => {
        const name = s.quality || s.name || "Server";
        if (s.url) {
          const sUrl = resolvePathOrUrl(s.url);
          const isDirect = Boolean(
            sUrl.split("?")[0].match(/\.(mp4|mkv|webm|mov|avi)$/i),
          );
          const finalUrl =
            isDirect || !sUrl.startsWith("http")
              ? sUrl
              : toProxyUrl(sUrl, s.headers);
          return `${name}|${finalUrl}`;
        }
        return `${name}|unresolved:${name}`;
      })
      .join("##");
    if (sourcesStr) {
      scriptOpts.push(`modernx-sources=${sourcesStr}`);
    }
  }

  if (preferredSubLangs.length > 0 && options.subsEnabled !== false) {
    const slangCodes = preferredSubLangs.flatMap((p) => {
      const pLow = (p || "").toLowerCase().trim();
      if (pLow === "english") return ["en", "eng", "english"];
      if (pLow === "spanish") return ["es", "spa", "spanish"];
      if (pLow === "french") return ["fr", "fra", "fre", "french"];
      if (pLow === "german") return ["de", "ger", "deu", "german"];
      if (pLow === "italian") return ["it", "ita", "italian"];
      if (pLow === "portuguese") return ["pt", "por", "portuguese"];
      if (pLow === "russian") return ["ru", "rus", "russian"];
      if (pLow === "japanese") return ["ja", "jpn", "japanese"];
      if (pLow === "chinese") return ["zh", "chi", "zho", "chinese"];
      if (pLow === "arabic") return ["ar", "ara", "arabic"];
      if (pLow === "hindi") return ["hi", "hin", "hindi"];
      return [pLow];
    });
    args.push(`--slang=${Array.from(new Set(slangCodes)).join(",")}`);
  }

  if (
    activeSubtitles &&
    Array.isArray(activeSubtitles) &&
    activeSubtitles.length > 0
  ) {
    const seenUrls = new Set();
    const validSubs = activeSubtitles.filter((sub) => {
      if (!sub || !sub.url) return false;
      const u = String(sub.url).trim();
      if (seenUrls.has(u)) return false;
      seenUrls.add(u);
      return true;
    });

    logger.info(`[MPV] Processing ${validSubs.length} subtitle tracks for MPV`);

    const preparedSubs = await prepareSubtitles(validSubs, activeReferer);

    const subsStr = preparedSubs
      .map((ps) => `${ps.lang}|${ps.path}`)
      .join("##");

    if (subsStr) {
      scriptOpts.push(`modernx-subtitles=${subsStr}`);
    }

    preparedSubs.forEach((ps, idx) => {
      validSubs[idx].lang = ps.lang;
      validSubs[idx].label = ps.lang;
      args.push(`--sub-file=${ps.path}`);
    });

    if (validSubs.length > 0 && options.subsEnabled !== false) {
      let selectedIndex = 0;
      if (
        options.selectedSubIndex !== undefined &&
        options.selectedSubIndex >= 0 &&
        options.selectedSubIndex < validSubs.length
      ) {
        selectedIndex = options.selectedSubIndex;
      } else {
        const matchedIndex = validSubs.findIndex((sub) =>
          isLanguagePreferred(
            sub.lang || sub.label || sub.name,
            preferredSubLangs,
          ),
        );
        if (matchedIndex !== -1) {
          selectedIndex = matchedIndex;
        }
      }
      args.push(`--sid=${selectedIndex + 1}`);
    } else if (options.subsEnabled === false) {
      args.push("--sid=no");
    } else {
      args.push("--sid=auto");
    }
  } else {
    if (options.subsEnabled === false || preferredSubLangs.length === 0) {
      args.push("--sid=no");
    } else {
      args.push("--sid=auto");
    }
  }

  scriptOpts.push(`modernx-subdub=${subdub || "sub"}`);

  scriptOpts.forEach((opt) => {
    const eqIdx = opt.indexOf("=");
    if (eqIdx !== -1) {
      const key = opt.slice(0, eqIdx);
      const val = opt.slice(eqIdx + 1);
      const safeVal = val.replace(/,/g, "%2C");
      args.push(`--script-opts-add=${key}=${safeVal}`);
    } else {
      args.push(`--script-opts-add=${opt}`);
    }
  });

  if (startSeek > 0) {
    args.push(`--start=${Math.floor(startSeek)}`);
  }

  args.push(playUrl);

  const isProcessAlive =
    global.activeMpvProcess &&
    !global.activeMpvProcess.killed &&
    global.activeMpvProcess.exitCode === null &&
    global.activeMpvProcess.signalCode === null;
  const isClientAlive =
    global.activeMpvClient && !global.activeMpvClient.destroyed;

  if (isProcessAlive && isClientAlive) {
    logger.info(
      `[MPV] Reusing existing active MPV instance for ${title} Ep ${episode}`,
    );

    if (global.activeMpvSession) {
      global.activeMpvSession.mediaId = mediaId;
      global.activeMpvSession.title = title;
      global.activeMpvSession.episode = episode;
      global.activeMpvSession.episodeId = episodeId;
      global.activeMpvSession.image = image;
      global.activeMpvSession.provider = provider;
      global.activeMpvSession.malid = malid;
      global.activeMpvSession.subdub = subdub;
      global.activeMpvSession.activeSources = activeSources;
      global.activeMpvSession.activeSubtitles = activeSubtitles;
      global.activeMpvSession.currentTime = startSeek;
      global.activeMpvSession.lastSavedTime = startSeek;
      global.activeMpvSession.duration = options.duration || 0;
      global.activeMpvSession.hasNext = options.hasNext;
      global.activeMpvSession.hasPrev = options.hasPrev;
      global.activeMpvSession.episodes = options.episodes;
      global.activeMpvSession.autoPlayNextEpisode = autoPlayNextEpisode;
      global.activeMpvSession.hasTriggeredAutoNext = false;
      global.activeMpvSession.options = options;
    }

    const client = global.activeMpvClient;
    const activeServerName =
      activeSources[0]?.name || activeSources[0]?.quality || "Server 1";

    try {
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "user-data/strawverse-episode",
            String(episode),
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "user-data/strawverse-title",
            String(title),
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "user-data/strawverse-mediaId",
            String(mediaId),
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "user-data/strawverse-has-next",
            options.hasNext ? "yes" : "no",
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "user-data/strawverse-has-prev",
            options.hasPrev ? "yes" : "no",
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "user-data/strawverse-active-server",
            activeServerName,
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "title",
            `StrawVerse - ${title || "Player"} - Episode ${episode || 1}`,
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: ["set_property", "force-media-title", displayTitle],
        }) + "\n",
      );

      client.write(
        JSON.stringify({
          command: ["set_property", "sub-ass-override", "force"],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: ["set_property", "sub-font-size", subFontSize],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "sub-color",
            formatMpvColor(subColor, "#ffffffff"),
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "sub-border-color",
            formatMpvColor(subBorderColor, "#ff000000"),
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: ["set_property", "sub-border-size", subBorderSize],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "sub-back-color",
            formatMpvColor(subBgColor, "#00000000"),
          ],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: [
            "set_property",
            "sub-border-style",
            hasSubBg ? "background-box" : "outline-and-shadow",
          ],
        }) + "\n",
      );

      client.write(
        JSON.stringify({
          command: ["set_property", "user-data/strawverse-op-start", "0"],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: ["set_property", "user-data/strawverse-op-end", "0"],
        }) + "\n",
      );
      client.write(
        JSON.stringify({
          command: ["set_property", "user-data/strawverse-ed-start", "0"],
        }) + "\n",
      );
      skipTimesPromise
        .then((st) => {
          if (!st) return;
          if (client && !client.destroyed) {
            if (st.opStart !== null && st.opEnd !== null) {
              client.write(
                JSON.stringify({
                  command: [
                    "set_property",
                    "user-data/strawverse-op-start",
                    String(Math.floor(st.opStart)),
                  ],
                }) + "\n",
              );
              client.write(
                JSON.stringify({
                  command: [
                    "set_property",
                    "user-data/strawverse-op-end",
                    String(Math.floor(st.opEnd)),
                  ],
                }) + "\n",
              );
            }
            if (st.edStart !== null) {
              client.write(
                JSON.stringify({
                  command: [
                    "set_property",
                    "user-data/strawverse-ed-start",
                    String(Math.floor(st.edStart)),
                  ],
                }) + "\n",
              );
            }
          }
        })
        .catch(() => {});

      scriptOpts.forEach((opt) => {
        const eqIdx = opt.indexOf("=");
        if (eqIdx !== -1) {
          const key = opt.slice(0, eqIdx);
          const val = opt.slice(eqIdx + 1);
          const safeVal = val.replace(/,/g, "%2C");
          client.write(
            JSON.stringify({
              command: [
                "change-list",
                "script-opts",
                "append",
                `${key}=${safeVal}`,
              ],
            }) + "\n",
          );
        } else {
          client.write(
            JSON.stringify({
              command: ["change-list", "script-opts", "append", opt],
            }) + "\n",
          );
        }
      });
      if (sourcesStr) {
        client.write(
          JSON.stringify({
            command: [
              "set_property",
              "user-data/strawverse-sources",
              sourcesStr,
            ],
          }) + "\n",
        );
      }

      client.write(JSON.stringify({ command: ["sub-remove"] }) + "\n");
      if (Array.isArray(activeSubtitles)) {
        const preparedSubs = await prepareSubtitles(
          activeSubtitles,
          activeReferer,
        );
        preparedSubs.forEach((ps) => {
          client.write(
            JSON.stringify({ command: ["sub-add", ps.path] }) + "\n",
          );
        });
        const subsStr = preparedSubs
          .map((ps) => `${ps.lang}|${ps.path}`)
          .join("##");
        if (subsStr) {
          client.write(
            JSON.stringify({
              command: [
                "set_property",
                "user-data/strawverse-subtitles",
                subsStr,
              ],
            }) + "\n",
          );
        }
      }

      // Signal GUI to show loading overlay while MPV switches streams;
      // mpv-started will be sent automatically when file-loaded fires.
      if (window && window.webContents && !window.isDestroyed()) {
        window.webContents.send("mpv-loading", { episode, title });
      }

      if (activeReferer) {
        client.write(
          JSON.stringify({
            command: ["set_property", "referrer", activeReferer],
          }) + "\n",
        );
      }
      client.write(
        JSON.stringify({
          command: ["set_property", "user-agent", activeUserAgent],
        }) + "\n",
      );
      const headerFields = [];
      if (activeSources[0]?.headers) {
        for (const [hk, hv] of Object.entries(activeSources[0].headers)) {
          const hkl = hk.toLowerCase();
          if (
            hkl !== "referer" &&
            hkl !== "user-agent" &&
            typeof hv === "string"
          ) {
            headerFields.push(`${hk}: ${hv}`);
          }
        }
      }
      if (headerFields.length > 0) {
        client.write(
          JSON.stringify({
            command: ["set_property", "http-header-fields", headerFields],
          }) + "\n",
        );
      }

      client.write(
        JSON.stringify({ command: ["loadfile", playUrl, "replace"] }) + "\n",
      );

      if (startSeek > 0) {
        client.write(
          JSON.stringify({
            command: ["seek", Math.floor(startSeek), "absolute"],
          }) + "\n",
        );
      }
      client.write(
        JSON.stringify({
          command: ["set_property", "user-data/strawverse-loading", ""],
        }) + "\n",
      );
      client.write(
        JSON.stringify({ command: ["set_property", "pause", false] }) + "\n",
      );

      return { success: true, reused: true };
    } catch (e) {
      logger.warn(
        `[MPV] In-place loadfile failed, falling back to spawn: ${e.message}`,
      );
    }
  }

  if (global.activeMpvProcess) {
    try {
      global.activeMpvProcess.kill("SIGKILL");
    } catch (e) {}
    global.activeMpvProcess = null;
  }
  if (global.activeMpvClient) {
    try {
      global.activeMpvClient.destroy();
    } catch (e) {}
    global.activeMpvClient = null;
  }

  global.activeMpvSession = {
    mediaId,
    title,
    episode,
    episodeId,
    image,
    provider,
    malid,
    subdub,
    activeSources,
    activeSubtitles,
    currentTime: startSeek,
    lastSavedTime: startSeek,
    duration: options.duration || 0,
    hasNext: options.hasNext,
    hasPrev: options.hasPrev,
    episodes: options.episodes,
    autoPlayNextEpisode,
    hasTriggeredAutoNext: false,
    options,
  };

  const mpvExe = getMpvPath();
  if (!mpvExe || !fs.existsSync(mpvExe)) {
    const errMsg = `MPV binary executable not found on system at: ${mpvExe}`;
    logger.error(`[MPV Error] ${errMsg}`);
    return { error: errMsg };
  }

  logger.info(
    `[MPV] Spawning MPV process using [${mpvExe}] for ${title} Ep ${episode}.`,
  );

  let mpvProcess;
  try {
    mpvProcess = spawn(mpvExe, args, {
      env: {
        ...process.env,
        AM_MANAGED: "1",
        SOAR_MANAGED: "1",
        DBIN_MANAGED: "1",
        APPIMAGE_SILENT: "1",
        NO_UPDATE_CHECK: "1",
      },
    });
    global.activeMpvProcess = mpvProcess;

    const isSpamLog = (msg) => {
      if (!msg) return true;
      const m = msg.toLowerCase();
      if (
        m.includes("av:") ||
        m.includes("a-v:") ||
        m.includes("parametric stereo")
      )
        return true;
      if (m.includes("ffmpeg/audio") || m.includes("ffmpeg/video")) return true;
      if (
        m.includes("aac:") ||
        m.includes("h264:") ||
        m.includes("hevc:") ||
        m.includes("mp3:")
      )
        return true;
      if (m.includes("mpv is up to date") || m.includes("mpv up to date"))
        return true;
      if (
        m.includes("script-opts") ||
        m.includes("unknown key") ||
        m.includes("modernx")
      )
        return true;
      if (/^\s*\d{2}:\d{2}:\d{2}/.test(msg) || /^\s*av:\s*/i.test(msg))
        return true;
      return false;
    };

    if (mpvProcess.stdout) {
      mpvProcess.stdout.on("data", (chunk) => {
        const lines = chunk.toString().split(/\r?\n/);
        for (const line of lines) {
          const str = line.trim();
          if (str && !isSpamLog(str)) {
            logger.info(`[MPV Stdout] ${str}`);
          }
        }
      });
    }
    if (mpvProcess.stderr) {
      mpvProcess.stderr.on("data", (chunk) => {
        const lines = chunk.toString().split(/\r?\n/);
        for (const line of lines) {
          const errStr = line.trim();
          if (errStr && !isSpamLog(errStr)) {
            logger.error(`[MPV Stderr] ${errStr}`);
          }
        }
      });
    }
    mpvProcess.on("error", (err) => {
      logger.error(`[MPV Spawn Error] ${err.message}`, err);
      if (window && window.webContents) {
        window.webContents.send("mpv-error", {
          message: `Failed to launch MPV executable: ${err.message}`,
        });
      }
    });
  } catch (err) {
    logger.error(`[MPV Spawn Exception] ${err.message}`, err);
    return { error: `Failed to spawn MPV process: ${err.message}` };
  }

  let client = null;
  let duration = 0;
  let currentTime = startSeek;
  let lastSavedTime = startSeek;
  let lastSyncTime = Date.now();
  let paused = false;
  let buffer = "";
  let pendingAction = null;
  let pendingSeekOnLoad = null;
  let hasStartedSent = false;
  let hasTriggeredAutoNext = false;

  const sendStarted = () => {
    if (global.activePlayRequestId !== currentRequestId) return;
    if (!hasStartedSent) {
      if (window && window.webContents) {
        window.webContents.send("mpv-started");
      }
      hasStartedSent = true;
    }
  };

  sendStarted();
  setTimeout(sendStarted, 500);

  try {
    client = await connectIpc(ipcPath);
    global.activeMpvClient = client;
    logger.info(`[MPV IPC] Successfully connected to IPC socket: ${ipcPath}`);
    client.write(
      JSON.stringify({
        command: ["set_property", "user-data/strawverse-loading", ""],
      }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["set_property", "pause", false] }) + "\n",
    );
    const activeServerName =
      activeSources[0]?.name || activeSources[0]?.quality || "Server 1";
    client.write(
      JSON.stringify({
        command: [
          "set_property",
          "user-data/strawverse-active-server",
          activeServerName,
        ],
      }) + "\n",
    );
    if (sourcesStr) {
      client.write(
        JSON.stringify({
          command: ["set_property", "user-data/strawverse-sources", sourcesStr],
        }) + "\n",
      );
    }

    skipTimesPromise
      .then((st) => {
        if (!st) return;
        if (client && !client.destroyed) {
          if (st.opStart !== null && st.opEnd !== null) {
            client.write(
              JSON.stringify({
                command: [
                  "set_property",
                  "user-data/strawverse-op-start",
                  String(Math.floor(st.opStart)),
                ],
              }) + "\n",
            );
            client.write(
              JSON.stringify({
                command: [
                  "set_property",
                  "user-data/strawverse-op-end",
                  String(Math.floor(st.opEnd)),
                ],
              }) + "\n",
            );
          }
          if (st.edStart !== null) {
            client.write(
              JSON.stringify({
                command: [
                  "set_property",
                  "user-data/strawverse-ed-start",
                  String(Math.floor(st.edStart)),
                ],
              }) + "\n",
            );
          }
          logger.info(
            `[MPV IPC] Injected AniSkip timestamps dynamically for Ep ${episode}: OP (${st.opStart}s - ${st.opEnd}s), ED (${st.edStart}s)`,
          );
        }
      })
      .catch(() => {});

    client.write(
      JSON.stringify({ command: ["observe_property", 1, "time-pos"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 2, "pause"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 3, "duration"] }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 4, "user-data/strawverse-action"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 5, "user-data/strawverse-episode"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 6, "user-data/strawverse-title"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 7, "user-data/strawverse-mediaId"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 8, "user-data/strawverse-image"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 9, "user-data/strawverse-provider"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 10, "user-data/strawverse-malid"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 11, "volume"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 12, "speed"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 13, "sub-visibility"] }) +
        "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 14, "brightness"] }) +
        "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 15, "seeking"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 16, "eof-reached"] }) +
        "\n",
    );

    let lastPeriodicSave = Date.now();

    const triggerAutoNext = (reason) => {
      const sess = global.activeMpvSession;
      const isAutoPlay =
        sess?.autoPlayNextEpisode !== undefined
          ? sess.autoPlayNextEpisode
          : autoPlayNextEpisode;
      const hasNextEp =
        sess?.hasNext !== undefined ? sess.hasNext : options.hasNext;
      const alreadyTriggered = sess
        ? sess.hasTriggeredAutoNext
        : hasTriggeredAutoNext;

      if (isAutoPlay && hasNextEp && !alreadyTriggered) {
        if (sess) sess.hasTriggeredAutoNext = true;
        hasTriggeredAutoNext = true;
        logger.info(`[MPV] Auto-playing next episode (${reason})...`);
        saveProgressToDb(currentTime);
        if (window && window.webContents && !window.isDestroyed()) {
          window.webContents.send("mpv-action", { action: "next" });
        }
      }
    };

    const saveProgressToDb = (currT) => {
      if (!currT || currT <= 0) return;
      const sess = global.activeMpvSession;
      const curMediaId = sess?.mediaId || mediaId;
      const curTitle = sess?.title || title;
      const curEpisode = sess?.episode || episode;
      const curImage = sess?.image || image;
      const curProvider = sess?.provider || provider;
      const curMalid = sess?.malid || malid;
      const curSubdub =
        sess?.activeSources?.[0]?.lang ||
        sess?.activeSources?.[0]?.type ||
        sess?.subdub ||
        subdub ||
        "sub";
      const curDuration = duration || sess?.duration || options.duration || 0;
      const deltaSpent = Math.max(0, currT - lastSavedTime);

      updateHistory({
        mediaId: curMediaId,
        type: "Anime",
        title: curTitle,
        number: curEpisode,
        currentTime: currT,
        duration: curDuration,
        timeSpent: deltaSpent,
        image: curImage,
        provider: curProvider,
        malid: curMalid,
        subdub: curSubdub,
      }).catch((e) =>
        logger.error(`[MPV] Periodic watch history sync failed: ${e.message}`),
      );
      lastSavedTime = currT;
      if (sess) {
        sess.currentTime = currT;
        sess.lastSavedTime = currT;
      }
      lastPeriodicSave = Date.now();
    };

    const handleIpcMessage = (dataStr) => {
      try {
        const msg = JSON.parse(dataStr);
        if (msg.event === "file-loaded") {
          hasTriggeredAutoNext = false;
          if (global.activeMpvSession) {
            global.activeMpvSession.hasTriggeredAutoNext = false;
          }
          sendStarted();
          if (pendingSeekOnLoad !== null && pendingSeekOnLoad > 0) {
            const seekPos = Math.floor(pendingSeekOnLoad);
            pendingSeekOnLoad = null;
            try {
              if (client && !client.destroyed) {
                client.write(
                  JSON.stringify({
                    command: ["seek", seekPos, "absolute"],
                  }) + "\n",
                );
              }
            } catch (_) {}
          }
          try {
            if (client && !client.destroyed) {
              client.write(
                JSON.stringify({
                  command: ["set_property", "user-data/strawverse-loading", ""],
                }) + "\n",
              );
            }
          } catch (_) {}
        }
        if (msg.event === "end-file" && msg.reason === "eof") {
          triggerAutoNext("end-file eof");
        }
        if (msg.event === "property-change") {
          if (
            msg.name === "user-data/strawverse-action" &&
            typeof msg.data === "string" &&
            msg.data !== ""
          ) {
            pendingAction = msg.data;
            if (pendingAction === "next") {
              hasTriggeredAutoNext = true;
            }
            if (pendingAction === "open-subtitle-settings") {
              logger.info(`[MPV IPC] Received open-subtitle-settings request`);
              try {
                if (client && !client.destroyed) {
                  client.write(
                    JSON.stringify({
                      command: ["set_property", "fullscreen", false],
                    }) + "\n",
                  );
                }
              } catch (_) {}
              if (window && !window.isDestroyed()) {
                if (typeof window.show === "function") window.show();
                if (
                  typeof window.restore === "function" &&
                  window.isMinimized?.()
                ) {
                  window.restore();
                }
                if (typeof window.focus === "function") window.focus();
                if (window.webContents) {
                  window.webContents.send("open-settings-tab", {
                    tab: "anime_manga",
                    scrollTo: "subtitle-customization",
                  });
                }
              }
              return;
            }
            let actionName = pendingAction;
            let actionUrl = undefined;
            if (pendingAction.startsWith("change-server:")) {
              actionName = "change-server";
              actionUrl = pendingAction.substring("change-server:".length);

              logger.info(
                `[MPV IPC] Received change-server request for: "${actionUrl}"`,
              );

              if (actionUrl && activeSources.length > 0) {
                const cleanAct = actionUrl
                  .toLowerCase()
                  .replace(/^server\s*/, "")
                  .trim();
                const targetServer = activeSources.find((s) => {
                  const sName = (s.name || "").toLowerCase();
                  const sQual = (s.quality || "").toLowerCase();
                  const cleanName = sName.replace(/^server\s*/, "").trim();
                  const cleanQual = sQual.replace(/^server\s*/, "").trim();
                  return (
                    sName === actionUrl.toLowerCase() ||
                    sQual === actionUrl.toLowerCase() ||
                    cleanName === cleanAct ||
                    cleanQual === cleanAct ||
                    sName.includes(cleanAct) ||
                    sQual.includes(cleanAct)
                  );
                });

                if (!targetServer) {
                  logger.error(
                    `[MPV IPC Error] Target server "${actionUrl}" not found in activeSources. Available: ${JSON.stringify(activeSources.map((s) => s.name || s.quality))}`,
                  );
                } else {
                  logger.info(
                    `[MPV IPC] Matched targetServer: "${targetServer.name || targetServer.quality}" (isUnresolved: ${targetServer.isUnresolved})`,
                  );
                  (async () => {
                    let finalServer = targetServer;
                    if (targetServer.isUnresolved || !targetServer.url) {
                      try {
                        logger.info(
                          `[MPV IPC] Resolving server "${targetServer.name || targetServer.quality}"...`,
                        );
                        const Animeprovider = await providerFetch(
                          "Anime",
                          provider,
                        );
                        const resolved = await processServer(
                          Animeprovider,
                          targetServer,
                        );
                        if (resolved && resolved.url) {
                          try {
                            const streamDomain = new URL(resolved.url).hostname;
                            const ref =
                              resolved.headers?.Referer ||
                              resolved.headers?.referer ||
                              (Animeprovider?.baseUrl
                                ? Animeprovider.baseUrl + "/"
                                : null);
                            if (
                              global.registerSubrequestHeaders &&
                              resolved.headers
                            ) {
                              global.registerSubrequestHeaders(
                                streamDomain,
                                resolved.headers,
                              );
                            }
                            if (ref && global.setDynamicReferer) {
                              global.setDynamicReferer(streamDomain, ref);
                              global.setFallbackReferer(ref);
                            }
                          } catch (e) {}
                          finalServer = {
                            ...targetServer,
                            ...resolved,
                            isUnresolved: false,
                          };
                          const idx = activeSources.indexOf(targetServer);
                          if (idx >= 0) activeSources[idx] = finalServer;
                          logger.info(
                            `[MPV IPC] Successfully resolved stream URL for "${targetServer.name || targetServer.quality}": ${resolved.url}`,
                          );
                        } else {
                          logger.error(
                            `[MPV IPC Error] processServer returned invalid stream URL for ${actionUrl}`,
                          );
                        }
                      } catch (e) {
                        logger.error(
                          `[MPV IPC Error] Failed resolving server ${actionUrl}: ${e.message}`,
                        );
                      }
                    }
                    if (finalServer && finalServer.url) {
                      const serverName =
                        finalServer.name || finalServer.quality;
                      const sUrl = resolvePathOrUrl(finalServer.url);
                      const isDirect = Boolean(
                        sUrl.split("?")[0].match(/\.(mp4|mkv|webm|mov|avi)$/i),
                      );
                      const newProxyUrl =
                        isDirect || !sUrl.startsWith("http")
                          ? sUrl
                          : toProxyUrl(sUrl, finalServer.headers);
                      const resumePosition = currentTime;
                      logger.info(
                        `[MPV IPC] Sending loadfile command to MPV for ${serverName}: ${newProxyUrl} (resuming at ${Math.floor(resumePosition)}s)`,
                      );
                      const sIdx = activeSources.indexOf(targetServer);
                      if (sIdx >= 0) activeSources.splice(sIdx, 1);
                      activeSources.unshift(finalServer);
                      if (global.activeMpvSession) {
                        global.activeMpvSession.activeSources = activeSources;
                      }

                      if (client && !client.destroyed) {
                        pendingSeekOnLoad = resumePosition;
                        const sReferer =
                          finalServer.headers?.Referer ||
                          finalServer.headers?.referer ||
                          activeReferer ||
                          "";
                        const sHeaderFields = [];
                        if (sReferer) {
                          client.write(
                            JSON.stringify({
                              command: ["set_property", "referrer", sReferer],
                            }) + "\n",
                          );
                          sHeaderFields.push(`Referer: ${sReferer}`);
                        }
                        const sUserAgent =
                          finalServer.headers?.["User-Agent"] ||
                          finalServer.headers?.["user-agent"] ||
                          activeUserAgent;
                        sHeaderFields.push(`User-Agent: ${sUserAgent}`);
                        if (finalServer.headers) {
                          for (const [hk, hv] of Object.entries(
                            finalServer.headers,
                          )) {
                            const hkl = hk.toLowerCase();
                            if (
                              hkl !== "referer" &&
                              hkl !== "user-agent" &&
                              typeof hv === "string"
                            ) {
                              sHeaderFields.push(`${hk}: ${hv}`);
                            }
                          }
                        }
                        client.write(
                          JSON.stringify({
                            command: [
                              "set_property",
                              "http-header-fields",
                              sHeaderFields,
                            ],
                          }) + "\n",
                        );
                        client.write(
                          JSON.stringify({
                            command: [
                              "set_property",
                              "user-data/strawverse-active-server",
                              serverName,
                            ],
                          }) + "\n",
                        );
                        client.write(
                          JSON.stringify({
                            command: ["loadfile", newProxyUrl, "replace"],
                          }) + "\n",
                        );
                        if (resumePosition > 0) {
                          client.write(
                            JSON.stringify({
                              command: [
                                "seek",
                                Math.floor(resumePosition),
                                "absolute",
                              ],
                            }) + "\n",
                          );
                        }
                      }
                    } else {
                      logger.error(
                        `[MPV IPC Error] Unable to play server ${actionUrl}: No stream URL available`,
                      );
                    }
                  })();
                }
              }
            }

            hasStartedSent = false;

            const actionTimeSpent = Math.max(0, currentTime - lastSavedTime);
            lastSavedTime = currentTime;
            updateHistory({
              mediaId: mediaId,
              type: "Anime",
              title: title,
              number: episode,
              currentTime: currentTime,
              duration: duration || options.duration || 0,
              timeSpent: actionTimeSpent,
              image: image,
              provider: provider,
              malid: malid,
              subdub:
                activeSources[0]?.lang ||
                activeSources[0]?.type ||
                subdub ||
                "sub",
            }).catch((err) =>
              logger.error(`[MPV] Action history sync failed: ${err.message}`),
            );
            client.write(
              JSON.stringify({
                command: ["set_property", "user-data/strawverse-action", ""],
              }) + "\n",
            );
            window.webContents.send("mpv-action", {
              action: actionName,
              url: actionUrl,
            });
          } else if (
            msg.name === "user-data/strawverse-episode" &&
            msg.data !== undefined &&
            msg.data !== "" &&
            msg.data !== null &&
            String(msg.data) !== String(episode)
          ) {
            episode = msg.data;
            startSeek = 0;
            currentTime = 0;
            lastSavedTime = 0;
          } else if (
            msg.name === "user-data/strawverse-title" &&
            msg.data !== undefined
          ) {
            title = msg.data;
          } else if (
            msg.name === "user-data/strawverse-mediaId" &&
            msg.data !== undefined
          ) {
            mediaId = msg.data;
          } else if (
            msg.name === "user-data/strawverse-image" &&
            msg.data !== undefined
          ) {
            image = msg.data;
          } else if (
            msg.name === "user-data/strawverse-provider" &&
            msg.data !== undefined
          ) {
            provider = msg.data;
          } else if (
            msg.name === "user-data/strawverse-malid" &&
            msg.data !== undefined
          ) {
            malid = msg.data;
          } else if (msg.name === "volume" && typeof msg.data === "number") {
            window.webContents.send("mpv-setting-changed", {
              name: "volume",
              value: msg.data / 100,
            });
          } else if (msg.name === "speed" && typeof msg.data === "number") {
            window.webContents.send("mpv-setting-changed", {
              name: "speed",
              value: msg.data,
            });
            try {
              setKeyValue("Settings", "playerSpeed", msg.data);
            } catch (_) {}
          } else if (msg.name === "sub-visibility" && msg.data !== undefined) {
            const isVisible =
              msg.data === true || msg.data === "yes" || msg.data === 1;
            window.webContents.send("mpv-setting-changed", {
              name: "subs-enabled",
              value: isVisible,
            });
          } else if (
            msg.name === "brightness" &&
            typeof msg.data === "number"
          ) {
            window.webContents.send("mpv-setting-changed", {
              name: "brightness",
              value: msg.data,
            });
          } else if (msg.name === "time-pos" && typeof msg.data === "number") {
            const prevTime = currentTime;
            currentTime = msg.data;
            sendStarted();

            const now = Date.now();
            const timeDiff = Math.abs(currentTime - prevTime);

            // Auto-save every 10 seconds OR immediately on seek (jump > 3 seconds)
            if (
              now - lastPeriodicSave >= 10000 ||
              (prevTime > 0 && timeDiff > 3)
            ) {
              saveProgressToDb(currentTime);
            }

            if (now - lastSyncTime > 1000) {
              window.webContents.send("mpv-progress", {
                currentTime: currentTime,
                duration: duration,
                paused: paused,
              });
              lastSyncTime = now;
            }

            if (duration > 0 && currentTime >= duration - 1.5) {
              triggerAutoNext("video end");
            }
          } else if (msg.name === "duration" && typeof msg.data === "number") {
            duration = msg.data;
          } else if (msg.name === "seeking" && msg.data === false) {
            lastSavedTime = currentTime;
            if (duration > 0 && currentTime < duration - 5) {
              hasTriggeredAutoNext = false;
              if (global.activeMpvSession) {
                global.activeMpvSession.hasTriggeredAutoNext = false;
              }
            }
            saveProgressToDb(currentTime);
          } else if (msg.name === "eof-reached" && msg.data === true) {
            triggerAutoNext("eof-reached");
          } else if (msg.name === "pause" && typeof msg.data === "boolean") {
            paused = msg.data;
            saveProgressToDb(currentTime);
            window.webContents.send("mpv-progress", {
              currentTime: currentTime,
              duration: duration,
              paused: paused,
            });
          }
        }
      } catch (e) {}
    };

    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          handleIpcMessage(line.trim());
        }
      }
    });
  } catch (err) {
    logger.error(
      `[MPV] IPC connection warning (playing without direct sync): ${err.message}`,
    );
  }

  let terminated = false;
  const handleTermination = async (code, signal, eventSource) => {
    if (terminated) return;
    terminated = true;

    logger.info(
      `[MPV] Native player ${eventSource} with code ${code}${signal ? `, signal ${signal}` : ""}`,
    );

    if (global.activeMpvProcess === mpvProcess) {
      global.activeMpvProcess = null;
    }
    if (global.activeMpvClient === client) {
      global.activeMpvClient = null;
    }
    global.activeMpvSession = null;
    if (client && !client.destroyed) {
      client.destroy();
    }

    try {
      const closeTimeSpent = Math.max(0, currentTime - lastSavedTime);
      lastSavedTime = currentTime;
      await updateHistory({
        mediaId: mediaId,
        type: "Anime",
        title: title,
        number: episode,
        currentTime: currentTime,
        duration: duration || options.duration || 0,
        timeSpent: closeTimeSpent,
        image: image,
        provider: provider,
        malid: malid,
        subdub:
          activeSources[0]?.lang || activeSources[0]?.type || subdub || "sub",
      });
      logger.info(
        `[MPV] Synced watch history on player ${eventSource}: currentTime=${currentTime}`,
      );
    } catch (dbErr) {
      logger.error(`[MPV] Failed to write history progress: ${dbErr.message}`);
    }

    if (process.platform !== "win32") {
      try {
        if (fs.existsSync(ipcPath)) {
          fs.unlinkSync(ipcPath);
        }
      } catch (e) {}
    }

    for (const dir of activeTempSubDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch (e) {}
    }
    activeTempSubDirs.clear();

    if (global.activePlayRequestId !== currentRequestId) {
      logger.info(
        `[MPV] Player process superseded by request ${global.activePlayRequestId}, suppressing close IPC.`,
      );
      return;
    }

    const targetWin =
      window && !window.isDestroyed() && window.webContents
        ? window
        : global.win && !global.win.isDestroyed() && global.win.webContents
          ? global.win
          : null;

    if (targetWin) {
      const isNormalExit =
        hasStartedSent || code === 0 || code === 4 || signal !== null;

      if (!isNormalExit) {
        targetWin.webContents.send("mpv-error", {
          message: `MPV player failed to open stream (Exit Code ${code}).`,
          action: pendingAction,
        });
      } else {
        targetWin.webContents.send("mpv-closed", {
          currentTime: currentTime,
          duration: duration || options.duration || 0,
          action: pendingAction,
        });
      }
    }
  };

  mpvProcess.on("exit", (code, signal) =>
    handleTermination(code, signal, "exit"),
  );
  mpvProcess.on("close", (code, signal) =>
    handleTermination(code, signal, "close"),
  );

  mpvProcess.on("error", (spawnErr) => {
    logger.error(
      `[MPV] Failed to spawn native MPV process: ${spawnErr.message}`,
    );
    const targetWin =
      window && !window.isDestroyed() && window.webContents
        ? window
        : global.win && !global.win.isDestroyed() && global.win.webContents
          ? global.win
          : null;
    if (targetWin) {
      targetWin.webContents.send("mpv-error", {
        message: `MPV could not be launched. Make sure it is installed and added to your system PATH. Error: ${spawnErr.message}`,
      });
    }
  });
}

module.exports = { playInMpv, toProxyUrl };
