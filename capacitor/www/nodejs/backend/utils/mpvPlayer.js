const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { logger } = require("./AppLogger");
const { updateHistory } = require("./history");
const { getHeaders } = require("./proxyHeaders");
const getMpvPath = () => {
  const { app } = require("electron");
  const platform = process.platform;
  const platformDir = platform === "win32" ? "win32" : "linux";
  const exeName = platform === "win32" ? "mpv.exe" : "mpv";

  // 1. Check process.resourcesPath (production unpack)
  if (process.resourcesPath) {
    const prodPath = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "mpv",
      platformDir,
      exeName,
    );
    if (fs.existsSync(prodPath)) {
      return prodPath;
    }
  }

  // 2. Check local dev source paths
  try {
    const devPathInner = path.join(
      app.getAppPath(),
      "mpv",
      platformDir,
      exeName,
    );
    if (fs.existsSync(devPathInner)) {
      return devPathInner;
    }
    const devPathOuter = path.join(
      app.getAppPath(),
      "..",
      "mpv",
      platformDir,
      exeName,
    );
    if (fs.existsSync(devPathOuter)) {
      return devPathOuter;
    }
  } catch (e) {}

  // 3. Fallback to system command
  return "mpv";
};

const getMpvConfigDir = () => {
  const { app } = require("electron");
  if (process.resourcesPath) {
    const prodPath = path.join(
      process.resourcesPath,
      "app.asar.unpacked",
      "mpv",
      "config"
    );
    if (fs.existsSync(prodPath)) {
      return prodPath;
    }
  }

  try {
    const devPathInner = path.join(app.getAppPath(), "mpv", "config");
    if (fs.existsSync(devPathInner)) {
      return devPathInner;
    }
    const devPathOuter = path.join(app.getAppPath(), "..", "mpv", "config");
    if (fs.existsSync(devPathOuter)) {
      return devPathOuter;
    }
  } catch (e) {}

  return path.join(__dirname, "..", "mpv", "config");
};

const getIpcPath = () => {
  const rand = Math.random().toString(36).substring(2, 10);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\mpvsocket-${rand}`;
  } else {
    return `/tmp/mpvsocket-${rand}`;
  }
};

const connectIpc = (ipcPath, retryCount = 0) => {
  return new Promise((resolve, reject) => {
    const client = net.connect(ipcPath);

    client.on("connect", () => {
      resolve(client);
    });

    client.on("error", (err) => {
      if (retryCount < 20) {
        setTimeout(() => {
          connectIpc(ipcPath, retryCount + 1)
            .then(resolve)
            .catch(reject);
        }, 150);
      } else {
        reject(
          new Error(
            `Failed to connect to MPV IPC socket after ${retryCount} attempts: ${err.message}`,
          ),
        );
      }
    });
  });
};

const resolvePathOrUrl = (rawUrl) => {
  if (!rawUrl) return "";
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return rawUrl;
  }
  try {
    const urlObj = new URL(rawUrl, "http://localhost");
    const filePath =
      urlObj.searchParams.get("path") || urlObj.searchParams.get("file");
    if (filePath) {
      const decoded = decodeURIComponent(filePath);
      if (fs.existsSync(decoded)) {
        return decoded;
      }
    }
  } catch (e) {}

  const port = global.PORT || 3000;
  return `http://localhost:${port}${rawUrl.startsWith("/") ? "" : "/"}${rawUrl}`;
};

async function playInMpv(window, options) {
  const {
    url,
    sources = [],
    title,
    episode,
    currentTime: startSeek = 0,
    subtitles = [],
    mediaId,
    image,
    provider,
    malid,
  } = options;

  if (!url) {
    throw new Error("No stream URL provided for MPV.");
  }

  const { settingfetch } = require("./settings");
  let autoSkipIntro = true;
  let autoPlayNextEpisode = true;
  try {
    const config = await settingfetch();
    if (config) {
      autoSkipIntro = config.autoSkipIntro !== false;
      autoPlayNextEpisode = config.autoPlayNextEpisode !== false;
    }
  } catch (e) {
    logger.error("Failed to load settings in mpvPlayer: " + e.message);
  }

  const resolvedUrl = resolvePathOrUrl(url);
  const ipcPath = getIpcPath();
  const configDir = getMpvConfigDir();
  let shortTitle = title || "Anime";
  if (shortTitle.length > 40) {
    shortTitle = shortTitle.substring(0, 40) + "...";
  }
  const displayTitle = `Ep ${episode || 1} - ${shortTitle}`;

  const args = [
    `--input-ipc-server=${ipcPath}`,
    `--title=StrawVerse - ${title || "Player"} - Episode ${episode || 1}`,
    `--force-media-title=${displayTitle}`,
    `--config-dir=${configDir}`,
    "--sub-font=sans-serif",
    "--sub-font-size=46",
    "--sub-color=#ffffffff",
    "--sub-border-color=#000000ff",
    "--sub-border-size=2.0",
    "--sub-shadow-offset=0",
    "--sub-margin-y=36",
    "--hwdec=auto-safe",
    "--force-window=yes",
    "--osd-bar=no",
    "--no-osd-bar",
    "--osd-on-seek=msg"
  ];

  const headers = getHeaders(resolvedUrl);
  if (headers) {
    if (headers["Referer"]) {
      args.push(`--referrer=${headers["Referer"]}`);
    }
    if (headers["User-Agent"]) {
      args.push(`--user-agent=${headers["User-Agent"]}`);
    }
    if (headers["Cookie"]) {
      args.push(`--http-header-fields=Cookie: ${headers["Cookie"]}`);
    }
  }

  const scriptOpts = [
    `osc-autoskip_intro=${autoSkipIntro ? "yes" : "no"}`,
    `osc-autoplay_next=${autoPlayNextEpisode ? "yes" : "no"}`
  ];

  if (sources && sources.length > 0) {
    const sourcesStr = sources
      .map((s) => `${s.quality}|${resolvePathOrUrl(s.url)}`)
      .join("##");
    scriptOpts.push(`modernx-sources=${sourcesStr}`);
  }

  args.push(`--script-opts=${scriptOpts.join(",")}`);

  if (startSeek > 0) {
    args.push(`--start=${Math.floor(startSeek)}`);
  }

  // If there are subtitle tracks
  if (subtitles && Array.isArray(subtitles)) {
    subtitles.forEach((sub) => {
      if (sub && sub.url) {
        args.push(`--sub-file=${resolvePathOrUrl(sub.url)}`);
      }
    });
  } else if (subtitles && typeof subtitles === "string") {
    args.push(`--sub-file=${resolvePathOrUrl(subtitles)}`);
  }

  args.push(resolvedUrl);

  const mpvExe = getMpvPath();
  logger.info(
    `[MPV] Spawning MPV process using [${mpvExe}] for ${title} Ep ${episode}. Args: ${args.join(" ")}`,
  );

  const mpvProcess = spawn(mpvExe, args);

  let client = null;
  let duration = 0;
  let currentTime = startSeek;
  let lastSyncTime = Date.now();
  let paused = false;
  let buffer = "";

  try {
    client = await connectIpc(ipcPath);
    global.activeMpvClient = client;
    logger.info("[MPV] Connected to JSON-RPC IPC socket successfully.");

    // Observe properties
    client.write(
      JSON.stringify({ command: ["observe_property", 1, "time-pos"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 2, "pause"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 3, "duration"] }) + "\n",
    );

    const handleIpcMessage = (dataStr) => {
      try {
        const msg = JSON.parse(dataStr);
        if (msg.event === "property-change") {
          if (msg.name === "time-pos" && typeof msg.data === "number") {
            currentTime = msg.data;
            if (Date.now() - lastSyncTime > 1000) {
              window.webContents.send("mpv-progress", {
                currentTime: currentTime,
                duration: duration,
                paused: paused,
              });
              lastSyncTime = Date.now();
            }
          } else if (msg.name === "duration" && typeof msg.data === "number") {
            duration = msg.data;
          } else if (msg.name === "pause" && typeof msg.data === "boolean") {
            paused = msg.data;
            window.webContents.send("mpv-progress", {
              currentTime: currentTime,
              duration: duration,
              paused: paused,
            });
          }
        }
      } catch (e) {
        // Handle malformed JSON
      }
    };

    client.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split("\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (line.trim()) {
          handleIpcMessage(line.trim());
        }
      }
    });
  } catch (err) {
    logger.error(
      `[MPV] IPC connection warning (playing without direct sync): ${err.message}`,
    );
  }

  mpvProcess.on("close", async (code) => {
    logger.info(`[MPV] Native player closed with code ${code}`);

    global.activeMpvClient = null;
    if (client && !client.destroyed) {
      client.destroy();
    }

    // Save final watched progress to SQLite DB history
    try {
      const timeSpent = currentTime - startSeek;
      await updateHistory({
        mediaId: mediaId,
        type: "Anime",
        title: title,
        number: episode,
        currentTime: currentTime,
        duration: duration || options.duration || 0,
        timeSpent: timeSpent > 0 ? timeSpent : 0,
        image: image,
        provider: provider,
        malid: malid,
      });
      logger.info(
        `[MPV] Synced watch history on player close: currentTime=${currentTime}`,
      );
    } catch (dbErr) {
      logger.error(`[MPV] Failed to write history progress: ${dbErr.message}`);
    }

    // Send final closed event back to frontend to remove the loading modal/overlay
    window.webContents.send("mpv-closed", {
      currentTime: currentTime,
      duration: duration || options.duration || 0,
    });

    // Cleanup UNIX Domain Socket file if created
    if (process.platform !== "win32") {
      try {
        if (fs.existsSync(ipcPath)) {
          fs.unlinkSync(ipcPath);
        }
      } catch (e) {}
    }
  });

  mpvProcess.on("error", (spawnErr) => {
    logger.error(
      `[MPV] Failed to spawn native MPV process: ${spawnErr.message}`,
    );
    window.webContents.send("mpv-error", {
      message: `MPV could not be launched. Make sure it is installed and added to your system PATH. Error: ${spawnErr.message}`,
    });
  });
}

module.exports = { playInMpv };
