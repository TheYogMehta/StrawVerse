/**
 * ffmpeg-static shim for Android.
 *
 * On Android the ffmpeg binary is shipped as `libffmpeg.so` inside the APK's
 * jniLibs so it lands in the app's nativeLibraryDir (the only executable
 * location on modern Android, requires android:extractNativeLibs="true").
 *
 * The path is resolved by scanning /proc/self/maps for libnode.so, which the
 * nodejs-mobile runtime always loads from that same nativeLibraryDir. This
 * avoids any need to pass paths from the native layer. An explicit
 * STRAWVERSE_FFMPEG_PATH env var still wins if set.
 *
 * downloader.js does `require("ffmpeg-static")` and expects a string path -
 * exactly what this module exports.
 */

const fs = require("fs");
const path = require("path");

function findNativeLibDir() {
  try {
    const maps = fs.readFileSync("/proc/self/maps", "utf-8");
    for (const line of maps.split("\n")) {
      const idx = line.indexOf("/");
      if (idx === -1) continue;
      const libPath = line.slice(idx).trim();
      if (libPath.endsWith("/libnode.so")) return path.dirname(libPath);
    }
  } catch (_) {
    /* not on Android (local testing) */
  }
  return null;
}

function resolveFfmpeg() {
  if (process.env.STRAWVERSE_FFMPEG_PATH) {
    return process.env.STRAWVERSE_FFMPEG_PATH;
  }
  const libDir = findNativeLibDir();
  if (libDir) {
    const candidate = path.join(libDir, "libffmpeg.so");
    if (fs.existsSync(candidate)) return candidate;
  }
  return "/data/local/tmp/ffmpeg-not-found";
}

module.exports = resolveFfmpeg();
