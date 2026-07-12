const path = require("path");
const fs = require("fs");
const got = require("got").default || require("got");
const JSZip = require("jszip");

const winUrl = "https://github.com/mpv-player/mpv/releases/download/v0.41.0/mpv-v0.41.0-x86_64-pc-windows-msvc.zip";
const linuxUrl = "https://github.com/pkgforge-dev/mpv-AppImage/releases/download/v0.41.0%402026-07-01_1782914175/mpv-v0.41.0-anylinux-x86_64.AppImage";

const mpvDir = path.join(__dirname, "..", "mpv");
const winDir = path.join(mpvDir, "win32");
const linuxDir = path.join(mpvDir, "linux");

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
      "ModernX OSC Lua script"
    );
  } else {
    console.log("ModernX OSC script already exists, skipping download.");
  }

  if (!fs.existsSync(fontPath)) {
    await downloadFile(
      "https://raw.githubusercontent.com/cyl0/ModernX/main/Material-Design-Iconic-Font.ttf",
      fontPath,
      "Material Design Iconic Font"
    );
  } else {
    console.log("Material Design Iconic Font already exists, skipping download.");
  }

  fs.writeFileSync(mpvConfPath, "osc=no\n");
  console.log("Configured isolated mpv.conf successfully.");
};

const main = async () => {
  try {
    await setupWindows();
    await setupLinux();
    await setupConfig();
    console.log("All MPV player binaries and custom skins configured successfully!");
  } catch (err) {
    console.error("Failed to download pre-built MPV binaries:", err.message);
    process.exit(1);
  }
};

main();
