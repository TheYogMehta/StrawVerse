const fs = require("fs");
const os = require("os");
const path = require("path");
const { logger } = require("../AppLogger");
const {
  gracefulKill,
  redactSensitiveArgs,
  spawnTrackedFfmpeg,
} = require("./runner");
const {
  detectHardwareEncoders,
  getFfmpegPath,
  resolveActiveEncoder,
} = require("./binary");

/**
 * Escapes a subtitle path for FFmpeg's libavfilter `subtitles=...` filtergraph syntax.
 */
function escapeSubtitleFilterPath(subFilePath) {
  return String(subFilePath || "")
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/**
 * Returns FFmpeg video encoder flags and optional filter suffix for a given encoder ID.
 */
function getEncoderProfileArgs(encoderId) {
  switch (encoderId) {
    case "videotoolbox":
      return {
        preInputArgs: [],
        vfSuffix: null,
        codecArgs: [
          "-c:v",
          "h264_videotoolbox",
          "-realtime",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          "4500k",
          "-maxrate",
          "6000k",
          "-bufsize",
          "9000k",
          "-g",
          "48",
        ],
      };
    case "nvenc":
      return {
        preInputArgs: [],
        vfSuffix: null,
        codecArgs: [
          "-c:v",
          "h264_nvenc",
          "-preset",
          "p1",
          "-tune",
          "ll",
          "-zerolatency",
          "1",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          "4500k",
          "-maxrate",
          "6000k",
          "-bufsize",
          "9000k",
          "-g",
          "48",
        ],
      };
    case "qsv":
      return {
        preInputArgs: [],
        vfSuffix: null,
        codecArgs: [
          "-c:v",
          "h264_qsv",
          "-preset",
          "veryfast",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          "4500k",
          "-maxrate",
          "6000k",
          "-bufsize",
          "9000k",
          "-g",
          "48",
        ],
      };
    case "amf":
      return {
        preInputArgs: [],
        vfSuffix: null,
        codecArgs: [
          "-c:v",
          "h264_amf",
          "-quality",
          "speed",
          "-pix_fmt",
          "yuv420p",
          "-b:v",
          "4500k",
          "-maxrate",
          "6000k",
          "-bufsize",
          "9000k",
          "-g",
          "48",
        ],
      };
    case "vaapi":
      return {
        preInputArgs: ["-vaapi_device", "/dev/dri/renderD128"],
        vfSuffix: "format=nv12,hwupload",
        codecArgs: [
          "-c:v",
          "h264_vaapi",
          "-b:v",
          "4500k",
          "-maxrate",
          "6000k",
          "-bufsize",
          "9000k",
          "-g",
          "48",
        ],
      };
    case "software":
    default:
      return {
        preInputArgs: [],
        vfSuffix: null,
        codecArgs: [
          "-c:v",
          "libx264",
          "-preset",
          "ultrafast",
          "-tune",
          "zerolatency",
          "-pix_fmt",
          "yuv420p",
          "-crf",
          "22",
          "-g",
          "48",
        ],
      };
  }
}

/**
 * Builds FFmpeg arguments for live HLS subtitle burn-in transcoding.
 */
function buildCastBurnArgs({
  inputSource,
  isRemote = false,
  headers = {},
  position = 0,
  subFilePath,
  hlsDir,
  encoderId = "software",
}) {
  const profile = getEncoderProfileArgs(encoderId);
  const args = [
    "-y",
    "-nostdin",
    "-hide_banner",
    "-loglevel",
    "warning",
    "-allowed_extensions",
    "ALL",
    "-allowed_segment_extensions",
    "ALL",
    "-extension_picky",
    "0",
    ...profile.preInputArgs,
  ];

  if (isRemote && headers && typeof headers === "object") {
    const headerLines =
      Object.entries(headers)
        .filter(([, v]) => v !== undefined && v !== null && String(v) !== "")
        .map(([k, v]) => `${k}: ${v}`)
        .join("\r\n") + "\r\n";
    if (headerLines.trim()) {
      args.push("-headers", headerLines);
    }
  }

  if (Number.isFinite(position) && position > 0) {
    args.push("-ss", String(position));
  }

  args.push("-i", inputSource);

  const escapedSubPath = escapeSubtitleFilterPath(subFilePath);
  const subFilter = `subtitles='${escapedSubPath}':force_style='FontSize=22,Outline=2,Shadow=1,MarginV=25'`;
  const vf = profile.vfSuffix ? `${subFilter},${profile.vfSuffix}` : subFilter;
  args.push("-vf", vf);

  args.push(...profile.codecArgs);
  args.push("-c:a", "copy");
  args.push(
    "-f",
    "hls",
    "-hls_time",
    "2",
    "-hls_list_size",
    "25",
    "-hls_flags",
    "delete_segments",
    "-hls_segment_filename",
    path.join(hlsDir, "seg_%04d.ts"),
    path.join(hlsDir, "index.m3u8"),
  );

  return args;
}

/**
 * Waits for the first HLS segment (`seg_`) to appear in `index.m3u8`,
 * aborting early if the spawned FFmpeg process exits prematurely.
 */
async function waitForFirstSegment(child, hlsDir, timeoutMs = 15000, fsImpl = fs) {
  const m3u8Path = path.join(hlsDir, "index.m3u8");
  const startWait = Date.now();
  let exitedEarly = child.exitCode !== null || child.signalCode !== null;
  let exitCode = child.exitCode ?? null;

  const onExit = (code) => {
    exitedEarly = true;
    if (exitCode === null && code !== undefined) {
      exitCode = code;
    }
  };
  child.once("exit", onExit);
  child.once("close", onExit);

  try {
    while (Date.now() - startWait < timeoutMs) {
      if (fsImpl.existsSync(m3u8Path)) {
        try {
          const content = fsImpl.readFileSync(m3u8Path, "utf8");
          if (content.includes("seg_")) {
            return { ready: true, exitedEarly: false, exitCode: null, elapsedMs: Date.now() - startWait };
          }
        } catch (_) {}
      }
      if (exitedEarly || child.exitCode !== null || child.signalCode !== null) {
        return {
          ready: false,
          exitedEarly: true,
          exitCode: exitCode ?? child.exitCode ?? null,
          elapsedMs: Date.now() - startWait,
        };
      }
      await new Promise((r) => setTimeout(r, 80));
    }
    return { ready: false, exitedEarly: false, exitCode: null, elapsedMs: Date.now() - startWait };
  } finally {
    child.removeListener("exit", onExit);
    child.removeListener("close", onExit);
  }
}

/**
 * Starts a Cast hardsubbing FFmpeg session with cross-platform HW acceleration
 * and automatic one-shot software fallback if HW encoding fails before the first segment.
 */
async function startCastBurn({
  mediaUrl = "",
  filePath = "",
  subFilePath,
  headers = {},
  position = 0,
  hlsDir,
  preferredEncoder = null,
  binaryPath = null,
  settingsLoader = null,
  spawnImpl = null,
  fsImpl = fs,
  startupTimeoutMs = 15000,
}) {
  const bin = binaryPath || (await getFfmpegPath());

  let pref = preferredEncoder;
  if (!pref) {
    try {
      const cfg =
        typeof settingsLoader === "function"
          ? await settingsLoader()
          : await require("../settings").settingfetch();
      pref = cfg?.castHwEncoder || "auto";
    } catch (_) {
      pref = "auto";
    }
  }

  const detected = await detectHardwareEncoders({
    binaryPath: bin,
    spawnImpl: spawnImpl || undefined,
  });
  let chosenEncoder = resolveActiveEncoder(pref, detected);

  const inputSource = filePath || mediaUrl;
  const isRemote = Boolean(
    !filePath &&
      mediaUrl &&
      (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")),
  );

  const launch = (encoderId) => {
    const args = buildCastBurnArgs({
      inputSource,
      isRemote,
      headers,
      position,
      subFilePath,
      hlsDir,
      encoderId,
    });

    logger.info(
      `[cast-burn] Spawning FFmpeg hardsubbing (encoder=${encoderId}): ${bin} ${redactSensitiveArgs(args).join(" ")}`,
    );

    const child = spawnTrackedFfmpeg(bin, args, {
      stdio: ["ignore", "pipe", "pipe"],
      spawnImpl: spawnImpl || undefined,
    });

    child.stderr?.on("data", (data) => {
      const str = data.toString("utf8");
      if (str.includes("Error") || str.includes("fatal") || str.includes("error")) {
        logger.warn(`[cast-burn] FFmpeg: ${str.trim()}`);
      }
    });

    child.on("exit", (code, signal) => {
      logger.info(
        `[cast-burn] FFmpeg process (${encoderId}) exited with code ${code}, signal ${signal}`,
      );
    });

    return child;
  };

  let child = launch(chosenEncoder);
  let status = await waitForFirstSegment(child, hlsDir, startupTimeoutMs, fsImpl);

  if (!status.ready && status.exitedEarly && chosenEncoder !== "software") {
    logger.warn(
      `[cast-burn] Hardware encoder ${chosenEncoder} exited prematurely (code=${status.exitCode}); retrying with software libx264`,
    );
    await gracefulKill(child);
    chosenEncoder = "software";
    child = launch("software");
    status = await waitForFirstSegment(child, hlsDir, startupTimeoutMs, fsImpl);
  }

  if (status.ready) {
    logger.info(
      `[cast-burn] Burned HLS stream ready in ${status.elapsedMs}ms (encoder=${chosenEncoder})`,
    );
  } else {
    logger.warn(`[cast-burn] Timeout waiting for index.m3u8, proceeding anyway`);
  }

  return {
    child,
    encoder: chosenEncoder,
    ready: status.ready,
    stop: () => gracefulKill(child),
  };
}

/**
 * Removes orphaned temporary cast directories and subtitle files left in `os.tmpdir()`.
 */
function sweepOrphanedCastDirs(tmpDir = os.tmpdir(), maxAgeMs = 0, fsImpl = fs) {
  let removed = 0;
  try {
    const entries = fsImpl.readdirSync(tmpDir, { withFileTypes: true });
    const now = Date.now();
    for (const entry of entries) {
      const isCastDir = entry.isDirectory() && entry.name.startsWith("strawverse_cast_");
      const isCastSub =
        entry.isFile() &&
        entry.name.startsWith("strawverse_sub_") &&
        entry.name.endsWith(".srt");
      if (!isCastDir && !isCastSub) continue;

      const fullPath = path.join(tmpDir, entry.name);
      try {
        if (maxAgeMs > 0) {
          const stat = fsImpl.statSync(fullPath);
          if (now - stat.mtimeMs < maxAgeMs) continue;
        }
        if (isCastDir) {
          fsImpl.rmSync(fullPath, { recursive: true, force: true });
        } else {
          fsImpl.unlinkSync(fullPath);
        }
        removed++;
      } catch (_) {}
    }
  } catch (_) {}
  return removed;
}

module.exports = {
  escapeSubtitleFilterPath,
  getEncoderProfileArgs,
  buildCastBurnArgs,
  waitForFirstSegment,
  startCastBurn,
  sweepOrphanedCastDirs,
};
