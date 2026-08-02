const { spawn } = require("child_process");
const net = require("net");
const fs = require("fs");
const path = require("path");
const { logger } = require("./AppLogger");
const { updateHistory } = require("./history");

function formatSubtitleLabel(sub) {
  return sub?.lang || sub?.label || sub?.name || "";
}

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
      "config",
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

// Proxy external URLs through local Express → Electron's net stack (bypasses Cloudflare).
const toProxyUrl = (url) => {
  if (!url || !url.startsWith("http")) return url;
  const port = global.PORT || 3000;
  const base = `http://127.0.0.1:${port}/api/stream`;
  if (url.includes(".m3u8")) {
    return `${base}/m3u8?url=${encodeURIComponent(url)}`;
  }
  return `${base}/segment?url=${encodeURIComponent(url)}`;
};

async function playInMpv(window, options) {
  global.activePlayRequestId = (global.activePlayRequestId || 0) + 1;
  const currentRequestId = global.activePlayRequestId;

  const {
    url,
    sources,
    title,
    episode,
    currentTime: startSeek,
    subtitles,
    mediaId,
    image,
    provider,
    malid,
  } = options;

  let autoSkipIntro = true;
  let autoPlayNextEpisode = true;
  try {
    const settingsPath = path.join(
      require("electron").app.getPath("userData"),
      "settings.json",
    );
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      if (settings.autoSkipIntro !== undefined)
        autoSkipIntro = settings.autoSkipIntro;
      if (settings.autoPlayNextEpisode !== undefined)
        autoPlayNextEpisode = settings.autoPlayNextEpisode;
    }
  } catch (e) {
    logger.error("Failed to load settings in mpvPlayer: " + e.message);
  }

  const resolvedUrl = resolvePathOrUrl(url);
  const isExternal = resolvedUrl.startsWith("http");
  const playUrl = isExternal ? toProxyUrl(resolvedUrl) : resolvedUrl;
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
    "--fullscreen",
    "--no-ytdl",
    "--osd-on-seek=msg",
    `--volume=${options.volume !== undefined ? Math.floor(options.volume) : 100}`,
    `--speed=${options.speed || 1.0}`,
    `--sub-visibility=${options.subsEnabled === false ? "no" : "yes"}`,
    `--sub=${options.subsEnabled === false ? "no" : String((options.selectedSubIndex !== undefined && options.selectedSubIndex >= 0 ? options.selectedSubIndex : 0) + 1)}`,
    `--brightness=${options.brightness || 0}`,
  ];

  // Headers only needed for local files — proxy handles CDN headers itself.
  if (!isExternal) {
    const headers = getHeaders(resolvedUrl);
    if (headers) {
      if (headers["Referer"]) {
        args.push(`--referrer=${headers["Referer"]}`);
        args.push(`--http-header-fields=Referer: ${headers["Referer"]}`);
      }
      if (headers["User-Agent"]) {
        args.push(`--user-agent=${headers["User-Agent"]}`);
        args.push(`--http-header-fields=User-Agent: ${headers["User-Agent"]}`);
      }
      if (headers["Cookie"]) {
        args.push(`--http-header-fields=Cookie: ${headers["Cookie"]}`);
      }
    }
  }

  const scriptOpts = [
    `osc-autoskip_intro=${autoSkipIntro ? "yes" : "no"}`,
    `osc-autoplay_next=${autoPlayNextEpisode ? "yes" : "no"}`,
    `modernx-has-next=${options.hasNext ? "yes" : "no"}`,
    `modernx-has-prev=${options.hasPrev ? "yes" : "no"}`,
  ];

  if (sources && sources.length > 0) {
    const sourcesStr = sources
      .map((s) => {
        const sUrl = resolvePathOrUrl(s.url);
        return `${s.quality}|${sUrl.startsWith("http") ? toProxyUrl(sUrl) : sUrl}`;
      })
      .join("##");
    scriptOpts.push(`modernx-sources=${sourcesStr}`);
  }

  if (subtitles && Array.isArray(subtitles)) {
    const subsStr = subtitles
      .filter((sub) => sub && sub.url)
      .map((sub, idx) => {
        const cleanLang = formatSubtitleLabel(sub, idx);
        const subUrl = resolvePathOrUrl(sub.url);
        return `${cleanLang}|${subUrl}`;
      })
      .join("##");
    if (subsStr) {
      scriptOpts.push(`modernx-subtitles=${subsStr}`);
    }
  }

  args.push(`--script-opts=${scriptOpts.join(",")}`);

  if (startSeek > 0) {
    args.push(`--start=${Math.floor(startSeek)}`);
  }

  if (subtitles && Array.isArray(subtitles)) {
    subtitles.forEach((sub, idx) => {
      if (sub && sub.url) {
        const cleanLang = formatSubtitleLabel(sub, idx);
        sub.lang = cleanLang;
        sub.label = cleanLang;
        args.push(`--sub-file=${resolvePathOrUrl(sub.url)}`);
      }
    });
  } else if (subtitles && typeof subtitles === "string") {
    args.push(`--sub-file=${resolvePathOrUrl(subtitles)}`);
  }

  args.push(playUrl);

  if (global.activeMpvProcess) {
    try {
      global.activeMpvProcess.kill("SIGKILL");
    } catch (e) {}
    global.activeMpvProcess = null;
  }
  if (global.activeMpvClient) {
    try {
      global.activeMpvClient.destroy();
    } catch (e) {}
    global.activeMpvClient = null;
  }

  const mpvExe = getMpvPath();
  logger.info(
    `[MPV] Spawning MPV process using [${mpvExe}] for ${title} Ep ${episode}. Args: ${args.join(" ")}`,
  );

  const mpvProcess = spawn(mpvExe, args);
  global.activeMpvProcess = mpvProcess;

  let client = null;
  let duration = 0;
  let currentTime = startSeek;
  let lastSyncTime = Date.now();
  let paused = false;
  let buffer = "";
  let pendingAction = null;
  let hasStartedSent = false;

  const sendStarted = () => {
    if (global.activePlayRequestId !== currentRequestId) return;
    if (!hasStartedSent) {
      window.webContents.send("mpv-started");
      hasStartedSent = true;
    }
  };

  try {
    client = await connectIpc(ipcPath);
    global.activeMpvClient = client;
    logger.info("[MPV] Connected to JSON-RPC IPC socket successfully.");
    sendStarted();

    client.write(
      JSON.stringify({ command: ["observe_property", 1, "time-pos"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 2, "pause"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 3, "duration"] }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 4, "user-data/strawverse-action"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 5, "user-data/strawverse-episode"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 6, "user-data/strawverse-title"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 7, "user-data/strawverse-mediaId"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 8, "user-data/strawverse-image"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 9, "user-data/strawverse-provider"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({
        command: ["observe_property", 10, "user-data/strawverse-malid"],
      }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 11, "volume"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 12, "speed"] }) + "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 13, "sub-visibility"] }) +
        "\n",
    );
    client.write(
      JSON.stringify({ command: ["observe_property", 14, "brightness"] }) +
        "\n",
    );

    const handleIpcMessage = (dataStr) => {
      try {
        const msg = JSON.parse(dataStr);
        if (msg.event === "file-loaded") {
          sendStarted();
        }
        if (msg.event === "property-change") {
          if (
            msg.name === "user-data/strawverse-action" &&
            typeof msg.data === "string" &&
            msg.data !== ""
          ) {
            pendingAction = msg.data;
            let actionName = pendingAction;
            let actionUrl = undefined;
            if (pendingAction.startsWith("change-server:")) {
              actionName = "change-server";
              actionUrl = pendingAction.substring("change-server:".length);
            }

            hasStartedSent = false;

            const timeSpent = currentTime - startSeek;
            updateHistory({
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
            }).catch((err) =>
              logger.error(`[MPV] Action history sync failed: ${err.message}`),
            );
            client.write(
              JSON.stringify({
                command: ["set_property", "user-data/strawverse-action", ""],
              }) + "\n",
            );
            window.webContents.send("mpv-action", {
              action: actionName,
              url: actionUrl,
            });
          } else if (
            msg.name === "user-data/strawverse-episode" &&
            msg.data !== undefined
          ) {
            episode = msg.data;
            startSeek = 0;
            currentTime = 0;
          } else if (
            msg.name === "user-data/strawverse-title" &&
            msg.data !== undefined
          ) {
            title = msg.data;
          } else if (
            msg.name === "user-data/strawverse-mediaId" &&
            msg.data !== undefined
          ) {
            mediaId = msg.data;
          } else if (
            msg.name === "user-data/strawverse-image" &&
            msg.data !== undefined
          ) {
            image = msg.data;
          } else if (
            msg.name === "user-data/strawverse-provider" &&
            msg.data !== undefined
          ) {
            provider = msg.data;
          } else if (
            msg.name === "user-data/strawverse-malid" &&
            msg.data !== undefined
          ) {
            malid = msg.data;
          } else if (msg.name === "volume" && typeof msg.data === "number") {
            window.webContents.send("mpv-setting-changed", {
              name: "volume",
              value: msg.data / 100,
            });
          } else if (msg.name === "speed" && typeof msg.data === "number") {
            window.webContents.send("mpv-setting-changed", {
              name: "speed",
              value: msg.data,
            });
          } else if (msg.name === "sub-visibility" && msg.data !== undefined) {
            const isVisible =
              msg.data === true || msg.data === "yes" || msg.data === 1;
            window.webContents.send("mpv-setting-changed", {
              name: "subs-enabled",
              value: isVisible,
            });
          } else if (
            msg.name === "brightness" &&
            typeof msg.data === "number"
          ) {
            window.webContents.send("mpv-setting-changed", {
              name: "brightness",
              value: msg.data,
            });
          } else if (msg.name === "time-pos" && typeof msg.data === "number") {
            currentTime = msg.data;
            sendStarted();
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
      } catch (e) {}
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

  mpvProcess.on("close", async (code, signal) => {
    logger.info(
      `[MPV] Native player closed with code ${code}${signal ? `, signal ${signal}` : ""}`,
    );

    if (global.activeMpvProcess === mpvProcess) {
      global.activeMpvProcess = null;
    }
    if (global.activeMpvClient === client) {
      global.activeMpvClient = null;
    }
    if (client && !client.destroyed) {
      client.destroy();
    }

    if (global.activePlayRequestId !== currentRequestId) {
      logger.info(
        `[MPV] Player process superseded by request ${global.activePlayRequestId}, suppressing close IPC.`,
      );
      return;
    }

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

    const isNormalExit =
      hasStartedSent || code === 0 || code === 4 || signal !== null;

    if (!isNormalExit) {
      window.webContents.send("mpv-error", {
        message: `MPV player failed to open stream (Exit Code ${code}).`,
        action: pendingAction,
      });
    } else {
      window.webContents.send("mpv-closed", {
        currentTime: currentTime,
        duration: duration || options.duration || 0,
        action: pendingAction,
      });
    }

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

module.exports = { playInMpv, toProxyUrl };
