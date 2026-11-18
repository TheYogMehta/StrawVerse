const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const castService = require("../utils/castService");
const { logger } = require("../utils/AppLogger");
const { isVideoFile, ALLOWED_VIDEO_EXTENSIONS } = require("../utils/constants");

const router = express.Router();

function getMimeType(filePathOrUrl) {
  const clean = filePathOrUrl ? filePathOrUrl.split("?")[0].toLowerCase() : "";
  if (clean.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (clean.endsWith(".mp4")) return "video/mp4";
  if (clean.endsWith(".mkv")) return "video/x-matroska";
  if (clean.endsWith(".webm")) return "video/webm";
  if (clean.endsWith(".ts")) return "video/mp2t";
  return "video/mp4";
}

// 1. Discover devices on local network
router.get("/api/cast/devices", async (req, res) => {
  try {
    const timeout = parseInt(req.query.timeout, 10) || 3500;
    const devices = await castService.discoverDevices(timeout);
    res.json({ success: true, devices });
  } catch (err) {
    logger.error(`[cast] Failed to discover devices: ${err.message}`);
    res.status(500).json({ success: false, error: err.message, devices: [] });
  }
});

// 2. Start casting to a device
router.post("/api/cast/start", async (req, res) => {
  try {
    const deviceId =
      req.body.deviceId ||
      (req.body.device && (req.body.device.id || req.body.device.udn));
    const mediaUrl = req.body.url || req.body.videoUrl;
    const filePath = req.body.filePath;
    const headers = req.body.headers || {};
    const title = req.body.title || "StrawVerse Stream";
    const position =
      req.body.position !== undefined
        ? parseFloat(req.body.position)
        : req.body.positionMs !== undefined
        ? parseFloat(req.body.positionMs) / 1000
        : 0;
    const poster = req.body.poster || "";

    let device = deviceId ? castService.discoveredDevices.get(deviceId) : null;
    if (!device && req.body.device && req.body.device.location) {
      device = req.body.device;
      castService.discoveredDevices.set(device.id || device.location, device);
    }

    if (!device && deviceId) {
      // Re-scan quickly if device not cached
      await castService.discoverDevices(2500);
      device = castService.discoveredDevices.get(deviceId);
    }

    if (!device) {
      return res
        .status(404)
        .json({ success: false, error: "Device not found on network" });
    }

    const localIp = castService.getLocalIpAddress();
    const port = global.PORT || 9545;

    let streamProxyUrl;
    let mimeType = "video/mp4";

    if (filePath) {
      streamProxyUrl = `http://${localIp}:${port}/api/cast/stream?path=${encodeURIComponent(filePath)}`;
      mimeType = getMimeType(filePath);
    } else if (mediaUrl) {
      const encodedUrl = encodeURIComponent(mediaUrl);
      const encodedHeaders = encodeURIComponent(JSON.stringify(headers));
      streamProxyUrl = `http://${localIp}:${port}/api/cast/stream?url=${encodedUrl}&headers=${encodedHeaders}`;
      mimeType = getMimeType(mediaUrl);
    } else {
      return res
        .status(400)
        .json({ success: false, error: "Neither url nor filePath provided" });
    }

    logger.info(`[cast] Starting cast to ${device.name} -> ${streamProxyUrl}`);

    const session = await castService.castToDevice(device, {
      streamUrl: streamProxyUrl,
      title,
      position: parseFloat(position) || 0,
      mimeType,
      poster,
    });

    res.json({ success: true, session });
  } catch (err) {
    logger.error(`[cast] Failed to start casting: ${err.message}`);
    res.status(500).json({ success: false, error: err.message });
  }
});

// 3. Play / Resume
router.post("/api/cast/play", async (req, res) => {
  try {
    await castService.play();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 4. Pause
router.post("/api/cast/pause", async (req, res) => {
  try {
    await castService.pause();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 5. Seek
router.post("/api/cast/seek", async (req, res) => {
  try {
    const { seconds, position, positionMs } = req.body;
    const targetSeconds =
      seconds !== undefined
        ? parseFloat(seconds)
        : position !== undefined
        ? parseFloat(position)
        : positionMs !== undefined
        ? parseFloat(positionMs) / 1000
        : 0;
    await castService.seek(targetSeconds);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 6. Stop
router.post("/api/cast/stop", async (req, res) => {
  try {
    await castService.stop();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 7. Get Status
router.get("/api/cast/status", (req, res) => {
  res.json(castService.getStatus());
});

// 8. Volume Control
router.post("/api/cast/volume", async (req, res) => {
  try {
    const { volume } = req.body;
    await castService.setVolume(parseFloat(volume) || 50);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// 9. LAN Media Stream Proxy: Handles both local files and remote scraper streams
router.get("/api/cast/stream", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Accept-Ranges", "bytes");

  const localPath = req.query.path;
  const remoteUrl = req.query.url;

  // Case A: Local downloaded video file
  if (localPath) {
    try {
      const decodedPath = decodeURIComponent(localPath);
      if (!fs.existsSync(decodedPath)) {
        return res.status(404).send("File not found");
      }

      const stat = fs.statSync(decodedPath);
      const fileSize = stat.size;
      const mime = getMimeType(decodedPath);
      const range = req.headers.range;

      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (start >= fileSize || end >= fileSize) {
          res.status(416).send("Requested range not satisfiable");
          return;
        }

        const chunkSize = end - start + 1;
        const fileStream = fs.createReadStream(decodedPath, { start, end });

        res.writeHead(206, {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": mime,
        });

        if (req.method === "HEAD") return res.end();
        return fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": mime,
          "Accept-Ranges": "bytes",
        });

        if (req.method === "HEAD") return res.end();
        return fs.createReadStream(decodedPath).pipe(res);
      }
    } catch (e) {
      logger.error(`[cast] Local stream error: ${e.message}`);
      return res.status(500).send("Error reading local video file");
    }
  }

  // Case B: Remote online stream with custom headers
  if (remoteUrl) {
    let customHeaders = {};
    if (req.query.headers) {
      try {
        customHeaders = JSON.parse(req.query.headers);
      } catch (_) {}
    }

    const cleanUrl = remoteUrl.split("?")[0].toLowerCase();
    const isHls = cleanUrl.endsWith(".m3u8") || req.query.isM3U8 === "true";

    const localIp = castService.getLocalIpAddress();
    const port = global.PORT || 9545;

    if (isHls) {
      try {
        // Fetch playlist upstream with scraper headers
        const playlistRes = await axios.get(remoteUrl, {
          headers: {
            "User-Agent":
              customHeaders["User-Agent"] ||
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            Referer: customHeaders.Referer || customHeaders.referer || remoteUrl,
            Origin: customHeaders.Origin || customHeaders.origin || new URL(remoteUrl).origin,
            ...customHeaders,
          },
          responseType: "text",
          timeout: 10000,
        });

        let playlistContent = playlistRes.data;

        // Rewrite segment and child playlist URLs inside the HLS manifest
        const baseUrl = remoteUrl;
        const encodedHeaders = encodeURIComponent(JSON.stringify(customHeaders));

        const rewrittenLines = playlistContent.split("\n").map((line) => {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith("#EXT")) {
            // Check for URI in tags like #EXT-X-KEY or #EXT-X-MAP
            if (trimmed.includes('URI="')) {
              return line.replace(/URI="([^"]+)"/, (match, subUri) => {
                const absSubUri = new URL(subUri, baseUrl).toString();
                const proxyUri = `http://${localIp}:${port}/api/cast/segment?url=${encodeURIComponent(absSubUri)}&headers=${encodedHeaders}`;
                return `URI="${proxyUri}"`;
              });
            }
            return line;
          }

          // Video chunk or child playlist line
          try {
            const absoluteChunkUrl = new URL(trimmed, baseUrl).toString();
            return `http://${localIp}:${port}/api/cast/segment?url=${encodeURIComponent(absoluteChunkUrl)}&headers=${encodedHeaders}`;
          } catch (_) {
            return line;
          }
        });

        const rewrittenPlaylist = rewrittenLines.join("\n");
        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        return res.send(rewrittenPlaylist);
      } catch (err) {
        logger.error(`[cast] HLS manifest proxy error for ${remoteUrl}: ${err.message}`);
        return res.status(502).send(`Upstream playlist error: ${err.message}`);
      }
    } else {
      // Direct video file (e.g. .mp4, .ts)
      try {
        const upstreamHeaders = {
          "User-Agent":
            customHeaders["User-Agent"] ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          Referer: customHeaders.Referer || customHeaders.referer || remoteUrl,
          Origin: customHeaders.Origin || customHeaders.origin || new URL(remoteUrl).origin,
          ...customHeaders,
        };

        if (req.headers.range) {
          upstreamHeaders.Range = req.headers.range;
        }

        const upstreamRes = await axios({
          method: req.method === "HEAD" ? "HEAD" : "GET",
          url: remoteUrl,
          headers: upstreamHeaders,
          responseType: "stream",
          timeout: 20000,
          validateStatus: (status) => status >= 200 && status < 400,
        });

        res.status(upstreamRes.status);
        for (const [key, val] of Object.entries(upstreamRes.headers)) {
          if (
            key.toLowerCase() === "content-type" ||
            key.toLowerCase() === "content-length" ||
            key.toLowerCase() === "content-range" ||
            key.toLowerCase() === "accept-ranges"
          ) {
            res.setHeader(key, val);
          }
        }

        if (req.method === "HEAD") return res.end();
        return upstreamRes.data.pipe(res);
      } catch (err) {
        logger.error(`[cast] Direct video proxy error for ${remoteUrl}: ${err.message}`);
        return res.status(502).send(`Upstream video stream error: ${err.message}`);
      }
    }
  }

  return res.status(400).send("No stream source provided");
});

// 10. Segment Proxy for HLS chunks
router.get("/api/cast/segment", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Accept-Ranges", "bytes");

  const segmentUrl = req.query.url;
  if (!segmentUrl) return res.status(400).send("No segment URL provided");

  let customHeaders = {};
  if (req.query.headers) {
    try {
      customHeaders = JSON.parse(req.query.headers);
    } catch (_) {}
  }

  try {
    const upstreamHeaders = {
      "User-Agent":
        customHeaders["User-Agent"] ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      Referer: customHeaders.Referer || customHeaders.referer || segmentUrl,
      Origin: customHeaders.Origin || customHeaders.origin || new URL(segmentUrl).origin,
      ...customHeaders,
    };

    if (req.headers.range) {
      upstreamHeaders.Range = req.headers.range;
    }

    const upstreamRes = await axios({
      method: req.method === "HEAD" ? "HEAD" : "GET",
      url: segmentUrl,
      headers: upstreamHeaders,
      responseType: "stream",
      timeout: 15000,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    res.status(upstreamRes.status);
    for (const [key, val] of Object.entries(upstreamRes.headers)) {
      if (
        key.toLowerCase() === "content-type" ||
        key.toLowerCase() === "content-length" ||
        key.toLowerCase() === "content-range" ||
        key.toLowerCase() === "accept-ranges"
      ) {
        res.setHeader(key, val);
      }
    }

    if (req.method === "HEAD") return res.end();
    return upstreamRes.data.pipe(res);
  } catch (err) {
    return res.status(502).send(`Error fetching segment: ${err.message}`);
  }
});

module.exports = router;
