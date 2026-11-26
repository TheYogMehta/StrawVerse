const fs = require("fs");
const path = require("path");
const { logger } = require("../AppLogger");
const { runFfmpeg } = require("./runner");
const { getFfmpegPath } = require("./binary");

const BITMAP_SUBTITLE_CODECS = new Set([
  "hdmv_pgs_subtitle",
  "pgssub",
  "dvd_subtitle",
  "dvdsub",
  "dvb_subtitle",
  "dvbsub",
  "xsub",
  "vobsub",
]);

/**
 * Parses `ffmpeg -i <file>` stderr output into duration and stream lists.
 * @param {string} stderrOutput
 */
function parseMediaProbeOutput(stderrOutput) {
  const output = String(stderrOutput || "");
  let durationSec = null;

  const durMatch = output.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/i);
  if (durMatch) {
    const h = Number(durMatch[1]);
    const m = Number(durMatch[2]);
    const s = Number(durMatch[3]);
    if (Number.isFinite(h) && Number.isFinite(m) && Number.isFinite(s)) {
      durationSec = h * 3600 + m * 60 + s;
    }
  }

  const videoStreams = [];
  const audioStreams = [];
  const subtitleStreams = [];

  for (const line of output.split(/\r?\n/)) {
    const m = line.match(
      /Stream\s+#0:(\d+)(?:\(([^)]+)\))?[^:]*:\s*(Video|Audio|Subtitle):\s*([^\s(,]+)/i,
    );
    if (!m) continue;

    const index = parseInt(m[1], 10);
    const rawLang = (m[2] || "und").trim().toLowerCase();
    const kind = m[3].toLowerCase();
    const codec = m[4].trim().toLowerCase();

    if (kind === "video") {
      videoStreams.push({ index, codec });
    } else if (kind === "audio") {
      audioStreams.push({ index, codec, lang: rawLang });
    } else if (kind === "subtitle") {
      subtitleStreams.push({ index, codec, lang: rawLang });
    }
  }

  return {
    durationSec,
    videoStreams,
    audioStreams,
    subtitleStreams,
  };
}

/**
 * Probes media file metadata using `ffmpeg -i` (no ffprobe binary required).
 */
async function probeMedia(inputPath, { binaryPath = null, spawnImpl, timeoutMs = 15000 } = {}) {
  const bin = binaryPath || (await getFfmpegPath());
  const res = await runFfmpeg(["-hide_banner", "-nostdin", "-i", inputPath], {
    binaryPath: bin,
    allowNonZeroExit: true,
    timeoutMs,
    spawnImpl,
  });

  return parseMediaProbeOutput(res.stderrTail);
}

function sanitizeSubLang(rawLang) {
  const cleaned = String(rawLang || "en")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "");
  return (cleaned || "en").slice(0, 3);
}

/**
 * Builds deterministic, collision-free subtitle output descriptors for each text subtitle stream.
 */
function planSubtitleExtractions(subtitleStreams, subsDir, epNum) {
  const langCounts = new Map();
  const plans = [];

  for (const stream of subtitleStreams) {
    if (BITMAP_SUBTITLE_CODECS.has(stream.codec)) {
      continue;
    }
    const lang = sanitizeSubLang(stream.lang || "en");
    const seenCount = (langCounts.get(lang) || 0) + 1;
    langCounts.set(lang, seenCount);

    const suffix = seenCount === 1 ? lang : `${lang}.${seenCount}`;
    const outFile = path.join(subsDir, `${epNum}Ep.${suffix}.vtt`);
    plans.push({
      streamIndex: stream.index,
      codec: stream.codec,
      lang,
      outFile,
    });
  }

  return plans;
}

/**
 * Extracts all text subtitle streams from a local video into `subsDir` as `.vtt` in a single FFmpeg pass,
 * falling back to per-stream extraction only if a stream causes the batch pass to fail.
 */
async function extractSubtitlesSinglePass(
  videoPath,
  subsDir,
  epNum,
  { binaryPath = null, spawnImpl, fsImpl = fs } = {},
) {
  try {
    const bin = binaryPath || (await getFfmpegPath());
    if (!bin) return [];

    const probe = await probeMedia(videoPath, { binaryPath: bin, spawnImpl });
    if (!probe.subtitleStreams || probe.subtitleStreams.length === 0) {
      return [];
    }

    const plans = planSubtitleExtractions(probe.subtitleStreams, subsDir, epNum);
    if (plans.length === 0) return [];

    if (!fsImpl.existsSync(subsDir)) {
      fsImpl.mkdirSync(subsDir, { recursive: true });
    }

    const singlePassArgs = [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      videoPath,
    ];
    for (const plan of plans) {
      singlePassArgs.push("-map", `0:${plan.streamIndex}`, "-c:s", "webvtt", plan.outFile);
    }

    try {
      await runFfmpeg(singlePassArgs, {
        binaryPath: bin,
        timeoutMs: 60000,
        spawnImpl,
      });
      return plans
        .filter((p) => fsImpl.existsSync(p.outFile))
        .map((p) => ({
          url: `/subtitles?file=${encodeURIComponent(p.outFile)}`,
          lang: p.lang,
        }));
    } catch (batchErr) {
      logger.warn(
        `[SubtitleExtract] Single-pass extraction failed (${batchErr.message}), retrying per-stream`,
      );
      const extracted = [];
      for (const plan of plans) {
        try {
          await runFfmpeg(
            [
              "-y",
              "-nostdin",
              "-hide_banner",
              "-loglevel",
              "error",
              "-i",
              videoPath,
              "-map",
              `0:${plan.streamIndex}`,
              "-c:s",
              "webvtt",
              plan.outFile,
            ],
            { binaryPath: bin, timeoutMs: 30000, spawnImpl },
          );
          if (fsImpl.existsSync(plan.outFile)) {
            extracted.push({
              url: `/subtitles?file=${encodeURIComponent(plan.outFile)}`,
              lang: plan.lang,
            });
          }
        } catch (_) {}
      }
      return extracted;
    }
  } catch (err) {
    logger.error(`[SubtitleExtract] Failed for ${videoPath}: ${err.message}`);
    return [];
  }
}

module.exports = {
  BITMAP_SUBTITLE_CODECS,
  parseMediaProbeOutput,
  probeMedia,
  sanitizeSubLang,
  planSubtitleExtractions,
  extractSubtitlesSinglePass,
};
