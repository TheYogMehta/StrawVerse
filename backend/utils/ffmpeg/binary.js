const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { logger } = require("../AppLogger");
const { runFfmpeg } = require("./runner");

const ENCODER_IDS = Object.freeze([
  "auto",
  "videotoolbox",
  "nvenc",
  "qsv",
  "amf",
  "vaapi",
  "software",
]);

const HW_ENCODER_PROFILES = {
  videotoolbox: {
    codec: "h264_videotoolbox",
    probeArgs: [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      "h264_videotoolbox",
      "-f",
      "null",
      "-",
    ],
  },
  nvenc: {
    codec: "h264_nvenc",
    probeArgs: [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      "h264_nvenc",
      "-f",
      "null",
      "-",
    ],
  },
  qsv: {
    codec: "h264_qsv",
    probeArgs: [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      "h264_qsv",
      "-f",
      "null",
      "-",
    ],
  },
  amf: {
    codec: "h264_amf",
    probeArgs: [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=0.1",
      "-frames:v",
      "1",
      "-c:v",
      "h264_amf",
      "-f",
      "null",
      "-",
    ],
  },
  vaapi: {
    codec: "h264_vaapi",
    probeArgs: [
      "-y",
      "-nostdin",
      "-hide_banner",
      "-vaapi_device",
      "/dev/dri/renderD128",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:s=64x64:d=0.1",
      "-frames:v",
      "1",
      "-vf",
      "format=nv12,hwupload",
      "-c:v",
      "h264_vaapi",
      "-f",
      "null",
      "-",
    ],
  },
};

let cachedBinary = null; // { path, source, version }
let cachedEncoders = null; // string[]
let encoderProbeInFlight = null;

function isAndroidRuntime() {
  return Boolean(
    process.env.NODEJS_MOBILE_DATA_DIR ||
      process.env.NATIVE_LIB_DIR ||
      process.env.DATADIR ||
      process.platform === "android",
  );
}

function invalidateBinaryCache() {
  cachedBinary = null;
  cachedEncoders = null;
}

function parseVersionString(output) {
  if (!output) return null;
  const match = String(output).match(/ffmpeg version\s+([^\s]+)/i);
  return match ? match[1] : null;
}

/**
 * Validates that a candidate Desktop FFmpeg binary path is an absolute path to an executable file
 * and exits cleanly on `ffmpeg -version`.
 */
async function validateFfmpegBinary(
  candidatePath,
  {
    fsImpl = fs,
    spawnImpl = spawn,
    platform = process.platform,
    timeoutMs = 3000,
  } = {},
) {
  if (!candidatePath || typeof candidatePath !== "string") {
    return { valid: false, path: null, version: null, error: "Empty binary path" };
  }
  const trimmed = candidatePath.trim();
  if (!path.isAbsolute(trimmed)) {
    return {
      valid: false,
      path: trimmed,
      version: null,
      error: "Custom FFmpeg path must be an absolute path",
    };
  }

  try {
    const stat = fsImpl.statSync(trimmed);
    if (!stat.isFile()) {
      return {
        valid: false,
        path: trimmed,
        version: null,
        error: "Path is not a regular file",
      };
    }
    if (platform !== "win32") {
      fsImpl.accessSync(trimmed, fsImpl.constants.X_OK);
    }
  } catch (err) {
    return {
      valid: false,
      path: trimmed,
      version: null,
      error: `Binary not accessible: ${err.message}`,
    };
  }

  try {
    const res = await runFfmpeg(["-version"], {
      binaryPath: trimmed,
      timeoutMs,
      allowNonZeroExit: false,
      spawnImpl,
    });
    const combined = res.stderrTail || "";
    const version = parseVersionString(combined);
    return { valid: true, path: trimmed, version, error: null };
  } catch (err) {
    return {
      valid: false,
      path: trimmed,
      version: null,
      error: err.message,
    };
  }
}

async function readVersionSafe(binPath, { spawnImpl = spawn } = {}) {
  try {
    let version = null;
    await new Promise((resolve) => {
      const child = spawnImpl(binPath, ["-version"], {
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      const timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch (_) {}
        resolve();
      }, 3000);
      if (typeof timer.unref === "function") timer.unref();

      child.stdout?.on("data", (d) => {
        out += d.toString("utf8");
      });
      child.stderr?.on("data", (d) => {
        out += d.toString("utf8");
      });
      child.once("error", () => {
        clearTimeout(timer);
        resolve();
      });
      child.once("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          version = parseVersionString(out);
        }
        resolve();
      });
    });
    return version;
  } catch (_) {
    return null;
  }
}

async function loadCustomPathFromSettings(settingsLoader) {
  if (typeof settingsLoader === "function") {
    try {
      const cfg = await settingsLoader();
      return typeof cfg?.ffmpegCustomPath === "string"
        ? cfg.ffmpegCustomPath.trim()
        : "";
    } catch (_) {
      return "";
    }
  }
  try {
    const { settingfetch } = require("../settings");
    const cfg = await settingfetch();
    return typeof cfg?.ffmpegCustomPath === "string"
      ? cfg.ffmpegCustomPath.trim()
      : "";
  } catch (_) {
    return "";
  }
}

/**
 * Resolves the FFmpeg binary across Android and Desktop platforms.
 */
async function resolveFfmpegBinary({
  fsImpl = fs,
  spawnImpl = spawn,
  settingsLoader = null,
  forceRefresh = false,
  platform = process.platform,
  android = isAndroidRuntime(),
} = {}) {
  if (!forceRefresh && cachedBinary && cachedBinary.path) {
    if (cachedBinary.source === "fallback" || fsImpl.existsSync(cachedBinary.path)) {
      return cachedBinary;
    }
    cachedBinary = null;
  }

  if (android) {
    const candidateNativeDirs = [];
    if (process.env.NATIVE_LIB_DIR) {
      candidateNativeDirs.push(process.env.NATIVE_LIB_DIR);
    }

    try {
      const maps = fsImpl.readFileSync("/proc/self/maps", "utf-8");
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
      if (fsImpl.existsSync(ffmpegPath)) {
        logger.info(`FFmpeg binary found in native library directory: ${ffmpegPath}`);
        const version = await readVersionSafe(ffmpegPath, { spawnImpl });
        cachedBinary = { path: ffmpegPath, source: "android-jni", version };
        return cachedBinary;
      }
    }

    throw new Error(
      "FFmpeg binary (libffmpeg.so) not found in APK. " +
        "Rebuild the app with 'node capacitor/scripts/fetch-ffmpeg.mjs' " +
        "to bundle FFmpeg, then reinstall.",
    );
  }

  // Desktop: 1. Custom path override (if configured & valid)
  const customPath = await loadCustomPathFromSettings(settingsLoader);
  if (customPath) {
    const check = await validateFfmpegBinary(customPath, {
      fsImpl,
      spawnImpl,
      platform,
    });
    if (check.valid) {
      logger.info(`[FFmpeg] Using custom FFmpeg binary: ${check.path}`);
      cachedBinary = {
        path: check.path,
        source: "custom",
        version: check.version,
      };
      return cachedBinary;
    }
    logger.warn(
      `[FFmpeg] Configured custom FFmpeg path is invalid (${check.error}), falling back to bundled binary`,
    );
  }

  const binaryName = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
  const platformDir =
    platform === "win32"
      ? "win32"
      : platform === "darwin"
        ? "darwin"
        : "linux";

  const resourceRoots = [];
  if (process.resourcesPath) {
    resourceRoots.push(path.join(process.resourcesPath, "app.asar.unpacked"));
  }
  try {
    let electronApp = null;
    try {
      electronApp = require("electron").app;
    } catch (_) {}
    if (electronApp && typeof electronApp.getAppPath === "function") {
      const dir = path.dirname(electronApp.getAppPath());
      if (dir) resourceRoots.push(path.join(dir, "app.asar.unpacked"));
    }
  } catch (_) {}

  const candidates = [];
  for (const root of resourceRoots) {
    candidates.push({
      path: path.join(root, "ffmpeg", platformDir, binaryName),
      source: "bundled",
    });
  }
  candidates.push({
    path: path.join(__dirname, "..", "..", "..", "electron", "ffmpeg", platformDir, binaryName),
    source: "bundled",
  });
  candidates.push({
    path: path.join(__dirname, "..", "..", "..", "ffmpeg", platformDir, binaryName),
    source: "bundled",
  });

  if (platform === "linux") {
    candidates.push(
      { path: "/usr/bin/ffmpeg", source: "system" },
      { path: "/usr/local/bin/ffmpeg", source: "system" },
    );
  } else if (platform === "darwin") {
    candidates.push(
      { path: "/opt/homebrew/bin/ffmpeg", source: "system" },
      { path: "/usr/local/bin/ffmpeg", source: "system" },
    );
  }

  let ffmpegStatic = null;
  try {
    ffmpegStatic = require("ffmpeg-static");
  } catch (_) {}
  if (typeof ffmpegStatic === "string" && ffmpegStatic) {
    candidates.push({
      path: ffmpegStatic.replace("app.asar", "app.asar.unpacked"),
      source: "ffmpeg-static",
    });
  }
  for (const root of resourceRoots) {
    candidates.push({
      path: path.join(root, "node_modules", "ffmpeg-static", binaryName),
      source: "ffmpeg-static",
    });
  }
  if (typeof ffmpegStatic === "string" && ffmpegStatic) {
    candidates.push({ path: ffmpegStatic, source: "ffmpeg-static" });
  }

  for (const cand of candidates) {
    if (cand.path && fsImpl.existsSync(cand.path)) {
      const version = await readVersionSafe(cand.path, { spawnImpl });
      cachedBinary = { path: cand.path, source: cand.source, version };
      logger.info(`[FFmpeg] Resolved FFmpeg binary (${cand.source}): ${cand.path}`);
      return cachedBinary;
    }
  }

  const fallbackVersion = await readVersionSafe(binaryName, { spawnImpl });
  cachedBinary = {
    path: binaryName,
    source: "fallback",
    version: fallbackVersion,
  };
  return cachedBinary;
}

/**
 * Backwards-compatible helper returning only the binary path string.
 */
async function getFfmpegPath() {
  const info = await resolveFfmpegBinary();
  return info.path;
}

function getCandidateEncodersForPlatform({
  platform = process.platform,
  android = isAndroidRuntime(),
} = {}) {
  if (android) return [];
  if (platform === "darwin") return ["videotoolbox"];
  if (platform === "win32") return ["nvenc", "qsv", "amf"];
  if (platform === "linux") return ["nvenc", "vaapi", "qsv"];
  return [];
}

/**
 * Probes platform-ordered H.264 hardware encoders and returns available encoder IDs (always ending with "software").
 */
async function detectHardwareEncoders({
  binaryPath = null,
  forceRefresh = false,
  platform = process.platform,
  android = isAndroidRuntime(),
  fsImpl = fs,
  spawnImpl = spawn,
} = {}) {
  if (!forceRefresh && Array.isArray(cachedEncoders)) {
    return cachedEncoders;
  }
  if (!forceRefresh && encoderProbeInFlight) {
    return encoderProbeInFlight;
  }

  const probe = async () => {
    const candidates = getCandidateEncodersForPlatform({ platform, android });
    if (candidates.length === 0) {
      cachedEncoders = ["software"];
      return cachedEncoders;
    }

    const bin = binaryPath || (await getFfmpegPath());
    const detected = [];

    for (const id of candidates) {
      if (id === "vaapi") {
        try {
          fsImpl.accessSync("/dev/dri/renderD128", fsImpl.constants.R_OK);
        } catch (_) {
          continue;
        }
      }
      const profile = HW_ENCODER_PROFILES[id];
      if (!profile) continue;

      try {
        await runFfmpeg(profile.probeArgs, {
          binaryPath: bin,
          timeoutMs: 3000,
          allowNonZeroExit: false,
          spawnImpl,
        });
        detected.push(id);
      } catch (_) {
        // Encoder not available on this host
      }
    }

    detected.push("software");
    cachedEncoders = detected;
    logger.info(`[FFmpeg] Detected video encoders: ${detected.join(", ")}`);
    return cachedEncoders;
  };

  if (forceRefresh) {
    return probe();
  }

  encoderProbeInFlight = probe().finally(() => {
    encoderProbeInFlight = null;
  });
  return encoderProbeInFlight;
}

/**
 * Resolves the active encoder ID given user preference and detected capabilities.
 */
function resolveActiveEncoder(preferred = "auto", detected = ["software"]) {
  const pref = String(preferred || "auto").toLowerCase();
  const avail = Array.isArray(detected) && detected.length > 0 ? detected : ["software"];

  if (pref === "software") return "software";
  if (pref === "auto") {
    return avail[0] || "software";
  }
  if (avail.includes(pref)) {
    return pref;
  }
  return "software";
}

/**
 * Returns full FFmpeg diagnostics payload for /api/system/ffmpeg.
 */
async function getFfmpegDiagnostics({
  forceRefresh = false,
  settingsLoader = null,
} = {}) {
  let settings = {};
  try {
    if (typeof settingsLoader === "function") {
      settings = (await settingsLoader()) || {};
    } else {
      const { settingfetch } = require("../settings");
      settings = (await settingfetch()) || {};
    }
  } catch (_) {}

  const preferred = settings.castHwEncoder || "auto";
  const downloadContainer = settings.downloadContainer === "mkv" ? "mkv" : "mp4";
  const remuxConcurrency = isAndroidRuntime()
    ? 1
    : Math.min(Math.max(parseInt(settings.remuxConcurrency, 10) || 1, 1), 2);
  const ffmpegCustomPath = isAndroidRuntime()
    ? ""
    : typeof settings.ffmpegCustomPath === "string"
      ? settings.ffmpegCustomPath
      : "";

  let resolved = null;
  let error = null;
  try {
    resolved = await resolveFfmpegBinary({
      forceRefresh,
      settingsLoader: () => Promise.resolve(settings),
    });
  } catch (err) {
    error = err.message;
  }

  let available = false;
  let version = resolved?.version || null;
  if (resolved?.path) {
    if (!version) {
      version = await readVersionSafe(resolved.path);
    }
    available = Boolean(
      version || (resolved.source !== "fallback" && fs.existsSync(resolved.path)),
    );
  }

  const detected = available
    ? await detectHardwareEncoders({ binaryPath: resolved.path, forceRefresh })
    : ["software"];
  const active = resolveActiveEncoder(preferred, detected);

  return {
    available,
    path: resolved?.path || null,
    source: resolved?.source || null,
    version,
    platform: process.platform,
    arch: process.arch,
    encoders: {
      detected,
      preferred,
      active,
    },
    settings: {
      ffmpegCustomPath,
      downloadContainer,
      castHwEncoder: preferred,
      remuxConcurrency,
    },
    error,
  };
}

module.exports = {
  ENCODER_IDS,
  HW_ENCODER_PROFILES,
  isAndroidRuntime,
  invalidateBinaryCache,
  validateFfmpegBinary,
  resolveFfmpegBinary,
  getFfmpegPath,
  getCandidateEncodersForPlatform,
  detectHardwareEncoders,
  resolveActiveEncoder,
  getFfmpegDiagnostics,
};
