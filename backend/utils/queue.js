// libs
const path = require("path");
const axios = require("axios");
const { getKeyValue, setKeyValue, queryAll, run, batchRun } = require("./db");
const { logger } = require("./AppLogger");
const { download } = require("./downloader");
const {
  resetDomainConcurrency,
  markCoolingDown,
} = require("./domainConcurrency");
const {
  directoryMaker,
  mediaServerDir,
  MangaDir,
  MovieDir,
} = require("./DirectoryMaker");
const {
  MangaChapterFetch,
  DownloadChapters,
  fetchEpisode,
  fetchEpisodeSources,
  fetchMovieSources,
  processServer,
} = require("./AnimeManga");
const {
  providerFetch,
  isLanguagePreferred,
  settingfetch,
} = require("./settings");
const {
  sortSourcesByPreferredQuality,
  mediaServerFileBase,
  formatChapterFilename,
  isAndroid,
} = require("./constants");
const { verifyStreamReachability } = require("./streamVerifier");
const { updateHistory } = require("./history");
const { getBestProviderForMalId } = require("./mappingResolver");

let _bgDownloadDepth = 0;
let isProcessorRunning = false;
global.__isBackgroundDownload = () =>
  isProcessorRunning || _bgDownloadDepth > 0;

function parseBoolSetting(val) {
  if (val === true || val === 1 || val === "1" || val === "true") return true;
  return false;
}

let AnimeQueue = [];
let isQueuePausedState = false;

// Mirror hosts proven dead for an episode (keyed by epid). When segment
// downloads abort with failedHost, retries resolve servers again but skip
// any server whose stream lives on an excluded host, so attempt 2/3 lands
// on a different mirror instead of re-downloading from the dead one.
const hostSkipByEpid = new Map();

(async () => {
  try {
    const val = await getKeyValue("Settings", "isQueuePaused");
    isQueuePausedState = parseBoolSetting(val);
  } catch (_) {}
})();

function isQueuePaused() {
  return isQueuePausedState;
}

global.isQueuePaused = isQueuePaused;
global.isEpisodeInQueue = (epid) =>
  AnimeQueue.some((item) => String(item.epid) === String(epid));

async function pauseQueue() {
  isQueuePausedState = true;
  await setKeyValue("Settings", "isQueuePaused", true).catch(() => {});
  return isQueuePausedState;
}

async function resumeQueue() {
  isQueuePausedState = false;
  await setKeyValue("Settings", "isQueuePaused", false).catch(() => {});
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
  const existingIdx = AnimeQueue.findIndex(
    (qItem) => String(qItem.epid) === String(item.epid),
  );
  if (existingIdx !== -1) {
    AnimeQueue[existingIdx] = item;
  } else {
    AnimeQueue.push(item);
  }
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
    await getKeyValue("Settings", "isQueuePaused"),
  );
  if (!isQueuePausedState) {
    try {
      continuousExecution();
    } catch (err) {}
  }
}

// remove anime from queue
async function removeQueue(AnimeEpId, isSuccess = false) {
  let removedItem = null;
  try {
    if (!AnimeEpId) {
      await run("DELETE FROM DownloadQueue");
      AnimeQueue.length = 0;
      resetDomainConcurrency();
      try {
        global.sendToRenderer("download-logger", {
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
    await run("DELETE FROM DownloadQueue WHERE epid = ?", [AnimeEpId]);
  } catch (err) {
    logger.error("Failed to delete from DownloadQueue DB: " + err.message);
  }
  const indexToRemove = AnimeQueue.findIndex(
    (item) => String(item.epid) === String(AnimeEpId),
  );
  if (indexToRemove !== -1) {
    removedItem = AnimeQueue[indexToRemove];
    AnimeQueue.splice(indexToRemove, 1);
  }
  if (AnimeQueue.length === 0) {
    resetDomainConcurrency();
  }
  if (process.versions?.electron && global.updatePowerSaveBlocker) {
    global.updatePowerSaveBlocker();
  }

  if (removedItem && isSuccess) {
    global.sendToRenderer("download-complete", {
      Type: removedItem.Type,
      id: removedItem.id,
      EpNum: removedItem.EpNum,
      SubDub: removedItem.SubDub,
      epid: removedItem.epid,
    });

    if (!isAndroid && removedItem.Type === "Anime") {
      try {
        const { settingfetch } = require("./settings");
        settingfetch()
          .then((cfg) => {
            if (cfg?.mediaServerNaming) {
              const { onAnimeDownloadComplete } = require("./mediaServer");
              onAnimeDownloadComplete(removedItem).catch((e) => {
                logger.warn(
                  `[MediaServer] Auto-NFO generation error: ${e.message}`,
                );
              });
            }
          })
          .catch(() => {});
      } catch (_) {}
    }
  }

  try {
    const nextItem = AnimeQueue.find(
      (item) =>
        item.totalSegments > 0 ||
        (item.caption && item.caption.includes("Downloading")),
    );
    const hasItemsInQueue = AnimeQueue.length > 0;
    const fallbackCaption = hasItemsInQueue
      ? "Preparing next episode..."
      : "Nothing in progress";
    global.sendToRenderer("download-logger", {
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
      await run(
        `DELETE FROM DownloadQueue WHERE epid IN (${placeholders})`,
        epids,
      );
    } catch (err) {
      logger.error(
        "Failed to delete multiple from DownloadQueue DB: " + err.message,
      );
    }
    const epidsSet = new Set(epids.map((id) => String(id)));
    AnimeQueue = AnimeQueue.filter((item) => !epidsSet.has(String(item.epid)));
    if (AnimeQueue.length === 0) {
      resetDomainConcurrency();
    }
    if (global.updatePowerSaveBlocker) {
      global.updatePowerSaveBlocker();
    }
    try {
      const nextItem = AnimeQueue.find(
        (item) =>
          item.totalSegments > 0 ||
          (item.caption && item.caption.includes("Downloading")),
      );
      const hasItemsInQueue = AnimeQueue.length > 0;
      const fallbackCaption = hasItemsInQueue
        ? "Preparing next episode..."
        : "Nothing in progress";
      global.sendToRenderer("download-logger", {
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
  totalSegments = parseInt(totalSegments) || 0;
  currentSegments = parseInt(currentSegments) || 0;

  const indexToUpdate = AnimeQueue.findIndex(
    (item) => String(item.epid) === String(epid),
  );
  if (indexToUpdate !== -1) {
    AnimeQueue[indexToUpdate].totalSegments = totalSegments;
    AnimeQueue[indexToUpdate].currentSegments = currentSegments;

    if (caption && AnimeQueue[indexToUpdate].caption !== caption) {
      AnimeQueue[indexToUpdate].caption = caption;
      Tosave = true;
    }

    const progressPercentage =
      totalSegments > 0
        ? Math.floor((currentSegments / totalSegments) * 100)
        : 0;

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
    ? AnimeQueue?.filter(
        (item) => String(item.epid) !== String(currently_downloading),
      )
    : AnimeQueue;
}

// check if it exists in queue
async function checkEpisodeDownload(epid) {
  const found = AnimeQueue.some((item) => String(item.epid) === String(epid));
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
    for (const item of items) {
      const existingIdx = AnimeQueue.findIndex(
        (qItem) => String(qItem.epid) === String(item.epid),
      );
      if (existingIdx !== -1) {
        AnimeQueue[existingIdx] = item;
      } else {
        AnimeQueue.push(item);
      }
    }
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
const activeEpidSince = new Map();

function describeStuckWorker() {
  try {
    const parts = [];
    for (const epid of activeProcessingEpids) {
      const since = activeEpidSince.get(epid) || Date.now();
      parts.push(`${epid} (${Math.round((Date.now() - since) / 1000)}s)`);
    }
    return parts.length > 0 ? parts.join(", ") : "unknown";
  } catch (_) {
    return "unknown";
  }
}

function isRetryableError(err) {
  if (!err || !err.message) return false;
  const msg = err.message.toLowerCase();
  if (
    msg.includes("queue paused") ||
    msg.includes("episode cancelled") ||
    msg.includes("data missing") ||
    msg.includes("type is not valid")
  ) {
    return false;
  }
  return (
    msg.includes("slow_mirror_failover") ||
    msg.includes("scraper_temporary_error") ||
    msg.includes("stream link") ||
    msg.includes("resolution timeout") ||
    msg.includes("server resolution") ||
    msg.includes("failed to download") ||
    msg.includes("no stream url") ||
    msg.includes("no source link") ||
    msg.includes("no image found") ||
    msg.includes("cloudflare") ||
    msg.includes("err_address_unreachable") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("etimedout") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    msg.includes("fetch failed") ||
    msg.includes("abort") ||
    msg.includes("timeout") ||
    msg.includes("429") ||
    msg.includes("403") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504") ||
    msg.includes("enotfound") ||
    msg.includes("eai_again")
  );
}

// queue start
async function continuousExecution() {
  if (isQueuePausedState) return;

  try {
    let currentQueue = await getQueue();
    if (!currentQueue || currentQueue.length === 0) {
      return;
    }

    if (activeProcessingEpids.size >= 1) {
      logger.warn(
        `[queueWorker] Worker busy, holding queue. Active: ${describeStuckWorker()}`,
      );
      return;
    }

    logger.info("[queueWorker] Checking download queue...");

    // Poison rows (queued without an episode ID) can never start since
    // epid is the task key. Drop them loudly instead of letting them
    // sit in Upcoming Queue forever with zero log output.
    try {
      const poisoned = (currentQueue || []).filter((t) => t && !t.epid);
      if (poisoned.length > 0) {
        await run("DELETE FROM DownloadQueue WHERE epid IS NULL OR epid = ''");
        AnimeQueue = AnimeQueue.filter((t) => t && t.epid);
        currentQueue = currentQueue.filter((t) => t && t.epid);
        const names = poisoned
          .map((t) => t.Title || t.ChapterTitle || "item")
          .slice(0, 3)
          .join(", ");
        logger.warn(
          `[queueWorker] Dropped ${poisoned.length} queued item(s) with missing episode ID (${names}). Re-add them from the episode list.`,
        );
        try {
          global.sendToRenderer("download-error", {
            title: "Download Failed",
            message: `Could not start ${names}: missing episode ID. Re-add it from the episode list.`,
          });
        } catch (_) {}
      }
    } catch (_) {}

    let startedNewTask = false;

    for (const currentTask of currentQueue) {
      if (isQueuePausedState) break;

      if (activeProcessingEpids.size >= 1) {
        logger.warn(
          `[queueWorker] Slot taken, deferring remaining tasks. Active: ${describeStuckWorker()}`,
        );
        break;
      }

      if (
        !currentTask ||
        !currentTask.epid ||
        activeProcessingEpids.has(currentTask.epid)
      ) {
        if (currentTask && !currentTask.epid) {
          logger.warn(
            `[queueWorker] Skipping queue row without episode ID (Title: ${currentTask.Title || currentTask.ChapterTitle || "unknown"}).`,
          );
        }
        continue;
      }

      activeProcessingEpids.add(currentTask.epid);
      activeEpidSince.set(currentTask.epid, Date.now());
      startedNewTask = true;

      (async () => {
        try {
          if (
            currentTask?.Type === "Anime" ||
            currentTask?.Type === "Movies"
          ) {
            let {
              config,
              Title,
              EpNum,
              epid,
              SubDub,
              malid,
              id: animeId,
              Type,
            } = currentTask;
            if (config && Title && EpNum && epid && SubDub) {
              await downloadep(
                { ...config, Type },
                Title,
                EpNum,
                epid,
                SubDub,
                malid,
                animeId,
              );
            } else {
              logger.error(
                `Error message: Some ${currentTask.Type || "Media"} Data missing [ removing from queue ]`,
              );
              await removeQueue(currentTask.epid, false);
              return;
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
              await removeQueue(currentTask.epid, false);
              return;
            }
          } else {
            logger.error(
              `Error message: Type is Not Valid [ removing from queue ]`,
            );
            await removeQueue(currentTask.epid, false);
            return;
          }
          await removeQueue(currentTask.epid, true);
        } catch (err) {
          if (err.message && err.message.includes("Queue Paused")) {
            logger.info(
              "[queueWorker] Download paused. Keeping item in queue.",
            );
          } else if (err.message && err.message.includes("Episode Cancelled")) {
            logger.info("[queueWorker] Download cancelled by user.");
            if (currentTask?.epid) {
              await removeQueue(currentTask.epid, false);
            }
          } else if (isRetryableError(err)) {
            const isSlow =
              err?.isSlowMirror ||
              (err?.message && err.message.includes("SLOW_MIRROR_FAILOVER"));
            // Remember dead/slow mirror hosts so the retry resolves a different server.
            if (err.failedHost && currentTask?.epid) {
              const known = hostSkipByEpid.get(currentTask.epid) || [];
              if (!known.includes(err.failedHost)) {
                known.push(err.failedHost);
                hostSkipByEpid.set(currentTask.epid, known);
                logger.warn(
                  `[queueWorker] Excluding ${isSlow ? "slow" : "dead"} host ${err.failedHost} for ${currentTask.epid} on retry`,
                );
              }
            }

            if (isSlow) {
              logger.info(
                `[queueWorker] Slow mirror failover on ${currentTask?.epid} from host ${err.failedHost}. Switching immediately to alternate mirror...`,
              );
              const cleanEp =
                currentTask.EpNum !== undefined && currentTask.EpNum !== null
                  ? String(currentTask.EpNum)
                  : "";
              const switchCaption = `Switching to faster mirror for EP ${cleanEp}...`;
              await updateQueue(currentTask.epid, 0, 0, switchCaption);
              try {
                global.sendToRenderer("download-logger", {
                  caption: switchCaption,
                  totalSegments: 0,
                  currentSegments: 0,
                  epid: currentTask.epid,
                  isPaused: isQueuePaused(),
                });
              } catch (_) {}
              return;
            }

            currentTask.retryCount = (currentTask.retryCount || 0) + 1;
            const maxRetries = 3;
            if (currentTask.retryCount >= maxRetries) {
              logger.error(
                `[queueWorker] Task ${currentTask?.epid} failed after ${maxRetries} retries: ${err.message}. Removing from queue.`,
              );
              try {
                const itemLabel = currentTask?.Title
                  ? `${currentTask.Title} (${currentTask?.Type === "Manga" ? "CHP" : "EP"} ${currentTask?.EpNum || ""})`
                  : "Download";
                global.sendToRenderer("download-error", {
                  title: "Download Failed",
                  message: `${itemLabel}: ${err.message} (max retries exceeded)`,
                  epid: currentTask?.epid,
                });
              } catch (ipcErr) {}
              if (currentTask?.epid) {
                hostSkipByEpid.delete(currentTask.epid);
                await removeQueue(currentTask.epid, false);
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
              const prefix = currentTask.Type === "Manga" ? "CHP" : "EP";
              const retryCaption = `Downloading ${prefix} ${cleanEp} ${currentTask.Title || ""}${qualStr} Retrying in ${Math.round(backoffMs / 1000)}s...`;
              await updateQueue(currentTask.epid, 0, 0, retryCaption);
              try {
                global.sendToRenderer("download-logger", {
                  caption: retryCaption,
                  totalSegments: 0,
                  currentSegments: 0,
                  epid: currentTask.epid,
                  isPaused: isQueuePaused(),
                });
              } catch (_) {}
              logger.warn(
                `[queueWorker] Scraper/Download error on task ${currentTask?.epid} (attempt ${currentTask.retryCount}/${maxRetries}): ${err.message}. Retrying in ${backoffMs / 1000}s...`,
              );
              const prov =
                currentTask.config?.Animeprovider ||
                currentTask.config?.Mangaprovider ||
                "scraper";
              markCoolingDown(prov, backoffMs);
              await new Promise((resolve) => setTimeout(resolve, backoffMs));
            }
          } else {
            logger.error(`Error message: ${err.message}`);
            logger.error(`Stack trace: ${err.stack}`);
            try {
              const itemLabel = currentTask?.Title
                ? `${currentTask.Title} (${currentTask?.Type === "Manga" ? "CHP" : "EP"} ${currentTask?.EpNum || ""})`
                : "Download";
              global.sendToRenderer("download-error", {
                title: "Download Failed",
                message: `${itemLabel}: ${err.message}`,
                epid: currentTask?.epid,
              });
            } catch (ipcErr) {}
            if (currentTask?.epid) {
              logger.warn(
                `[queueWorker] Task ${currentTask.epid} fatal error: ${err.message}. Removing from queue.`,
              );
              hostSkipByEpid.delete(currentTask.epid);
              await removeQueue(currentTask.epid, false);
            }
          }
        } finally {
          activeProcessingEpids.delete(currentTask.epid);
          activeEpidSince.delete(currentTask.epid);
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
  logger.info(`[queueWorker] ${AnimeEpId} phase: dir-start`);
  const liveSettings = (await settingfetch()) || {};
  let directoryPath;
  const isMovie =
    Videoconfig?.Type === "Movies" || !!Videoconfig?.Moviesprovider;
  const dlLoc =
    (isMovie
      ? Videoconfig?.CustomDownloadLocationMovies
      : Videoconfig?.CustomDownloadLocationAnime) ||
    Videoconfig?.CustomDownloadLocation;

  if (liveSettings.mediaServerNaming === true) {
    // Season and show folder picked on the show's page (default: S1, title)
    const show = liveSettings.mediaServerShows?.[String(animeId)] || {};
    const season = parseInt(show.season, 10);
    directoryPath = await mediaServerDir(
      String(show.series || "").trim() || Title,
      Number.isInteger(season) && season >= 0 ? season : 1,
      dlLoc,
      animeId || AnimeEpId,
    );
    if (!isMovie) {
      try {
        const { generateNfoAndPosterForAnime } = require("./mediaServer");
        generateNfoAndPosterForAnime(animeId || AnimeEpId, dlLoc).catch(() => {});
      } catch (_) {}
    }
  } else if (isMovie) {
    directoryPath = await MovieDir(
      Title,
      dlLoc,
      animeId || AnimeEpId,
    );
  } else {
    directoryPath = await directoryMaker(
      Title,
      EpNum,
      dlLoc,
      animeId || AnimeEpId,
    );
  }
  _bgDownloadDepth++;
  logger.info(`[queueWorker] ${AnimeEpId} phase: dir-ready ${directoryPath}`);
  try {
    const qualStr = Videoconfig?.quality ? ` ( ${Videoconfig.quality} )` : "";
    const cleanEp =
      EpNum !== undefined && EpNum !== null && !isNaN(Number(EpNum))
        ? String(Number(EpNum))
        : EpNum;
    const initialCaption = `Resolving EP ${cleanEp} ${Title}${qualStr}...`;
    await updateQueue(AnimeEpId, 0, 0, initialCaption);
    global.sendToRenderer("request-battery-optimization", {});
    global.sendToRenderer("download-logger", {
      caption: initialCaption,
      totalSegments: 0,
      currentSegments: 0,
      epid: AnimeEpId,
      isPaused: isQueuePaused(),
    });

    logger.info(`[queueWorker] ${AnimeEpId} phase: resolving-sources`);
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

function extractSourceQualityHeight(s) {
  const qStr = String(s?.quality || s?.name || "").toLowerCase();
  const match = qStr.match(/(\d+)p/);
  if (match) return parseInt(match[1], 10);
  if (qStr.includes("1080")) return 1080;
  if (qStr.includes("720")) return 720;
  if (qStr.includes("480")) return 480;
  if (qStr.includes("360")) return 360;
  return 0;
}

async function inspectStreamMaxHeight(streamUrl, headers = {}) {
  if (!streamUrl || typeof streamUrl !== "string") return 0;
  try {
    const res = await axios.get(streamUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        ...headers,
      },
      timeout: 5000,
      responseType: "text",
    });
    const body = typeof res.data === "string" ? res.data : "";
    if (body.includes("#EXT-X-STREAM-INF:")) {
      let maxHeight = 0;
      const lines = body.split("\n");
      for (const line of lines) {
        const resMatch = line.match(/RESOLUTION=\d+x(\d+)/i);
        if (resMatch) {
          const h = parseInt(resMatch[1], 10);
          if (h > maxHeight) maxHeight = h;
        }
      }
      return maxHeight;
    }
    return 0;
  } catch (_) {
    return 0;
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
    const isMovie = config?.Type === "Movies" || !!config?.Moviesprovider;
    const provider = await providerFetch(
      isMovie ? "Movies" : "Anime",
      isMovie
        ? config.Moviesprovider || config.Animeprovider
        : config.Animeprovider,
    );
    logger.info(`[queueWorker] ${epid} phase: provider-ok, fetching sources`);
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
        sourcesArray = isMovie
          ? await fetchMovieSources(
              provider,
              resolvedEpid,
              subdub,
            )
          : await fetchEpisodeSources(
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

    logger.info(
      `[queueWorker] ${epid} phase: sources-${sourcesArray ? "ok" : "empty"}`,
    );
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

    // Stale queued episode IDs (e.g. anikoto session tokens expire, so a
    // task queued days ago resolves to nothing). Refresh via mapping: look
    // up the anime's current provider id, walk its episode list for the
    // same EP number, and retry sources once with the fresh episode id.
    if (
      (!sourcesList || sourcesList.length === 0) &&
      malid &&
      episodeNumber !== undefined &&
      episodeNumber !== null
    ) {
      try {
        const provName = provider.provider_name || config.Animeprovider;
        const best = await getBestProviderForMalId(
          Number(malid),
          "Anime",
          provName,
        );
        if (best && best.id) {
          for (let pg = 1; pg <= 5; pg++) {
            const eps = await fetchEpisode(provider, best.id, pg);
            const match = eps?.episodes?.find(
              (e) => Number(e.number) === Number(episodeNumber),
            );
            if (match?.id && String(match.id) !== String(resolvedEpid)) {
              logger.info(
                `[Download] Refreshing stale episode id via mapping: ${resolvedEpid} -> ${match.id}`,
              );
              const fresh = await fetchEpisodeSources(
                provider,
                String(match.id),
                subdub,
              );
              const freshList = extractSources(fresh, subdub);
              if (freshList && freshList.length > 0) {
                sourcesArray = fresh;
                sourcesList = freshList;
                break;
              }
            }
            if (!eps?.hasNextPage) break;
          }
        }
      } catch (refreshErr) {
        logger.warn(
          `[Download] Stale-id refresh failed: ${refreshErr.message}`,
        );
      }
    }

    let subtitles =
      sourcesArray?.subtitles ||
      sourcesArray?.[subdub]?.subtitles ||
      sourcesArray?.sub?.subtitles ||
      sourcesArray?.dub?.subtitles ||
      [];

    const Animeprovider = provider;
    const targetQualStr = config?.quality ?? "1080p";
    const targetHeight =
      parseInt(String(targetQualStr).replace(/\D/g, ""), 10) || 1080;
    const sortedSources = sortSourcesByPreferredQuality(
      sourcesList,
      targetQualStr,
    );

    let selectedSource = null;
    let bestQualityFallback = null;
    let bestFallbackHeight = 0;
    let bestFallbackSubtitles = null;
    let fallbackExcludedSource = null;
    let fallbackUnverifiedSource = null;

    for (let i = 0; i < sortedSources.length; i++) {
      const src = sortedSources[i];
      if (!src) continue;

      let candidate = null;
      let candidateSubtitles = null;

      if (src.isUnresolved || !src.url) {
        try {
          logger.info(
            `[Download] Resolving server #${i + 1} "${src.name || src.quality}" for download...`,
          );
          const resolved = await processServer(Animeprovider, src);
          if (resolved && resolved.url) {
            let rHost = "";
            try {
              rHost = new URL(resolved.url).hostname;
            } catch (_) {}
            const skipHosts = hostSkipByEpid.get(epid) || [];
            if (rHost && skipHosts.includes(rHost)) {
              logger.warn(
                `[Download] Server #${i + 1} "${src.name || src.quality}" resolved to excluded host ${rHost}, trying next server...`,
              );
              if (!fallbackExcludedSource) {
                fallbackExcludedSource = {
                  ...src,
                  ...resolved,
                  isUnresolved: false,
                };
              }
              continue;
            }
            candidate = {
              ...src,
              ...resolved,
              isUnresolved: false,
            };
            if (
              Array.isArray(resolved.subtitles) &&
              resolved.subtitles.length > 0
            ) {
              candidateSubtitles = resolved.subtitles;
            }
          } else {
            logger.warn(
              `[Download] Server #${i + 1} "${src.name || src.quality}" resolution failed or returned no stream URL. Trying fallback server...`,
            );
          }
        } catch (e) {
          logger.warn(
            `[Download] Error resolving server #${i + 1} "${src.name || src.quality}": ${e.message}`,
          );
        }
      } else {
        let aliveHost = "";
        try {
          aliveHost = new URL(src.url).hostname;
        } catch (_) {}
        const skipHostsAlive = hostSkipByEpid.get(epid) || [];
        if (aliveHost && skipHostsAlive.includes(aliveHost)) {
          logger.warn(
            `[Download] Server #${i + 1} "${src.name || src.quality}" is on excluded host ${aliveHost}, trying next server...`,
          );
          if (!fallbackExcludedSource) {
            fallbackExcludedSource = src;
          }
          continue;
        }
        if (!fallbackUnverifiedSource) {
          fallbackUnverifiedSource = src;
        }
        if (sortedSources.length === 1) {
          candidate = src;
        } else {
          const isAlive = await verifyStreamReachability(
            src.url,
            src.headers || {},
            src.isM3U8 !== false,
          );
          if (isAlive.ok || isAlive.isProtected) {
            candidate = src;
          } else {
            logger.warn(
              `[Download] Server #${i + 1} "${src.name || src.quality}" stream verification failed: ${isAlive.message}. Trying fallback server...`,
            );
          }
        }
      }

      if (candidate) {
        if (targetHeight > 0 && sortedSources.length > 1) {
          let qualHeight = extractSourceQualityHeight(candidate);
          if (qualHeight === 0 && candidate.isM3U8 !== false) {
            qualHeight = await inspectStreamMaxHeight(
              candidate.url,
              candidate.headers || {},
            );
          }

          if (qualHeight >= targetHeight) {
            logger.info(
              `[Download] Server #${i + 1} "${src.name || src.quality}" satisfies requested quality (${qualHeight}p >= ${targetHeight}p). Selecting this server.`,
            );
            selectedSource = candidate;
            if (candidateSubtitles) subtitles = candidateSubtitles;
            break;
          } else {
            logger.info(
              `[Download] Server #${i + 1} "${src.name || src.quality}" provides ${qualHeight ? `${qualHeight}p` : "unknown resolution"} (requested: ${targetHeight}p). Retaining as fallback...`,
            );
            if (!bestQualityFallback || qualHeight > bestFallbackHeight) {
              bestQualityFallback = candidate;
              bestFallbackHeight = qualHeight;
              if (candidateSubtitles) bestFallbackSubtitles = candidateSubtitles;
            }
          }
        } else {
          selectedSource = candidate;
          if (candidateSubtitles) subtitles = candidateSubtitles;
          break;
        }
      }
    }

    if (!selectedSource && bestQualityFallback) {
      logger.info(
        `[Download] No server matched requested quality ${targetHeight}p. Proceeding with best available server (${bestFallbackHeight ? `${bestFallbackHeight}p` : "default"}).`,
      );
      selectedSource = bestQualityFallback;
      if (bestFallbackSubtitles) subtitles = bestFallbackSubtitles;
    }

    if (!selectedSource && fallbackExcludedSource) {
      logger.warn(
        `[Download] All available servers are on previously excluded host(s). Reusing best available server in permissive mode to allow download to proceed.`,
      );
      selectedSource = fallbackExcludedSource;
      if (config) config.permissiveMode = true;
    }

    if (!selectedSource && fallbackUnverifiedSource) {
      logger.warn(
        `[Download] All stream reachability probes failed or were inconclusive. Proceeding with best candidate server to allow download clearance retry.`,
      );
      selectedSource = fallbackUnverifiedSource;
    }

    if (!selectedSource || !selectedSource.url) {
      throw new Error(
        "Failed to resolve stream link for download across all available servers",
      );
    }

    try {
      const streamDomain = new URL(selectedSource.url).hostname;
      const ref =
        selectedSource.headers?.Referer ||
        selectedSource.headers?.referer ||
        (provider?.baseUrl ? provider.baseUrl + "/" : null);
      if (global.registerSubrequestHeaders && selectedSource.headers) {
        global.registerSubrequestHeaders(streamDomain, selectedSource.headers);
      }
      if (ref && global.setDynamicReferer) {
        global.setDynamicReferer(streamDomain, ref);
        global.setFallbackReferer(ref);
      }
    } catch (e) {}

    const dlQuality =
      selectedSource.quality && selectedSource.quality.match(/\d+p/)
        ? selectedSource.quality
        : config?.quality || "1080p";

    const currentSettings = (await settingfetch()) || {};
    const preferredLangs = config?.preferredSubtitleLanguages ||
      currentSettings?.preferredSubtitleLanguages || ["English"];

    let filteredSubtitles = (subdub === "hsub" ? [] : subtitles || []).filter(
      (sub) => {
        if (!sub || typeof sub !== "object") return false;
        const subLang = sub.lang || sub.label || sub.language;
        return (
          subLang !== "Thumbnails" &&
          isLanguagePreferred(subLang, preferredLangs)
        );
      },
    );
    if (
      subdub !== "hsub" &&
      preferredLangs.length > 0 &&
      filteredSubtitles.length === 0 &&
      Array.isArray(subtitles) &&
      subtitles.length > 0
    ) {
      filteredSubtitles = subtitles.filter((sub) => {
        if (!sub || typeof sub !== "object") return false;
        const subLang = sub.lang || sub.label || sub.language;
        return subLang !== "Thumbnails";
      });
    }

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
      selectedSource.isM3U8,
      currentSettings.mediaServerNaming === true
        ? mediaServerFileBase(directoryName, episodeNumber, dlQuality)
        : null,
      config?.permissiveMode
        ? "0"
        : currentSettings.minDownloadSpeed || "300 KB/s",
    );
    hostSkipByEpid.delete(epid);

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
          const aniskipUrl = `https://api.aniskip.com/v2/skip-times/${malid}/${Number(epNum)}?types[]=op&types[]=ed&types[]=mixed-op&types[]=mixed-ed&episodeLength=1440`;
          // AniSkip answers 404 when no one has submitted times for this episode
          const res = await axios.get(aniskipUrl, {
            validateStatus: (s) => s === 200 || s === 404,
          });
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
                const rawEpNum = Number(epNum);
                const cleanEpNum =
                  !isNaN(rawEpNum) && Number.isInteger(rawEpNum)
                    ? Math.trunc(rawEpNum)
                    : rawEpNum;
                await run(
                  "INSERT OR REPLACE INTO SkipTimes (anime_id, episode_number, skip_times) VALUES (?, ?, ?)",
                  [animeId, cleanEpNum, JSON.stringify(normalized)],
                );
                logger.info(
                  `[queueWorker] Saved skip times to SkipTimes DB for ${Title} EP ${cleanEpNum}`,
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
        logger.warn(`[queueWorker] Failed to save skip times: ${err.message}`);
      }
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
  isM3U8 = true,
  fileBase = null,
  minDownloadSpeed = null,
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
      isM3U8: isM3U8,
      fileBase: fileBase,
      minDownloadSpeed: minDownloadSpeed,
    });
  } catch (err) {
    if (err.message === "Queue Paused" || err.message === "Episode Cancelled") {
      throw err;
    }
    const errMsg = err?.message || String(err);
    const wrapped = new Error(`Failed To Download: ${errMsg}`);
    // Preserve dead-host info so the queue can exclude the mirror on retry.
    if (err?.failedHost) wrapped.failedHost = err.failedHost;
    if (err?.isSlowMirror) wrapped.isSlowMirror = true;
    if (err?.bps) wrapped.bps = err.bps;
    throw wrapped;
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
    global.sendToRenderer("download-logger", {
      caption: initialCaption,
      totalSegments: 1,
      currentSegments: 0,
      epid: ChapterId,
      isPaused: isQueuePaused(),
    });

    const provider = await providerFetch("Manga", config?.Mangaprovider);
    const ChapterData = await MangaChapterFetch(provider, ChapterId);

    if (!ChapterData || ChapterData?.length < 1) {
      throw new Error("No Image Found For This Chapter!");
    }

    const liveSettings = (await settingfetch()) || {};
    const customLoc =
      liveSettings?.CustomDownloadLocationManga ||
      config?.CustomDownloadLocationManga ||
      config?.CustomDownloadLocation;

    const directoryPath = await MangaDir(
      Title,
      customLoc,
      mediaId,
    );

    const mangaScheme =
      liveSettings?.mangaNamingScheme ||
      config?.mangaNamingScheme ||
      "default";
    const cbzFilename = formatChapterFilename({
      title: Title,
      chapterNum: EpNum,
      namingScheme: mangaScheme,
      ext: ".cbz",
    });
    const outputFile = path.join(directoryPath, cbzFilename);
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
