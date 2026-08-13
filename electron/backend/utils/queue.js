// libs
const path = require("path");
const axios = require("axios");
const { getKeyValue, setKeyValue } = require("./db");
const { logger } = require("./AppLogger");
const { download } = require("./downloader");
const {
  resetDomainConcurrency,
  markCoolingDown,
} = require("./domainConcurrency");
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

let AnimeQueue = [];
let isProcessorRunning = false;
let _bgDownloadDepth = 0;
global.__isBackgroundDownload = () =>
  isProcessorRunning || _bgDownloadDepth > 0;
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
  let removedItem = null;
  try {
    if (!AnimeEpId) {
      global.db.prepare("DELETE FROM DownloadQueue").run();
      AnimeQueue.length = 0;
      resetDomainConcurrency();
      if (global.updatePowerSaveBlocker) {
        global.updatePowerSaveBlocker();
      }
      try {
        const { sendToRenderer } = require("./rendererIPC");
        sendToRenderer("download-logger", {
          caption: "Nothing in progress",
          totalSegments: 0,
          currentSegments: 0,
          epid: null,
          queue: [],
          isPaused: isQueuePaused(),
        });
      } catch (ipcErr) {}
      return AnimeQueue;
    }
    global.db
      .prepare("DELETE FROM DownloadQueue WHERE epid = ?")
      .run(AnimeEpId);
  } catch (err) {
    logger.error("Failed to delete from DownloadQueue DB: " + err.message);
  }
  const indexToRemove = AnimeQueue.findIndex((item) => item.epid === AnimeEpId);
  if (indexToRemove !== -1) {
    removedItem = AnimeQueue[indexToRemove];
    AnimeQueue.splice(indexToRemove, 1);
  }
  if (AnimeQueue.length === 0) {
    resetDomainConcurrency();
  }
  if (global.updatePowerSaveBlocker) {
    global.updatePowerSaveBlocker();
  }

  if (removedItem && global.win && !global.win.isDestroyed()) {
    global.win.webContents.send("download-complete", {
      Type: removedItem.Type,
      id: removedItem.id,
      EpNum: removedItem.EpNum,
      SubDub: removedItem.SubDub,
      epid: removedItem.epid,
    });
  }

  try {
    const { sendToRenderer } = require("./rendererIPC");
    const nextItem = AnimeQueue.find(
      (item) =>
        item.totalSegments > 0 ||
        (item.caption && item.caption.includes("Downloading")),
    );
    const hasItemsInQueue = AnimeQueue.length > 0;
    const fallbackCaption = hasItemsInQueue
      ? "Preparing next episode..."
      : "Nothing in progress";
    sendToRenderer("download-logger", {
      queue: nextItem
        ? AnimeQueue.filter((item) => item.epid !== nextItem.epid)
        : AnimeQueue,
      caption: nextItem ? nextItem.caption : fallbackCaption,
      totalSegments: nextItem ? nextItem.totalSegments : 0,
      currentSegments: nextItem ? nextItem.currentSegments : 0,
      epid: nextItem ? nextItem.epid : AnimeQueue[0]?.epid || null,
      isPaused: isQueuePaused(),
    });
  } catch (ipcErr) {}

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

const activeProcessingEpids = new Set();

// queue start
async function continuousExecution() {
  if (isQueuePausedState) return;

  try {
    let currentQueue = await getQueue();
    if (!currentQueue || currentQueue.length === 0) {
      return;
    }

    if (activeProcessingEpids.size >= 1) {
      return;
    }

    logger.info("[queueWorker] Checking download queue...");

    let startedNewTask = false;

    for (const currentTask of currentQueue) {
      if (isQueuePausedState) break;

      if (activeProcessingEpids.size >= 1) {
        break;
      }

      if (
        !currentTask ||
        !currentTask.epid ||
        activeProcessingEpids.has(currentTask.epid)
      ) {
        continue;
      }

      activeProcessingEpids.add(currentTask.epid);
      startedNewTask = true;

      (async () => {
        try {
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
              await removeQueue(currentTask.epid);
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
                `Error message: Some Manga Data missing [ removing from queue ]`,
              );
              await removeQueue(currentTask.epid);
            }
          } else {
            logger.error(
              `Error message: Type is Not Valid [ removing from queue ]`,
            );
            await removeQueue(currentTask.epid);
          }
          await removeQueue(currentTask.epid);
        } catch (err) {
          if (err.message && err.message.includes("Queue Paused")) {
            logger.info(
              "[queueWorker] Download paused. Keeping item in queue.",
            );
          } else if (err.message && err.message.includes("Episode Cancelled")) {
            logger.info("[queueWorker] Download cancelled by user.");
            if (currentTask?.epid) {
              await removeQueue(currentTask.epid);
            }
          } else if (
            err.message &&
            (err.message.includes("SCRAPER_TEMPORARY_ERROR") ||
              err.message.includes("ERR_ADDRESS_UNREACHABLE") ||
              err.message.includes("429") ||
              err.message.includes("403") ||
              err.message.includes("ETIMEDOUT") ||
              err.message.includes("ECONNREFUSED") ||
              err.message.includes("No Stream Url") ||
              err.message.includes("No source link"))
          ) {
            currentTask.retryCount = (currentTask.retryCount || 0) + 1;
            const maxRetries = 3;
            if (currentTask.retryCount >= maxRetries) {
              logger.error(
                `[queueWorker] Task ${currentTask?.epid} failed after ${maxRetries} retries: ${err.message}. Removing from queue.`,
              );
              try {
                const { sendToRenderer } = require("./rendererIPC");
                const itemLabel = currentTask?.Title
                  ? `${currentTask.Title} (${currentTask?.Type === "Manga" ? "CHP" : "EP"} ${currentTask?.EpNum || ""})`
                  : "Download";
                sendToRenderer("download-error", {
                  title: "Download Failed",
                  message: `${itemLabel}: ${err.message} (max retries exceeded)`,
                  epid: currentTask?.epid,
                });
              } catch (ipcErr) {}
              if (currentTask?.epid) {
                await removeQueue(currentTask.epid);
              }
            } else {
              const backoffMs = Math.min(
                30000,
                5000 * Math.pow(2, currentTask.retryCount - 1),
              );
              const cleanEp =
                currentTask.EpNum !== undefined && currentTask.EpNum !== null
                  ? String(currentTask.EpNum)
                  : "";
              const qualStr = currentTask.config?.quality
                ? ` ( ${currentTask.config.quality} )`
                : "";
              const retryCaption = `Downloading EP ${cleanEp} ${currentTask.Title || ""}${qualStr} Retrying in ${Math.round(backoffMs / 1000)}s...`;
              await updateQueue(currentTask.epid, 0, 0, retryCaption);
              try {
                const { sendToRenderer } = require("./rendererIPC");
                sendToRenderer("download-logger", {
                  caption: retryCaption,
                  totalSegments: 0,
                  currentSegments: 0,
                  epid: currentTask.epid,
                  isPaused: isQueuePaused(),
                });
              } catch (_) {}
              logger.warn(
                `[queueWorker] Scraper stream fetch error on task ${currentTask?.epid} (attempt ${currentTask.retryCount}/${maxRetries}): ${err.message}. Retrying in ${backoffMs / 1000}s...`,
              );
              const prov =
                currentTask.config?.Animeprovider ||
                currentTask.config?.Mangaprovider ||
                "scraper";
              markCoolingDown(prov, backoffMs);
              currentAllowedSlots = 1;
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
          } else {
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
            if (currentTask?.epid) {
              logger.warn(
                `[queueWorker] Task ${currentTask.epid} error: ${err.message}. Removing from queue.`,
              );
              await removeQueue(currentTask.epid);
            }
          }
        } finally {
          activeProcessingEpids.delete(currentTask.epid);
          setTimeout(() => {
            continuousExecution().catch(() => {});
          }, 500);
        }
      })();
    }
  } catch (err) {
    console.error("Error in continuous execution:", err);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
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
    const cleanEp =
      EpNum !== undefined && EpNum !== null && !isNaN(Number(EpNum))
        ? String(Number(EpNum))
        : EpNum;
    const initialCaption = `Resolving EP ${cleanEp} ${Title}${qualStr}...`;
    await updateQueue(AnimeEpId, 0, 0, initialCaption);
    const { sendToRenderer } = require("./rendererIPC");
    sendToRenderer("download-logger", {
      caption: initialCaption,
      totalSegments: 0,
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
    let sourcesArray = null;
    let fetchAttempt = 0;
    const maxFetchAttempts = 3;
    let lastFetchErr = null;

    while (fetchAttempt < maxFetchAttempts && !sourcesArray) {
      fetchAttempt++;
      try {
        sourcesArray = await fetchEpisodeSources(
          provider,
          resolvedEpid,
          subdub,
        );
      } catch (err) {
        lastFetchErr = err;
        logger.warn(
          `[queueWorker] Scraper stream fetch attempt ${fetchAttempt}/${maxFetchAttempts} failed for ${resolvedEpid}: ${err.message}`,
        );
        if (fetchAttempt < maxFetchAttempts) {
          await new Promise((resolve) =>
            setTimeout(resolve, fetchAttempt * 3000),
          );
        }
      }
    }

    if (!sourcesArray && lastFetchErr) {
      throw new Error(`SCRAPER_TEMPORARY_ERROR: ${lastFetchErr.message}`);
    }

    const extractSources = (srcObj, prefSubDub) => {
      if (!srcObj) return [];
      if (
        prefSubDub &&
        Array.isArray(srcObj[prefSubDub]?.sources) &&
        srcObj[prefSubDub].sources.length > 0
      ) {
        return srcObj[prefSubDub].sources;
      }
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
      sourcesArray = await fetchEpisodeSources(provider, epid, subdub);
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

    if (!selectedSource && sourcesList && sourcesList.length > 0) {
      selectedSource = sourcesList[0];
    }

    if (
      selectedSource &&
      (selectedSource.isUnresolved || !selectedSource.url)
    ) {
      try {
        const resolved = await processServer(
          provider,
          selectedSource.rawServer || selectedSource,
        );
        if (resolved && resolved.url) {
          selectedSource = {
            ...selectedSource,
            ...resolved,
            isUnresolved: false,
          };
        }
      } catch (e) {
        logger.error(`Failed to resolve download server: ${e.message}`);
      }
    }

    if (selectedSource?.url) {
      try {
        const streamDomain = new URL(selectedSource.url).hostname;
        const ref =
          selectedSource.headers?.Referer ||
          selectedSource.headers?.referer ||
          "https://megaplay.buzz/";
        if (global.setDynamicReferer) {
          global.setDynamicReferer(streamDomain, ref);
          global.setFallbackReferer(ref);
        }
      } catch (e) {}
    }

    const allSubtitles =
      (selectedSource?.subtitles && selectedSource.subtitles.length > 0
        ? selectedSource.subtitles
        : null) ||
      sourcesArray?.subtitles ||
      sourcesArray?.[subdub]?.subtitles ||
      sourcesArray?.sub?.subtitles ||
      sourcesArray?.dub?.subtitles ||
      [];

    const currentSettings = (await settingfetch()) || {};
    const preferredLangs = config?.preferredSubtitleLanguages ||
      currentSettings?.preferredSubtitleLanguages || ["English"];

    let filteredSubtitles = [];
    if (
      subdub !== "hsub" &&
      Array.isArray(allSubtitles) &&
      allSubtitles.length > 0
    ) {
      filteredSubtitles = allSubtitles.filter((sub) => {
        const subLang =
          sub?.lang ||
          sub?.label ||
          sub?.name ||
          sub?.language ||
          sub?.url ||
          "";
        return (
          subLang !== "Thumbnails" &&
          isLanguagePreferred(subLang, preferredLangs)
        );
      });
      if (filteredSubtitles.length === 0) {
        filteredSubtitles = allSubtitles.filter((sub) => {
          const subLang =
            sub?.lang || sub?.label || sub?.name || sub?.language || "";
          return subLang !== "Thumbnails";
        });
      }
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
          await updateHistory({
            type: "Anime",
            mediaId: animeId,
            malid: malid,
            number: episodeNumber,
            currentTime: 0,
            duration: 0,
          });
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
    const qualStr = quality ? ` ( ${quality} )` : "";
    const cleanEp =
      episodeNumber !== undefined &&
      episodeNumber !== null &&
      !isNaN(Number(episodeNumber))
        ? String(Number(episodeNumber))
        : episodeNumber;
    await download({
      directory: directoryPath,
      Epnum: episodeNumber,
      streamUrl: Url,
      quality: quality,
      caption: `Downloading EP ${cleanEp} ${Title}${qualStr}`,
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
    const cleanEp =
      EpNum !== undefined && EpNum !== null && !isNaN(Number(EpNum))
        ? String(Number(EpNum))
        : EpNum;
    const chpStr = cleanEp || ChapterTitle || "";
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
