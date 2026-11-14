const path = require("path");
const fs = require("fs");
const { ipcMain, dialog, BrowserWindow } = require("electron");
const backendDir = fs.existsSync(path.join(__dirname, "backend"))
  ? path.join(__dirname, "backend")
  : path.join(__dirname, "..", "backend");

const { UpdateDiscordRPC } = require(path.join(backendDir, "utils", "discord"));
const {
  HandleExtensions,
  settingfetch,
  settingupdate,
  getScraperIconsPath,
  getExtensionRepos,
  addExtensionRepo,
  removeExtensionRepo,
  restoreDefaultExtensionRepo,
  fetchAggregatedMarketplace,
} = require(path.join(backendDir, "utils", "settings"));
const { getEffectiveLogDir } = require(
  path.join(backendDir, "utils", "settings"),
);
const { MalCreateUrl } = require(path.join(backendDir, "utils", "mal"));

let PageHistory = [];
let OldRpcStatus = null;

function registerSharedStateHandlers() {
  ipcMain.handle("get-shared-state", () => {
    return PageHistory;
  });

  ipcMain.handle("set-shared-state", (event, newPageHistory) => {
    PageHistory = newPageHistory;
    if (OldRpcStatus) {
      UpdateDiscordRPC();
      OldRpcStatus = null;
    }
    return PageHistory;
  });

  ipcMain.handle("update-discordrpc", (event, AnimeName, Episode) => {
    const NewRpcStatus = `${AnimeName}${Episode}`;
    if (OldRpcStatus !== NewRpcStatus) {
      OldRpcStatus = NewRpcStatus;
      UpdateDiscordRPC(AnimeName, Episode, "Anime");
    }
  });

  ipcMain.handle(
    "extensions",
    async (
      event,
      TaskType,
      AnimeManga,
      ExtentionName,
      RepoOwner = "TheYogMehta",
      RepoBaseUrl,
      MinAppVersion,
    ) => {
      return await HandleExtensions(
        TaskType,
        AnimeManga,
        ExtentionName,
        RepoOwner,
        RepoBaseUrl,
        MinAppVersion,
      );
    },
  );

  ipcMain.handle("get-marketplace", async (event, activeType) => {
    return await fetchAggregatedMarketplace(activeType);
  });

  ipcMain.handle("get-extension-repos", async () => {
    return getExtensionRepos();
  });

  ipcMain.handle("add-extension-repo", async (event, url) => {
    return await addExtensionRepo(url);
  });

  ipcMain.handle("remove-extension-repo", async (event, identifier) => {
    return await removeExtensionRepo(identifier);
  });

  ipcMain.handle("restore-default-extension-repo", async () => {
    return await restoreDefaultExtensionRepo();
  });

  ipcMain.handle("get-settings", async (event, keys) => {
    const setting = await settingfetch();
    let settingsObj = {};

    const getProviders = () => ({
      Anime: Array.from(
        new Set(
          Object.values(global.Anime_providers || {}).map(
            (p) => p.uniqueId || p.name,
          ),
        ),
      ),
      Manga: Array.from(
        new Set(
          Object.values(global.Manga_providers || {}).map(
            (p) => p.uniqueId || p.name,
          ),
        ),
      ),
      Movies: Array.from(
        new Set(
          Object.values(global.Movies_providers || {}).map(
            (p) => p.uniqueId || p.name,
          ),
        ),
      ),
    });

    const getIconUrl = (name, valScraper) => {
      if (valScraper?.logo) return valScraper.logo;
      const iconsDir = getScraperIconsPath();
      if (iconsDir) {
        const repo = valScraper?.repoOwner || "TheYogMehta";
        const scopedIconPath = path.join(iconsDir, repo, `${name}.ico`);
        if (fs.existsSync(scopedIconPath)) {
          return `/api/image?url=${encodeURIComponent(`file://${scopedIconPath}`)}`;
        }
        const iconPath = path.join(iconsDir, `${name}.ico`);
        if (fs.existsSync(iconPath)) {
          return `/api/image?url=${encodeURIComponent(`file://${iconPath}`)}`;
        }
      }
      return null;
    };

    const getInstalledExtensions = () => ({
      Anime: Array.from(
        new Map(
          Object.values(global.Anime_providers || {}).map((val) => [
            val.uniqueId || val.name,
            {
              name: val.name,
              repoOwner: val.repoOwner || "TheYogMehta",
              uniqueId:
                val.uniqueId || `${val.repoOwner || "TheYogMehta"}/${val.name}`,
              version: val.version || "1.0.0",
              icon: getIconUrl(val.name, val),
            },
          ]),
        ).values(),
      ),
      Manga: Array.from(
        new Map(
          Object.values(global.Manga_providers || {}).map((val) => [
            val.uniqueId || val.name,
            {
              name: val.name,
              repoOwner: val.repoOwner || "TheYogMehta",
              uniqueId:
                val.uniqueId || `${val.repoOwner || "TheYogMehta"}/${val.name}`,
              version: val.version || "1.0.0",
              icon: getIconUrl(val.name, val),
            },
          ]),
        ).values(),
      ),
      Movies: Array.from(
        new Map(
          Object.values(global.Movies_providers || {}).map((val) => [
            val.uniqueId || val.name,
            {
              name: val.name,
              repoOwner: val.repoOwner || "TheYogMehta",
              uniqueId:
                val.uniqueId || `${val.repoOwner || "TheYogMehta"}/${val.name}`,
              version: val.version || "1.0.0",
              icon: getIconUrl(val.name, val),
            },
          ]),
        ).values(),
      ),
    });

    if (Array.isArray(keys)) {
      for (const k of keys) {
        if (k === "malUsername") {
          settingsObj[k] = setting?.malUsername || global.malUsername || null;
        } else if (k === "providers") {
          settingsObj[k] = getProviders();
        } else if (k === "installedExtensions") {
          settingsObj[k] = getInstalledExtensions();
        } else {
          settingsObj[k] = setting[k];
        }
      }
    } else {
      settingsObj = {
        ...setting,
        providers: getProviders(),
        installedExtensions: getInstalledExtensions(),
      };
    }

    let url = null;
    if (
      !Array.isArray(keys) &&
      (!setting.mal_on_off || setting.mal_on_off === null)
    ) {
      url = await MalCreateUrl();
    }

    let logDirectory = null;
    try {
      logDirectory = getEffectiveLogDir();
    } catch (_) {}
    return {
      settings: settingsObj,
      url: url,
      MalLoggedIn: global.MalLoggedIn || false,
      malUsername: setting?.malUsername || global.malUsername || null,
      logDirectory: logDirectory,
    };
  });

  ipcMain.handle("update-setting", async (event, key, value) => {
    await settingupdate({ [key]: value });
    return { success: true };
  });

  ipcMain.handle("update-settings", async (event, settingsObj) => {
    await settingupdate(settingsObj);
    return { success: true };
  });

  ipcMain.handle("select-directory", async (event, currentPath) => {
    const win =
      BrowserWindow.getFocusedWindow() ||
      BrowserWindow.getAllWindows()[0] ||
      null;
    try {
      const options = {
        properties: ["openDirectory", "createDirectory"],
      };
      if (
        currentPath &&
        typeof currentPath === "string" &&
        fs.existsSync(currentPath)
      ) {
        options.defaultPath = currentPath;
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options);
      if (result.canceled || !result.filePaths?.length) {
        return { success: false, canceled: true };
      }
      return { success: true, path: result.filePaths[0] };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });
}

module.exports = { registerSharedStateHandlers };
