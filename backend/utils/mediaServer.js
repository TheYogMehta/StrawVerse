const fs = require("fs");
const path = require("path");
const axios = require("axios");

const { logger } = require("./AppLogger");
const { queryAll, queryOne, run } = require("./db");
const { settingfetch, providerFetch } = require("./settings");
const { getDownloadsFolder, GetDir } = require("./DirectoryMaker");
const { getHeaders } = require("./proxyHeaders");
const ImageCacheManager = require("./ImageCacheManager");
const { resolveMalIdFromMapping } = require("./mappingResolver");
const { animeinfo } = require("./AnimeManga");
const {
  isVideoFile,
  isSubtitleFile,
  getEpisodeNumberFromFilename,
  sanitizeFolderName,
  SEASON_FOLDER_RE,
} = require("./constants");

const MalAppID = "d0b22d129a541dac4d28207f77b15b5f";

/**
 * Escapes characters for XML content in NFO files.
 */
function xmlEscape(str) {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// Rate-limiting queue and in-memory cache for MyAnimeList API calls
const malMetaCache = new Map();
let malRequestQueuePromise = Promise.resolve();
let lastMalApiRequestTime = 0;
const MAL_API_MIN_INTERVAL_MS = 1500; // Minimum 1.5s between requests to api.myanimelist.net

/**
 * Executes a call to MyAnimeList API sequentially with rate-limit protection and automatic 429 backoff.
 */
async function execThrottledMalRequest(fn) {
  return (malRequestQueuePromise = malRequestQueuePromise.then(
    async () => {
      const now = Date.now();
      const elapsed = now - lastMalApiRequestTime;
      if (elapsed < MAL_API_MIN_INTERVAL_MS) {
        await new Promise((r) =>
          setTimeout(r, MAL_API_MIN_INTERVAL_MS - elapsed),
        );
      }

      let attempts = 0;
      const maxAttempts = 2;
      while (attempts < maxAttempts) {
        attempts++;
        try {
          lastMalApiRequestTime = Date.now();
          return await fn();
        } catch (err) {
          const status = err.response?.status;
          if (status === 429) {
            const retryAfterSec =
              parseInt(err.response?.headers?.["retry-after"], 10) || 6;
            logger.warn(
              `[MediaServer] MyAnimeList API rate limit hit (HTTP 429). Pausing for ${retryAfterSec}s before retrying...`,
            );
            await new Promise((r) => setTimeout(r, retryAfterSec * 1000));
            if (attempts >= maxAttempts) throw err;
          } else {
            throw err;
          }
        }
      }
    },
    (queueErr) => {
      logger.error(
        `[MediaServer] Error in MAL request queue: ${queueErr?.message || queueErr}`,
      );
      return null;
    },
  ));
}

/**
 * Fetches canonical metadata from MyAnimeList API v2 with queueing, rate limiting, and caching.
 */
async function fetchMalMetadata(malId) {
  if (!malId) return null;
  const numId = Number(malId);
  if (isNaN(numId) || numId <= 0) return null;

  if (malMetaCache.has(numId)) {
    return malMetaCache.get(numId);
  }

  // 1. Query centralized server metadata endpoint first (avoids direct MAL API rate limits and IP blocks)
  try {
    const serverRes = await axios.get(
      `https://strawverse.theyogmehta.online/api/description/anime/${numId}`,
      { timeout: 8000 },
    );
    if (serverRes.status === 200 && serverRes.data) {
      const desc =
        serverRes.data.description || serverRes.data.synopsis || null;

      let localAnime = null;
      if (global.mappingDb) {
        try {
          localAnime = global.mappingDb
            .prepare("SELECT * FROM anime WHERE malid = ? LIMIT 1")
            .get(numId);
        } catch (_) {}
      }

      const mergedMeta = {
        title: serverRes.data.title || localAnime?.title || null,
        synopsis: desc || null,
        main_picture: {
          large:
            serverRes.data.image ||
            localAnime?.image_url ||
            serverRes.data.coverImage ||
            null,
          medium:
            serverRes.data.image ||
            localAnime?.image_url ||
            serverRes.data.coverImage ||
            null,
        },
        genres: (localAnime?.genres || "")
          .split(",")
          .map((g) => ({ name: g.trim() }))
          .filter((g) => g.name),
        status: serverRes.data.status || localAnime?.status || null,
        start_date:
          serverRes.data.aired ||
          serverRes.data.year ||
          localAnime?.aired ||
          null,
      };

      if (mergedMeta.title || mergedMeta.synopsis) {
        malMetaCache.set(numId, mergedMeta);
        return mergedMeta;
      }
    }
  } catch (_) {}

  // 2. Direct MAL API query with rate-limit queue
  try {
    const result = await execThrottledMalRequest(async () => {
      const resp = await axios.get(
        `https://api.myanimelist.net/v2/anime/${numId}?fields=id,title,main_picture,alternative_titles,start_date,end_date,synopsis,mean,rank,popularity,genres,num_episodes,status,studios`,
        {
          headers: {
            "X-MAL-CLIENT-ID": MalAppID,
            "User-Agent": "StrawVerse/1.0.0",
          },
          timeout: 10000,
        },
      );
      return resp.data;
    });

    if (result) {
      malMetaCache.set(numId, result);
      return result;
    }
  } catch (err) {
    logger.warn(
      `[MediaServer] Failed to fetch MAL metadata for malid ${numId}: ${err.message}`,
    );
  }

  return null;
}

/**
 * Downloads poster image into directory if missing.
 */
async function downloadPosterIfMissing(imageUrl, destPath) {
  if (!imageUrl || !destPath) return;
  try {
    if (fs.existsSync(destPath)) {
      const stat = await fs.promises.stat(destPath);
      if (stat.size > 1024) return;
    }

    const headers = getHeaders(imageUrl);
    const response = await axios.get(imageUrl, {
      responseType: "arraybuffer",
      timeout: 12000,
      headers,
    });

    if (response.status === 200 && response.data) {
      const imageBuffer = Buffer.from(response.data);
      await fs.promises.writeFile(destPath, imageBuffer);
      logger.info(`[MediaServer] Saved poster: ${destPath}`);
      try {
        ImageCacheManager.cacheImage(imageUrl, imageBuffer).catch(() => {});
      } catch (_) {}
    }
  } catch (err) {
    logger.warn(
      `[MediaServer] Failed to download poster from ${imageUrl}: ${err.message}`,
    );
  }
}

/**
 * Generates Kodi/Jellyfin/Plex tvshow.nfo and episode .nfo files, and poster.jpg
 * for a specific downloaded anime. Supports both Show/Season NN layout and flat layout.
 */
async function generateNfoAndPosterForAnime(
  animeId,
  customDir = null,
  opts = {},
) {
  try {
    const config = await settingfetch();
    const downloadDir =
      customDir || config?.CustomDownloadLocationAnime || getDownloadsFolder();

    const anime = await queryOne(
      "SELECT * FROM Anime WHERE id = ? OR folder_name = ? OR LOWER(title) = LOWER(?) LIMIT 1",
      [animeId, animeId, animeId],
    );

    if (!anime) {
      return {
        success: false,
        error: `Anime '${animeId}' not found in database`,
      };
    }

    const folderName =
      anime.folder_name || sanitizeFolderName(anime.title || animeId);
    let targetDir = path.join(downloadDir, "Anime", folderName);

    if (!fs.existsSync(targetDir)) {
      targetDir = await GetDir(
        anime.title,
        downloadDir,
        "Anime",
        anime.id,
        false,
      );
      if (!targetDir || !fs.existsSync(targetDir)) {
        return {
          success: false,
          error: `Directory for anime '${anime.title || animeId}' does not exist on disk`,
        };
      }
    }

    // Determine show root directory and season directories
    let showDir = targetDir;
    let seasonDirs = [];

    if (SEASON_FOLDER_RE.test(path.basename(targetDir))) {
      showDir = path.dirname(targetDir);
      seasonDirs.push(targetDir);
    } else {
      showDir = targetDir;
      try {
        const entries = await fs.promises.readdir(showDir, {
          withFileTypes: true,
        });
        for (const entry of entries) {
          if (entry.isDirectory() && SEASON_FOLDER_RE.test(entry.name)) {
            seasonDirs.push(path.join(showDir, entry.name));
          }
        }
      } catch (_) {}
    }

    if (seasonDirs.length === 0) {
      seasonDirs = [showDir];
    }

    const tvshowNfoPath = path.join(showDir, "tvshow.nfo");
    const posterPath = path.join(showDir, "poster.jpg");
    const hasNfo = fs.existsSync(tvshowNfoPath);
    let hasPoster = false;
    try {
      const stat = await fs.promises.stat(posterPath);
      hasPoster = stat.size > 0;
    } catch (_) {}

    // Check if rich metadata already exists locally in DB
    const hasLocalRichMetadata =
      Boolean(anime.description) &&
      Boolean(anime.genres) &&
      (Boolean(anime.image_url) || hasPoster);

    // Resolve MAL ID if available
    let malId = anime.MalID ? Number(anime.MalID) : null;
    if (!malId && global.mappingDb && anime.id) {
      try {
        const resolved = await resolveMalIdFromMapping({
          id: anime.id,
          mediaType: "Anime",
        });
        if (resolved) malId = Number(resolved);
      } catch (_) {}
    }
    if (!malId && global.mappingDb && anime.title) {
      try {
        const titleMatch = await global.mappingDb
          .prepare(
            "SELECT malid FROM anime WHERE LOWER(TRIM(title)) = LOWER(TRIM(?)) LIMIT 1",
          )
          .get(anime.title);
        if (titleMatch?.malid) malId = Number(titleMatch.malid);
      } catch (_) {}
    }

    // Only make network requests to MAL / scraper if missing or forced
    let malMeta = null;
    let scraperMeta = null;
    const shouldFetchOnline =
      opts?.forceRefresh ||
      !hasLocalRichMetadata ||
      (!hasPoster && !anime.image_url);

    if (shouldFetchOnline) {
      if (malId) {
        malMeta = await fetchMalMetadata(malId);
        if (malMeta) {
          const malGenresStr =
            malMeta.genres && malMeta.genres.length > 0
              ? malMeta.genres
                  .map((g) => g.name || g)
                  .filter(Boolean)
                  .join(",")
              : null;
          const malPosterUrl =
            malMeta.main_picture?.large || malMeta.main_picture?.medium || null;
          try {
            await run(
              "UPDATE Anime SET description = COALESCE(?, description), genres = COALESCE(?, genres), image_url = COALESCE(?, image_url), status = COALESCE(?, status), aired = COALESCE(?, aired), MalID = COALESCE(MalID, ?) WHERE id = ?",
              [
                malMeta.synopsis || null,
                malGenresStr,
                malPosterUrl,
                malMeta.status || null,
                malMeta.start_date || null,
                String(malId),
                anime.id,
              ],
            );
          } catch (_) {}
        } else if (!anime.MalID) {
          try {
            await run("UPDATE Anime SET MalID = ? WHERE id = ?", [
              String(malId),
              anime.id,
            ]);
          } catch (_) {}
        }
      }

      if (!malMeta && !anime.description) {
        const providerName = anime.provider || config?.Animeprovider || null;
        if (providerName && anime.id) {
          try {
            const provObj = await providerFetch("Anime", providerName);
            if (
              provObj?.provider &&
              typeof provObj.provider.AnimeInfo === "function"
            ) {
              scraperMeta = await animeinfo(provObj, downloadDir, anime.id);
              if (scraperMeta) {
                const sGenres = Array.isArray(scraperMeta.genres)
                  ? scraperMeta.genres.join(",")
                  : scraperMeta.genres || null;
                await run(
                  "UPDATE Anime SET description = COALESCE(?, description), image_url = COALESCE(?, image_url), genres = COALESCE(?, genres), status = COALESCE(?, status), aired = COALESCE(?, aired) WHERE id = ?",
                  [
                    scraperMeta.description || null,
                    scraperMeta.image || scraperMeta.image_url || null,
                    sGenres,
                    scraperMeta.status || null,
                    scraperMeta.aired || null,
                    anime.id,
                  ],
                ).catch(() => {});
              }
            }
          } catch (err) {
            logger.warn(
              `[MediaServer] Failed to fetch scraper metadata for ${anime.id}: ${err.message}`,
            );
          }
        }
      }
    }

    // Determine metadata fields preferring MyAnimeList -> Scraper -> Existing Anime Record
    const finalTitle =
      malMeta?.title ||
      scraperMeta?.title ||
      anime.title ||
      path.basename(showDir);
    const finalOriginalTitle =
      malMeta?.alternative_titles?.ja ||
      malMeta?.title ||
      scraperMeta?.title ||
      anime.title ||
      "";
    const finalPlot =
      malMeta?.synopsis || scraperMeta?.description || anime.description || "";
    const finalStatus =
      malMeta?.status || scraperMeta?.status || anime.status || "";
    const finalPremiered =
      malMeta?.start_date || scraperMeta?.aired || anime.aired || "";
    let finalYear = "";
    if (finalPremiered) {
      const match = String(finalPremiered).match(/\b(19\d{2}|20\d{2})\b/);
      if (match) finalYear = match[1];
    }
    const finalGenres =
      malMeta?.genres && malMeta.genres.length > 0
        ? malMeta.genres.map((g) => g.name || g).filter(Boolean)
        : Array.isArray(scraperMeta?.genres) && scraperMeta.genres.length > 0
          ? scraperMeta.genres.filter(Boolean)
          : (anime.genres || "")
              .split(",")
              .map((g) => g.trim())
              .filter(Boolean);

    // Preferred poster URL: MAL large picture -> MAL medium -> mapping.db image_url -> scraper image -> anime.image_url
    let bestPosterUrl =
      malMeta?.main_picture?.large || malMeta?.main_picture?.medium || null;

    if (!bestPosterUrl && malId && global.mappingDb) {
      try {
        const row = await global.mappingDb
          .prepare("SELECT image_url FROM anime WHERE malid = ? LIMIT 1")
          .get(malId);
        if (row?.image_url) bestPosterUrl = row.image_url;
      } catch (_) {}
    }

    if (!bestPosterUrl) {
      bestPosterUrl =
        scraperMeta?.image || scraperMeta?.image_url || anime.image_url;
    }

    // 1. Generate tvshow.nfo in the show root folder
    if (!hasNfo || opts?.forceRefresh || malMeta || scraperMeta) {
      const tvshowNfoContent = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        "<tvshow>",
        `  <title>${xmlEscape(finalTitle)}</title>`,
        finalOriginalTitle
          ? `  <originaltitle>${xmlEscape(finalOriginalTitle)}</originaltitle>`
          : "",
        `  <plot>${xmlEscape(finalPlot)}</plot>`,
        finalStatus ? `  <status>${xmlEscape(finalStatus)}</status>` : "",
        finalPremiered
          ? `  <premiered>${xmlEscape(finalPremiered)}</premiered>`
          : "",
        finalYear ? `  <year>${finalYear}</year>` : "",
        ...finalGenres.map((g) => `  <genre>${xmlEscape(g)}</genre>`),
        malId
          ? `  <uniqueid type="mal" default="true">${xmlEscape(malId)}</uniqueid>`
          : "",
        "</tvshow>",
      ]
        .filter(Boolean)
        .join("\n");

      await fs.promises.writeFile(tvshowNfoPath, tvshowNfoContent, "utf8");
    }

    // 2. Download poster.jpg and folder.jpg in the show root folder
    if (bestPosterUrl && !hasPoster) {
      await downloadPosterIfMissing(bestPosterUrl, posterPath);
      const folderJpgPath = path.join(showDir, "folder.jpg");
      if (!fs.existsSync(folderJpgPath) && fs.existsSync(posterPath)) {
        await fs.promises.copyFile(posterPath, folderJpgPath).catch(() => {});
      }
    }

    // 3. Scan video files across all season directories, generate per-episode .nfo, and align subtitles
    let episodeNfoCount = 0;
    for (const sDir of seasonDirs) {
      const sDirBase = path.basename(sDir);
      const sMatch = sDirBase.match(/^Season (\d+)$/i);
      const defaultSeasonNum = sMatch ? parseInt(sMatch[1], 10) : 1;

      const files = await fs.promises.readdir(sDir);
      const subsDir = path.join(sDir, "subs");
      const hasSubs = fs.existsSync(subsDir);
      let subsInDir = [];
      if (hasSubs) {
        try {
          subsInDir = await fs.promises.readdir(subsDir);
        } catch (_) {}
      }

      for (const file of files) {
        if (!isVideoFile(file)) continue;
        if (
          file.startsWith(".") ||
          file.includes(".temp") ||
          file.endsWith(".tmp") ||
          file.endsWith(".part") ||
          file.endsWith(".downloading")
        ) {
          continue;
        }

        const epNum = getEpisodeNumberFromFilename(file);
        if (epNum === null || isNaN(epNum)) continue;

        const fileSMatch = file.match(/\bS(\d{1,3})E/i);
        const epSeason = fileSMatch
          ? parseInt(fileSMatch[1], 10)
          : defaultSeasonNum;

        const baseName = path.parse(file).name;
        const episodeNfoPath = path.join(sDir, `${baseName}.nfo`);

        const episodeNfoContent = [
          '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
          "<episodedetails>",
          `  <title>Episode ${epNum}</title>`,
          `  <season>${epSeason}</season>`,
          `  <episode>${epNum}</episode>`,
          "</episodedetails>",
        ].join("\n");

        await fs.promises.writeFile(episodeNfoPath, episodeNfoContent, "utf8");
        episodeNfoCount++;

        // Align external subtitles next to the video file
        if (hasSubs && subsInDir.length > 0) {
          const epNumFloat = parseFloat(epNum);
          for (const subFile of subsInDir) {
            if (!isSubtitleFile(subFile)) continue;
            const match = subFile.match(/^(?:ep)?(\d+(?:\.\d+)?)/i);
            if (match && parseFloat(match[1]) === epNumFloat) {
              const parts = subFile.split(".");
              const ext = parts.pop();
              let lang = "en";
              if (parts.length >= 2) {
                const rawLang = parts[parts.length - 1];
                if (
                  rawLang &&
                  rawLang.length <= 4 &&
                  !/^\d+ep$/i.test(rawLang)
                ) {
                  lang = rawLang;
                }
              }
              const targetSubName = `${baseName}.${lang}.${ext}`;
              const targetSubPath = path.join(sDir, targetSubName);
              if (!fs.existsSync(targetSubPath)) {
                try {
                  await fs.promises.copyFile(
                    path.join(subsDir, subFile),
                    targetSubPath,
                  );
                  logger.info(
                    `[MediaServer] Aligned subtitle for Jellyfin/Plex: ${targetSubName}`,
                  );
                } catch (err) {
                  logger.error(
                    `[MediaServer] Failed to copy subtitle ${subFile}: ${err.message}`,
                  );
                }
              }
            }
          }
        }
      }
    }

    logger.info(
      `[MediaServer] Generated Jellyfin/Plex metadata for '${anime.title}': tvshow.nfo, poster.jpg, and ${episodeNfoCount} episode NFOs.`,
    );

    return {
      success: true,
      folder: showDir,
      episodeNfoCount,
    };
  } catch (err) {
    logger.error(
      `[MediaServer] Error generating NFO/posters for anime '${animeId}': ${err.message}`,
    );
    return { success: false, error: err.message };
  }
}

// Media Server Background Sync Queue
const mediaSyncQueue = [];
const activeEnqueuedIds = new Set();
let isProcessingMediaSyncQueue = false;

/**
 * Enqueues an anime for Jellyfin/Plex metadata & poster generation.
 */
function enqueueMediaSync(animeId, customDir = null, opts = {}) {
  const idKey = String(animeId).toLowerCase().trim();
  if (activeEnqueuedIds.has(idKey)) {
    return Promise.resolve({
      success: true,
      alreadyQueued: true,
      message: `Anime '${animeId}' is already in the media sync queue.`,
    });
  }

  return new Promise((resolve) => {
    const task = {
      animeId,
      customDir,
      opts,
      resolve,
    };

    activeEnqueuedIds.add(idKey);

    if (opts.priority) {
      mediaSyncQueue.unshift(task);
    } else {
      mediaSyncQueue.push(task);
    }

    _processNextInMediaSyncQueue();
  });
}

/**
 * Worker that processes items in mediaSyncQueue sequentially with rate limiting.
 */
async function _processNextInMediaSyncQueue() {
  if (isProcessingMediaSyncQueue) return;
  isProcessingMediaSyncQueue = true;

  try {
    let processed = 0;
    let errors = 0;

    while (mediaSyncQueue.length > 0) {
      const task = mediaSyncQueue.shift();
      const idKey = String(task.animeId).toLowerCase().trim();

      try {
        const result = await generateNfoAndPosterForAnime(
          task.animeId,
          task.customDir,
          task.opts,
        );
        if (result?.success) {
          processed++;
        } else {
          errors++;
        }
        task.resolve(result);
      } catch (err) {
        errors++;
        logger.error(
          `[MediaServerQueue] Error processing '${task.animeId}': ${err.message}`,
        );
        task.resolve({ success: false, error: err.message });
      } finally {
        activeEnqueuedIds.delete(idKey);
      }

      if (mediaSyncQueue.length > 0) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }

    if (processed > 0 || errors > 0) {
      logger.info(
        `[MediaServerQueue] Batch sync run finished. Processed: ${processed}, Errors: ${errors}.`,
      );
    }
  } finally {
    isProcessingMediaSyncQueue = false;
  }
}

/**
 * Scans all downloaded anime in database and safely generates NFOs + posters
 * through the rate-limited background queue.
 */
async function generateAllNfosAndPosters(customDir = null) {
  try {
    const config = await settingfetch();
    const downloadDir =
      customDir || config?.CustomDownloadLocationAnime || getDownloadsFolder();
    const rows = await queryAll("SELECT id, title FROM Anime");

    if (!rows || rows.length === 0) {
      return { success: true, enqueuedCount: 0, total: 0 };
    }

    logger.info(
      `[MediaServerQueue] Enqueuing ${rows.length} anime for rate-limited background metadata sync...`,
    );

    let enqueuedCount = 0;
    for (const row of rows) {
      enqueueMediaSync(row.id, downloadDir, { priority: false }).catch(
        () => {},
      );
      enqueuedCount++;
    }

    return {
      success: true,
      enqueuedCount,
      total: rows.length,
    };
  } catch (err) {
    logger.error(
      `[MediaServerQueue] Failed to enqueue batch NFOs: ${err.message}`,
    );
    return { success: false, error: err.message };
  }
}

/**
 * Hook invoked when an anime episode download finishes.
 * Automatically creates/updates NFO metadata via the sync queue if media server naming is enabled.
 */
async function onAnimeDownloadComplete(item) {
  if (!item || item.Type !== "Anime") return;

  try {
    const config = await settingfetch();
    if (config?.mediaServerNaming && item.id) {
      await enqueueMediaSync(item.id, config?.CustomDownloadLocationAnime, {
        priority: true,
      });
    }
  } catch (err) {
    logger.error(
      `[MediaServerQueue] Failed processing post-download for '${item.id}': ${err.message}`,
    );
  }
}

module.exports = {
  xmlEscape,
  generateNfoAndPosterForAnime,
  generateAllNfosAndPosters,
  onAnimeDownloadComplete,
  enqueueMediaSync,
};
