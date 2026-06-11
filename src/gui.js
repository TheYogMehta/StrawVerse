// suppress node:sqlite experimental warning (intentional use)
process.removeAllListeners("warning");
process.on("warning", (w) => {
  if (w.name !== "ExperimentalWarning") console.warn(w);
});

// electron
const {
  app,
  BrowserWindow,
  nativeTheme,
  Menu,
  globalShortcut,
  powerSaveBlocker,
  dialog,
  Notification,
  ipcMain,
  protocol,
  shell,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const bodyParser = require("body-parser");
const { exec } = require("child_process");
const express = require("express");
const path = require("node:path");
const net = require("net");

if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

app.commandLine.appendSwitch("disable-renderer-backgrounding");

app.on("second-instance", (event, commandLine) => {
  logger.info(
    "[Protocol] second-instance triggered. Command line: " +
      JSON.stringify(commandLine),
  );
  if (global.win) {
    if (global.win.isMinimized()) global.win.restore();
    global.win.focus();
  }
  const url = commandLine.find((arg) => {
    const cleanArg = arg.replace(/^['"]|['"]$/g, "");
    return cleanArg.startsWith("strawverse://");
  });
  logger.info("[Protocol] Found URL in second-instance args: " + url);
  if (url) {
    handleCustomProtocolUrl(url);
  }
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  logger.info("[Protocol] open-url triggered: " + url);
  handleCustomProtocolUrl(url);
});

// Load package.json config dynamically for the auto-updater to support fork updates
try {
  const pkg = require("./package.json");
  if (pkg.build && pkg.build.publish) {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: pkg.build.publish.owner,
      repo: pkg.build.publish.repo,
    });
  } else {
    autoUpdater.setFeedURL({
      provider: "github",
      owner: "TheYogMehta",
      repo: "StrawVerse",
    });
  }
} catch (err) {
  autoUpdater.setFeedURL({
    provider: "github",
    owner: "TheYogMehta",
    repo: "StrawVerse",
  });
}

//  functions
const { logger } = require("./backend/utils/AppLogger");
const {
  SettingsLoad,
  patchModulePaths,
  loadAllScrapers,
} = require("./backend/utils/settings");
const { loadQueue } = require("./backend/utils/queue");
const { continuousExecution } = require("./backend/queueWorker");
const { StopDiscordRPC } = require("./backend/utils/discord");
const {
  createScrapperWindow,
  ExitScrapperWindow,
} = require("./backend/utils/scrapper");
const { getHeaders } = require("./backend/utils/proxyHeaders");
const { registerSharedStateHandlers } = require("./backend/sharedState");
const { checkForMappingUpdates } = require("./backend/utils/mappingUpdater");

// Express Server
const routes = require("./backend/routes");
const appExpress = express();
appExpress.use(bodyParser.urlencoded({ extended: true }));
appExpress.use(bodyParser.json());
appExpress.use(express.static(path.join(__dirname, "gui", "dist")));
appExpress.set("views", path.join(__dirname, "gui", "dist"));
appExpress.use((req, res, next) => {
  res.locals.MalLoggedIn = global.MalLoggedIn;
  next();
});
appExpress.use(routes);

registerSharedStateHandlers();

const createWindow = () => {
  global.win = new BrowserWindow({
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      backgroundThrottling: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, "backend", "preload.js"),
    },
    icon: path.join(
      __dirname,
      process.platform === "win32"
        ? "./assets/luffy.ico"
        : "./assets/luffy.png",
    ),
    minWidth: 1000,
    minHeight: 750,
  });

  global.win.maximize();
  nativeTheme.themeSource = "dark";
  global.win.loadURL(`http://localhost:${global.PORT}`);

  global.win.webContents.session.webRequest.onBeforeSendHeaders(
    {
      urls: ["*://*/*"],
    },
    (details, callback) => {
      const url = details.url;
      const { Referer: referer, "User-Agent": userAgent } = getHeaders(url);
      if (referer) details.requestHeaders["Referer"] = referer;
      if (userAgent) details.requestHeaders["User-Agent"] = userAgent;
      callback({ requestHeaders: details.requestHeaders });
    },
  );

  global.win.webContents.on("will-navigate", (event, url) => {
    event.preventDefault();

    if (
      url.startsWith("https://myanimelist.net") ||
      url.includes("discord.gg") ||
      url.includes("discord.com")
    ) {
      shell.openExternal(url);
    } else {
      global.win.loadURL(url);
    }
  });

  global.win.webContents.setWindowOpenHandler(({ url }) => {
    if (
      url.startsWith("https://myanimelist.net") ||
      url.includes("discord.gg") ||
      url.includes("discord.com")
    ) {
      shell.openExternal(url);
      return { action: "deny" };
    }
    return { action: "allow" };
  });

  global.win.webContents.on("context-menu", (event) => {
    event.preventDefault();
  });

  global.win.webContents.on("before-input-event", (event, input) => {
    if (input.control && input.key.toLowerCase() === "i") {
      event.preventDefault();
    }
  });

  ipcMain.on("marketplace", (event, AnimeManga) => {
    if (global.marketplaceWin && !global.marketplaceWin.isDestroyed()) {
      global.marketplaceWin.focus();
      return;
    }

    global.marketplaceWin = new BrowserWindow({
      width: 900,
      height: 500,
      parent: global.win,
      modal: process.platform !== "linux",
      title: "MarketPlace",
      webPreferences: {
        preload: path.join(__dirname, "backend", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    global.marketplaceWin.loadURL(
      `http://localhost:${global.PORT}/marketplace?type=${AnimeManga}`,
    );
  });

  global.win.on("closed", async () => {
    if (global.ScrapperWindow && !global.ScrapperWindow.isDestroyed()) {
      await ExitScrapperWindow();
    }

    if (global.marketplaceWin && !global.marketplaceWin.isDestroyed()) {
      global.marketplaceWin.close();
      global.marketplaceWin = null;
    }

    await StopDiscordRPC();

    app.quit();
  });

  if (app.isPackaged) {
    const menu = Menu.buildFromTemplate([]);
    Menu.setApplicationMenu(menu);
  }

  // max priority
  if (process.platform === "win32") {
    exec(
      `powershell -Command "& {Get-Process -Id ${process.pid} | ForEach-Object { $_.PriorityClass = 'High' }}"`,
      (error, stdout, stderr) => {
        if (error) {
          console.error("Failed to set process priority:", error);
          logger.error(`Failed to set process priority : ${error.message}`);
        } else {
          logger.info("Process priority set to high.");
        }
      },
    );
  } else {
    try {
      const os = require("os");
      os.setPriority(process.pid, -10);
      logger.info("Process priority set to high on Unix.");
    } catch (err) {
      if (err.message.includes("EACCES") || err.message.includes("EPERM")) {
        logger.warn(
          "Could not set Unix process priority to high (requires elevated privileges).",
        );
      } else {
        logger.error(`Failed to set Unix process priority : ${err.message}`);
      }
    }
  }

  // Prevent Sleep
  let id = powerSaveBlocker.start("prevent-app-suspension");

  logger.info("Power save blocker active:", powerSaveBlocker.isStarted(id));
};

app.whenReady().then(async () => {
  const PORT = await getFreePort();
  global.PORT = PORT;
  await new Promise((resolve) => {
    const server = appExpress.listen(PORT, () => {
      logger.info(`Listening on port ${PORT}`);
      resolve();
    });
    server.on("error", (err) => {
      logger.error(
        `Express server failed to listen on port ${PORT}: ${err.message}`,
      );
      resolve();
    });
  });

  await patchModulePaths();
  createWindow();
  createScrapperWindow();
  loadQueue();
  SettingsLoad();

  checkForMappingUpdates()
    .then(() => {
      const { runLiveChartScheduleIfNeeded } = require("./backend/utils/LiveChart");
      return runLiveChartScheduleIfNeeded();
    })
    .catch((err) => {
      logger.error(
        `[databaseUpdater] Error during startup database updates: ${err.message}`,
      );
    });

  await loadAllScrapers();
  globalShortcut.register("CommandOrControl+Shift+I", () => {});
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  registerLinuxProtocol();
  app.setAsDefaultProtocolClient("strawverse");

  const urlArg = process.argv.find((arg) => {
    const cleanArg = arg.replace(/^['"]|['"]$/g, "");
    return cleanArg.startsWith("strawverse://");
  });
  if (urlArg) {
    handleCustomProtocolUrl(urlArg);
  }

  protocol.handle("strawverse", async (request) => {
    handleCustomProtocolUrl(request.url);
  });

  autoUpdater.checkForUpdatesAndNotify();

  try {
    continuousExecution();
  } catch (err) {
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

// AutoUpdater
autoUpdater.on("checking-for-update", () => {
  logger.info("Checking for updates...");
});

autoUpdater.on("update-not-available", () => {
  logger.info("No updates available");
});

autoUpdater.on("update-available", () => {
  logger.info("Update available. Downloading...");
  if (global.win) {
    global.win.webContents.send("update-available");
  }
});

autoUpdater.on("error", (err) => {
  logger.error("Error checking for updates:", err);
});

autoUpdater.on("update-downloaded", () => {
  logger.info("Update downloaded.");
  if (global.win) {
    global.win.webContents.send("update-downloaded");
  }
  const choice = dialog.showMessageBoxSync(global.win, {
    type: "question",
    buttons: ["Restart", "Later"],
    defaultId: 0,
    cancelId: 1,
    title: "Update Ready",
    message:
      "A new version has been downloaded. Would you like to restart the app to apply the update?",
  });

  if (choice === 0) {
    autoUpdater.quitAndInstall();
  }
});

autoUpdater.on("update-installed", () => {
  const version = app.getVersion();

  const notification = new Notification({
    title: "StrawVerse",
    body: `StrawVerse ${version} has been successfully installed!`,
  });

  notification.show();
});

// Find Free Port
async function getFreePort() {
  return new Promise((resolve) => {
    const tryFindPort = () => {
      const server = net.createServer();
      server.listen(0, () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });

      server.on("error", (err) => {
        logger.error(`getFreePort error: ${err.message}`);
        setTimeout(tryFindPort, 50);
      });
    };
    tryFindPort();
  });
}

// Register Linux protocol handler dynamically (for AppImage and system integration)
function registerLinuxProtocol() {
  if (process.platform !== "linux") return;
  // We only register the custom protocol handler desktop file if the app is packaged
  if (!app.isPackaged) return;

  const fs = require("fs");
  const path = require("path");
  const os = require("os");
  const { exec } = require("child_process");

  try {
    const desktopDir = path.join(os.homedir(), ".local/share/applications");
    if (!fs.existsSync(desktopDir)) {
      fs.mkdirSync(desktopDir, { recursive: true });
    }

    const desktopFilePath = path.join(desktopDir, "strawverse.desktop");

    // Use the AppImage path if available, fallback to execPath
    const execPath = process.env.APPIMAGE || process.execPath;

    // Copy icon to user local icons path for persistence
    const localIconDir = path.join(
      os.homedir(),
      ".local/share/icons/hicolor/256x256/apps",
    );
    const localIconPath = path.join(localIconDir, "strawverse.png");
    const sourceIconPath = path.join(__dirname, "assets", "luffy.png");

    let useIconName = "strawverse";
    if (fs.existsSync(sourceIconPath)) {
      try {
        if (!fs.existsSync(localIconDir)) {
          fs.mkdirSync(localIconDir, { recursive: true });
        }
        fs.copyFileSync(sourceIconPath, localIconPath);
      } catch (iconErr) {
        logger.error(`[Protocol] Failed to copy icon: ${iconErr.message}`);
        useIconName = sourceIconPath;
      }
    }

    const desktopContent = `[Desktop Entry]
Name=strawverse
Exec="${execPath}" --no-sandbox %U
Terminal=false
Type=Application
Icon=${useIconName}
StartupWMClass=strawverse
X-AppImage-Version=${app.getVersion()}
Comment=Download anime in batches & its fast :3
MimeType=x-scheme-handler/strawverse;
Categories=Utility;
`;

    let shouldWrite = true;
    if (fs.existsSync(desktopFilePath)) {
      const existingContent = fs.readFileSync(desktopFilePath, "utf8");
      if (existingContent === desktopContent) {
        shouldWrite = false;
      }
    }

    if (shouldWrite) {
      fs.writeFileSync(desktopFilePath, desktopContent, "utf8");
      fs.chmodSync(desktopFilePath, "755");
      logger.info(`[Protocol] Registered desktop entry at ${desktopFilePath}`);

      exec(
        `xdg-mime default strawverse.desktop x-scheme-handler/strawverse`,
        (error, stdout, stderr) => {
          if (error) {
            logger.error(`[Protocol] xdg-mime failed: ${error.message}`);
          } else {
            logger.info(
              `[Protocol] Registered strawverse scheme handler via xdg-mime`,
            );
          }
        },
      );
    }
  } catch (err) {
    logger.error(
      `[Protocol] Failed to register custom protocol on Linux: ${err.message}`,
    );
  }
}

// handle custom protocol - only works in packaged version
function handleCustomProtocolUrl(urlStr) {
  const cleanUrlStr = urlStr.replace(/^['"]|['"]$/g, "");
  logger.info("[Protocol] handleCustomProtocolUrl called with: " + cleanUrlStr);
  try {
    const url = new URL(cleanUrlStr);
    const code = url.searchParams.get("code");
    logger.info("[Protocol] Parsed code: " + code);
    if (code) {
      const callbackUrl = `http://localhost:${global.PORT}/mal/callback?code=${code}`;
      logger.info(
        "[Protocol] Triggering background callback request: " + callbackUrl,
      );

      fetch(callbackUrl)
        .then((res) => {
          logger.info(
            "[Protocol] Background MAL callback request completed with status: " +
              res.status,
          );
        })
        .catch((err) => {
          logger.error(
            "[Protocol] Background MAL callback request failed: " + err.message,
          );
        });

      if (global.win) {
        if (global.win.isMinimized()) global.win.restore();
        global.win.focus();
      }
    } else {
      logger.warn("[Protocol] No code parameter found in URL!");
    }
  } catch (e) {
    logger.error(
      "[Protocol] Failed to parse custom protocol URL: " +
        cleanUrlStr +
        " Error: " +
        e.message,
    );
  }
}
