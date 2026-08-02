const express = require("express");
const { logger } = require("../utils/AppLogger");
const {
  downloadAnimeSingle,
  downloadAnimeMulti,
  downloadMangaSingle,
  downloadMangaMulti,
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
const { sendToRenderer } = require("../utils/rendererIPC");

const router = express.Router();

// Download API for anime & manga
router.post("/api/download/:AnimeManga/:singleMulti", async (req, res) => {
  const { AnimeManga, singleMulti } = req.params;

  try {
    let MessageData = null;

    if (AnimeManga === "Anime") {
      if (singleMulti === "Single") {
        let {
          id,
          ep,
          Title,
          number,
          provider,
          malid = null,
          subdub = null,
        } = req.body;
        const targetEpId = ep && typeof ep === "object" ? ep.id : ep;
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
        );
      } else if (singleMulti === "Multi") {
        let { id, Episodes, Title, SubDub, provider, malid = null } = req.body;
        MessageData = await downloadAnimeMulti(
          provider,
          id,
          Episodes,
          Title,
          SubDub,
          malid,
        );
      }
    } else if (AnimeManga === "Manga") {
      if (singleMulti === "Single") {
        let { id, ep, Title, number, provider, malid = null } = req.body;
        const targetEpId = ep && typeof ep === "object" ? ep.id : ep;
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
      } else if (singleMulti === "Multi") {
        let { id, Chapters, Title, provider, malid = null } = req.body;
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

  let Response = {
    caption: "Nothing in progress",
    queue,
    isPaused: isQueuePaused(),
  };

  let itemWithSegments = queue.find((item) => item.currentSegments > 0);

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
    Response.caption = caption;
    Response.totalSegments = itemWithSegments.totalSegments;
    Response.currentSegments = itemWithSegments.currentSegments;
    Response.epid = itemWithSegments.epid;
    Response.id = itemWithSegments.id;
    Response.queue = queue.filter(
      (item) => item?.epid !== itemWithSegments?.epid,
    );
  }

  return res.json(Response);
});

// Pause queue
router.post("/api/download/pause", async (req, res) => {
  try {
    const paused = await pauseQueue();
    const queue = (await getQueue()) ?? [];
    sendToRenderer("download-logger", {
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
    sendToRenderer("download-logger", {
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
    if (key && Array.isArray(order)) {
      setKeyValue("Settings", `custom_order_${key}`, order);
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

      if (queue?.length > 0) {
        const itemWithSegments = queue.find((item) => item.totalSegments > 0);
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
          sendToRenderer("download-logger", {
            caption,
            totalSegments: itemWithSegments.totalSegments,
            currentSegments: itemWithSegments.currentSegments,
            epid: itemWithSegments.epid,
            queue,
            isPaused: isQueuePaused(),
          });
        } else {
          sendToRenderer("download-logger", {
            queue,
            message: "Queue is empty",
            isPaused: isQueuePaused(),
          });
        }
      } else {
        sendToRenderer("download-logger", {
          queue,
          message: "Queue is empty",
          isPaused: isQueuePaused(),
        });
      }

      return res.json({ message: `Item with ID ${AnimeEpId} removed` });
    }

    let queue = await getQueue();
    const toRemove = queue.filter((item) => item.totalSegments <= 0);
    const epidsToRemove = toRemove.map((item) => item.epid);
    const updatedQueue = await removeMultipleFromQueue(epidsToRemove);

    sendToRenderer("download-logger", {
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
