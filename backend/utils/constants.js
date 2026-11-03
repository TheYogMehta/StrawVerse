const path = require("path");
const fs = require("fs");

const VIDEO_EXTENSIONS = Object.freeze([".mp4", ".ts"]);
const SUBTITLE_EXTENSIONS = Object.freeze([".srt", ".vtt"]);
const MANGA_EXTENSIONS = Object.freeze([".cbz"]);

const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";
const isAndroid = Boolean(
  process.env.NODEJS_MOBILE_DATA_DIR ||
  process.env.DATADIR ||
  process.platform === "android",
);

function getOSName() {
  if (isAndroid) return "Android";
  if (isWindows) return "Windows";
  if (isMac) return "macOS";
  return "Linux";
}

function isVideoFile(fileNameOrPath) {
  if (!fileNameOrPath) return false;
  const ext = path.extname(fileNameOrPath).toLowerCase();
  return VIDEO_EXTENSIONS.includes(ext);
}

function isSubtitleFile(fileNameOrPath) {
  if (!fileNameOrPath) return false;
  const ext = path.extname(fileNameOrPath).toLowerCase();
  return SUBTITLE_EXTENSIONS.includes(ext);
}

function isMangaFile(fileNameOrPath) {
  if (!fileNameOrPath) return false;
  const ext = path.extname(fileNameOrPath).toLowerCase();
  return MANGA_EXTENSIONS.includes(ext);
}

function isMediaFile(fileNameOrPath, type = "Anime") {
  return type === "Anime"
    ? isVideoFile(fileNameOrPath)
    : isMangaFile(fileNameOrPath);
}

// "Season 02" subfolders used by media-server naming (Show/Season 02/...)
const SEASON_FOLDER_RE = /^Season \d+$/i;

// includeSeasons: also count media inside "Season NN" subfolders, so a show
// folder that only holds season folders is never treated as empty.
function hasLocalMediaFiles(dirPath, type = "Anime", includeSeasons = false) {
  if (!dirPath || !fs.existsSync(dirPath)) return false;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    return entries.some((e) => {
      if (e.name.startsWith(".")) return false;
      if (e.isDirectory()) {
        return (
          includeSeasons &&
          SEASON_FOLDER_RE.test(e.name) &&
          hasLocalMediaFiles(path.join(dirPath, e.name), type, false)
        );
      }
      return isMediaFile(e.name, type);
    });
  } catch (_) {
    return false;
  }
}

function getUserDataPath() {
  let userDataPath = process.env.STRAWVERSE_DATA_DIR;

  if (!userDataPath) {
    // Electron (Windows, macOS / Apple, Linux)
    try {
      const { app } = require("electron");
      if (app && typeof app.getPath === "function") {
        userDataPath = app.getPath("userData");
      }
    } catch (_) {}
  }

  if (!userDataPath) {
    // Android / Mobile (Capacitor)
    const mobileDir = process.env.NODEJS_MOBILE_DATA_DIR || process.env.DATADIR;
    userDataPath = mobileDir ? path.join(mobileDir, "data") : process.cwd();
  }

  try {
    fs.mkdirSync(userDataPath, { recursive: true });
  } catch (_) {}

  return userDataPath;
}

function sanitizeFolderName(title) {
  if (!title) return "Untitled";
  const sanitized = String(title)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return sanitized || "Untitled";
}

function cleanAlphanumeric(str) {
  return String(str || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
    String(str || ""),
  );
}

function getEpisodeNumberFromFilename(filename) {
  if (!filename || !isVideoFile(filename)) return null;

  // Media-server naming: "Show - S01E05 [1080p].mp4"
  let match = filename.match(/\bS\d{1,3}E(\d+(\.\d+)?)/i);
  if (match) return parseFloat(match[1]);

  match = filename.match(/^(\d+(\.\d+)?)/);
  if (match) return parseFloat(match[1]);

  match = filename.match(/(?:ep|episode|ch|chapter)\s*(\d+(\.\d+)?)/i);
  if (match) return parseFloat(match[1]);

  match = filename.match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

// "Show - S02E05 [1080p]" (no extension), the Jellyfin/Plex episode scheme.
// Series and season come from the "<Show>/Season NN" folder the file goes in.
function mediaServerFileBase(directory, episode, quality) {
  const pad = (n) => String(n).padStart(2, "0");
  const dirName = path.basename(directory);
  const m = dirName.match(/^Season (\d+)$/i);
  const series = m ? path.basename(path.dirname(directory)) : dirName;
  const season = m ? parseInt(m[1], 10) : 1;
  const q = quality ? ` [${quality}]` : "";
  return `${series} - S${pad(season)}E${pad(parseInt(episode, 10))}${q}`;
}

function getChapterNumberFromFilename(filename) {
  if (!filename || !isMangaFile(filename)) return null;
  const match = filename.match(
    /(?:chapter|chp|ch|ep)?\s*[-_]?\s*(\d+(?:\.\d+)?)/i,
  );
  if (match) {
    const num = parseFloat(match[1]);
    return !isNaN(num) ? num : null;
  }
  return null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function parseTags(val) {
  if (!val) return [];
  if (Array.isArray(val)) {
    return val.map((t) => String(t).trim()).filter(Boolean);
  }
  const str = String(val).trim();
  if (!str || str === "[]") return [];
  try {
    const parsed = JSON.parse(str);
    if (Array.isArray(parsed)) {
      return parsed.map((t) => String(t).trim()).filter(Boolean);
    }
    if (typeof parsed === "string" && parsed.trim()) {
      return [parsed.trim()];
    }
  } catch (_) {}
  if (str.includes(",")) {
    return str
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }
  return [str];
}

const SYSTEM_TAGS = Object.freeze({
  Anime: Object.freeze(["Watching", "Plan to Watch", "Completed", "Downloads"]),
  Manga: Object.freeze(["Reading", "Plan to Read", "Completed", "Downloads"]),
});

const RESERVED_TAGS = Object.freeze({
  Anime: Object.freeze(SYSTEM_TAGS.Anime.map((t) => t.toLowerCase())),
  Manga: Object.freeze(SYSTEM_TAGS.Manga.map((t) => t.toLowerCase())),
});

function getReservedTags(type = "Anime") {
  const isManga = String(type).toLowerCase() === "manga";
  return SYSTEM_TAGS[isManga ? "Manga" : "Anime"] || SYSTEM_TAGS.Anime;
}

function isReservedTag(tag, type = null) {
  if (!tag || typeof tag !== "string") return false;
  const lower = tag.trim().toLowerCase();
  if (type) {
    const isManga = String(type).toLowerCase() === "manga";
    return RESERVED_TAGS[isManga ? "Manga" : "Anime"].includes(lower);
  }
  return (
    RESERVED_TAGS.Anime.includes(lower) || RESERVED_TAGS.Manga.includes(lower)
  );
}

const MAL_ANIME_STATUSES = Object.freeze([
  "plan_to_watch",
  "watching",
  "completed",
  "on_hold",
  "dropped",
]);

const MAL_MANGA_STATUSES = Object.freeze([
  "plan_to_read",
  "reading",
  "completed",
  "on_hold",
  "dropped",
]);

const MAL_STATUSES = Object.freeze({
  Anime: MAL_ANIME_STATUSES,
  Manga: MAL_MANGA_STATUSES,
});

function getValidMalStatuses(type = "Anime") {
  const isManga = String(type).toLowerCase() === "manga";
  return isManga ? MAL_MANGA_STATUSES : MAL_ANIME_STATUSES;
}

const getMalStatuses = getValidMalStatuses;

function isValidMalStatus(status, type = "Anime") {
  if (!status || typeof status !== "string") return false;
  return getValidMalStatuses(type).includes(status.trim().toLowerCase());
}

function getMalStatusLabel(status) {
  if (!status || typeof status !== "string") return "";
  return String(status)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

const GITHUB_REPO = "TheYogMehta/StrawVerse";
const DISCORD_CLIENT_ID = "1372260492982358016";
const DISCORD_IDLE_MESSAGES = Object.freeze([
  "Taking a quick snack break 🍕",
  "Browsing the anime shelves...",
  "Just chilling with some tea ☕",
  "Plotting the next binge watch...",
  "Waiting for the next episode drop 📺",
  "In a deep anime rabbit hole 🌀",
  "Dreaming of anime worlds ✨",
  "Catching up on all the latest manga 📚",
  "In anime zen mode 🧘",
  "Lost in thought (and anime) 🤔",
  "Currently AFK send snacks! 🍩",
  "Daydreaming about the next arc...",
]);

function getCurrentAppVersion() {
  try {
    const { app } = require("electron");
    if (app && typeof app.getVersion === "function") {
      const v = app.getVersion();
      if (v) return v;
    }
  } catch (_) {}

  try {
    const pkg = require("../../package.json");
    if (pkg && pkg.version) return pkg.version;
  } catch (_) {}

  return process.env.STRAWVERSE_APP_VERSION || "10.1.2";
}

function sortSourcesByPreferredQuality(sources, preferredQuality = "highest") {
  if (!sources || !Array.isArray(sources) || sources.length <= 1) {
    return sources ? [...sources] : [];
  }

  const parseQualNum = (s) => {
    const qStr = (s?.quality || s?.name || "").toLowerCase();
    const match = qStr.match(/(\d+)p/);
    if (match) return parseInt(match[1], 10);
    if (qStr.includes("1080")) return 1080;
    if (qStr.includes("720")) return 720;
    if (qStr.includes("480")) return 480;
    if (qStr.includes("360")) return 360;
    return 0;
  };

  const prefNorm = String(preferredQuality || "highest")
    .toLowerCase()
    .trim();
  const copy = [...sources];

  if (prefNorm !== "highest" && prefNorm !== "auto" && prefNorm !== "default") {
    const prefNum = parseInt(prefNorm.replace(/\D/g, ""), 10);
    if (prefNum > 0) {
      const matchIdx = copy.findIndex((s) => parseQualNum(s) === prefNum);
      if (matchIdx > 0) {
        const matched = copy.splice(matchIdx, 1)[0];
        copy.unshift(matched);
        return copy;
      }
    }
  }

  const hasQualities = copy.some((s) => parseQualNum(s) > 0);
  if (hasQualities) {
    copy.sort((a, b) => parseQualNum(b) - parseQualNum(a));
  }

  return copy;
}

module.exports = {
  VIDEO_EXTENSIONS,
  SUBTITLE_EXTENSIONS,
  MANGA_EXTENSIONS,
  isWindows,
  isMac,
  isLinux,
  isAndroid,
  getOSName,
  isVideoFile,
  isSubtitleFile,
  isMangaFile,
  isMediaFile,
  hasLocalMediaFiles,
  getUserDataPath,
  sanitizeFolderName,
  cleanAlphanumeric,
  isUuid,
  getEpisodeNumberFromFilename,
  getChapterNumberFromFilename,
  mediaServerFileBase,
  SEASON_FOLDER_RE,
  sleep,
  parseTags,
  SYSTEM_TAGS,
  RESERVED_TAGS,
  isReservedTag,
  getReservedTags,
  MAL_STATUSES,
  getMalStatuses,
  getValidMalStatuses,
  isValidMalStatus,
  getMalStatusLabel,
  GITHUB_REPO,
  DISCORD_CLIENT_ID,
  DISCORD_IDLE_MESSAGES,
  getCurrentAppVersion,
  sortSourcesByPreferredQuality,
};
