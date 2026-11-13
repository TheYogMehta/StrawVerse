const { spawn } = require("child_process");
const http = require("http");
const https = require("https");
const { logger } = require("./AppLogger");

const keepAliveAgent = {
  http: new http.Agent({
    keepAlive: true,
    maxSockets: 128,
    keepAliveMsecs: 30000,
  }),
  https: new https.Agent({
    keepAlive: true,
    maxSockets: 128,
    keepAliveMsecs: 30000,
  }),
};
const iso6391 = require("iso-639-1");
const path = require("path");
const got = require("got").default || require("got");
const fs = require("fs");
const stream = require("stream");
const { promisify } = require("util");
const crypto = require("crypto");
const { getHeaders } = require("./proxyHeaders");
const { isLanguagePreferred, settingfetch } = require("./settings");
const {
  extractDomain,
  getDomainConcurrency,
  getInitialDomainConcurrency,
  recordDomainBatchSuccess,
  isCircuitOpen,
  waitForCircuit,
  setDomainErrorCap,
} = require("./domainConcurrency");

let mergeLockQueue = Promise.resolve();

async function acquireMergeLock() {
  let release;
  const nextLock = new Promise((resolve) => {
    release = resolve;
  });
  const currentLock = mergeLockQueue;
  mergeLockQueue = mergeLockQueue.then(() => nextLock);
  await currentLock;
  return release;
}

const pipeline = promisify(stream.pipeline);

let resolvedFfmpegPath = null;

function resolveUrl(relativeUrl, baseUrl) {
  if (!relativeUrl) return relativeUrl;
  try {
    const baseObj = new URL(baseUrl);
    const resolvedObj = new URL(relativeUrl, baseUrl);

    if (!resolvedObj.search && baseObj.search) {
      resolvedObj.search = baseObj.search;
    }
    return resolvedObj.href;
  } catch (e) {
    return relativeUrl;
  }
}

function stripPngHeader(buffer) {
  if (!buffer || buffer.length <= 376) return buffer;

  if (
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    // MPEG-TS packets are 188 bytes starting with sync byte 0x47: slice from
    // the first offset with 3 consecutive syncs. Handles wrappers of any size;
    // untouched when no sync pattern is found.
    const maxScan = Math.min(buffer.length - 376, 65536);
    for (let i = 0; i <= maxScan; i++) {
      if (
        buffer[i] === 0x47 &&
        buffer[i + 188] === 0x47 &&
        buffer[i + 376] === 0x47
      ) {
        return i === 0 ? buffer : buffer.subarray(i);
      }
    }
  }
  return buffer;
}

async function getFfmpegPath() {
  if (resolvedFfmpegPath && fs.existsSync(resolvedFfmpegPath)) {
    return resolvedFfmpegPath;
  }

  if (process.env.NODEJS_MOBILE_DATA_DIR || process.env.NATIVE_LIB_DIR) {
    const candidateNativeDirs = [];

    if (process.env.NATIVE_LIB_DIR) {
      candidateNativeDirs.push(process.env.NATIVE_LIB_DIR);
    }

    // nodejs-mobile/capacitor-nodejs often places the node binary next to
    // the extracted native libs — cheap and frequently correct.
    try {
      if (process.execPath) {
        candidateNativeDirs.push(path.dirname(process.execPath));
      }
    } catch (_) {}

    // Collect every mapped .so directory plus any strawverse path: on modern
    // Android the libs live under split-APK mounts whose shape varies, so
    // match liberally instead of assuming /data/app/<pkg>/lib/<arch>.
    let mapsSoDirs = 0;
    try {
      const maps = fs.readFileSync("/proc/self/maps", "utf-8");
      for (const line of maps.split("\n")) {
        const soMatch = line.match(/(\/[^\s]+\.so(?:\.\d+)*)\s*$/);
        if (soMatch && soMatch[1]) {
          candidateNativeDirs.push(path.dirname(soMatch[1]));
          mapsSoDirs++;
        }
        if (line.includes("strawverse")) {
          const pathMatch = line.match(/(\/data\/[^\s]+)/);
          if (pathMatch && pathMatch[1]) {
            candidateNativeDirs.push(path.dirname(pathMatch[1]));
          }
        }
      }
    } catch (e) {
      logger.warn(`[FFmpeg] Could not read /proc/self/maps: ${e.message}`);
    }

    candidateNativeDirs.push("/data/data/app.strawverse.android/lib");
    candidateNativeDirs.push("/data/user/0/app.strawverse.android/lib");

    const userDataDir = process.env.NODEJS_MOBILE_DATA_DIR || process.cwd();
    candidateNativeDirs.push(path.join(userDataDir, "bin"));

    const foundIn = (dir) => {
      try {
        const direct = path.join(dir, "libffmpeg.so");
        if (fs.existsSync(direct)) return direct;
        // One-level arch-subdir scan (e.g. <lib>/arm64/libffmpeg.so).
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const nested = path.join(dir, entry.name, "libffmpeg.so");
          if (fs.existsSync(nested)) return nested;
        }
      } catch (_) {}
      return null;
    };

    const seen = new Set();
    const tried = [];
    for (const dir of candidateNativeDirs) {
      if (!dir || seen.has(dir)) continue;
      seen.add(dir);
      tried.push(dir);
      const hit = foundIn(dir);
      if (hit) {
        logger.info(`FFmpeg binary found in native library directory: ${hit}`);
        resolvedFfmpegPath = hit;
        return resolvedFfmpegPath;
      }
    }

    logger.warn(
      `[FFmpeg] libffmpeg.so not found. Tried ${tried.length} dir(s)` +
        ` (maps .so dirs: ${mapsSoDirs}, execPath: ${process.execPath || "n/a"}): ` +
        tried.slice(0, 12).join(" | "),
    );
    throw new Error(
      "FFmpeg binary (libffmpeg.so) not found in APK. " +
        "Rebuild the app with 'node capacitor/scripts/fetch-ffmpeg.mjs' " +
        "to bundle FFmpeg, then reinstall.",
    );
  }

  // Desktop (Electron / Node.js)
  const binaryName = process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const platformDir =
    process.platform === "win32"
      ? "win32"
      : process.platform === "darwin"
        ? "darwin"
        : "linux";
  const candidatePaths = [];

  const resourceRoots = [];
  if (process.resourcesPath) {
    resourceRoots.push(path.join(process.resourcesPath, "app.asar.unpacked"));
  }
  try {
    let electronApp = null;
    try {
      electronApp = require("electron").app;
    } catch (e) {}
    if (electronApp && typeof electronApp.getAppPath === "function") {
      const dir = path.dirname(electronApp.getAppPath());
      if (dir) resourceRoots.push(path.join(dir, "app.asar.unpacked"));
    }
  } catch (e) {}

  for (const root of resourceRoots) {
    candidatePaths.push(path.join(root, "ffmpeg", platformDir, binaryName));
  }
  candidatePaths.push(
    path.join(
      __dirname,
      "..",
      "..",
      "electron",
      "ffmpeg",
      platformDir,
      binaryName,
    ),
  );
  candidatePaths.push(
    path.join(__dirname, "..", "..", "ffmpeg", platformDir, binaryName),
  );

  if (process.platform === "linux") {
    candidatePaths.push("/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  } else if (process.platform === "darwin") {
    candidatePaths.push("/opt/homebrew/bin/ffmpeg", "/usr/local/bin/ffmpeg");
  }

  let ffmpegStatic = null;
  try {
    ffmpegStatic = require("ffmpeg-static");
  } catch (e) {}
  if (typeof ffmpegStatic === "string" && ffmpegStatic) {
    candidatePaths.push(ffmpegStatic.replace("app.asar", "app.asar.unpacked"));
  }
  for (const root of resourceRoots) {
    candidatePaths.push(
      path.join(root, "node_modules", "ffmpeg-static", binaryName),
    );
  }
  if (typeof ffmpegStatic === "string" && ffmpegStatic) {
    candidatePaths.push(ffmpegStatic);
  }

  for (const p of candidatePaths) {
    if (p && fs.existsSync(p)) {
      resolvedFfmpegPath = p;
      logger.info(
        `[FFmpeg] Resolved FFmpeg binary path: ${resolvedFfmpegPath}`,
      );
      return resolvedFfmpegPath;
    }
  }

  return binaryName;
}

// Tracks CDN-clearance refreshes so parallel segment workers share one
// solver run instead of stampeding it. Successes are reused for 60s;
// failures are negatively cached for 15s so segments fail fast and the
// queue can rotate to another server instead of grinding stale headers.
const clearanceRefresh = { successAt: 0, failAt: 0, pending: null };

// Segment CDN hosts (e.g. cdnx.aniwatchtv.site) only serve media bytes and
// answer the bypass probe with a non-challenge error page. Refresh against
// the site root that actually issues clearance instead.
function resolveClearanceTarget(targetUrl) {
  const raw = String(targetUrl || "");
  if (/owocdn|uwucdn|kwik/i.test(raw)) return "https://kwik.cx/";
  try {
    const u = new URL(raw);
    const host = u.hostname.toLowerCase();
    if (
      host === "aniwatchtv.site" ||
      host.endsWith(".aniwatchtv.site") ||
      /megaplay|megacloud|vidplay|vidstream/.test(host)
    ) {
      return "https://aniwatchtv.site/";
    }
    return `${u.origin}/`;
  } catch (_) {
    return targetUrl;
  }
}

async function refreshCdnClearance(targetUrl, referer = null) {
  try {
    if (typeof global.cloudflarebypass !== "function") return false;
    const now = Date.now();
    if (now - clearanceRefresh.successAt < 60000) return true;
    if (now - clearanceRefresh.failAt < 15000) return false;
    if (!clearanceRefresh.pending) {
      const target = resolveClearanceTarget(targetUrl);
      clearanceRefresh.pending = global
        .cloudflarebypass(target, true, referer || null)
        .then((ok) => {
          if (ok === false) {
            clearanceRefresh.failAt = Date.now();
            return false;
          }
          clearanceRefresh.successAt = Date.now();
          return true;
        })
        .catch((err) => {
          logger.warn(
            `[Downloader] Clearance bypass failed for ${target}: ${err?.message || err}`,
          );
          clearanceRefresh.failAt = Date.now();
          return false;
        })
        .finally(() => {
          clearanceRefresh.pending = null;
        });
    }
    return await clearanceRefresh.pending;
  } catch (_) {
    return false;
  }
}

class downloader {
  constructor({
    directory,
    streamUrl,
    Epnum = NaN,
    caption,
    EpID = NaN,
    subtitles = [],
    MergeSubtitles = false,
    ChangeTosrt = false,
    headers = {},
    quality = null,
    isM3U8 = true,
    fileBase = null,
  }) {
    this.directory = directory;
    this.fileBase = fileBase;
    this.quality = quality;
    if (streamUrl?.url) {
      this.streamUrl = streamUrl.url;
      this.headers = streamUrl.headers ?? headers;
      this.isM3U8 = streamUrl.isM3U8 ?? isM3U8;
    } else {
      this.streamUrl = streamUrl;
      this.headers = headers ?? {};
      this.isM3U8 = isM3U8;
    }

    try {
      const ref = this.headers?.Referer || this.headers?.referer;
      if (ref && global.setDynamicReferer && this.streamUrl) {
        global.setDynamicReferer(new URL(this.streamUrl).hostname, ref);
      }
    } catch (_) {}

    this.Epnum = parseInt(Epnum);
    this.caption = caption;
    this.EpID = EpID;
    this.subtitles =
      subtitles?.length > 0
        ? (subtitles?.filter(({ lang }) => lang !== "Thumbnails") ?? [])
        : [];
    this.MergeSubtitles = MergeSubtitles ?? false;
    this.ChangeTosrt = ChangeTosrt ?? false;
    this.downloadedPaths = [];
  }

  async getMediaRequestHeaders(url) {
    const headers = getHeaders(url);
    const ref = this.headers?.Referer || this.headers?.referer;
    if (ref) headers.Referer = ref;
    if (this.headers && typeof this.headers === "object") {
      for (const [k, v] of Object.entries(this.headers)) {
        const kl = k.toLowerCase();
        if (
          kl === "referer" ||
          kl === "cookie" ||
          kl.startsWith("sec-") ||
          kl === "host" ||
          kl === "origin"
        ) {
          continue;
        }
        headers[k] = v;
      }
    }
    return headers;
  }

  async getRequestHeaders(url) {
    return this.getMediaRequestHeaders(url);
  }

  // Server-set cookies (e.g. CDN session cookies issued with the
  // playlist) must travel with segment/key requests, otherwise hosts
  // that gate segments on them answer every segment with 403.
  // Same recovery the local stream proxy uses: on 403/503 refresh CDN
  // clearance once, then retry a single time with fresh headers/cookies.
  // The request thunk re-resolves headers on every attempt.
  async fetchWithClearanceRetry(targetUrl, requestThunk) {
    try {
      return await requestThunk();
    } catch (err) {
      const status = err?.response?.statusCode ?? err?.response?.status;
      const isCfOrNetErr =
        status === 403 ||
        status === 503 ||
        status === 530 ||
        (err?.message && String(err.message).includes("net::ERR_"));
      if (
        isCfOrNetErr &&
        (await refreshCdnClearance(
          targetUrl,
          this.headers?.Referer || this.headers?.referer,
        ))
      ) {
        return await requestThunk();
      }
      throw err;
    }
  }

  async fetchMediaBytes(url, timeoutMs = 60000) {
    const client = global.axios || require("axios");
    const res = await client.get(url, {
      headers: await this.getMediaRequestHeaders(url),
      responseType: "arraybuffer",
      timeout: timeoutMs,
    });
    this.absorbResponseCookies(res?.headers);
    const data = res?.data;
    if (!data || data.length === 0) {
      throw new Error("Received empty segment payload");
    }
    return Buffer.isBuffer(data) ? data : Buffer.from(data);
  }

  async fetchMediaText(url, timeoutMs = 30000) {
    const client = global.axios || require("axios");
    const headers = await this.getMediaRequestHeaders(url);
    const res = await client.get(url, {
      headers,
      responseType: "text",
      timeout: timeoutMs,
    });
    this.absorbResponseCookies(res?.headers);
    const data = res?.data;
    return typeof data === "string" ? data : String(data || "");
  }

  absorbResponseCookies(headers) {
    try {
      let setCookies = headers?.["set-cookie"];
      if (!setCookies) return;
      if (!Array.isArray(setCookies)) {
        setCookies = [setCookies];
      }
      if (setCookies.length === 0) return;
      if (!this.headers) this.headers = {};
      const merged = new Map();
      const existing = this.headers?.Cookie || this.headers?.cookie || "";
      for (const part of String(existing).split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const sep = trimmed.indexOf("=");
        merged.set(sep === -1 ? trimmed : trimmed.slice(0, sep), trimmed);
      }
      for (const c of setCookies) {
        const pair = String(c).split(";")[0].trim();
        if (!pair) continue;
        const sep = pair.indexOf("=");
        merged.set(sep === -1 ? pair : pair.slice(0, sep), pair);
      }
      if (merged.size > 0) {
        delete this.headers.cookie;
        this.headers["Cookie"] = [...merged.values()].join("; ");
      }
    } catch (_) {}
  }

  // Additional Checks
  async DownloadsChecking() {
    if (
      !this.directory ||
      !(await this.CheckFileFolderExists(this.directory))
    ) {
      throw new Error("Directory Not Found!");
    }

    if (!this.Epnum) {
      throw new Error("No Episode Number Found!");
    }

    if (!this.EpID || this.EpID.length <= 0) {
      throw new Error("No Ep id found!");
    }

    const base = this.fileBase || `${this.Epnum}Ep`;
    this.mp4 = path.join(this.directory, `${base}.mp4`);
    this.SegmentsFile = path.join(this.directory, `${base}.ts`);

    if (!this.streamUrl || this.streamUrl.length <= 0) {
      throw new Error("No Stream Url Provided");
    } else {
      const isKnownDirectVideo =
        this.isM3U8 === false ||
        Boolean(
          this.streamUrl.split("?")[0].match(/\.(mp4|mkv|webm|mov|avi)$/i),
        );

      if (isKnownDirectVideo) {
        this.isDirectVideo = true;
        this.totalSegments = 1;
        this.currentSegments = 0;
        if (this.subtitles && this.subtitles.length > 0) {
          this.totalSegments += this.subtitles.length;
        }
        this.logProgress("Starting direct video download...");
        return;
      }

      let Playlist;
      try {
        Playlist = await this.fetchWithClearanceRetry(this.streamUrl, () =>
          this.fetchMediaText(this.streamUrl, 30000),
        );
      } catch (err) {
        try {
          const masterRes = await got(this.streamUrl, {
            headers: await this.getMediaRequestHeaders(this.streamUrl),
            http2: false,
            timeout: { request: 30000 },
          });
          this.absorbResponseCookies(masterRes.headers);
          Playlist = masterRes.body;
        } catch (_) {
          throw err;
        }
      }

      if (!Playlist) throw new Error("No Stream Found!");

      // Detect direct video files (MP4, MKV, etc.) that are not HLS playlists
      if (
        !Playlist.includes("#EXTM3U") ||
        (this.streamUrl.toLowerCase().includes(".mp4") &&
          !Playlist.includes("#EXTINF"))
      ) {
        this.isDirectVideo = true;
        this.totalSegments = 1;
        this.currentSegments = 0;
        if (this.subtitles && this.subtitles.length > 0) {
          this.totalSegments += this.subtitles.length;
        }
        this.logProgress("Starting direct video download...");
        return;
      }

      // Resolve master playlist to media playlist if applicable
      if (Playlist.includes("#EXT-X-STREAM-INF")) {
        if (!this.subtitles || this.subtitles.length === 0) {
          try {
            const mediaLines = Playlist.split("\n").filter((l) =>
              l.includes("#EXT-X-MEDIA:TYPE=SUBTITLES"),
            );
            const currentSettings = (await settingfetch()) || {};
            const preferredLangs =
              currentSettings?.preferredSubtitleLanguages || ["English"];

            for (const mLine of mediaLines) {
              const uriMatch =
                mLine.match(/URI="([^"]+)"/i) || mLine.match(/URI=([^,\s]+)/i);
              if (uriMatch) {
                const subUri = resolveUrl(uriMatch[1], this.streamUrl);
                const nameMatch =
                  mLine.match(/NAME="([^"]+)"/i) ||
                  mLine.match(/LANGUAGE="([^"]+)"/i);
                const subLang = nameMatch ? nameMatch[1] : "English";
                if (isLanguagePreferred(subLang, preferredLangs)) {
                  if (!this.subtitles) this.subtitles = [];
                  this.subtitles.push({ url: subUri, lang: subLang });
                }
              }
            }
          } catch (e) {}
        }
        const lines = Playlist.split("\n").map((line) => line.trim());
        const streams = [];
        let currentInfo = null;

        for (const line of lines) {
          if (line.startsWith("#EXT-X-STREAM-INF:")) {
            currentInfo = line;
          } else if (line && !line.startsWith("#")) {
            try {
              const absoluteUrl = resolveUrl(line, this.streamUrl);
              let resolution = "";
              let bandwidth = 0;

              if (currentInfo) {
                const resMatch = currentInfo.match(/RESOLUTION=(\d+x\d+)/i);
                if (resMatch) resolution = resMatch[1];
                const bwMatch = currentInfo.match(/BANDWIDTH=(\d+)/i);
                if (bwMatch) bandwidth = parseInt(bwMatch[1]);
              }

              streams.push({ url: absoluteUrl, resolution, bandwidth });
            } catch (e) {}
            currentInfo = null;
          }
        }

        if (streams.length > 0) {
          streams.forEach((s) => {
            const parts = s.resolution.split("x");
            s.height = parts.length === 2 ? parseInt(parts[1]) : 0;
          });

          let selectedStream = null;
          if (this.quality) {
            const targetHeight = parseInt(this.quality);
            if (!isNaN(targetHeight)) {
              selectedStream = streams.find((s) => s.height === targetHeight);
            }
          }

          if (!selectedStream) {
            streams.sort(
              (a, b) => b.height - a.height || b.bandwidth - a.bandwidth,
            );
            selectedStream = streams[0];
          }

          this.streamUrl = selectedStream.url;
          try {
            const ref = this.headers?.Referer || this.headers?.referer;
            if (ref && global.setDynamicReferer && this.streamUrl) {
              global.setDynamicReferer(new URL(this.streamUrl).hostname, ref);
            }
          } catch (_) {}
          try {
            Playlist = await this.fetchWithClearanceRetry(this.streamUrl, () =>
              this.fetchMediaText(this.streamUrl, 30000),
            );
          } catch (err) {
            try {
              const mediaRes = await got(this.streamUrl, {
                headers: await this.getMediaRequestHeaders(this.streamUrl),
                http2: false,
                timeout: { request: 30000 },
              });
              this.absorbResponseCookies(mediaRes.headers);
              Playlist = mediaRes.body;
            } catch (_) {
              throw err;
            }
          }

          if (!Playlist)
            throw new Error("No Stream Found for selected quality!");
        }
      }

      let Segments = [];
      const lines = Playlist.split("\n").map((line) => line.trim());
      let currentKeyUrl = null;
      let currentIv = null;
      let mediaSequence = 1;

      const mediaSeqLine = lines.find((l) =>
        l.trim().startsWith("#EXT-X-MEDIA-SEQUENCE:"),
      );
      if (mediaSeqLine) {
        const seqMatch = mediaSeqLine.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
        if (seqMatch) {
          mediaSequence = parseInt(seqMatch[1], 10);
        }
      }

      let segmentCount = 0;

      for (const line of lines) {
        if (!line) continue;

        if (line.startsWith("#")) {
          if (line.startsWith("#EXT-X-KEY:")) {
            const params = {};
            const attrString = line.substring("#EXT-X-KEY:".length);
            const regex = /([A-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g;
            let match;
            while ((match = regex.exec(attrString)) !== null) {
              const key = match[1];
              const value = match[2] !== undefined ? match[2] : match[3];
              params[key] = value;
            }

            const method = (params.METHOD || "").toUpperCase();
            if (method === "AES-128") {
              let rawUri = params.URI;
              let absoluteKeyUri = rawUri;
              if (
                rawUri &&
                !rawUri.startsWith("http://") &&
                !rawUri.startsWith("https://")
              ) {
                absoluteKeyUri = resolveUrl(rawUri, this.streamUrl);
              }
              currentKeyUrl = absoluteKeyUri || null;
              currentIv = params.IV || null;
            } else {
              currentKeyUrl = null;
              currentIv = null;
            }
          }
          continue;
        }

        // It's a segment or playlist URL
        let absoluteUrl = line;
        if (!line.startsWith("http://") && !line.startsWith("https://")) {
          absoluteUrl = resolveUrl(line, this.streamUrl);
        }

        if (currentKeyUrl) {
          const segIv = currentIv || String(mediaSequence + segmentCount);
          segmentCount++;
          Segments.push({
            url: absoluteUrl,
            keyUrl: currentKeyUrl,
            iv: segIv,
            encrypted: true,
          });
        } else {
          Segments.push({ url: absoluteUrl, encrypted: false });
        }
      }

      if (Segments.length <= 0) throw new Error("No Segments Found!");

      this.Segments = Segments;
      this.totalSegments = Segments.length;
      this.currentSegments = 0;

      if (this.subtitles && this.subtitles.length > 0) {
        this.totalSegments += this.subtitles.length;
      }

      this.logProgress();
    }
  }

  async CheckFileFolderExists(FileDir) {
    if (!FileDir) return false;
    try {
      await fs.promises.access(FileDir);
      return true;
    } catch (err) {
      return false;
    }
  }

  async fetchDirectVideoRange(
    targetUrl,
    rangeHeader = null,
    timeoutMs = 60000,
  ) {
    const u = new URL(targetUrl);
    const isHttps = u.protocol === "https:";
    const transport = isHttps ? https : http;
    const agent = isHttps ? keepAliveAgent.https : keepAliveAgent.http;

    const baseHeaders = await this.getMediaRequestHeaders(targetUrl);
    const headers = {
      Host: u.hostname,
      Accept: "*/*",
      ...baseHeaders,
    };
    if (rangeHeader) {
      headers.Range = rangeHeader;
    }
    const ua =
      this.headers?.["User-Agent"] ||
      this.headers?.["user-agent"] ||
      headers["User-Agent"] ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    headers["User-Agent"] = ua;

    return new Promise((resolve, reject) => {
      let isAborted = false;
      const req = transport.request(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: "GET",
          headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          this.absorbResponseCookies(res.headers);
          const statusCode = res.statusCode;
          const statusText = res.statusMessage;

          // Follow redirect if 301/302/303/307/308
          if (
            (statusCode === 301 ||
              statusCode === 302 ||
              statusCode === 303 ||
              statusCode === 307 ||
              statusCode === 308) &&
            res.headers.location
          ) {
            const redirectUrl = resolveUrl(res.headers.location, targetUrl);
            res.resume();
            return resolve(
              this.fetchDirectVideoRange(redirectUrl, rangeHeader, timeoutMs),
            );
          }

          if (statusCode >= 400) {
            const err = new Error(
              `Request failed with status code ${statusCode}`,
            );
            err.statusCode = statusCode;
            err.response = {
              status: statusCode,
              statusText,
              headers: res.headers,
            };
            res.resume();
            return reject(err);
          }

          const chunks = [];
          res.on("data", (chunk) => {
            if (
              (global.isQueuePaused && global.isQueuePaused()) ||
              (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
            ) {
              isAborted = true;
              req.destroy(
                new Error(
                  global.isQueuePaused && global.isQueuePaused()
                    ? "Queue Paused"
                    : "Episode Cancelled",
                ),
              );
              return;
            }
            chunks.push(chunk);
          });
          res.on("end", () => {
            if (isAborted) return;
            resolve({
              status: statusCode,
              headers: res.headers,
              data: Buffer.concat(chunks),
            });
          });
          res.on("error", (err) => {
            reject(err);
          });
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error(`Timeout of ${timeoutMs}ms exceeded`));
      });
      req.on("error", (err) => {
        reject(err);
      });
      req.end();
    });
  }

  async fetchDirectVideoStream(targetUrl, timeoutMs = 120000) {
    const u = new URL(targetUrl);
    const isHttps = u.protocol === "https:";
    const transport = isHttps ? https : http;
    const agent = isHttps ? keepAliveAgent.https : keepAliveAgent.http;

    const baseHeaders = await this.getMediaRequestHeaders(targetUrl);
    const headers = {
      Host: u.hostname,
      Accept: "*/*",
      ...baseHeaders,
    };
    const ua =
      this.headers?.["User-Agent"] ||
      this.headers?.["user-agent"] ||
      headers["User-Agent"] ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    headers["User-Agent"] = ua;

    return new Promise((resolve, reject) => {
      const req = transport.request(
        {
          hostname: u.hostname,
          port: u.port || (isHttps ? 443 : 80),
          path: u.pathname + u.search,
          method: "GET",
          headers,
          agent,
          timeout: timeoutMs,
        },
        (res) => {
          this.absorbResponseCookies(res.headers);
          const statusCode = res.statusCode;

          if (
            (statusCode === 301 ||
              statusCode === 302 ||
              statusCode === 303 ||
              statusCode === 307 ||
              statusCode === 308) &&
            res.headers.location
          ) {
            const redirectUrl = resolveUrl(res.headers.location, targetUrl);
            res.resume();
            return resolve(this.fetchDirectVideoStream(redirectUrl, timeoutMs));
          }

          if (statusCode >= 400) {
            const err = new Error(
              `Request failed with status code ${statusCode}`,
            );
            err.statusCode = statusCode;
            err.response = {
              status: statusCode,
              headers: res.headers,
            };
            res.resume();
            return reject(err);
          }

          resolve({
            status: statusCode,
            headers: res.headers,
            data: res,
          });
        },
      );

      req.on("timeout", () => {
        req.destroy(new Error(`Timeout of ${timeoutMs}ms exceeded`));
      });
      req.on("error", reject);
      req.end();
    });
  }

  async downloadDirectVideoMultiPart(targetFile, tempVideoFile, tempDir) {
    if (
      (global.isQueuePaused && global.isQueuePaused()) ||
      (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
    ) {
      throw new Error(
        global.isQueuePaused && global.isQueuePaused()
          ? "Queue Paused"
          : "Episode Cancelled",
      );
    }

    // Step 1: Probe range support and file size
    this.logProgress("Checking video stream information...");
    let totalBytes = 0;
    let supportsRange = false;

    try {
      const probeRes = await this.fetchWithClearanceRetry(this.streamUrl, () =>
        this.fetchDirectVideoRange(this.streamUrl, "bytes=0-0", 20000),
      );
      this.absorbResponseCookies(probeRes?.headers);

      const contentRange =
        probeRes.headers?.["content-range"] ||
        probeRes.headers?.["Content-Range"];
      if (contentRange) {
        const match = String(contentRange).match(/\/(\d+)$/);
        if (match) {
          totalBytes = parseInt(match[1], 10);
          supportsRange = totalBytes > 0;
        }
      } else if (
        probeRes.headers?.["accept-ranges"] === "bytes" &&
        probeRes.headers?.["content-length"]
      ) {
        const cl = parseInt(probeRes.headers["content-length"], 10);
        if (cl > 0) {
          totalBytes = cl;
          supportsRange = true;
        }
      }
    } catch (probeErr) {
      logger.warn(
        `[Downloader] Range probe failed for direct video: ${probeErr.message}`,
      );
    }

    // Fallback: If range probe did not reveal totalBytes, try HEAD
    if (!supportsRange || !totalBytes) {
      try {
        const client = global.axios || require("axios");
        const headHeaders = await this.getMediaRequestHeaders(this.streamUrl);
        const headRes = await this.fetchWithClearanceRetry(this.streamUrl, () =>
          client.head(this.streamUrl, {
            headers: headHeaders,
            timeout: 15000,
          }),
        );
        this.absorbResponseCookies(headRes?.headers);

        const cl = parseInt(headRes.headers?.["content-length"], 10);
        const cr =
          headRes.headers?.["content-range"] ||
          headRes.headers?.["Content-Range"];
        const ar = headRes.headers?.["accept-ranges"];

        if (cr) {
          const match = String(cr).match(/\/(\d+)$/);
          if (match) {
            totalBytes = parseInt(match[1], 10);
            supportsRange = totalBytes > 0;
          }
        } else if (cl && cl > 0) {
          totalBytes = cl;
          if (ar === "bytes") {
            supportsRange = true;
          }
        }
      } catch (_) {}
    }

    const subCount =
      this.subtitles && this.subtitles.length > 0 ? this.subtitles.length : 0;

    // Case A: Multi-Part Range Download
    if (supportsRange && totalBytes > 0) {
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB per part
      const totalParts = Math.ceil(totalBytes / CHUNK_SIZE);
      this.totalSegments = totalParts + subCount;

      let alreadyDownloadedBytes = 0;
      let completedPartsCount = 0;
      const partsToDownload = [];

      for (let i = 0; i < totalParts; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(totalBytes - 1, (i + 1) * CHUNK_SIZE - 1);
        const expectedSize = end - start + 1;
        const partFile = path.join(tempDir, `${i}.part`);

        let isComplete = false;
        try {
          if (fs.existsSync(partFile)) {
            const stat = fs.statSync(partFile);
            if (stat.size === expectedSize) {
              isComplete = true;
              alreadyDownloadedBytes += expectedSize;
              completedPartsCount++;
            } else {
              fs.unlinkSync(partFile);
            }
          }
        } catch (_) {}

        if (!isComplete) {
          partsToDownload.push({
            index: i,
            start,
            end,
            expectedSize,
            partFile,
          });
        }
      }

      this.downloadedTotalBytes = alreadyDownloadedBytes;
      this.currentSegments = completedPartsCount;

      const domainName = extractDomain(
        this.streamUrl,
        this.headers?.Referer || this.headers?.referer,
      );
      let CONCURRENCY = await getInitialDomainConcurrency(domainName, 6);
      CONCURRENCY = Math.max(2, Math.min(CONCURRENCY, 8));

      logger.info(
        `[Downloader] Starting multi-part direct video download: ${totalParts} parts (~${(totalBytes / 1024 / 1024).toFixed(1)} MB), ${completedPartsCount} cached, concurrency: ${CONCURRENCY}`,
      );
      this.logProgress(null, CONCURRENCY);

      let nextPartIdx = 0;
      let stopDownloading = false;

      const downloadPart = async (part, retryCount = 0) => {
        if (
          stopDownloading ||
          (global.isQueuePaused && global.isQueuePaused()) ||
          (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
        ) {
          stopDownloading = true;
          throw new Error(
            global.isQueuePaused && global.isQueuePaused()
              ? "Queue Paused"
              : "Episode Cancelled",
          );
        }

        const tempPartFile = `${part.partFile}.tmp`;
        try {
          const res = await this.fetchWithClearanceRetry(this.streamUrl, () =>
            this.fetchDirectVideoRange(
              this.streamUrl,
              `bytes=${part.start}-${part.end}`,
              60000,
            ),
          );
          this.absorbResponseCookies(res?.headers);

          const buf = Buffer.isBuffer(res.data)
            ? res.data
            : Buffer.from(res.data);
          if (!buf || buf.length === 0) {
            throw new Error(`Empty payload for part ${part.index}`);
          }
          if (buf.length !== part.expectedSize && part.end !== totalBytes - 1) {
            throw new Error(
              `Size mismatch for part ${part.index}: expected ${part.expectedSize}, got ${buf.length}`,
            );
          }

          await fs.promises.writeFile(tempPartFile, buf);
          await fs.promises.rename(tempPartFile, part.partFile);

          this.downloadedTotalBytes =
            (this.downloadedTotalBytes || 0) + buf.length;
          this.currentSegments++;
          this.logProgress(null, CONCURRENCY);
        } catch (err) {
          await fs.promises.unlink(tempPartFile).catch(() => {});
          if (
            stopDownloading ||
            (global.isQueuePaused && global.isQueuePaused()) ||
            (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
          ) {
            stopDownloading = true;
            throw err;
          }

          const RETRY_DELAYS = [1000, 3000, 5000];
          if (retryCount < RETRY_DELAYS.length) {
            logger.warn(
              `[Downloader] Part ${part.index} failed (${err.message}). Retrying in ${RETRY_DELAYS[retryCount]}ms (attempt ${retryCount + 1}/${RETRY_DELAYS.length})...`,
            );
            await new Promise((r) => setTimeout(r, RETRY_DELAYS[retryCount]));
            return downloadPart(part, retryCount + 1);
          }
          throw new Error(
            `SCRAPER_TEMPORARY_ERROR: Part ${part.index} failed after retries: ${err.message}`,
          );
        }
      };

      const worker = async () => {
        while (nextPartIdx < partsToDownload.length && !stopDownloading) {
          const part = partsToDownload[nextPartIdx++];
          await downloadPart(part);
        }
      };

      const workers = [];
      const workerCount = Math.min(CONCURRENCY, partsToDownload.length || 1);
      for (let w = 0; w < workerCount; w++) {
        workers.push(worker());
      }
      await Promise.all(workers);

      // Concatenating parts sequentially
      this.logProgress("Concatenating parts...");
      if (fs.existsSync(tempVideoFile)) {
        await fs.promises.unlink(tempVideoFile).catch(() => {});
      }

      const writer = fs.createWriteStream(tempVideoFile, { flags: "w" });
      for (let i = 0; i < totalParts; i++) {
        const partFile = path.join(tempDir, `${i}.part`);
        if (!fs.existsSync(partFile)) {
          writer.destroy();
          throw new Error(
            `Missing part file during concatenation: ${partFile}`,
          );
        }
        const readStream = fs.createReadStream(partFile);
        await new Promise((resolve, reject) => {
          readStream.on("error", (err) => {
            writer.destroy();
            reject(err);
          });
          readStream.on("end", resolve);
          readStream.pipe(writer, { end: false });
        });
      }
      writer.end();
      await new Promise((resolve, reject) => {
        writer.on("finish", resolve);
        writer.on("error", reject);
      });

      // Cleanup part files
      for (let i = 0; i < totalParts; i++) {
        const partFile = path.join(tempDir, `${i}.part`);
        await fs.promises.unlink(partFile).catch(() => {});
      }
      await fs.promises.rmdir(tempDir).catch(() => {});

      if (fs.existsSync(targetFile)) {
        await fs.promises.unlink(targetFile).catch(() => {});
      }
      await fs.promises.rename(tempVideoFile, targetFile);
      this.currentSegments = totalParts;
      this.logProgress("Video download complete!");
      return;
    }

    // Case B: Single Stream Download Fallback (when byte ranges not supported)
    this.totalSegments = 1 + subCount;
    this.currentSegments = 0;
    this.logProgress("Downloading video stream...");

    await this.fetchWithClearanceRetry(this.streamUrl, async () => {
      const res = await this.fetchDirectVideoStream(this.streamUrl, 120000);
      this.absorbResponseCookies(res?.headers);

      const totalLength = parseInt(res.headers?.["content-length"], 10) || 0;
      let downloaded = 0;
      const writer = fs.createWriteStream(tempVideoFile);

      await new Promise((resolve, reject) => {
        const checkCancelInterval = setInterval(() => {
          if (
            (global.isQueuePaused && global.isQueuePaused()) ||
            (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
          ) {
            clearInterval(checkCancelInterval);
            try {
              res.data.destroy();
            } catch (_) {}
            try {
              writer.destroy();
            } catch (_) {}
            reject(
              new Error(
                global.isQueuePaused && global.isQueuePaused()
                  ? "Queue Paused"
                  : "Episode Cancelled",
              ),
            );
          }
        }, 1000);

        if (res.data && typeof res.data.on === "function") {
          res.data.on("data", (chunk) => {
            downloaded += chunk.length;
            this.downloadedTotalBytes = downloaded;
            if (totalLength > 0) {
              const pct = Math.floor((downloaded / totalLength) * 100);
              this.logProgress(` (${pct}%)`);
            } else {
              const mb = (downloaded / (1024 * 1024)).toFixed(1);
              this.logProgress(` (${mb} MB)`);
            }
          });
          res.data.pipe(writer);
          writer.on("finish", () => {
            clearInterval(checkCancelInterval);
            resolve();
          });
          writer.on("error", (err) => {
            clearInterval(checkCancelInterval);
            reject(err);
          });
          res.data.on("error", (err) => {
            clearInterval(checkCancelInterval);
            reject(err);
          });
        } else if (
          Buffer.isBuffer(res.data) ||
          res.data instanceof ArrayBuffer
        ) {
          clearInterval(checkCancelInterval);
          const buf = Buffer.isBuffer(res.data)
            ? res.data
            : Buffer.from(res.data);
          fs.writeFileSync(tempVideoFile, buf);
          resolve();
        } else {
          clearInterval(checkCancelInterval);
          reject(new Error("Unexpected response data type for direct video"));
        }
      });
    });

    if (fs.existsSync(targetFile)) {
      await fs.promises.unlink(targetFile).catch(() => {});
    }
    await fs.promises.rename(tempVideoFile, targetFile);
    this.currentSegments = 1;
    this.logProgress("Video download complete!");
  }

  async DownloadStart() {
    try {
      if (this.isDirectVideo) {
        const targetFile = this.mp4;
        const tempVideoFile = `${this.mp4}.downloading`;
        const tempDir = path.join(
          this.directory,
          `.temp_${path.basename(this.SegmentsFile)}`,
        );

        if (fs.existsSync(tempVideoFile)) {
          await fs.promises.unlink(tempVideoFile).catch(() => {});
        }

        await this.downloadDirectVideoMultiPart(
          targetFile,
          tempVideoFile,
          tempDir,
        );
        return;
      }

      const tempDir = path.join(
        this.directory,
        `.temp_${path.basename(this.SegmentsFile)}`,
      );
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const firstSegUrl =
        typeof this.Segments[0] === "object"
          ? this.Segments[0]?.url
          : this.Segments[0];

      try {
        const ref = this.headers?.Referer || this.headers?.referer;
        if (ref && global.setDynamicReferer && firstSegUrl) {
          global.setDynamicReferer(new URL(firstSegUrl).hostname, ref);
        }
      } catch (_) {}

      const domainName = extractDomain(
        this.streamUrl || firstSegUrl,
        this.headers?.Referer || this.headers?.referer,
      );

      let CONCURRENCY = await getInitialDomainConcurrency(domainName, 8);
      // Hard ceiling: the adaptive loop below has no upper bound on its own
      // (it kept climbing past 20 threads, got the host to 429, and then a
      // single bad segment aborted the whole episode).
      const MAX_CONCURRENCY = 16;
      CONCURRENCY = Math.min(CONCURRENCY, MAX_CONCURRENCY);
      // Slow-mirror escape: kwik mirrors throttle per-host (0.04 MB/s seen
      // on akirax.buzz vs 5 MB/s bursts on mikora.top). If the first 16
      // freshly-downloaded segments average under the floor, abort with the
      // host attached so the queue retries on a different server instead of
      // trickling for over an hour.
      const SLOW_HOST_FLOOR_BPS = 60 * 1024;
      const SLOW_HOST_AFTER_FRESH = 16;
      const dlStartTime = Date.now();
      let freshCount = 0;
      let currentIndex = 0;
      let stopDownloading = false;
      let failedSegmentsCount = 0;
      if (!this._keyPromiseCache) this._keyPromiseCache = {};

      const downloadSingleSegment = async (index, retryCount = 0) => {
        if (
          stopDownloading ||
          (global.isQueuePaused && global.isQueuePaused()) ||
          (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
        ) {
          if (
            global.isEpisodeInQueue &&
            !global.isEpisodeInQueue(this.EpID) &&
            !stopDownloading
          ) {
            stopDownloading = true;
            throw new Error("Episode Cancelled");
          } else if (
            global.isQueuePaused &&
            global.isQueuePaused() &&
            !stopDownloading
          ) {
            stopDownloading = true;
            throw new Error("Queue Paused");
          }
          return false;
        }

        const segmentFile = path.join(tempDir, `${index}.ts`);
        try {
          if (fs.existsSync(segmentFile)) {
            const stat = fs.statSync(segmentFile);
            if (stat.size > 0) {
              // Return true (not byte count) so cached segments don't inflate throughput measurements
              return true;
            }
          }
        } catch (e) {}

        try {
          if (isCircuitOpen(domainName)) {
            await waitForCircuit(domainName);
          }

          let Segment = this.Segments[index];
          if (!Segment) throw new Error("[ STOPPING ] Segment Missing!");

          const segUrl = typeof Segment === "object" ? Segment.url : Segment;
          let body;

          if (typeof Segment === "object" && Segment.encrypted) {
            if (!this._keyPromiseCache[Segment.keyUrl]) {
              this._keyPromiseCache[Segment.keyUrl] = (async () => {
                const keyBytes = await this.fetchWithClearanceRetry(
                  Segment.keyUrl,
                  async () => this.fetchMediaBytes(Segment.keyUrl, 15000),
                );
                return keyBytes;
              })().catch((err) => {
                delete this._keyPromiseCache[Segment.keyUrl];
                throw err;
              });
            }
            const keyBuffer = await this._keyPromiseCache[Segment.keyUrl];
            const iv = Buffer.alloc(16);
            if (typeof Segment.iv === "string" && Segment.iv.startsWith("0x")) {
              Buffer.from(Segment.iv.slice(2), "hex").copy(iv);
            } else {
              iv.writeUInt32BE(parseInt(Segment.iv, 10), 12);
            }
            const cipherBytes = await this.fetchWithClearanceRetry(
              segUrl,
              async () => this.fetchMediaBytes(segUrl, 60000),
            );
            const cipherText = stripPngHeader(cipherBytes);
            const decipher = crypto.createDecipheriv(
              "aes-128-cbc",
              keyBuffer,
              iv,
            );
            body = Buffer.concat([
              decipher.update(cipherText),
              decipher.final(),
            ]);
          } else {
            const segBytes = await this.fetchWithClearanceRetry(
              segUrl,
              async () => this.fetchMediaBytes(segUrl, 60000),
            );
            body = stripPngHeader(segBytes);
          }

          if (!body || body.length === 0) {
            throw new Error("Received empty segment payload");
          }

          const segDir = path.dirname(segmentFile);
          if (!fs.existsSync(segDir)) {
            fs.mkdirSync(segDir, { recursive: true });
          }

          await fs.promises.writeFile(segmentFile, body);
          return body.length;
        } catch (err) {
          if (
            stopDownloading ||
            (global.isQueuePaused && global.isQueuePaused())
          )
            throw err;

          const status = err?.response?.statusCode ?? err?.response?.status;
          const isServerRateOrError =
            status === 429 ||
            status === 502 ||
            status === 503 ||
            status === 530;
          const RETRY_DELAYS = isServerRateOrError
            ? [2000, 5000, 8000]
            : [1000, 3000, 5000];

          if (retryCount >= RETRY_DELAYS.length) {
            logger.error(
              `[Download] Segment ${index} failed after 3 retries: ${err.message}`,
            );
            // NOTE: do NOT set stopDownloading here. That flag means
            // user pause/cancel; setting it on a segment error makes the
            // worker loop below reject with a bogus "Queue Paused" and the
            // queue halts silently. The caller parks this index for the
            // sequential second pass instead.
            throw new Error(
              `SCRAPER_TEMPORARY_ERROR: Segment ${index} failed after retries (${err.message})`,
            );
          }

          const delay = RETRY_DELAYS[retryCount];
          this.logProgress(
            `Download error on segment ${index}! Retrying in ${delay / 1000}s (attempt ${retryCount + 2}/4)...`,
          );

          if (isCircuitOpen(domainName)) {
            await waitForCircuit(domainName);
          } else {
            await new Promise((res) => setTimeout(res, delay));
          }

          return await downloadSingleSegment(index, retryCount + 1);
        }
      };
      let activeWorkers = 0;
      let nextIndex = 0;
      let completedCount = 0;
      let sampleBytesDownloaded = 0;
      let sampleStartTime = Date.now();
      // Segments that exhausted retries: parked here and given a sequential
      // second pass after the main loop, instead of aborting a whole episode
      // over one flaky segment.
      let failedIndices = [];
      // Dead-mirror fast abort: a run of auth rejections (403/401/404) with
      // almost nothing downloaded means the mirror link itself is rejected.
      // Abort now so the queue rotates to another server instead of grinding
      // every segment through 3 retries each (~minutes of doomed 403s).
      let authFailCount = 0;
      let deadHostAborted = false;
      const DEAD_HOST_FAST_ABORT = 8;

      await new Promise((resolve, reject) => {
        const checkDone = () => {
          if (completedCount >= this.Segments.length || stopDownloading) {
            if (stopDownloading) {
              if (
                global.isEpisodeInQueue &&
                !global.isEpisodeInQueue(this.EpID)
              ) {
                reject(new Error("Episode Cancelled"));
              } else {
                reject(new Error("Queue Paused"));
              }
            } else {
              resolve();
            }
          }
        };

        const enqueueNext = () => {
          if (
            stopDownloading ||
            (global.isQueuePaused && global.isQueuePaused()) ||
            (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
          ) {
            stopDownloading = true;
            checkDone();
            return;
          }

          while (
            activeWorkers < CONCURRENCY &&
            nextIndex < this.Segments.length &&
            !stopDownloading
          ) {
            const idx = nextIndex++;
            activeWorkers++;

            downloadSingleSegment(idx)
              .then(async (downloadedBytes) => {
                activeWorkers--;
                completedCount++;
                if (downloadedBytes) {
                  sampleBytesDownloaded +=
                    typeof downloadedBytes === "number" ? downloadedBytes : 0;
                  if (typeof downloadedBytes === "number") {
                    this.downloadedTotalBytes =
                      (this.downloadedTotalBytes || 0) + downloadedBytes;
                    freshCount++;
                  }
                  this.currentSegments = Math.min(
                    this.Segments.length,
                    this.currentSegments + 1,
                  );
                  this.logProgress(null, CONCURRENCY);
                }

                // Slow-mirror escape hatch (see above): judge only once,
                // after enough fresh bytes to see past handshake noise, and
                // never on mostly-resumed downloads.
                if (
                  completedCount === SLOW_HOST_AFTER_FRESH &&
                  freshCount >= SLOW_HOST_AFTER_FRESH
                ) {
                  const elapsedSec = (Date.now() - dlStartTime) / 1000;
                  const overallBps =
                    elapsedSec > 0
                      ? (this.downloadedTotalBytes || 0) / elapsedSec
                      : 0;
                  if (overallBps < SLOW_HOST_FLOOR_BPS) {
                    let slowHost = domainName;
                    try {
                      slowHost = new URL(this.streamUrl).hostname;
                    } catch (_) {}
                    stopDownloading = true;
                    const slowErr = new Error(
                      `SCRAPER_TEMPORARY_ERROR: segment host ${slowHost} too slow (${Math.round(overallBps / 1024)} KB/s over first ${SLOW_HOST_AFTER_FRESH} segments), trying another server`,
                    );
                    slowErr.failedHost = slowHost;
                    reject(slowErr);
                    return;
                  }
                }

                if (completedCount % 4 === 0) {
                  const durationSec = (Date.now() - sampleStartTime) / 1000;
                  const throughput =
                    durationSec > 0 ? sampleBytesDownloaded / durationSec : 0;
                  recordDomainBatchSuccess(domainName, throughput);
                  sampleBytesDownloaded = 0;
                  sampleStartTime = Date.now();
                  CONCURRENCY = Math.min(
                    await getDomainConcurrency(domainName, 16),
                    MAX_CONCURRENCY,
                  );
                }

                if (completedCount >= this.Segments.length) {
                  resolve();
                } else {
                  enqueueNext();
                }
              })
              .catch((err) => {
                activeWorkers--;
                const cancelled =
                  (global.isEpisodeInQueue &&
                    !global.isEpisodeInQueue(this.EpID)) ||
                  (global.isQueuePaused && global.isQueuePaused());
                if (cancelled || stopDownloading) {
                  stopDownloading = true;
                  setDomainErrorCap(domainName, CONCURRENCY);
                  reject(err);
                  return;
                }
                completedCount++;
                failedIndices.push(idx);
                setDomainErrorCap(domainName, CONCURRENCY);
                const failStatus =
                  err?.response?.statusCode ?? err?.response?.status;
                if (
                  failStatus === 403 ||
                  failStatus === 401 ||
                  failStatus === 404
                ) {
                  authFailCount++;
                }
                if (
                  !deadHostAborted &&
                  authFailCount >= DEAD_HOST_FAST_ABORT &&
                  freshCount < SLOW_HOST_AFTER_FRESH
                ) {
                  deadHostAborted = true;
                  stopDownloading = true;
                  let deadHost = domainName;
                  try {
                    deadHost = new URL(this.streamUrl).hostname;
                  } catch (_) {}
                  const abortErr = new Error(
                    `SCRAPER_TEMPORARY_ERROR: mirror ${deadHost} is rejecting every segment (${failStatus || 403} x${authFailCount}) — dead mirror, trying another server`,
                  );
                  abortErr.failedHost = deadHost;
                  this.logProgress(
                    `Mirror ${deadHost} dead (${failStatus || 403}s) — switching server...`,
                  );
                  reject(abortErr);
                  return;
                }
                this.logProgress(
                  `Segment ${idx} failed, will retry after the rest finish...`,
                  CONCURRENCY,
                );
                enqueueNext();
              });
          }

          checkDone();
        };

        enqueueNext();
      });

      if (failedIndices.length > 0) {
        // Dead/rotated mirror host, not flaky segments: fail fast so the
        // queue retries on a different server instead of grinding hundreds
        // of dead segments sequentially (hours per episode).
        const massFailThreshold = Math.max(
          8,
          Math.ceil(this.Segments.length * 0.1),
        );
        if (failedIndices.length > massFailThreshold) {
          let host = "unknown-host";
          try {
            host = new URL(this.streamUrl).hostname;
          } catch (_) {}
          const abortErr = new Error(
            `SCRAPER_TEMPORARY_ERROR: segment host ${host} unreachable (${failedIndices.length}/${this.Segments.length} segments failed)`,
          );
          abortErr.failedHost = host;
          throw abortErr;
        }
        this.logProgress(
          `Retrying ${failedIndices.length} failed segment(s) one by one...`,
        );
        // Cap the sequential pass: many failures means a dead host, which
        // the mass-fail check above already handles; this bounds worst-case
        // time when right at the threshold. Deferred items stay failing so
        // the episode aborts fast instead of grinding them one by one.
        const secondPass = failedIndices.slice(0, 12);
        const stillFailing = [...failedIndices.slice(12)];
        for (const fIdx of secondPass) {
          if (
            stopDownloading ||
            (global.isQueuePaused && global.isQueuePaused()) ||
            (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID))
          ) {
            stillFailing.push(fIdx);
            continue;
          }
          try {
            const bytes = await downloadSingleSegment(fIdx, 0);
            if (typeof bytes === "number") {
              this.downloadedTotalBytes =
                (this.downloadedTotalBytes || 0) + bytes;
            }
            this.currentSegments = Math.min(
              this.Segments.length,
              this.currentSegments + 1,
            );
            this.logProgress(null, CONCURRENCY);
          } catch (err) {
            stillFailing.push(fIdx);
            logger.error(
              `[Download] Segment ${fIdx} failed on second pass: ${err.message}`,
            );
          }
        }
        failedIndices = stillFailing;
        if (failedIndices.length > 0) {
          failedSegmentsCount = failedIndices.length;
          let host = "unknown-host";
          try {
            host = new URL(this.streamUrl).hostname;
          } catch (_) {}
          const finalErr = new Error(
            `SCRAPER_TEMPORARY_ERROR: ${failedIndices.length} segment(s) failed after retries (e.g. #${failedIndices[0]})`,
          );
          finalErr.failedHost = host;
          throw finalErr;
        }
      }

      logger.info(
        `[Download] Finished downloading segments. Total: ${this.Segments.length}, Failed/Empty: ${failedSegmentsCount}`,
      );

      // Concatenate segments
      this.logProgress("Concatenating segments...");
      const writer = fs.createWriteStream(this.SegmentsFile, {
        flags: "w",
        encoding: null,
      });

      for (let j = 0; j < this.Segments.length; j++) {
        const segmentFile = path.join(tempDir, `${j}.ts`);
        const data = await fs.promises.readFile(segmentFile);
        const canWrite = writer.write(data);
        if (!canWrite) {
          await new Promise((resolve) => writer.once("drain", resolve));
        }
      }

      await new Promise((resolve, reject) => {
        writer.on("error", reject);
        writer.end(resolve);
      });

      // Clean up temp segment files
      for (let j = 0; j < this.Segments.length; j++) {
        const segmentFile = path.join(tempDir, `${j}.ts`);
        await fs.promises.unlink(segmentFile).catch(() => {});
      }
      await fs.promises.rmdir(tempDir).catch(() => {});
    } catch (err) {
      if (
        err.message === "Queue Paused" ||
        err.message === "Episode Cancelled"
      ) {
        throw err;
      }
      throw err;
    }
  }

  // Check Subtitles & download
  async CheckSubtitles() {
    if (this.subtitles.length === 0) return;

    try {
      const SubTitleDir = path.join(this.directory, `subs`);
      if (!fs.existsSync(SubTitleDir)) {
        fs.mkdirSync(SubTitleDir, { recursive: true });
      }

      const downloadPromises = this.subtitles.map(async ({ url, lang }) => {
        try {
          if (!url) return;
          let targetUrl = url;
          if (targetUrl.startsWith("//")) {
            targetUrl = "https:" + targetUrl;
          } else if (
            !targetUrl.startsWith("http://") &&
            !targetUrl.startsWith("https://")
          ) {
            targetUrl = resolveUrl(targetUrl, this.streamUrl);
          }

          const normalizedLang =
            iso6391.getCode(lang) ||
            (() => {
              const cleaned = (lang ?? "")
                .trim()
                .replace(/[^a-z]/gi, "")
                .toLowerCase();
              return cleaned ? cleaned?.slice(0, 3) : "und";
            })();

          let ext = "srt";
          try {
            const urlPath = new URL(targetUrl).pathname;
            const parsedExt = path
              .extname(path.basename(urlPath))
              .replace(".", "");
            if (parsedExt) ext = parsedExt;
          } catch (e) {}

          let finalExt = ext;
          if (finalExt === "vtt" && this.ChangeTosrt) {
            finalExt = "srt";
          }

          let subtitlePath = path.join(
            SubTitleDir,
            `${this.Epnum}Ep.${normalizedLang}.${finalExt}`,
          );

          if (fs.existsSync(subtitlePath)) {
            if (!this.MergeSubtitles && this.fileBase && this.mp4) {
              const siblingSubPath = path.join(
                this.directory,
                `${path.parse(this.mp4).name}.${normalizedLang}.${finalExt}`,
              );
              if (!fs.existsSync(siblingSubPath)) {
                await fs.promises
                  .copyFile(subtitlePath, siblingSubPath)
                  .catch(() => {});
              }
            }
            this.downloadedPaths.push({
              path: subtitlePath,
              lang: normalizedLang,
              title: lang,
            });
            return;
          }

          const subHeaders = await this.getMediaRequestHeaders(targetUrl);
          let subtitleData;
          try {
            subtitleData = await this.fetchWithClearanceRetry(targetUrl, () =>
              this.fetchMediaText(targetUrl, 15000),
            );
          } catch (e) {
            try {
              const cleanHeaders = { ...subHeaders };
              delete cleanHeaders["Referer"];
              delete cleanHeaders["referer"];
              delete cleanHeaders["Origin"];
              delete cleanHeaders["origin"];
              subtitleData = await got(targetUrl, {
                headers: cleanHeaders,
                http2: false,
                timeout: { request: 15000 },
              }).text();
            } catch (err) {
              subtitleData = await got(targetUrl, {
                http2: false,
                timeout: { request: 15000 },
              }).text();
            }
          }

          const isVtt =
            finalExt === "vtt" || subtitleData.trim().startsWith("WEBVTT");

          if (isVtt) {
            if (this.ChangeTosrt) {
              subtitleData = this.convertToSRT(subtitleData);
              if (finalExt !== "srt") {
                finalExt = "srt";
                subtitlePath = path.join(
                  SubTitleDir,
                  `${this.Epnum}Ep.${normalizedLang}.${finalExt}`,
                );
              }
            } else {
              if (finalExt !== "vtt") {
                finalExt = "vtt";
                subtitlePath = path.join(
                  SubTitleDir,
                  `${this.Epnum}Ep.${normalizedLang}.${finalExt}`,
                );
              }
            }
          }

          await fs.promises.writeFile(subtitlePath, subtitleData, "utf8");
          if (!this.MergeSubtitles && this.fileBase && this.mp4) {
            const siblingSubPath = path.join(
              this.directory,
              `${path.parse(this.mp4).name}.${normalizedLang}.${finalExt}`,
            );
            await fs.promises
              .writeFile(siblingSubPath, subtitleData, "utf8")
              .catch(() => {});
          }
          this.downloadedPaths.push({
            path: subtitlePath,
            lang: normalizedLang,
            title: lang,
          });
        } catch (err) {
          logger.error(`Failed to download subtitle : ${url} (${lang})`);
          logger.error(`Error message: ${err.message}`);
          logger.error(`Stack trace: ${err.stack}`);
        }
      });

      await Promise.all(downloadPromises);
      this.currentSegments += this.subtitles.length;
    } catch (err) {
      logger.error(`Failed to process subtitles`);
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
    }
  }

  convertToSRT(content) {
    try {
      const lines = content.split(/\r?\n/);
      const srtLines = [];
      let index = 1;
      let buffer = [];

      const timeRegex =
        /^(\d{2}:)?\d{2}:\d{2}[\.,]\d{3} --> (\d{2}:)?\d{2}:\d{2}[\.,]\d{3}$/;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim().replace(/<[^>]+>/g, "");

        if (line.startsWith("WEBVTT")) continue;

        if (!line) {
          if (buffer.length) {
            srtLines.push(String(index++));
            srtLines.push(...buffer);
            srtLines.push("");
            buffer = [];
          }
          continue;
        }

        if (timeRegex.test(line)) {
          if (buffer.length) {
            srtLines.push(String(index++));
            srtLines.push(...buffer);
            srtLines.push("");
            buffer = [];
          }

          let [start, end] = line.split(" --> ");
          const startMs = this.toMs(start);
          const endMs = this.toMs(end);

          if (endMs <= startMs) continue;

          buffer.push(`${this.toSRT(startMs)} --> ${this.toSRT(endMs)}`);
        } else {
          if (/^\d+$/.test(line) && buffer.length === 0) {
            continue;
          }
          if (buffer.length) {
            buffer.push(line);
          }
        }
      }

      if (buffer.length) {
        srtLines.push(String(index++));
        srtLines.push(...buffer);
        srtLines.push("");
      }

      return srtLines.join("\n");
    } catch (err) {
      console.warn("Subtitle conversion failed:", err.message);
      return content;
    }
  }

  toMs(timeStr) {
    const clean = timeStr.replace(",", ".");
    const parts = clean.split(":");
    const [sec, ms] = parts[parts.length - 1].split(".");
    const s = parseInt(sec);
    const m = parseInt(parts[parts.length - 2]);
    const h = parts.length === 3 ? parseInt(parts[0]) : 0;

    return h * 3600000 + m * 60000 + s * 1000 + parseInt(ms);
  }

  toSRT(ms) {
    const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const msStr = String(ms % 1000).padStart(3, "0");
    return `${h}:${m}:${s},${msStr}`;
  }

  async MergeSegments() {
    if (this.isDirectVideo) {
      if (this.MergeSubtitles && this.downloadedPaths.length > 0) {
        const releaseLock = await acquireMergeLock();
        try {
          const currentFfmpegPath = await getFfmpegPath();
          const tempOutput = `${this.mp4}.remux.mp4`;
          const ffmpegArgs = ["-y", "-i", this.mp4];
          for (const sub of this.downloadedPaths) {
            ffmpegArgs.push("-i", sub.path);
          }
          ffmpegArgs.push("-map", "0:v", "-map", "0:a?");
          for (let i = 0; i < this.downloadedPaths.length; i++) {
            ffmpegArgs.push("-map", `${i + 1}:s`);
          }
          ffmpegArgs.push("-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text");
          for (let i = 0; i < this.downloadedPaths.length; i++) {
            const sub = this.downloadedPaths[i];
            ffmpegArgs.push(`-metadata:s:s:${i}`, `language=${sub.lang}`);
            if (sub.title) {
              ffmpegArgs.push(`-metadata:s:s:${i}`, `title=${sub.title}`);
            }
          }
          ffmpegArgs.push(tempOutput);

          const nativeDir = path.dirname(currentFfmpegPath);
          const spawnEnv = {
            ...process.env,
            LD_LIBRARY_PATH:
              nativeDir +
              (process.env.LD_LIBRARY_PATH
                ? ":" + process.env.LD_LIBRARY_PATH
                : ""),
          };

          await new Promise((resolve, reject) => {
            const child = spawn(currentFfmpegPath, ffmpegArgs, {
              env: spawnEnv,
            });
            child.on("close", (code) => {
              if (code !== 0)
                return reject(new Error(`FFmpeg exited with code ${code}`));
              resolve();
            });
            child.on("error", reject);
          });

          await fs.promises.unlink(this.mp4).catch(() => {});
          await fs.promises.rename(tempOutput, this.mp4);
        } catch (e) {
          logger.warn(
            `[Video Remux] Failed to merge subtitles into direct MP4: ${e.message}`,
          );
        } finally {
          releaseLock();
        }
      }
      return;
    }

    const releaseLock = await acquireMergeLock();
    try {
      let ffmpegSucceeded = false;
      let ffmpegError = null;

      try {
        const currentFfmpegPath = await getFfmpegPath();
        const ffmpegArgs = ["-y", "-f", "mpegts", "-i", this.SegmentsFile];

        if (this.MergeSubtitles && this.downloadedPaths.length > 0) {
          for (const sub of this.downloadedPaths) {
            ffmpegArgs.push("-i", sub.path);
          }
          ffmpegArgs.push("-map", "0:v", "-map", "0:a?");
          for (let i = 0; i < this.downloadedPaths.length; i++) {
            ffmpegArgs.push("-map", `${i + 1}:s`);
          }
          ffmpegArgs.push("-c:v", "copy", "-c:a", "copy", "-c:s", "mov_text");
          for (let i = 0; i < this.downloadedPaths.length; i++) {
            const sub = this.downloadedPaths[i];
            ffmpegArgs.push(`-metadata:s:s:${i}`, `language=${sub.lang}`);
            if (sub.title) {
              ffmpegArgs.push(`-metadata:s:s:${i}`, `title=${sub.title}`);
            }
          }
        } else {
          ffmpegArgs.push("-c", "copy");
        }

        ffmpegArgs.push(this.mp4);

        try {
          const stats = fs.statSync(this.SegmentsFile);
          logger.info(
            `[Video Remux] Concatenated TS file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`,
          );
        } catch (e) {
          logger.error(
            `[Video Remux] Failed to check TS file size: ${e.message}`,
          );
        }

        const nativeDir = path.dirname(currentFfmpegPath);
        const spawnEnv = {
          ...process.env,
          LD_LIBRARY_PATH:
            nativeDir +
            (process.env.LD_LIBRARY_PATH
              ? ":" + process.env.LD_LIBRARY_PATH
              : ""),
        };

        await new Promise((resolve, reject) => {
          const child = spawn(currentFfmpegPath, ffmpegArgs, { env: spawnEnv });
          let ffmpegOutput = "";

          if (child.stdout) {
            child.stdout.on("data", (data) => {
              ffmpegOutput += data.toString();
            });
          }
          if (child.stderr) {
            child.stderr.on("data", (data) => {
              ffmpegOutput += data.toString();
            });
          }

          child.on("close", (code, signal) => {
            if (code !== 0) {
              logger.error(`[Video Remux] FFmpeg output:\n${ffmpegOutput}`);
              return reject(
                new Error(
                  `FFmpeg exited with code ${code}${signal ? ` (signal: ${signal})` : ""}`,
                ),
              );
            }
            resolve();
          });

          child.on("error", (err) => {
            reject(new Error(`Failed to start FFmpeg: ${err.message}`));
          });
        });

        ffmpegSucceeded = true;
      } catch (err) {
        ffmpegError = err;
      }

      if (ffmpegSucceeded) {
        try {
          const stats = fs.statSync(this.mp4);
          logger.info(
            `[Video Remux] Output MP4 file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`,
          );
        } catch (e) {
          logger.error(
            `[Video Remux] Failed to check MP4 file size: ${e.message}`,
          );
        }
      } else {
        logger.warn(
          `[Video Remux] FFmpeg failed: ${ffmpegError?.message}. Keeping .ts file as output.`,
        );
        this._keepSegmentsFile = true;
        try {
          const stats = fs.statSync(this.SegmentsFile);
          logger.info(
            `[Video Remux] Output TS file: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`,
          );
        } catch (e) {
          logger.error(
            `[Video Remux] Failed to check TS file size: ${e.message}`,
          );
        }
      }

      this.currentSegments = this.totalSegments;
      await this.logProgress();
      await this.CleanEverything();
    } catch (err) {
      await this.CleanEverything(true);
      throw err;
    } finally {
      releaseLock();
    }
  }

  getLangCodeFromFilename(filePath) {
    let FileName = path?.basename(filePath)?.split("_")?.[1];
    if (!FileName) return "und";
    FileName =
      FileName?.split(".srt")?.[0]?.slice(0, 3)?.toLocaleLowerCase() ?? "und";
    return FileName;
  }

  async logProgress(ExtraMessage, currentConcurrency = null) {
    if (global.isEpisodeInQueue && !global.isEpisodeInQueue(this.EpID)) {
      if (this._pendingLogTimer) {
        clearTimeout(this._pendingLogTimer);
        this._pendingLogTimer = null;
      }
      return;
    }
    let caption = this.caption;
    if (this.currentSegments >= this.totalSegments) {
      caption = caption.replace("Downloading", "Merging");
    }

    if (ExtraMessage) caption += ExtraMessage;

    const now = Date.now();
    const isFinalUpdate = this.currentSegments >= this.totalSegments;
    const captionChanged = this._lastCaption !== caption;
    const timeSinceLast = now - (this._lastLogTime || 0);

    if (
      !isFinalUpdate &&
      !captionChanged &&
      !ExtraMessage &&
      timeSinceLast < 1000
    ) {
      if (!this._pendingLogTimer) {
        this._pendingLogTimer = setTimeout(() => {
          this._pendingLogTimer = null;
          this.logProgress(null, currentConcurrency);
        }, 1000 - timeSinceLast);
      }
      return;
    }

    if (this._pendingLogTimer) {
      clearTimeout(this._pendingLogTimer);
      this._pendingLogTimer = null;
    }

    this._lastLogTime = now;
    this._lastCaption = caption;

    let speedStr = null;
    let etaStr = null;
    const totalDownloaded = this.downloadedTotalBytes || 0;

    if (!this._speedStartTime) {
      this._speedStartTime = now;
      this._speedBytesStart = totalDownloaded;
    }
    const elapsedSec = (now - this._speedStartTime) / 1000;

    if (elapsedSec >= 0.8 && totalDownloaded > (this._speedBytesStart || 0)) {
      const bytesSince = totalDownloaded - (this._speedBytesStart || 0);
      const instantSpeed = bytesSince / elapsedSec;
      this._smoothedSpeed = this._smoothedSpeed
        ? 0.4 * instantSpeed + 0.6 * this._smoothedSpeed
        : instantSpeed;

      const currentSpeed = this._smoothedSpeed;
      if (currentSpeed >= 1024 * 1024) {
        speedStr = `${(currentSpeed / (1024 * 1024)).toFixed(1)} MB/s`;
      } else if (currentSpeed >= 1024) {
        speedStr = `${Math.round(currentSpeed / 1024)} KB/s`;
      } else if (currentSpeed > 0) {
        speedStr = `${Math.round(currentSpeed)} B/s`;
      }

      if (
        this.totalSegments > 0 &&
        this.currentSegments > 0 &&
        currentSpeed > 0
      ) {
        const remainingSegments = Math.max(
          0,
          this.totalSegments - this.currentSegments,
        );
        const avgBytesPerSeg = totalDownloaded / this.currentSegments;
        const remainingBytes = remainingSegments * avgBytesPerSeg;
        const remainingSec = Math.round(remainingBytes / currentSpeed);

        if (remainingSec >= 0 && isFinite(remainingSec)) {
          if (remainingSec < 60) {
            etaStr = `~${remainingSec}s left`;
          } else {
            const mins = Math.floor(remainingSec / 60);
            const secs = remainingSec % 60;
            etaStr = `~${mins}m ${secs}s left`;
          }
        }
      }

      if (speedStr) this._lastSpeedStr = speedStr;
      if (etaStr) this._lastEtaStr = etaStr;

      if (elapsedSec >= 2.5) {
        this._speedStartTime = now;
        this._speedBytesStart = totalDownloaded;
      }
    }

    const port = global.PORT || 3000;
    await fetch(`http://127.0.0.1:${port}/api/logger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caption: caption,
        totalSegments: this.totalSegments,
        currentSegments: this.currentSegments,
        epid: this.EpID,
        concurrency: currentConcurrency,
        lastTestedConcurrency: this.lastTestedConcurrency || null,
        downloadSpeed: speedStr || this._lastSpeedStr || null,
        eta: etaStr || this._lastEtaStr || null,
      }),
    }).catch((err) => {
      logger.error("Error updating download progress");
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
    });
  }

  async CleanEverything(everything = false) {
    if (!this._keepSegmentsFile) {
      await fs.promises.unlink(this.SegmentsFile).catch(() => {});
    }

    if (this.MergeSubtitles) {
      const subsDir = path.join(this.directory, "subs");
      if (fs.existsSync(subsDir)) {
        try {
          const files = fs.readdirSync(subsDir);
          const prefix = `${this.Epnum}Ep.`;
          for (const file of files) {
            if (file.startsWith(prefix)) {
              fs.unlinkSync(path.join(subsDir, file));
            }
          }
          const remainingFiles = fs.readdirSync(subsDir);
          if (remainingFiles.length === 0) {
            fs.rmdirSync(subsDir);
          }
        } catch (e) {
          logger.error(`Failed to clean up subs: ${e.message}`);
        }
      }
    }

    if (everything) {
      await fs.promises.unlink(this.mp4).catch(() => {});
      await fs.promises.unlink(`${this.mp4}.downloading`).catch(() => {});
      await fs.promises.unlink(`${this.mp4}.remux.mp4`).catch(() => {});

      const tempDir = path.join(
        this.directory,
        `.temp_${path.basename(this.SegmentsFile)}`,
      );
      if (fs.existsSync(tempDir)) {
        try {
          const files = fs.readdirSync(tempDir);
          for (const file of files) {
            fs.unlinkSync(path.join(tempDir, file));
          }
          fs.rmdirSync(tempDir);
        } catch (e) {
          logger.error(`Failed to clean up temp dir: ${e.message}`);
        }
      }
    }
  }
}

async function download(args) {
  let obj = new downloader(args);
  try {
    await obj.DownloadsChecking();
    await obj.DownloadStart();
    await obj.CheckSubtitles();
    await obj.MergeSegments();
  } catch (err) {
    if (err.message === "Queue Paused") {
      throw err;
    }
    await obj.CleanEverything(true);
    if (err.message === "Episode Cancelled") {
      throw err;
    }
    logger.error(err?.message || String(err));
    throw err;
  }
}

module.exports = { download, getFfmpegPath, stripPngHeader, downloader };
