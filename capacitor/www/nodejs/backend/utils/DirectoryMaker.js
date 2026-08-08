// libs
const path = require("path");
const fs = require("fs");
const os = require("os");

function sanitizeFolderName(title) {
  if (!title) return "Untitled";
  const sanitized = String(title)
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|\.+$/g, "");
  return sanitized || "Untitled";
}

async function getOrCreateMediaDir(
  parentDir,
  title,
  mediaId,
  mediaType = "Anime",
) {
  let existingFolderName = null;
  if (mediaId) {
    try {
      const { queryOne } = require("./db");
      const tableName = mediaType === "Manga" ? "Manga" : "Anime";
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
    if (!fs.existsSync(targetDir)) {
      await fs.promises.mkdir(targetDir, { recursive: true });
    }
    return targetDir;
  }

  const folderName = sanitizeFolderName(title);
  const targetDir = path.join(parentDir, folderName);
  if (!fs.existsSync(targetDir)) {
    await fs.promises.mkdir(targetDir, { recursive: true });
  }

  if (mediaId) {
    try {
      const { run } = require("./db");
      const tableName = mediaType === "Manga" ? "Manga" : "Anime";
      await run(
        `UPDATE ${tableName} SET folder_name = ? WHERE id = ? AND (folder_name IS NULL OR folder_name = '')`,
        [folderName, mediaId],
      );
    } catch (_) {}
  }

  return targetDir;
}

// Anime Dir Maker
async function directoryMaker(title, ep, customdir, mediaId = null) {
  let destination;
  if (customdir) {
    try {
      await fs.promises.access(customdir);
      destination = customdir;
    } catch (err) {
      if (err.code === "ENOENT") {
        destination = getDownloadsFolder();
      }
    }
  } else {
    destination = getDownloadsFolder();
  }

  const animeDirectory = path.join(destination, `./Anime`);
  try {
    await fs.promises.access(animeDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(animeDirectory, { recursive: true });
    }
  }
  const animeNomedia = path.join(animeDirectory, ".nomedia");
  if (!fs.existsSync(animeNomedia)) {
    try {
      fs.writeFileSync(animeNomedia, "");
    } catch (_) {}
  }

  return await getOrCreateMediaDir(animeDirectory, title, mediaId);
}

// Dir GET
async function GetDir(title, customdir, Type, mediaId = null) {
  let destination;
  if (customdir) {
    try {
      await fs.promises.access(customdir);
      destination = customdir;
    } catch (err) {
      if (err.code === "ENOENT") {
        destination = getDownloadsFolder();
      }
    }
  } else {
    destination = getDownloadsFolder();
  }

  const Directory = path.join(destination, `./${Type}`);
  try {
    await fs.promises.access(Directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(Directory, { recursive: true });
    }
  }
  const dirNomedia = path.join(Directory, ".nomedia");
  if (!fs.existsSync(dirNomedia)) {
    try {
      fs.writeFileSync(dirNomedia, "");
    } catch (_) {}
  }

  return await getOrCreateMediaDir(Directory, title, mediaId);
}

// dir + file remover
async function directoryRemover(tempeps) {
  try {
    await fs.promises.access(tempeps);
    await fs.promises.rm(tempeps, { recursive: true });
  } catch (err) {
    return;
  }
}

// Manga Dir Maker
async function MangaDir(title, customdir, mediaId = null) {
  let customdirneko = customdir || getDownloadsFolder();
  let destination;
  try {
    await fs.promises.access(customdirneko);
    destination = customdirneko;
  } catch (err) {
    if (err.code === "ENOENT") {
      destination = path.join(
        process.env.PORTABLE_EXECUTABLE_DIR || process.cwd(),
      );
    }
  }

  const MangaDirectory = path.join(destination, `./Manga`);
  try {
    await fs.promises.access(MangaDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(MangaDirectory, { recursive: true });
    }
  }
  const mangaNomedia = path.join(MangaDirectory, ".nomedia");
  if (!fs.existsSync(mangaNomedia)) {
    try {
      fs.writeFileSync(mangaNomedia, "");
    } catch (_) {}
  }

  return await getOrCreateMediaDir(MangaDirectory, title, mediaId);
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
  directoryRemover,
  MangaDir,
  ensureDirectoryExists,
  getDownloadsFolder,
  GetDir,
};
