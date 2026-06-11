// libs
const { app } = require("electron");
const Module = require("module");
const path = require("path");
const got = require("got").default || require("got");
const fs = require("fs");

// Functions
const {
  getDownloadsFolder,
  ensureDirectoryExists,
} = require("./DirectoryMaker");
const { MalRefreshTokenGen } = require("./mal.js");
const { StartDiscordRPC, StopDiscordRPC } = require("./discord");
const { logger } = require("./AppLogger.js");
const userDataPath = app.getPath("userData");
const { getKeyValue, setKeyValue } = require("./db");

const appNodeModules = path.join(__dirname, "..", "..", "node_modules");

let config = [],
  ScraperAnime,
  ScraperManga,
  ScraperIcons;
global.Anime_providers = {};
global.Manga_providers = {};

// update the settings
async function settingupdate({
  quality = null,
  mal_on_off = null,
  status = null,
  malToken = null,
  CustomDownloadLocation = null,
  Animeprovider = null,
  Mangaprovider = null,
  Pagination = null,
  autoLoadNextChapter = null,
  enableDiscordRPC = null,
  mergeSubtitles = null,
  subtitleFormat = null,
  malDiscordProfile = null,
}) {
  const currentSettings = getKeyValue("Settings", "config");

  if (mal_on_off === "logout") {
    mal_on_off = false;
    malToken = null;
  } else {
    if (malToken === null) malToken = currentSettings?.malToken || null;
    if (malToken !== null) {
      mal_on_off = true;
    } else {
      mal_on_off = false;
    }
  }

  if (status === null) status = currentSettings?.status || "plan_to_watch";

  if (quality === null) {
    quality = currentSettings.quality || "1080p";
  }

  if (Animeprovider === null) {
    Animeprovider = currentSettings?.Animeprovider || null;
  }

  if (Mangaprovider === null) {
    Mangaprovider = currentSettings?.Mangaprovider || null;
  }

  if (autoLoadNextChapter === null) {
    autoLoadNextChapter = currentSettings?.autoLoadNextChapter || "on";
  }

  if (Pagination === null) {
    Pagination = currentSettings?.Pagination || "off";
  }

  if (enableDiscordRPC === null) {
    enableDiscordRPC = currentSettings?.enableDiscordRPC || "off";
  }

  if (mergeSubtitles === null) {
    mergeSubtitles = currentSettings?.mergeSubtitles || "off";
  }

  if (subtitleFormat === null) {
    subtitleFormat = currentSettings?.subtitleFormat || "vtt";
  }

  if (malDiscordProfile === null) {
    malDiscordProfile = currentSettings?.malDiscordProfile || "off";
  }

  if (CustomDownloadLocation === null) {
    CustomDownloadLocation =
      currentSettings?.CustomDownloadLocation || getDownloadsFolder();
  }

  config.quality = quality;
  config.mal_on_off = mal_on_off;
  config.status = status;
  config.malToken = malToken;
  config.CustomDownloadLocation = CustomDownloadLocation;
  config.Animeprovider = Animeprovider;
  config.Mangaprovider = Mangaprovider;
  config.Pagination = Pagination;
  config.autoLoadNextChapter = autoLoadNextChapter;
  config.enableDiscordRPC = enableDiscordRPC;
  config.mergeSubtitles = mergeSubtitles;
  config.subtitleFormat = subtitleFormat;
  config.malDiscordProfile = malDiscordProfile;

  if (config.enableDiscordRPC === "on") {
    try {
      await StartDiscordRPC();
      logger.info("Discord RPC Activated");
    } catch (err) {
      logger.error(
        `Failed to activate Discord RPC (will retry when watching): ${err.message}`,
      );
    }
  } else {
    let stopped = await StopDiscordRPC();
    if (stopped) logger.info("Discord RPC DISABLED");
  }

  await settingSave();
  return {
    quality,
    mal_on_off,
    status,
    Animeprovider,
    Mangaprovider,
    Pagination,
    autoLoadNextChapter,
    enableDiscordRPC,
    mergeSubtitles,
    subtitleFormat,
    malDiscordProfile,
  };
}

// returns valid settings
async function settingfetch() {
  try {
    let changes = false;
    // making sure download folder exists
    if (!config?.CustomDownloadLocation) {
      config.CustomDownloadLocation = getDownloadsFolder();
      changes = true;
    }

    // if downloads folder exists check if its can be access
    if (config?.CustomDownloadLocation) {
      try {
        await ensureDirectoryExists(config?.CustomDownloadLocation);
      } catch (error) {
        console.log(error);
        config.CustomDownloadLocation = getDownloadsFolder();
        changes = true;
      }
    }
    // checking Animeprovider is valid
    if (
      !config?.Animeprovider ||
      !global.Anime_providers.hasOwnProperty(config?.Animeprovider)
    ) {
      config.Animeprovider = null;
      changes = true;
    }

    // checking quality
    if (
      !config?.quality ||
      !["1080p", "720p", "360p"].includes(config?.quality)
    ) {
      config.quality = "1080p";
      changes = true;
    }

    // checking Mangaprovider is valid
    if (
      !config?.Mangaprovider ||
      !global.Manga_providers.hasOwnProperty(config?.Mangaprovider)
    ) {
      config.Mangaprovider = "weebcentral";
      changes = true;
    }

    if (!config?.hasOwnProperty("mergeSubtitles")) {
      config.mergeSubtitles = "off";
      changes = true;
    }

    if (!config?.hasOwnProperty("subtitleFormat")) {
      config.subtitleFormat = "vtt";
      changes = true;
    }

    if (!config?.hasOwnProperty("malDiscordProfile")) {
      config.malDiscordProfile = "off";
      changes = true;
    }

    if (changes) {
      await settingSave();
    }

    return config;
  } catch (err) {
    logger.error("Failed To Update Settings");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// load settings
async function SettingsLoad() {
  try {
    const storedConfig = getKeyValue("Settings", "config");
    config =
      storedConfig && typeof storedConfig === "object"
        ? storedConfig
        : {
            quality: "1080p",
            mal_on_off: false,
            status: "plan_to_watch",
            malToken: null,
            CustomDownloadLocation: getDownloadsFolder(),
            Animeprovider: null,
            Mangaprovider: "weebcentral",
            autoLoadNextChapter: "on",
            Pagination: "off",
            enableDiscordRPC: "off",
            mergeSubtitles: "off",
            subtitleFormat: "vtt",
            malDiscordProfile: "off",
          };

    const currentVersion = app.getVersion();
    if (!config.lastVersion || config.lastVersion !== currentVersion) {
      config.showWhatsNew = true;
      config.lastVersion = currentVersion;
    }

    if (config.malToken != null) {
      let Tosave = await MalRefreshTokenGen(config.malToken);
      await settingupdate(Tosave);
    }
    if (config?.enableDiscordRPC === "on") {
      try {
        await StartDiscordRPC();
        logger.info("Discord RPC Activated");
      } catch (err) {
        logger.error(err);
      }
    }
    await settingSave();
  } catch (err) {
    logger.error("Failed To Load Config");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// fetch which provider
async function providerFetch(Type = "Anime", provider) {
  if (!provider)
    provider = Type === "Anime" ? config?.Animeprovider : config?.Mangaprovider;

  if (Type === "Anime") {
    if (!provider || !global.Anime_providers[provider]) {
      const available = Object.keys(global.Anime_providers || {});
      if (available.length > 0) provider = available[0];
    }
    return {
      provider_name:
        provider && global.Anime_providers[provider] ? provider : null,
      provider:
        provider && global.Anime_providers[provider]
          ? global.Anime_providers[provider]
          : null,
    };
  } else {
    if (!provider || !global.Manga_providers[provider]) {
      const available = Object.keys(global.Manga_providers || {});
      if (available.length > 0) provider = available[0];
    }
    return {
      provider_name:
        provider && global.Manga_providers[provider] ? provider : null,
      provider:
        provider && global.Manga_providers[provider]
          ? global.Manga_providers[provider]
          : null,
    };
  }
}

// sync the config with database
async function settingSave() {
  try {
    setKeyValue("Settings", "config", config);
  } catch (err) {
    logger.error("Failed To Save Settings");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// Check Folder Exists
async function CheckScrapperFolderExists() {
  const Scraper = path.join(userDataPath, "scrapers");
  if (!fs.existsSync(Scraper)) {
    fs.mkdirSync(Scraper, { recursive: true });
    logger.info(`Created scraper folder: ${Scraper}`);
  }

  ScraperAnime = path.join(Scraper, "Anime");
  if (!fs.existsSync(ScraperAnime)) {
    fs.mkdirSync(ScraperAnime, { recursive: true });
    logger.info(`Created Anime scraper folder: ${ScraperAnime}`);
  }

  ScraperManga = path.join(Scraper, "Manga");
  if (!fs.existsSync(ScraperManga)) {
    fs.mkdirSync(ScraperManga, { recursive: true });
    logger.info(`Created Manga scraper folder: ${ScraperManga}`);
  }

  ScraperIcons = path.join(Scraper, "icons");
  if (!fs.existsSync(ScraperIcons)) {
    fs.mkdirSync(ScraperIcons, { recursive: true });
    logger.info(`Created icons folder: ${ScraperIcons}`);
  }
}

// Patch Module Path
async function patchModulePaths() {
  await CheckScrapperFolderExists();

  const oldResolveLookupPaths = Module._resolveLookupPaths;

  Module._resolveLookupPaths = function (request, parent, newReturn) {
    const result = oldResolveLookupPaths.call(this, request, parent, newReturn);
    const paths = newReturn ? result[1] : result;

    if (!paths.includes(appNodeModules)) {
      paths.unshift(appNodeModules);
    }

    return newReturn ? [result[0], paths] : paths;
  };
}

// Load All downloaded Scrapers
async function loadAllScrapers() {
  try {
    await CheckScrapperFolderExists();
    logger.info("Loading all scrapers...");

    global.Anime_providers = {};
    global.Manga_providers = {};

    const files = [
      ...fs
        .readdirSync(ScraperAnime)
        .filter((f) => f.toLowerCase().endsWith(".js"))
        .map((f) => ({ type: "anime", path: path.join(ScraperAnime, f) })),

      ...fs
        .readdirSync(ScraperManga)
        .filter((f) => f.toLowerCase().endsWith(".js"))
        .map((f) => ({ type: "manga", path: path.join(ScraperManga, f) })),
    ];

    logger.info(`Found ${files.length} scraper files.`);

    for (const { type, path: fullPath } of files) {
      try {
        const resolvedPath = require.resolve(fullPath);
        delete require.cache[resolvedPath];

        const scraper = require(fullPath);
        if (scraper?.name) {
          if (type === "anime") global.Anime_providers[scraper.name] = scraper;
          if (type === "manga") global.Manga_providers[scraper.name] = scraper;

          logger.info(`Loaded ${type} scraper: ${scraper.name}`);

          const iconDest = path.join(ScraperIcons, `${scraper.name}.ico`);
          if (!fs.existsSync(iconDest)) {
            got(
              `https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/ico/${scraper.name}.ico`,
              { responseType: "buffer" },
            )
              .then((r) => {
                fs.writeFileSync(iconDest, r.rawBody);
              })
              .catch(() => {});
          }
        } else {
          logger.warn(`Scraper missing 'name' export: ${fullPath}`);
        }
      } catch (err) {
        logger.error(`Failed to load scraper ${fullPath}: ${err.message}`);
      }
    }

    global.win.webContents.send("extention-updated", {
      Anime: Object.entries(global.Anime_providers || {}).map(([key, val]) => ({
        name: key,
        version: val.version,
      })),
      Manga: Object.entries(global.Manga_providers || {}).map(([key, val]) => ({
        name: key,
        version: val.version,
      })),
    });
  } catch (err) {
    logger.error(`Error in loadAllScrapers: ${err.message}`);
  }
}

function notifyScrapersUpdated() {
  if (global.win && global.win.webContents) {
    global.win.webContents.send("extention-updated", {
      Anime: Object.entries(global.Anime_providers || {}).map(([key, val]) => ({
        name: key,
        version: val.version,
      })),
      Manga: Object.entries(global.Manga_providers || {}).map(([key, val]) => ({
        name: key,
        version: val.version,
      })),
    });
  }
}

async function loadSingleScraper(AnimeManga, ExtensionName) {
  try {
    await CheckScrapperFolderExists();
    const folder = AnimeManga === "Anime" ? ScraperAnime : ScraperManga;
    const fullPath = path.join(folder, `${ExtensionName}.js`);

    try {
      const resolvedPath = require.resolve(fullPath);
      delete require.cache[resolvedPath];
    } catch (e) {
      // Path not in require cache yet, skip cache deletion
    }

    const scraper = require(fullPath);
    if (scraper?.name) {
      if (AnimeManga === "Anime") {
        global.Anime_providers[scraper.name] = scraper;
      } else {
        global.Manga_providers[scraper.name] = scraper;
      }
      logger.info(
        `Loaded/Reloaded ${AnimeManga.toLowerCase()} scraper: ${scraper.name}`,
      );
      notifyScrapersUpdated();
    } else {
      logger.warn(`Scraper missing 'name' export: ${fullPath}`);
    }
  } catch (err) {
    logger.error(
      `Failed to load/reload scraper ${ExtensionName}: ${err.message}`,
    );
  }
}

function unloadSingleScraper(AnimeManga, ExtensionName) {
  try {
    if (AnimeManga === "Anime") {
      delete global.Anime_providers[ExtensionName];
    } else {
      delete global.Manga_providers[ExtensionName];
    }
    logger.info(
      `Unloaded ${AnimeManga.toLowerCase()} scraper: ${ExtensionName}`,
    );
    notifyScrapersUpdated();
  } catch (err) {
    logger.error(`Failed to unload scraper ${ExtensionName}: ${err.message}`);
  }
}

// Download / Delete Scrapper
async function HandleExtensions(TaskType, AnimeManga, ExtensionName) {
  await CheckScrapperFolderExists();
  const extensionPath = path.join(
    AnimeManga === "Anime" ? ScraperAnime : ScraperManga,
    `${ExtensionName}.js`,
  );
  if (TaskType === "add") {
    try {
      const response = await got(
        `https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/extensions/${AnimeManga}/${ExtensionName}.js`,
      );
      fs.writeFileSync(extensionPath, response.body, "utf-8");

      // Download icon alongside the scraper
      try {
        const iconResponse = await got(
          `https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/ico/${ExtensionName}.ico`,
          { responseType: "buffer" },
        );
        const iconDest = path.join(ScraperIcons, `${ExtensionName}.ico`);
        fs.writeFileSync(iconDest, iconResponse.rawBody);
        logger.info(`Downloaded icon for ${ExtensionName}`);
      } catch (iconErr) {
        logger.warn(`No icon found for ${ExtensionName}: ${iconErr.message}`);
      }

      await loadSingleScraper(AnimeManga, ExtensionName);
      return {
        type: "success",
        title: `${AnimeManga} Extention Installed!`,
        msg: `${ExtensionName} Added Successfully.`,
      };
    } catch (error) {
      return {
        type: "error",
        title: "Failed to Install Extention!",
        msg: `Failed to Add ${ExtensionName} : ${error.message}`,
      };
    }
  } else if (TaskType === "remove") {
    if (fs.existsSync(extensionPath)) {
      fs.unlinkSync(extensionPath);

      unloadSingleScraper(AnimeManga, ExtensionName);
      return {
        type: "success",
        title: `Removed ${AnimeManga} Extention!`,
        msg: `${ExtensionName} removed successfully.`,
      };
    } else {
      return {
        type: "error",
        title: `Failed to Remove ${AnimeManga} Extention!`,
        msg: `${ExtensionName} does not exist.`,
      };
    }
  } else {
    return {
      type: "error",
      title: "Something Is Not Right...",
      msg: "Not a valid request!",
    };
  }
}

module.exports = {
  settingupdate,
  settingfetch,
  settingSave,
  SettingsLoad,
  providerFetch,
  loadAllScrapers,
  HandleExtensions,
  patchModulePaths,
  getScraperIconsPath: () => ScraperIcons,
};
