const { spawn } = require("child_process");
const { logger } = require("./AppLogger");
const ffmpeg = require("ffmpeg-static");
const iso6391 = require("iso-639-1");
const path = require("path");
const got = require("got");
const fs = require("fs");

const ffmpegPath = ffmpeg.replace("app.asar", "app.asar.unpacked");

class downloader {
  constructor({
    directory,
    streamUrl,
    Epnum = NaN,
    caption,
    EpID,
    subtitles = [],
    MergeSubtitles = false,
    ChangeTosrt = false,
  }) {
    this.directory = directory;
    if (streamUrl?.url) {
      this.streamUrl = streamUrl.url;
      this.headers = streamUrl.headers ?? {};
    } else {
      this.streamUrl = streamUrl;
      this.headers = {};
    }
    
    if (this.streamUrl && (this.streamUrl.includes('owocdn.top') || this.streamUrl.includes('kwik.cx'))) {
      this.headers['Referer'] = 'https://kwik.cx/';
      this.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
    }
    this.Epnum = parseInt(Epnum);
    this.caption = caption;
    this.EpID = EpID;
    this.subtitles =
      subtitles?.length > 0
        ? subtitles?.filter(({ lang }) => lang !== "Thumbnails") ?? []
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
      let Segments = Playlist.split("\n")
        .map((line) => line.trim())
        .filter((line) => line.startsWith("https://"));

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
      let FailedSegments = 0;
      this.writer = fs.createWriteStream(this.SegmentsFile, {
        flags: "a",
        encoding: null,
      });
      this.writer.on("error", (err) => {
        throw err;
      });

      while (this.Segments.length > 0) {
        try {
          let Segment = this.Segments[0];
          if (!Segment) throw new Error("[ STOPPING ] Segment Missing!");
          await this.appendSegment(Segment);
          this.Segments.shift();
          this.currentSegments++;
          await this.logProgress();
        } catch (err) {
          if (FailedSegments > 3)
            throw new Error(
              "[ STOPPING ] '3' Times Segment Failed To Download!"
            );
          FailedSegments++;
          this.logProgress(`Failed To Download Segment! ( Continuing in 5s )`);
          console.log(err);
          await new Promise((res) => setTimeout(res, 5000)); // 5s delay
        }
      }

      await new Promise((resolve) => {
        this.writer.end(resolve);
      });
    } catch (err) {
      throw new Error(err);
    }
  }

  async appendSegment(segmentUrl) {
    try {
      const response = await got(segmentUrl, {
        headers: this.headers ?? {},
        responseType: "buffer",
      });

      await new Promise((resolve, reject) => {
        this.writer.write(response.body, (err) => {
          if (err) return reject(err);
          resolve();
        });
      });
    } catch (err) {
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
          let subtitleData = await got(url).text();

          if (ext === "vtt") {
            subtitleData = this.convertToSRT(subtitleData);
            finalExt = "srt";
          }

          const subtitlePath = path.join(
            SubTitleDir,
            `${this.Epnum}Ep.${normalizedLang}.${finalExt}`
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
    // remove ts file
    await fs.promises.unlink(this.SegmentsFile).catch(() => {});

    // remove mp4 ( only on error )
    if (everything) {
      await fs.promises.unlink(this.mp4).catch(() => {});
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
