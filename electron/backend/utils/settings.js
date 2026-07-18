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

async function reconcileActiveProvider(Type) {
  const isAnime = Type === "Anime";
  const settingKey = isAnime ? "Animeprovider" : "Mangaprovider";
  const providers = isAnime
    ? global.Anime_providers || {}
    : global.Manga_providers || {};
  const currentProvider = config?.[settingKey] || null;
  const nextProvider = Object.prototype.hasOwnProperty.call(
    providers,
    currentProvider,
  )
    ? currentProvider
    : Object.keys(providers)[0] || null;

  if (config?.[settingKey] !== nextProvider) {
    config[settingKey] = nextProvider;
    await settingSave();
  }

  return nextProvider;
}

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
  imageCacheSizeLimit = null,
  developerMode = null,
  autoSkipIntro = null,
  autoPlayNextEpisode = null,
  mangaReaderLayout = null,
  mangaReaderWidth = null,
  infoSortOrder = null,
  upscalePreset = null,
  forceHighPerformanceGpu = null,
}) {
  const currentSettings = config;

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

  if (status === null) status = currentSettings?.status || "watching";

  if (quality === null) {
    quality = currentSettings.quality || "1080p";
  }

  if (Animeprovider === null) {
    Animeprovider =
      currentSettings?.Animeprovider ||
      Object.keys(global?.Anime_providers)?.[0] ||
      null;
  }

  if (Mangaprovider === null) {
    Mangaprovider =
      currentSettings?.Mangaprovider ||
      Object.keys(global?.Manga_providers)?.[0] ||
      null;
  }

  if (autoLoadNextChapter === null) {
    autoLoadNextChapter = currentSettings?.autoLoadNextChapter ?? true;
  }

  if (Pagination === null) {
    Pagination = currentSettings?.Pagination ?? false;
  }

  if (enableDiscordRPC === null) {
    enableDiscordRPC = currentSettings?.enableDiscordRPC ?? false;
  }

  if (mergeSubtitles === null) {
    mergeSubtitles = currentSettings?.mergeSubtitles ?? false;
  }

  if (subtitleFormat === null) {
    subtitleFormat = currentSettings?.subtitleFormat || "vtt";
  }

  if (malDiscordProfile === null) {
    malDiscordProfile = currentSettings?.malDiscordProfile ?? false;
  }

  if (CustomDownloadLocation === null) {
    CustomDownloadLocation =
      currentSettings?.CustomDownloadLocation || getDownloadsFolder();
  }

  if (imageCacheSizeLimit === null) {
    imageCacheSizeLimit = currentSettings?.imageCacheSizeLimit ?? 5;
  }

  if (developerMode === null) {
    developerMode = currentSettings?.developerMode ?? false;
  }

  if (autoSkipIntro === null) {
    autoSkipIntro = currentSettings?.autoSkipIntro ?? true;
  }

  if (autoPlayNextEpisode === null) {
    autoPlayNextEpisode = currentSettings?.autoPlayNextEpisode ?? true;
  }

  if (mangaReaderLayout === null) {
    mangaReaderLayout = currentSettings?.mangaReaderLayout || "long-strip";
  }

  if (mangaReaderWidth === null) {
    mangaReaderWidth = currentSettings?.mangaReaderWidth || 800;
  }

  if (infoSortOrder === null) {
    infoSortOrder = currentSettings?.hasOwnProperty("infoSortOrder")
      ? currentSettings.infoSortOrder
      : null;
  }

  if (upscalePreset === null) {
    upscalePreset = currentSettings?.upscalePreset || "off";
  }

  if (forceHighPerformanceGpu === null) {
    forceHighPerformanceGpu = currentSettings?.forceHighPerformanceGpu ?? false;
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
  config.imageCacheSizeLimit = imageCacheSizeLimit;
  config.developerMode = developerMode;
  config.autoSkipIntro = autoSkipIntro;
  config.autoPlayNextEpisode = autoPlayNextEpisode;
  config.mangaReaderLayout = mangaReaderLayout;
  config.mangaReaderWidth = mangaReaderWidth;
  config.infoSortOrder = infoSortOrder;
  config.upscalePreset = upscalePreset;
  config.forceHighPerformanceGpu = forceHighPerformanceGpu;

  if (config.enableDiscordRPC === true) {
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
    imageCacheSizeLimit,
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
      global.scrapersLoaded &&
      (!config?.Animeprovider ||
        !global.Anime_providers.hasOwnProperty(config?.Animeprovider))
    ) {
      config.Animeprovider = Object.keys(global?.Anime_providers)?.[0] || null;
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
      global.scrapersLoaded &&
      (!config?.Mangaprovider ||
        !global.Manga_providers.hasOwnProperty(config?.Mangaprovider))
    ) {
      config.Mangaprovider = Object.keys(global?.Manga_providers)?.[0] || null;
      changes = true;
    }

    if (!config?.hasOwnProperty("mergeSubtitles")) {
      config.mergeSubtitles = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("subtitleFormat")) {
      config.subtitleFormat = "vtt";
      changes = true;
    }

    if (!config?.hasOwnProperty("malDiscordProfile")) {
      config.malDiscordProfile = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("imageCacheSizeLimit")) {
      config.imageCacheSizeLimit = 5;
      changes = true;
    }

    if (!config?.hasOwnProperty("developerMode")) {
      config.developerMode = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("autoSkipIntro")) {
      config.autoSkipIntro = true;
      changes = true;
    }

    if (!config?.hasOwnProperty("autoPlayNextEpisode")) {
      config.autoPlayNextEpisode = true;
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
    let storedConfig = null;
    try {
      const rows = global.db.prepare("SELECT key, value FROM Settings").all();
      if (rows && rows.length > 0) {
        storedConfig = {};
        for (const row of rows) {
          try {
            storedConfig[row.key] = JSON.parse(row.value);
          } catch {
            storedConfig[row.key] = row.value;
          }
        }
      }
    } catch (_) {}
    config =
      storedConfig && typeof storedConfig === "object"
        ? storedConfig
        : {
            quality: "1080p",
            mal_on_off: false,
            status: "watching",
            malToken: null,
            CustomDownloadLocation: getDownloadsFolder(),
            Animeprovider: 0,
            Mangaprovider: 0,
            autoLoadNextChapter: true,
            Pagination: false,
            enableDiscordRPC: false,
            mergeSubtitles: false,
            subtitleFormat: "vtt",
            malDiscordProfile: false,
            imageCacheSizeLimit: 5,
            developerMode: false,
            autoSkipIntro: true,
            autoPlayNextEpisode: true,
            infoSortOrder: null,
            upscalePreset: "off",
            forceHighPerformanceGpu: false,
          };

    if (config && !config.hasOwnProperty("imageCacheSizeLimit")) {
      config.imageCacheSizeLimit = 5;
    }

    if (config && !config.hasOwnProperty("developerMode")) {
      config.developerMode = false;
    }

    if (config && !config.hasOwnProperty("upscalePreset")) {
      config.upscalePreset = "off";
    }

    if (config && !config.hasOwnProperty("forceHighPerformanceGpu")) {
      config.forceHighPerformanceGpu = false;
    }

    const currentVersion = app.getVersion();
    if (!config.lastVersion || config.lastVersion !== currentVersion) {
      config.showWhatsNew = true;
      config.lastVersion = currentVersion;
    }

    if (config.malToken != null) {
      let Tosave = await MalRefreshTokenGen(config.malToken);
      await settingupdate(Tosave);
    }
    if (config?.enableDiscordRPC === true) {
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
  const providers =
    Type === "Anime" ? global.Anime_providers : global.Manga_providers;
  const activeProvider = await reconcileActiveProvider(Type);
  const providerName =
    provider && Object.prototype.hasOwnProperty.call(providers, provider)
      ? provider
      : activeProvider;

  return {
    provider_name: providerName,
    provider: providerName ? providers[providerName] : null,
  };
}

// sync the config with database
async function settingSave() {
  try {
    for (const [k, v] of Object.entries(config)) {
      setKeyValue("Settings", k, v);
    }
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
  // Statically mark cheerio and hls-parser as used for extensions/scrapers
  if (false) {
    require("cheerio");
    require("hls-parser");
  }
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

    await reconcileActiveProvider("Anime");
    await reconcileActiveProvider("Manga");
    notifyScrapersUpdated();
    global.scrapersLoaded = true;
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
      await reconcileActiveProvider(AnimeManga);
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

function disableWhatsNew() {
  if (config) {
    config.showWhatsNew = false;
    settingSave();
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
  disableWhatsNew,
  getScraperIconsPath: () => ScraperIcons,
};
