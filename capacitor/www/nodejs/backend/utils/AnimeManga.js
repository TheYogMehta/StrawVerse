const NodeCache = require("node-cache");
const path = require("path");
const crypto = require("crypto");
const JSZip = require("jszip");
const axios = require("axios");
const fs = require("fs");

const HLSLogger = require("./logger");
const { logger } = require("./AppLogger");
const { providerFetch } = require("./settings");
const { getHeaders } = require("./proxyHeaders");
const { queryAll, queryOne, run } = require("./db");
const { sanitizeFolderName, getDownloadsFolder } = require("./DirectoryMaker");

const cache = new NodeCache({ stdTTL: 60, checkperiod: 60 });

async function enrichWithLibraryTags(type, items) {
  if (!items || !Array.isArray(items) || items.length === 0) return items;

  try {
    const table = type === "Anime" ? "Anime" : "Manga";
    const ids = items.map((i) => i.id).filter(Boolean);
    const malIds = items
      .map((i) => String(i.malid || i.MalID || ""))
      .filter((b) => b && b !== "undefined" && b !== "null");
    const cleanTitles = items
      .map((i) =>
        i.title ? i.title.toLowerCase().replace(/[^a-z0-9]/g, "") : "",
      )
      .filter(Boolean);

    if (ids.length === 0 && malIds.length === 0 && cleanTitles.length === 0) {
      return items;
    }

    const idPlaceholders = ids.length ? ids.map(() => "?").join(",") : "NULL";
    const malPlaceholders = malIds.length
      ? malIds.map(() => "?").join(",")
      : "NULL";
    const titlePlaceholders = cleanTitles.length
      ? cleanTitles.map(() => "?").join(",")
      : "NULL";

    const sql = `
      SELECT id, MalID, title, folder_name, CustomTag FROM ${table} 
      WHERE CustomTag IS NOT NULL AND CustomTag != '' AND CustomTag != '[]'
        AND (
          id IN (${idPlaceholders})
          OR MalID IN (${malPlaceholders})
          OR LOWER(REPLACE(REPLACE(REPLACE(REPLACE(title, ' ', ''), ':', ''), '-', ''), '_', '')) IN (${titlePlaceholders})
          OR LOWER(REPLACE(REPLACE(REPLACE(REPLACE(folder_name, ' ', ''), ':', ''), '-', ''), '_', '')) IN (${titlePlaceholders})
        )
    `;

    const params = [];
    if (ids.length) params.push(...ids);
    if (malIds.length) params.push(...malIds);
    if (cleanTitles.length) params.push(...cleanTitles);
    if (cleanTitles.length) params.push(...cleanTitles);

    const matches = await queryAll(sql, params);

    if (!matches || matches.length === 0) return items;

    const matchById = new Map();
    const matchByMal = new Map();
    const matchByTitle = new Map();

    for (const m of matches) {
      if (!m.CustomTag) continue;
      if (m.id) matchById.set(m.id, m.CustomTag);
      if (m.MalID) matchByMal.set(String(m.MalID), m.CustomTag);
      if (m.title) {
        const clean = m.title.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (clean) matchByTitle.set(clean, m.CustomTag);
      }
      if (m.folder_name) {
        const clean = m.folder_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        if (clean) matchByTitle.set(clean, m.CustomTag);
      }
    }

    for (const item of items) {
      const tag =
        matchById.get(item.id) ||
        matchByMal.get(String(item.malid || item.MalID || "")) ||
        (item.title
          ? matchByTitle.get(item.title.toLowerCase().replace(/[^a-z0-9]/g, ""))
          : null);

      if (tag) {
        item.CustomTag = tag;
      }
    }
  } catch (_) {}
  return items;
}

//====================================== Anime ================================
// find popular anime
async function latestAnime(provider, filters) {
  if (!provider?.provider)
    throw new Error(
      "Missing Provider! ( try downloading from settings > marketplace )",
    );

  const cacheKey = CreateHashKey(
    `latestanime_${provider.provider_name}_${JSON.stringify(filters)}`,
  );

  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    if (cachedData.results)
      await enrichWithLibraryTags("Anime", cachedData.results);
    return cachedData;
  }

  const data = await provider.provider.fetchRecentEpisodes(filters);
  if (data?.results) await enrichWithLibraryTags("Anime", data.results);
  cache.set(cacheKey, data, 60);
  return data;
}

// search anime
async function animesearch(provider, Anime_NAME, filters = {}) {
  if (!provider?.provider)
    throw new Error(
      "Missing Provider! ( try downloading from settings > marketplace )",
    );

  let dataarray = { results: [] };
  const formattedAnimeName = Anime_NAME.replace(/\w\S*/g, (word) => {
    return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
  });
  let datafirst;
  try {
    datafirst = await findanime(provider, formattedAnimeName, filters);
    if (
      !datafirst ||
      !datafirst?.data ||
      !datafirst?.data?.length ||
      datafirst?.data?.length <= 0
    ) {
      datafirst = await findanime(provider, Anime_NAME, filters);
    }

    if (datafirst) {
      // results
      if (datafirst.data && datafirst.data.length > 0) {
        dataarray.results.push(...datafirst.data);
      }
      // next page
      if (datafirst?.hasNextPage) {
        dataarray.hasNextPage = datafirst.hasNextPage;
      } else {
        dataarray.hasNextPage = false;
      }
      // currentPage
      if (datafirst?.currentPage) {
        dataarray.currentPage = datafirst.currentPage;
      } else {
        dataarray.currentPage = filters?.page + 1;
      }
    }
  } catch (err) {
    throw new Error("No anime found..");
  }
  return dataarray;
}

// find more anime
async function findanime(provider, Anime_NAME, filters) {
  const cacheKey = CreateHashKey(
    `animesearch_${provider.provider_name}_${Anime_NAME}__${JSON.stringify(
      filters,
    )}`,
  );

  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    if (cachedData.data) await enrichWithLibraryTags("Anime", cachedData.data);
    return cachedData;
  }

  const data = await provider.provider.SearchAnime(Anime_NAME, filters);

  if (data.results.length <= 0) {
    throw new Error(`No Anime Found With This Name`);
  } else {
    await enrichWithLibraryTags("Anime", data.results);
    cache.set(
      cacheKey,
      {
        data: data.results,
        hasNextPage: data.hasNextPage,
        currentPage: data.currentPage,
      },
      60,
    );

    return {
      data: data.results,
      hasNextPage: data.hasNextPage,
      currentPage: data.currentPage,
    };
  }
}

// anime info
async function animeinfo(provider, dir, animeId) {
  if (!provider?.provider)
    throw new Error(
      "Missing Provider! ( try downloading from settings > marketplace )",
    );

  const cacheKey = CreateHashKey(
    `animeinfo_${provider.provider_name}_${animeId}`,
  );

  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    return cachedData;
  }

  const data = await provider.provider.AnimeInfo(animeId);
  cache.set(cacheKey, data, 60);
  return data;
}

// anime fetch ep list
async function fetchEpisode(provider, id, page = 1) {
  try {
    if (!provider?.provider)
      throw new Error(
        "Missing Provider! ( try downloading from settings > marketplace )",
      );

    const cacheKey = CreateHashKey(
      `animeplaylist_${provider.provider_name}_${id}_${page}`,
    );

    const cachedData = cache.get(cacheKey);
    if (cachedData) {
      return cachedData;
    }
    const data = await provider.provider.fetchEpisode(id, page);
    cache.set(cacheKey, data, 60);
    return data;
  } catch (err) {
    throw err;
  }
}

// fetch m3u8 links
async function fetchEpisodeSources(provider, episodeId, category = null) {
  if (!provider?.provider)
    throw new Error(
      "Missing Provider! ( try downloading from settings > marketplace )",
    );

  let cleanEpisodeId = String(episodeId ?? "");
  const suffixMatch = cleanEpisodeId.match(/-(sub|dub|hsub|both)$/);
  if (suffixMatch) {
    if (!category) {
      category = suffixMatch[1] === "both" ? null : suffixMatch[1];
    }
    cleanEpisodeId = cleanEpisodeId.slice(0, -suffixMatch[0].length);
  }

  const cacheKey = CreateHashKey(
    `animeepisodesources_${provider.provider_name}_${cleanEpisodeId}_${category || "all"}`,
  );

  let sources = cache.get(cacheKey);
  if (!sources) {
    if (provider.provider.fetchEpisodeSources.length >= 2) {
      sources = await provider.provider.fetchEpisodeSources(
        cleanEpisodeId,
        category,
      );
    } else {
      sources = await provider.provider.fetchEpisodeSources(cleanEpisodeId);
    }
    if (sources) {
      cache.set(cacheKey, sources, 60);
    }
  }

  if (sources && global.setDynamicReferer) {
    const allSources = [
      ...(Array.isArray(sources.sources) ? sources.sources : []),
      ...(sources.sub?.sources || []),
      ...(sources.dub?.sources || []),
    ];
    const allSubtitles = [
      ...(Array.isArray(sources.subtitles) ? sources.subtitles : []),
      ...(sources.sub?.subtitles || []),
      ...(sources.dub?.subtitles || []),
    ];
    for (const item of [...allSources, ...allSubtitles]) {
      if (item?.url) {
        try {
          const cdnDomain = new URL(item.url).hostname;
          const ref =
            item.headers?.Referer ||
            item.headers?.referer ||
            item.referer ||
            (item.extra && item.extra[0]);
          if (ref) {
            global.setDynamicReferer(cdnDomain, ref);
          }
        } catch (e) {}
      }
    }
  }

  return sources;
}

//====================================== Manga ================================

// Latest Manga
async function latestMangas(provider, Page = 1) {
  const cacheKey = CreateHashKey(
    `latestmanga_${provider.provider_name}_${Page}`,
  );

  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    if (cachedData.results)
      await enrichWithLibraryTags("Manga", cachedData.results);
    if (cachedData.data) await enrichWithLibraryTags("Manga", cachedData.data);
    return cachedData;
  }

  let data = await provider.provider.latestManga(Page);
  if (data?.results) await enrichWithLibraryTags("Manga", data.results);
  if (data?.data) await enrichWithLibraryTags("Manga", data.data);
  cache.set(cacheKey, data, 60);
  return data;
}

// Manga Search
async function MangaSearch(provider, MANGA_NAME, PAGE = 1) {
  try {
    const cacheKey = CreateHashKey(
      `mangasearch_${provider.provider_name}_${MANGA_NAME}_${PAGE}`,
    );

    const cachedData = cache.get(cacheKey);

    if (cachedData) {
      if (cachedData.results)
        await enrichWithLibraryTags("Manga", cachedData.results);
      if (cachedData.data)
        await enrichWithLibraryTags("Manga", cachedData.data);
      return cachedData;
    }

    const data = await provider.provider.searchManga(MANGA_NAME, PAGE);
    if (data?.results) await enrichWithLibraryTags("Manga", data.results);
    if (data?.data) await enrichWithLibraryTags("Manga", data.data);
    cache.set(cacheKey, data, 60);
    return data;
  } catch (err) {
    throw new Error(`No Manga found.. ${err}`);
  }
}

// Manga Info
async function MangaInfo(provider, MANGA_ID) {
  const cacheKey = CreateHashKey(
    `mangainfo${provider.provider_name}_${MANGA_ID}`,
  );

  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  let info = await provider.provider.fetchMangaInfo(MANGA_ID);
  cache.set(cacheKey, info, 60);
  return info;
}

// Manga
async function fetchChapters(provider, MANGA_ID, page = 1) {
  const cacheKey = CreateHashKey(
    `mangachapters${provider.provider_name}_${MANGA_ID}_${page}`,
  );

  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  let info = await provider.provider.fetchChapters(MANGA_ID, page);
  cache.set(cacheKey, info, 60);
  return info;
}

// Chapters Fetch
async function MangaChapterFetch(provider, MangaChapterID) {
  const cacheKey = CreateHashKey(
    `mangachapterfetch_${provider.provider_name}_${MangaChapterID}`,
  );

  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  const data = await provider.provider.fetchChapterPages(MangaChapterID);
  cache.set(cacheKey, data, 60);
  return data;
}

// Download Chapters
async function DownloadChapters(
  outputFile,
  pages,
  Title,
  ChapterName,
  MangaChapterID,
  EpNum = null,
  quality = null,
) {
  try {
    const zip = new JSZip();

    const chpStr = EpNum || ChapterName || "";
    const qualStr = quality ? ` ( ${quality} )` : "";
    const logger = new HLSLogger(
      `Downloading CHP ${chpStr} ${Title}${qualStr}`,
      `${MangaChapterID}`,
      0,
      false,
    );

    logger.totalSegments = pages.length - 1;

    const concurrencyLimit = 5;
    const results = new Array(pages.length);
    let activeIndex = 0;
    let currentDelay = 300;

    async function worker() {
      while (activeIndex < pages.length) {
        const i = activeIndex++;
        const imageUrl = pages[i]?.img;
        if (!imageUrl) {
          logger.currentSegments++;
          logger.logProgress();
          continue;
        }

        const jitter = Math.floor(Math.random() * 150) - 75;
        const sleepTime = Math.max(200, Math.min(5000, currentDelay + jitter));
        await new Promise((resolve) => setTimeout(resolve, sleepTime));

        try {
          const imageBuffer = await downloadImage(imageUrl, (isFailure) => {
            if (isFailure) {
              currentDelay = Math.min(5000, currentDelay + 500);
            } else {
              currentDelay = Math.max(200, currentDelay - 20);
            }
          });

          let fileExtension = "jpg";
          if (!imageUrl.startsWith("file://") && !imageUrl.startsWith("/")) {
            fileExtension = imageUrl.split(".").pop().split(/\#|\?/)[0];
          } else {
            fileExtension =
              path
                .extname(
                  imageUrl.startsWith("file://") ? imageUrl.slice(7) : imageUrl,
                )
                .replace(".", "") || "jpg";
          }

          results[i] = {
            fileName: `${i + 1}.${fileExtension}`,
            buffer: imageBuffer,
          };
        } catch (error) {
          console.error(
            `Failed to download page ${i + 1} from ${imageUrl}:`,
            error,
          );
          throw error;
        }

        logger.currentSegments++;
        logger.logProgress();
      }
    }

    const workers = [];
    for (let w = 0; w < Math.min(concurrencyLimit, pages.length); w++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    for (let i = 0; i < pages.length; i++) {
      if (results[i]) {
        zip.file(results[i].fileName, results[i].buffer);
      }
    }

    const cbzBuffer = await zip.generateAsync({ type: "nodebuffer" });
    fs.writeFileSync(outputFile, cbzBuffer);
  } catch (error) {
    throw new Error(error);
  }
}

// Download Chapter Images Utils
async function downloadImage(url, onAttemptResult = null) {
  if (url) {
    url = decodeURIComponent(url);

    if (url.includes("/api/image?url=")) {
      url = url.split("/api/image?url=")[1];
    }

    if (url.startsWith("file://") || url.startsWith("/")) {
      const filePath = url.slice(7);
      return fs.readFileSync(filePath);
    } else if (url.startsWith("data:image/")) {
      const base64Data = url.split("base64,")[1];
      return Buffer.from(base64Data, "base64");
    }

    const resolvedHeaders = getHeaders(url);
    const options = {
      responseType: "arraybuffer",
      headers: {
        ...(resolvedHeaders.Referer
          ? { Referer: resolvedHeaders.Referer }
          : {}),
        ...(resolvedHeaders["User-Agent"]
          ? { "User-Agent": resolvedHeaders["User-Agent"] }
          : {}),
        ...(resolvedHeaders.Cookie ? { Cookie: resolvedHeaders.Cookie } : {}),
      },
    };
    const retries = 3;
    let delay = 1000;

    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        let response;
        try {
          response = await global.axios.get(url, options);
          if (onAttemptResult) onAttemptResult(false);
        } catch (err) {
          if (
            err.response &&
            (err.response.status === 403 || err.response.status === 503) &&
            global.cloudflarebypass
          ) {
            await global.cloudflarebypass(url, true).catch(() => {});

            const freshHeaders = getHeaders(url);
            options.headers = {
              ...options.headers,
              ...(freshHeaders.Cookie ? { Cookie: freshHeaders.Cookie } : {}),
            };
            response = await global.axios.get(url, options);
            if (onAttemptResult) onAttemptResult(false);
          } else {
            throw err;
          }
        }
        return Buffer.from(response.data, "binary");
      } catch (err) {
        if (onAttemptResult) onAttemptResult(true);
        if (attempt === retries) {
          logger.error(
            `Failed to download image after ${retries} attempts: ${url}. Error: ${err.message}`,
          );
          return Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
            "base64",
          );
        }
        logger.warn(
          `Attempt ${attempt} to download ${url} failed: ${err.message}. Retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2;
      }
    }
  }
  return null;
}

function CreateHashKey(text) {
  return crypto.createHash("md5").update(text).digest("hex");
}

function invalidateCache(type, providerName, id) {
  if (!providerName || !id) return;
  const key =
    type === "Anime"
      ? `animeinfo_${providerName}_${id}`
      : `mangainfo${providerName}_${id}`;
  const cacheKey = CreateHashKey(key);
  cache.del(cacheKey);
}

async function getProviderOrThrow(type, name) {
  const pObj = await providerFetch(type, name);
  if (!pObj?.provider) {
    throw new Error(name ? `Provider ${name} not found!` : "Missing Provider!");
  }
  return pObj;
}

async function migrateLegacyFolderIfNeeded(type, dbRecord, baseDir) {
  if (!dbRecord || (!dbRecord.title && !dbRecord.folder_name)) return;
  baseDir =
    typeof baseDir === "string" && baseDir.trim()
      ? baseDir
      : getDownloadsFolder();

  const title = dbRecord.title || dbRecord.folder_name;
  const newFolderName = sanitizeFolderName(title);
  const legacyBase = String(title).replace(/[^a-zA-Z0-9]/g, "_");

  const legacyCandidates = [
    dbRecord.folder_name,
    legacyBase,
    `${legacyBase}_sub`,
    `${legacyBase}_dub`,
    `${legacyBase}_hsub`,
    `${newFolderName}_sub`,
    `${newFolderName}_dub`,
    `${newFolderName}_hsub`,
  ].filter(Boolean);

  const newDir = path.join(baseDir, type, newFolderName);

  let currentTags = [];
  if (dbRecord.CustomTag) {
    try {
      const parsed = JSON.parse(dbRecord.CustomTag);
      if (Array.isArray(parsed)) currentTags = parsed;
      else if (typeof parsed === "string" && parsed) currentTags = [parsed];
    } catch (_) {
      if (typeof dbRecord.CustomTag === "string" && dbRecord.CustomTag) {
        currentTags = [dbRecord.CustomTag];
      }
    }
  }

  if (fs.existsSync(newDir)) {
    if (!currentTags.includes("Downloads")) {
      currentTags.push("Downloads");
    }
    const tagJson = JSON.stringify(currentTags);
    if (
      dbRecord.id &&
      (dbRecord.folder_name !== newFolderName || dbRecord.CustomTag !== tagJson)
    ) {
      try {
        if (global.db) {
          global.db
            .prepare(
              `UPDATE ${type} SET folder_name = ?, CustomTag = ? WHERE id = ?`,
            )
            .run(newFolderName, tagJson, dbRecord.id);
        } else {
          await run(
            `UPDATE ${type} SET folder_name = ?, CustomTag = ? WHERE id = ?`,
            [newFolderName, tagJson, dbRecord.id],
          );
        }
        dbRecord.folder_name = newFolderName;
        dbRecord.CustomTag = tagJson;
      } catch (_) {}
    }
    return newFolderName;
  }

  for (const legacyName of legacyCandidates) {
    if (!legacyName || legacyName === newFolderName) continue;
    const legacyDir = path.join(baseDir, type, legacyName);

    if (fs.existsSync(legacyDir)) {
      try {
        await fs.promises.rename(legacyDir, newDir);
        logger.info(
          `Auto-migrated folder for "${title}": "${dbRecord.folder_name}" -> "${newFolderName}"`,
        );
      } catch (err) {
        logger.error(
          `Failed to migrate folder "${legacyName}": ${err.message}`,
        );
        dbRecord.folder_name = legacyName;
        return legacyName;
      }
      break;
    }
  }

  if (fs.existsSync(newDir)) {
    if (!currentTags.includes("Downloads")) {
      currentTags.push("Downloads");
    }
    const tagJson = JSON.stringify(currentTags);
    if (
      dbRecord.id &&
      (dbRecord.folder_name !== newFolderName || dbRecord.CustomTag !== tagJson)
    ) {
      try {
        if (global.db) {
          global.db
            .prepare(
              `UPDATE ${type} SET folder_name = ?, CustomTag = ? WHERE id = ?`,
            )
            .run(newFolderName, tagJson, dbRecord.id);
        } else {
          await run(
            `UPDATE ${type} SET folder_name = ?, CustomTag = ? WHERE id = ?`,
            [newFolderName, tagJson, dbRecord.id],
          );
        }
        dbRecord.folder_name = newFolderName;
        dbRecord.CustomTag = tagJson;
      } catch (_) {}
    }
  }

  return newFolderName;
}

async function resolveDownloadFolder(type, id, subdub, baseDir) {
  baseDir =
    typeof baseDir === "string" && baseDir.trim()
      ? baseDir
      : getDownloadsFolder();

  let typeDir = path.join(baseDir, type, id || "");
  if (id && fs.existsSync(typeDir)) return typeDir;

  let record = null;

  try {
    if (global.db) {
      record = global.db
        .prepare(
          `SELECT * FROM ${type} WHERE id = ? OR folder_name = ? OR LOWER(id) = LOWER(?) OR LOWER(folder_name) = LOWER(?) OR LOWER(REPLACE(title, ' ', '-')) = LOWER(?) LIMIT 1`,
        )
        .get(id, id, id, id, id);
    } else {
      record = await queryOne(
        `SELECT * FROM ${type} WHERE id = ? OR folder_name = ? OR LOWER(id) = LOWER(?) OR LOWER(folder_name) = LOWER(?) OR LOWER(REPLACE(title, ' ', '-')) = LOWER(?) LIMIT 1`,
        [id, id, id, id, id],
      );
    }
  } catch (_) {}

  if (!record && id) {
    try {
      let qRecord = null;
      if (global.db) {
        qRecord = global.db
          .prepare(
            `SELECT * FROM DownloadQueue WHERE id = ? OR epid LIKE ? LIMIT 1`,
          )
          .get(id, `%${id}%`);
      } else {
        qRecord = await queryOne(
          `SELECT * FROM DownloadQueue WHERE id = ? OR epid LIKE ? LIMIT 1`,
          [id, `%${id}%`],
        );
      }
      if (qRecord && qRecord.Title) {
        record = {
          title: qRecord.Title,
          folder_name: sanitizeFolderName(qRecord.Title),
        };
      }
    } catch (_) {}
  }

  if (!record && id) {
    try {
      const histTable = type === "Anime" ? "WatchHistory" : "ReadHistory";
      const colId = type === "Anime" ? "anime_id" : "manga_id";
      const colTitle = type === "Anime" ? "anime_title" : "manga_title";
      let hRecord = null;
      if (global.db) {
        hRecord = global.db
          .prepare(
            `SELECT * FROM ${histTable} WHERE ${colId} = ? ORDER BY id DESC LIMIT 1`,
          )
          .get(id);
      } else {
        hRecord = await queryOne(
          `SELECT * FROM ${histTable} WHERE ${colId} = ? ORDER BY id DESC LIMIT 1`,
          [id],
        );
      }
      if (hRecord && hRecord[colTitle]) {
        record = {
          title: hRecord[colTitle],
          folder_name: sanitizeFolderName(hRecord[colTitle]),
        };
      }
    } catch (_) {}
  }

  if (record) {
    await migrateLegacyFolderIfNeeded(type, record, baseDir);
    const folderName =
      record.folder_name ||
      (record.title ? sanitizeFolderName(record.title) : id);
    const resolvedPath = path.join(baseDir, type, folderName);
    if (fs.existsSync(resolvedPath)) return resolvedPath;
  }

  if (id) {
    const sanitizedId = sanitizeFolderName(id);
    const candidates = [
      id,
      sanitizedId,
      String(id).replace(/[^a-zA-Z0-9]/g, "_"),
      String(id).replace(/-/g, " "),
      sanitizeFolderName(String(id).replace(/-/g, " ")),
    ].filter(Boolean);

    for (const cand of candidates) {
      const candPath = path.join(baseDir, type, cand);
      if (fs.existsSync(candPath)) return candPath;
    }

    try {
      const parentDir = path.join(baseDir, type);
      if (fs.existsSync(parentDir)) {
        const dirs = await fs.promises.readdir(parentDir, {
          withFileTypes: true,
        });
        const cleanId = id.toLowerCase().replace(/[^a-z0-9]/g, "");
        for (const d of dirs) {
          if (d.isDirectory()) {
            const cleanDirName = d.name.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (
              cleanId.length > 5 &&
              (cleanDirName.includes(cleanId) || cleanId.includes(cleanDirName))
            ) {
              return path.join(parentDir, d.name);
            }
          }
        }
      }
    } catch (_) {}
  }

  return typeDir;
}

async function processServer(provider, server) {
  if (!provider?.provider?.processServer) {
    return server;
  }

  const serverId =
    server.linkId ||
    server.id ||
    server.name ||
    server.quality ||
    JSON.stringify(server);
  const providerName = provider?.provider_name || provider?.name || "unknown";
  const cacheKey = CreateHashKey(`processServer_${providerName}_${serverId}`);
  const cachedData = cache.get(cacheKey);
  if (cachedData) {
    if (
      cachedData.url &&
      global.setDynamicReferer &&
      cachedData.headers?.Referer
    ) {
      try {
        const cdnDomain = new URL(cachedData.url).hostname;
        global.setDynamicReferer(cdnDomain, cachedData.headers.Referer);
        global.setFallbackReferer(cachedData.headers.Referer);
      } catch (e) {}
    }
    return cachedData;
  }

  const resolved = await provider.provider.processServer(
    server.rawServer || server,
  );
  if (resolved && resolved.url) {
    if (global.setDynamicReferer && resolved.headers?.Referer) {
      try {
        const cdnDomain = new URL(resolved.url).hostname;
        global.setDynamicReferer(cdnDomain, resolved.headers.Referer);
        global.setFallbackReferer(resolved.headers.Referer);
      } catch (e) {}
    }
    cache.set(cacheKey, resolved, 300);
  }
  return resolved;
}

module.exports = {
  latestAnime,
  animesearch,
  animeinfo,
  fetchEpisodeSources,
  fetchEpisode,
  latestMangas,
  MangaSearch,
  MangaInfo,
  MangaChapterFetch,
  DownloadChapters,
  fetchChapters,
  invalidateCache,
  getProviderOrThrow,
  resolveDownloadFolder,
  migrateLegacyFolderIfNeeded,
  processServer,
};
