const path = require("path");
const fs = require("fs");

if (!global.PORT) {
  global.PORT = 9545;
}

const VIDEO_EXTENSIONS = Object.freeze([".mp4", ".mkv", ".ts"]);
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
  const norm = String(type || "").toLowerCase();
  return norm === "anime" || norm === "movies"
    ? isVideoFile(fileNameOrPath)
    : isMangaFile(fileNameOrPath);
}

// "Season 02" subfolders used by media-server naming (Show/Season 02/...)
const SEASON_FOLDER_RE = /^(?:Season\s+)?(\d+)$/i;

function parseSeasonFolderNumber(folderName) {
  if (!folderName || typeof folderName !== "string") return null;
  const m = folderName.trim().match(SEASON_FOLDER_RE);
  return m ? parseInt(m[1], 10) : null;
}

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

  // 1. Media-server naming: "Show - S01E05 [1080p].mp4", "S1EP05.mp4", "S01E12.5.mp4"
  let match = filename.match(/\bS\d{1,3}E(?:p)?(\d+(?:\.\d+)?)/i);
  if (match) return parseFloat(match[1]);

  // 2. Compact / leading prefix: "5Ep.mp4", "1052Ep.mp4", "01.mp4"
  match = filename.match(/^(\d+(?:\.\d+)?)(?:ep|\b)/i);
  if (match) return parseFloat(match[1]);

  // 3. Keyword followed by episode number: "Episode 01", "Ep 1052"
  match = filename.match(/(?:ep|episode)\s*(\d+(?:\.\d+)?)/i);
  if (match) return parseFloat(match[1]);

  // Clean out common 4-digit release years (1900-2099) in brackets/parentheses or separated by spaces/dots/dashes
  // and resolutions (e.g. 1080p, 720p, 4k) so movie years/resolutions are not mistaken for episode numbers.
  const cleanedName = filename
    .replace(/[\(\[\{]?(?:19|20)\d{2}[\)\]\}]?/g, " ")
    .replace(/\b(?:480|720|1080|2160)p?\b/gi, " ")
    .replace(/\b4k\b/gi, " ");

  // 4. Trailing episode number before extension: "One Piece - 1052.mp4"
  match = cleanedName.match(/[-_ ](\d+(?:\.\d+)?)\.[a-z0-9]+$/i);
  if (match) return parseFloat(match[1]);

  // 5. Fallback: match first standalone number
  match = cleanedName.match(/\b(\d+(?:\.\d+)?)\b/);
  return match ? parseFloat(match[1]) : null;
}

// "Show - S02E05 [1080p]" (no extension), the Jellyfin/Plex episode scheme.
// Series and season come from the "<Show>/Season NN" folder the file goes in.
function mediaServerFileBase(
  directory,
  episode,
  quality,
  isSingleMovie = false,
  movieTitle = null,
  year = null,
) {
  const pad = (n, len = 2) => String(n).padStart(len, "0");
  const dirName = path.basename(directory);
  const m = dirName.match(/^Season (\d+)$/i);
  const series = m ? path.basename(path.dirname(directory)) : dirName;
  const season = m ? parseInt(m[1], 10) : 1;
  const q = quality ? ` [${quality}]` : "";

  if (isSingleMovie) {
    const title = movieTitle || series;
    const cleanTitle = sanitizeFolderName(title || "Movie");
    const yearStr = year ? ` (${year})` : "";
    return `${cleanTitle}${yearStr}${q}`;
  }

  const epNum = parseFloat(episode);
  let epStr;
  if (isNaN(epNum)) {
    epStr = pad(episode);
  } else if (Number.isInteger(epNum)) {
    epStr = epNum < 100 ? pad(epNum, 2) : String(epNum);
  } else {
    const [intPart, decPart] = String(epNum).split(".");
    epStr = `${pad(intPart, 2)}.${decPart}`;
  }

  return `${series} - S${pad(season, 2)}E${epStr}${q}`;
}

function getChapterNumberFromFilename(filename) {
  if (!filename || !isMangaFile(filename)) return null;

  // 1. "Chapter 1052", "Ch. 1052", "One Piece - Chapter 1052"
  let match = filename.match(/(?:chapter|chp|ch)\.?\s*(\d+(?:\.\d+)?)/i);
  if (match) return parseFloat(match[1]);

  // 2. Prefix number: "1052.cbz", "1052 Chapter.cbz"
  match = filename.match(/^(\d+(?:\.\d+)?)/);
  if (match) return parseFloat(match[1]);

  // 3. Fallback: match number
  match = filename.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : null;
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
  Movies: Object.freeze([
    "Watching",
    "Plan to Watch",
    "Completed",
    "Downloads",
  ]),
});

const RESERVED_TAGS = Object.freeze({
  Anime: Object.freeze(SYSTEM_TAGS.Anime.map((t) => t.toLowerCase())),
  Manga: Object.freeze(SYSTEM_TAGS.Manga.map((t) => t.toLowerCase())),
  Movies: Object.freeze(SYSTEM_TAGS.Movies.map((t) => t.toLowerCase())),
});

function getReservedTags(type = "Anime") {
  const norm = String(type).toLowerCase();
  if (norm === "manga") return SYSTEM_TAGS.Manga;
  if (norm === "movies") return SYSTEM_TAGS.Movies;
  return SYSTEM_TAGS.Anime;
}

function isReservedTag(tag, type = null) {
  if (!tag || typeof tag !== "string") return false;
  const lower = tag.trim().toLowerCase();
  if (type) {
    const norm = String(type).toLowerCase();
    const tagList =
      norm === "manga"
        ? RESERVED_TAGS.Manga
        : norm === "movies"
          ? RESERVED_TAGS.Movies
          : RESERVED_TAGS.Anime;
    return tagList.includes(lower);
  }
  return (
    RESERVED_TAGS.Anime.includes(lower) ||
    RESERVED_TAGS.Manga.includes(lower) ||
    RESERVED_TAGS.Movies.includes(lower)
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

function formatEpisodeFilename(
  optsOrTitle = {},
  epNumArg,
  namingSchemeArg,
  extArg,
  totalEpisodesArg,
  seasonArg,
) {
  let title, epNum, season, totalEpisodes, namingScheme, ext;

  if (typeof optsOrTitle === "object" && optsOrTitle !== null) {
    title = optsOrTitle.title || "";
    epNum = optsOrTitle.epNum !== undefined ? optsOrTitle.epNum : 1;
    season = optsOrTitle.season !== undefined ? optsOrTitle.season : 1;
    totalEpisodes =
      optsOrTitle.totalEpisodes !== undefined
        ? optsOrTitle.totalEpisodes
        : null;
    namingScheme = optsOrTitle.namingScheme || "default";
    ext = optsOrTitle.ext || ".mp4";
  } else {
    title = optsOrTitle || "";
    epNum = epNumArg !== undefined ? epNumArg : 1;
    namingScheme = namingSchemeArg || "default";
    ext = extArg || ".mp4";
    totalEpisodes = totalEpisodesArg !== undefined ? totalEpisodesArg : null;
    season = seasonArg !== undefined ? seasonArg : 1;
  }

  if (optsOrTitle?.isMovie || optsOrTitle?.isSingleMovie || namingScheme === "title_only") {
    return formatMovieFilename(optsOrTitle, namingSchemeArg, extArg);
  }

  const num = parseFloat(epNum) || 0;
  const maxEp = Math.max(Number(totalEpisodes) || 0, num);
  const padLen = maxEp >= 1000 ? 4 : maxEp >= 100 ? 3 : 2;
  const paddedEp = String(num).padStart(padLen, "0");
  const paddedSeason = String(season).padStart(2, "0");
  const cleanTitle = sanitizeFolderName(title || "Anime");

  let baseName;
  if (namingScheme === "plex_jellyfin") {
    baseName = `${cleanTitle} - S${paddedSeason}E${paddedEp}`;
  } else if (namingScheme === "series_s_ep") {
    baseName = `${cleanTitle} S${season}EP${num}`;
  } else if (namingScheme === "episode_only") {
    baseName = `Episode ${paddedEp}`;
  } else {
    baseName = `${num}Ep`;
  }

  return `${baseName}${ext.startsWith(".") ? ext : `.${ext}`}`;
}

function formatMovieFilename(
  optsOrTitle = {},
  namingSchemeArg,
  extArg,
  qualityArg,
  yearArg,
) {
  let title, namingScheme, ext, quality, year, isSingleMovie, epNum, season;

  if (typeof optsOrTitle === "object" && optsOrTitle !== null) {
    title = optsOrTitle.title || "";
    namingScheme = optsOrTitle.namingScheme || "default";
    ext = optsOrTitle.ext !== undefined ? optsOrTitle.ext : ".mp4";
    quality = optsOrTitle.quality || null;
    year = optsOrTitle.year || null;
    isSingleMovie = optsOrTitle.isSingleMovie !== false;
    epNum = optsOrTitle.epNum !== undefined ? optsOrTitle.epNum : 1;
    season = optsOrTitle.season !== undefined ? optsOrTitle.season : 1;
  } else {
    title = optsOrTitle || "";
    namingScheme = namingSchemeArg || "default";
    ext = extArg !== undefined ? extArg : ".mp4";
    quality = qualityArg || null;
    year = yearArg || null;
    isSingleMovie = true;
    epNum = 1;
    season = 1;
  }

  const cleanTitle = sanitizeFolderName(title || "Movie");
  const yearStr = year ? ` (${year})` : "";
  const qStr = quality ? ` [${quality}]` : "";

  let baseName;
  if (isSingleMovie) {
    if (namingScheme === "plex_jellyfin" || namingScheme === "title_s01e01") {
      baseName = `${cleanTitle}${yearStr}${qStr}`;
    } else if (namingScheme === "title_only") {
      baseName = cleanTitle;
    } else {
      // Default / Standard for single movies: clean movie title
      baseName = cleanTitle;
    }
  } else {
    // Multi-episode series under Movies & Series
    const num = parseFloat(epNum) || 1;
    const paddedEp = String(num).padStart(2, "0");
    const paddedSeason = String(season || 1).padStart(2, "0");

    if (namingScheme === "title_s01e01" || namingScheme === "plex_jellyfin") {
      baseName = `${cleanTitle} - S${paddedSeason}E${paddedEp}${qStr}`;
    } else if (namingScheme === "title_ep") {
      baseName = `${cleanTitle} - Episode ${num}`;
    } else if (namingScheme === "title_only") {
      baseName = `${cleanTitle} - ${paddedEp}`;
    } else {
      // default: "Title - 01"
      baseName = `${cleanTitle} - ${paddedEp}`;
    }
  }

  const cleanExt = ext ? (ext.startsWith(".") ? ext : `.${ext}`) : "";
  return `${baseName}${cleanExt}`;
}

function formatChapterFilename(
  optsOrTitle = {},
  chapterNumArg,
  namingSchemeArg,
  extArg,
) {
  let title, chapterNum, namingScheme, ext;

  if (typeof optsOrTitle === "object" && optsOrTitle !== null) {
    title = optsOrTitle.title || "";
    chapterNum =
      optsOrTitle.chapterNum !== undefined ? optsOrTitle.chapterNum : 1;
    namingScheme = optsOrTitle.namingScheme || "default";
    ext = optsOrTitle.ext || ".cbz";
  } else {
    title = optsOrTitle || "";
    chapterNum = chapterNumArg !== undefined ? chapterNumArg : 1;
    namingScheme = namingSchemeArg || "default";
    ext = extArg || ".cbz";
  }

  const num = chapterNum;
  const cleanTitle = sanitizeFolderName(title || "Manga");
  let baseName;

  if (namingScheme === "series_chapter") {
    baseName = `${cleanTitle} - Chapter ${num}`;
  } else if (namingScheme === "short") {
    baseName = `Ch. ${num}`;
  } else {
    baseName = `Chapter ${num}`;
  }

  return `${baseName}${ext.startsWith(".") ? ext : `.${ext}`}`;
}

function normalizeTitleForMatch(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\b(?:19|20)\d{2}\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractYearFromDate(val) {
  if (val === null || val === undefined) return null;
  const match = String(val).match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function normalizeMediaKind(type) {
  const norm = String(type || "").toLowerCase().trim();
  if (!norm) return null;
  if (norm === "movie" || norm === "movies" || norm === "film") return "movie";
  if (
    norm === "tv" ||
    norm === "series" ||
    norm === "tv series" ||
    norm === "tv-series" ||
    norm === "show" ||
    norm === "tv show" ||
    norm === "mini-series" ||
    norm === "miniseries"
  ) {
    return "tv";
  }
  return null;
}

/**
 * Determine whether a Movies/Series entry represents a single standalone movie
 * rather than a multi-episode / multi-season series.
 */
function detectIsSingleMovie({
  mediaType = null,
  type = null,
  id = null,
  episodes = null,
  episodesJson = null,
  season = null,
  episodeId = null,
  epNum = null,
} = {}) {
  const normSection = String(mediaType || "").toLowerCase().trim();
  if (normSection === "anime" || normSection === "manga") {
    return false;
  }

  const checkIdStr = `${id || ""} ${episodeId || ""}`;
  if (
    /(?:^|\s)tv:/i.test(checkIdStr) ||
    /tv:[^:]+:\d+:\d+/i.test(checkIdStr) ||
    /[Ss]\d+[Ee]\d+/i.test(checkIdStr)
  ) {
    return false;
  }

  if (season !== null && season !== undefined && Number(season) > 1) {
    return false;
  }

  if (
    epNum !== null &&
    epNum !== undefined &&
    !isNaN(Number(epNum)) &&
    Number(epNum) > 1
  ) {
    return false;
  }

  const kind = normalizeMediaKind(type);
  if (kind === "tv") {
    return false;
  }

  if (episodesJson) {
    try {
      const counts =
        typeof episodesJson === "string"
          ? JSON.parse(episodesJson)
          : episodesJson;
      if (counts && typeof counts === "object" && !Array.isArray(counts)) {
        const seasons = Object.keys(counts).map(Number);
        const maxCount = Math.max(0, ...Object.values(counts).map(Number));
        const total = Object.values(counts).reduce(
          (acc, v) => acc + (Number(v) || 0),
          0,
        );
        if (seasons.some((s) => s > 1) || maxCount > 1 || total > 1) {
          return false;
        }
      }
    } catch (_) {}
  }

  if (Array.isArray(episodes)) {
    if (episodes.length > 1) return false;
    if (episodes.length === 1) {
      const ep = episodes[0] || {};
      if (
        (ep.season !== null && ep.season !== undefined && Number(ep.season) > 1) ||
        (ep.number !== null && ep.number !== undefined && Number(ep.number) > 1) ||
        (ep.id &&
          (/tv:[^:]+:\d+:\d+/i.test(String(ep.id)) ||
            /^tv:/i.test(String(ep.id)) ||
            /[Ss]\d+[Ee]\d+/i.test(String(ep.id))))
      ) {
        return false;
      }
    }
  }

  if (kind === "movie") return true;
  if (id && /^movie:/i.test(String(id))) return true;
  if (
    Array.isArray(episodes) &&
    episodes.length === 1 &&
    (episodes[0]?.isMovie === true || episodes[0]?.title === "Full Movie")
  ) {
    return true;
  }

  // Fallback when provider omitted `type` (typical for movie-only entries without seasons)
  if (!type && (!Array.isArray(episodes) || episodes.length <= 1)) {
    if (
      Array.isArray(episodes) &&
      episodes.length === 1 &&
      episodes[0]?.season !== undefined &&
      episodes[0]?.season !== null &&
      Number(episodes[0].season) >= 1 &&
      episodes[0]?.title !== "Full Movie"
    ) {
      return false;
    }
    return true;
  }

  return false;
}

function scoreMovieMatch(target = {}, candidate = {}) {
  const targetNorm = normalizeTitleForMatch(target.title);
  const candNorm = normalizeTitleForMatch(candidate.title);
  if (!targetNorm || !candNorm) return 0;

  let score = 0;
  if (targetNorm === candNorm) {
    score += 70;
  } else if (candNorm.includes(targetNorm) || targetNorm.includes(candNorm)) {
    score += 40;
  } else {
    const targetTokens = new Set(targetNorm.split(" ").filter(Boolean));
    const candTokens = new Set(candNorm.split(" ").filter(Boolean));
    if (targetTokens.size > 0 && candTokens.size > 0) {
      let overlap = 0;
      for (const tok of targetTokens) {
        if (candTokens.has(tok)) overlap++;
      }
      const unionSize = new Set([...targetTokens, ...candTokens]).size;
      score += Math.round((overlap / unionSize) * 35);
    }
  }

  const targetYear = extractYearFromDate(target.year);
  const candYear =
    extractYearFromDate(candidate.year) ||
    extractYearFromDate(candidate.released) ||
    extractYearFromDate(candidate.aired) ||
    extractYearFromDate(candidate.releaseDate) ||
    extractYearFromDate(candidate.title);

  if (targetYear && candYear) {
    const diff = Math.abs(parseInt(targetYear, 10) - parseInt(candYear, 10));
    if (diff === 0) score += 20;
    else if (diff === 1) score += 5;
    else score -= 15;
  }

  const targetKind = normalizeMediaKind(target.mediaType || target.type);
  const candKind = normalizeMediaKind(candidate.type);
  if (targetKind && candKind) {
    if (targetKind === candKind) score += 10;
    else score -= 20;
  }

  return score;
}

function rankMovieCandidates(target = {}, rawResults = [], isManualQuery = false) {
  if (!Array.isArray(rawResults) || rawResults.length === 0) {
    return { confidence: "none", match: null, candidates: [] };
  }

  const seen = new Set();
  const candidates = [];
  for (const raw of rawResults) {
    if (!raw || !raw.id) continue;
    const idStr = String(raw.id);
    if (seen.has(idStr)) continue;
    seen.add(idStr);

    const candYear =
      extractYearFromDate(raw.year) ||
      extractYearFromDate(raw.released) ||
      extractYearFromDate(raw.aired) ||
      extractYearFromDate(raw.releaseDate) ||
      null;

    const score = scoreMovieMatch(target, {
      title: raw.title || raw.name || "",
      year: candYear,
      type: raw.type || raw.mediaType || null,
    });

    candidates.push({
      id: idStr,
      title: raw.title || raw.name || idStr,
      image: raw.image || raw.image_url || raw.poster || null,
      year: candYear,
      type: raw.type || raw.mediaType || null,
      score,
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  const topCandidates = candidates.slice(0, 15);
  if (topCandidates.length === 0) {
    return { confidence: "none", match: null, candidates: [] };
  }

  const top = topCandidates[0];
  const second = topCandidates[1];
  const isHighConfidence =
    !isManualQuery &&
    top.score >= 85 &&
    (!second || top.score - second.score >= 15);

  return {
    confidence: isHighConfidence ? "high" : "low",
    match: isHighConfidence ? top : null,
    candidates: topCandidates,
  };
}

module.exports = {
  formatEpisodeFilename,
  formatMovieFilename,
  formatChapterFilename,
  normalizeTitleForMatch,
  extractYearFromDate,
  normalizeMediaKind,
  detectIsSingleMovie,
  scoreMovieMatch,
  rankMovieCandidates,
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
  parseSeasonFolderNumber,
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
