const { spawn } = require("child_process");
const { logger } = require("./AppLogger");
const ffmpeg = require("ffmpeg-static");
const iso6391 = require("iso-639-1");
const path = require("path");
const got = require("got").default || require("got");
const fs = require("fs");
const { getHeaders } = require("./proxyHeaders");

const ffmpegPath = ffmpeg.replace("app.asar", "app.asar.unpacked");

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
        const lines = Playlist.split("\n").map((line) => line.trim());
        const streams = [];
        let currentInfo = null;

        for (const line of lines) {
          if (line.startsWith("#EXT-X-STREAM-INF:")) {
            currentInfo = line;
          } else if (line && !line.startsWith("#")) {
            try {
              const absoluteUrl = new URL(line, this.streamUrl).href;
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
            streams.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
            selectedStream = streams[0];
          }

          this.streamUrl = selectedStream.url;
          Playlist = await got(this.streamUrl, {
            headers: this.headers ?? {},
          }).text();

          if (!Playlist) throw new Error("No Stream Found for selected quality!");
        }
      }

      let Segments = [];
      const lines = Playlist.split("\n").map((line) => line.trim());
      for (const line of lines) {
        if (line && !line.startsWith("#")) {
          try {
            const absoluteUrl = new URL(line, this.streamUrl).href;
            Segments.push(absoluteUrl);
          } catch (e) {
            Segments.push(line);
          }
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

      let FailedSegments = 0;
      let i = 0;

      while (i < this.Segments.length) {
        const segmentFile = path.join(tempDir, `${i}.ts`);
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
          i++;
          continue;
        }

        try {
          let Segment = this.Segments[i];
          if (!Segment) throw new Error("[ STOPPING ] Segment Missing!");

          const response = await got(Segment, {
            headers: this.headers ?? {},
            responseType: "buffer",
          });

          await fs.promises.writeFile(segmentFile, response.body);
          this.currentSegments++;
          await this.logProgress();
          i++;
          FailedSegments = 0;
        } catch (err) {
          if (FailedSegments > 3)
            throw new Error(
              "[ STOPPING ] '3' Times Segment Failed To Download!",
            );
          FailedSegments++;
          this.logProgress(`Failed To Download Segment! ( Continuing in 5s )`);
          console.log(err);
          await new Promise((res) => setTimeout(res, 5000));
        }
      }

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
          const normalizedLang =
            iso6391.getCode(lang) ||
            (() => {
              const cleaned = (lang ?? "")
                .trim()
                .replace(/[^a-z]/gi, "")
                .toLowerCase();
              return cleaned ? cleaned?.slice(0, 3) : "und";
            })();

          const urlObj = new URL(url);
          const baseName = path.basename(urlObj.pathname);
          const ext = path.extname(baseName).replace(".", "") || "srt";

          let finalExt = ext;
          let subtitleData = await got(url, {
            headers: this.headers ?? {},
          }).text();

          if (ext === "vtt") {
            subtitleData = this.convertToSRT(subtitleData);
            finalExt = "srt";
          }

          const subtitlePath = path.join(
            SubTitleDir,
            `${this.Epnum}Ep.${normalizedLang}.${finalExt}`,
          );

          if (!fs.existsSync(subtitlePath)) {
            await fs.promises.writeFile(subtitlePath, subtitleData, "utf8");
            this.downloadedPaths.push(subtitlePath);
          }
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

  // Merge .ts to mp4
  async MergeSegments() {
    try {
      const ffmpegArgs = [
        "-y",
        "-i",
        this.SegmentsFile,
        "-c",
        "copy",
        this.mp4,
      ];

      await new Promise((resolve, reject) => {
        const child = spawn(ffmpegPath, ffmpegArgs);

        child.on("close", (code) => {
          if (code !== 0) {
            return reject(new Error(`FFmpeg exited with code ${code}`));
          }
          resolve();
        });

        child.on("error", (err) => {
          reject(new Error(`Failed to start FFmpeg: ${err.message}`));
        });
      });

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

module.exports = { download };
