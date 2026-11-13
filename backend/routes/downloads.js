const express = require("express");
const { logger } = require("../utils/AppLogger");
const {
  downloadAnimeSingle,
  downloadAnimeMulti,
  downloadMangaSingle,
  downloadMangaMulti,
  downloadMovieSingle,
  downloadMovieMulti,
} = require("../download");
const {
  getQueue,
  removeQueue,
  removeMultipleFromQueue,
  pauseQueue,
  resumeQueue,
  isQueuePaused,
} = require("../utils/queue");
const { setKeyValue } = require("../utils/db");

const router = express.Router();

// Download API for anime & manga
router.post("/api/download/:AnimeManga/:singleMulti", async (req, res) => {
  const { AnimeManga, singleMulti } = req.params;

  try {
    let MessageData = null;

    const isAnime = AnimeManga === "Anime";
    const isMovies = AnimeManga === "Movies";

    if (singleMulti === "Single") {
      const {
        id,
        ep,
        Title,
        number,
        provider,
        malid = null,
        subdub = null,
        quality = null,
      } = req.body;
      const targetEpId = ep && typeof ep === "object" ? ep.id : ep;
      if (isMovies) {
        MessageData = await downloadMovieSingle(
          provider,
          id,
          targetEpId,
          number,
          Title,
          true,
          null,
          null,
          false,
          malid,
          subdub,
          quality,
        );
      } else if (isAnime) {
        MessageData = await downloadAnimeSingle(
          provider,
          id,
          targetEpId,
          number,
          Title,
          true,
          null,
          null,
          false,
          malid,
          subdub,
          quality,
        );
      } else {
        MessageData = await downloadMangaSingle(
          provider,
          id,
          targetEpId,
          number,
          Title,
          true,
          null,
          null,
          false,
          malid,
        );
      }
    } else if (singleMulti === "Multi") {
      const {
        id,
        Episodes,
        Chapters,
        Title,
        SubDub,
        provider,
        malid = null,
        quality = null,
      } = req.body;
      if (isMovies) {
        MessageData = await downloadMovieMulti(
          provider,
          id,
          Episodes,
          Title,
          SubDub,
          malid,
          quality,
        );
      } else if (isAnime) {
        MessageData = await downloadAnimeMulti(
          provider,
          id,
          Episodes,
          Title,
          SubDub,
          malid,
          quality,
        );
      } else {
        MessageData = await downloadMangaMulti(
          provider,
          id,
          Chapters,
          Title,
          malid,
        );
      }
    }

    return res.json(MessageData);
  } catch (err) {
    logger.error(`Error in /api/download: ${err.message}`);
    return res.json({ error: true, message: err?.message });
  }
});

// Get current downloads state
router.post("/downloads", async (req, res) => {
  let queue = (await getQueue()) ?? [];

  let activeItem = queue.find(
    (item) =>
      item.totalSegments > 0 ||
      (item.caption && item.caption.includes("Downloading")),
  );
  let activeTasks = activeItem ? [activeItem] : [];
  let upcomingQueue = activeItem
    ? queue.filter((item) => item?.epid !== activeItem.epid)
    : queue;

  let Response = {
    caption:
      activeTasks.length > 0 ? activeTasks[0].caption : "Nothing in progress",
    activeTasks: activeTasks.map((task) => ({
      caption: task.caption,
      totalSegments: task.totalSegments,
      currentSegments: task.currentSegments,
      epid: task.epid,
      id: task.id,
      malid: task.malid,
      EpNum: task.EpNum,
      Title: task.Title,
      Type: task.Type,
      concurrency: task.concurrency,
      lastTestedConcurrency: task.lastTestedConcurrency,
    })),
    queue: upcomingQueue,
    isPaused: isQueuePaused(),
  };

  if (activeTasks.length > 0) {
    const first = activeTasks[0];
    Response.totalSegments = first.totalSegments;
    Response.currentSegments = first.currentSegments;
    Response.epid = first.epid;
    Response.id = first.id;
    Response.malid = first.malid;
    Response.EpNum = first.EpNum;
    Response.Title = first.Title;
    Response.Type = first.Type;
  }

  return res.json(Response);
});

// Pause queue
router.post("/api/download/pause", async (req, res) => {
  try {
    const paused = await pauseQueue();
    const queue = (await getQueue()) ?? [];
    global.sendToRenderer("download-logger", {
      queue,
      isPaused: true,
      message: "Queue paused",
    });
    return res.json({ message: "Queue paused successfully", isPaused: true });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Resume queue
router.post("/api/download/resume", async (req, res) => {
  try {
    const paused = await resumeQueue();
    const queue = (await getQueue()) ?? [];
    global.sendToRenderer("download-logger", {
      queue,
      isPaused: false,
      message: "Queue resumed",
    });
    return res.json({ message: "Queue resumed successfully", isPaused: false });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Save custom local card order
router.post("/api/local/reorder", async (req, res) => {
  try {
    const { key, order } = req.body;
    if (
      key &&
      Array.isArray(order) &&
      (key.startsWith("Anime_local_") || key.startsWith("Manga_local_"))
    ) {
      await setKeyValue("Settings", `custom_order_${key}`, order);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Remove from queue or remove all
router.post("/api/download/remove", async (req, res) => {
  try {
    const { AnimeEpId } = req.body;

    if (AnimeEpId) {
      let queue = await removeQueue(AnimeEpId);

      const itemWithSegments = queue?.find((item) => item.totalSegments > 0);
      if (itemWithSegments) {
        let caption = itemWithSegments.caption;
        if (!caption) {
          const qualStr = itemWithSegments.config?.quality
            ? ` ( ${itemWithSegments.config.quality} )`
            : "";
          if (itemWithSegments.Type === "Anime") {
            caption = `Downloading EP ${itemWithSegments.EpNum} ${itemWithSegments.Title}${qualStr}`;
          } else if (itemWithSegments.Type === "Manga") {
            caption = `Downloading CHP ${itemWithSegments.EpNum || itemWithSegments.ChapterTitle} ${itemWithSegments.Title}${qualStr}`;
          } else {
            caption = "Downloading...";
          }
        }
        global.sendToRenderer("download-logger", {
          caption,
          totalSegments: itemWithSegments.totalSegments,
          currentSegments: itemWithSegments.currentSegments,
          epid: itemWithSegments.epid,
          queue,
          isPaused: isQueuePaused(),
        });
      } else {
        global.sendToRenderer("download-logger", {
          queue,
          message: "Queue is empty",
          isPaused: isQueuePaused(),
        });
      }

      return res.json({ message: `Item with ID ${AnimeEpId} removed` });
    }

    const queue = await getQueue();
    const epidsToRemove = queue
      .filter((item) => item.totalSegments <= 0)
      .map((item) => item.epid);
    const updatedQueue = await removeMultipleFromQueue(epidsToRemove);

    global.sendToRenderer("download-logger", {
      queue: updatedQueue,
      isPaused: isQueuePaused(),
    });

    res.json({ message: "All items removed" });
  } catch (err) {
    logger.error(`Error Removing ${req?.body?.AnimeEpId ? "Ep" : "Ep(s)"}`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

module.exports = router;
