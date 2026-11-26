const express = require("express");
const { logger, getLogs, clearLogs } = require("../utils/AppLogger");
const { getQueue, updateQueue, isQueuePaused } = require("../utils/queue");
const ImageCacheManager = require("../utils/ImageCacheManager");
const { getCurrentAppVersion } = require("../utils/constants");
const { getChangelog } = require("../utils/changelog");
const { getKeyValue, setKeyValue, run } = require("../utils/db");
const { maskApiKey } = require("../utils/mediaEnrichment");
const {
  getFfmpegDiagnostics,
  invalidateBinaryCache,
  isAndroidRuntime,
  validateFfmpegBinary,
} = require("../utils/ffmpeg");

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

router.post("/api/marketplace/repos/restore-default", async (req, res) => {
  try {
    const { restoreDefaultExtensionRepo } = require("../utils/settings");
    const result = await restoreDefaultExtensionRepo();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete("/api/marketplace/repos", async (req, res) => {
  try {
    const { removeExtensionRepo } = require("../utils/settings");
    const target =
      req.query.id || req.query.url || req.body?.id || req.body?.url;
    const result = await removeExtensionRepo(target);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/marketplace/repos/:owner/:repo", async (req, res) => {
  try {
    const { removeExtensionRepo } = require("../utils/settings");
    const target = `${req.params.owner}/${req.params.repo}`;
    const result = await removeExtensionRepo(target);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete("/api/marketplace/repos/:identifier", async (req, res) => {
  try {
    const { removeExtensionRepo } = require("../utils/settings");
    const target =
      req.params.identifier ||
      req.query.id ||
      req.query.url ||
      req.body?.id ||
      req.body?.url;
    const result = await removeExtensionRepo(target);
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

// Optional TMDB API Key configuration (stored server-side, never returned raw)
router.get("/api/settings/tmdb-key", async (req, res) => {
  try {
    const rawKey = await getKeyValue("Settings", "tmdbApiKey");
    const hasKey = typeof rawKey === "string" && rawKey.trim().length > 0;
    return res.json({
      configured: hasKey,
      masked: hasKey ? maskApiKey(rawKey) : null,
    });
  } catch (err) {
    logger.error("Failed to read TMDB key status: " + err.message);
    return res.status(500).json({ error: "Failed to read TMDB key status" });
  }
});

router.post("/api/settings/tmdb-key", async (req, res) => {
  try {
    const apiKey = typeof req.body?.apiKey === "string" ? req.body.apiKey.trim() : "";
    if (!apiKey || apiKey.length < 16 || apiKey.length > 512 || /\s/.test(apiKey)) {
      return res.status(400).json({
        error: "Invalid TMDB API key or Read Access Token (16-512 chars, no spaces)",
      });
    }
    await setKeyValue("Settings", "tmdbApiKey", apiKey);
    try {
      await run("DELETE FROM MediaEnrichmentCache WHERE cache_key LIKE 'movies:tmdb:%'");
    } catch (_) {}
    return res.json({
      success: true,
      configured: true,
      masked: maskApiKey(apiKey),
    });
  } catch (err) {
    logger.error("Failed to save TMDB key: " + err.message);
    return res.status(500).json({ error: "Failed to save TMDB API key" });
  }
});

router.delete("/api/settings/tmdb-key", async (req, res) => {
  try {
    await setKeyValue("Settings", "tmdbApiKey", null);
    try {
      await run("DELETE FROM MediaEnrichmentCache WHERE cache_key LIKE 'movies:tmdb:%'");
    } catch (_) {}
    return res.json({
      success: true,
      configured: false,
      masked: null,
    });
  } catch (err) {
    logger.error("Failed to clear TMDB key: " + err.message);
    return res.status(500).json({ error: "Failed to clear TMDB API key" });
  }
});

// FFmpeg binary & hardware encoder diagnostics
router.get("/api/system/ffmpeg", async (req, res) => {
  try {
    const diagnostics = await getFfmpegDiagnostics();
    res.json(diagnostics);
  } catch (err) {
    logger.error("Failed to read FFmpeg diagnostics: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

router.post("/api/system/ffmpeg/recheck", async (req, res) => {
  try {
    const customPath =
      typeof req.body?.customPath === "string" ? req.body.customPath.trim() : "";
    if (customPath) {
      if (isAndroidRuntime()) {
        return res.status(400).json({
          error: "Custom FFmpeg binary path is not supported on Android",
        });
      }
      const check = await validateFfmpegBinary(customPath);
      if (!check.valid) {
        return res.status(400).json({ error: check.error || "Invalid FFmpeg binary path" });
      }
    }

    invalidateBinaryCache();
    const diagnostics = await getFfmpegDiagnostics({ forceRefresh: true });
    res.json(diagnostics);
  } catch (err) {
    logger.error("Failed to recheck FFmpeg diagnostics: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
