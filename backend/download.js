const fs = require("fs");
const {
  animeinfo,
  MangaInfo,
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
  unitName = type === "Anime" ? "Episodes" : "Chapters",
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

  let hasError = false;
  let success = 0;
  const itemsToAdd = [];

  const config = await settingfetch();
  const mediaProvider = await providerFetch(type, provider);

  const needsResolution = items.some((it) => !it.id);
  if (needsResolution && typeof fetchAllItemsFn === "function") {
    try {
      const allItems = await fetchAllItemsFn(mediaProvider, mediaId);
      items.forEach((it) => {
        if (!it.id) {
          const matched = allItems.find(
            (x) => Number(x.number) === Number(it.number),
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
    logger.warn(
      `[queueWorker] Dropping ${unresolved.length} ${unitName.toLowerCase()} with unresolvable IDs (numbers: ${unresolved.map((u) => u?.number ?? "?").join(", ")}).`,
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
    const data = await singleDownloadFn(
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
    );

    if (data?.error) {
      if (data?.message !== "Already downloaded") {
        hasError = true;
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
    type: hasError ? "error" : "info",
    error: hasError,
    message: `Added ${success} ${unitName} To Queue!`,
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
) {
  return downloadMediaMulti({
    type: "Anime",
    provider,
    mediaId: animeid,
    items: Episodes,
    title: Title,
    subDub: SubDub,
    malid,
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
        message: "Already in queue",
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
            message: "Already downloaded",
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
        quality: config?.quality,
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
      message: `No Episode Provided To Download!`,
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
        message: "Already in queue",
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
            message: "Already downloaded",
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
            const dbRecord = await queryOne(
              `SELECT MalID FROM ${type} WHERE id = ?`,
              [id],
            );
            if (!dbRecord || !dbRecord.MalID) {
              await run(`DELETE FROM ${type} WHERE id = ?`, [id]);
              logger.info(`Cleaned up DB entry for ${type}: ${id}`);
              await removeIdFromCustomOrders(id);
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
  getBaseDownloadDir,
  cleanupEmptyDownloadFolder,
};
