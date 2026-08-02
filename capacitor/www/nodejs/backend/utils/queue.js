// libs
const path = require("path");
const axios = require("axios");
const { getKeyValue, setKeyValue, queryAll, run, batchRun } = require("./db");
const { logger } = require("./AppLogger");
const { download } = require("./downloader");
const { directoryMaker, MangaDir } = require("./DirectoryMaker");
const {
  MangaChapterFetch,
  DownloadChapters,
  fetchEpisodeSources,
  processServer,
} = require("./AnimeManga");
const {
  providerFetch,
  isLanguagePreferred,
  settingfetch,
} = require("./settings");

let _bgDownloadDepth = 0;
let isProcessorRunning = false;
global.__isBackgroundDownload = () =>
  isProcessorRunning || _bgDownloadDepth > 0;

function parseBoolSetting(val) {
  if (val === true || val === 1 || val === "1" || val === "true") return true;
  return false;
}

let AnimeQueue = [];
let isQueuePausedState = parseBoolSetting(
  getKeyValue("Settings", "isQueuePaused"),
);

function isQueuePaused() {
  return isQueuePausedState;
}

global.isQueuePaused = isQueuePaused;
global.isEpisodeInQueue = (epid) =>
  AnimeQueue.some((item) => item.epid === epid);

async function pauseQueue() {
  isQueuePausedState = true;
  setKeyValue("Settings", "isQueuePaused", true);
  return isQueuePausedState;
}

async function resumeQueue() {
  isQueuePausedState = false;
  setKeyValue("Settings", "isQueuePaused", false);
  try {
    continuousExecution();
  } catch (err) {}
  return isQueuePausedState;
}

// Add to Queue
async function addToQueue(item) {
  try {
    await run(
      `INSERT OR REPLACE INTO DownloadQueue (epid, Type, Title, EpNum, SubDub, malid, id, ChapterTitle, status, totalSegments, currentSegments, caption, added_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        item.epid,
        item.Type,
        item.Title,
        item.EpNum || "",
        item.SubDub || "",
        item.malid || "",
        item.id || "",
        item.ChapterTitle || "",
        item.status || "Pending",
        item.totalSegments || 0,
        item.currentSegments || 0,
        item.caption || "",
        item.added_at || Date.now(),
        JSON.stringify(item.config || {}),
      ],
    );
  } catch (err) {
    logger.error("Failed to insert item to DownloadQueue DB: " + err.message);
  }
  AnimeQueue.push(item);
  if (global.updatePowerSaveBlocker) {
    global.updatePowerSaveBlocker();
  }
  if (!isQueuePausedState) {
    try {
      setTimeout(() => {
        continuousExecution().catch(() => {});
      }, 1000);
    } catch (err) {}
  }
}

// load queue when the script start
async function loadQueue() {
  try {
    const rows = await queryAll(
      "SELECT * FROM DownloadQueue ORDER BY added_at ASC",
    );
    AnimeQueue = rows.map((item) => {
      if (item.config) {
        try {
          item.config = JSON.parse(item.config);
        } catch (e) {
          item.config = {};
        }
      }
      item.progress = 0;
      return item;
    });
  } catch (err) {
    AnimeQueue = [];
    logger.error("Failed to load DownloadQueue DB: " + err.message);
  }
  isQueuePausedState = parseBoolSetting(
    getKeyValue("Settings", "isQueuePaused"),
  );
  if (!isQueuePausedState) {
    try {
      continuousExecution();
    } catch (err) {}
  }
}

// remove anime from queue
async function removeQueue(AnimeEpId) {
  try {
    await run("DELETE FROM DownloadQueue WHERE epid = ?", [AnimeEpId]);
  } catch (err) {
    logger.error("Failed to delete from DownloadQueue DB: " + err.message);
  }
  const indexToRemove = AnimeQueue.findIndex((item) => item.epid === AnimeEpId);
  if (indexToRemove !== -1) {
    AnimeQueue.splice(indexToRemove, 1);
  }
  if (global.updatePowerSaveBlocker) {
    global.updatePowerSaveBlocker();
  }
  return AnimeQueue;
}

// Remove multiple items from queue at once and save to SQLite
async function removeMultipleFromQueue(epids = []) {
  if (epids.length > 0) {
    try {
      const placeholders = epids.map(() => "?").join(",");
      await run(
        `DELETE FROM DownloadQueue WHERE epid IN (${placeholders})`,
        epids,
      );
    } catch (err) {
      logger.error(
        "Failed to delete multiple from DownloadQueue DB: " + err.message,
      );
    }
    const epidsSet = new Set(epids);
    AnimeQueue = AnimeQueue.filter((item) => !epidsSet.has(item.epid));
    if (global.updatePowerSaveBlocker) {
      global.updatePowerSaveBlocker();
    }
  }
  return AnimeQueue;
}

// Save Queue Data
async function SaveQueueData(QueueData) {
  AnimeQueue = QueueData;
  try {
    await run("DELETE FROM DownloadQueue");
    const operations = QueueData.map((item) => ({
      sql: `INSERT OR REPLACE INTO DownloadQueue (epid, Type, Title, EpNum, SubDub, malid, id, ChapterTitle, status, totalSegments, currentSegments, caption, added_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        item.epid,
        item.Type,
        item.Title,
        item.EpNum || "",
        item.SubDub || "",
        item.malid || "",
        item.id || "",
        item.ChapterTitle || "",
        item.status || "Pending",
        item.totalSegments || 0,
        item.currentSegments || 0,
        item.caption || "",
        item.added_at || Date.now(),
        JSON.stringify(item.config || {}),
      ],
    }));
    if (operations.length > 0) {
      await batchRun("main", operations);
    }
  } catch (err) {
    logger.error("Failed to SaveQueueData to DownloadQueue DB: " + err.message);
  }
  if (global.updatePowerSaveBlocker) {
    global.updatePowerSaveBlocker();
  }
}

// update the queue [ for storing how much downloaded ]
async function updateQueue(
  epid,
  totalSegments,
  currentSegments,
  caption = null,
) {
  let Tosave = false;
  totalSegments = parseInt(totalSegments);
  currentSegments = parseInt(currentSegments);

  const indexToUpdate = AnimeQueue.findIndex((item) => item.epid === epid);
  if (indexToUpdate !== -1) {
    const completedItem = AnimeQueue[indexToUpdate];
    AnimeQueue[indexToUpdate].totalSegments = totalSegments;
    AnimeQueue[indexToUpdate].currentSegments = currentSegments;

    if (caption && AnimeQueue[indexToUpdate].caption !== caption) {
      AnimeQueue[indexToUpdate].caption = caption;
      Tosave = true;
    }

    const progressPercentage = Math.floor(
      (currentSegments / totalSegments) * 100,
    );

    const lastPct = AnimeQueue[indexToUpdate].lastSavedPct;
    if (
      progressPercentage !== lastPct &&
      (progressPercentage % 10 === 0 || progressPercentage >= 98)
    ) {
      Tosave = true;
      AnimeQueue[indexToUpdate].lastSavedPct = progressPercentage;
    }

    if (currentSegments >= totalSegments) {
      if (global.win && !global.win.isDestroyed()) {
        global.win.webContents.send("download-complete", {
          Type: completedItem.Type,
          id: completedItem.id,
          EpNum: completedItem.EpNum,
          SubDub: completedItem.SubDub,
          epid: completedItem.epid,
        });
      }
      try {
        await run("DELETE FROM DownloadQueue WHERE epid = ?", [epid]);
      } catch (err) {
        logger.error(
          "Failed to delete completed item from DownloadQueue DB: " +
            err.message,
        );
      }
      AnimeQueue.splice(indexToUpdate, 1);
      if (global.updatePowerSaveBlocker) {
        global.updatePowerSaveBlocker();
      }
      Tosave = false;
    }

    if (Tosave) {
      try {
        await run(
          "UPDATE DownloadQueue SET totalSegments = ?, currentSegments = ?, caption = ? WHERE epid = ?",
          [totalSegments, currentSegments, caption || "", epid],
        );
      } catch (err) {
        logger.error("Failed to update DownloadQueue DB: " + err.message);
      }
    }
  }
  return AnimeQueue;
}

// Get Queue
async function getQueue(currently_downloading = null) {
  return currently_downloading
    ? AnimeQueue?.filter((item) => item.epid !== currently_downloading)
    : AnimeQueue;
}

// check if it exists in queue
async function checkEpisodeDownload(epid) {
  const found = AnimeQueue.some((item) => item.epid === epid);
  return found;
}

// Add multiple items to queue at once and save to SQLite
async function addMultipleToQueue(items) {
  if (items && items.length > 0) {
    try {
      const operations = items.map((item) => ({
        sql: `INSERT OR REPLACE INTO DownloadQueue (epid, Type, Title, EpNum, SubDub, malid, id, ChapterTitle, status, totalSegments, currentSegments, caption, added_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          item.epid,
          item.Type,
          item.Title,
          item.EpNum || "",
          item.SubDub || "",
          item.malid || "",
          item.id || "",
          item.ChapterTitle || "",
          item.status || "Pending",
          item.totalSegments || 0,
          item.currentSegments || 0,
          item.caption || "",
          item.added_at || Date.now(),
          JSON.stringify(item.config || {}),
        ],
      }));
      await batchRun("main", operations);
    } catch (err) {
      logger.error(
        "Failed to addMultipleToQueue in DownloadQueue DB: " + err.message,
      );
    }
    AnimeQueue.push(...items);
    if (global.updatePowerSaveBlocker) {
      global.updatePowerSaveBlocker();
    }
    if (!isQueuePausedState) {
      try {
        continuousExecution();
      } catch (err) {}
    }
  }
}

// queue start
async function continuousExecution() {
  if (isProcessorRunning || isQueuePausedState) return;
  isProcessorRunning = true;

  try {
    let AnimeQueue = await getQueue();
    if (!AnimeQueue || AnimeQueue.length === 0) {
      isProcessorRunning = false;
      return;
    }

    logger.info("[queueWorker] Starting download processor...");

    while (AnimeQueue && AnimeQueue.length > 0) {
      if (isQueuePausedState) {
        logger.info(
          "[queueWorker] Queue is paused. Stopping continuous execution.",
        );
        break;
      }
      let currentTask = null;
      try {
        currentTask = AnimeQueue[0];
        if (!currentTask) {
          break;
        }

        if (currentTask?.Type === "Anime") {
          let {
            config,
            Title,
            EpNum,
            epid,
            SubDub,
            malid,
            id: animeId,
          } = currentTask;
          if (config && Title && EpNum && epid && SubDub) {
            await downloadep(
              config,
              Title,
              EpNum,
              epid,
              SubDub,
              malid,
              animeId,
            );
          } else {
            logger.error(
              `Error message: Some Anime Data missing [ removing from queue ]`,
            );
            AnimeQueue.splice(0, 1);
            await SaveQueueData(AnimeQueue);
            continue;
          }
        } else if (currentTask?.Type === "Manga") {
          let { Title, EpNum, epid, ChapterTitle, config, id } = currentTask;
          const safeChapterTitle =
            ChapterTitle || (EpNum ? `Chapter ${EpNum}` : "Chapter");
          if (
            Title &&
            EpNum !== undefined &&
            EpNum !== null &&
            epid &&
            config
          ) {
            await downloadMangaChapters(
              config,
              Title,
              EpNum,
              epid,
              safeChapterTitle,
              id || currentTask?.id,
            );
          } else {
            logger.error(
              `Error message: Some Manga Data missing [ removing from queue  ]`,
            );
            AnimeQueue.splice(0, 1);
            await SaveQueueData(AnimeQueue);
            continue;
          }
        } else {
          logger.error(
            `Error message: Type is Not Valid [ removing from queue  ]`,
          );
          AnimeQueue.splice(0, 1);
          await SaveQueueData(AnimeQueue);
          continue;
        }
        await removeQueue(currentTask.epid);
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        if (err.message && err.message.includes("Queue Paused")) {
          logger.info("[queueWorker] Download paused. Keeping item in queue.");
          break;
        }
        if (err.message && err.message.includes("Episode Cancelled")) {
          logger.info("[queueWorker] Download cancelled by user.");
          if (
            AnimeQueue.length > 0 &&
            AnimeQueue[0]?.epid === currentTask?.epid
          ) {
            AnimeQueue.splice(0, 1);
            await SaveQueueData(AnimeQueue);
          }
          continue;
        }
        logger.error(`Error message: ${err.message}`);
        logger.error(`Stack trace: ${err.stack}`);
        try {
          const { sendToRenderer } = require("./rendererIPC");
          const itemLabel = currentTask?.Title
            ? `${currentTask.Title} (${currentTask?.Type === "Manga" ? "CHP" : "EP"} ${currentTask?.EpNum || ""})`
            : "Download";
          sendToRenderer("download-error", {
            title: "Download Failed",
            message: `${itemLabel}: ${err.message}`,
            epid: currentTask?.epid,
          });
        } catch (ipcErr) {}
        if (
          AnimeQueue.length > 0 &&
          AnimeQueue[0]?.epid === currentTask?.epid
        ) {
          AnimeQueue.splice(0, 1);
          await SaveQueueData(AnimeQueue);
        }
      }

      AnimeQueue = await getQueue();
    }
  } catch (err) {
    console.error("Error in continuous execution:", err);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  } finally {
    logger.info("[queueWorker] Queue empty. Stopping download processor...");
    isProcessorRunning = false;

    if (!isQueuePausedState && AnimeQueue && AnimeQueue.length > 0) {
      logger.info(
        "[queueWorker] New items found after processor stopped. Restarting...",
      );
      setTimeout(() => {
        continuousExecution().catch(() => {});
      }, 500);
    }
  }
}

// start downloadloading ep
async function downloadep(
  Videoconfig,
  Title,
  EpNum,
  AnimeEpId,
  SubDub,
  malid,
  animeId,
) {
  const directoryPath = await directoryMaker(
    Title,
    EpNum,
    Videoconfig?.CustomDownloadLocation,
    animeId || AnimeEpId,
  );
  _bgDownloadDepth++;
  try {
    const qualStr = Videoconfig?.quality ? ` ( ${Videoconfig.quality} )` : "";
    const initialCaption = `Downloading EP ${EpNum} ${Title}${qualStr}`;
    await updateQueue(AnimeEpId, 1, 0, initialCaption);
    const { sendToRenderer } = require("./rendererIPC");
    sendToRenderer("download-logger", {
      caption: initialCaption,
      totalSegments: 1,
      currentSegments: 0,
      epid: AnimeEpId,
      isPaused: isQueuePaused(),
    });

    await downloadEpisodeByQuality(
      Videoconfig,
      EpNum,
      directoryPath,
      Title,
      AnimeEpId,
      SubDub,
      malid,
      animeId,
    );
  } finally {
    _bgDownloadDepth--;
  }
}

// Download episode by quality
async function downloadEpisodeByQuality(
  config,
  episodeNumber,
  directoryName,
  Title,
  epid,
  subdub,
  malid,
  animeId,
) {
  try {
    let preferredQualities = ["1080p", "720p", "360p", "default", "backup"];
    const provider = await providerFetch("Anime", config.Animeprovider);
    let resolvedEpid = epid;
    if (subdub && !epid.endsWith(`-${subdub}`) && !epid.endsWith("-both")) {
      resolvedEpid = `${epid}-${subdub}`;
    }
    let sourcesArray = await fetchEpisodeSources(
      provider,
      resolvedEpid,
      subdub,
    );

    const extractSources = (srcObj, prefSubDub) => {
      if (!srcObj) return [];
      if (
        prefSubDub &&
        Array.isArray(srcObj[prefSubDub]) &&
        srcObj[prefSubDub].length > 0
      ) {
        return srcObj[prefSubDub];
      }
      if (Array.isArray(srcObj.sources) && srcObj.sources.length > 0) {
        return srcObj.sources;
      }
      if (Array.isArray(srcObj) && srcObj.length > 0) {
        return srcObj;
      }
      return [
        ...(Array.isArray(srcObj.sources) ? srcObj.sources : []),
        ...(Array.isArray(srcObj.sub?.sources)
          ? srcObj.sub.sources
          : Array.isArray(srcObj.sub)
            ? srcObj.sub
            : []),
        ...(Array.isArray(srcObj.dub?.sources)
          ? srcObj.dub.sources
          : Array.isArray(srcObj.dub)
            ? srcObj.dub
            : []),
        ...(Array.isArray(srcObj.hsub?.sources)
          ? srcObj.hsub.sources
          : Array.isArray(srcObj.hsub)
            ? srcObj.hsub
            : []),
      ];
    };

    let sourcesList = extractSources(sourcesArray, subdub);

    if ((!sourcesList || sourcesList.length === 0) && resolvedEpid !== epid) {
      sourcesArray = await fetchEpisodeSources(provider, epid);
      sourcesList = extractSources(sourcesArray, subdub);
    }

    let selectedSource = sourcesList?.find(
      (source) => source?.quality === (config?.quality ?? "1080p"),
    );

    if (!selectedSource) {
      for (const quality of preferredQualities) {
        selectedSource = sourcesList?.find(
          (source) => source?.quality === quality,
        );
        if (selectedSource) break;
      }
    }

    if (!selectedSource && sourcesList?.[0]) {
      selectedSource = { ...sourcesList[0] };
      if (!selectedSource.quality) {
        selectedSource.quality = "best";
      }
    }

    let subtitles =
      sourcesArray?.subtitles ||
      sourcesArray?.[subdub]?.subtitles ||
      sourcesArray?.sub?.subtitles ||
      sourcesArray?.dub?.subtitles ||
      [];

    if (selectedSource) {
      if (!selectedSource.url || selectedSource.isUnresolved) {
        const resolved = await processServer(
          provider,
          selectedSource.rawServer || selectedSource,
        );
        if (resolved && resolved.url) {
          selectedSource.url = resolved.url;
          selectedSource.headers =
            resolved.headers || selectedSource.headers || {};
          if (
            Array.isArray(resolved.subtitles) &&
            resolved.subtitles.length > 0
          ) {
            subtitles = resolved.subtitles;
          }
        } else {
          throw new Error("Failed to resolve stream link for download");
        }
      }

      const dlQuality =
        selectedSource.quality && selectedSource.quality.match(/\d+p/)
          ? selectedSource.quality
          : config?.quality || "1080p";

      const currentSettings = (await settingfetch()) || {};
      const preferredLangs = config?.preferredSubtitleLanguages ||
        currentSettings?.preferredSubtitleLanguages || ["English"];

      let filteredSubtitles = (subdub === "hsub" ? [] : subtitles || []).filter(
        ({ lang, label, language }) => {
          const subLang = lang || label || language;
          return (
            subLang !== "Thumbnails" &&
            isLanguagePreferred(subLang, preferredLangs)
          );
        },
      );

      await downloadVideo(
        selectedSource.url,
        directoryName,
        episodeNumber,
        dlQuality,
        Title,
        epid,
        filteredSubtitles,
        subdub === "hsub"
          ? false
          : config?.mergeSubtitles === true
            ? true
            : false,
        (config?.subtitleFormat ?? "vtt") === "srt",
        selectedSource.headers ?? {},
      );

      if (malid && animeId) {
        try {
          await updateHistory("Anime", animeId, malid, episodeNumber);
        } catch (_) {}
        try {
          const epNum = parseFloat(episodeNumber);
          if (!isNaN(epNum)) {
            const aniskipUrl = `https://api.aniskip.com/v2/skip-times/${malid}/${Number(epNum)}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=0`;
            const res = await axios.get(aniskipUrl);
            if (res.status === 200) {
              const resData = res.data;
              if (resData && resData.found && resData.results) {
                const normalized = resData.results.map((st) => ({
                  ...st,
                  skip_type: st.skipType || st.skip_type,
                  interval: {
                    start_time: st.interval.startTime ?? st.interval.start_time,
                    end_time: st.interval.endTime ?? st.interval.end_time,
                  },
                }));

                try {
                  await run(
                    "INSERT OR REPLACE INTO SkipTimes (anime_id, episode_number, skip_times) VALUES (?, ?, ?)",
                    [animeId, Number(epNum), JSON.stringify(normalized)],
                  );
                  logger.info(
                    `[queueWorker] Saved skip times to SkipTimes DB for ${Title} EP ${epNum}`,
                  );
                } catch (errDb) {
                  logger.error(
                    `[queueWorker] Failed to save skip times to SkipTimes DB: ${errDb.message}`,
                  );
                }
              }
            }
          }
        } catch (err) {
          logger.warn(
            `[queueWorker] Failed to save skip times: ${err.message}`,
          );
        }
      }
    } else {
      throw new Error("No source link found.");
    }
  } catch (err) {
    throw err;
  }
}

// download video
async function downloadVideo(
  Url,
  directoryPath,
  episodeNumber,
  quality,
  Title,
  epid,
  subtitles = [],
  MergeSubtitles,
  subtitleFormat = false,
  headers = {},
) {
  try {
    const qualStr = quality ? ` ( ${quality} )` : "";
    await download({
      directory: directoryPath,
      Epnum: episodeNumber,
      streamUrl: Url,
      quality: quality,
      caption: `Downloading EP ${episodeNumber} ${Title}${qualStr}`,
      EpID: epid,
      subtitles: subtitles,
      MergeSubtitles: MergeSubtitles,
      ChangeTosrt: subtitleFormat,
      headers: headers,
    });
  } catch (err) {
    if (err.message === "Queue Paused" || err.message === "Episode Cancelled") {
      throw err;
    }
    throw new Error(`Failed To Download \n${err}`);
  }
}

// start downloadloading manga
async function downloadMangaChapters(
  config,
  Title,
  EpNum,
  ChapterId,
  ChapterTitle,
  mediaId,
) {
  _bgDownloadDepth++;
  try {
    const qualStr = config?.quality ? ` ( ${config.quality} )` : "";
    const chpStr = EpNum || ChapterTitle || "";
    const initialCaption = `Downloading CHP ${chpStr} ${Title}${qualStr}`;
    await updateQueue(ChapterId, 1, 0, initialCaption);
    const { sendToRenderer } = require("./rendererIPC");
    sendToRenderer("download-logger", {
      caption: initialCaption,
      totalSegments: 1,
      currentSegments: 0,
      epid: ChapterId,
      isPaused: isQueuePaused(),
    });

    const provider = await providerFetch("Manga", config?.Mangaprovider);
    const ChapterData = await MangaChapterFetch(provider, ChapterId);

    if (!ChapterData || ChapterData?.length < 1) {
      await removeQueue(ChapterId);
      throw new Error("No Image Found For This Chapter!");
    }

    const directoryPath = await MangaDir(
      Title,
      config?.CustomDownloadLocation,
      mediaId,
    );

    const sanitizedChapterName = (ChapterTitle || `Chapter ${EpNum}`).replace(
      /[<>:"/\\|?*]/g,
      "-",
    );
    const outputFile = path.join(directoryPath, `${sanitizedChapterName}.cbz`);
    await DownloadChapters(
      outputFile,
      ChapterData,
      Title,
      ChapterTitle,
      ChapterId,
      EpNum,
      config?.quality,
    );
  } finally {
    _bgDownloadDepth--;
  }
}

global.getQueueNumber = () => {
  return AnimeQueue?.length ?? 0;
};

module.exports = {
  addToQueue,
  addMultipleToQueue,
  loadQueue,
  removeQueue,
  removeMultipleFromQueue,
  updateQueue,
  getQueue,
  checkEpisodeDownload,
  SaveQueueData,
  continuousExecution,
  isQueuePaused,
  pauseQueue,
  resumeQueue,
};
