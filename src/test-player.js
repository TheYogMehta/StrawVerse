const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const platform = process.platform;
const platformDir = platform === "win32" ? "win32" : "linux";
const exeName = platform === "win32" ? "mpv.exe" : "mpv";

const mpvDir = path.join(__dirname, "mpv");
const mpvBinary = path.join(mpvDir, platformDir, exeName);
const configDir = path.join(mpvDir, "config");

const testUrl = "/home/neko/Downloads/Anime/Mushoku_Tensei__Jobless_Reincarnation_Season_3_sub/1Ep.mp4";

if (!fs.existsSync(mpvBinary)) {
  console.error(`MPV binary not found at: ${mpvBinary}`);
  console.error("Please run: npm run prebuild");
  process.exit(1);
}

console.log("Launching MPV Player in Test Mode...");
console.log(`Binary: ${mpvBinary}`);
console.log(`Config Directory: ${configDir}`);
console.log(`Playing: ${testUrl}`);

const args = [
  testUrl,
  `--config-dir=${configDir}`,
  `--title=StrawVerse Player - Test Mode`,
  "--force-window=yes"
];

const mpvProcess = spawn(mpvBinary, args, {
  stdio: "inherit"
});

mpvProcess.on("exit", (code) => {
  console.log(`Player closed with code: ${code}`);
});
