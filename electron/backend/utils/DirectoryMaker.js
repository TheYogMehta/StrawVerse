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

// Helper to resolve or create a unique directory for an anime/manga by title and mediaId
async function getOrCreateMediaDir(parentDir, title, mediaId) {
  const baseName = sanitizeFolderName(title);
  let folderName = baseName;
  let counter = 1;

  while (true) {
    const candidatePath = path.join(parentDir, folderName);
    const metaFile = path.join(candidatePath, ".strawverse_id");

    if (fs.existsSync(candidatePath)) {
      if (fs.existsSync(metaFile)) {
        try {
          const content = fs.readFileSync(metaFile, "utf-8");
          const data = JSON.parse(content);
          if (
            !mediaId ||
            String(data.mediaId) === String(mediaId) ||
            data.title === title
          ) {
            return candidatePath;
          }
        } catch (_) {}
      } else {
        if (mediaId) {
          try {
            fs.writeFileSync(
              metaFile,
              JSON.stringify({ mediaId, title }, null, 2),
            );
          } catch (_) {}
        }
        return candidatePath;
      }

      counter++;
      folderName = `${baseName} (${counter})`;
    } else {
      await fs.promises.mkdir(candidatePath, { recursive: true });
      if (mediaId) {
        try {
          fs.writeFileSync(
            metaFile,
            JSON.stringify({ mediaId, title }, null, 2),
          );
        } catch (_) {}
      }
      return candidatePath;
    }
  }
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
  const homeDir = os.homedir();
  return path.join(homeDir, "Downloads");
}

// Check Path Exists
async function ensureDirectoryExists(directoryPath) {
  if (!path.isAbsolute(directoryPath)) {
    throw new Error("Invalid directory path");
  }
  try {
    await fs.promises.access(directoryPath);
  } catch (err) {
    throw new Error("Invalid directory path");
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
