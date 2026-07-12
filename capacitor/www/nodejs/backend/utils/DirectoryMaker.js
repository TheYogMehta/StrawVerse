// libs
const path = require("path");
const fs = require("fs");
const os = require("os");

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

  //Anime dir Making
  const animeDirectory = path.join(destination, `./Anime`);
  try {
    await fs.promises.access(animeDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(animeDirectory);
    } else {
      throw error;
    }
  }

  //Anime Name Dir
  const directoryName = title.replace(/[^a-zA-Z0-9]/g, "_");
  const directoryPath = path.join(animeDirectory, directoryName);
  try {
    await fs.promises.access(directoryPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(directoryPath);
    } else {
      throw error;
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

  // Type dir Making
  const Directory = path.join(destination, `./${Type}`);
  try {
    await fs.promises.access(Directory);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(Directory);
    } else {
      throw error;
    }
  }

  // Name Dir
  const directoryName = title.replace(/[^a-zA-Z0-9]/g, "_");
  const directoryPath = path.join(Directory, directoryName);
  try {
    await fs.promises.access(directoryPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(directoryPath);
    } else {
      throw error;
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
  //Manga dir Making
  const MangaDirectory = path.join(destination, `./Manga`);
  try {
    await fs.promises.access(MangaDirectory);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(MangaDirectory);
    } else {
      throw error;
    }
  }
  //Manga Name Dir
  const directoryName = title.replace(/[^a-zA-Z0-9]/g, "_");
  const directoryPath = path.join(MangaDirectory, directoryName);
  try {
    await fs.promises.access(directoryPath);
  } catch (error) {
    if (error.code === "ENOENT") {
      await fs.promises.mkdir(directoryPath);
    } else {
      throw error;
    }
  }
  // Chapter cbz
  return directoryPath;
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
  directoryMaker,
  directoryRemover,
  MangaDir,
  ensureDirectoryExists,
  getDownloadsFolder,
  GetDir,
};
