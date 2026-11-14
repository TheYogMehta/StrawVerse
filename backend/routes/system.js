const express = require("express");
const { logger, getLogs, clearLogs } = require("../utils/AppLogger");
const { getQueue, updateQueue, isQueuePaused } = require("../utils/queue");
const ImageCacheManager = require("../utils/ImageCacheManager");
const { getCurrentAppVersion } = require("../utils/constants");
const { getChangelog } = require("../utils/changelog");

const router = express.Router();

// Get application logs
router.get("/api/logs", async (req, res) => {
  try {
    const logs = await getLogs();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear application logs
router.delete("/api/logs", async (req, res) => {
  try {
    await clearLogs();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get app version
router.get("/api/version", (req, res) => {
  const version = getCurrentAppVersion();
  res.json({ ok: true, result: version, version });
});

// Get application changelog / release notes
router.get("/api/changelog", (req, res) => {
  try {
    const changelog = getChangelog();
    if (changelog) {
      return res.json({ changelog });
    }
    res.status(404).json({ error: "changelog.md not found" });
  } catch (err) {
    logger.error("Failed to read changelog: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

// Handles Download Progress & Sends To FrontEnd
router.post("/api/logger", async (req, res) => {
  const {
    caption,
    totalSegments,
    currentSegments,
    epid,
    concurrency,
    lastTestedConcurrency,
    downloadSpeed,
    eta,
  } = req.body;
  try {
    const currentQueue = (await getQueue()) ?? [];
    const exists = currentQueue.some((item) => item.epid === epid);
    if (!exists) {
      return res.status(200).json({ message: "Task no longer in queue" });
    }

    let queue =
      (await updateQueue(epid, totalSegments, currentSegments, caption)) ?? [];

    let activeItem = queue.find(
      (item) =>
        item.totalSegments > 0 ||
        (item.caption && item.caption.includes("Downloading")),
    );
    let activeTasksItems = activeItem ? [activeItem] : [];
    let upcomingQueue = activeItem
      ? queue.filter((item) => item?.epid !== activeItem.epid)
      : queue;

    const activeTaskItem = currentQueue.find((item) => item.epid === epid);

    global.sendToRenderer("download-logger", {
      caption,
      totalSegments,
      currentSegments,
      epid,
      id: activeTaskItem?.id,
      malid: activeTaskItem?.malid,
      EpNum: activeTaskItem?.EpNum,
      Title: activeTaskItem?.Title,
      Type: activeTaskItem?.Type,
      season:
        activeTaskItem?.season !== undefined && activeTaskItem?.season !== null
          ? activeTaskItem.season
          : activeTaskItem?.config?.season !== undefined
            ? activeTaskItem.config.season
            : null,
      concurrency,
      lastTestedConcurrency,
      downloadSpeed,
      eta,
      isPaused: isQueuePaused(),
      activeTasks: activeTasksItems.map((task) => ({
        caption: task.caption,
        totalSegments: task.totalSegments,
        currentSegments: task.currentSegments,
        epid: task.epid,
        id: task.id,
        malid: task.malid,
        EpNum: task.EpNum,
        Title: task.Title,
        Type: task.Type,
        season:
          task.season !== undefined && task.season !== null
            ? task.season
            : task.config?.season !== undefined
              ? task.config.season
              : null,
        concurrency: task.epid === epid ? concurrency : task.concurrency,
        lastTestedConcurrency:
          task.epid === epid
            ? lastTestedConcurrency
            : task.lastTestedConcurrency,
        downloadSpeed: task.epid === epid ? downloadSpeed : task.downloadSpeed,
        eta: task.epid === epid ? eta : task.eta,
      })),
      queue: upcomingQueue.map((item) => ({
        ...item,
        season:
          item.season !== undefined && item.season !== null
            ? item.season
            : item.config?.season !== undefined
              ? item.config.season
              : null,
      })),
    });

    res.status(200).json({ message: "Download progress received" });
  } catch (err) {
    logger.error(`Error Logging Download Segment`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Get image cache stats
router.get("/api/cache/stats", (req, res) => {
  try {
    const stats = ImageCacheManager.getCacheStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear image cache
router.post("/api/cache/clear", async (req, res) => {
  try {
    const result = await ImageCacheManager.clearCache();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});
// Marketplace and Custom Repositories API
router.get("/api/marketplace", async (req, res) => {
  try {
    const { fetchAggregatedMarketplace } = require("../utils/settings");
    const activeType =
      req.query.type === "Manga"
        ? "Manga"
        : req.query.type === "Movies" || req.query.type === "movies-tvshows"
          ? "Movies"
          : "Anime";
    const data = await fetchAggregatedMarketplace(activeType);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/api/marketplace/repos", (req, res) => {
  try {
    const { getExtensionRepos } = require("../utils/settings");
    res.json({ repos: getExtensionRepos() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/marketplace/repos", async (req, res) => {
  try {
    const { addExtensionRepo } = require("../utils/settings");
    const url = req.body?.url || req.body?.args?.[0];
    const result = await addExtensionRepo(url);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/marketplace/repos/:owner", async (req, res) => {
  try {
    const { removeExtensionRepo } = require("../utils/settings");
    const result = await removeExtensionRepo(req.params.owner);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Extensions API (Add / Delete / Reload)
router.post("/api/extensions", async (req, res) => {
  try {
    const { HandleExtensions } = require("../utils/settings");
    const args = Array.isArray(req.body?.args) ? req.body.args : [];
    const result = await HandleExtensions(...args);
    res.json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

module.exports = router;
