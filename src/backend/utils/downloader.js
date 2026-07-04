const { spawn } = require("child_process");
const { logger } = require("./AppLogger");
const ffmpeg = require("ffmpeg-static");
const iso6391 = require("iso-639-1");
const path = require("path");
const got = require("got").default || require("got");
const fs = require("fs");
const os = require("os");
const zlib = require("zlib");
const stream = require("stream");
const { promisify } = require("util");
const { app } = require("electron");
const crypto = require("crypto");
const { getHeaders } = require("./proxyHeaders");

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
  if (resolvedFfmpegPath) {
    return resolvedFfmpegPath;
  }

  const defaultPath = ffmpeg.replace("app.asar", "app.asar.unpacked");
  if (fs.existsSync(defaultPath)) {
    resolvedFfmpegPath = defaultPath;
    return resolvedFfmpegPath;
  }

  let userDataDir;
  try {
    userDataDir = app.getPath("userData");
  } catch (e) {
    userDataDir = path.join(os.homedir(), ".strawverse");
  }

  const binDir = path.join(userDataDir, "bin");
  const localFfmpegPath = path.join(
    binDir,
    process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg",
  );

  if (fs.existsSync(localFfmpegPath)) {
    resolvedFfmpegPath = localFfmpegPath;
    return resolvedFfmpegPath;
  }

  const isGlobalAvailable = await new Promise((resolve) => {
    const child = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    child.on("close", (code) => {
      resolve(code === 0);
    });
    child.on("error", () => {
      resolve(false);
    });
  });

  if (isGlobalAvailable) {
    logger.info(
      "FFmpeg not found in package but found globally in system PATH.",
    );
    resolvedFfmpegPath = "ffmpeg";
    return resolvedFfmpegPath;
  }

  logger.info(
    `FFmpeg binary not found. Downloading for ${process.platform}-${process.arch}...`,
  );
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const release = "b6.1.1";
  const platform = process.platform;
  const arch = process.arch;
  const supported = {
    darwin: ["x64", "arm64"],
    freebsd: ["x64"],
    linux: ["x64", "ia32", "arm64", "arm"],
    win32: ["x64", "ia32"],
  };

  if (!supported[platform] || !supported[platform].includes(arch)) {
    throw new Error(
      `Unsupported platform/architecture for downloading FFmpeg: ${platform}-${arch}`,
    );
  }

  const downloadUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/${release}/ffmpeg-${platform}-${arch}.gz`;

  try {
    const downloadStream = got.stream(downloadUrl);
    const gunzip = zlib.createGunzip();
    const writer = fs.createWriteStream(localFfmpegPath);

    await pipeline(downloadStream, gunzip, writer);

    fs.chmodSync(localFfmpegPath, 0o755);
    logger.info(
      `FFmpeg downloaded successfully and saved at ${localFfmpegPath}`,
    );
    resolvedFfmpegPath = localFfmpegPath;
    return resolvedFfmpegPath;
  } catch (err) {
    logger.error(`Failed to download FFmpeg: ${err.message}`);
    if (fs.existsSync(localFfmpegPath)) {
      try {
        fs.unlinkSync(localFfmpegPath);
      } catch (_) {}
    }
    throw new Error(`FFmpeg missing and download failed: ${err.message}`);
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
        headers: this.headers ?? {},
      }).text();

      if (!Playlist) throw new Error("No Stream Found!");

      // Resolve master playlist to media playlist if applicable
      if (Playlist.includes("#EXT-X-STREAM-INF")) {
        if (!this.subtitles || this.subtitles.length === 0) {
          try {
            const mediaLines = Playlist.split("\n").filter((l) =>
              l.includes("#EXT-X-MEDIA:TYPE=SUBTITLES"),
            );
            for (const mLine of mediaLines) {
              const uriMatch =
                mLine.match(/URI="([^"]+)"/i) || mLine.match(/URI=([^,\s]+)/i);
              if (uriMatch) {
                const subUri = resolveUrl(uriMatch[1], this.streamUrl);
                const nameMatch =
                  mLine.match(/NAME="([^"]+)"/i) ||
                  mLine.match(/LANGUAGE="([^"]+)"/i);
                const subLang = nameMatch ? nameMatch[1] : "English";
                if (!this.subtitles) this.subtitles = [];
                this.subtitles.push({ url: subUri, lang: subLang });
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
            headers: this.headers ?? {},
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

      const CONCURRENCY = 5;
      let activeDownloads = 0;
      let currentIndex = 0;
      let stopDownloading = false;
      let downloadError = null;
      let failedSegmentsCount = 0;

      await new Promise((resolve, reject) => {
        const startNext = async () => {
          if (
            stopDownloading ||
            (global.isQueuePaused && global.isQueuePaused())
          )
            return;

          if (currentIndex >= this.Segments.length) {
            if (activeDownloads === 0) {
              if (downloadError) reject(downloadError);
              else resolve();
            }
            return;
          }

          const index = currentIndex++;
          activeDownloads++;

          const segmentFile = path.join(tempDir, `${index}.ts`);
          let alreadyDownloaded = false;
          try {
            if (fs.existsSync(segmentFile)) {
              const stat = fs.statSync(segmentFile);
              if (stat.size > 0) {
                alreadyDownloaded = true;
              }
            }
          } catch (e) {}

          if (alreadyDownloaded) {
            this.currentSegments++;
            await this.logProgress();
            activeDownloads--;
            startNext();
            return;
          }

          const downloadSegment = async (retryCount = 0) => {
            if (
              stopDownloading ||
              (global.isQueuePaused && global.isQueuePaused())
            )
              return;
            try {
              let Segment = this.Segments[index];
              if (!Segment) throw new Error("[ STOPPING ] Segment Missing!");

              const segUrl =
                typeof Segment === "object" ? Segment.url : Segment;
              let body;

              if (typeof Segment === "object" && Segment.encrypted) {
                if (!this._keyCache) this._keyCache = {};
                if (!this._keyCache[Segment.keyUrl]) {
                  const keyRes = await got(Segment.keyUrl, {
                    headers: this.headers ?? {},
                    responseType: "buffer",
                  });
                  this._keyCache[Segment.keyUrl] = keyRes.body;
                }
                const keyBuffer = this._keyCache[Segment.keyUrl];
                const iv = Buffer.alloc(16);
                if (
                  typeof Segment.iv === "string" &&
                  Segment.iv.startsWith("0x")
                ) {
                  Buffer.from(Segment.iv.slice(2), "hex").copy(iv);
                } else {
                  iv.writeUInt32BE(parseInt(Segment.iv, 10), 12);
                }
                const encRes = await got(segUrl, {
                  headers: this.headers ?? {},
                  responseType: "buffer",
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
                  headers: this.headers ?? {},
                  responseType: "buffer",
                });
                body = stripPngHeader(response.body);
              }

              await fs.promises.writeFile(segmentFile, body);
              this.currentSegments++;
              await this.logProgress();
              activeDownloads--;
              startNext();
            } catch (err) {
              const maxRetries = 5;
              if (retryCount >= maxRetries) {
                logger.warn(
                  `Failed to download segment ${index} after ${maxRetries} attempts: ${err.message}. Writing empty segment to continue.`,
                );
                failedSegmentsCount++;
                await fs.promises
                  .writeFile(segmentFile, Buffer.alloc(0))
                  .catch(() => {});
                this.currentSegments++;
                await this.logProgress();
                activeDownloads--;
                startNext();
                return;
              }
              const delay = Math.min(30000, 5000 * Math.pow(2, retryCount));
              this.logProgress(
                `Failed To Download Segment ${index}! ( Retrying in ${delay / 1000}s )`,
              );
              await new Promise((res) => setTimeout(res, delay));
              await downloadSegment(retryCount + 1);
            }
          };

          downloadSegment();
        };

        const workers = Math.min(CONCURRENCY, this.Segments.length);
        for (let w = 0; w < workers; w++) {
          startNext();
        }
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

          const subtitlePath = path.join(
            SubTitleDir,
            `${this.Epnum}Ep.${normalizedLang}.${ext === "vtt" ? "srt" : ext}`,
          );

          if (fs.existsSync(subtitlePath)) {
            this.downloadedPaths.push({
              path: subtitlePath,
              lang: normalizedLang,
              title: lang,
            });
            return;
          }

          const subHeaders = { ...(this.headers ?? {}) };
          try {
            const subHost = new URL(targetUrl).hostname;
            const streamHost = this.streamUrl
              ? new URL(this.streamUrl).hostname
              : "";
            if (subHost && streamHost && subHost !== streamHost) {
              delete subHeaders["Referer"];
              delete subHeaders["referer"];
            }
          } catch (e) {}

          let subtitleData;
          try {
            subtitleData = await got(targetUrl, { headers: subHeaders }).text();
          } catch (e) {
            subtitleData = await got(targetUrl).text();
          }

          if (ext === "vtt" || subtitleData.trim().startsWith("WEBVTT")) {
            subtitleData = this.convertToSRT(subtitleData);
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

  // Convert To Srt
  convertToSRT(content) {
    try {
      const lines = content.split(/\r?\n/);
      const srtLines = [];
      let index = 1;
      let buffer = [];
      let lastEnd = 0;

      const timeRegex =
        /^(\d{2}:)?\d{2}:\d{2}[\.,]\d{3} --> (\d{2}:)?\d{2}:\d{2}[\.,]\d{3}$/;

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim().replace(/<[^>]+>/g, "");

        if (!line || line.startsWith("WEBVTT")) continue;

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

          const adjustedStart = Math.max(startMs, lastEnd + 1);
          if (endMs <= adjustedStart) continue;

          lastEnd = endMs;

          buffer.push(`${this.toSRT(adjustedStart)} --> ${this.toSRT(endMs)}`);
        } else if (buffer.length) {
          buffer.push(line);
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
          `[Merge] Concatenated TS file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`,
        );
      } catch (e) {
        logger.error(`[Merge] Failed to check TS file size: ${e.message}`);
      }

      await new Promise((resolve, reject) => {
        const child = spawn(currentFfmpegPath, ffmpegArgs);
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

        child.on("close", (code) => {
          if (code !== 0) {
            logger.error(`[Merge] FFmpeg output:\n${ffmpegOutput}`);
            return reject(new Error(`FFmpeg exited with code ${code}`));
          }
          resolve();
        });

        child.on("error", (err) => {
          reject(new Error(`Failed to start FFmpeg: ${err.message}`));
        });
      });

      try {
        const stats = fs.statSync(this.mp4);
        logger.info(
          `[Merge] Output MP4 file size: ${(stats.size / 1024 / 1024).toFixed(2)} MB (${stats.size} bytes)`,
        );
      } catch (e) {
        logger.error(`[Merge] Failed to check MP4 file size: ${e.message}`);
      }

      this.currentSegments++;
      await this.logProgress();
      await this.CleanEverything();
    } catch (err) {
      await this.CleanEverything(true);
      throw err;
    }
  }

  getLangCodeFromFilename(filePath) {
    let FileName = path?.basename(filePath)?.split("_")?.[1];
    if (!FileName) return "und";
    FileName =
      FileName?.split(".srt")?.[0]?.slice(0, 3)?.toLocaleLowerCase() ?? "und";
    return FileName;
  }

  async logProgress(ExtraMessage) {
    let caption = this.caption;
    if (this.currentSegments >= this.totalSegments - 3) {
      caption = caption.replace("Downloading", "Merging");
    }

    if (ExtraMessage) caption += ExtraMessage;

    await fetch(`http://localhost:${global.PORT}/api/logger`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        caption: caption,
        totalSegments: this.totalSegments + 1,
        currentSegments: this.currentSegments,
        epid: this.EpID,
      }),
    }).catch((err) => {
      logger.error("Error updating download progress");
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
    });
  }

  async CleanEverything(everything = false) {
    await fs.promises.unlink(this.SegmentsFile).catch(() => {});

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
    await obj.CleanEverything();
    console.log(err);
    logger.error(err);
    throw new Error(err);
  }
}

module.exports = { download, getFfmpegPath, stripPngHeader };
