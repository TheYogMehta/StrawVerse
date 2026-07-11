// libs
const path = require("path");
const axios = require("axios");
const { getKeyValue, setKeyValue } = require("./db");
const { logger } = require("./AppLogger");
const { download } = require("./downloader");
const { directoryMaker, MangaDir } = require("./DirectoryMaker");
const {
  MangaChapterFetch,
  DownloadChapters,
  fetchEpisodeSources,
} = require("./AnimeManga");
const { providerFetch } = require("./settings");

let AnimeQueue = [];
let isProcessorRunning = false;
let isQueuePausedState = getKeyValue("Settings", "isQueuePaused") || false;

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
    global.db
      .prepare(
        `INSERT OR REPLACE INTO DownloadQueue (epid, Type, Title, EpNum, SubDub, malid, id, ChapterTitle, status, totalSegments, currentSegments, caption, added_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
    const rows = global.db
      .prepare("SELECT * FROM DownloadQueue ORDER BY added_at ASC")
      .all();
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
  isQueuePausedState = getKeyValue("Settings", "isQueuePaused") || false;
  if (!isQueuePausedState) {
    try {
      continuousExecution();
    } catch (err) {}
  }
}

// remove anime from queue
async function removeQueue(AnimeEpId) {
  try {
    global.db
      .prepare("DELETE FROM DownloadQueue WHERE epid = ?")
      .run(AnimeEpId);
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
      global.db
        .prepare(`DELETE FROM DownloadQueue WHERE epid IN (${placeholders})`)
        .run(...epids);
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
    global.db.prepare("DELETE FROM DownloadQueue").run();
    const insertStmt = global.db.prepare(
      `INSERT OR REPLACE INTO DownloadQueue (epid, Type, Title, EpNum, SubDub, malid, id, ChapterTitle, status, totalSegments, currentSegments, caption, added_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const item of QueueData) {
      insertStmt.run(
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
      );
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
        global.db.prepare("DELETE FROM DownloadQueue WHERE epid = ?").run(epid);
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
        global.db
          .prepare(
            "UPDATE DownloadQueue SET totalSegments = ?, currentSegments = ?, caption = ? WHERE epid = ?",
          )
          .run(totalSegments, currentSegments, caption || "", epid);
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
      const insertStmt = global.db.prepare(
        `INSERT OR REPLACE INTO DownloadQueue (epid, Type, Title, EpNum, SubDub, malid, id, ChapterTitle, status, totalSegments, currentSegments, caption, added_at, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of items) {
        insertStmt.run(
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
        );
      }
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
            const lowerTitle = (Title || "").toLowerCase().trim();
            const lowerSubDub = (SubDub || "").toLowerCase().trim();
            const displayTitle = lowerTitle.endsWith(lowerSubDub)
              ? Title
              : `${Title} ${SubDub}`;
            await downloadep(
              config,
              displayTitle,
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
          let { Title, EpNum, epid, ChapterTitle, config } = currentTask;
          if (Title && EpNum && epid && ChapterTitle && config) {
            await downloadMangaChapters(
              config,
              Title,
              EpNum,
              epid,
              ChapterTitle,
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
  );
  try {
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
  } catch (err) {
    throw err;
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
    const sourcesArray = await fetchEpisodeSources(provider, resolvedEpid);
    if (sourcesArray?.sources) {
      for (const src of sourcesArray.sources) {
        if (src?.url) {
          try {
            const cdnDomain = new URL(
              typeof src.url === "string" ? src.url : src.url?.url || "",
            ).hostname;
            const ref = src.headers?.Referer || src.headers?.referer;
            if (cdnDomain && ref) global.setDynamicReferer(cdnDomain, ref);
          } catch (e) {}
        }
      }
    }

    let selectedSource = sourcesArray?.sources?.find(
      (source) => source?.quality === (config?.quality ?? "1080p"),
    );

    if (!selectedSource) {
      for (const quality of preferredQualities) {
        selectedSource = sourcesArray?.sources.find(
          (source) => source?.quality === quality,
        );
        if (selectedSource) break;
      }
    }

    if (
      !selectedSource &&
      sourcesArray?.sources[0]?.url &&
      sourcesArray?.sources[0]?.isM3U8
    ) {
      selectedSource = sourcesArray?.sources[0];
      selectedSource.quality = "best";
    }

    if (selectedSource) {
      const dlQuality =
        selectedSource.quality && selectedSource.quality.match(/\d+p/)
          ? selectedSource.quality
          : config?.quality || "1080p";

      await downloadVideo(
        selectedSource.url,
        directoryName,
        episodeNumber,
        dlQuality,
        Title,
        epid,
        subdub === "hsub" ? [] : (sourcesArray?.subtitles ?? []),
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
                  global.db
                    .prepare(
                      "INSERT OR REPLACE INTO SkipTimes (anime_id, episode_number, skip_times) VALUES (?, ?, ?)",
                    )
                    .run(animeId, Number(epNum), JSON.stringify(normalized));
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
    await download({
      directory: directoryPath,
      Epnum: episodeNumber,
      streamUrl: Url,
      quality: quality,
      caption: `Downloading ${Title} || EP ${episodeNumber} [  ${quality}  ]`,
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
) {
  const provider = await providerFetch("Manga", config?.Mangaprovider);
  const ChapterData = await MangaChapterFetch(provider, ChapterId);

  if (!ChapterData || ChapterData?.length < 1) {
    await removeQueue(ChapterId);
    throw new Error("No Image Found For This Chapter!");
  }

  const directoryPath = await MangaDir(Title, config?.CustomDownloadLocation);
  try {
    const sanitizedChapterName = ChapterTitle.replace(/[<>:"/\\|?*]/g, "-");
    const outputFile = path.join(directoryPath, `${sanitizedChapterName}.cbz`);
    await DownloadChapters(
      outputFile,
      ChapterData,
      Title,
      ChapterTitle,
      ChapterId,
    );
  } catch (err) {
    throw err;
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
