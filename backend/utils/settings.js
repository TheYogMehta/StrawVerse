// libs
const Module = require("module");
const path = require("path");
const got = require("got").default || require("got");
const fs = require("fs");

// Functions
const {
  getDownloadsFolder,
  ensureDirectoryExists,
} = require("./DirectoryMaker");
const { logger, configureExternalLogs } = require("./AppLogger.js");

// Log folder users can actually reach: shared StrawVerse/logs on
// mobile, ~/StrawVerse/logs on desktop.
function getEffectiveLogDir() {
  if (
    process.env.NODEJS_MOBILE_DATA_DIR &&
    process.env.STRAWVERSE_PUBLIC_ROOT
  ) {
    try {
      const dir = path.join(process.env.STRAWVERSE_PUBLIC_ROOT, "logs");
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch (_) {}
  }
  const { getExternalLogDir } = require("./AppLogger.js");
  return getExternalLogDir();
}
const { setKeyValue, queryAll, unwrapJson } = require("./db");
const { getUserDataPath, isAndroid } = require("./constants");

const userDataPath = getUserDataPath();

let StartDiscordRPC = null;
let StopDiscordRPC = null;
if (process.versions?.electron && !isAndroid) {
  try {
    const discord = require("./discord");
    StartDiscordRPC = discord.StartDiscordRPC;
    StopDiscordRPC = discord.StopDiscordRPC;
  } catch (e) {}
}

const appNodeModules = path.join(__dirname, "..", "..", "node_modules");

let config = {},
  ScraperAnime,
  ScraperManga,
  ScraperMovies,
  ScraperIcons;
global.Anime_providers = {};
global.Manga_providers = {};
global.Movies_providers = {};

async function reconcileActiveProvider(Type) {
  const norm = String(Type || "").toLowerCase();
  const isAnime = norm === "anime";
  const isManga = norm === "manga";
  const settingKey = isAnime
    ? "Animeprovider"
    : isManga
      ? "Mangaprovider"
      : "Moviesprovider";
  const providers = isAnime
    ? global.Anime_providers || {}
    : isManga
      ? global.Manga_providers || {}
      : global.Movies_providers || {};
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
async function settingupdate(newSettings = {}) {
  const wasMediaServerEnabled = Boolean(config.mediaServerNaming);
  const oldMangaScheme = config.mangaNamingScheme || "default";
  if (newSettings && typeof newSettings === "object") {
    for (const [k, v] of Object.entries(newSettings)) {
      if (v !== undefined) {
        config[k] = v;
      }
    }
  }

  if (
    newSettings.mangaNamingScheme !== undefined &&
    newSettings.mangaNamingScheme !== oldMangaScheme
  ) {
    try {
      await renameExistingMangaChapters(newSettings.mangaNamingScheme);
    } catch (err) {
      logger.error(`[MangaRename] Auto-rename error: ${err.message}`);
    }
  }

  if (config.mediaServerNaming === true && !wasMediaServerEnabled) {
    try {
      const { generateAllNfosAndPosters } = require("./mediaServer");
      generateAllNfosAndPosters().catch((err) => {
        logger.error(
          `[MediaServer] Background NFO generation error: ${err.message}`,
        );
      });
    } catch (_) {}
  }

  if (process.versions?.electron && StartDiscordRPC) {
    if (config.enableDiscordRPC === true) {
      try {
        await StartDiscordRPC();
        logger.info("Discord RPC Activated");
      } catch (err) {
        logger.error(
          `Failed to activate Discord RPC (will retry when watching): ${err.message}`,
        );
      }
    } else if (StopDiscordRPC) {
      let stopped = await StopDiscordRPC();
      if (stopped) logger.info("Discord RPC DISABLED");
    }
  }

  try {
    configureExternalLogs({
      enabled: config.externalLogEnabled !== false,
      maxFiles: config.maxLogFiles,
      dir: getEffectiveLogDir(),
    });
  } catch (_) {}

  await settingSave();
  return config;
}

// returns valid settings
async function settingfetch() {
  try {
    if (!config || Object.keys(config).length === 0) {
      await SettingsLoad();
    }
    let changes = false;
    for (const key of [
      "CustomDownloadLocationAnime",
      "CustomDownloadLocationManga",
      "CustomDownloadLocationMovies",
    ]) {
      if (typeof config?.[key] === "string") {
        config[key] = config[key].replace(/^["']|["']$/g, "").trim();
      }
    }

    // ensure configured download directories exist (creating if not present)
    for (const key of [
      "CustomDownloadLocationAnime",
      "CustomDownloadLocationManga",
      "CustomDownloadLocationMovies",
    ]) {
      if (config?.[key]) {
        try {
          await ensureDirectoryExists(config[key]);
        } catch (_) {}
      }
    }
    // kept log files: default 5, user range 1..10
    const parsedLogFiles = parseInt(config?.maxLogFiles, 10);
    const clampedLogFiles = isNaN(parsedLogFiles)
      ? 5
      : Math.min(Math.max(parsedLogFiles, 1), 10);
    if (config?.maxLogFiles !== clampedLogFiles) {
      config.maxLogFiles = clampedLogFiles;
      changes = true;
    }
    // checking Animeprovider is valid
    if (
      global.scrapersLoaded &&
      (!config?.Animeprovider ||
        !global?.Anime_providers[config?.Animeprovider])
    ) {
      const availableAnimeProviders = Object.keys(global.Anime_providers);
      if (availableAnimeProviders.length > 0) {
        config.Animeprovider = availableAnimeProviders[0];
        changes = true;
      }
    }

    // checking Mangaprovider is valid
    if (
      global.scrapersLoaded &&
      (!config?.Mangaprovider ||
        !global?.Manga_providers[config?.Mangaprovider])
    ) {
      const availableMangaProviders = Object.keys(global.Manga_providers);
      if (availableMangaProviders.length > 0) {
        config.Mangaprovider = availableMangaProviders[0];
        changes = true;
      }
    }

    // checking Moviesprovider is valid
    if (
      global.scrapersLoaded &&
      (!config?.Moviesprovider ||
        !global?.Movies_providers[config?.Moviesprovider])
    ) {
      const availableMoviesProviders = Object.keys(
        global.Movies_providers || {},
      );
      if (availableMoviesProviders.length > 0) {
        config.Moviesprovider = availableMoviesProviders[0];
        changes = true;
      }
    }

    if (!config?.hasOwnProperty("autoPlayNextEpisode")) {
      config.autoPlayNextEpisode = true;
      changes = true;
    }

    if (!config?.hasOwnProperty("autoSkipIntro")) {
      config.autoSkipIntro = true;
      changes = true;
    }

    if (!config?.hasOwnProperty("enableDiscordRPC")) {
      config.enableDiscordRPC = false;
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

    if (!config?.hasOwnProperty("upscalePreset")) {
      config.upscalePreset = "off";
      changes = true;
    }

    if (!config?.hasOwnProperty("forceHighPerformanceGpu")) {
      config.forceHighPerformanceGpu = false;
      changes = true;
    }

    if (!config?.hasOwnProperty("preferredSubtitleLanguages")) {
      config.preferredSubtitleLanguages = ["English"];
      changes = true;
    }

    if (!config?.hasOwnProperty("subFontSize")) {
      config.subFontSize = 46;
      changes = true;
    }

    if (!config?.hasOwnProperty("subColor")) {
      config.subColor = "#FFFFFF";
      changes = true;
    }

    if (!config?.hasOwnProperty("subBorderColor")) {
      config.subBorderColor = "#000000";
      changes = true;
    }

    if (!config?.hasOwnProperty("subBorderSize")) {
      config.subBorderSize = 3.0;
      changes = true;
    }

    if (!config?.hasOwnProperty("subBgColor")) {
      config.subBgColor = "transparent";
      changes = true;
    }

    if (!config?.hasOwnProperty("playerSpeed")) {
      config.playerSpeed = 1.0;
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
      const rows = await queryAll("SELECT key, value FROM Settings");
      if (rows && rows.length > 0) {
        storedConfig = {};
        for (const row of rows) {
          storedConfig[row.key] = unwrapJson(row.value);
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
            CustomDownloadLocationAnime: null,
            CustomDownloadLocationManga: null,
            CustomDownloadLocationMovies: null,
            mangaAutoScrollSpeed: 2,
            externalLogEnabled: true,
            maxLogFiles: 5,
            Animeprovider: 0,
            Mangaprovider: 0,
            Moviesprovider: 0,
            autoLoadNextChapter: true,
            Pagination: false,
            enableDiscordRPC: false,
            mergeSubtitles: false,
            mediaServerNaming: false,
            subtitleFormat: "vtt",
            malDiscordProfile: false,
            imageCacheSizeLimit: 5,
            developerMode: false,
            autoSkipIntro: true,
            autoPlayNextEpisode: true,
            subFontSize: 46,
            subColor: "#FFFFFF",
            subBorderColor: "#000000",
            subBorderSize: 3.0,
            subBgColor: "transparent",
            playerSpeed: 1.0,
            infoSortOrder: null,
            upscalePreset: "off",
            forceHighPerformanceGpu: false,
            preferredSubtitleLanguages: ["English"],
            jellyfinCompatibility: false,
            animeNamingScheme: "default",
            mangaNamingScheme: "default",
          };

    if (config && !config.hasOwnProperty("subFontSize")) {
      config.subFontSize = 46;
    }
    if (config && !config.hasOwnProperty("subColor")) {
      config.subColor = "#FFFFFF";
    }
    if (config && !config.hasOwnProperty("subBorderColor")) {
      config.subBorderColor = "#000000";
    }
    if (config && !config.hasOwnProperty("subBorderSize")) {
      config.subBorderSize = 3.0;
    }
    if (config && !config.hasOwnProperty("subBgColor")) {
      config.subBgColor = "transparent";
    }
    if (config && !config.hasOwnProperty("playerSpeed")) {
      config.playerSpeed = 1.0;
    }

    if (config && !config.hasOwnProperty("imageCacheSizeLimit")) {
      config.imageCacheSizeLimit = 5;
    }

    if (config && !config.hasOwnProperty("externalLogEnabled")) {
      config.externalLogEnabled = true;
    }
    // One-time migration: external logs were force-disabled on mobile
    // before this setting existed there, so flip it on exactly once.
    if (config && !config.hasOwnProperty("maxLogFiles")) {
      config.maxLogFiles = 5;
    }
    if (
      process.env.NODEJS_MOBILE_DATA_DIR &&
      !config.hasOwnProperty("logPolicyMigrated")
    ) {
      config.externalLogEnabled = true;
      config.logPolicyMigrated = true;
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

    if (config && !config.hasOwnProperty("preferredSubtitleLanguages")) {
      config.preferredSubtitleLanguages = ["English"];
    }

    if (config && !config.hasOwnProperty("mediaServerNaming")) {
      config.mediaServerNaming = false;
    }

    if (config && !config.hasOwnProperty("animeNamingScheme")) {
      config.animeNamingScheme = "default";
    }

    if (config && !config.hasOwnProperty("mangaNamingScheme")) {
      config.mangaNamingScheme = "default";
    }

    let currentVersion = "1.0.0";
    try {
      const { app } = require("electron");
      if (app && typeof app.getVersion === "function") {
        currentVersion = app.getVersion();
      }
    } catch (e) {}
    if (!currentVersion || currentVersion === "1.0.0") {
      try {
        const pkg = require("../../package.json");
        currentVersion = pkg.version || "1.0.0";
      } catch (e) {}
    }

    if (!config.lastVersion || config.lastVersion !== currentVersion) {
      config.showWhatsNew = true;
      config.lastVersion = currentVersion;
    }

    if (config.malToken != null) {
      try {
        const { MalRefreshTokenGen } = require("./mal");
        if (typeof MalRefreshTokenGen === "function") {
          MalRefreshTokenGen(config.malToken)
            .then(async (toSave) => {
              if (toSave) await settingupdate(toSave);
            })
            .catch((malErr) => {
              logger.error(
                "Failed to refresh MAL token on settings load: " +
                  malErr.message,
              );
            });
        }
      } catch (malErr) {
        logger.error(
          "Failed to refresh MAL token on settings load: " + malErr.message,
        );
      }
    }

    if (
      process.versions?.electron &&
      StartDiscordRPC &&
      config?.enableDiscordRPC === true
    ) {
      try {
        await StartDiscordRPC();
        logger.info("Discord RPC Activated");
      } catch (err) {
        logger.error(err);
      }
    }
    try {
      configureExternalLogs({
        enabled: config.externalLogEnabled !== false,
        maxFiles: config.maxLogFiles,
        dir: getEffectiveLogDir(),
      });
    } catch (_) {}

    try {
      if (config?.mangaNamingScheme) {
        renameExistingMangaChapters(config.mangaNamingScheme).catch((err) => {
          logger.error(`[MangaRename] Startup sync error: ${err.message}`);
        });
      }
    } catch (_) {}

    await settingSave();
  } catch (err) {
    logger.error("Failed To Load Config");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// save the settings
async function settingSave() {
  try {
    for (const [k, v] of Object.entries(config)) {
      await setKeyValue("Settings", k, v);
    }
  } catch (err) {
    logger.error("Failed To Save Config");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

function disableWhatsNew() {
  try {
    config.showWhatsNew = false;
    settingSave();
  } catch (err) {
    logger.error("Failed To Disable What's New");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

function ensureNomediaFile(dir) {
  try {
    const nomedia = path.join(dir, ".nomedia");
    if (!fs.existsSync(nomedia)) {
      fs.writeFileSync(nomedia, "");
    }
  } catch (_) {}
}

// Check Folder Exists
async function CheckScrapperFolderExists() {
  const scraperBaseName = process.env.NODEJS_MOBILE_DATA_DIR
    ? "scrapper"
    : "scrapers";
  const iconBaseName = process.env.NODEJS_MOBILE_DATA_DIR ? "ico" : "icons";

  const Scraper = path.join(userDataPath, scraperBaseName);
  if (!fs.existsSync(Scraper)) {
    fs.mkdirSync(Scraper, { recursive: true });
    logger.info(`Created scraper folder: ${Scraper}`);
  }
  ensureNomediaFile(Scraper);

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

  ScraperMovies = path.join(Scraper, "movies-tvshows");
  if (!fs.existsSync(ScraperMovies)) {
    fs.mkdirSync(ScraperMovies, { recursive: true });
    logger.info(`Created movies-tvshows scraper folder: ${ScraperMovies}`);
  }

  ScraperIcons = path.join(Scraper, iconBaseName);
  if (!fs.existsSync(ScraperIcons)) {
    fs.mkdirSync(ScraperIcons, { recursive: true });
    logger.info(`Created icons folder: ${ScraperIcons}`);
  }
  ensureNomediaFile(ScraperIcons);
}

// --- Extension Security & Multi-Repo Marketplace Utilities ---

async function httpGetText(url, timeoutMs = 15000) {
  try {
    const client = global.axios || require("axios");
    const res = await client.get(url, {
      timeout: timeoutMs,
      responseType: "text",
      headers: {
        "Cache-Control": "no-cache",
        Pragma: "no-cache",
      },
      transformResponse: [(data) => data],
    });
    return typeof res.data === "string" ? res.data : JSON.stringify(res.data);
  } catch (axiosErr) {
    try {
      return await got(url, {
        timeout: { request: timeoutMs },
        headers: { "Cache-Control": "no-cache", Pragma: "no-cache" },
      }).text();
    } catch (_) {
      throw axiosErr;
    }
  }
}

async function httpGetBuffer(url, timeoutMs = 10000) {
  try {
    const client = global.axios || require("axios");
    const res = await client.get(url, {
      timeout: timeoutMs,
      responseType: "arraybuffer",
    });
    return Buffer.from(res.data);
  } catch (axiosErr) {
    try {
      return await got(url, {
        responseType: "buffer",
        timeout: { request: timeoutMs },
      }).buffer();
    } catch (_) {
      throw axiosErr;
    }
  }
}

const BLOCKED_MODULES = new Set([
  "child_process",
  "worker_threads",
  "cluster",
  "v8",
  "vm",
  "inspector",
  "repl",
  "fs",
  "fs/promises",
  "fs-extra",
  "electron",
]);

/**
 * Static security analyzer for extensions.
 * Verifies that the scraper script does not use dangerous Node.js built-ins,
 * spawn shell commands, touch the filesystem directly, or attempt process kill/exit.
 *
 * @param {string} code - The extension JavaScript code
 * @returns {{ safe: boolean, reason?: string }}
 */
function validateExtensionSafety(code, repoOwner = "TheYogMehta") {
  if (!code || typeof code !== "string") {
    return { safe: false, reason: "Empty or invalid extension code." };
  }

  const isOfficial = String(repoOwner).toLowerCase() === "theyogmehta";

  // 1. Prohibited module requires (child_process, fs, cluster, worker_threads, electron, vm, v8, database drivers)
  const forbiddenModules = [
    "child_process",
    "cluster",
    "worker_threads",
    "inspector",
    "repl",
    "fs",
    "fs/promises",
    "fs-extra",
    "electron",
    "vm",
    "v8",
    "better-sqlite3",
    "sqlite3",
    "sqlite",
    "mysql",
    "mysql2",
    "pg",
    "sequelize",
    "typeorm",
    "knex",
    "prisma",
    "mongoose",
    "mongodb",
  ];

  for (const mod of forbiddenModules) {
    const requireRegex = new RegExp(
      `(?:require|import)\\s*\\(?\\s*['"\`]${mod}(?:\\/[^'"\`]*)?['"\`]\\s*\\)?`,
      "i",
    );
    if (requireRegex.test(code)) {
      return {
        safe: false,
        reason: `Extension attempts to load forbidden module '${mod}'.`,
      };
    }
  }

  // 2. Prohibited direct database access to main user database (global.db)
  const directMainDbRegex = /\bglobal(?:\??\.)\s*db\b/i;
  if (directMainDbRegex.test(code)) {
    return {
      safe: false,
      reason:
        "Extension attempts unauthorized direct access to main app database (global.db). Use getExtensionDb() instead.",
    };
  }

  // 3. For unofficial extensions, prevent raw mappingDb bypass (must use getExtensionDb)
  if (!isOfficial) {
    const rawMappingDbRegex = /\bglobal(?:\??\.)\s*mappingDb\b/i;
    if (rawMappingDbRegex.test(code)) {
      return {
        safe: false,
        reason:
          "Community extension attempts direct raw access to global.mappingDb. Use getExtensionDb() instead.",
      };
    }
  }

  // 4. Dangerous process manipulation
  const processDangerRegex =
    /\bprocess\s*\.\s*(exit|kill|abort|mainModule|binding|_linkedBinding)\b/i;
  if (processDangerRegex.test(code)) {
    return {
      safe: false,
      reason:
        "Extension attempts dangerous process control (process.exit/kill/binding).",
    };
  }

  return { safe: true };
}

const DEFAULT_EXTENSION_REPO = {
  id: "TheYogMehta/extensions",
  owner: "TheYogMehta",
  name: "extensions",
  displayName: "Official Extensions",
  url: "https://github.com/TheYogMehta/extensions",
  marketplaceUrl:
    "https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main/marketplace.json",
  rawBaseUrl:
    "https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main",
  isDefault: true,
};

function parseExtensionRepoUrl(inputUrl) {
  if (!inputUrl || typeof inputUrl !== "string") {
    throw new Error("Repository URL cannot be empty.");
  }
  let cleanUrl = inputUrl.trim();

  // Pattern 1: GitHub repository URL (e.g. https://github.com/owner/repo or https://github.com/owner/repo/tree/branch)
  // Strip trailing slashes and .git
  const normalizedGh = cleanUrl.replace(/\.git\/?$/i, "").replace(/\/+$/, "");
  const ghRepoMatch = normalizedGh.match(
    /^https?:\/\/github\.com\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)(?:\/tree\/([a-zA-Z0-9_\-]+))?$/i,
  );
  if (ghRepoMatch) {
    const owner = ghRepoMatch[1];
    const repoName = ghRepoMatch[2];
    const branch = ghRepoMatch[3] || "main";
    const rawBaseUrl = `https://raw.githubusercontent.com/${owner}/${repoName}/${branch}`;
    return {
      id: `${owner}/${repoName}`,
      owner,
      name: repoName,
      branch,
      url: normalizedGh,
      rawBaseUrl,
      marketplaceUrl: `${rawBaseUrl}/marketplace.json`,
      isDefault:
        owner.toLowerCase() === "theyogmehta" &&
        repoName.toLowerCase() === "extensions",
    };
  }

  // Pattern 2: GitHub raw URL ending in marketplace.json
  const ghRawMatch = cleanUrl.match(
    /^https?:\/\/raw\.githubusercontent\.com\/([a-zA-Z0-9_\-]+)\/([a-zA-Z0-9_\-]+)\/(?:refs\/heads\/)?([a-zA-Z0-9_\-]+)\/marketplace\.json$/i,
  );
  if (ghRawMatch) {
    const owner = ghRawMatch[1];
    const repoName = ghRawMatch[2];
    const branch = ghRawMatch[3] || "main";
    const rawBaseUrl = cleanUrl.replace(/\/marketplace\.json$/i, "");
    return {
      id: `${owner}/${repoName}`,
      owner,
      name: repoName,
      branch,
      url: `https://github.com/${owner}/${repoName}`,
      rawBaseUrl,
      marketplaceUrl: cleanUrl,
      isDefault:
        owner.toLowerCase() === "theyogmehta" &&
        repoName.toLowerCase() === "extensions",
    };
  }

  // Pattern 3: Generic raw marketplace.json URL
  if (cleanUrl.endsWith("/marketplace.json") || cleanUrl.endsWith(".json")) {
    let owner = "custom";
    let name = "community-repo";
    try {
      const parsed = new URL(cleanUrl);
      const segs = parsed.pathname.split("/").filter(Boolean);
      if (segs.length >= 2) {
        owner = segs[0];
        name = segs[1];
      } else if (segs.length === 1) {
        owner = segs[0];
      } else {
        owner = parsed.hostname.split(".")[0];
      }
    } catch (_) {}
    const rawBaseUrl = cleanUrl.substring(0, cleanUrl.lastIndexOf("/"));
    return {
      id: `${owner}/${name}`,
      owner,
      name,
      url: cleanUrl,
      rawBaseUrl,
      marketplaceUrl: cleanUrl,
      isDefault: false,
    };
  }

  throw new Error(
    "Invalid repository URL. Please provide a GitHub repository link (e.g. https://github.com/user/repo) or direct URL to marketplace.json.",
  );
}

function getExtensionRepos() {
  if (Array.isArray(config?.extension_repos)) {
    return config.extension_repos;
  }

  // Backward compatibility with config.custom_extension_repos
  if (Array.isArray(config?.custom_extension_repos)) {
    const list = [];
    if (!config?.default_repo_removed) {
      list.push(DEFAULT_EXTENSION_REPO);
    }
    for (const r of config.custom_extension_repos) {
      if (r && r.owner && r.url) {
        const repoObj = {
          id: r.id || `${r.owner}/${r.name || "repo"}`,
          owner: r.owner,
          name: r.name || "repo",
          url: r.url,
          rawBaseUrl: r.rawBaseUrl,
          marketplaceUrl: r.marketplaceUrl,
          isDefault: !!r.isDefault,
        };
        if (
          !list.some(
            (existing) =>
              (existing.id || existing.url).toLowerCase() ===
              (repoObj.id || repoObj.url).toLowerCase(),
          )
        ) {
          list.push(repoObj);
        }
      }
    }
    return list;
  }

  return [DEFAULT_EXTENSION_REPO];
}

async function addExtensionRepo(inputUrl) {
  const parsed = parseExtensionRepoUrl(inputUrl);

  const currentRepos = getExtensionRepos();
  const exists = currentRepos.some((r) => {
    const rId = (r.id || `${r.owner}/${r.name}`).toLowerCase();
    const pId = (parsed.id || `${parsed.owner}/${parsed.name}`).toLowerCase();
    const rMarketplace = (r.marketplaceUrl || "").toLowerCase();
    const pMarketplace = (parsed.marketplaceUrl || "").toLowerCase();
    const rUrl = (r.url || "").toLowerCase();
    const pUrl = (parsed.url || "").toLowerCase();
    return rId === pId || rMarketplace === pMarketplace || rUrl === pUrl;
  });
  if (exists) {
    throw new Error(
      `Repository '${parsed.id || parsed.name}' is already added.`,
    );
  }

  // Validate that marketplace.json exists and is valid
  let res = null;
  try {
    res = await httpGetText(parsed.marketplaceUrl, 10000);
  } catch (err) {
    // If branch was main and failed, attempt fallback to master branch
    if (parsed.branch === "main" && parsed.rawBaseUrl) {
      const masterRawBase = parsed.rawBaseUrl.replace(/\/main$/, "/master");
      const masterMarketplace = `${masterRawBase}/marketplace.json`;
      try {
        const masterRes = await httpGetText(masterMarketplace, 10000);
        if (masterRes && !masterRes.includes("404: Not Found")) {
          res = masterRes;
          parsed.branch = "master";
          parsed.rawBaseUrl = masterRawBase;
          parsed.marketplaceUrl = masterMarketplace;
        }
      } catch (_) {}
    }
    if (!res) {
      throw new Error(
        `Failed to fetch marketplace.json from repository: ${err.message}`,
      );
    }
  }

  if (res && res.includes("404: Not Found")) {
    throw new Error(
      "Repository marketplace.json not found (HTTP 404). Please ensure the repository contains a valid marketplace.json.",
    );
  }

  let json = null;
  try {
    json = JSON.parse(res);
  } catch (parseErr) {
    throw new Error(
      `Failed to parse marketplace.json from repository: ${parseErr.message}`,
    );
  }

  if (
    !json ||
    (!Array.isArray(json.Anime) &&
      !Array.isArray(json.Manga) &&
      !Array.isArray(json["movies-tvshows"]) &&
      !Array.isArray(json.Movies))
  ) {
    throw new Error(
      "Repository marketplace.json must contain 'Anime', 'Manga', or 'movies-tvshows' extension arrays.",
    );
  }

  const updatedRepos = [...currentRepos, parsed];
  config.extension_repos = updatedRepos;
  config.custom_extension_repos = updatedRepos.filter((r) => !r.isDefault);
  await settingSave();

  const animeCount = json.Anime?.length || 0;
  const mangaCount = json.Manga?.length || 0;
  const moviesCount =
    json["movies-tvshows"]?.length || json.Movies?.length || 0;
  logger.info(
    `[Marketplace] Added extension repo: ${parsed.id || parsed.name} (${animeCount} anime, ${mangaCount} manga, ${moviesCount} movies-tvshows)`,
  );

  return {
    success: true,
    repo: parsed,
    repos: updatedRepos,
    stats: { anime: animeCount, manga: mangaCount, movies: moviesCount },
  };
}

async function removeExtensionRepo(identifier) {
  if (!identifier) throw new Error("Repository identifier is required.");
  const currentRepos = getExtensionRepos();
  const idLower = String(identifier).toLowerCase().trim();

  const filtered = currentRepos.filter((r) => {
    const rId = (r.id || `${r.owner}/${r.name}`).toLowerCase();
    const rUrl = (r.url || "").toLowerCase();
    const rMarketplace = (r.marketplaceUrl || "").toLowerCase();
    const rOwner = (r.owner || "").toLowerCase();
    const rName = (r.name || "").toLowerCase();

    if (rId === idLower || rUrl === idLower || rMarketplace === idLower) {
      return false;
    }
    if (`@${rId}` === idLower || `@${rOwner}/${rName}` === idLower) {
      return false;
    }
    if (`${rOwner}/${rName}` === idLower) {
      return false;
    }
    const sameOwnerRepos = currentRepos.filter(
      (x) => (x.owner || "").toLowerCase() === idLower,
    );
    if (sameOwnerRepos.length === 1 && rOwner === idLower) {
      return false;
    }
    return true;
  });

  if (filtered.length === currentRepos.length) {
    throw new Error(
      `Repository '${identifier}' not found in active repositories.`,
    );
  }

  config.extension_repos = filtered;
  config.custom_extension_repos = filtered.filter((r) => !r.isDefault);
  if (!filtered.some((r) => r.isDefault)) {
    config.default_repo_removed = true;
  } else {
    config.default_repo_removed = false;
  }
  await settingSave();
  logger.info(`[Marketplace] Removed extension repo: ${identifier}`);
  return { success: true, repos: filtered };
}

async function restoreDefaultExtensionRepo() {
  const currentRepos = getExtensionRepos();
  const hasDefault = currentRepos.some(
    (r) =>
      r.isDefault ||
      (r.id &&
        r.id.toLowerCase() === DEFAULT_EXTENSION_REPO.id.toLowerCase()) ||
      (r.url &&
        r.url.toLowerCase() === DEFAULT_EXTENSION_REPO.url.toLowerCase()),
  );
  let updated = currentRepos;
  if (!hasDefault) {
    updated = [DEFAULT_EXTENSION_REPO, ...currentRepos];
    config.extension_repos = updated;
    config.custom_extension_repos = updated.filter((r) => !r.isDefault);
    config.default_repo_removed = false;
    await settingSave();
    logger.info("[Marketplace] Restored official default extension repository");
  }
  return { success: true, repos: updated };
}

async function fetchAggregatedMarketplace(activeType = "Anime") {
  const repos = getExtensionRepos();
  const aggregated = [];
  const norm = String(activeType || "").toLowerCase();
  const isMovies = norm === "movies" || norm === "movies-tvshows";

  if (!repos || repos.length === 0) {
    return {
      items: [],
      repos: [],
    };
  }

  const results = await Promise.allSettled(
    repos.map(async (repo) => {
      try {
        const text = await httpGetText(repo.marketplaceUrl, 8000);
        const data = JSON.parse(text);
        let list = [];
        if (isMovies) {
          list = Array.isArray(data["movies-tvshows"])
            ? data["movies-tvshows"]
            : Array.isArray(data.Movies)
              ? data.Movies
              : [];
        } else {
          list = Array.isArray(data[activeType]) ? data[activeType] : [];
        }
        const repoId = repo.id || `${repo.owner}/${repo.name}`;
        return list.map((item) => ({
          ...item,
          type: isMovies ? "Movies" : activeType,
          category: isMovies ? "movies-tvshows" : activeType,
          repoOwner: repo.owner,
          repoName: repo.name,
          repoId,
          repoBaseUrl: repo.rawBaseUrl,
          uniqueId: `${repo.owner}/${item.name}`,
          isDefaultRepo: !!repo.isDefault,
        }));
      } catch (err) {
        logger.warn(
          `[Marketplace] Failed to fetch marketplace for @${repo.owner}/${repo.name}: ${err.message}`,
        );
        return [];
      }
    }),
  );

  for (const res of results) {
    if (res.status === "fulfilled" && Array.isArray(res.value)) {
      aggregated.push(...res.value);
    }
  }

  return {
    items: aggregated,
    repos,
  };
}

// Patch Module Path with Security Enforcement
async function patchModulePaths() {
  await CheckScrapperFolderExists();
  try {
    // Statically mark cheerio as used for extensions/scrapers
    require("cheerio");
  } catch (_) {}
  const originalResolve = Module._resolveFilename;

  Module._resolveFilename = function (request, parent, isMain) {
    const isScraper =
      parent &&
      parent.filename &&
      (parent.filename.startsWith(ScraperAnime) ||
        parent.filename.startsWith(ScraperManga) ||
        (ScraperMovies && parent.filename.startsWith(ScraperMovies)));

    if (isScraper && BLOCKED_MODULES.has(request)) {
      throw new Error(
        `Extension Security Violation: Module '${request}' is blocked in StrawVerse extensions.`,
      );
    }

    try {
      return originalResolve.call(this, request, parent, isMain);
    } catch (err) {
      if (isScraper) {
        if (BLOCKED_MODULES.has(request)) {
          throw new Error(
            `Extension Security Violation: Module '${request}' is blocked in StrawVerse extensions.`,
          );
        }
        try {
          const customPath = path.join(appNodeModules, request);
          return originalResolve.call(this, customPath, parent, isMain);
        } catch (innerErr) {}
      }
      throw err;
    }
  };
}

function isVersionBelow(curr, req) {
  if (!curr || !req) return false;
  const cParts = String(curr)
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  const rParts = String(req)
    .replace(/^v/, "")
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(cParts.length, rParts.length); i++) {
    const c = cParts[i] || 0;
    const r = rParts[i] || 0;
    if (c < r) return true;
    if (c > r) return false;
  }
  return false;
}

// Auto-cleanup legacy scrapers stored directly under ScraperAnime and ScraperManga root
function cleanupLegacyRootScrapers() {
  const folders = [
    { dir: ScraperAnime, type: "Anime" },
    { dir: ScraperManga, type: "Manga" },
    { dir: ScraperMovies, type: "Movies" },
  ];
  for (const { dir, type } of folders) {
    try {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir);
      for (const entry of entries) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (!stat.isDirectory() && entry.endsWith(".js")) {
            fs.unlinkSync(fullPath);
            logger.info(
              `[Cleanup] Auto-deleted legacy ${type.toLowerCase()} extension from root: ${entry}`,
            );
          }
        } catch (err) {
          logger.warn(
            `[Cleanup] Failed to delete legacy ${type.toLowerCase()} file ${entry}: ${err.message}`,
          );
        }
      }
    } catch (err) {
      logger.warn(
        `[Cleanup] Error scanning ${type} directory for legacy files: ${err.message}`,
      );
    }
  }
}

// load scrapers from scoped directories
async function loadAllScrapers() {
  try {
    await CheckScrapperFolderExists();
    cleanupLegacyRootScrapers();

    // Development only extension sync for Electron
    if (process.versions?.electron) {
      try {
        const { app } = require("electron");
        if (app && typeof app.getAppPath === "function") {
          const localExtDir = path.join(
            app.getAppPath(),
            "..",
            "extensions",
            "extensions",
          );
          if (fs.existsSync(localExtDir)) {
            const repoAnime = path.join(localExtDir, "Anime");
            if (fs.existsSync(repoAnime)) {
              const defaultAnimeDir = path.join(ScraperAnime, "TheYogMehta");
              if (!fs.existsSync(defaultAnimeDir)) {
                fs.mkdirSync(defaultAnimeDir, { recursive: true });
              }
              const files = fs
                .readdirSync(repoAnime)
                .filter((f) => f.endsWith(".js"));
              for (const f of files) {
                fs.copyFileSync(
                  path.join(repoAnime, f),
                  path.join(defaultAnimeDir, f),
                );
              }
            }
            const repoManga = path.join(localExtDir, "Manga");
            if (fs.existsSync(repoManga)) {
              const defaultMangaDir = path.join(ScraperManga, "TheYogMehta");
              if (!fs.existsSync(defaultMangaDir)) {
                fs.mkdirSync(defaultMangaDir, { recursive: true });
              }
              const files = fs
                .readdirSync(repoManga)
                .filter((f) => f.endsWith(".js"));
              for (const f of files) {
                fs.copyFileSync(
                  path.join(repoManga, f),
                  path.join(defaultMangaDir, f),
                );
              }
            }
          }
        }
      } catch (e) {}
    }

    logger.info("Loading all scrapers...");

    const {
      registerExtension,
      clearRegisteredExtensions,
    } = require("./extensionRegistry");
    clearRegisteredExtensions();

    global.Anime_providers = {};
    global.Manga_providers = {};
    global.Movies_providers = {};

    let animeCount = 0;
    let mangaCount = 0;
    let moviesCount = 0;

    const loadScraperFile = (fullPath, repoOwner, type) => {
      try {
        const code = fs.readFileSync(fullPath, "utf8");
        const safety = validateExtensionSafety(code, repoOwner);
        if (!safety.safe) {
          logger.warn(
            `[Security] Blocked unsafe scraper ${type}/${repoOwner}/${path.basename(fullPath)}: ${safety.reason}`,
          );
          return null;
        }

        try {
          delete require.cache[require.resolve(fullPath)];
        } catch (_) {}

        const scraper = require(fullPath);
        if (scraper?.name) {
          const { getCurrentAppVersion } = require("./constants");
          const currentAppVer = getCurrentAppVersion();
          const requiredAppVer = scraper.minAppVersion || scraper.MinAppVersion;
          if (requiredAppVer && isVersionBelow(currentAppVer, requiredAppVer)) {
            logger.warn(
              `[Compatibility] Skipping scraper ${type}/${repoOwner}/${scraper.name}: requires StrawVerse v${requiredAppVer}+ (current: v${currentAppVer})`,
            );
            return null;
          }

          const isOfficial = repoOwner.toLowerCase() === "theyogmehta";
          const atScopedId = `@${repoOwner}/${scraper.name}`;
          const slashScopedId = `${repoOwner}/${scraper.name}`;

          scraper.repoOwner = repoOwner;
          scraper.uniqueId = isOfficial ? scraper.name : atScopedId;
          scraper.filePath = fullPath;

          const normType = String(type || "").toLowerCase();
          const targetProviders =
            normType === "anime"
              ? global.Anime_providers
              : normType === "manga"
                ? global.Manga_providers
                : global.Movies_providers;
          targetProviders[atScopedId] = scraper;
          targetProviders[slashScopedId] = scraper;

          if (isOfficial) {
            targetProviders[scraper.name] = scraper;
          }

          registerExtension(scraper);
          return scraper;
        } else {
          logger.warn(`Scraper missing 'name' export: ${fullPath}`);
        }
      } catch (err) {
        logger.error(
          `Failed to load ${type.toLowerCase()} scraper ${path.basename(fullPath)} from @${repoOwner}: ${err.message}`,
        );
      }
      return null;
    };

    // 1. Scan ScraperAnime (scoped subdirectories only: ScraperAnime/<repoOwner>/*.js)
    const animeEntries = fs.readdirSync(ScraperAnime);
    for (const entry of animeEntries) {
      const fullPath = path.join(ScraperAnime, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === "icons" || entry.startsWith(".")) continue;
        const subFiles = fs.readdirSync(fullPath);
        for (const sf of subFiles) {
          if (sf.endsWith(".js")) {
            const sc = loadScraperFile(path.join(fullPath, sf), entry, "Anime");
            if (sc) {
              animeCount++;
              logger.info(`Loaded anime scraper: ${sc.name} (@${entry})`);
            }
          }
        }
      }
    }

    // 2. Scan ScraperManga (scoped subdirectories only: ScraperManga/<repoOwner>/*.js)
    const mangaEntries = fs.readdirSync(ScraperManga);
    for (const entry of mangaEntries) {
      const fullPath = path.join(ScraperManga, entry);
      const stat = fs.statSync(fullPath);
      if (stat.isDirectory()) {
        if (entry === "icons" || entry.startsWith(".")) continue;
        const subFiles = fs.readdirSync(fullPath);
        for (const sf of subFiles) {
          if (sf.endsWith(".js")) {
            const sc = loadScraperFile(path.join(fullPath, sf), entry, "Manga");
            if (sc) {
              mangaCount++;
              logger.info(`Loaded manga scraper: ${sc.name} (@${entry})`);
            }
          }
        }
      }
    }

    // 3. Scan ScraperMovies (scoped subdirectories only: ScraperMovies/<repoOwner>/*.js)
    if (ScraperMovies && fs.existsSync(ScraperMovies)) {
      const moviesEntries = fs.readdirSync(ScraperMovies);
      for (const entry of moviesEntries) {
        const fullPath = path.join(ScraperMovies, entry);
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          if (entry === "icons" || entry.startsWith(".")) continue;
          const subFiles = fs.readdirSync(fullPath);
          for (const sf of subFiles) {
            if (sf.endsWith(".js")) {
              const sc = loadScraperFile(
                path.join(fullPath, sf),
                entry,
                "Movies",
              );
              if (sc) {
                moviesCount++;
                logger.info(
                  `Loaded movies-tvshows scraper: ${sc.name} (@${entry})`,
                );
              }
            }
          }
        }
      }
    }

    global.scrapersLoaded = true;
    notifyScrapersUpdated();
    await reconcileActiveProvider("Anime");
    await reconcileActiveProvider("Manga");
    await reconcileActiveProvider("Movies");

    logger.info(
      `All scrapers loaded. Total Anime: ${animeCount}, Manga: ${mangaCount}, Movies: ${moviesCount}`,
    );
  } catch (err) {
    logger.error(`Failed to load scrapers: ${err.message}`);
  }
}

function notifyScrapersUpdated() {
  try {
    if (global.sendToRenderer) {
      const cleanAnime = Array.from(
        new Set(
          Object.values(global.Anime_providers || {}).map(
            (p) => p.uniqueId || p.name,
          ),
        ),
      );
      const cleanManga = Array.from(
        new Set(
          Object.values(global.Manga_providers || {}).map(
            (p) => p.uniqueId || p.name,
          ),
        ),
      );
      const cleanMovies = Array.from(
        new Set(
          Object.values(global.Movies_providers || {}).map(
            (p) => p.uniqueId || p.name,
          ),
        ),
      );
      global.sendToRenderer("scrapers-updated", {
        anime: cleanAnime,
        manga: cleanManga,
        movies: cleanMovies,
      });
    }
  } catch (err) {
    logger.error("Failed to notify scrapers update: " + err.message);
  }
}

async function loadSingleScraper(
  AnimeManga,
  ExtensionName,
  RepoOwner = "TheYogMehta",
) {
  try {
    await CheckScrapperFolderExists();
    const norm = String(AnimeManga || "").toLowerCase();
    const folder =
      norm === "anime"
        ? ScraperAnime
        : norm === "manga"
          ? ScraperManga
          : ScraperMovies;
    const scopedPath = path.join(folder, RepoOwner, `${ExtensionName}.js`);
    const flatPath = path.join(folder, `${ExtensionName}.js`);

    if (fs.existsSync(flatPath)) {
      try {
        fs.unlinkSync(flatPath);
        logger.info(`[Cleanup] Auto-deleted legacy root file: ${flatPath}`);
      } catch (_) {}
    }

    if (!fs.existsSync(scopedPath)) {
      logger.error(`Scraper file not found: ${scopedPath}`);
      return { success: false, error: "Scraper file not found" };
    }
    const fullPath = scopedPath;

    const code = fs.readFileSync(fullPath, "utf8");
    const safety = validateExtensionSafety(code, RepoOwner);
    if (!safety.safe) {
      logger.warn(
        `[Security] Blocked unsafe scraper ${fullPath}: ${safety.reason}`,
      );
      return {
        success: false,
        error: `Security check failed: ${safety.reason}`,
      };
    }

    try {
      delete require.cache[require.resolve(fullPath)];
    } catch (_) {}

    const scraper = require(fullPath);
    if (scraper?.name) {
      const { getCurrentAppVersion } = require("./constants");
      const currentAppVer = getCurrentAppVersion();
      const requiredAppVer = scraper.minAppVersion || scraper.MinAppVersion;
      if (requiredAppVer && isVersionBelow(currentAppVer, requiredAppVer)) {
        logger.warn(
          `[Compatibility] Skipping scraper ${AnimeManga}/${RepoOwner}/${scraper.name}: requires StrawVerse v${requiredAppVer}+ (current: v${currentAppVer})`,
        );
        return {
          success: false,
          error: `Requires StrawVerse v${requiredAppVer}+ (current: v${currentAppVer})`,
        };
      }

      const isOfficial = RepoOwner.toLowerCase() === "theyogmehta";
      const atScopedId = `@${RepoOwner}/${scraper.name}`;
      const slashScopedId = `${RepoOwner}/${scraper.name}`;

      scraper.repoOwner = RepoOwner;
      scraper.uniqueId = isOfficial ? scraper.name : atScopedId;
      scraper.filePath = fullPath;

      const targetProviders =
        norm === "anime"
          ? global.Anime_providers
          : norm === "manga"
            ? global.Manga_providers
            : global.Movies_providers;
      targetProviders[atScopedId] = scraper;
      targetProviders[slashScopedId] = scraper;

      if (isOfficial) {
        targetProviders[scraper.name] = scraper;
      }

      const { registerExtension } = require("./extensionRegistry");
      registerExtension(scraper);

      logger.info(
        `Loaded/Reloaded ${AnimeManga.toLowerCase()} scraper: ${scraper.name} (@${RepoOwner})`,
      );
      notifyScrapersUpdated();
      await reconcileActiveProvider(norm === "anime" ? "Anime" : norm === "manga" ? "Manga" : "Movies");
      return { success: true, scraper };
    } else {
      logger.warn(`Scraper missing 'name' export: ${fullPath}`);
      return { success: false, error: "Scraper missing 'name' export" };
    }
  } catch (err) {
    logger.error(
      `Failed to load/reload scraper ${ExtensionName}: ${err.message}`,
    );
    return { success: false, error: err.message };
  }
}

async function unloadSingleScraper(
  AnimeManga,
  ExtensionName,
  RepoOwner = "TheYogMehta",
) {
  try {
    const norm = String(AnimeManga || "").toLowerCase();
    const targetProviders =
      norm === "anime"
        ? global.Anime_providers
        : norm === "manga"
          ? global.Manga_providers
          : global.Movies_providers;
    const isOfficial = RepoOwner.toLowerCase() === "theyogmehta";
    const atScopedId = `@${RepoOwner}/${ExtensionName}`;
    const slashScopedId = `${RepoOwner}/${ExtensionName}`;

    delete targetProviders[atScopedId];
    delete targetProviders[slashScopedId];

    if (isOfficial && targetProviders[ExtensionName]?.repoOwner === RepoOwner) {
      delete targetProviders[ExtensionName];
      const remaining = Object.values(targetProviders).find(
        (p) => p.name === ExtensionName,
      );
      if (remaining) {
        targetProviders[ExtensionName] = remaining;
      }
    }

    const { unregisterExtension } = require("./extensionRegistry");
    unregisterExtension(ExtensionName);

    logger.info(
      `Unloaded ${AnimeManga.toLowerCase()} scraper: ${ExtensionName} (@${RepoOwner})`,
    );
    await reconcileActiveProvider(norm === "anime" ? "Anime" : norm === "manga" ? "Manga" : "Movies");
    notifyScrapersUpdated();
  } catch (err) {
    logger.error(`Failed to unload scraper ${ExtensionName}: ${err.message}`);
  }
}

// Download / Delete Scraper with scoped directory support, MinAppVersion & security check
async function HandleExtensions(
  TaskType,
  AnimeManga,
  ExtensionName,
  RepoOwner = "TheYogMehta",
  RepoBaseUrl,
  MinAppVersion,
) {
  await CheckScrapperFolderExists();
  const norm = String(AnimeManga || "").toLowerCase();
  const isMovies = norm === "movies" || norm === "movies-tvshows";
  const canonicalType = isMovies
    ? "Movies"
    : norm === "manga"
      ? "Manga"
      : "Anime";
  const folder =
    canonicalType === "Anime"
      ? ScraperAnime
      : canonicalType === "Manga"
        ? ScraperManga
        : ScraperMovies;
  const ownerDir = path.join(folder, RepoOwner);
  if (!fs.existsSync(ownerDir)) {
    fs.mkdirSync(ownerDir, { recursive: true });
  }

  const extensionPath = path.join(ownerDir, `${ExtensionName}.js`);
  const legacyPath = path.join(folder, `${ExtensionName}.js`);

  const rawBase =
    RepoBaseUrl ||
    "https://raw.githubusercontent.com/TheYogMehta/extensions/refs/heads/main";

  if (TaskType === "add") {
    try {
      // 1. MinAppVersion compatibility check
      if (MinAppVersion) {
        const { getCurrentAppVersion } = require("./constants");
        const currentAppVer = getCurrentAppVersion();
        if (isVersionBelow(currentAppVer, MinAppVersion)) {
          return {
            type: "error",
            title: "App Update Required",
            message: `This extension requires StrawVerse v${MinAppVersion} or higher (current: v${currentAppVer}). Please update your app to install.`,
          };
        }
      }

      const typeSub = isMovies ? "movies-tvshows" : canonicalType;
      const candidateUrls = [
        `${rawBase.replace(/\/$/, "")}/extensions/${typeSub}/${ExtensionName}.js`,
        `${rawBase.replace(/\/$/, "")}/${typeSub}/${ExtensionName}.js`,
      ];
      if (isMovies) {
        candidateUrls.push(
          `${rawBase.replace(/\/$/, "")}/extensions/Movies/${ExtensionName}.js`,
          `${rawBase.replace(/\/$/, "")}/Movies/${ExtensionName}.js`,
        );
      }
      let response = null;
      let scriptUrl = candidateUrls[0];
      for (const u of candidateUrls) {
        try {
          const res = await httpGetText(u, 15000);
          if (res && !res.includes("404: Not Found")) {
            response = res;
            scriptUrl = u;
            break;
          }
        } catch (_) {}
      }

      if (!response || response.includes("404: Not Found")) {
        return {
          type: "error",
          title: "Scraper Not Found",
          message: `Scraper script not found at ${scriptUrl}`,
        };
      }

      // Security Safety Check
      const safety = validateExtensionSafety(response, RepoOwner);
      if (!safety.safe) {
        logger.warn(
          `[Security] Rejected unsafe scraper ${AnimeManga}/${RepoOwner}/${ExtensionName}: ${safety.reason}`,
        );
        return {
          type: "error",
          title: "Security Verification Failed",
          message: safety.reason,
        };
      }

      await fs.promises.writeFile(extensionPath, response);

      // Auto-clean any legacy root scraper file if present
      if (fs.existsSync(legacyPath)) {
        try {
          fs.unlinkSync(legacyPath);
          logger.info(`[Cleanup] Auto-deleted legacy root file: ${legacyPath}`);
        } catch (_) {}
      }

      try {
        const repoIconDir = path.join(ScraperIcons, RepoOwner);
        if (!fs.existsSync(repoIconDir)) {
          fs.mkdirSync(repoIconDir, { recursive: true });
        }
        const iconDest = path.join(repoIconDir, `${ExtensionName}.ico`);
        const legacyIconDest = path.join(ScraperIcons, `${ExtensionName}.ico`);
        if (fs.existsSync(legacyIconDest)) {
          try {
            fs.unlinkSync(legacyIconDest);
            logger.info(
              `[Cleanup] Auto-deleted legacy root icon: ${legacyIconDest}`,
            );
          } catch (_) {}
        }
        const iconUrl = `${rawBase.replace(/\/$/, "")}/ico/${ExtensionName}.ico`;
        let iconBuffer;
        try {
          iconBuffer = await httpGetBuffer(iconUrl, 8000);
        } catch (_) {
          const fallbackIconUrl = `${rawBase.replace(/\/$/, "")}/extensions/ico/${ExtensionName}.ico`;
          iconBuffer = await httpGetBuffer(fallbackIconUrl, 8000);
        }
        if (iconBuffer && iconBuffer.length > 0) {
          await fs.promises.writeFile(iconDest, iconBuffer);
        }
      } catch (iconErr) {}

      const loadResult = await loadSingleScraper(
        canonicalType,
        ExtensionName,
        RepoOwner,
      );
      if (!loadResult?.success) {
        // Roll back the broken file so it doesn't leave orphan/corrupt scrapers on disk
        try {
          if (fs.existsSync(extensionPath)) fs.unlinkSync(extensionPath);
          if (fs.existsSync(iconDest)) fs.unlinkSync(iconDest);
        } catch (_) {}
        return {
          type: "error",
          title: `Failed to Load ${canonicalType} Extension!`,
          message:
            loadResult?.error ||
            `Scraper ${ExtensionName} failed to initialize`,
        };
      }

      if (canonicalType !== "Movies") {
        try {
          const { syncExtensionMapping } = require("./mappingUpdater");
          syncExtensionMapping(ExtensionName).catch(() => {});
        } catch (_) {}
      }

      return {
        type: "success",
        title: `Added ${canonicalType} Extension!`,
        message: `${ExtensionName} (by @${RepoOwner}) is added successfully`,
      };
    } catch (err) {
      logger.error(
        `Failed to add scraper ${ExtensionName} (@${RepoOwner}): ${err.message}`,
      );
      return {
        type: "error",
        title: `Failed to Add ${canonicalType} Extension!`,
        message: err.message,
      };
    }
  } else if (TaskType === "remove" || TaskType === "delete") {
    try {
      let removed = false;
      if (fs.existsSync(extensionPath)) {
        fs.unlinkSync(extensionPath);
        removed = true;
      }
      if (fs.existsSync(legacyPath)) {
        try {
          fs.unlinkSync(legacyPath);
          removed = true;
        } catch (_) {}
      }

      if (!removed) {
        return {
          type: "error",
          title: "Scraper Not Found",
          message: `${ExtensionName} (@${RepoOwner}) is not installed`,
        };
      }

      const scopedIconPath = path.join(
        ScraperIcons,
        RepoOwner,
        `${ExtensionName}.ico`,
      );
      if (fs.existsSync(scopedIconPath)) {
        try {
          fs.unlinkSync(scopedIconPath);
        } catch (_) {}
      }
      const iconPath = path.join(ScraperIcons, `${ExtensionName}.ico`);
      if (fs.existsSync(iconPath)) {
        try {
          fs.unlinkSync(iconPath);
        } catch (_) {}
      }

      await unloadSingleScraper(canonicalType, ExtensionName, RepoOwner);

      if (canonicalType !== "Movies") {
        try {
          const { cleanupExtensionMapping } = require("./mappingUpdater");
          cleanupExtensionMapping(ExtensionName).catch(() => {});
        } catch (_) {}
      }

      return {
        type: "success",
        title: `Removed ${canonicalType} Extension!`,
        message: `${ExtensionName} (by @${RepoOwner}) is removed successfully`,
      };
    } catch (err) {
      logger.error(
        `Failed to remove scraper ${ExtensionName} (@${RepoOwner}): ${err.message}`,
      );
      return {
        type: "error",
        title: `Failed to Remove ${canonicalType} Extension!`,
        message: err.message,
      };
    }
  }
  return {
    type: "error",
    title: "Unknown scraper task",
    message: `Unsupported task type: ${TaskType}`,
  };
}

// return provider
async function providerFetch(type, index) {
  try {
    const norm = String(type || "").toLowerCase();
    const isAnime = norm === "anime";
    const isManga = norm === "manga";
    const pMap = isAnime
      ? global.Anime_providers
      : isManga
        ? global.Manga_providers
        : global.Movies_providers;
    const providers = Object.keys(pMap || {});
    if (providers.length === 0) {
      throw new Error(
        `No ${type} scraper available. Please download one from marketplace.`,
      );
    }

    let matchedProvider = null;
    let providerName = null;

    if (index !== null && index !== undefined) {
      const idxStr = String(index).trim();
      if (pMap[idxStr]) {
        providerName = idxStr;
        matchedProvider = pMap[idxStr];
      } else if (pMap[`@${idxStr}`]) {
        providerName = `@${idxStr}`;
        matchedProvider = pMap[`@${idxStr}`];
      } else if (idxStr.startsWith("@") && pMap[idxStr.slice(1)]) {
        providerName = idxStr;
        matchedProvider = pMap[idxStr.slice(1)];
      }
    }

    if (!matchedProvider) {
      const activePref = isAnime
        ? config.Animeprovider
        : isManga
          ? config.Mangaprovider
          : config.Moviesprovider;
      if (activePref && pMap[activePref]) {
        providerName = activePref;
        matchedProvider = pMap[activePref];
      } else {
        providerName = providers[0];
        matchedProvider = pMap[providerName];
      }
    }

    let canonicalName = providerName;
    if (matchedProvider) {
      const owner = (matchedProvider.repoOwner || "").toLowerCase();
      if (owner && owner !== "theyogmehta") {
        canonicalName = `@${matchedProvider.repoOwner}/${matchedProvider.name}`;
      } else if (matchedProvider.uniqueId) {
        canonicalName = matchedProvider.uniqueId;
      }
    }

    return {
      provider: matchedProvider,
      provider_name: canonicalName,
    };
  } catch (err) {
    logger.error("Failed To Return Provider: " + err.message);
    throw err;
  }
}

function isLanguagePreferred(subLang, preferredLanguages) {
  if (!subLang) return false;
  if (!Array.isArray(preferredLanguages)) return true;
  if (preferredLanguages.length === 0) return false;
  const sLower = subLang.toLowerCase().trim();
  const tokens = sLower.split(/[\s\-_,()[\]]+/).filter(Boolean);

  return preferredLanguages.some((pref) => {
    const pLower = (pref || "").toLowerCase().trim();
    if (!pLower) return false;
    if (sLower === pLower || sLower.includes(pLower)) return true;

    const targetCodes = [];
    if (pLower === "english") targetCodes.push("en", "eng");
    else if (pLower === "spanish") targetCodes.push("es", "spa");
    else if (pLower === "french") targetCodes.push("fr", "fre", "fra");
    else if (pLower === "german") targetCodes.push("de", "ger", "deu");
    else if (pLower === "italian") targetCodes.push("it", "ita");
    else if (pLower === "portuguese") targetCodes.push("pt", "por");
    else if (pLower === "russian") targetCodes.push("ru", "rus");
    else if (pLower === "japanese") targetCodes.push("ja", "jpn");
    else if (pLower === "chinese") targetCodes.push("zh", "chi", "zho");
    else if (pLower === "arabic") targetCodes.push("ar", "ara");
    else if (pLower === "hindi") targetCodes.push("hi", "hin");
    else targetCodes.push(pLower.slice(0, 2), pLower.slice(0, 3));

    return (
      tokens.some((t) => targetCodes.includes(t)) ||
      targetCodes.some(
        (code) =>
          sLower === code ||
          sLower.startsWith(`${code}_`) ||
          sLower.startsWith(`${code}-`),
      )
    );
  });
}

async function renameExistingMangaChapters(targetScheme) {
  if (!targetScheme) return;
  try {
    const {
      sanitizeFolderName,
      formatChapterFilename,
      getChapterNumberFromFilename,
      isMangaFile,
    } = require("./constants");

    const candidateRoots = new Set();
    if (
      config?.CustomDownloadLocationManga &&
      typeof config.CustomDownloadLocationManga === "string"
    ) {
      const loc = config.CustomDownloadLocationManga.trim();
      candidateRoots.add(path.resolve(loc));
      candidateRoots.add(path.resolve(path.join(loc, "Manga")));
    }
    if (
      config?.CustomDownloadLocation &&
      typeof config.CustomDownloadLocation === "string"
    ) {
      const loc = config.CustomDownloadLocation.trim();
      candidateRoots.add(path.resolve(loc));
      candidateRoots.add(path.resolve(path.join(loc, "Manga")));
    }
    const defDownloads = getDownloadsFolder();
    if (defDownloads) {
      candidateRoots.add(path.resolve(path.join(defDownloads, "Manga")));
      candidateRoots.add(path.resolve(defDownloads));
    }

    const existingRoots = [];
    for (const r of candidateRoots) {
      try {
        if (fs.existsSync(r) && fs.statSync(r).isDirectory()) {
          existingRoots.push(r);
        }
      } catch (_) {}
    }

    const mangaDbRows = await queryAll(
      "SELECT id, title, folder_name FROM Manga",
    ).catch(() => []);
    const folderToTitleMap = new Map();
    if (Array.isArray(mangaDbRows)) {
      for (const row of mangaDbRows) {
        if (row.folder_name && row.title) {
          folderToTitleMap.set(row.folder_name.toLowerCase(), row.title);
        }
        if (row.title) {
          folderToTitleMap.set(
            sanitizeFolderName(row.title).toLowerCase(),
            row.title,
          );
        }
      }
    }

    const processedDirs = new Set();

    const processDir = async (dirPath, folderTitle) => {
      const resolvedPath = path.resolve(dirPath);
      if (processedDirs.has(resolvedPath)) return;
      processedDirs.add(resolvedPath);

      let entries = [];
      try {
        entries = await fs.promises.readdir(resolvedPath, {
          withFileTypes: true,
        });
      } catch (_) {
        return;
      }

      const mangaFiles = entries.filter(
        (e) => e.isFile() && isMangaFile(e.name),
      );
      if (mangaFiles.length === 0) return;

      const title =
        folderToTitleMap.get(path.basename(resolvedPath).toLowerCase()) ||
        folderTitle ||
        path.basename(resolvedPath);

      for (const fileEntry of mangaFiles) {
        const oldName = fileEntry.name;
        const chNum = getChapterNumberFromFilename(oldName);
        if (chNum === null || isNaN(chNum)) continue;

        const ext = path.extname(oldName) || ".cbz";
        const newName = formatChapterFilename({
          title,
          chapterNum: chNum,
          namingScheme: targetScheme,
          ext,
        });

        if (oldName === newName) continue;

        const oldPath = path.join(resolvedPath, oldName);
        const newPath = path.join(resolvedPath, newName);

        try {
          if (
            oldName.toLowerCase() !== newName.toLowerCase() &&
            fs.existsSync(newPath)
          ) {
            logger.warn(
              `[MangaRename] Destination file ${newName} already exists in ${resolvedPath}, skipping rename of ${oldName}`,
            );
            continue;
          }
          await fs.promises.rename(oldPath, newPath);
          logger.info(
            `[MangaRename] Renamed "${oldName}" -> "${newName}" in ${resolvedPath}`,
          );
        } catch (renameErr) {
          logger.error(
            `[MangaRename] Failed to rename "${oldName}" to "${newName}": ${renameErr.message}`,
          );
        }
      }
    };

    if (Array.isArray(mangaDbRows)) {
      for (const row of mangaDbRows) {
        const folderName = row.folder_name || sanitizeFolderName(row.title);
        if (!folderName) continue;
        for (const root of existingRoots) {
          const direct = path.join(root, folderName);
          if (fs.existsSync(direct)) {
            await processDir(direct, row.title);
          }
          const nested = path.join(root, "Manga", folderName);
          if (fs.existsSync(nested)) {
            await processDir(nested, row.title);
          }
        }
      }
    }

    for (const root of existingRoots) {
      let subEntries = [];
      try {
        subEntries = await fs.promises.readdir(root, { withFileTypes: true });
      } catch (_) {
        continue;
      }

      const directFiles = subEntries.filter(
        (e) => e.isFile() && isMangaFile(e.name),
      );
      if (directFiles.length > 0) {
        await processDir(root, path.basename(root));
      }

      for (const sub of subEntries) {
        if (!sub.isDirectory()) continue;
        if (sub.name === "Anime" || sub.name === "logs") continue;
        const subPath = path.join(root, sub.name);
        await processDir(subPath, sub.name);
      }
    }
  } catch (err) {
    logger.error(`[MangaRename] Error auto-renaming manga: ${err.message}`);
  }
}

module.exports = {
  settingupdate,
  settingfetch,
  settingSave,
  SettingsLoad,
  renameExistingMangaChapters,
  reconcileActiveProvider,
  providerFetch,
  loadAllScrapers,
  HandleExtensions,
  patchModulePaths,
  disableWhatsNew,
  isLanguagePreferred,
  getEffectiveLogDir,
  getScraperIconsPath: () => ScraperIcons,
  validateExtensionSafety,
  getExtensionRepos,
  addExtensionRepo,
  removeExtensionRepo,
  restoreDefaultExtensionRepo,
  fetchAggregatedMarketplace,
  parseExtensionRepoUrl,
  getDefaultExtensionRepo: () => DEFAULT_EXTENSION_REPO,
  isVersionBelow,
};
