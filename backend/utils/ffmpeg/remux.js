const fs = require("fs");
const path = require("path");
const { logger } = require("../AppLogger");
const { FfmpegError, runFfmpeg } = require("./runner");
const { getFfmpegPath, isAndroidRuntime } = require("./binary");
const { probeMedia } = require("./probe");

const MKV_NATIVE_SUB_EXTS = new Set([".ass", ".ssa", ".srt", ".vtt"]);

let activeRemuxCount = 0;
const remuxWaiters = [];

function getRemuxConcurrencyLimit(settings = null, android = isAndroidRuntime()) {
  if (android) return 1;
  const parsed = parseInt(settings?.remuxConcurrency, 10);
  if (!Number.isFinite(parsed) || parsed < 1) return 1;
  return Math.min(parsed, 2);
}

async function acquireRemuxSlot(limit = 1) {
  const cap = Math.max(1, limit);
  if (activeRemuxCount < cap) {
    activeRemuxCount++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      activeRemuxCount = Math.max(0, activeRemuxCount - 1);
      while (remuxWaiters.length > 0 && activeRemuxCount < cap) {
        const next = remuxWaiters.shift();
        next();
      }
    };
  }

  await new Promise((resolve) => {
    remuxWaiters.push(resolve);
  });
  activeRemuxCount++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRemuxCount = Math.max(0, activeRemuxCount - 1);
    while (remuxWaiters.length > 0 && activeRemuxCount < cap) {
      const next = remuxWaiters.shift();
      next();
    }
  };
}

function sanitizeMetadataValue(value, fallback = "und") {
  const cleaned = String(value ?? "")
    .replace(/[\r\n\0]/g, " ")
    .trim();
  return cleaned || fallback;
}

/**
 * Builds deterministic FFmpeg arguments for remuxing TS/HLS or direct MP4 inputs with optional subtitles.
 */
function buildRemuxArgs({
  videoInput,
  audioInput = null,
  subtitles = [],
  outputPath,
  container = "mp4",
  includeSubs = true,
  transcodeAudio = false,
  ignoreErr = false,
  isDirectVideo = false,
  progressPipe = true,
}) {
  const targetContainer = container === "mkv" ? "mkv" : "mp4";
  const hasSeparateAudio = Boolean(audioInput);
  const subs = includeSubs && Array.isArray(subtitles) ? subtitles : [];
  const hasSubs = subs.length > 0;

  const args = ["-y", "-nostdin", "-hide_banner", "-loglevel", "warning"];
  if (progressPipe) {
    args.push("-progress", "pipe:1", "-nostats");
  }

  const inputFlags = isDirectVideo
    ? []
    : [
        "-fflags",
        "+discardcorrupt",
        ...(ignoreErr ? ["-err_detect", "ignore_err"] : []),
        "-analyzeduration",
        "50000000",
        "-probesize",
        "50000000",
      ];

  args.push(...inputFlags, "-i", videoInput);

  if (!isDirectVideo && hasSeparateAudio) {
    args.push(...inputFlags, "-i", audioInput);
  }

  const subStartIndex = !isDirectVideo && hasSeparateAudio ? 2 : 1;
  if (hasSubs) {
    for (const sub of subs) {
      if (String(sub.path || "").toLowerCase().endsWith(".m3u8")) {
        args.push("-allowed_extensions", "ALL");
      }
      args.push("-i", sub.path);
    }
  }

  if (isDirectVideo) {
    args.push("-map", "0:v?", "-map", "0:a?");
  } else if (hasSeparateAudio) {
    args.push("-map", "0:v", "-map", "1:a:0");
  } else {
    args.push("-map", "0:v", "-map", "0:a?");
  }

  if (hasSubs) {
    for (let i = 0; i < subs.length; i++) {
      args.push("-map", `${subStartIndex + i}:s`);
    }
  }

  args.push("-c:v", "copy");
  if (transcodeAudio) {
    args.push("-c:a", "aac", "-b:a", "192k");
  } else {
    args.push("-c:a", "copy");
  }

  if (hasSubs) {
    if (targetContainer === "mkv") {
      const allNative = subs.every((s) =>
        MKV_NATIVE_SUB_EXTS.has(path.extname(String(s.path || "")).toLowerCase()),
      );
      args.push("-c:s", allNative ? "copy" : "srt");
    } else {
      args.push("-c:s", "mov_text");
    }

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      args.push(
        `-metadata:s:s:${i}`,
        `language=${sanitizeMetadataValue(sub.lang, "und")}`,
      );
      if (sub.title) {
        args.push(
          `-metadata:s:s:${i}`,
          `title=${sanitizeMetadataValue(sub.title, "")}`,
        );
      }
    }
  }

  if (targetContainer === "mp4") {
    args.push("-movflags", "+faststart");
  }

  if (ignoreErr) {
    args.push("-max_muxing_queue_size", "1024");
  }

  args.push(outputPath);
  return args;
}

function isAudioPacketErrorText(stderrText) {
  const outText = String(stderrText || "");
  return (
    outText.includes("aac_adtstoasc") ||
    outText.includes("ADTS frame header") ||
    outText.includes("Error muxing a packet") ||
    outText.includes("Invalid data found")
  );
}

function buildFallbackConfigs(initialErr, hasSubs) {
  const isAudioErr = isAudioPacketErrorText(initialErr?.stderrTail);
  const configs = [];

  if (isAudioErr) {
    if (hasSubs) {
      configs.push({
        label: "audio repair + subtitles",
        includeSubs: true,
        transcodeAudio: true,
        ignoreErr: true,
      });
    }
    configs.push({
      label: "audio repair (video copy, audio AAC)",
      includeSubs: false,
      transcodeAudio: true,
      ignoreErr: true,
    });
  } else if (hasSubs) {
    configs.push({
      label: "video/audio only (no subtitles)",
      includeSubs: false,
      transcodeAudio: false,
      ignoreErr: true,
    });
    configs.push({
      label: "audio repair (video copy, audio AAC)",
      includeSubs: false,
      transcodeAudio: true,
      ignoreErr: true,
    });
  } else {
    configs.push({
      label: "audio repair (video copy, audio AAC)",
      includeSubs: false,
      transcodeAudio: true,
      ignoreErr: true,
    });
  }

  return configs;
}

/**
 * Remuxes downloaded media into the configured container with fallback repair and atomic promotion.
 */
async function remuxMedia({
  videoInput,
  audioInput = null,
  subtitles = [],
  outputPath,
  container = "mp4",
  isDirectVideo = false,
  durationSec = null,
  signal = null,
  onProgress = null,
  binaryPath = null,
  concurrencyLimit = null,
  settingsLoader = null,
  spawnImpl = null,
  fsImpl = fs,
}) {
  if (signal?.aborted) {
    throw new FfmpegError("Remux aborted", { code: "ABORTED" });
  }

  let limit = concurrencyLimit;
  if (!limit) {
    let settings = null;
    try {
      if (typeof settingsLoader === "function") {
        settings = await settingsLoader();
      } else {
        const { settingfetch } = require("../settings");
        settings = await settingfetch();
      }
    } catch (_) {}
    limit = getRemuxConcurrencyLimit(settings);
  }

  const releaseSlot = await acquireRemuxSlot(limit);
  const targetExt = container === "mkv" ? "mkv" : "mp4";
  const tempOutput = `${outputPath}.remux.${targetExt}`;

  try {
    const bin = binaryPath || (await getFfmpegPath());
    const effectiveAudio =
      audioInput && fsImpl.existsSync(audioInput) ? audioInput : null;
    const validSubs = Array.isArray(subtitles) ? subtitles : [];
    const hasSubs = validSubs.length > 0;

    let knownDuration = durationSec;
    if (!Number.isFinite(knownDuration) || knownDuration <= 0) {
      try {
        const probed = await probeMedia(videoInput, {
          binaryPath: bin,
          spawnImpl: spawnImpl || undefined,
        });
        if (Number.isFinite(probed.durationSec) && probed.durationSec > 0) {
          knownDuration = probed.durationSec;
        }
      } catch (_) {}
    }

    const runAttempt = async (cfg) => {
      const args = buildRemuxArgs({
        videoInput,
        audioInput: effectiveAudio,
        subtitles: validSubs,
        outputPath: tempOutput,
        container: targetExt,
        includeSubs: cfg.includeSubs,
        transcodeAudio: cfg.transcodeAudio,
        ignoreErr: cfg.ignoreErr,
        isDirectVideo,
        progressPipe: true,
      });

      await runFfmpeg(args, {
        binaryPath: bin,
        signal,
        durationSec: knownDuration,
        onProgress: typeof onProgress === "function" ? (p) => onProgress(p) : null,
        spawnImpl: spawnImpl || undefined,
      });
    };

    let strategy = "primary";
    let lastError = null;
    let succeeded = false;

    try {
      await runAttempt({
        includeSubs: hasSubs,
        transcodeAudio: false,
        ignoreErr: false,
      });
      succeeded = true;
    } catch (initialErr) {
      if (initialErr?.code === "ABORTED" || signal?.aborted) {
        throw initialErr;
      }
      lastError = initialErr;
      const fallbacks = buildFallbackConfigs(initialErr, hasSubs);
      for (const cfg of fallbacks) {
        if (signal?.aborted) {
          throw new FfmpegError("Remux aborted", { code: "ABORTED" });
        }
        logger.warn(
          `[Video Remux] Initial remux failed (${lastError.message}). Retrying with ${cfg.label}...`,
        );
        await fsImpl.promises.unlink(tempOutput).catch(() => {});
        try {
          await runAttempt(cfg);
          strategy = cfg.label;
          succeeded = true;
          break;
        } catch (fallbackErr) {
          if (fallbackErr?.code === "ABORTED" || signal?.aborted) {
            throw fallbackErr;
          }
          logger.warn(
            `[Video Remux] Fallback remux (${cfg.label}) failed: ${fallbackErr.message}`,
          );
          lastError = fallbackErr;
        }
      }
    }

    if (!succeeded || !fsImpl.existsSync(tempOutput)) {
      throw (
        lastError ||
        new FfmpegError("FFmpeg remux did not produce output file", {
          code: "INVALID_OUTPUT",
        })
      );
    }

    const tempStats = fsImpl.statSync(tempOutput);
    if (tempStats.size <= 0) {
      throw new FfmpegError("Remux produced an empty output file", {
        code: "INVALID_OUTPUT",
      });
    }

    if (!isDirectVideo) {
      let tsStats = null;
      try {
        tsStats = fsImpl.statSync(videoInput);
      } catch (_) {}
      if (
        tempStats.size < 1024 * 1024 &&
        tsStats &&
        tsStats.size > 2 * 1024 * 1024
      ) {
        throw new FfmpegError(
          `Output ${targetExt.toUpperCase()} is suspiciously small (${tempStats.size} bytes vs ${tsStats.size} bytes TS), likely missing video stream`,
          { code: "INVALID_OUTPUT" },
        );
      }
    }

    await fsImpl.promises.unlink(outputPath).catch(() => {});
    await fsImpl.promises.rename(tempOutput, outputPath);

    const finalStats = fsImpl.statSync(outputPath);
    return {
      outputPath,
      strategy,
      sizeBytes: finalStats.size,
    };
  } catch (err) {
    await fsImpl.promises.unlink(tempOutput).catch(() => {});
    throw err;
  } finally {
    releaseSlot();
  }
}

module.exports = {
  MKV_NATIVE_SUB_EXTS,
  getRemuxConcurrencyLimit,
  acquireRemuxSlot,
  sanitizeMetadataValue,
  buildRemuxArgs,
  buildFallbackConfigs,
  remuxMedia,
};
