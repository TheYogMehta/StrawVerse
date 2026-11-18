const fs = require("fs");
const {
  animeinfo,
  MangaInfo,
  movieInfo,
  fetchEpisode,
  fetchChapters,
} = require("./utils/AnimeManga");
const { providerFetch, settingfetch } = require("./utils/settings");
const { getDownloadsFolder } = require("./utils/DirectoryMaker");
const { logger } = require("./utils/AppLogger");
const { queryOne, queryAll, run } = require("./utils/db");
const {
  addToQueue,
  checkEpisodeDownload,
  addMultipleToQueue,
} = require("./utils/queue");
const { MetadataAdd, FindMapping } = require("./utils/Metadata");
const path = require("path");
const { hasLocalMediaFiles, SEASON_FOLDER_RE } = require("./utils/constants");

// Helper to format item label (e.g. Ep 1, Ch 5, S2E3)
function formatItemLabel(item, type) {
  if (!item) return "?";
  const num =
    item.number !== undefined && item.number !== null ? item.number : "?";
  const numStr = Number.isInteger(Number(num)) ? Number(num) : num;
  if (type === "Manga") {
    return `Ch ${numStr}`;
  }
  let season = item.season;
  if ((season === undefined || season === null) && item.id) {
    const sMatch = String(item.id).match(/tv:[^:]+:(\d+):\d+/);
    if (sMatch) {
      season = parseInt(sMatch[1], 10);
    }
  }
  if (type === "Movies" && season !== undefined && season !== null) {
    return `S${season}E${numStr}`;
  }
  return `Ep ${numStr}`;
}

// Shared runner for multiple episodes/chapters download
async function downloadMediaMulti({
  type,
  provider = null,
  mediaId,
  items = [],
  title,
  subDub = null,
  malid = null,
  singleDownloadFn,
  fetchAllItemsFn,
  unitName = type === "Anime" || type === "Movies" ? "Episodes" : "Chapters",
  quality = null,
}) {
  if (!items || items.length <= 0) {
    return {
      error: false,
      message: `No ${unitName} Provided To Download!`,
    };
  }

  items.sort((a, b) => {
    const numA = parseFloat(a.number) || 0;
    const numB = parseFloat(b.number) || 0;
    return numA - numB;
  });

  let success = 0;
  const itemsToAdd = [];
  const alreadyInQueue = [];
  const alreadyDownloaded = [];
  const failedItems = [];
  const unresolvedLabels = [];

  const config = await settingfetch();
  const mediaProvider = await providerFetch(type, provider);

  const needsResolution = items.some((it) => !it.id);
  if (needsResolution && typeof fetchAllItemsFn === "function") {
    try {
      const allItems = await fetchAllItemsFn(mediaProvider, mediaId);
      items.forEach((it) => {
        if (!it.id) {
          const matched = allItems.find(
            (x) =>
              Number(x.number) === Number(it.number) &&
              (it.season !== undefined &&
              it.season !== null &&
              x.season !== undefined &&
              x.season !== null
                ? Number(x.season) === Number(it.season)
                : true),
          );
          if (matched) {
            it.id = matched.id;
          }
        }
      });
    } catch (err) {
      console.error(
        `Error resolving ${unitName.toLowerCase()} IDs: ${err.message}`,
      );
    }
  }

  const unresolved = items.filter((it) => !it || !it.id);
  if (unresolved.length > 0) {
    unresolved.forEach((u) => {
      unresolvedLabels.push(formatItemLabel(u, type));
    });
    logger.warn(
      `[queueWorker] Dropping ${unresolved.length} ${unitName.toLowerCase()} with unresolvable IDs (numbers: ${unresolvedLabels.join(", ")}).`,
    );
    items = items.filter((it) => it && it.id);
    if (items.length === 0) {
      return {
        error: true,
        message: `Could not resolve ${unitName.toLowerCase()} IDs — nothing queued. Open the title to load its list, then try again.`,
      };
    }
  }

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const data =
      type === "Movies"
        ? await singleDownloadFn(
            provider,
            mediaId,
            item.id,
            item.number,
            title,
            i === 0,
            config,
            mediaProvider,
            true,
            malid,
            subDub,
            item.season,
            quality,
          )
        : await singleDownloadFn(
            provider,
            mediaId,
            item.id,
            item.number,
            title,
            i === 0,
            config,
            mediaProvider,
            true,
            malid,
            subDub,
            quality,
          );

    if (data?.error) {
      const label = formatItemLabel(item, type);
      const msg = String(data?.message || "").toLowerCase();
      if (msg.includes("already in queue")) {
        alreadyInQueue.push(label);
      } else if (msg.includes("already downloaded")) {
        alreadyDownloaded.push(label);
      } else {
        failedItems.push(label);
      }
    } else if (data?.queueItem) {
      itemsToAdd.push(data.queueItem);
      success++;
    }
  }

  if (itemsToAdd.length > 0) {
    await addMultipleToQueue(itemsToAdd);
  }

  const unitSingular = type === "Manga" ? "chapter" : "episode";
  const unitPlural = type === "Manga" ? "chapters" : "episodes";

  const skipParts = [];
  if (alreadyInQueue.length > 0) {
    const joined = alreadyInQueue.join(", ");
    skipParts.push(
      alreadyInQueue.length === 1
        ? `${joined} was not added as it's already in queue`
        : `${joined} were not added as they are already in queue`,
    );
  }
  if (alreadyDownloaded.length > 0) {
    const joined = alreadyDownloaded.join(", ");
    skipParts.push(
      alreadyDownloaded.length === 1
        ? `${joined} was not added as it's already downloaded`
        : `${joined} were not added as they are already downloaded`,
    );
  }
  if (failedItems.length > 0) {
    const joined = failedItems.join(", ");
    skipParts.push(
      failedItems.length === 1
        ? `${joined} could not be added`
        : `${joined} could not be added`,
    );
  }
  if (unresolvedLabels.length > 0) {
    const joined = unresolvedLabels.join(", ");
    skipParts.push(
      unresolvedLabels.length === 1
        ? `${joined} had unresolved ID`
        : `${joined} had unresolved IDs`,
    );
  }

  const skipSummary = skipParts.join(". ");

  let finalMessage = "";
  let finalError = false;

  if (success > 0) {
    if (skipParts.length > 0) {
      const otherLabel = success === 1 ? unitSingular : unitPlural;
      finalMessage = `${skipSummary}. ${success} other ${otherLabel} added to queue!`;
    } else {
      const label = success === 1 ? unitSingular : unitPlural;
      finalMessage = `Added ${success} ${label} to queue!`;
    }
    finalError = false;
  } else {
    finalMessage = skipSummary
      ? `${skipSummary}.`
      : `No ${unitPlural} were added to the queue.`;
    finalError = true;
  }

  return {
    type: finalError ? "error" : "info",
    error: finalError,
    message: finalMessage,
    successCount: success,
    skippedCount: items.length + unresolvedLabels.length - success,
  };
}

// Handles Multiple Episodes Download
async function downloadAnimeMulti(
  provider = null,
  animeid,
  Episodes = [],
  Title,
  SubDub,
  malid = null,
  quality = null,
) {
  return downloadMediaMulti({
    type: "Anime",
    provider,
    mediaId: animeid,
    items: Episodes,
    title: Title,
    subDub: SubDub,
    malid,
    quality,
    singleDownloadFn: downloadAnimeSingle,
    fetchAllItemsFn: fetchAllEpisodes,
  });
}

// Handles Single Episode Download
async function downloadAnimeSingle(
  provider = null,
  animeid,
  episodeid,
  number,
  Title,
  saveinfo = false,
  preFetchedConfig = null,
  preFetchedProvider = null,
  returnItemOnly = false,
  malid = null,
  subdub = null,
  quality = null,
) {
  if (!episodeid) {
    return {
      error: true,
      message:
        "Missing episode ID — cannot queue download. Re-add it from the episode list.",
    };
  }
  try {
    const config = preFetchedConfig || (await settingfetch());
    const Animeprovider =
      preFetchedProvider || (await providerFetch("Anime", provider));

    let resolvedSubDub = subdub || "sub";

    if (saveinfo) {
      const existing = await queryOne("SELECT id FROM Anime WHERE id = ?", [
        animeid,
      ]);
      if (!existing) {
        const animedata = await animeinfo(
          Animeprovider,
          config?.CustomDownloadLocationAnime,
          animeid,
        );
        if (animedata) {
          const finalTitle = animedata?.title || Title;
          MetadataAdd("Anime", {
            id: animeid,
            title: finalTitle,
            provider: Animeprovider.provider_name,
            type: animedata.type ?? null,
            description: animedata.description ?? null,
            status: animedata.status ?? null,
            genres:
              animedata?.genres?.length > 0 ? animedata?.genres?.join(",") : "",
            aired: animedata?.aired ?? null,
            ImageUrl: animedata?.image,
            EpisodesDataId: animedata?.dataId,
            MalID: malid ? String(malid) : null,
          });
        }
      }
    }

    let is_in_queue = await checkEpisodeDownload(episodeid);
    if (is_in_queue) {
      return {
        error: true,
        message: `Ep ${number} was not added as it's already in queue.`,
      };
    }

    try {
      let animeMapping = await FindMapping(
        "Anime",
        animeid,
        null,
        config?.CustomDownloadLocationAnime,
      );
      if (animeMapping && animeMapping.DownloadedEpisodes) {
        const num = parseFloat(number);
        const downloadedList = Array.isArray(animeMapping.DownloadedEpisodes)
          ? animeMapping.DownloadedEpisodes
          : [];
        if (downloadedList.map(Number).includes(num)) {
          return {
            error: true,
            message: `Ep ${number} was not added as it's already downloaded.`,
          };
        }
      }
    } catch (e) {
      // ignore
    }
    let targetMalid = malid;
    if (!targetMalid) {
      try {
        const row = await queryOne("SELECT MalID FROM Anime WHERE id = ?", [
          animeid,
        ]);
        if (row && row.MalID) {
          targetMalid = row.MalID;
        }
      } catch (e) {}
    }

    const queueItem = {
      Type: "Anime",
      EpNum: number,
      id: animeid,
      Title: Title,
      SubDub: resolvedSubDub,
      malid: targetMalid ? String(targetMalid) : null,
      config: {
        Animeprovider: Animeprovider?.provider_name,
        quality: quality || config?.quality || "1080p",
        mergeSubtitles: config?.mergeSubtitles,
        subtitleFormat: config?.subtitleFormat,
        CustomDownloadLocation: config?.CustomDownloadLocationAnime,
        jellyfinCompatibility: config?.jellyfinCompatibility,
        animeNamingScheme: config?.animeNamingScheme || "default",
      },
      epid: episodeid,
      totalSegments: 0,
      currentSegments: 0,
    };

    if (returnItemOnly) {
      return {
        error: false,
        queueItem,
      };
    }

    await addToQueue(queueItem);
    return {
      error: false,
      message: "Added To Queue!",
    };
  } catch (err) {
    return {
      error: true,
      message: `${err.message}`,
    };
  }
}

// Handles Multiple Movies / Episodes Download
async function downloadMovieMulti(
  provider = null,
  movieid,
  Episodes = [],
  Title,
  SubDub,
  malid = null,
  quality = null,
) {
  return downloadMediaMulti({
    type: "Movies",
    provider,
    mediaId: movieid,
    items: Episodes,
    title: Title,
    subDub: SubDub,
    malid,
    quality,
    singleDownloadFn: downloadMovieSingle,
    fetchAllItemsFn: async (prov, mId) => {
      const data = await movieInfo(prov, null, mId);
      return data?.episodes || [];
    },
    unitName: "Episodes",
  });
}

// Handles Single Movie / Episode Download
async function downloadMovieSingle(
  provider = null,
  movieid,
  episodeid,
  number,
  Title,
  saveinfo = false,
  preFetchedConfig = null,
  preFetchedProvider = null,
  returnItemOnly = false,
  _malid = null,
  subdub = null,
  season = null,
  quality = null,
) {
  if (!episodeid) {
    return {
      error: true,
      message:
        "Missing episode ID — cannot queue download. Re-add it from the episode list.",
    };
  }
  try {
    const config = preFetchedConfig || (await settingfetch());
    const Moviesprovider =
      preFetchedProvider || (await providerFetch("Movies", provider));

    let resolvedSubDub = subdub || "sub";
    let resolvedSeason = season;
    if (resolvedSeason === null || resolvedSeason === undefined) {
      const sMatch = String(episodeid).match(/tv:[^:]+:(\d+):\d+/);
      if (sMatch) {
        resolvedSeason = parseInt(sMatch[1], 10);
      }
    }

    if (saveinfo) {
      const existing = await queryOne("SELECT id FROM Movies WHERE id = ?", [
        movieid,
      ]);
      if (!existing) {
        const moviedata = await movieInfo(
          Moviesprovider,
          config?.CustomDownloadLocationMovies,
          movieid,
        );
        if (moviedata) {
          const finalTitle = moviedata?.title || Title;
          MetadataAdd("Movies", {
            id: movieid,
            title: finalTitle,
            provider: Moviesprovider.provider_name,
            type: moviedata.type ?? "Movie",
            description: moviedata.description ?? null,
            status: moviedata.status ?? null,
            genres:
              moviedata?.genres?.length > 0
                ? Array.isArray(moviedata.genres)
                  ? moviedata.genres.join(",")
                  : moviedata.genres
                : "",
            aired: moviedata?.aired || moviedata?.released || null,
            ImageUrl: moviedata?.image_url || moviedata?.image,
            EpisodesDataId: null,
            MalID: null,
          });
        }
      }
    }

    let is_in_queue = await checkEpisodeDownload(episodeid);
    if (is_in_queue) {
      const epLabel =
        resolvedSeason !== null && resolvedSeason !== undefined
          ? `S${resolvedSeason}E${number}`
          : `Ep ${number}`;
      return {
        error: true,
        message: `${epLabel} was not added as it's already in queue.`,
      };
    }

    try {
      let movieMapping = await FindMapping(
        "Movies",
        movieid,
        null,
        config?.CustomDownloadLocationMovies,
      );
      if (movieMapping && movieMapping.DownloadedEpisodes) {
        const num = parseFloat(number);
        const downloadedList = Array.isArray(movieMapping.DownloadedEpisodes)
          ? movieMapping.DownloadedEpisodes
          : [];
        const hasSeasonKey =
          resolvedSeason !== null && resolvedSeason !== undefined
            ? downloadedList.includes(`s${resolvedSeason}_e${num}`)
            : false;
        const hasSeasonTags = downloadedList.some(
          (x) => typeof x === "string" && x.startsWith("s"),
        );
        if (
          hasSeasonKey ||
          (!hasSeasonTags && downloadedList.map(Number).includes(num))
        ) {
          const epLabel =
            resolvedSeason !== null && resolvedSeason !== undefined
              ? `S${resolvedSeason}E${number}`
              : `Ep ${number}`;
          return {
            error: true,
            message: `${epLabel} was not added as it's already downloaded.`,
          };
        }
      }
    } catch (e) {
      // ignore
    }

    // Determine whether this download represents a single movie or a series episode
    let isSingleMovie = false;
    const isTvEpisodeId =
      /tv:[^:]+:(\d+):\d+/i.test(String(episodeid)) ||
      /[Ss]\d+[Ee]\d+/i.test(String(episodeid));

    if (
      !isTvEpisodeId &&
      (resolvedSeason === null ||
        resolvedSeason === undefined ||
        Number(resolvedSeason) === 1)
    ) {
      const num = parseFloat(number);
      if (isNaN(num) || num === 1) {
        try {
          const row = await queryOne(
            "SELECT type, episodes_json FROM Movies WHERE id = ?",
            [movieid],
          );
          if (!row || !row.type || String(row.type).toLowerCase() === "movie") {
            if (!row?.episodes_json) {
              isSingleMovie = true;
            } else {
              try {
                const counts = JSON.parse(row.episodes_json);
                const totalEps = Object.values(counts).reduce(
                  (a, b) => a + Number(b),
                  0,
                );
                if (totalEps <= 1) isSingleMovie = true;
              } catch (_) {
                isSingleMovie = true;
              }
            }
          }
        } catch (_) {
          isSingleMovie = true;
        }
      }
    }

    const queueItem = {
      Type: "Movies",
      EpNum: number,
      id: movieid,
      Title: Title,
      SubDub: resolvedSubDub,
      malid: null,
      season: isSingleMovie ? null : resolvedSeason,
      isSingleMovie: isSingleMovie,
      config: {
        Animeprovider: Moviesprovider?.provider_name,
        Moviesprovider: Moviesprovider?.provider_name,
        quality: quality || config?.quality || "1080p",
        mergeSubtitles: config?.mergeSubtitles,
        subtitleFormat: config?.subtitleFormat,
        CustomDownloadLocation: config?.CustomDownloadLocationMovies,
        CustomDownloadLocationMovies: config?.CustomDownloadLocationMovies,
        jellyfinCompatibility: config?.jellyfinCompatibility,
        animeNamingScheme: config?.animeNamingScheme || "default",
        moviesNamingScheme: config?.moviesNamingScheme || "default",
        isSingleMovie: isSingleMovie,
      },
      epid: episodeid,
      totalSegments: 0,
      currentSegments: 0,
    };

    if (returnItemOnly) {
      return {
        error: false,
        queueItem,
      };
    }

    await addToQueue(queueItem);
    return {
      error: false,
      message: "Added To Queue!",
    };
  } catch (err) {
    logger.error(`Error in downloadMovieSingle: ${err.message}`);
    return {
      error: true,
      message: err.message,
    };
  }
}

// Handles Multiple Chapters Download
async function downloadMangaMulti(
  provider = null,
  mangaid,
  Chapters = [],
  Title,
  malid = null,
) {
  if (Chapters?.length <= 0)
    return {
      error: false,
      message: `No Chapters Provided To Download!`,
    };

  Chapters.sort((a, b) => {
    const numA = parseFloat(a.number) || 0;
    const numB = parseFloat(b.number) || 0;
    return numA - numB;
  });

  let Message = {
    type: "info",
    message: "",
  };

  let success = 0;
  const itemsToAdd = [];

  const config = await settingfetch();
  const Mangaprovider = await providerFetch("Manga", provider);

  const needsResolution = Chapters.some((ch) => !ch.id);
  if (needsResolution) {
    try {
      const allChs = await fetchAllChapters(Mangaprovider, mangaid);
      Chapters.forEach((ch) => {
        if (!ch.id) {
          const matched = allChs.find(
            (x) => Number(x.number) === Number(ch.number),
          );
          if (matched) {
            ch.id = matched.id;
          }
        }
      });
    } catch (err) {
      console.error(`Error resolving chapter IDs: ${err.message}`);
    }
  }

  for (let i = 0; i < Chapters.length; i++) {
    let Chapter = Chapters[i];
    let data = await downloadMangaSingle(
      provider,
      mangaid,
      Chapter.id,
      Chapter.number,
      Title,
      i === 0,
      config,
      Mangaprovider,
      true,
      malid,
    );
    if (data?.error) {
      if (data?.message !== "Already downloaded") {
        Message.error = true;
      }
    } else if (data?.queueItem) {
      itemsToAdd.push(data.queueItem);
      success++;
    }
  }

  if (itemsToAdd.length > 0) {
    await addMultipleToQueue(itemsToAdd);
  }

  return {
    error: Message.error ?? false,
    message: `Added ${success} Chapters To Queue!`,
  };
}

// Handles Single Manga Download
async function downloadMangaSingle(
  provider = null,
  mangaid,
  chapterid,
  number,
  Title,
  saveinfo = false,
  preFetchedConfig = null,
  preFetchedProvider = null,
  returnItemOnly = false,
  malid = null,
) {
  if (!chapterid) {
    return {
      error: true,
      message:
        "Missing chapter ID — cannot queue download. Re-add it from the chapter list.",
    };
  }
  try {
    const config = preFetchedConfig || (await settingfetch());
    const Mangaprovider =
      preFetchedProvider || (await providerFetch("Manga", provider));

    if (saveinfo) {
      const existing = await queryOne("SELECT id FROM Manga WHERE id = ?", [
        mangaid,
      ]);
      if (!existing) {
        let mangainfo = await MangaInfo(Mangaprovider, mangaid);
        if (mangainfo) {
          MetadataAdd("Manga", {
            id: mangaid,
            title: Title,
            provider: Mangaprovider.provider_name,
            description: mangainfo.description ?? null,
            genres: mangainfo?.genres?.join(",") ?? null,
            type: mangainfo.type ?? null,
            author: mangainfo?.author ?? null,
            released: mangainfo?.released ?? null,
            ImageUrl: mangainfo?.image,
            MalID: malid ? String(malid) : null,
          });
        }
      }
    }

    let is_in_queue = await checkEpisodeDownload(chapterid);
    if (is_in_queue) {
      return {
        error: true,
        message: `Ch ${number} was not added as it's already in queue.`,
      };
    }

    try {
      let mangaMapping = await FindMapping(
        "Manga",
        mangaid,
        null,
        config?.CustomDownloadLocationManga,
      );
      if (mangaMapping && mangaMapping.DownloadedChapters) {
        const num = parseFloat(number);
        if (mangaMapping.DownloadedChapters.map(Number).includes(num)) {
          return {
            error: true,
            message: `Ch ${number} was not added as it's already downloaded.`,
          };
        }
      }
    } catch (e) {
      // ignore
    }
    const queueItem = {
      Type: "Manga",
      EpNum: number,
      id: mangaid,
      Title: Title,
      config: {
        Mangaprovider: Mangaprovider.provider_name,
        CustomDownloadLocation: config?.CustomDownloadLocationManga,
        mangaNamingScheme: config?.mangaNamingScheme || "default",
      },
      ChapterTitle: `Chapter ${number}`,
      epid: chapterid,
      totalSegments: 0,
      currentSegments: 0,
    };

    if (returnItemOnly) {
      return {
        error: false,
        queueItem,
      };
    }

    await addToQueue(queueItem);
    return {
      error: false,
      message: "Added To Queue!",
    };
  } catch (err) {
    return {
      error: true,
      message: `${err.message}`,
    };
  }
}

async function fetchAllPages(fetchFn, provider, id, itemsKey) {
  let allItems = [];
  const firstPage = await fetchFn(provider, id, 1);
  const initial = firstPage?.[itemsKey];
  if (initial) {
    allItems = [...initial];
    const totalPages = firstPage.totalPages || 1;

    if (totalPages > 1) {
      const promises = [];
      for (let p = 2; p <= totalPages; p++) {
        promises.push(fetchFn(provider, id, p));
      }
      const results = await Promise.all(promises);
      for (const res of results) {
        if (res?.[itemsKey]) {
          allItems = [...allItems, ...res[itemsKey]];
        }
      }
    }
  }
  return allItems;
}

const fetchAllEpisodes = (Animeprovider, animeid) =>
  fetchAllPages(fetchEpisode, Animeprovider, animeid, "episodes");

const fetchAllChapters = (Mangaprovider, mangaid) =>
  fetchAllPages(fetchChapters, Mangaprovider, mangaid, "Chapters");

async function getBaseDownloadDir(type) {
  const setting = await settingfetch();
  if (type === "Anime") {
    return setting?.CustomDownloadLocationAnime || (await getDownloadsFolder());
  }
  if (type === "Manga") {
    return setting?.CustomDownloadLocationManga || (await getDownloadsFolder());
  }
  if (type === "Movies") {
    return (
      setting?.CustomDownloadLocationMovies || (await getDownloadsFolder())
    );
  }
  return await getDownloadsFolder();
}

async function cleanupEmptyDownloadFolder(folderPath, type, id) {
  try {
    if (fs.existsSync(folderPath)) {
      if (!hasLocalMediaFiles(folderPath, type, true)) {
        await fs.promises.rm(folderPath, { recursive: true, force: true });
        logger.info(`Removed empty download folder: ${folderPath}`);
        // Last season of a media-server show folder gone: drop the empty
        // show folder too (rmdir refuses if anything is left in it)
        if (SEASON_FOLDER_RE.test(path.basename(folderPath))) {
          await fs.promises.rmdir(path.dirname(folderPath)).catch(() => {});
        }
        if (id) {
          if (type === "Anime") {
            try {
              await run(
                "DELETE FROM SkipTimes WHERE anime_id = ? OR anime_id LIKE ?",
                [id, `${id}-%`],
              );
              logger.info(`Cleared SkipTimes for empty download folder: ${id}`);
            } catch (_) {}
          }
          try {
            if (type === "Movies") {
              const hasHistory = await queryOne(
                "SELECT id FROM SeriesMovieWatchHistory WHERE movie_id = ? LIMIT 1",
                [id],
              );
              const movieRec = await queryOne(
                "SELECT CustomTag FROM Movies WHERE id = ?",
                [id],
              );
              const hasTag =
                movieRec?.CustomTag &&
                movieRec.CustomTag !== "[]" &&
                movieRec.CustomTag !== "";
              if (!hasHistory && !hasTag) {
                await run("DELETE FROM Movies WHERE id = ?", [id]);
                logger.info(`Cleaned up DB entry for Movies: ${id}`);
                await removeIdFromCustomOrders(id);
              }
            } else {
              const dbRecord = await queryOne(
                `SELECT MalID FROM ${type} WHERE id = ?`,
                [id],
              );
              if (!dbRecord || !dbRecord.MalID) {
                await run(`DELETE FROM ${type} WHERE id = ?`, [id]);
                logger.info(`Cleaned up DB entry for ${type}: ${id}`);
                await removeIdFromCustomOrders(id);
              }
            }
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

async function removeIdFromCustomOrders(deletedId) {
  if (!deletedId) return;
  try {
    const rows = await queryAll(
      "SELECT key, value FROM Settings WHERE key LIKE 'custom_order_%'",
    );
    for (const row of rows) {
      if (row.value) {
        try {
          const orderArray = JSON.parse(row.value);
          if (Array.isArray(orderArray) && orderArray.includes(deletedId)) {
            const newOrder = orderArray.filter((id) => id !== deletedId);
            await run("UPDATE Settings SET value = ? WHERE key = ?", [
              JSON.stringify(newOrder),
              row.key,
            ]);
            logger.info(
              `[customOrder] Cleaned up deleted ID ${deletedId} from settings key ${row.key}`,
            );
          }
        } catch (jsonErr) {}
      }
    }
  } catch (err) {
    logger.error(
      `Failed to clean up custom order settings for deleted ID ${deletedId}: ${err.message}`,
    );
  }
}

module.exports = {
  downloadAnimeSingle,
  downloadAnimeMulti,
  downloadMangaSingle,
  downloadMangaMulti,
  downloadMovieSingle,
  downloadMovieMulti,
  getBaseDownloadDir,
  cleanupEmptyDownloadFolder,
  formatItemLabel,
};
