// libs
const path = require("path");
const fs = require("fs");
const os = require("os");
const { queryOne, run } = require("./db");
const { sanitizeFolderName } = require("./constants");

async function getOrCreateMediaDir(
  parentDir,
  title,
  mediaId,
  mediaType = "Anime",
  create = false,
) {
  let existingFolderName = null;
  if (mediaId) {
    try {
      const tableName =
        mediaType === "Manga"
          ? "Manga"
          : mediaType === "Movies" || mediaType === "MoviesSeries"
            ? "Movies"
            : "Anime";
      const row = await queryOne(
        `SELECT folder_name FROM ${tableName} WHERE id = ? OR LOWER(id) = LOWER(?) LIMIT 1`,
        [mediaId, mediaId],
      );
      if (row && row.folder_name) {
        existingFolderName = row.folder_name;
      }
    } catch (_) {}
  }

  if (existingFolderName) {
    const targetDir = path.join(parentDir, existingFolderName);
    if (create && !fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }
    return targetDir;
  }

  const folderName = sanitizeFolderName(title);
  const targetDir = path.join(parentDir, folderName);
  if (create && !fs.existsSync(targetDir)) {
    await fs.promises.mkdir(targetDir, { recursive: true });
  }

  if (mediaId) {
    try {
      const tableName =
        mediaType === "Manga"
          ? "Manga"
          : mediaType === "Movies" || mediaType === "MoviesSeries"
            ? "Movies"
            : "Anime";
      await run(
        `UPDATE ${tableName} SET folder_name = ? WHERE id = ? AND (folder_name IS NULL OR folder_name = '')`,
        [folderName, mediaId],
      );
    } catch (_) {}
  }

  return targetDir;
}

// Downloads/<Type> root (custom location or default)
async function getTypeDir(customdir, Type, create = false) {
  let Directory;
  if (customdir && typeof customdir === "string" && customdir.trim()) {
    Directory = customdir.trim();
    if (create) {
      try {
        await fs.promises.mkdir(Directory, { recursive: true });
      } catch (_) {}
    }
  } else {
    const destination = getDownloadsFolder();
    const folderName =
      Type === "Movies" || Type === "MoviesSeries" ? "MoviesSeries" : Type;
    Directory = path.join(destination, `./${folderName}`);
    if (create) {
      try {
        await fs.promises.mkdir(Directory, { recursive: true });
      } catch (_) {}
    }
  }

  if (create && Directory) {
    const dirNomedia = path.join(Directory, ".nomedia");
    if (!fs.existsSync(dirNomedia)) {
      try {
        fs.writeFileSync(dirNomedia, "");
      } catch (_) {}
    }
  }
  return Directory;
}

function getEffectiveDownloadLocation(type, config) {
  if (!config) return null;
  const norm = String(type || "").toLowerCase();
  if (norm === "anime") return config.CustomDownloadLocationAnime || null;
  if (norm === "movies" || norm === "movies-tvshows" || norm === "moviesseries")
    return config.CustomDownloadLocationMovies || null;
  return config.CustomDownloadLocationManga || null;
}

// Dir GET
async function GetDir(title, customdir, Type, mediaId = null, create = false) {
  const Directory = await getTypeDir(customdir, Type, create);
  return await getOrCreateMediaDir(Directory, title, mediaId, Type, create);
}

// Media-server layout: Anime/<Series>/Season NN or MoviesSeries/<Series>/Season NN. Pins the entry's folder_name
// to it so the library finds the episodes there.
async function mediaServerDir(
  series,
  season,
  customdir,
  mediaId = null,
  type = "Anime",
) {
  const folderName = `${sanitizeFolderName(series)}/Season ${String(season).padStart(2, "0")}`;
  const targetDir = path.join(
    await getTypeDir(customdir, type, true),
    folderName,
  );
  await fs.promises.mkdir(targetDir, { recursive: true });
  if (mediaId) {
    try {
      const table =
        type === "Movies" || type === "MoviesSeries" ? "Movies" : "Anime";
      await run(`UPDATE ${table} SET folder_name = ? WHERE id = ?`, [
        folderName,
        mediaId,
      ]);
    } catch (_) {}
  }
  return targetDir;
}

// Anime Dir Maker
async function directoryMaker(title, ep, customdir, mediaId = null) {
  return await GetDir(title, customdir, "Anime", mediaId, true);
}

// Manga Dir Maker
async function MangaDir(title, customdir, mediaId = null) {
  return await GetDir(title, customdir, "Manga", mediaId, true);
}

// Movies & Series Dir Maker
async function MovieDir(title, customdir, mediaId = null) {
  return await GetDir(title, customdir, "MoviesSeries", mediaId, true);
}

// download folder Location
function getDownloadsFolder() {
  return (
    process.env.STRAWVERSE_PUBLIC_ROOT ||
    process.env.NODEJS_MOBILE_DATA_DIR ||
    path.join(os.homedir(), "Downloads")
  );
}

// Check Path Exists
async function ensureDirectoryExists(directoryPath) {
  if (!path.isAbsolute(directoryPath)) {
    throw new Error("Invalid directory path");
  }
  try {
    await fs.promises.access(directoryPath);
  } catch (err) {
    if (err.code === "ENOENT") {
      try {
        await fs.promises.mkdir(directoryPath, { recursive: true });
      } catch (mkdirErr) {
        throw new Error("Invalid directory path");
      }
    } else {
      throw new Error("Invalid directory path");
    }
  }
}

module.exports = {
  sanitizeFolderName,
  directoryMaker,
  mediaServerDir,
  MangaDir,
  MovieDir,
  ensureDirectoryExists,
  getDownloadsFolder,
  GetDir,
  getTypeDir,
  getEffectiveDownloadLocation,
};
