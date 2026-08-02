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

// Anime Dir Maker
async function directoryMaker(title, ep, customdir) {
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

  const directoryName = sanitizeFolderName(title);
  const directoryPath = path.join(animeDirectory, directoryName);
  try {
    await fs.promises.access(directoryPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(directoryPath, { recursive: true });
    }
  }

  return directoryPath;
}

// Dir GET
async function GetDir(title, customdir, Type) {
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

  const directoryName = sanitizeFolderName(title);
  const directoryPath = path.join(Directory, directoryName);
  try {
    await fs.promises.access(directoryPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(directoryPath, { recursive: true });
    }
  }

  return directoryPath;
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
async function MangaDir(title, customdir) {
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

  const directoryName = sanitizeFolderName(title);
  const directoryPath = path.join(MangaDirectory, directoryName);
  try {
    await fs.promises.access(directoryPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(directoryPath, { recursive: true });
    }
  }

  return directoryPath;
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
