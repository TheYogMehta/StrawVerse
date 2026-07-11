const { ipcMain } = require("electron");
const { UpdateDiscordRPC } = require("./utils/discord");
const {
  HandleExtensions,
  settingfetch,
  settingupdate,
  getScraperIconsPath,
} = require("./utils/settings");
const { MalCreateUrl } = require("./utils/mal");

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
    async (event, TaskType, AnimeManga, ExtentionName) => {
      return await HandleExtensions(TaskType, AnimeManga, ExtentionName);
    },
  );

  ipcMain.handle("get-settings", async (event, keys) => {
    const setting = await settingfetch();
    let settingsObj = {};

    const getProviders = () => ({
      Anime: global.Anime_providers ? Object.keys(global.Anime_providers) : [],
      Manga: global.Manga_providers ? Object.keys(global.Manga_providers) : [],
    });

    const getIconUrl = (name, valScraper) => {
      if (valScraper?.logo) return valScraper.logo;
      const iconsDir = getScraperIconsPath();
      if (iconsDir) {
        const iconPath = require("path").join(iconsDir, `${name}.ico`);
        if (require("fs").existsSync(iconPath)) {
          return `/api/image?url=${encodeURIComponent(`file://${iconPath}`)}`;
        }
      }
      return null;
    };

    const getInstalledExtensions = () => ({
      Anime: global.Anime_providers
        ? Object.entries(global.Anime_providers).map(([key, val]) => ({
            name: key,
            version: val.version || "1.0.0",
            icon: getIconUrl(key, val),
          }))
        : [],
      Manga: global.Manga_providers
        ? Object.entries(global.Manga_providers).map(([key, val]) => ({
            name: key,
            version: val.version || "1.0.0",
            icon: getIconUrl(key, val),
          }))
        : [],
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

    return {
      settings: settingsObj,
      url: url,
      MalLoggedIn: global.MalLoggedIn || false,
      malUsername: setting?.malUsername || global.malUsername || null,
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
}

module.exports = { registerSharedStateHandlers };
