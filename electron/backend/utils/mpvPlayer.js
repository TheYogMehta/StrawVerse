const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const { logger } = require("./AppLogger");
const { updateHistory } = require("./history");
const {
  providerFetch,
  getUserSettings,
  isLanguagePreferred,
} = require("./settings");
const { processServer, fetchEpisodeSources } = require("./AnimeManga");

function parseSeconds(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) || val > 10800 ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;
  if (
    str.includes(" ") ||
    str.includes("-") ||
    str.includes("T") ||
    str.includes("Z") ||
    str.length > 12
  ) {
    return 0;
  }

  if (str.includes(":")) {
    const parts = str.split(":").map((p) => parseFloat(p));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) {
      const totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      return totalSec > 10800 ? 0 : totalSec;
    } else if (parts.length === 2) {
      const totalSec = parts[0] * 60 + parts[1];
      return totalSec > 10800 ? 0 : totalSec;
    }
    return 0;
  }

  const num = parseFloat(str);
  return isNaN(num) || num > 10800 ? 0 : num;
}

async function fetchSkipTimes(malid, epNum) {
  if (!malid || !epNum) return null;
  try {
    const url = `https://api.aniskip.com/v2/skip-times/${malid}/${Number(epNum)}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=0`;
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

function normalizeLangCode(str) {
  if (!str) return "";
  const s = String(str).toLowerCase().trim();
  if (s === "en" || s === "eng" || s.includes("english")) return "english";
  if (s === "jp" || s === "jpn" || s.includes("japanese")) return "japanese";
  if (s === "es" || s === "spa" || s.includes("spanish")) return "spanish";
  if (s === "fr" || s === "fra" || s === "fre" || s.includes("french"))
    return "french";
  if (s === "de" || s === "deu" || s === "ger" || s.includes("german"))
    return "german";
  if (s === "it" || s === "ita" || s.includes("italian")) return "italian";
  if (s === "ru" || s === "rus" || s.includes("russian")) return "russian";
  if (
    s === "pt" ||
    s === "por" ||
    s.includes("portuguese") ||
    s.includes("brazilian")
  )
    return "portuguese";
  if (s === "zh" || s === "zho" || s.includes("chinese")) return "chinese";
  if (s === "ar" || s === "ara" || s.includes("arabic")) return "arabic";
  return s;
}

function filterPreselectedSubtitle(subs, preferredLang = "english") {
  if (!subs || !Array.isArray(subs) || subs.length === 0) return [];
  const prefNorm = normalizeLangCode(preferredLang);
  if (prefNorm === "off" || prefNorm === "false" || prefNorm === "none") {
    return [];
  }

  const matchLang = (sub, targetNorm) => {
    if (!sub || !targetNorm) return false;
    const l1 = normalizeLangCode(sub.lang);
    const l2 = normalizeLangCode(sub.label);
    const l3 = normalizeLangCode(sub.name);
    const l4 = normalizeLangCode(sub.url);
    return (
      (l1 && (l1 === targetNorm || l1.includes(targetNorm))) ||
      (l2 && (l2 === targetNorm || l2.includes(targetNorm))) ||
      (l3 && (l3 === targetNorm || l3.includes(targetNorm))) ||
      (l4 && (l4 === targetNorm || l4.includes(targetNorm)))
    );
  };

  if (prefNorm) {
    const matched = subs.find((s) => matchLang(s, prefNorm));
    if (matched) return [matched];
  }

  if (prefNorm !== "english") {
    const engMatched = subs.find((s) => matchLang(s, "english"));
    if (engMatched) return [engMatched];
  }

  return [subs[0]];
}

function sortSourcesByPreferredQuality(sources, preferredQuality = "highest") {
  if (!sources || !Array.isArray(sources) || sources.length <= 1)
    return sources;

  const parseQualNum = (s) => {
    const qStr = (s.quality || s.name || "").toLowerCase();
    const match = qStr.match(/(\d+)p/);
    if (match) return parseInt(match[1], 10);
    if (qStr.includes("1080")) return 1080;
    if (qStr.includes("720")) return 720;
    if (qStr.includes("480")) return 480;
    if (qStr.includes("360")) return 360;
    return 0;
  };

  const prefNorm = String(preferredQuality).toLowerCase().trim();

  if (prefNorm !== "highest" && prefNorm !== "auto" && prefNorm !== "default") {
    const prefNum = parseInt(prefNorm.replace(/\D/g, ""), 10);
    if (prefNum > 0) {
      const matchIdx = sources.findIndex((s) => parseQualNum(s) === prefNum);
      if (matchIdx > 0) {
        const matched = sources.splice(matchIdx, 1)[0];
        sources.unshift(matched);
        return sources;
      }
    }
  }

  const hasQualities = sources.some((s) => parseQualNum(s) > 0);
  if (hasQualities) {
    sources.sort((a, b) => parseQualNum(b) - parseQualNum(a));
  }

  return sources;
}

const getMpvPath = () => {
  const { app } = require("electron");
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
    if (fs.existsSync(devPathOuter)) {
      return devPathOuter;
    }
  } catch (e) {}

  // 3. Fallback to system command
  return "mpv";
};

const getMpvConfigDir = () => {
  const { app } = require("electron");
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

  const port = global.PORT || 3000;
  return `http://localhost:${port}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
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
  const port = global.PORT || 3000;
  const base = `http://127.0.0.1:${port}/api/stream`;
  const ref = customHeaders?.Referer || customHeaders?.referer || "";
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
  return `${base}/segment?url=${encodeURIComponent(url)}${refParam}`;
};

async function playInMpv(window, options) {
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
  let image = options.image || "";
  let provider = options.provider || "";
  let malid = options.malid || "";
  let subdub = options.subdub || "sub";
  let url = options.url || "";

  let autoSkipIntro = true;
  let autoPlayNextEpisode = true;
  try {
    const settingsPath = path.join(
      require("electron").app.getPath("userData"),
      "settings.json",
    );
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (settings.autoSkipIntro !== undefined)
        autoSkipIntro = settings.autoSkipIntro;
      if (settings.autoPlayNextEpisode !== undefined)
        autoPlayNextEpisode = settings.autoPlayNextEpisode;
      if (settings.playerSpeed !== undefined && !options.speed) {
        const spd = parseFloat(settings.playerSpeed);
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
      const { getSourceById } = require("./Metadata");
      const { settingfetch } = require("./settings");
      const config = await settingfetch();
      const localData = await getSourceById(
        "Anime",
        config?.CustomDownloadLocation,
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
              `SELECT current_time, episode_number, sub_dub FROM WatchHistory WHERE (anime_id IN (${placeholders}) OR LOWER(anime_title) = LOWER(?)) AND (episode_number = ? OR CAST(episode_number AS REAL) = ? OR episode_number = ?) ORDER BY last_watched DESC LIMIT 1`,
            )
            .get(...queryIds, title, parsedEp, parsedEp, strEp);
        } else {
          historyRec = global.db
            .prepare(
              `SELECT current_time, episode_number, sub_dub FROM WatchHistory WHERE anime_id IN (${placeholders}) AND (episode_number = ? OR CAST(episode_number AS REAL) = ? OR episode_number = ?) ORDER BY last_watched DESC LIMIT 1`,
            )
            .get(...queryIds, parsedEp, parsedEp, strEp);
        }
      } else if (title && title !== "Anime") {
        historyRec = global.db
          .prepare(
            `SELECT current_time, episode_number, sub_dub FROM WatchHistory WHERE LOWER(anime_title) = LOWER(?) AND (episode_number = ? OR CAST(episode_number AS REAL) = ? OR episode_number = ?) ORDER BY last_watched DESC LIMIT 1`,
          )
          .get(title, parsedEp, parsedEp, strEp);
      }

      let fallbackRec = null;
      if (queryIds.length > 0) {
        const placeholders = queryIds.map(() => "?").join(",");
        if (title && title !== "Anime") {
          fallbackRec = global.db
            .prepare(
              `SELECT current_time, episode_number, sub_dub FROM WatchHistory WHERE (anime_id IN (${placeholders}) OR LOWER(anime_title) = LOWER(?)) ORDER BY last_watched DESC LIMIT 1`,
            )
            .get(...queryIds, title);
        } else {
          fallbackRec = global.db
            .prepare(
              `SELECT current_time, episode_number, sub_dub FROM WatchHistory WHERE anime_id IN (${placeholders}) ORDER BY last_watched DESC LIMIT 1`,
            )
            .get(...queryIds);
        }
      } else if (title && title !== "Anime") {
        fallbackRec = global.db
          .prepare(
            `SELECT current_time, episode_number, sub_dub FROM WatchHistory WHERE LOWER(anime_title) = LOWER(?) ORDER BY last_watched DESC LIMIT 1`,
          )
          .get(title);
      }

      const activeRec = historyRec || fallbackRec;

      if (historyRec && startSeek === 0 && historyRec.current_time) {
        const recEp = parseFloat(historyRec.episode_number);
        if (!isNaN(recEp) && recEp === parsedEp) {
          const rawSec = parseSeconds(historyRec.current_time);
          startSeek = Math.max(0, rawSec - 5);
          logger.info(
            `[MPV] Restored seek time ${Math.floor(startSeek)}s (from ${historyRec.current_time} -> ${rawSec}s) for ${title} Ep ${episode}`,
          );
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
                "https://megaplay.buzz/";
              if (global.setDynamicReferer) {
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
        resolvedSuccess = true;
        if (i > 0) {
          const [resolvedSrc] = activeSources.splice(i, 1);
          activeSources.unshift(resolvedSrc);
        }
        break;
      }
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

  // Deduplicate and filter preselected subtitle track by user setting
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
          const ref =
            activeSources[0]?.headers?.Referer || "https://megaplay.buzz/";
          global.setDynamicReferer(subDomain, ref);
        } catch (e) {}
      }
    });

    let preferredSubLang = "english";
    try {
      const settingsPath = path.join(
        require("electron").app.getPath("userData"),
        "settings.json",
      );
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
        if (settings.subtitleLang) preferredSubLang = settings.subtitleLang;
      }
    } catch (e) {}

    activeSubtitles = filterPreselectedSubtitle(
      activeSubtitles,
      preferredSubLang,
    );
    logger.info(
      `[MPV] Selected ${activeSubtitles.length} preselected subtitle track (${preferredSubLang})`,
    );
  }

  const resolvedUrl = resolvePathOrUrl(playTargetUrl);
  const isExternal = resolvedUrl.startsWith("http");
  const playUrl = isExternal
    ? toProxyUrl(resolvedUrl, activeSources[0]?.headers)
    : resolvedUrl;
  const ipcPath = getIpcPath();
  const configDir = getMpvConfigDir();
  let shortTitle = title || "Anime";
  if (shortTitle.length > 40) {
    shortTitle = shortTitle.substring(0, 40) + "...";
  }
  const displayTitle = `Ep ${episode || 1} - ${shortTitle}`;

  const args = [
    `--input-ipc-server=${ipcPath}`,
    `--title=StrawVerse - ${title || "Player"} - Episode ${episode || 1}`,
    `--force-media-title=${displayTitle}`,
    `--config-dir=${configDir}`,
    "--sub-font=sans-serif",
    "--sub-font-size=46",
    "--sub-color=#ffffffff",
    "--sub-border-color=#000000ff",
    "--sub-border-size=2.0",
    "--sub-shadow-offset=0",
    "--sub-margin-y=36",
    "--hwdec=auto-safe",
    "--force-window=yes",
    "--fullscreen",
    "--no-ytdl",
    "--demuxer-lavf-o=timeout=10000000",
    "--osd-on-seek=msg",
    `--volume=${options.volume !== undefined ? Math.floor(options.volume) : 100}`,
    `--speed=${options.speed || 1.0}`,
    `--sub-visibility=${options.subsEnabled === false ? "no" : "yes"}`,
    `--brightness=${options.brightness || 0}`,
  ];

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
    `osc-autoplay_next=${autoPlayNextEpisode ? "yes" : "no"}`,
    `modernx-has-next=${options.hasNext ? "yes" : "no"}`,
    `modernx-has-prev=${options.hasPrev ? "yes" : "no"}`,
  ];

  const skipTimes = await fetchSkipTimes(malid, episode);
  if (skipTimes) {
    if (skipTimes.opStart !== null && skipTimes.opEnd !== null) {
      scriptOpts.push(`modernx-op-start=${Math.floor(skipTimes.opStart)}`);
      scriptOpts.push(`modernx-op-end=${Math.floor(skipTimes.opEnd)}`);
    }
    if (skipTimes.edStart !== null) {
      scriptOpts.push(`modernx-ed-start=${Math.floor(skipTimes.edStart)}`);
    }
    logger.info(
      `[MPV] Applied AniSkip timestamps for Ep ${episode}: OP (${skipTimes.opStart}s - ${skipTimes.opEnd}s), ED (${skipTimes.edStart}s)`,
    );
  }

  if (activeSources && activeSources.length > 0) {
    const sourcesStr = activeSources
      .filter((s) => s && (s.url || s.name || s.quality))
      .map((s) => {
        const name = s.quality || s.name || "Server";
        if (s.url) {
          const sUrl = resolvePathOrUrl(s.url);
          return `${name}|${sUrl.startsWith("http") ? toProxyUrl(sUrl) : sUrl}`;
        }
        return `${name}|unresolved:${name}`;
      })
      .join("##");
    if (sourcesStr) {
      scriptOpts.push(`modernx-sources=${sourcesStr}`);
    }
  }

  if (activeSubtitles && Array.isArray(activeSubtitles)) {
    const userSettings = getUserSettings ? getUserSettings() : null;
    const prefLangs = userSettings?.preferredLanguages || ["English"];

    const seenUrls = new Set();
    let validSubs = activeSubtitles.filter((sub) => {
      if (!sub || !sub.url) return false;
      const u = String(sub.url).trim();
      if (seenUrls.has(u)) return false;
      seenUrls.add(u);
      return true;
    });

    const prefSubs = validSubs.filter((sub) =>
      isLanguagePreferred(sub.lang || sub.label, prefLangs),
    );
    if (prefSubs.length > 0) {
      validSubs = prefSubs;
    }

    logger.info(`[MPV] Processing ${validSubs.length} subtitle tracks for MPV`);

    const subsStr = validSubs
      .map((sub, idx) => {
        const cleanLang = formatSubtitleLabel(sub, idx);
        const rawUrl = resolvePathOrUrl(sub.url);
        const subUrl = rawUrl.startsWith("http") ? toProxyUrl(rawUrl) : rawUrl;
        return `${cleanLang}|${subUrl}`;
      })
      .join("##");

    if (subsStr) {
      scriptOpts.push(`modernx-subtitles=${subsStr}`);
    }

    validSubs.forEach((sub, idx) => {
      const cleanLang = formatSubtitleLabel(sub, idx);
      sub.lang = cleanLang;
      sub.label = cleanLang;
      const rawUrl = resolvePathOrUrl(sub.url);
      const subUrl = rawUrl.startsWith("http") ? toProxyUrl(rawUrl) : rawUrl;
      args.push(`--sub-file=${subUrl}`);
    });

    if (validSubs.length > 0 && options.subsEnabled !== false) {
      const selectedIndex =
        options.selectedSubIndex !== undefined &&
        options.selectedSubIndex >= 0 &&
        options.selectedSubIndex < validSubs.length
          ? options.selectedSubIndex
          : 0;
      args.push(`--sid=${selectedIndex + 1}`);
    } else if (options.subsEnabled === false) {
      args.push("--sid=no");
    } else {
      args.push("--sid=auto");
    }
  } else {
    if (options.subsEnabled === false) {
      args.push("--sid=no");
    } else {
      args.push("--sid=auto");
    }
  }

  scriptOpts.forEach((opt) => {
    args.push(`--script-opts-add=${opt}`);
  });

  if (startSeek > 0) {
    args.push(`--start=${Math.floor(startSeek)}`);
  }

  args.push(playUrl);

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
      if (
        m.includes("ffmpeg/audio") ||
        m.includes("ffmpeg/video") ||
        m.includes("[ffmpeg]")
      )
        return true;
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
  let lastSyncTime = Date.now();
  let paused = false;
  let buffer = "";
  let pendingAction = null;
  let hasStartedSent = false;

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

    let lastPeriodicSave = Date.now();

    const saveProgressToDb = (currT) => {
      if (!currT || currT <= 0) return;
      const timeSpent = currT - startSeek;
      updateHistory({
        mediaId: mediaId,
        type: "Anime",
        title: title,
        number: episode,
        currentTime: currT,
        duration: duration || options.duration || 0,
        timeSpent: timeSpent > 0 ? timeSpent : 0,
        image: image,
        provider: provider,
        malid: malid,
        subdub:
          activeSources[0]?.lang || activeSources[0]?.type || subdub || "sub",
      }).catch((e) =>
        logger.error(`[MPV] Periodic watch history sync failed: ${e.message}`),
      );
      lastPeriodicSave = Date.now();
    };

    const handleIpcMessage = (dataStr) => {
      try {
        const msg = JSON.parse(dataStr);
        if (msg.event === "file-loaded") {
          sendStarted();
        }
        if (msg.event === "property-change") {
          if (
            msg.name === "user-data/strawverse-action" &&
            typeof msg.data === "string" &&
            msg.data !== ""
          ) {
            pendingAction = msg.data;
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
                              "https://megaplay.buzz/";
                            if (global.setDynamicReferer) {
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
                      const newProxyUrl = toProxyUrl(
                        resolvePathOrUrl(finalServer.url),
                        finalServer.headers,
                      );
                      logger.info(
                        `[MPV IPC] Sending loadfile command to MPV for ${serverName}: ${newProxyUrl}`,
                      );
                      if (client && !client.destroyed) {
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

            const timeSpent = currentTime - startSeek;
            updateHistory({
              mediaId: mediaId,
              type: "Anime",
              title: title,
              number: episode,
              currentTime: currentTime,
              duration: duration || options.duration || 0,
              timeSpent: timeSpent > 0 ? timeSpent : 0,
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
            msg.data !== undefined
          ) {
            episode = msg.data;
            startSeek = 0;
            currentTime = 0;
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
          } else if (msg.name === "duration" && typeof msg.data === "number") {
            duration = msg.data;
          } else if (msg.name === "seeking" && msg.data === false) {
            saveProgressToDb(currentTime);
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

  mpvProcess.on("close", async (code, signal) => {
    logger.info(
      `[MPV] Native player closed with code ${code}${signal ? `, signal ${signal}` : ""}`,
    );

    if (global.activeMpvProcess === mpvProcess) {
      global.activeMpvProcess = null;
    }
    if (global.activeMpvClient === client) {
      global.activeMpvClient = null;
    }
    if (client && !client.destroyed) {
      client.destroy();
    }

    if (global.activePlayRequestId !== currentRequestId) {
      logger.info(
        `[MPV] Player process superseded by request ${global.activePlayRequestId}, suppressing close IPC.`,
      );
      return;
    }

    try {
      const timeSpent = currentTime - startSeek;
      await updateHistory({
        mediaId: mediaId,
        type: "Anime",
        title: title,
        number: episode,
        currentTime: currentTime,
        duration: duration || options.duration || 0,
        timeSpent: timeSpent > 0 ? timeSpent : 0,
        image: image,
        provider: provider,
        malid: malid,
        subdub:
          activeSources[0]?.lang || activeSources[0]?.type || subdub || "sub",
      });
      logger.info(
        `[MPV] Synced watch history on player close: currentTime=${currentTime}`,
      );
    } catch (dbErr) {
      logger.error(`[MPV] Failed to write history progress: ${dbErr.message}`);
    }

    const isNormalExit =
      hasStartedSent || code === 0 || code === 4 || signal !== null;

    if (!isNormalExit) {
      window.webContents.send("mpv-error", {
        message: `MPV player failed to open stream (Exit Code ${code}).`,
        action: pendingAction,
      });
    } else {
      window.webContents.send("mpv-closed", {
        currentTime: currentTime,
        duration: duration || options.duration || 0,
        action: pendingAction,
      });
    }

    if (process.platform !== "win32") {
      try {
        if (fs.existsSync(ipcPath)) {
          fs.unlinkSync(ipcPath);
        }
      } catch (e) {}
    }
  });

  mpvProcess.on("error", (spawnErr) => {
    logger.error(
      `[MPV] Failed to spawn native MPV process: ${spawnErr.message}`,
    );
    window.webContents.send("mpv-error", {
      message: `MPV could not be launched. Make sure it is installed and added to your system PATH. Error: ${spawnErr.message}`,
    });
  });
}

module.exports = { playInMpv, toProxyUrl };
