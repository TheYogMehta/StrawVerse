// libs
const { logger } = require("./AppLogger");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const { tables, exec, queryAll, queryOne, run } = require("./db");
const { getHeaders } = require("./proxyHeaders");
const ImageCacheManager = require("./ImageCacheManager");

const VIDEO_EXTENSIONS = [
  ".mp4",
  ".mkv",
  ".webm",
  ".ts",
  ".avi",
  ".mov",
  ".flv",
  ".m4v",
  ".3gp",
];

function sanitizeImage(imageVal) {
  if (!imageVal) return null;
  if (typeof imageVal === "string") {
    return imageVal;
  }
  if (Buffer.isBuffer(imageVal) || imageVal instanceof Uint8Array) {
    const str = Buffer.from(imageVal).toString("utf-8");
    if (str.startsWith("data:image/") || str.startsWith("http")) {
      return str;
    }
    return `data:image/png;base64,${Buffer.from(imageVal).toString("base64")}`;
  }
  return null;
}

function formatFallbackTitle(str) {
  if (!str) return "Untitled";
  return str
    .replace(/-(sub|dub|both)$/i, "")
    .replace(/[^a-zA-Z0-9]/g, " ")
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ")
    .trim();
}

function cleanStringForMatching(s) {
  if (!s) return "";
  return s
    .toLowerCase()
    .replace(/\s+(sub|dub|both|sub\/dub)$/i, "")
    .replace(/-(sub|dub|both)$/i, "")
    .replace(/-[a-z0-9]{5}$/i, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

  if (!valuesToAdd.MalID || valuesToAdd.MalID === "") {
    const cleanId = valuesToAdd.id.replace(/-(dub|sub|both)$/, "");
    try {
      const customMappingRow = global.db
        .prepare("SELECT malid FROM unlinked_mal_ids WHERE id = ?")
        .get(cleanId);

      if (customMappingRow !== undefined) {
        valuesToAdd.MalID = customMappingRow.malid
          ? String(customMappingRow.malid)
          : null;
      } else if (type === "Anime" && global.mappingDb && cleanId) {
        const providerName = (valuesToAdd.provider || "").toLowerCase();
        let match = null;
        if (providerName.includes("pahe")) {
          match = global.mappingDb
            .prepare(
              "SELECT malid FROM animepahe WHERE id = ? OR uuid = ? LIMIT 1",
            )
            .get(cleanId, cleanId);
        } else if (providerName.includes("anikoto")) {
          match = global.mappingDb
            .prepare("SELECT malid FROM anikototv WHERE id = ? LIMIT 1")
            .get(cleanId);
        }
        if (match?.malid) {
          valuesToAdd.MalID = String(match.malid);
        }
      }
    } catch (e) {
      logger.error(`Error resolving MalID in MetadataAdd: ${e.message}`);
    }
  }

  let existingRecord = global.db
    .prepare(`SELECT * FROM ${type} WHERE id = ?`)
    .get(valuesToAdd?.id);

  if (!existingRecord) {
    if (valuesToAdd?.ImageUrl) {
      let Imageurl = valuesToAdd?.ImageUrl?.trim();
      valuesToAdd.image_url = Imageurl;
      if (Imageurl.startsWith("data:image/")) {
        try {
          const match = Imageurl.match(
            /^data:image\/([a-zA-Z+]+);base64,(.+)$/,
          );
          if (match) {
            const buffer = Buffer.from(match[2], "base64");
            await ImageCacheManager.cacheImage(Imageurl, buffer);
          }
        } catch (e) {
          logger.error(`Failed to cache data URI in MetadataAdd: ${e.message}`);
        }
        valuesToAdd.image = null;
      } else {
        if (Imageurl.includes("/api/image?url=")) {
          Imageurl = Imageurl.split("/api/image?url=")[1];
        }
        try {
          const client = global.axios || axios;
          const headersObj = getHeaders(Imageurl);
          const requestHeaders = {};
          if (headersObj.Referer)
            requestHeaders["Referer"] = headersObj.Referer;
          if (headersObj["User-Agent"])
            requestHeaders["User-Agent"] = headersObj["User-Agent"];
          if (headersObj.Cookie) requestHeaders["Cookie"] = headersObj.Cookie;

          const response = await client.get(Imageurl, {
            headers: requestHeaders,
            responseType: "arraybuffer",
          });

          await ImageCacheManager.cacheImage(
            Imageurl,
            Buffer.from(response.data),
          );
          valuesToAdd.image = null;
        } catch (err) {
          logger.error(`Failed to fetch and cache image from: ${Imageurl}`);
          logger.error(`Error message: ${err.message}`);
          logger.error(`Stack trace: ${err.stack}`);
          valuesToAdd.image = null;
        }
      }
    }

    if (valuesToAdd?.title) {
      const baseFolderName = valuesToAdd.title.replace(/[^a-zA-Z0-9]/g, "_");
      let existingByFolder = null;
      try {
        existingByFolder = global.db
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

    if (!valuesToAdd.hasOwnProperty("CustomTag")) {
      valuesToAdd.CustomTag = JSON.stringify(["Downloads"]);
    }

    try {
      const validColumns = Object.keys(tables[type]);
      const filteredValues = {};

      validColumns.forEach((column) => {
        if (
          valuesToAdd.hasOwnProperty(column) &&
          valuesToAdd[column] !== undefined
        ) {
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

      global.db
        .prepare(`INSERT INTO ${type} (${fields}) VALUES (${placeholders})`)
        .run(...values);
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
      global.db
        .prepare(
          `UPDATE ${type} SET CustomTag = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(defaultTag, existingRecord.id);
    }

    if (!existingRecord.MalID || existingRecord.MalID === "") {
      let malIdToUpdate = valuesToAdd?.MalID;
      if (!malIdToUpdate && existingRecord.title) {
        try {
          const baseTitle = existingRecord.title.replace(
            /\s+(sub|dub|both)$/i,
            "",
          );
          const match = global.db
            .prepare(
              `SELECT MalID FROM ${type} WHERE (title LIKE ? OR folder_name LIKE ?) AND MalID IS NOT NULL AND MalID != '' LIMIT 1`,
            )
            .get(`%${baseTitle}%`, `%${baseTitle}%`);
          if (match?.MalID) {
            malIdToUpdate = match.MalID;
          }
        } catch (_) {}
      }
      if (malIdToUpdate) {
        global.db
          .prepare(
            `UPDATE ${type} SET MalID = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          )
          .run(String(malIdToUpdate), existingRecord.id);
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
    const row = global.db
      .prepare(`SELECT image_url FROM ${type} WHERE id = ? OR folder_name = ?`)
      .get(id, id);

    if (row && row.image_url) {
      const imageUrl = row.image_url;
      const countAnime =
        global.db
          .prepare("SELECT COUNT(*) as count FROM Anime WHERE image_url = ?")
          .get(imageUrl)?.count || 0;
      const countManga =
        global.db
          .prepare("SELECT COUNT(*) as count FROM Manga WHERE image_url = ?")
          .get(imageUrl)?.count || 0;
      if (countAnime + countManga <= 1) {
        ImageCacheManager.removeCachedImage(imageUrl).catch((err) => {
          logger.error(`Error in removeCachedImage: ${err.message}`);
        });
      }
    }

    global.db
      .prepare(`DELETE FROM ${type} WHERE id = ? OR folder_name = ?`)
      .run(id, id);
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
        storedMetadata = global.db
          .prepare(
            `SELECT * FROM ${type} WHERE CustomTag = ? OR CustomTag LIKE ? ORDER BY last_updated DESC`,
          )
          .all(tag, likeTag);
      } else {
        storedMetadata = global.db
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
        run(`DELETE FROM ${type} WHERE folder_name = ?`, [folder]);
      }
    });

    try {
      if (tag && tag !== "All" && tag !== "") {
        const likeTag = `%"${tag}"%`;
        storedMetadata = global.db
          .prepare(
            `SELECT * FROM ${type} WHERE CustomTag = ? OR CustomTag LIKE ? ORDER BY last_updated DESC`,
          )
          .all(tag, likeTag);
      } else {
        storedMetadata = global.db
          .prepare(`SELECT * FROM ${type} ORDER BY last_updated DESC`)
          .all();
      }
    } catch (err) {
      storedMetadata = [];
    }

    storedMetadata.forEach((entry) => {
      if (!entry.title || entry.title.trim() === "") {
        if (entry.folder_name) {
          entry.title = formatFallbackTitle(entry.folder_name);
        } else if (entry.id) {
          entry.title = formatFallbackTitle(entry.id);
        } else {
          entry.title = "Untitled";
        }
      }
      entry.image = sanitizeImage(entry.image) || entry.image_url || null;
    });

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

    storedMetadata.forEach((entry) => {
      if (entry.title) {
        entry.title = entry.title
          .replace(/\s+sub$/i, "")
          .replace(/\s+dub$/i, "")
          .replace(/\s+both$/i, "")
          .replace(/\s+sub\/dub$/i, "");
      }
    });

    // Filter out pure backend links (no local folders and no custom tags)
    storedMetadata = storedMetadata.filter((entry) => {
      const folderExists = entry.folder_name
        ? folderSet.has(entry.folder_name)
        : false;
      const hasTags =
        entry.CustomTag && entry.CustomTag !== "" && entry.CustomTag !== "[]";
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

      let bestTitle = mainEntry.title;

      try {
        const malRow = global.db
          .prepare("SELECT title FROM MyAnimeList WHERE id = ?")
          .get(String(malId));
        if (malRow && malRow.title) {
          bestTitle = malRow.title;
        }
      } catch (e) {}

      if (bestTitle === mainEntry.title) {
        const cleanedFolderNames = group
          .map((g) => cleanStringForMatching(g.folder_name || g.id))
          .filter(Boolean);

        const matchingEntry = group.find((g) => {
          if (!g.title) return false;
          const cleanedTitle = cleanStringForMatching(g.title);
          return cleanedFolderNames.includes(cleanedTitle);
        });

        if (matchingEntry) {
          bestTitle = matchingEntry.title;
        } else {
          for (const folderName of cleanedFolderNames) {
            const match = group.find((g) => {
              if (!g.title) return false;
              const cleanedTitle = cleanStringForMatching(g.title);
              return (
                cleanedTitle.includes(folderName) ||
                folderName.includes(cleanedTitle)
              );
            });
            if (match) {
              bestTitle = match.title;
              break;
            }
          }
        }
      }

      if (bestTitle) {
        bestTitle = bestTitle
          .replace(/\s+sub$/i, "")
          .replace(/\s+dub$/i, "")
          .replace(/\s+both$/i, "")
          .replace(/\s+sub\/dub$/i, "");
      }

      mainEntry.title = bestTitle;

      mainEntry.linkedProviders = group.map((g) => ({
        id: g.id,
        provider: g.provider,
        CustomTag: g.CustomTag,
        title: g.title,
        folder_name: g.folder_name,
      }));

      groupedMetadata.push(mainEntry);
    });

    const malMap = {};
    try {
      const tableName = type === "Anime" ? "MyAnimeList" : "MyMangaList";
      const columns =
        type === "Anime"
          ? "id, totalEpisodes, watched, status"
          : "id, totalChapters as totalEpisodes, read as watched, status";
      const malRows = global.db
        .prepare(`SELECT ${columns} FROM ${tableName}`)
        .all();
      malRows.forEach((r) => {
        malMap[String(r.id)] = {
          totalEpisodes: r.totalEpisodes || 0,
          watched: r.watched || 0,
          status: r.status || "",
        };
      });
    } catch (e) {}

    const siblingsMap = {};
    if (type === "Anime") {
      try {
        const animeRows = global.db
          .prepare(
            "SELECT id, MalID FROM Anime WHERE MalID IS NOT NULL AND MalID != ''",
          )
          .all();
        animeRows.forEach((r) => {
          if (!siblingsMap[r.MalID]) {
            siblingsMap[r.MalID] = [];
          }
          siblingsMap[r.MalID].push(r.id);
        });
      } catch (e) {}
    }

    const watchMap = {};
    if (type === "Anime") {
      try {
        const watchRows = global.db
          .prepare(
            `
          SELECT anime_id, COUNT(DISTINCT episode_number) as count 
          FROM WatchHistory 
          WHERE is_completed = 1 
          GROUP BY anime_id
        `,
          )
          .all();
        watchRows.forEach((r) => {
          watchMap[r.anime_id] = r.count;
        });
      } catch (e) {}
    }

    const mappingMap = {};
    if (type === "Anime") {
      try {
        const mappingRows = global.mappingDb
          .prepare("SELECT malid, livechart_id FROM anime")
          .all();
        mappingRows.forEach((r) => {
          mappingMap[Number(r.malid)] = r.livechart_id;
        });
      } catch (e) {}
    }

    const upcomingMap = {};
    const maxAiredMap = {};
    if (type === "Anime") {
      try {
        const now = Math.floor(Date.now() / 1000);
        const upcomingRows = global.db
          .prepare(
            `
          SELECT livechart_id, episode, date 
          FROM next_episodes 
          WHERE date > ?
        `,
          )
          .all(now);
        upcomingRows.forEach((r) => {
          if (
            !upcomingMap[r.livechart_id] ||
            upcomingMap[r.livechart_id].date > r.date
          ) {
            upcomingMap[r.livechart_id] = { episode: r.episode, date: r.date };
          }
        });

        const maxAiredRows = global.db
          .prepare(
            `
          SELECT livechart_id, MAX(episode) as max_aired 
          FROM next_episodes 
          WHERE date <= ? 
          GROUP BY livechart_id
        `,
          )
          .all(now);
        maxAiredRows.forEach((r) => {
          maxAiredMap[r.livechart_id] = r.max_aired;
        });
      } catch (e) {}
    }

    groupedMetadata.forEach((item) => {
      let totalEpisodes = 0;
      let watchedEpisodes = 0;
      let nextEpisodeIn = null;
      let maxAired = null;
      let malStatus = "";

      if (item.MalID && malMap[String(item.MalID)]) {
        const malInfo = malMap[String(item.MalID)];
        totalEpisodes = malInfo.totalEpisodes;
        watchedEpisodes = malInfo.watched;
        malStatus = malInfo.status;
      }

      if (type === "Anime") {
        const animeIds = Array.from(
          new Set([item.id, ...(siblingsMap[item.MalID] || [])]),
        );

        let localWatched = 0;
        animeIds.forEach((animeId) => {
          if (watchMap[animeId]) {
            localWatched = Math.max(localWatched, watchMap[animeId]);
          }
        });
        watchedEpisodes = Math.max(watchedEpisodes, localWatched);

        if (item.MalID && mappingMap[Number(item.MalID)]) {
          const livechartId = mappingMap[Number(item.MalID)];

          if (maxAiredMap[livechartId] !== undefined) {
            maxAired = maxAiredMap[livechartId];
          }

          if (upcomingMap[livechartId]) {
            const nextEp = upcomingMap[livechartId];
            if (watchedEpisodes >= nextEp.episode - 1) {
              const now = Math.floor(Date.now() / 1000);
              const diff = nextEp.date - now;
              const minutes = Math.ceil(diff / 60);
              const hours = Math.ceil(diff / 3600);
              const days = Math.ceil(diff / (24 * 3600));

              if (days > 0) {
                nextEpisodeIn = `Ep ${nextEp.episode}: ${days} day${days > 1 ? "s" : ""}`;
              } else if (hours > 0) {
                nextEpisodeIn = `Ep ${nextEp.episode}: ${hours} hr${hours > 1 ? "s" : ""}`;
              } else if (minutes > 0) {
                nextEpisodeIn = `Ep ${nextEp.episode}: ${minutes} min${minutes > 1 ? "s" : ""}`;
              } else {
                nextEpisodeIn = `Ep ${nextEp.episode}: soon`;
              }
            }
          }
        }
      }

      const isCompleted =
        malStatus === "completed" ||
        (totalEpisodes > 0 && watchedEpisodes >= totalEpisodes);

      let sortWeight = 30; // Default: Plan to Watch / Not Started (watched === 0)

      if (isCompleted && nextEpisodeIn === null) {
        sortWeight = 50; // Fully Completed (move to bottom)
      } else if (nextEpisodeIn !== null) {
        sortWeight = 40; // Caught up / Completed but waiting for next release (nothing to watch right now)
      } else if (watchedEpisodes > 0) {
        if (
          type === "Anime" &&
          maxAired !== null &&
          watchedEpisodes < maxAired
        ) {
          sortWeight = 10; // Watching with new aired episodes (priority 1)
        } else {
          sortWeight = 20; // Active Watching - behind or no schedule info
        }
      }

      item.sortWeight = sortWeight;
      item.watched = watchedEpisodes;
      item.totalEpisodes = totalEpisodes;
      item.nextEpisodeIn = nextEpisodeIn;
    });

    // Sort storedMetadata by weight groups, watched progress, and finally recency
    groupedMetadata.sort((a, b) => {
      if (a.sortWeight !== b.sortWeight) {
        return a.sortWeight - b.sortWeight;
      }
      if (
        a.sortWeight === 10 ||
        a.sortWeight === 20 ||
        a.sortWeight === 30 ||
        a.sortWeight === 40
      ) {
        if (b.watched !== a.watched) {
          return b.watched - a.watched;
        }
      }
      const timeA = a.last_updated ? new Date(a.last_updated).getTime() : 0;
      const timeB = b.last_updated ? new Date(b.last_updated).getTime() : 0;
      return timeB - timeA;
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
        run(`DELETE FROM ${type} WHERE id = ?`, [metadata.id]);
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

      let totalEpisodes = metadata.totalEpisodes || 0;
      let watchedEpisodes = metadata.watched || 0;
      let nextEpisodeIn = metadata.nextEpisodeIn || null;

      updatedMetadata.push({
        ...metadata,
        Downloaded: content,
        totalEpisodes: totalEpisodes,
        watched: watchedEpisodes,
        nextEpisodeIn: nextEpisodeIn,
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
    const metadata = queryOne(`SELECT * FROM ${type} WHERE id = ?`, [id]);
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
    const metadata = queryOne(`SELECT * FROM ${type} WHERE id = ?`, [id]);
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
        const linked = queryAll(
          `SELECT folder_name, subOrDub FROM ${type} WHERE MalID = ?`,
          [String(malId)],
        );

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
          const isSub =
            file.endsWith(".srt") ||
            file.endsWith(".vtt") ||
            file.endsWith(".ass");
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
        const searchTerms = Array.from(
          new Set([`${id}-sub`, `${id}-dub`, `${id}-both`, AnimeMangaid, id]),
        ).filter(Boolean);

        const placeholders = searchTerms.map(() => "?").join(",");
        const FoundRow = queryOne(
          `SELECT MalID, CustomTag FROM Anime WHERE id IN (${placeholders}) OR folder_name IN (${placeholders}) LIMIT 1`,
          [...searchTerms, ...searchTerms],
        );

        data.CustomTag = FoundRow?.CustomTag || "";

        if (!malid) {
          data.malid = FoundRow?.MalID ? parseInt(FoundRow.MalID) : null;
        } else {
          data.malid = malid;
        }

        // if mal id find in list if it exists
        if (data.malid && global.MalLoggedIn) {
          let MalInfo = queryOne(`SELECT * FROM MyAnimeList WHERE id = ?`, [
            String(data.malid),
          ]);

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
          Downloads = queryAll("SELECT * FROM Anime WHERE MalID = ?", [
            String(data.malid),
          ]);
        }
        if (Downloads.length === 0) {
          const searchTerms = Array.from(
            new Set([`${id}-sub`, `${id}-dub`, `${id}-both`, AnimeMangaid, id]),
          ).filter(Boolean);

          const placeholders = searchTerms.map(() => "?").join(",");
          Downloads = queryAll(
            `SELECT * FROM Anime WHERE id IN (${placeholders}) OR folder_name IN (${placeholders})`,
            [...searchTerms, ...searchTerms],
          );
        }

        if (Downloads?.length > 0) {
          Downloads[0].dataId = Downloads[0]?.EpisodesDataId;
          delete Downloads[0].EpisodesDataId;

          const baseImage =
            sanitizeImage(Downloads[0].image) || Downloads[0].image_url || null;
          const baseTitle =
            Downloads[0].title && Downloads[0].title.trim() !== ""
              ? Downloads[0].title
              : formatFallbackTitle(
                  Downloads[0].folder_name || Downloads[0].id,
                );

          data = {
            ...Downloads[0],
            title: baseTitle,
            image: baseImage,
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
              SubDub.folder_name ||
                `${SubDub.title?.replace(/[^a-zA-Z0-9]/g, "_")}`,
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

              data.DownloadedEpisodes[resolvedSubDub] = Array.from(
                new Set([
                  ...(data.DownloadedEpisodes[resolvedSubDub] || []),
                  ...scanned,
                ]),
              ).sort((a, b) => a - b);
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

        const mainRecord = queryOne(
          "SELECT * FROM Manga WHERE id = ? or folder_name = ?",
          [AnimeMangaid, AnimeMangaid],
        );
        if (mainRecord) {
          malIdToUse = mainRecord.MalID || malIdToUse;
        }

        if (malIdToUse) {
          downloadsList = queryAll("SELECT * FROM Manga WHERE MalID = ?", [
            String(malIdToUse),
          ]);
        }
        if (downloadsList.length === 0 && mainRecord) {
          downloadsList = [mainRecord];
        }

        if (downloadsList.length > 0) {
          const firstRecord = downloadsList[0];
          const baseImage =
            sanitizeImage(firstRecord.image) || firstRecord.image_url || null;
          const baseTitle =
            firstRecord.title && firstRecord.title.trim() !== ""
              ? firstRecord.title
              : formatFallbackTitle(firstRecord.folder_name || firstRecord.id);

          data = {
            ...firstRecord,
            title: baseTitle,
            image: baseImage,
            malid: firstRecord.MalID ? parseInt(firstRecord.MalID) : null,
            CustomTag: firstRecord.CustomTag || "",
            DownloadedChapters: [],
          };

          if (data.malid && global.MalLoggedIn) {
            try {
              let MalInfo = queryOne(`SELECT * FROM MyMangaList WHERE id = ?`, [
                String(data.malid),
              ]);
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
          data.DownloadedChapters = Array.from(uniqueChapters).sort(
            (a, b) => a - b,
          );
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

    const existingEntries = queryAll(
      `SELECT * FROM MyAnimeList WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );

    const existingMap = new Map(
      existingEntries.map((entry) => [entry.id, entry]),
    );

    let NotChanged = false;

    let InsertOrUpdateQuery = global.db.prepare(`
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

    global.db.exec("BEGIN");
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
      global.db.exec("COMMIT");
    } catch (e) {
      global.db.exec("ROLLBACK");
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

// Map MAL Manga
async function MalMangaMap(data = []) {
  try {
    if (!data.length) return true;

    const ids = data.map((entry) => entry.id.toString());

    const existingEntries = global.db
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

    let InsertOrUpdateQuery = global.db.prepare(`
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
      global.db.exec("COMMIT");
    } catch (e) {
      global.db.exec("ROLLBACK");
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

module.exports = {
  MetadataAdd,
  MetadataRemove,
  getAllMetadata,
  getSourceById,
  FindMapping,
  MalEpMap,
  FetchLocalProviderInfo,
  MalMangaMap,
  sanitizeImage,
  formatFallbackTitle,
};
