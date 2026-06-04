// libs
const { logger } = require("./AppLogger");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const { db, tables } = require("./db");

const VIDEO_EXTENSIONS = [".mp4", ".mkv", ".webm", ".ts", ".avi", ".mov", ".flv", ".m4v", ".3gp"];

function getEpisodeNumberFromFilename(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (!VIDEO_EXTENSIONS.includes(ext)) return null;

  // Match starts with number (e.g. 1Ep.mp4, 1.mp4, 01.mkv)
  let match = filename.match(/^(\d+(\.\d+)?)/);
  if (match) return parseFloat(match[1]);

  // Match ep/episode prefix
  match = filename.match(/(?:ep|episode|ch|chapter)\s*(\d+(\.\d+)?)/i);
  if (match) return parseFloat(match[1]);

  // Fallback to first digit sequence
  match = filename.match(/\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

// Add metadata
async function MetadataAdd(type, valuesToAdd) {
  if (!tables[type] || !valuesToAdd?.id) {
    throw new Error(`Invalid args!`);
  }

  // Fallback to existing MalID for the same series if not provided
  if (valuesToAdd?.title && (!valuesToAdd.MalID || valuesToAdd.MalID === "")) {
    try {
      const baseTitle = valuesToAdd.title.replace(/\s+(sub|dub|both)$/i, "");
      const match = db.prepare(`SELECT MalID FROM ${type} WHERE (title LIKE ? OR folder_name LIKE ?) AND MalID IS NOT NULL AND MalID != '' LIMIT 1`)
        .get(`%${baseTitle}%`, `%${baseTitle}%`);
      if (match?.MalID) {
        valuesToAdd.MalID = match.MalID;
      }
    } catch (_) {}
  }

  let existingRecord = db
    .prepare(`SELECT * FROM ${type} WHERE id = ?`)
    .get(valuesToAdd?.id);

  if (!existingRecord) {
    if (valuesToAdd?.ImageUrl) {
      let Imageurl = valuesToAdd?.ImageUrl?.trim();
      if (Imageurl.includes("/api/image?url=")) {
        Imageurl = Imageurl.split("/api/image?url=")[1];
      }
      try {
        const client = global.axios || axios;
        const response = await client.get(Imageurl, {
          responseType: "arraybuffer",
        });

        valuesToAdd.image = `data:image/png;base64,${Buffer.from(
          response.data,
        ).toString("base64")}`;
      } catch (err) {
        logger.error(`Failed to fetch image from: ${Imageurl}`);
        logger.error(`Error message: ${err.message}`);
        logger.error(`Stack trace: ${err.stack}`);
      }
    }

    if (valuesToAdd?.title) {
      const baseFolderName = valuesToAdd.title.replace(/[^a-zA-Z0-9]/g, "_");
      let existingByFolder = null;
      try {
        existingByFolder = db
          .prepare(`SELECT provider FROM ${type} WHERE folder_name = ?`)
          .get(baseFolderName);
      } catch (_) {}
      if (
        existingByFolder &&
        existingByFolder.provider !== (valuesToAdd.provider || "")
      ) {
        const pSuffix = (valuesToAdd.provider || "unknown").replace(
          /[^a-zA-Z0-9]/g,
          "_",
        );
        valuesToAdd.folder_name = `${baseFolderName}_${pSuffix}`;
      } else {
        valuesToAdd.folder_name = baseFolderName;
      }
    }

    if (
      !valuesToAdd.hasOwnProperty("CustomTag")
    ) {
      valuesToAdd.CustomTag = JSON.stringify([
        type === "Manga" ? "Reading" : "Watching",
      ]);
    }

    try {
      const validColumns = Object.keys(tables[type]);
      const filteredValues = {};

      validColumns.forEach((column) => {
        if (valuesToAdd.hasOwnProperty(column) && valuesToAdd[column] !== undefined) {
          filteredValues[column] = valuesToAdd[column];
        } else {
          const columnType = tables[type][column];
          if (columnType.includes("TEXT")) {
            filteredValues[column] = "";
          } else if (columnType.includes("INTEGER")) {
            filteredValues[column] = 0;
          } else if (columnType.includes("BLOB")) {
            filteredValues[column] = null;
          }
        }
      });

      const fields = Object.keys(filteredValues).join(", ") + ", last_updated";
      const placeholders =
        Object.keys(filteredValues)
          .map(() => "?")
          .join(", ") + ", CURRENT_TIMESTAMP";
      const values = Object.values(filteredValues);

      db.prepare(
        `INSERT INTO ${type} (${fields}) VALUES (${placeholders})`,
      ).run(...values);
    } catch (error) {
      throw new Error(`Error inserting into ${type}: ${error.message}`);
    }
  } else {
    const currentTag = existingRecord.CustomTag;
    let hasTag = false;
    try {
      const parsed = JSON.parse(currentTag);
      if (Array.isArray(parsed) && parsed.length > 0) hasTag = true;
    } catch (e) {}
    if (!currentTag || currentTag === "[]" || !hasTag) {
      const defaultTag = JSON.stringify([
        type === "Manga" ? "Reading" : "Watching",
      ]);
      db.prepare(
        `UPDATE ${type} SET CustomTag = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
      ).run(defaultTag, existingRecord.id);
    }

    // Auto-update empty MalID in existing record if we have one available now
    if (!existingRecord.MalID || existingRecord.MalID === "") {
      let malIdToUpdate = valuesToAdd?.MalID;
      if (!malIdToUpdate && existingRecord.title) {
        try {
          const baseTitle = existingRecord.title.replace(/\s+(sub|dub|both)$/i, "");
          const match = db.prepare(`SELECT MalID FROM ${type} WHERE (title LIKE ? OR folder_name LIKE ?) AND MalID IS NOT NULL AND MalID != '' LIMIT 1`)
            .get(`%${baseTitle}%`, `%${baseTitle}%`);
          if (match?.MalID) {
            malIdToUpdate = match.MalID;
          }
        } catch (_) {}
      }
      if (malIdToUpdate) {
        db.prepare(
          `UPDATE ${type} SET MalID = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        ).run(String(malIdToUpdate), existingRecord.id);
      }
    }
  }
}

// Remove metadata
function MetadataRemove(type, id) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  try {
    db.prepare(`DELETE FROM ${type} WHERE id = ? OR folder_name = ?`).run(
      id,
      id,
    );
  } catch (error) {
    throw new Error(`Error deleting from ${type}: ${error.message}`);
  }
}

// Get All Metadata
async function getAllMetadata(type, baseDir, page = 1, tag = null) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  try {
    const typeDir = path.join(baseDir, type);
    const folders = [];
    if (fs.existsSync(typeDir)) {
      const directories = await fs.promises.readdir(typeDir, {
        withFileTypes: true,
      });
      directories
        .filter((dir) => dir.isDirectory())
        .forEach((dir) => folders.push(dir.name));
    }

    let storedMetadata = [];
    try {
      if (tag && tag !== "All" && tag !== "") {
        const likeTag = `%"${tag}"%`;
        storedMetadata = db
          .prepare(
            `SELECT * FROM ${type} WHERE CustomTag = ? OR CustomTag LIKE ? ORDER BY last_updated DESC`,
          )
          .all(tag, likeTag);
      } else {
        storedMetadata = db
          .prepare(`SELECT * FROM ${type} ORDER BY last_updated DESC`)
          .all();
      }
    } catch (err) {
      storedMetadata = [];
    }

    const folderSet = new Set(folders);
    const missingFolders = storedMetadata
      .filter(
        (entry) =>
          !folderSet.has(entry.folder_name) &&
          (!entry.CustomTag || entry.CustomTag === "") &&
          (!entry.MalID || entry.MalID === ""),
      )
      .map((entry) => entry.folder_name);

    missingFolders.forEach((folder) => {
      if (folder) {
        db.exec(`DELETE FROM ${type} WHERE folder_name = '${folder}'`);
      }
    });

    try {
      if (tag && tag !== "All" && tag !== "") {
        const likeTag = `%"${tag}"%`;
        storedMetadata = db
          .prepare(
            `SELECT * FROM ${type} WHERE CustomTag = ? OR CustomTag LIKE ? ORDER BY last_updated DESC`,
          )
          .all(tag, likeTag);
      } else {
        storedMetadata = db
          .prepare(`SELECT * FROM ${type} ORDER BY last_updated DESC`)
          .all();
      }
    } catch (err) {
      storedMetadata = [];
    }

    const storedFolderSet = new Set(storedMetadata.map((m) => m.folder_name));
    folders.forEach((alltitles) => {
      if (storedFolderSet.has(alltitles)) return;

      if (tag && tag !== "All" && tag !== "") return;

      storedMetadata.push({
        title: alltitles.replaceAll("_", ""),
        folder_name: alltitles,
        id: alltitles,
        type: type,
        provider: "local source",
        CustomTag: "",
      });
    });

    // Filter out pure backend links (no local folders and no custom tags)
    storedMetadata = storedMetadata.filter((entry) => {
      const folderExists = entry.folder_name ? folderSet.has(entry.folder_name) : false;
      const hasTags = entry.CustomTag && entry.CustomTag !== "" && entry.CustomTag !== "[]";
      return folderExists || hasTags;
    });

    // Group and merge entries by MalID
    const groupedMetadata = [];
    const malIdGroups = {};

    storedMetadata.forEach((entry) => {
      if (entry.MalID && entry.MalID !== "") {
        if (!malIdGroups[entry.MalID]) {
          malIdGroups[entry.MalID] = [];
        }
        malIdGroups[entry.MalID].push(entry);
      } else {
        groupedMetadata.push(entry);
      }
    });

    Object.keys(malIdGroups).forEach((malId) => {
      const group = malIdGroups[malId];
      const mainEntry = group[0];
      
      mainEntry.linkedProviders = group.map((g) => ({
        id: g.id,
        provider: g.provider,
        CustomTag: g.CustomTag,
        title: g.title,
        folder_name: g.folder_name,
      }));

      groupedMetadata.push(mainEntry);
    });

    storedMetadata = groupedMetadata;

    // Pagination logic
    const limit = 15;
    const totalPages = Math.ceil(storedMetadata?.length / limit);
    const startIndex = (page - 1) * limit;
    const paginatedMetadata = storedMetadata.slice(
      startIndex,
      startIndex + limit,
    );
    const hasNextPage = page < totalPages;

    const updatedMetadata = [];

    for (const metadata of paginatedMetadata) {
      const folderPath = path.join(baseDir, type, metadata.folder_name || "");
      const folderExists = metadata.folder_name
        ? fs.existsSync(folderPath)
        : false;

      if (
        !folderExists &&
        (!metadata.CustomTag || metadata.CustomTag === "") &&
        (!metadata.MalID || metadata.MalID === "")
      ) {
        db.exec(`DELETE FROM ${type} WHERE id = '${metadata.id}'`);
        continue;
      }

      let content = [];
      if (folderExists) {
        const filesAndFolders = await fs.promises.readdir(folderPath, {
          withFileTypes: true,
        });

        if (type === "Anime") {
          content = filesAndFolders
            .filter((file) => file.isFile())
            .map((file) => getEpisodeNumberFromFilename(file.name))
            .filter((num) => num !== null && !isNaN(num))
            .sort((a, b) => a - b);
        } else if (type === "Manga") {
          content = filesAndFolders
            .filter(
              (file) =>
                file.isFile() &&
                file.name.endsWith(".cbz") &&
                file.name.toLowerCase().includes("chapter"),
            )
            .map((file) =>
              parseInt(
                file?.name
                  ?.toLowerCase()
                  ?.split("chapter")?.[1]
                  ?.split(".cbz")[0],
              ),
            )
            .filter(Boolean)
            .sort((a, b) => a - b);
        }
      }

      updatedMetadata.push({
        ...metadata,
        Downloaded: content,
      });
    }

    return {
      totalPages,
      currentPage: page,
      hasNextPage,
      results: updatedMetadata,
    };
  } catch (err) {
    throw new Error(`Error fetching metadata: ${err.message}`);
  }
}

// Get Local Provider And Info
async function FetchLocalProviderInfo(type, id) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  try {
    const metadata = db.prepare(`SELECT * FROM ${type} WHERE id = ?`).get(id);
    if (!metadata) {
      throw new Error(`No metadata found for ID: ${id}`);
    }

    if (metadata?.genres) {
      try {
        metadata.genres = metadata?.genres?.split(",") ?? [];
      } catch (error) {
        metadata.genres = [];
      }
    }

    if (metadata?.EpisodesDataId) {
      metadata.dataId = metadata?.EpisodesDataId;
      delete metadata.EpisodesDataId;
    }

    return metadata;
  } catch (err) {
    throw new Error(`Error fetching metadata by ID: ${err.message}`);
  }
}

// Get Local Source By id
async function getSourceById(type, baseDir, id, number, subdub) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  let folder_name = id;
  let malId = null;
  let mainSubOrDub = null;
  try {
    const metadata = db.prepare(`SELECT * FROM ${type} WHERE id = ?`).get(id);
    if (metadata) {
      folder_name = metadata.folder_name;
      malId = metadata.MalID;
      mainSubOrDub = metadata.subOrDub;
    }
  } catch (err) {
    // ignore
  }

  try {
    let folderPath = path.join(baseDir, type, folder_name);
    let finalPath = "";
    let fileFound = false;

    const searchInFolder = (fPath) => {
      if (!fs.existsSync(fPath)) return null;
      if (type === "Anime") {
        const files = fs.readdirSync(fPath);
        const match = files.find((f) => {
          const num = getEpisodeNumberFromFilename(f);
          return num !== null && num === parseFloat(number);
        });
        return match ? path.join(fPath, match) : null;
      } else if (type === "Manga") {
        const filePath = path.join(fPath, `Chapter ${number}.cbz`);
        return fs.existsSync(filePath) ? filePath : null;
      }
      return null;
    };

    let dirsToSearch = [];
    if (!subdub || mainSubOrDub === subdub) {
      dirsToSearch.push(folderPath);
    }

    if (malId) {
      try {
        const linked = db
          .prepare(`SELECT folder_name, subOrDub FROM ${type} WHERE MalID = ?`)
          .all(String(malId));

        if (subdub) {
          linked.forEach((r) => {
            if (r.subOrDub === subdub && r.folder_name !== folder_name) {
              dirsToSearch.push(path.join(baseDir, type, r.folder_name));
            }
          });
          if (mainSubOrDub !== subdub) {
            dirsToSearch.push(folderPath);
          }
          linked.forEach((r) => {
            if (r.subOrDub !== subdub && r.folder_name !== folder_name) {
              dirsToSearch.push(path.join(baseDir, type, r.folder_name));
            }
          });
        } else {
          linked.forEach((r) => {
            if (r.folder_name !== folder_name) {
              dirsToSearch.push(path.join(baseDir, type, r.folder_name));
            }
          });
        }
      } catch (err) {
        if (!dirsToSearch.includes(folderPath)) {
          dirsToSearch.push(folderPath);
        }
      }
    } else {
      if (!dirsToSearch.includes(folderPath)) {
        dirsToSearch.push(folderPath);
      }
    }

    for (const searchPath of dirsToSearch) {
      const pathFound = searchInFolder(searchPath);
      if (pathFound) {
        finalPath = pathFound;
        fileFound = true;
        break;
      }
    }

    if (!fileFound) {
      let fileName = null;
      if (type === "Anime") {
        fileName = `${number}Ep.mp4`;
      } else if (type === "Manga") {
        fileName = `Chapter ${number}.cbz`;
      }
      finalPath = path.join(folderPath, fileName);
    }

    const parentDir = path.dirname(finalPath);
    const subtitlesDir = path.join(parentDir, `subs`);
    let subtitleFiles = [];

    if (fs.existsSync(subtitlesDir)) {
      subtitleFiles = fs
        .readdirSync(subtitlesDir)
        .filter((file) => {
          const isSub = file.endsWith(".srt") || file.endsWith(".vtt") || file.endsWith(".ass");
          if (!isSub) return false;
          const match = file.match(/^\d+(\.\d+)?/);
          if (match) {
            return parseFloat(match[0]) === parseFloat(number);
          }
          return false;
        })
        .map((subtitle) => {
          return {
            url: `/subtitles?file=${encodeURIComponent(
              path.join(subtitlesDir, subtitle),
            )}`,
            lang: subtitle.split(".")[1],
          };
        });
    }
    return {
      filepath: finalPath,
      subtitleFiles: subtitleFiles,
    };
  } catch (err) {
    throw new Error(`Error fetching file by ID: ${err.message}`);
  }
}

// find mapping ids
async function FindMapping(type, AnimeMangaid, malid, dir) {
  try {
    let data = {};

    // if logged in mal && Anime
    if (type === "Anime") {
      let id = AnimeMangaid?.replace(/-(dub|sub|both)$/, "");

      try {
        const FoundRow = db
          .prepare(
            "SELECT MalID, CustomTag FROM Anime WHERE id = ? or id = ? or id = ? or id = ? or folder_name = ? or folder_name = ? or folder_name = ? or folder_name = ?",
          )
          .get(
            `${id}-sub`,
            `${id}-dub`,
            `${id}-both`,
            AnimeMangaid,
            AnimeMangaid,
            id,
            `${id}-sub`,
            `${id}-dub`,
          );

        data.CustomTag = FoundRow?.CustomTag || "";

        if (!malid) {
          data.malid = FoundRow?.MalID ? parseInt(FoundRow.MalID) : null;
        } else {
          data.malid = malid;
        }

        // if mal id find in list if it exists
        if (data.malid && global.MalLoggedIn) {
          let MalInfo = db
            .prepare(`SELECT * FROM MyAnimeList WHERE id = ?`)
            .get(String(data.malid));

          data = {
            ...data,
            totalEpisodes:
              MalInfo?.totalEpisodes > 0
                ? MalInfo.totalEpisodes
                : MalInfo?.lastEpisode
                  ? MalInfo.lastEpisode
                  : 0,
            lastEpisode: MalInfo.lastEpisode ?? null,
            watched: MalInfo.watched ?? 0,
            status: MalInfo.status ?? "",
          };
        }
      } catch (err) {
        // ignore
      }

      // Finding If Its Downloaded
      try {
        let Downloads = [];
        if (data.malid) {
          Downloads = db
            .prepare("SELECT * FROM Anime WHERE MalID = ?")
            .all(String(data.malid));
        }
        if (Downloads.length === 0) {
          Downloads = db
            .prepare(
              "SELECT * FROM Anime WHERE id = ? or id = ? or id = ? or id = ? or folder_name = ? or folder_name = ? or folder_name = ? or folder_name = ?",
            )
            .all(
              `${id}-sub`,
              `${id}-dub`,
              `${id}-both`,
              AnimeMangaid,
              AnimeMangaid,
              id,
              `${id}-sub`,
              `${id}-dub`,
            );
        }

        if (Downloads?.length > 0) {
          Downloads[0].dataId = Downloads[0]?.EpisodesDataId;
          delete Downloads[0].EpisodesDataId;

          data = {
            ...Downloads[0],
            DownloadedEpisodes: {
              sub: [],
              dub: [],
            },
            ...data,
          };

          for (const SubDub of Downloads) {
            const folderPath = path.join(
              dir,
              "Anime",
              SubDub.folder_name || `${SubDub.title?.replace(/[^a-zA-Z0-9]/g, "_")}`,
            );

            if (fs.existsSync(folderPath)) {
              const filesAndFolders = await fs.promises.readdir(folderPath, {
                withFileTypes: true,
              });

              const resolvedSubDub = SubDub.subOrDub || "sub";

              const scanned = filesAndFolders
                .filter((file) => file.isFile())
                .map((file) => getEpisodeNumberFromFilename(file.name))
                .filter((num) => num !== null && !isNaN(num))
                .sort((a, b) => a - b);

              data.DownloadedEpisodes[resolvedSubDub] = Array.from(new Set([
                ...(data.DownloadedEpisodes[resolvedSubDub] || []),
                ...scanned
              ])).sort((a, b) => a - b);
            }
          }
        } else {
          const folderPath = path.join(dir, "Anime", AnimeMangaid);

          if (fs.existsSync(folderPath)) {
            const filesAndFolders = await fs.promises.readdir(folderPath, {
              withFileTypes: true,
            });

            data = {
              title: AnimeMangaid.replaceAll("_", ""),
              folder_name: AnimeMangaid,
              id: AnimeMangaid,
              type: "Anime",
              provider: "local source",
              DownloadedEpisodes: {
                sub: [],
                dub: [],
              },
            };

            data.DownloadedEpisodes["sub"] = filesAndFolders
              .filter((file) => file.isFile())
              .map((file) => getEpisodeNumberFromFilename(file.name))
              .filter((num) => num !== null && !isNaN(num))
              .sort((a, b) => a - b);
          }
        }
      } catch (err) {
        // ignore
      }
    } else {
      try {
        let downloadsList = [];
        let malIdToUse = malid;
        
        const mainRecord = db.prepare("SELECT * FROM Manga WHERE id = ? or folder_name = ?").get(AnimeMangaid, AnimeMangaid);
        if (mainRecord) {
          malIdToUse = mainRecord.MalID || malIdToUse;
        }

        if (malIdToUse) {
          downloadsList = db.prepare("SELECT * FROM Manga WHERE MalID = ?").all(String(malIdToUse));
        }
        if (downloadsList.length === 0 && mainRecord) {
          downloadsList = [mainRecord];
        }

        if (downloadsList.length > 0) {
          const firstRecord = downloadsList[0];
          data = {
            ...firstRecord,
            malid: firstRecord.MalID ? parseInt(firstRecord.MalID) : null,
            CustomTag: firstRecord.CustomTag || "",
            DownloadedChapters: [],
          };

          if (data.malid && global.MalLoggedIn) {
            try {
              let MalInfo = db
                .prepare(`SELECT * FROM MyMangaList WHERE id = ?`)
                .get(String(data.malid));
              if (MalInfo) {
                data = {
                  ...data,
                  totalChapters:
                    MalInfo.totalChapters > 0
                      ? MalInfo.totalChapters
                      : MalInfo.lastChapter
                        ? MalInfo.lastChapter
                        : 0,
                  lastChapter: MalInfo.lastChapter ?? null,
                  watched: MalInfo.read ?? 0,
                  status: MalInfo.status ?? "",
                };
              }
            } catch (err) {
              // ignore
            }
          }

          const uniqueChapters = new Set();
          for (const dRecord of downloadsList) {
            const folderPath = path.join(dir, type, dRecord.folder_name);
            if (fs.existsSync(folderPath)) {
              const filesAndFolders = await fs.promises.readdir(folderPath, {
                withFileTypes: true,
              });

              filesAndFolders
                .filter(
                  (file) =>
                    file.isFile() &&
                    file.name.endsWith(".cbz") &&
                    file.name.toLowerCase().includes("chapter"),
                )
                .map((file) =>
                  parseInt(file.name.toLowerCase().split("chapter")[1]),
                )
                .filter(Boolean)
                .forEach((chNum) => uniqueChapters.add(chNum));
            }
          }
          data.DownloadedChapters = Array.from(uniqueChapters).sort((a, b) => a - b);
        }
      } catch (err) {
        // ignore error
      }
    }

    return data;
  } catch (err) {
    logger.error(`Error Fetching Mapping`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return null;
  }
}

// Map MAL
async function MalEpMap(data = []) {
  try {
    if (!data.length) return true;

    const ids = data.map((entry) => entry.id.toString());

    const existingEntries = db
      .prepare(
        `SELECT * FROM MyAnimeList WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`,
      )
      .all(...ids);

    const existingMap = new Map(
      existingEntries.map((entry) => [entry.id, entry]),
    );

    let NotChanged = false;

    let InsertOrUpdateQuery = db.prepare(`
      INSERT INTO MyAnimeList (id, title, image, totalEpisodes, watched, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        title = excluded.title,
        image = excluded.image,
        totalEpisodes = excluded.totalEpisodes,
        watched = excluded.watched,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    db.exec("BEGIN");
    try {
      for (const entry of data) {
        const existing = existingMap.get(entry.id.toString());

        if (
          existing &&
          existing.title === entry.title &&
          existing.image === entry.image &&
          existing.totalEpisodes === parseInt(entry.totalEpisodes ?? 0) &&
          existing.watched === parseInt(entry.watched ?? 0) &&
          existing.status === entry.status &&
          existing.updated_at === entry.updated_at
        ) {
          NotChanged = true;
          continue;
        }

        InsertOrUpdateQuery.run(
          entry.id.toString(),
          entry.title,
          entry.image,
          parseInt(entry.totalEpisodes ?? 0),
          parseInt(entry.watched ?? 0),
          entry.status,
          entry.updated_at,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    return NotChanged;
  } catch (err) {
    logger.error(`Failed To Update MyAnimeList`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return true;
  }
}

// Mal Sort
async function processAndSortMyAnimeList() {
  try {
    let animeList = db
      .prepare(`SELECT * FROM MyAnimeList WHERE status = 'watching'`)
      .all();
    if (animeList.length === 0) return;

    // Sort by updated_at descending (latest first)
    animeList.sort((a, b) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return dateB - dateA;
    });

    let updateQuery = db.prepare(`
      UPDATE MyAnimeList 
      SET sortOrder = ?
      WHERE id = ?
    `);

    db.exec("BEGIN");
    try {
      animeList.forEach((entry, index) => {
        updateQuery.run(index + 1, entry.id);
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    logger.info(`[MyAnimeList] Successfully Sorted!`);
  } catch (err) {
    logger.error(`Error processing MyAnimeList: ${err.message}`);
  }
}

// Mal Retrive Pages
async function MalPage(type = "Anime", provider_name, page = 1) {
  try {
    const isAnime = type === "Anime";
    const tableName = isAnime ? "MyAnimeList" : "MyMangaList";
    const statusVal = isAnime ? "watching" : "reading";

    const limit = 30;
    const offset = (page - 1) * limit;
    let list = db
      .prepare(
        `SELECT * FROM ${tableName} 
       WHERE status = ? 
       AND sortOrder > 0 
       ORDER BY sortOrder 
       LIMIT ? OFFSET ?`,
      )
      .all(statusVal, limit, offset);

    let totalRecords =
      db
        .prepare(
          `SELECT COUNT(*) AS total FROM ${tableName} WHERE status = ?`,
        )
        .get(statusVal)?.total || 0;

    let hasNextPage = offset + limit < totalRecords;
    let totalPages = Math.ceil(totalRecords / limit);

    if (list.length === 0) throw new Error("Empty");

    let malIds = list.map((item) => item.id);

    // Find all linked local entries for these MAL IDs
    let linkedItems = db
      .prepare(
        `SELECT MalID, id, provider FROM ${type} WHERE MalID IN (${malIds
          .map(() => "?")
          .join(",")})`,
      )
      .all(...malIds.map(String));

    // Get all ids from linkedItems and look up recent activity in history to determine last used
    const linkedIds = linkedItems.map(m => m.id);
    let recentHistoryMap = {};
    if (linkedIds.length > 0) {
      const historyTable = isAnime ? "WatchHistory" : "ReadHistory";
      const idCol = isAnime ? "anime_id" : "manga_id";
      const dateCol = isAnime ? "last_watched" : "last_read";

      let queryIds = [];
      linkedIds.forEach(id => {
        queryIds.push(id);
        if (isAnime) {
          const stripped = id.replace(/-(dub|sub|both)$/, "");
          queryIds.push(`${stripped}-sub`, `${stripped}-dub`, `${stripped}-both`);
        }
      });

      const placeholders = queryIds.map(() => "?").join(",");
      try {
        const historyRows = db.prepare(`
          SELECT ${idCol}, MAX(${dateCol}) as max_date 
          FROM ${historyTable} 
          WHERE ${idCol} IN (${placeholders}) 
          GROUP BY ${idCol}
        `).all(...queryIds);
        
        historyRows.forEach(row => {
          recentHistoryMap[row[idCol]] = new Date(row.max_date).getTime();
        });
      } catch (historyErr) {
        logger.error(`Error querying recent history in MalPage: ${historyErr.message}`);
      }
    }

    let filteredList = list.map((item) => {
      // Find matches for this MAL ID
      let matches = linkedItems.filter(
        (linked) => String(linked.MalID) === String(item.id),
      );

      // Find the last used match among matches by checking history activity
      let lastUsedMatch = null;
      let maxTime = -1;
      matches.forEach(m => {
        let t = -1;
        const possibleKeys = [m.id];
        if (isAnime) {
          const stripped = m.id.replace(/-(dub|sub|both)$/, "");
          possibleKeys.push(`${stripped}-sub`, `${stripped}-dub`, `${stripped}-both`);
        }
        possibleKeys.forEach(k => {
          if (recentHistoryMap[k] && recentHistoryMap[k] > t) {
            t = recentHistoryMap[k];
          }
        });
        if (t > maxTime) {
          maxTime = t;
          lastUsedMatch = m;
        }
      });

      // Prefer lastUsedMatch, fallback to matching provider, fallback to matches[0]
      let linked =
        lastUsedMatch ||
        matches.find((m) => m.provider === provider_name) ||
        matches[0];

      if (linked) {
        return {
          ...item,
          MalID: item.id,
          id: linked.id,
          provider: linked.provider,
          linked: true,
          allMatches: matches.map(m => ({ id: m.id, provider: m.provider })),
        };
      } else {
        return {
          ...item,
          MalID: item.id,
          id: `unlinked-${item.id}`,
          provider: provider_name,
          linked: false,
          allMatches: [],
        };
      }
    });

    return {
      totalPages,
      currentPage: page,
      hasNextPage,
      totalItems: totalRecords,
      results: filteredList,
    };
  } catch (err) {
    return {
      totalPages: 0,
      currentPage: page,
      hasNextPage: false,
      totalItems: 0,
      results: [],
    };
  }
}

// Map MAL Manga
async function MalMangaMap(data = []) {
  try {
    if (!data.length) return true;

    const ids = data.map((entry) => entry.id.toString());

    const existingEntries = db
      .prepare(
        `SELECT * FROM MyMangaList WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`,
      )
      .all(...ids);

    const existingMap = new Map(
      existingEntries.map((entry) => [entry.id, entry]),
    );

    let NotChanged = false;

    let InsertOrUpdateQuery = db.prepare(`
      INSERT INTO MyMangaList (id, title, image, totalChapters, read, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        title = excluded.title,
        image = excluded.image,
        totalChapters = excluded.totalChapters,
        read = excluded.read,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    db.exec("BEGIN");
    try {
      for (const entry of data) {
        const existing = existingMap.get(entry.id.toString());

        if (
          existing &&
          existing.title === entry.title &&
          existing.image === entry.image &&
          existing.totalChapters === parseInt(entry.totalChapters ?? 0) &&
          existing.read === parseInt(entry.read ?? 0) &&
          existing.status === entry.status &&
          existing.updated_at === entry.updated_at
        ) {
          NotChanged = true;
          continue;
        }

        InsertOrUpdateQuery.run(
          entry.id.toString(),
          entry.title,
          entry.image,
          parseInt(entry.totalChapters ?? 0),
          parseInt(entry.read ?? 0),
          entry.status,
          entry.updated_at,
        );
      }
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    return NotChanged;
  } catch (err) {
    logger.error(`Failed To Update MyMangaList`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return true;
  }
}

// Manga Sort
async function processAndSortMyMangaList() {
  try {
    let mangaList = db
      .prepare(`SELECT * FROM MyMangaList WHERE status = 'reading'`)
      .all();
    if (mangaList.length === 0) return;

    // Sort by updated_at descending (latest first)
    mangaList.sort((a, b) => {
      const dateA = a.updated_at ? new Date(a.updated_at).getTime() : 0;
      const dateB = b.updated_at ? new Date(b.updated_at).getTime() : 0;
      return dateB - dateA;
    });

    let updateQuery = db.prepare(`
      UPDATE MyMangaList 
      SET sortOrder = ?
      WHERE id = ?
    `);

    db.exec("BEGIN");
    try {
      mangaList.forEach((entry, index) => {
        updateQuery.run(index + 1, entry.id);
      });
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }

    logger.info(`[MyMangaList] Successfully Sorted!`);
  } catch (err) {
    logger.error(`Error processing MyMangaList: ${err.message}`);
  }
}

module.exports = {
  MetadataAdd,
  MetadataRemove,
  getAllMetadata,
  getSourceById,
  FindMapping,
  MalEpMap,
  processAndSortMyAnimeList,
  MalPage,
  FetchLocalProviderInfo,
  MalMangaMap,
  processAndSortMyMangaList,
  db,
};
