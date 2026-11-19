const path = require("path");
const fs = require("fs");
const got = require("got").default || require("got");
const JSZip = require("jszip");

const winUrl =
  "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip";
const linuxUrl =
  "https://github.com/pkgforge-dev/mpv-AppImage/releases/download/v0.41.0%402026-07-01_1782914175/mpv-v0.41.0-anylinux-x86_64.AppImage";
const macMpvUrl =
  "https://laboratory.stolendata.net/~djinn/mpv_osx/mpv-arm64-latest.tar.gz";

const FFMPEG_RELEASE = "b6.1.1";
const FFMPEG_WIN_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-win32-x64.gz`;
const FFMPEG_MAC_ARM64_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_RELEASE}/ffmpeg-darwin-arm64.gz`;

const mpvDir = path.join(__dirname, "..", "mpv");
const winDir = path.join(mpvDir, "win32");
const linuxDir = path.join(mpvDir, "linux");
const macDir = path.join(mpvDir, "darwin");

const ffmpegDir = path.join(__dirname, "..", "ffmpeg");
const ffmpegWinDir = path.join(ffmpegDir, "win32");
const ffmpegMacDir = path.join(ffmpegDir, "darwin");

const downloadFile = async (url, destPath, progressLabel) => {
  console.log(`Downloading ${progressLabel}...`);
  const response = await got(url, { responseType: "buffer" });
  fs.writeFileSync(destPath, response.body);
  console.log(`Saved ${progressLabel} successfully.`);
};

const setupWindows = async () => {
  const destZip = path.join(winDir, "mpv.zip");
  const destExe = path.join(winDir, "mpv.exe");

  if (fs.existsSync(destExe)) {
    console.log("Windows MPV binary already exists, skipping download.");
    return;
  }

  if (!fs.existsSync(winDir)) {
    fs.mkdirSync(winDir, { recursive: true });
  }

  await downloadFile(winUrl, destZip, "Windows MPV zip");

  console.log("Extracting Windows MPV zip...");
  const zipData = fs.readFileSync(destZip);
  const zip = await JSZip.loadAsync(zipData);
  const mpvExeFile = zip.file("mpv.exe");
  if (!mpvExeFile) {
    throw new Error("Could not find mpv.exe in the downloaded zip archive.");
  }

  const buffer = await mpvExeFile.async("nodebuffer");
  fs.writeFileSync(destExe, buffer);
  console.log("Extracted mpv.exe successfully.");

  try {
    fs.unlinkSync(destZip);
  } catch (e) {}
};

const setupLinux = async () => {
  const destExe = path.join(linuxDir, "mpv");

  if (fs.existsSync(destExe)) {
    console.log("Linux MPV binary already exists, skipping download.");
    return;
  }

  if (!fs.existsSync(linuxDir)) {
    fs.mkdirSync(linuxDir, { recursive: true });
  }

  await downloadFile(linuxUrl, destExe, "Linux MPV AppImage");

  // Make it executable
  fs.chmodSync(destExe, 0o755);
  console.log("Configured Linux MPV executable permissions.");
};

const setupMacMpv = async () => {
  const destExe = path.join(macDir, "mpv");
  const destAppMpv = path.join(macDir, "mpv.app", "Contents", "MacOS", "mpv");
  const destTar = path.join(macDir, "mpv.tar.gz");

  const writeLauncherScript = () => {
    const launcherContent = `#!/bin/sh
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -x "$SCRIPT_DIR/mpv.app/Contents/MacOS/mpv" ]; then
  exec "$SCRIPT_DIR/mpv.app/Contents/MacOS/mpv" "$@"
fi
for sub in "$SCRIPT_DIR"/*/; do
  if [ -x "\${sub}mpv.app/Contents/MacOS/mpv" ]; then
    exec "\${sub}mpv.app/Contents/MacOS/mpv" "$@"
  fi
done
exec mpv "$@"
`;
    fs.writeFileSync(destExe, launcherContent, { mode: 0o755 });
    fs.chmodSync(destExe, 0o755);
  };

  const findExtractedMpv = () => {
    if (fs.existsSync(destAppMpv) && fs.statSync(destAppMpv).size > 0)
      return destAppMpv;
    if (fs.existsSync(macDir)) {
      const subdirs = fs.readdirSync(macDir);
      for (const sub of subdirs) {
        const candidate = path.join(
          macDir,
          sub,
          "mpv.app",
          "Contents",
          "MacOS",
          "mpv",
        );
        if (fs.existsSync(candidate) && fs.statSync(candidate).size > 0)
          return candidate;
      }
    }
    return null;
  };

  let existingBinary = findExtractedMpv();
  if (existingBinary) {
    console.log("macOS arm64 MPV binary already exists, ensuring launchers...");
    writeLauncherScript();
    try {
      fs.chmodSync(existingBinary, 0o755);
    } catch (_) {}
    return;
  }

  if (!fs.existsSync(macDir)) {
    fs.mkdirSync(macDir, { recursive: true });
  }

  try {
    await downloadFile(macMpvUrl, destTar, "macOS arm64 MPV archive");
    console.log("Extracting macOS arm64 MPV archive...");
    const { execSync } = require("child_process");
    execSync(`tar -xzf "${destTar}" -C "${macDir}"`, { stdio: "inherit" });

    const binaryPath = findExtractedMpv();
    if (binaryPath) {
      writeLauncherScript();
      try {
        fs.chmodSync(binaryPath, 0o755);
      } catch (_) {}
      console.log("Configured macOS MPV executable at:", destExe);
    }
  } catch (err) {
    console.warn("Could not setup macOS MPV automatically:", err.message);
  } finally {
    try {
      if (fs.existsSync(destTar)) fs.unlinkSync(destTar);
    } catch (_) {}
  }
};

const setupConfig = async () => {
  const configDir = path.join(mpvDir, "config");
  const scriptsDir = path.join(configDir, "scripts");
  const fontsDir = path.join(configDir, "fonts");

  if (!fs.existsSync(scriptsDir)) fs.mkdirSync(scriptsDir, { recursive: true });
  if (!fs.existsSync(fontsDir)) fs.mkdirSync(fontsDir, { recursive: true });

  const modernxLuaPath = path.join(scriptsDir, "modernx.lua");
  const fontPath = path.join(fontsDir, "Material-Design-Iconic-Font.ttf");
  const mpvConfPath = path.join(configDir, "mpv.conf");

  if (!fs.existsSync(modernxLuaPath)) {
    await downloadFile(
      "https://raw.githubusercontent.com/cyl0/ModernX/main/modernx.lua",
      modernxLuaPath,
      "ModernX OSC Lua script",
    );
  } else {
    console.log("ModernX OSC script already exists, skipping download.");
  }

  if (!fs.existsSync(fontPath)) {
    await downloadFile(
      "https://raw.githubusercontent.com/cyl0/ModernX/main/Material-Design-Iconic-Font.ttf",
      fontPath,
      "Material Design Iconic Font",
    );
  } else {
    console.log(
      "Material Design Iconic Font already exists, skipping download.",
    );
  }

  fs.writeFileSync(mpvConfPath, "osc=no\n");
  console.log("Configured isolated mpv.conf successfully.");
};

const setupFfmpegWindows = async () => {
  const destExe = path.join(ffmpegWinDir, "ffmpeg.exe");

  if (fs.existsSync(destExe) && fs.statSync(destExe).size > 0) {
    console.log("Windows FFmpeg binary already exists, skipping download.");
    return;
  }

  if (!fs.existsSync(ffmpegWinDir)) {
    fs.mkdirSync(ffmpegWinDir, { recursive: true });
  }

  console.log("Downloading Windows FFmpeg binary...");
  const response = await got(FFMPEG_WIN_URL, { responseType: "buffer" });
  const decompressed = require("zlib").gunzipSync(response.body);
  fs.writeFileSync(destExe, decompressed);

  console.log("Downloaded and extracted Windows ffmpeg.exe successfully.");
};

const setupFfmpegMac = async () => {
  const destExe = path.join(ffmpegMacDir, "ffmpeg");

  if (fs.existsSync(destExe) && fs.statSync(destExe).size > 0) {
    console.log("macOS FFmpeg binary already exists, skipping download.");
    return;
  }

  if (!fs.existsSync(ffmpegMacDir)) {
    fs.mkdirSync(ffmpegMacDir, { recursive: true });
  }

  try {
    console.log("Downloading macOS arm64 FFmpeg binary...");
    const response = await got(FFMPEG_MAC_ARM64_URL, {
      responseType: "buffer",
    });
    const decompressed = require("zlib").gunzipSync(response.body);
    fs.writeFileSync(destExe, decompressed);
    fs.chmodSync(destExe, 0o755);

    console.log("Downloaded and extracted macOS arm64 ffmpeg successfully.");
  } catch (err) {
    console.warn("Could not setup macOS FFmpeg automatically:", err.message);
  }
};

const patchSnapBuilder = () => {
  try {
    const snapLegacyPath = path.join(
      __dirname,
      "..",
      "node_modules",
      "app-builder-lib",
      "out",
      "targets",
      "snap",
      "coreLegacy.js",
    );
    if (fs.existsSync(snapLegacyPath)) {
      let content = fs.readFileSync(snapLegacyPath, "utf8");
      if (
        content.includes(
          'await (0, promises_1.rm)(path.join(appOutDir, "chrome-sandbox"), { force: true });',
        )
      ) {
        content = content.replace(
          'await (0, promises_1.rm)(path.join(appOutDir, "chrome-sandbox"), { force: true });',
          '// Patched by StrawVerse to prevent race condition with AppImage packaging\n    // await (0, promises_1.rm)(path.join(appOutDir, "chrome-sandbox"), { force: true });',
        );
        fs.writeFileSync(snapLegacyPath, content, "utf8");
        console.log(
          "Patched app-builder-lib snap coreLegacy.js to prevent AppImage race condition.",
        );
      }
    }
  } catch (err) {
    console.warn(
      "Could not patch app-builder-lib snap coreLegacy.js:",
      err.message,
    );
  }
};

const main = async () => {
  try {
    patchSnapBuilder();
    await setupWindows();
    await setupLinux();
    await setupMacMpv();
    await setupConfig();
    await setupFfmpegWindows();
    await setupFfmpegMac();
    console.log("All binaries and custom skins configured successfully!");
  } catch (err) {
    console.error("Failed to download pre-built binaries:", err.message);
    process.exit(1);
  }
};

main();
