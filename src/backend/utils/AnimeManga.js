const { FindMapping } = require("./Metadata");
const NodeCache = require("node-cache");
const HLSLogger = require("./logger");
const { logger } = require("./AppLogger");
const crypto = require("crypto");
const JSZip = require("jszip");
const axios = require("axios");
const fs = require("fs");
const { getHeaders } = require("./proxyHeaders");

const cache = new NodeCache({ stdTTL: 60, checkperiod: 60 });

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
    return cachedData;
  }

  const data = await provider.provider.fetchRecentEpisodes(filters);
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
    return cachedData;
  }

  const data = await provider.provider.SearchAnime(Anime_NAME, filters);

  if (data.results.length <= 0) {
    throw new Error(`No Anime Found With This Name`);
  } else {
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
async function animeinfo(provider, dir, animeId, MalFetch = true) {
  if (!provider?.provider)
    throw new Error(
      "Missing Provider! ( try downloading from settings > marketplace )",
    );

  const cacheKey = CreateHashKey(
    `animeinfo_${provider.provider_name}_${animeId}`,
  );

  let cachedData = cache.get(cacheKey);

  if (cachedData) {
    if (
      global?.MalLoggedIn &&
      cachedData?.MalLoggedIn &&
      cachedData?.malid &&
      MalFetch
    ) {
      let MyAnimeListData = await FindMapping(
        "Anime",
        cachedData?.id,
        cachedData?.malid,
        cachedData?.title,
        dir,
      );
      cachedData = { ...cachedData, ...MyAnimeListData, MalLoggedIn: true };
    }
    return cachedData;
  }

  let data = await provider.provider.AnimeInfo(animeId);

  if (MalFetch) {
    let MyAnimeListData = await FindMapping(
      "Anime",
      data?.id,
      data?.malid,
      data?.title,
      dir,
    );

    if (MyAnimeListData) {
      data = {
        ...data,
        ...MyAnimeListData,
      };
    }

    if (global?.MalLoggedIn) {
      data = { ...data, MalLoggedIn: true };
    }
  }

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
async function fetchEpisodeSources(provider, episodeId) {
  if (!provider?.provider)
    throw new Error(
      "Missing Provider! ( try downloading from settings > marketplace )",
    );

  const cacheKey = CreateHashKey(
    `animeepisodesources_${provider.provider_name}_${episodeId}`,
  );

  const cachedData = cache.get(cacheKey);

  if (cachedData) {
    return cachedData;
  }

  const sources = await provider.provider.fetchEpisodeSources(episodeId);
  cache.set(cacheKey, sources, 60);
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
    return cachedData;
  }

  let data = await provider.provider.latestManga(Page);
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
      return cachedData;
    }

    const data = await provider.provider.searchManga(MANGA_NAME, PAGE);
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
) {
  try {
    const zip = new JSZip();

    const logger = new HLSLogger(
      `Downloading ${Title} || ${ChapterName}`,
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
            const path = require("path");
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
};
