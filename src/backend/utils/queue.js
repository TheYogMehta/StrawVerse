// libs
const path = require("path");
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
let isQueuePausedState = getKeyValue("Queue", "isPaused") || false;

function isQueuePaused() {
  return isQueuePausedState;
}

global.isQueuePaused = isQueuePaused;

async function pauseQueue() {
  isQueuePausedState = true;
  setKeyValue("Queue", "isPaused", true);
  return isQueuePausedState;
}

async function resumeQueue() {
  isQueuePausedState = false;
  setKeyValue("Queue", "isPaused", false);
  try {
    continuousExecution();
  } catch (err) {}
  return isQueuePausedState;
}

// Add to Queue
async function addToQueue(item) {
  AnimeQueue.push(item);
  await saveQueue();
  if (!isQueuePausedState) {
    try {
      continuousExecution();
    } catch (err) {}
  }
}

// load queue when the script start
async function loadQueue() {
  AnimeQueue = getKeyValue("Queue", "queue") || [];
  isQueuePausedState = getKeyValue("Queue", "isPaused") || false;
  AnimeQueue.forEach((entry) => {
    entry.progress = 0;
  });
  await saveQueue();
  if (!isQueuePausedState) {
    try {
      continuousExecution();
    } catch (err) {}
  }
}

// remove anime from queue
async function removeQueue(AnimeEpId) {
  const indexToRemove = AnimeQueue.findIndex((item) => item.epid === AnimeEpId);
  if (indexToRemove !== -1) {
    AnimeQueue.splice(indexToRemove, 1);
    await saveQueue();
  }
  return AnimeQueue;
}

// Remove multiple items from queue at once and save to SQLite
async function removeMultipleFromQueue(epids = []) {
  if (epids.length > 0) {
    const epidsSet = new Set(epids);
    AnimeQueue = AnimeQueue.filter((item) => !epidsSet.has(item.epid));
    await saveQueue();
  }
  return AnimeQueue;
}

// Remove With Index
async function SaveQueueData(QueueData) {
  AnimeQueue = QueueData;
  await saveQueue();
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

    if (progressPercentage % 10 === 0 || progressPercentage >= 98) {
      Tosave = true;
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
      AnimeQueue.splice(indexToUpdate, 1);
      Tosave = true;
    }

    if (Tosave) {
      await saveQueue();
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

// sync the queue with database
async function saveQueue() {
  try {
    setKeyValue("Queue", "queue", AnimeQueue);
    if (global.updatePowerSaveBlocker) {
      global.updatePowerSaveBlocker();
    }
  } catch (err) {
    logger.error("Failed To Save Queue");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// check if it exists in queue
async function checkEpisodeDownload(epid) {
  const found = AnimeQueue.some((item) => item.epid === epid);
  return found;
}

// Add multiple items to queue at once and save to SQLite
async function addMultipleToQueue(items) {
  if (items && items.length > 0) {
    AnimeQueue.push(...items);
    await saveQueue();
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
      try {
        const currentTask = AnimeQueue[0];
        if (!currentTask) {
          break;
        }

        if (currentTask?.Type === "Anime") {
          let { config, Title, EpNum, epid, SubDub } = currentTask;
          if (config && Title && EpNum && epid && SubDub) {
            await downloadep(config, `${Title} ${SubDub}`, EpNum, epid, SubDub);
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
        await saveQueue();
        await new Promise((resolve) => setTimeout(resolve, 2000));
      } catch (err) {
        logger.error(`Error message: ${err.message}`);
        logger.error(`Stack trace: ${err.stack}`);
        AnimeQueue.splice(0, 1);
        await SaveQueueData(AnimeQueue);
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
async function downloadep(Videoconfig, Title, EpNum, AnimeEpId, SubDub) {
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
      (source) => source?.quality === config?.quality ?? "1080p",
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
      await downloadVideo(
        selectedSource.url,
        directoryName,
        episodeNumber,
        selectedSource.quality,
        Title,
        epid,
        subdub === "hsub" ? [] : (sourcesArray?.subtitles ?? []),
        subdub === "hsub"
          ? false
          : config?.mergeSubtitles === "on"
            ? true
            : false,
        (config?.subtitleFormat ?? "ttv") === "srt",
        selectedSource.headers ?? {},
      );
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
  saveQueue,
  updateQueue,
  getQueue,
  checkEpisodeDownload,
  SaveQueueData,
  continuousExecution,
  isQueuePaused,
  pauseQueue,
  resumeQueue,
};
