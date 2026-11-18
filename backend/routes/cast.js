const express = require("express");
const fs = require("fs");
const path = require("path");
const axios = require("axios");

const castService = require("../utils/castService");
const { logger } = require("../utils/AppLogger");
const { isVideoFile, ALLOWED_VIDEO_EXTENSIONS } = require("../utils/constants");
const { isLanguagePreferred, settingfetch } = require("../utils/settings");

const router = express.Router();

function getMimeType(filePathOrUrl) {
  if (!filePathOrUrl || typeof filePathOrUrl !== "string") return "video/mp4";
  const lower = filePathOrUrl.toLowerCase();
  if (lower.includes(".m3u8") || lower.includes("m3u8")) return "application/vnd.apple.mpegurl";
  if (lower.endsWith(".mp4")) return "video/mp4";
  if (lower.endsWith(".mkv")) return "video/x-matroska";
  if (lower.endsWith(".webm")) return "video/webm";
  if (lower.endsWith(".ts")) return "video/mp2t";
  return "video/mp4";
}

function isPlaylistUrl(url) {
  if (!url || typeof url !== "string") return false;
  const lower = url.toLowerCase();
  return lower.includes(".m3u8") || lower.includes("m3u8");
}

function getLanguageCode(lang) {
  if (!lang || typeof lang !== "string") return "en";
  const lower = lang.toLowerCase();
  if (lower.includes("eng")) return "en";
  if (lower.includes("spa")) return "es";
  if (lower.includes("fre") || lower.includes("fra")) return "fr";
  if (lower.includes("ger") || lower.includes("deu")) return "de";
  if (lower.includes("ita")) return "it";
  if (lower.includes("por")) return "pt";
  if (lower.includes("rus")) return "ru";
  if (lower.includes("jap") || lower.includes("jpn")) return "ja";
  if (lower.includes("chi") || lower.includes("zho")) return "zh";
  if (lower.includes("ara")) return "ar";
  if (lower.includes("hin")) return "hi";
  if (lower.includes("kor")) return "ko";
  return "und";
}

function formatAssTime(t) {
  const m = t.match(/^(\d+):(\d{2}):(\d{2})\.(\d{1,3})$/);
  if (!m) return null;
  const hours = m[1].padStart(2, "0");
  const mins = m[2];
  const secs = m[3];
  let ms = m[4];
  if (ms.length === 1) ms = ms + "00";
  else if (ms.length === 2) ms = ms + "0";
  else if (ms.length > 3) ms = ms.slice(0, 3);
  return `${hours}:${mins}:${secs}.${ms}`;
}

function convertAssToVtt(assText) {
  const lines = assText.split("\n");
  let vtt = "WEBVTT\n\n";
  let cueIdx = 1;
  for (const line of lines) {
    if (line.startsWith("Dialogue:")) {
      const parts = line.substring(9).split(",");
      if (parts.length >= 10) {
        const start = formatAssTime(parts[1].trim());
        const end = formatAssTime(parts[2].trim());
        const text = parts
          .slice(9)
          .join(",")
          .replace(/{[^}]+}/g, "")
          .replace(/\\N/gi, "\n")
          .trim();
        if (start && end && text) {
          vtt += `${cueIdx++}\n${start} --> ${end}\n${text}\n\n`;
        }
      }
    }
  }
  return vtt;
}

function convertAssToSrt(assText) {
  const lines = assText.split("\n");
  let srt = "";
  let cueIdx = 1;
  for (const line of lines) {
    if (line.startsWith("Dialogue:")) {
      const parts = line.substring(9).split(",");
      if (parts.length >= 10) {
        const start = formatAssTime(parts[1].trim());
        const end = formatAssTime(parts[2].trim());
        const text = parts
          .slice(9)
          .join(",")
          .replace(/{[^}]+}/g, "")
          .replace(/\\N/gi, "\n")
          .trim();
        if (start && end && text) {
          const srtStart = start.replace(".", ",");
          const srtEnd = end.replace(".", ",");
          srt += `${cueIdx++}\n${srtStart} --> ${srtEnd}\n${text}\n\n`;
        }
      }
    }
  }
  return srt.trim();
}

function convertToVtt(content) {
  if (!content || typeof content !== "string") return "WEBVTT\n\n";
  let clean = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (clean.startsWith("WEBVTT")) {
    return clean;
  }
  if (clean.includes("[Script Info]") || clean.includes("Dialogue:")) {
    return convertAssToVtt(clean);
  }
  clean = clean.replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2");
  return "WEBVTT\n\n" + clean;
}

function convertToSrt(content) {
  if (!content || typeof content !== "string") return "";
  let clean = content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .trim();
  if (clean.includes("[Script Info]") || clean.includes("Dialogue:")) {
    return convertAssToSrt(clean);
  }
  if (clean.startsWith("WEBVTT")) {
    clean = clean.replace(/^WEBVTT[^\n]*\n+/i, "");
    clean = clean.replace(/NOTE[^\n]*\n[^\n]*\n+/g, "");
    clean = clean.replace(/(\d{2}:\d{2}:\d{2})\.(\d{3})/g, "$1,$2");
    return clean.trim();
  }
  return clean;
}

function prepareSubtitlesForCast(rawSubs, preferredLangs = ["English"]) {
  if (!Array.isArray(rawSubs) || rawSubs.length === 0) return [];
  const cleaned = [];
  const seenUrls = new Set();
  const seenLangs = new Set();

  for (const s of rawSubs) {
    if (!s) continue;
    const url = typeof s === "string" ? s : s.url || s.file || "";
    if (!url || seenUrls.has(url)) continue;

    const rawLang = typeof s === "object" ? s.lang || s.label || s.name || "Unknown" : "Unknown";
    const normLang = String(rawLang).trim().toLowerCase();

    // Prevent duplicate tracks from multiple mirror CDNs (e.g. PhantomCDN & RundownCDN)
    if (seenLangs.has(normLang)) continue;

    seenUrls.add(url);
    seenLangs.add(normLang);

    const isExplicitDefault = typeof s === "object" && Boolean(s.default);
    cleaned.push({ url, lang: String(rawLang).trim(), default: isExplicitDefault });

    if (cleaned.length >= 12) break; // Limit to max 12 distinct tracks
  }

  let defaultIdx = cleaned.findIndex((s) => s.default);
  if (defaultIdx < 0 && preferredLangs && preferredLangs.length > 0) {
    // Prefer full dialogue / CC subtitles over signs if available
    defaultIdx = cleaned.findIndex(
      (s) =>
        isLanguagePreferred(s.lang, preferredLangs) &&
        !s.lang.toLowerCase().includes("signs")
    );
    if (defaultIdx < 0) {
      defaultIdx = cleaned.findIndex((s) => isLanguagePreferred(s.lang, preferredLangs));
    }
  }
  if (defaultIdx < 0 && cleaned.length > 0) {
    defaultIdx = 0;
  }

  return cleaned.map((s, idx) => ({
    ...s,
    default: idx === defaultIdx,
  }));
}

// In-memory cache for pre-warmed / rewritten HLS manifests
const manifestCache = new Map();

// In-memory active cast session for the local LAN player / TV
let activeCastStream = {
  mediaUrl: "",
  filePath: "",
  headers: {},
  subtitles: [],
  activeSubtitle: null,
  mimeType: "video/mp4",
  title: "",
  timestamp: 0,
};

function rewriteHlsPlaylist(playlistContent, baseUrl, customHeaders, localIp, port, subtitles = []) {
  const encodedHeaders = encodeURIComponent(JSON.stringify(customHeaders || {}));
  const isMaster =
    playlistContent.includes("#EXT-X-STREAM-INF") ||
    playlistContent.includes("#EXT-X-MEDIA:TYPE");

  // Format and collect subtitle tags
  let subTags = [];
  if (Array.isArray(subtitles) && subtitles.length > 0) {
    const defaultIdx = subtitles.findIndex((s) => s.default === true);
    const chosenDefaultIdx = defaultIdx >= 0 ? defaultIdx : 0;

    subtitles.forEach((sub, idx) => {
      if (!sub || !sub.url) return;
      const rawLang = sub.lang || sub.label || sub.name || `Track ${idx + 1}`;
      const isDef = idx === chosenDefaultIdx ? "YES" : "NO";
      const safeName = String(rawLang).replace(/[",]/g, "");
      const langCode = getLanguageCode(safeName);
      const encodedSubUrl = encodeURIComponent(sub.url);
      const subPlaylistUri = `http://${localIp}:${port}/api/cast/subtitles.m3u8?url=${encodedSubUrl}&headers=${encodedHeaders}&lang=${encodeURIComponent(safeName)}`;

      subTags.push(
        `#EXT-X-MEDIA:TYPE=SUBTITLES,GROUP-ID="subs",NAME="${safeName}",DEFAULT=${isDef},AUTOSELECT=YES,FORCED=NO,LANGUAGE="${langCode}",URI="${subPlaylistUri}"`
      );
    });
  }

  // If this is NOT a master playlist (i.e. single-variant media playlist with #EXTINF chunks),
  // and we have subtitles to attach: wrap it in a clean Master playlist!
  if (!isMaster && subTags.length > 0 && !baseUrl.includes("isChild=1")) {
    const childUrl = `http://${localIp}:${port}/api/cast/stream?url=${encodeURIComponent(baseUrl)}&headers=${encodedHeaders}&isChild=1`;
    return [
      "#EXTM3U",
      "#EXT-X-VERSION:3",
      ...subTags,
      `#EXT-X-STREAM-INF:BANDWIDTH=3500000,RESOLUTION=1920x1080,SUBTITLES="subs"`,
      childUrl,
    ].join("\n");
  }

  const lines = playlistContent.split("\n");
  let nextLineIsStream = false;
  let subTagsInjected = false;
  const resultLines = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      resultLines.push(line);
      continue;
    }

    // Inject subtitle tags before the first stream variant or media tag in master
    if (isMaster && subTags.length > 0 && !subTagsInjected) {
      if (trimmed.startsWith("#EXT-X-STREAM-INF") || trimmed.startsWith("#EXT-X-MEDIA")) {
        resultLines.push(...subTags);
        subTagsInjected = true;
      }
    }

    if (trimmed.startsWith("#EXT")) {
      if (trimmed.startsWith("#EXT-X-STREAM-INF")) {
        nextLineIsStream = true;
        if (subTags.length > 0) {
          if (!trimmed.includes("SUBTITLES=")) {
            resultLines.push(`${line},SUBTITLES="subs"`);
          } else {
            resultLines.push(line.replace(/SUBTITLES="[^"]*"/, 'SUBTITLES="subs"'));
          }
        } else {
          resultLines.push(line);
        }
        continue;
      }

      if (trimmed.includes('URI="')) {
        const replaced = line.replace(/URI="([^"]+)"/, (match, subUri) => {
          try {
            const absSubUri = new URL(subUri, baseUrl).toString();
            const isMediaSub = trimmed.startsWith("#EXT-X-MEDIA");
            const route = isMediaSub || isPlaylistUrl(absSubUri) ? "stream" : "segment";
            const proxyUri = `http://${localIp}:${port}/api/cast/${route}?url=${encodeURIComponent(absSubUri)}&headers=${encodedHeaders}`;
            return `URI="${proxyUri}"`;
          } catch (_) {
            return match;
          }
        });
        resultLines.push(replaced);
        continue;
      }

      resultLines.push(line);
      continue;
    }

    // Non-#EXT lines are URLs:
    try {
      const absoluteUrl = new URL(trimmed, baseUrl).toString();
      const isChildPlaylist = nextLineIsStream || (isMaster && isPlaylistUrl(absoluteUrl));
      nextLineIsStream = false;

      const route = isChildPlaylist ? "stream" : "segment";
      resultLines.push(
        `http://${localIp}:${port}/api/cast/${route}?url=${encodeURIComponent(absoluteUrl)}&headers=${encodedHeaders}`
      );
    } catch (_) {
      nextLineIsStream = false;
      resultLines.push(line);
    }
  }

  // If subTags still haven't been injected:
  if (isMaster && subTags.length > 0 && !subTagsInjected) {
    resultLines.push(...subTags);
  }

  return resultLines.join("\n");
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
    if (!device && req.body.device && (req.body.device.controlUrl || req.body.device.location)) {
      device = req.body.device;
      castService.discoveredDevices.set(device.id || device.location || device.controlUrl, device);
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

    const rawSubtitles = Array.isArray(req.body.subtitles) ? req.body.subtitles : [];
    let prefLangs = ["English"];
    try {
      const config = await settingfetch();
      if (
        Array.isArray(config?.preferredSubtitleLanguages) &&
        config.preferredSubtitleLanguages.length > 0
      ) {
        prefLangs = config.preferredSubtitleLanguages;
      }
    } catch (_) {}

    const subtitles = prepareSubtitlesForCast(rawSubtitles, prefLangs);
    const activeSubtitle = subtitles.find((s) => s.default) || subtitles[0] || null;

    let streamProxyUrl;
    let mimeType = "video/mp4";

    if (filePath) {
      streamProxyUrl = `http://${localIp}:${port}/api/cast/stream.mp4`;
      mimeType = getMimeType(filePath);
    } else if (mediaUrl) {
      // Short, clean stream URL (< 45 chars) without 8KB query bloat that breaks Smart TV microhttpd
      streamProxyUrl = `http://${localIp}:${port}/api/cast/stream.mp4`;
      mimeType = getMimeType(mediaUrl);

      // Pre-warm the HLS master playlist in memory so the TV gets an instant <5ms response
      if (isPlaylistUrl(mediaUrl)) {
        try {
          const upstreamHeaders = {
            "User-Agent":
              headers["User-Agent"] ||
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            Referer: headers.Referer || headers.referer || mediaUrl,
            Origin: headers.Origin || headers.origin || new URL(mediaUrl).origin,
            ...headers,
          };
          const preRes = await axios.get(mediaUrl, {
            headers: upstreamHeaders,
            responseType: "text",
            timeout: 9000,
          });
          if (
            preRes.data &&
            (typeof preRes.data === "string" &&
              (preRes.data.includes("#EXTM3U") || isPlaylistUrl(mediaUrl)))
          ) {
            const rewritten = rewriteHlsPlaylist(
              preRes.data,
              mediaUrl,
              headers,
              localIp,
              port,
              subtitles,
            );
            manifestCache.set(mediaUrl, {
              content: rewritten,
              timestamp: Date.now(),
            });
            manifestCache.set("active", {
              content: rewritten,
              timestamp: Date.now(),
            });
            mimeType = "application/vnd.apple.mpegurl";
          }
        } catch (warmErr) {
          logger.warn(
            `[cast] Stream pre-warm warning for ${mediaUrl}: ${warmErr.message}`,
          );
        }
      }
    } else {
      return res
        .status(400)
        .json({ success: false, error: "Neither url nor filePath provided" });
    }

    activeCastStream = {
      mediaUrl: mediaUrl || "",
      filePath: filePath || "",
      headers: headers || {},
      subtitles,
      activeSubtitle,
      mimeType,
      title,
      timestamp: Date.now(),
    };

    logger.info(`[cast] Starting cast to ${device.name} -> ${streamProxyUrl} (subtitles: ${subtitles.length}, active: ${activeSubtitle?.lang || "none"})`);

    const session = await castService.castToDevice(device, {
      streamUrl: streamProxyUrl,
      title,
      position: parseFloat(position) || 0,
      mimeType,
      poster,
      subtitles,
      activeSubtitle,
      headers,
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
    activeCastStream = {
      mediaUrl: "",
      filePath: "",
      headers: {},
      subtitles: [],
      activeSubtitle: null,
      mimeType: "video/mp4",
      title: "",
      timestamp: 0,
    };
    manifestCache.clear();
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
router.all(["/api/cast/stream", "/api/cast/stream.mp4"], async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Accept-Ranges", "bytes");

  const localIp = castService.getLocalIpAddress();
  const port = global.PORT || 9545;
  const activeSubVttUrl = `http://${localIp}:${port}/api/cast/subtitle/active.vtt`;

  // Always advertise CaptionInfo.sec for Samsung Tizen DLNA caption negotiation
  if (activeCastStream.activeSubtitle) {
    res.setHeader("CaptionInfo.sec", activeSubVttUrl);
  }

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  let localPath = req.query.path;
  let remoteUrl = req.query.url;

  // If no specific url or path passed in query params, resolve from active cast session
  if (!localPath && !remoteUrl) {
    if (activeCastStream.filePath) {
      localPath = activeCastStream.filePath;
    } else if (activeCastStream.mediaUrl) {
      remoteUrl = activeCastStream.mediaUrl;
    }
  }

  // Fast-path for HEAD requests (TV probing before play)
  if (req.method === "HEAD") {
    const isHls =
      remoteUrl &&
      (isPlaylistUrl(remoteUrl) ||
        req.query.isM3U8 === "true" ||
        req.query.isChild === "1");
    res.setHeader(
      "Content-Type",
      isHls ? "application/vnd.apple.mpegurl" : activeCastStream.mimeType || "video/mp4",
    );
    res.setHeader("Accept-Ranges", "bytes");
    return res.status(200).end();
  }

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
    if (manifestCache.has(remoteUrl)) {
      const cached = manifestCache.get(remoteUrl);
      if (Date.now() - cached.timestamp < 300000) {
        res.setHeader(
          "Content-Type",
          "application/vnd.apple.mpegurl; charset=utf-8",
        );
        if (req.method === "HEAD") return res.end();
        return res.send(cached.content);
      }
    } else if (manifestCache.has("active") && remoteUrl === activeCastStream.mediaUrl) {
      const cached = manifestCache.get("active");
      if (Date.now() - cached.timestamp < 300000) {
        res.setHeader(
          "Content-Type",
          "application/vnd.apple.mpegurl; charset=utf-8",
        );
        if (req.method === "HEAD") return res.end();
        return res.send(cached.content);
      }
    }

    let subtitles = [];
    if (req.query.subtitles) {
      try {
        subtitles = JSON.parse(decodeURIComponent(req.query.subtitles));
      } catch (_) {}
    } else if (!req.query.url && activeCastStream.subtitles) {
      subtitles = activeCastStream.subtitles;
    }

    let customHeaders = {};
    if (req.query.headers) {
      try {
        customHeaders = JSON.parse(req.query.headers);
      } catch (_) {}
    } else if (!req.query.url && activeCastStream.headers) {
      customHeaders = activeCastStream.headers;
    }

    const isHls =
      isPlaylistUrl(remoteUrl) ||
      req.query.isM3U8 === "true" ||
      req.query.isChild === "1";

    if (isHls) {
      try {
        const upstreamHeaders = {
          "User-Agent":
            customHeaders["User-Agent"] ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Referer: customHeaders.Referer || customHeaders.referer || remoteUrl,
          Origin: customHeaders.Origin || customHeaders.origin || new URL(remoteUrl).origin,
          ...customHeaders,
        };

        const playlistRes = await axios.get(remoteUrl, {
          headers: upstreamHeaders,
          responseType: "text",
          timeout: 10000,
        });

        const rewrittenPlaylist = rewriteHlsPlaylist(
          playlistRes.data,
          remoteUrl,
          customHeaders,
          localIp,
          port,
          subtitles
        );

        manifestCache.set(remoteUrl, {
          content: rewrittenPlaylist,
          timestamp: Date.now(),
        });

        res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
        if (req.method === "HEAD") return res.end();
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
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
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
          const lk = key.toLowerCase();
          if (
            lk === "content-type" ||
            lk === "content-length" ||
            lk === "content-range" ||
            lk === "accept-ranges"
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

// 10. Segment & Sub-playlist Proxy for HLS chunks and decryption keys
router.all("/api/cast/segment", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Accept-Ranges", "bytes");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const segmentUrl = req.query.url;
  if (!segmentUrl) return res.status(400).send("No segment URL provided");

  let customHeaders = {};
  if (req.query.headers) {
    try {
      customHeaders = JSON.parse(req.query.headers);
    } catch (_) {}
  }

  const localIp = castService.getLocalIpAddress();
  const port = global.PORT || 9545;

  // Case 1: If the requested segment URL is actually a sub-playlist (.m3u8):
  if (manifestCache.has(segmentUrl)) {
    const cached = manifestCache.get(segmentUrl);
    if (Date.now() - cached.timestamp < 300000) {
      res.setHeader(
        "Content-Type",
        "application/vnd.apple.mpegurl; charset=utf-8",
      );
      if (req.method === "HEAD") return res.end();
      return res.send(cached.content);
    }
  }

  if (isPlaylistUrl(segmentUrl)) {
    try {
      const upstreamHeaders = {
        "User-Agent":
          customHeaders["User-Agent"] ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Referer: customHeaders.Referer || customHeaders.referer || segmentUrl,
        Origin: customHeaders.Origin || customHeaders.origin || new URL(segmentUrl).origin,
        ...customHeaders,
      };

      const playlistRes = await axios.get(segmentUrl, {
        headers: upstreamHeaders,
        responseType: "text",
        timeout: 10000,
      });

      const rewritten = rewriteHlsPlaylist(
        playlistRes.data,
        segmentUrl,
        customHeaders,
        localIp,
        port
      );

      manifestCache.set(segmentUrl, {
        content: rewritten,
        timestamp: Date.now(),
      });

      res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
      if (req.method === "HEAD") return res.end();
      return res.send(rewritten);
    } catch (err) {
      logger.error(`[cast] Sub-playlist proxy error for ${segmentUrl}: ${err.message}`);
      return res.status(502).send(`Error fetching sub-playlist: ${err.message}`);
    }
  }

  // Case 2: Binary chunk, AES-128 key, or media segment
  try {
    const upstreamHeaders = {
      "User-Agent":
        customHeaders["User-Agent"] ||
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
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
      const lk = key.toLowerCase();
      if (
        lk === "content-length" ||
        lk === "content-range" ||
        lk === "accept-ranges"
      ) {
        res.setHeader(key, val);
      }
    }

    // Determine correct MIME type for TV media engines
    const lowerSeg = segmentUrl.split("?")[0].toLowerCase();
    if (
      lowerSeg.endsWith(".bin") ||
      lowerSeg.endsWith(".key") ||
      lowerSeg.includes("key.bin")
    ) {
      res.setHeader("Content-Type", "application/octet-stream");
    } else if (
      lowerSeg.endsWith(".mp4") ||
      lowerSeg.endsWith(".m4s") ||
      lowerSeg.endsWith(".fmp4")
    ) {
      res.setHeader("Content-Type", "video/mp4");
    } else if (lowerSeg.endsWith(".vtt")) {
      res.setHeader("Content-Type", "text/vtt");
    } else if (lowerSeg.endsWith(".srt")) {
      res.setHeader("Content-Type", "application/x-subrip");
    } else if (lowerSeg.endsWith(".aac")) {
      res.setHeader("Content-Type", "audio/aac");
    } else {
      // MPEG-TS video chunks or segments disguised with .png/.webp extensions:
      // Always use video/mp2t so TV video player does not treat them as static images
      res.setHeader("Content-Type", "video/mp2t");
    }

    if (req.method === "HEAD") return res.end();
    return upstreamRes.data.pipe(res);
  } catch (err) {
    logger.error(`[cast] Segment fetch error for ${segmentUrl}: ${err.message}`);
    return res.status(502).send(`Error fetching segment: ${err.message}`);
  }
});

// 11. HLS Subtitle Media Playlist Endpoint
router.all("/api/cast/subtitles.m3u8", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") return res.status(200).end();

  const subUrl = req.query.url;
  const rawHeaders = req.query.headers;
  const localIp = castService.getLocalIpAddress();
  const port = global.PORT || 9545;

  if (!subUrl) {
    res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
    return res.send("#EXTM3U\n#EXT-X-ENDLIST\n");
  }

  const encodedUrl = encodeURIComponent(subUrl);
  const encodedHeaders = rawHeaders ? encodeURIComponent(rawHeaders) : "";
  const vttSegmentUrl = `http://${localIp}:${port}/api/cast/subtitle?url=${encodedUrl}${encodedHeaders ? `&headers=${encodedHeaders}` : ""}&format=vtt`;

  const playlist = `#EXTM3U
#EXT-X-TARGETDURATION:10800
#EXT-X-VERSION:3
#EXT-X-MEDIA-SEQUENCE:0
#EXTINF:10800.0,
${vttSegmentUrl}
#EXT-X-ENDLIST
`;

  res.setHeader("Content-Type", "application/vnd.apple.mpegurl; charset=utf-8");
  if (req.method === "HEAD") return res.end();
  return res.send(playlist);
});

// 12. Subtitle Content Endpoint (serving converted WebVTT or SRT)
router.all("/api/cast/subtitle", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") return res.status(200).end();

  const subUrl = req.query.url;
  const format = (req.query.format || "vtt").toLowerCase();
  const rawHeaders = req.query.headers;

  if (!subUrl) {
    return res.status(400).send("Subtitle URL is required");
  }

  let customHeaders = {};
  if (rawHeaders) {
    try {
      customHeaders =
        typeof rawHeaders === "string"
          ? JSON.parse(decodeURIComponent(rawHeaders))
          : rawHeaders;
    } catch (_) {}
  }

  try {
    let subContent = "";

    // 1. Local subtitle file
    if (subUrl.startsWith("/subtitles?file=")) {
      const decodedPath = decodeURIComponent(
        subUrl.replace("/subtitles?file=", ""),
      );
      if (fs.existsSync(decodedPath)) {
        subContent = fs.readFileSync(decodedPath, "utf8");
      }
    } else if (subUrl.startsWith("/") && fs.existsSync(subUrl)) {
      subContent = fs.readFileSync(subUrl, "utf8");
    } else if (subUrl.startsWith("http://") || subUrl.startsWith("https://")) {
      // 2. Remote subtitle URL
      const upstreamHeaders = {
        "User-Agent":
          customHeaders["User-Agent"] ||
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
        Referer: customHeaders.Referer || customHeaders.referer || subUrl,
        ...customHeaders,
      };

      const resp = await axios.get(subUrl, {
        headers: upstreamHeaders,
        responseType: "text",
        timeout: 8000,
      });
      subContent = resp.data || "";
    }

    if (!subContent || typeof subContent !== "string") {
      return res.status(404).send("Subtitle file not found or empty");
    }

    if (format === "srt") {
      const srt = convertToSrt(subContent);
      res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
      if (req.method === "HEAD") return res.end();
      return res.send(srt);
    } else {
      const vtt = convertToVtt(subContent);
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      if (req.method === "HEAD") return res.end();
      return res.send(vtt);
    }
  } catch (err) {
    logger.error(
      `[cast] Failed to fetch/convert subtitle (${subUrl}): ${err.message}`,
    );
    res.status(500).send("Failed to process subtitle");
  }
});

// 13. Active Preferred Subtitle Endpoint for DLNA / Samsung Smart TV
router.all(
  ["/api/cast/subtitle/active.vtt", "/api/cast/subtitle/active.srt"],
  async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "*");

    if (req.method === "OPTIONS") return res.status(200).end();

    const isSrt = req.path.endsWith(".srt") || req.query.format === "srt";
    const activeSub = activeCastStream.activeSubtitle;

    if (!activeSub || !activeSub.url) {
      if (isSrt) {
        res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
        return res.send("");
      }
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      return res.send("WEBVTT\n\n");
    }

    try {
      const subUrl = activeSub.url;
      let subContent = "";

      if (subUrl.startsWith("/subtitles?file=")) {
        const decodedPath = decodeURIComponent(
          subUrl.replace("/subtitles?file=", ""),
        );
        if (fs.existsSync(decodedPath)) {
          subContent = fs.readFileSync(decodedPath, "utf8");
        }
      } else if (subUrl.startsWith("/") && fs.existsSync(subUrl)) {
        subContent = fs.readFileSync(subUrl, "utf8");
      } else if (subUrl.startsWith("http://") || subUrl.startsWith("https://")) {
        const customHeaders = activeCastStream.headers || {};
        const upstreamHeaders = {
          "User-Agent":
            customHeaders["User-Agent"] ||
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
          Referer: customHeaders.Referer || customHeaders.referer || subUrl,
          ...customHeaders,
        };

        const resp = await axios.get(subUrl, {
          headers: upstreamHeaders,
          responseType: "text",
          timeout: 9000,
        });
        subContent = resp.data || "";
      }

      if (isSrt) {
        const srt = convertToSrt(subContent);
        res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
        if (req.method === "HEAD") return res.end();
        return res.send(srt);
      } else {
        const vtt = convertToVtt(subContent);
        res.setHeader("Content-Type", "text/vtt; charset=utf-8");
        if (req.method === "HEAD") return res.end();
        return res.send(vtt);
      }
    } catch (err) {
      logger.error(
        `[cast] Failed to fetch active subtitle (${activeSub.url}): ${err.message}`,
      );
      if (isSrt) {
        res.setHeader("Content-Type", "application/x-subrip; charset=utf-8");
        return res.send("");
      }
      res.setHeader("Content-Type", "text/vtt; charset=utf-8");
      return res.send("WEBVTT\n\n");
    }
  },
);

module.exports = router;
module.exports.activeCastStream = activeCastStream;
module.exports.rewriteHlsPlaylist = rewriteHlsPlaylist;
module.exports.isPlaylistUrl = isPlaylistUrl;
module.exports.getMimeType = getMimeType;
module.exports.convertToVtt = convertToVtt;
module.exports.convertToSrt = convertToSrt;
module.exports.convertAssToSrt = convertAssToSrt;
module.exports.convertAssToVtt = convertAssToVtt;
module.exports.prepareSubtitlesForCast = prepareSubtitlesForCast;
module.exports.getLanguageCode = getLanguageCode;
