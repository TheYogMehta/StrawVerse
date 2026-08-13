const express = require("express");
const path = require("path");
const fs = require("fs");
const { app } = require("electron");
const { logger, getLogs, clearLogs } = require("../utils/AppLogger");
const { getQueue, updateQueue } = require("../utils/queue");
const ImageCacheManager = require("../utils/ImageCacheManager");
const { UpdateDiscordRPC } = require("../utils/discord");
const { sendToRenderer } = require("../utils/rendererIPC");

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
  res.json({ version: app.getVersion() });
});

// Get application changelog / release notes
router.get("/api/changelog", (req, res) => {
  try {
    const changelogPath = path.join(__dirname, "..", "CHANGELOG.md");
    if (fs.existsSync(changelogPath)) {
      const changelog = fs.readFileSync(changelogPath, "utf-8");
      res.json({ changelog });
    } else {
      res.status(404).json({ error: "Changelog file not found" });
    }
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

    sendToRenderer("download-logger", {
      caption,
      totalSegments,
      currentSegments,
      epid,
      id: activeTaskItem?.id,
      malid: activeTaskItem?.malid,
      EpNum: activeTaskItem?.EpNum,
      Title: activeTaskItem?.Title,
      Type: activeTaskItem?.Type,
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
        concurrency: task.epid === epid ? concurrency : task.concurrency,
        lastTestedConcurrency:
          task.epid === epid
            ? lastTestedConcurrency
            : task.lastTestedConcurrency,
        downloadSpeed: task.epid === epid ? downloadSpeed : task.downloadSpeed,
        eta: task.epid === epid ? eta : task.eta,
      })),
      queue: upcomingQueue,
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

// Reset Discord RPC to Idle
router.post("/api/discord/reset", async (req, res) => {
  try {
    UpdateDiscordRPC().catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

module.exports = router;
