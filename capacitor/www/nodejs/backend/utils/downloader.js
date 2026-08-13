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
const ffmpeg = null;
const iso6391 = require("iso-639-1");
const path = require("path");
const got = require("got").default || require("got");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
const stream = require("stream");
const { promisify } = require("util");
const crypto = require("crypto");
const { getHeaders } = require("./proxyHeaders");
const { isLanguagePreferred } = require("./settings");
const {
  extractDomain,
  getDomainConcurrency,
  recordDomainFailure,
  recordDomainSuccess,
  recordDomainBatchSuccess,
  isCircuitOpen,
  waitForCircuit,
  setDomainErrorCap,
  stepDownConcurrency,
  setRecoveryCap,
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
  if (!buffer || buffer.length < 8) return buffer;

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
    const iendOffset = buffer.indexOf(Buffer.from([0x49, 0x45, 0x4e, 0x44]));
    if (iendOffset !== -1 && iendOffset < 1024) {
      return buffer.subarray(iendOffset + 8);
    }
  }
  return buffer;
}

async function getFfmpegPath() {
  if (resolvedFfmpegPath && fs.existsSync(resolvedFfmpegPath)) {
    return resolvedFfmpegPath;
  }

  const candidateNativeDirs = [];

  if (process.env.NATIVE_LIB_DIR) {
    candidateNativeDirs.push(process.env.NATIVE_LIB_DIR);
  }

  try {
    const maps = fs.readFileSync("/proc/self/maps", "utf-8");
    const soMatch = maps.match(/\s(\/data\/app\/[^\s]+\/lib\/[^\s/]+)\//);
    if (soMatch && soMatch[1]) {
      candidateNativeDirs.push(soMatch[1]);
    }
    const soMatch2 = maps.match(
      /\s(\/data\/app\/~~[^/]+\/app\.strawverse\.android-[^/]+\/lib\/[^\s/]+)\//,
    );
    if (soMatch2 && soMatch2[1]) {
      candidateNativeDirs.push(soMatch2[1]);
    }
  } catch (e) {
    logger.warn(`[FFmpeg] Could not read /proc/self/maps: ${e.message}`);
  }

  candidateNativeDirs.push("/data/data/app.strawverse.android/lib");
  candidateNativeDirs.push("/data/user/0/app.strawverse.android/lib");

  const userDataDir = process.env.NODEJS_MOBILE_DATA_DIR || process.cwd();
  candidateNativeDirs.push(path.join(userDataDir, "bin"));

  const seen = new Set();
  for (const dir of candidateNativeDirs) {
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const ffmpegPath = path.join(dir, "libffmpeg.so");
    if (fs.existsSync(ffmpegPath)) {
      logger.info(
        `FFmpeg binary found in native library directory: ${ffmpegPath}`,
      );
      resolvedFfmpegPath = ffmpegPath;
      return resolvedFfmpegPath;
    }
  }

  throw new Error(
    "FFmpeg binary (libffmpeg.so) not found in APK. " +
      "Rebuild the app with 'node capacitor/scripts/fetch-ffmpeg.mjs' " +
      "to bundle FFmpeg, then reinstall.",
  );
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
  }) {
    this.directory = directory;
    this.quality = quality;
    if (streamUrl?.url) {
      this.streamUrl = streamUrl.url;
      this.headers = streamUrl.headers ?? headers;
    } else {
      this.streamUrl = streamUrl;
      this.headers = headers ?? {};
    }

    if (this.streamUrl) {
      const resolvedHeaders = getHeaders(this.streamUrl);
      if (
        resolvedHeaders.Referer &&
        !this.headers.Referer &&
        !this.headers.referer
      ) {
        this.headers["Referer"] = resolvedHeaders.Referer;
      }
      if (
        resolvedHeaders.Origin &&
        !this.headers.Origin &&
        !this.headers.origin
      ) {
        this.headers["Origin"] = resolvedHeaders.Origin;
      }
      if (
        resolvedHeaders["User-Agent"] &&
        !this.headers["User-Agent"] &&
        !this.headers["user-agent"]
      ) {
        this.headers["User-Agent"] = resolvedHeaders["User-Agent"];
      }
      if (
        resolvedHeaders.Cookie &&
        !this.headers.Cookie &&
        !this.headers.cookie
      ) {
        this.headers["Cookie"] = resolvedHeaders.Cookie;
      }
    }

    const finalReferer = this.headers["Referer"] || this.headers["referer"];
    if (finalReferer && !this.headers["Origin"] && !this.headers["origin"]) {
      try {
        const refUrl = new URL(finalReferer);
        if (refUrl.protocol === "http:" || refUrl.protocol === "https:") {
          this.headers["Origin"] = refUrl.origin;
        }
      } catch (e) {}
    }
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

  async getRequestHeaders(url) {
    const reqHeaders = { ...(this.headers ?? {}) };
    const resolvedHeaders = getHeaders(url);
    if (resolvedHeaders.Referer && !reqHeaders.Referer && !reqHeaders.referer) {
      reqHeaders["Referer"] = resolvedHeaders.Referer;
    }
    if (resolvedHeaders.Origin && !reqHeaders.Origin && !reqHeaders.origin) {
      reqHeaders["Origin"] = resolvedHeaders.Origin;
    }
    if (
      resolvedHeaders["User-Agent"] &&
      !reqHeaders["User-Agent"] &&
      !reqHeaders["user-agent"]
    ) {
      reqHeaders["User-Agent"] = resolvedHeaders["User-Agent"];
    }
    if (resolvedHeaders.Cookie && !reqHeaders.Cookie && !reqHeaders.cookie) {
      reqHeaders["Cookie"] = resolvedHeaders.Cookie;
    }

    const finalReferer = reqHeaders["Referer"] || reqHeaders["referer"];
    if (finalReferer && !reqHeaders["Origin"] && !reqHeaders["origin"]) {
      try {
        const refUrl = new URL(finalReferer);
        if (refUrl.protocol === "http:" || refUrl.protocol === "https:") {
          reqHeaders["Origin"] = refUrl.origin;
        }
      } catch (e) {}
    }

    const androidCookie = resolvedHeaders.Cookie || resolvedHeaders.cookie;
    if (androidCookie) {
      const cookieValues = new Map();
      const existingCookie = reqHeaders.Cookie || reqHeaders.cookie || "";
      for (const part of `${existingCookie};${androidCookie}`.split(";")) {
        const trimmed = part.trim();
        if (!trimmed) continue;
        const separator = trimmed.indexOf("=");
        const name = separator === -1 ? trimmed : trimmed.slice(0, separator);
        cookieValues.set(name, trimmed);
      }
      delete reqHeaders.cookie;
      reqHeaders.Cookie = [...cookieValues.values()].join("; ");
    }

    reqHeaders["accept"] = "*/*";
    reqHeaders["accept-language"] = "en-US,en;q=0.9";
    reqHeaders["cache-control"] = "no-cache";
    reqHeaders["pragma"] = "no-cache";
    reqHeaders["sec-ch-ua"] = '"Not/A)Brand";v="99", "Chromium";v="148"';
    reqHeaders["sec-ch-ua-mobile"] = "?0";
    reqHeaders["sec-ch-ua-platform"] = '"Linux"';
    reqHeaders["sec-fetch-dest"] = "empty";
    reqHeaders["sec-fetch-mode"] = "cors";
    reqHeaders["sec-fetch-site"] = "cross-site";

    const finalHeaders = {};
    for (const key of Object.keys(reqHeaders)) {
      finalHeaders[key.toLowerCase()] = reqHeaders[key];
    }

    return finalHeaders;
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

    this.mp4 = path.join(this.directory, `${this.Epnum}Ep.mp4`);
    this.SegmentsFile = path.join(this.directory, `${this.Epnum}Ep.ts`);

    if (!this.streamUrl || this.streamUrl.length <= 0) {
      throw new Error("No Stream Url Provided");
    } else {
      let Playlist = await got(this.streamUrl, {
        headers: await this.getRequestHeaders(this.streamUrl),
        http2: true,
      }).text();

      if (!Playlist) throw new Error("No Stream Found!");

      // Resolve master playlist to media playlist if applicable
      if (Playlist.includes("#EXT-X-STREAM-INF")) {
        if (!this.subtitles || this.subtitles.length === 0) {
          try {
            const mediaLines = Playlist.split("\n").filter((l) =>
              l.includes("#EXT-X-MEDIA:TYPE=SUBTITLES"),
            );
            const { settingfetch } = require("./settings");
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
          Playlist = await got(this.streamUrl, {
            headers: await this.getRequestHeaders(this.streamUrl),
            http2: true,
          }).text();

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

  async DownloadStart() {
    try {
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

      const domainName = extractDomain(
        this.streamUrl || firstSegUrl,
        this.headers?.Referer || this.headers?.referer,
      );

      let CONCURRENCY = await getDomainConcurrency(domainName, 4);
      let currentIndex = 0;
      let stopDownloading = false;
      let failedSegmentsCount = 0;

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
            if (!this._keyCache) this._keyCache = {};
            if (!this._keyCache[Segment.keyUrl]) {
              const keyRes = await got(Segment.keyUrl, {
                headers: await this.getRequestHeaders(Segment.keyUrl),
                responseType: "buffer",
                agent: keepAliveAgent,
                timeout: { request: 15000 },
              });
              this._keyCache[Segment.keyUrl] = keyRes.body;
            }
            const keyBuffer = this._keyCache[Segment.keyUrl];
            const iv = Buffer.alloc(16);
            if (typeof Segment.iv === "string" && Segment.iv.startsWith("0x")) {
              Buffer.from(Segment.iv.slice(2), "hex").copy(iv);
            } else {
              iv.writeUInt32BE(parseInt(Segment.iv, 10), 12);
            }
            const encRes = await got(segUrl, {
              headers: await this.getRequestHeaders(segUrl),
              responseType: "buffer",
              agent: keepAliveAgent,
              timeout: { request: 15000 },
            });
            const cipherText = stripPngHeader(encRes.body);
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
            const response = await got(segUrl, {
              headers: await this.getRequestHeaders(segUrl),
              responseType: "buffer",
              agent: keepAliveAgent,
              timeout: { request: 15000 },
            });
            body = stripPngHeader(response.body);
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

          const RETRY_DELAYS = [1000, 3000, 5000];

          if (retryCount >= RETRY_DELAYS.length) {
            logger.error(
              `[Download] Segment ${index} failed after 3 retries: ${err.message}`,
            );
            stopDownloading = true;
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
                  }
                  this.currentSegments = Math.min(
                    this.Segments.length,
                    this.currentSegments + 1,
                  );
                  this.logProgress(null, CONCURRENCY);
                }

                if (completedCount % 8 === 0) {
                  const durationSec = (Date.now() - sampleStartTime) / 1000;
                  const throughput =
                    durationSec > 0 ? sampleBytesDownloaded / durationSec : 0;
                  recordDomainBatchSuccess(domainName, throughput);
                  sampleBytesDownloaded = 0;
                  sampleStartTime = Date.now();
                  CONCURRENCY = await getDomainConcurrency(domainName, 6);
                }

                if (completedCount >= this.Segments.length) {
                  resolve();
                } else {
                  enqueueNext();
                }
              })
              .catch((err) => {
                activeWorkers--;
                stopDownloading = true;
                setDomainErrorCap(domainName, CONCURRENCY);
                reject(err);
              });
          }

          checkDone();
        };

        enqueueNext();
      });

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
      throw new Error(err);
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
            this.downloadedPaths.push({
              path: subtitlePath,
              lang: normalizedLang,
              title: lang,
            });
            return;
          }

          const subHeaders = await this.getRequestHeaders(targetUrl);
          delete subHeaders["origin"];
          delete subHeaders["Origin"];
          let subtitleData;
          try {
            subtitleData = await got(targetUrl, {
              headers: subHeaders,
              timeout: { request: 15000 },
            }).text();
          } catch (e) {
            try {
              const cleanHeaders = { ...subHeaders };
              delete cleanHeaders["Referer"];
              delete cleanHeaders["referer"];
              delete cleanHeaders["Origin"];
              delete cleanHeaders["origin"];
              subtitleData = await got(targetUrl, {
                headers: cleanHeaders,
                timeout: { request: 15000 },
              }).text();
            } catch (err) {
              subtitleData = await got(targetUrl, {
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

    await fetch(`http://localhost:${global.PORT}/api/logger`, {
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
    console.log(err);
    logger.error(err);
    throw new Error(err);
  }
}

module.exports = { download, getFfmpegPath, stripPngHeader, downloader };
