// libs
const { logger } = require("./AppLogger");
const axios = require("axios");
const path = require("path");
const fs = require("fs");
const child_process = require("child_process");
const { getFfmpegPath } = require("./downloader");
const {
  tables,
  exec,
  queryAll,
  queryOne,
  run,
  batchRun,
  mappingQueryOne,
  mappingQueryAll,
} = require("./db");
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

function formatFallbackTitle(str) {
  if (!str) return "Untitled";
  return str
    .replace(/-(sub|dub|hsub|both)$/i, "")
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
    .replace(/\s+(sub|dub|hsub|both|sub\/dub)$/i, "")
    .replace(/-(sub|dub|hsub|both)$/i, "")
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

async function getMalIdFromMapping(type, providerName, cleanId) {
  if (!cleanId) return null;
  const name = (providerName || "").toLowerCase();
  try {
    let row = null;
    if (type === "Anime") {
      if (name.includes("pahe")) {
        row = await mappingQueryOne(
          "SELECT malid FROM animepahe WHERE id = ? OR uuid = ? LIMIT 1",
          [cleanId, cleanId],
        );
      } else if (name.includes("anikoto")) {
        row = await mappingQueryOne(
          "SELECT malid FROM anikototv WHERE id = ? LIMIT 1",
          [cleanId],
        );
      } else if (name.includes("anineko")) {
        row = await mappingQueryOne(
          "SELECT malid FROM anineko WHERE id = ? LIMIT 1",
          [cleanId],
        );
      }
    } else if (type === "Manga") {
      if (name.includes("weebcentral")) {
        row = await mappingQueryOne(
          "SELECT malid FROM weebcentral WHERE id = ? LIMIT 1",
          [cleanId],
        );
      } else if (name.includes("allmanga")) {
        row = await mappingQueryOne(
          "SELECT malid FROM allmanga WHERE id = ? LIMIT 1",
          [cleanId],
        );
      }
    }
    return row?.malid || null;
  } catch (e) {
    logger.error(`Error in getMalIdFromMapping: ${e.message}`);
    return null;
  }
}

// Add metadata
async function MetadataAdd(type, valuesToAdd) {
  if (!tables[type] || !valuesToAdd?.id) {
    throw new Error(`Invalid args!`);
  }

  if (!valuesToAdd.MalID || valuesToAdd.MalID === "") {
    const cleanId = valuesToAdd.id.replace(/-(dub|sub|hsub|both)$/, "");
    try {
      const customMappingRow = await queryOne(
        "SELECT malid FROM unlinked_mal_ids WHERE id = ?",
        [cleanId],
      );

      if (customMappingRow) {
        valuesToAdd.MalID = customMappingRow.malid
          ? String(customMappingRow.malid)
          : null;
      } else {
        const malId = await getMalIdFromMapping(
          type,
          valuesToAdd.provider,
          cleanId,
        );
        if (malId) {
          valuesToAdd.MalID = String(malId);
        }
      }
    } catch (e) {
      logger.error(`Error resolving MalID in MetadataAdd: ${e.message}`);
    }
  }

  let existingRecord = await queryOne(`SELECT * FROM ${type} WHERE id = ?`, [
    valuesToAdd?.id,
  ]);

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
          Imageurl = decodeURIComponent(Imageurl.split("/api/image?url=")[1]);
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
      valuesToAdd.folder_name = baseFolderName;
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

      await run(
        `INSERT INTO ${type} (${fields}) VALUES (${placeholders})`,
        values,
      );
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
      await run(
        `UPDATE ${type} SET CustomTag = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        [defaultTag, existingRecord.id],
      );
    }

    if (!existingRecord.MalID || existingRecord.MalID === "") {
      let malIdToUpdate = valuesToAdd?.MalID;
      if (!malIdToUpdate && existingRecord.title) {
        try {
          const baseTitle = existingRecord.title.replace(
            /\s+(sub|dub|both)$/i,
            "",
          );
          const match = await queryOne(
            `SELECT MalID FROM ${type} WHERE (title LIKE ? OR folder_name LIKE ?) AND MalID IS NOT NULL AND MalID != '' LIMIT 1`,
            [`%${baseTitle}%`, `%${baseTitle}%`],
          );
          if (match?.MalID) {
            malIdToUpdate = match.MalID;
          }
        } catch (_) {}
      }
      if (malIdToUpdate) {
        await run(
          `UPDATE ${type} SET MalID = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          [String(malIdToUpdate), existingRecord.id],
        );
      }
    }
  }
}

// Remove metadata
async function MetadataRemove(type, id) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }
  try {
    const row = await queryOne(
      `SELECT image_url FROM ${type} WHERE id = ? OR folder_name = ?`,
      [id, id],
    );

    if (row && row.image_url) {
      const imageUrl = row.image_url;
      const countAnime =
        (await queryOne(
          "SELECT COUNT(*) as count FROM Anime WHERE image_url = ?",
          [imageUrl],
        )?.count) || 0;
      const countManga =
        (await queryOne(
          "SELECT COUNT(*) as count FROM Manga WHERE image_url = ?",
          [imageUrl],
        )?.count) || 0;
      if (countAnime + countManga <= 1) {
        ImageCacheManager.removeCachedImage(imageUrl).catch((err) => {
          logger.error(`Error in removeCachedImage: ${err.message}`);
        });
      }
    }

    await run(`DELETE FROM ${type} WHERE id = ? OR folder_name = ?`, [id, id]);
  } catch (error) {
    throw new Error(`Error deleting from ${type}: ${error.message}`);
  }
}

function resolveLocalFolder(metadata, folderSet, type) {
  let resolvedFolder = metadata.folder_name || "";
  if (resolvedFolder && folderSet.has(resolvedFolder)) {
    return resolvedFolder;
  }
  if (resolvedFolder) {
    const suffixes = ["_sub", "_dub", "_hsub"];
    for (const suffix of suffixes) {
      const checkFolder = `${resolvedFolder}${suffix}`;
      if (folderSet.has(checkFolder)) {
        return checkFolder;
      }
    }
  }

  if (metadata.title) {
    const baseName = metadata.title.replace(/[^a-zA-Z0-9]/g, "_");
    const nameCandidates = [
      baseName,
      `${baseName}_sub`,
      `${baseName}_dub`,
      `${baseName}_hsub`,
    ];
    for (const cand of nameCandidates) {
      if (folderSet.has(cand)) {
        return cand;
      }
    }
  }

  if (metadata.linkedProviders) {
    for (const lp of metadata.linkedProviders) {
      const lpName = lp.folder_name || lp.title?.replace(/[^a-zA-Z0-9]/g, "_");
      if (lpName) {
        const lpCandidates = [
          lpName,
          `${lpName}_sub`,
          `${lpName}_dub`,
          `${lpName}_hsub`,
        ];
        for (const cand of lpCandidates) {
          if (folderSet.has(cand)) {
            return cand;
          }
        }
      }
    }
  }

  return null;
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
      if (
        tag &&
        tag !== "All" &&
        tag !== "" &&
        tag.toLowerCase() !== "downloads"
      ) {
        const likeTag = `%"${tag}"%`;
        storedMetadata = await queryAll(
          `SELECT * FROM ${type} WHERE CustomTag = ? OR CustomTag LIKE ? ORDER BY last_updated DESC`,
          [tag, likeTag],
        );
      } else {
        storedMetadata = await queryAll(
          `SELECT * FROM ${type} ORDER BY last_updated DESC`,
        );
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
      .map((entry) => entry.folder_name)
      .filter(Boolean);

    if (missingFolders.length > 0) {
      const placeholders = missingFolders.map(() => "?").join(",");
      run(
        `DELETE FROM ${type} WHERE folder_name IN (${placeholders})`,
        missingFolders,
      );
    }

    try {
      if (
        tag &&
        tag !== "All" &&
        tag !== "" &&
        tag.toLowerCase() !== "downloads"
      ) {
        const likeTag = `%"${tag}"%`;
        storedMetadata = await queryAll(
          `SELECT * FROM ${type} WHERE CustomTag = ? OR CustomTag LIKE ? ORDER BY last_updated DESC`,
          [tag, likeTag],
        );
      } else {
        storedMetadata = await queryAll(
          `SELECT * FROM ${type} ORDER BY last_updated DESC`,
        );
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
      entry.image = entry.image_url || null;
    });

    const storedFolderSet = new Set(storedMetadata.map((m) => m.folder_name));
    folders.forEach((alltitles) => {
      if (storedFolderSet.has(alltitles)) return;

      if (
        tag &&
        tag !== "All" &&
        tag !== "" &&
        tag.toLowerCase() !== "downloads"
      )
        return;

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

    const malMap = {};
    const uniqueMalIds = Array.from(
      new Set(
        storedMetadata
          .map((entry) => entry.MalID)
          .filter((malId) => malId && malId !== ""),
      ),
    );

    if (uniqueMalIds.length > 0) {
      try {
        const tableName = type === "Anime" ? "MyAnimeList" : "MyMangaList";
        const columns =
          type === "Anime"
            ? "id, title, totalEpisodes, watched, status"
            : "id, title, totalChapters as totalEpisodes, read as watched, status";
        const placeholders = uniqueMalIds.map(() => "?").join(",");
        const malRows = await queryAll(
          `SELECT ${columns} FROM ${tableName} WHERE id IN (${placeholders})`,
          uniqueMalIds.map(String),
        );
        malRows.forEach((r) => {
          malMap[String(r.id)] = {
            title: r.title || null,
            totalEpisodes: r.totalEpisodes || 0,
            watched: r.watched || 0,
            status: r.status || "",
          };
        });
      } catch (e) {
        logger.error(`Error fetching malMap for unique MAL IDs: ${e.message}`);
      }
    }

    // Group and merge entries by MalID
    let groupedMetadata = [];
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

      const malInfo = malMap[String(malId)];
      if (malInfo && malInfo.title) {
        bestTitle = malInfo.title;
      }

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

    if (tag && tag.toLowerCase() === "downloads") {
      groupedMetadata = groupedMetadata.filter((item) => {
        let hasDownloadTag = false;
        if (item.CustomTag) {
          try {
            const parsed = JSON.parse(item.CustomTag);
            if (Array.isArray(parsed)) {
              hasDownloadTag = parsed.some(
                (t) => t && t.toLowerCase() === "downloads",
              );
            } else {
              hasDownloadTag = String(parsed).toLowerCase() === "downloads";
            }
          } catch (_) {
            hasDownloadTag = item.CustomTag.toLowerCase().includes("downloads");
          }
        }
        const folder = resolveLocalFolder(item, folderSet, type);
        return hasDownloadTag || !!folder;
      });
    }

    const siblingsMap = {};
    if (type === "Anime") {
      try {
        const animeRows = await queryAll(
          "SELECT id, MalID FROM Anime WHERE MalID IS NOT NULL AND MalID != ''",
        );
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
        const watchRows = await queryAll(`
          SELECT anime_id, COUNT(DISTINCT episode_number) as count 
          FROM WatchHistory 
          WHERE is_completed = 1 
          GROUP BY anime_id
        `);
        watchRows.forEach((r) => {
          const strippedId = r.anime_id.replace(/-(dub|sub|hsub|both)$/, "");
          watchMap[strippedId] = (watchMap[strippedId] || 0) + r.count;
        });
      } catch (e) {}
    }

    const mappingMap = {};
    if (type === "Anime") {
      try {
        const mappingRows = await mappingQueryAll(
          "SELECT malid, livechart_id FROM anime",
        );
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
        const upcomingRows = await mappingQueryAll(
          `
          SELECT livechart_id, episode, date 
          FROM next_episodes 
          WHERE date > ?
        `,
          [now],
        );
        upcomingRows.forEach((r) => {
          if (
            !upcomingMap[r.livechart_id] ||
            upcomingMap[r.livechart_id].date > r.date
          ) {
            upcomingMap[r.livechart_id] = { episode: r.episode, date: r.date };
          }
        });

        const maxAiredRows = await mappingQueryAll(
          `
          SELECT livechart_id, MAX(episode) as max_aired 
          FROM next_episodes 
          WHERE date <= ? 
          GROUP BY livechart_id
        `,
          [now],
        );
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

    const updatedMetadata = await Promise.all(
      paginatedMetadata.map(async (metadata) => {
        let resolvedFolder = metadata.folder_name || "";
        let folderExists = false;

        if (resolvedFolder) {
          try {
            await fs.promises.access(path.join(baseDir, type, resolvedFolder));
            folderExists = true;
          } catch (_) {
            const suffixes = ["_sub", "_dub", "_hsub"];
            for (const suffix of suffixes) {
              try {
                const checkFolder = `${resolvedFolder}${suffix}`;
                await fs.promises.access(path.join(baseDir, type, checkFolder));
                resolvedFolder = checkFolder;
                folderExists = true;
                break;
              } catch (_) {}
            }
          }
        }

        if (!folderExists && metadata.title) {
          const baseName = metadata.title.replace(/[^a-zA-Z0-9]/g, "_");
          const nameCandidates = [
            baseName,
            `${baseName}_sub`,
            `${baseName}_dub`,
            `${baseName}_hsub`,
          ];
          for (const cand of nameCandidates) {
            try {
              await fs.promises.access(path.join(baseDir, type, cand));
              resolvedFolder = cand;
              folderExists = true;
              break;
            } catch (_) {}
          }
        }

        if (!folderExists && metadata.linkedProviders) {
          for (const lp of metadata.linkedProviders) {
            const lpName =
              lp.folder_name || lp.title?.replace(/[^a-zA-Z0-9]/g, "_");
            if (lpName) {
              const lpCandidates = [
                lpName,
                `${lpName}_sub`,
                `${lpName}_dub`,
                `${lpName}_hsub`,
              ];
              for (const cand of lpCandidates) {
                try {
                  await fs.promises.access(path.join(baseDir, type, cand));
                  resolvedFolder = cand;
                  folderExists = true;
                  break;
                } catch (_) {}
              }
            }
            if (folderExists) break;
          }
        }

        const folderPath = path.join(baseDir, type, resolvedFolder);

        if (
          !folderExists &&
          (!metadata.CustomTag || metadata.CustomTag === "") &&
          (!metadata.MalID || metadata.MalID === "")
        ) {
          run(`DELETE FROM ${type} WHERE id = ?`, [metadata.id]);
          return null;
        }

        let content = [];
        if (folderExists) {
          try {
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
          } catch (readdirErr) {
            logger.error(
              `Error reading directory ${folderPath}: ${readdirErr.message}`,
            );
          }
        }

        let totalEpisodes = metadata.totalEpisodes || 0;
        let watchedEpisodes = metadata.watched || 0;
        let nextEpisodeIn = metadata.nextEpisodeIn || null;

        return {
          ...metadata,
          folder_name: resolvedFolder,
          Downloaded: content,
          totalEpisodes: totalEpisodes,
          watched: watchedEpisodes,
          nextEpisodeIn: nextEpisodeIn,
        };
      }),
    );

    let finalResults = updatedMetadata.filter(Boolean);

    if (tag && tag.toLowerCase() === "downloads") {
      finalResults = finalResults.filter((item) => {
        if (item.Downloaded && item.Downloaded.length > 0) return true;
        if (item.CustomTag) {
          try {
            const parsed = JSON.parse(item.CustomTag);
            if (Array.isArray(parsed)) {
              return parsed.some((t) => t && t.toLowerCase() === "downloads");
            }
            return String(parsed).toLowerCase() === "downloads";
          } catch (_) {
            return item.CustomTag.toLowerCase().includes("downloads");
          }
        }
        return false;
      });
    }

    return {
      totalPages,
      currentPage: page,
      hasNextPage,
      results: finalResults,
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
    const metadata = await queryOne(`SELECT * FROM ${type} WHERE id = ?`, [id]);
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

async function extractSubtitlesFromVideo(videoPath, epNum) {
  try {
    const ffmpegPath = await getFfmpegPath();
    if (!ffmpegPath) return [];

    const parentDir = path.dirname(videoPath);
    const subsDir = path.join(parentDir, "subs");

    return new Promise((resolve) => {
      child_process.exec(
        `"${ffmpegPath}" -i "${videoPath}"`,
        (err, stdout, stderr) => {
          const output = stderr || stdout || "";
          const streamLines = output
            .split("\n")
            .filter((line) => line.includes("Subtitle:"));
          if (streamLines.length === 0) {
            return resolve([]);
          }

          if (!fs.existsSync(subsDir)) {
            fs.mkdirSync(subsDir, { recursive: true });
          }

          const promises = streamLines.map((line) => {
            const matchStream = line.match(/Stream #0:(\d+)/);
            if (!matchStream) return Promise.resolve(null);
            const streamIdx = matchStream[1];

            let lang = "en";
            const matchLang = line.match(/Stream #0:\d+\(([^)]+)\)/);
            if (matchLang) {
              lang = matchLang[1].slice(0, 3).toLowerCase();
            }

            const outFile = path.join(subsDir, `${epNum}Ep.${lang}.vtt`);
            return new Promise((res) => {
              child_process.exec(
                `"${ffmpegPath}" -y -i "${videoPath}" -map 0:${streamIdx} "${outFile}"`,
                (errOut) => {
                  if (errOut) {
                    res(null);
                  } else {
                    res({
                      url: `/subtitles?file=${encodeURIComponent(outFile)}`,
                      lang: lang,
                    });
                  }
                },
              );
            });
          });

          Promise.all(promises).then((results) => {
            resolve(results.filter(Boolean));
          });
        },
      );
    });
  } catch (e) {
    logger.error(`Error in extractSubtitlesFromVideo: ${e.message}`);
    return [];
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
    const metadata = await queryOne(`SELECT * FROM ${type} WHERE id = ?`, [id]);
    if (metadata) {
      folder_name =
        metadata.folder_name ||
        (metadata.title ? metadata.title.replace(/[^a-zA-Z0-9]/g, "_") : id);
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
        const linked = await queryAll(
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
          const match = file.match(/^(?:ep)?(\d+(?:\.\d+)?)/i);
          if (match) {
            return parseFloat(match[1]) === parseFloat(number);
          }
          return false;
        })
        .map((subtitle) => {
          const parts = subtitle.split(".");
          let lang = "English";
          if (parts.length >= 3) {
            const rawLang = parts[parts.length - 2];
            if (rawLang && rawLang.length <= 4) {
              lang = rawLang;
            }
          }
          return {
            url: `/subtitles?file=${encodeURIComponent(
              path.join(subtitlesDir, subtitle),
            )}`,
            lang: lang,
          };
        });
    }

    if (
      subtitleFiles.length === 0 &&
      type === "Anime" &&
      fs.existsSync(finalPath)
    ) {
      subtitleFiles = await extractSubtitlesFromVideo(finalPath, number);
    }

    let skipTimes = [];
    try {
      const row = await queryOne(
        "SELECT skip_times FROM SkipTimes WHERE anime_id = ? AND episode_number = ? LIMIT 1",
        [id, Number(number)],
      );
      if (row && row.skip_times) {
        skipTimes = JSON.parse(row.skip_times) || [];
      }
    } catch (e) {
      // ignore
    }

    return {
      filepath: finalPath,
      subtitleFiles: subtitleFiles,
      skipTimes: skipTimes,
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
      let id = AnimeMangaid?.replace(/-(dub|sub|hsub|both)$/, "");
      const searchTerms = Array.from(
        new Set([
          `${id}-sub`,
          `${id}-hsub`,
          `${id}-dub`,
          `${id}-both`,
          AnimeMangaid,
          id,
        ]),
      ).filter(Boolean);

      try {
        const placeholders = searchTerms.map(() => "?").join(",");
        const FoundRow = await queryOne(
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
          let MalInfo = await queryOne(
            `SELECT * FROM MyAnimeList WHERE id = ?`,
            [String(data.malid)],
          );

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
          Downloads = await queryAll("SELECT * FROM Anime WHERE MalID = ?", [
            String(data.malid),
          ]);
        }
        if (Downloads.length === 0) {
          const placeholders = searchTerms.map(() => "?").join(",");
          Downloads = await queryAll(
            `SELECT * FROM Anime WHERE id IN (${placeholders}) OR folder_name IN (${placeholders})`,
            [...searchTerms, ...searchTerms],
          );
        }

        if (Downloads?.length > 0) {
          const mainDownload =
            Downloads.find(
              (d) =>
                searchTerms.includes(d.id) ||
                (d.folder_name && searchTerms.includes(d.folder_name)),
            ) || Downloads[0];

          mainDownload.dataId = mainDownload?.EpisodesDataId;
          delete mainDownload.EpisodesDataId;

          const baseImage = mainDownload.image_url || null;
          const baseTitle =
            mainDownload.title && mainDownload.title.trim() !== ""
              ? mainDownload.title
              : formatFallbackTitle(
                  mainDownload.folder_name || mainDownload.id,
                );

          data = {
            ...mainDownload,
            title: baseTitle,
            image: baseImage,
            DownloadedEpisodes: {
              sub: [],
              dub: [],
            },
            ...data,
          };

          for (const SubDub of Downloads) {
            const baseFolder =
              SubDub.folder_name ||
              `${SubDub.title?.replace(/[^a-zA-Z0-9]/g, "_")}`;
            let folderName = baseFolder;
            let folderExists = fs.existsSync(
              path.join(dir, "Anime", folderName),
            );

            if (!folderExists) {
              const suffixes = ["_sub", "_dub", "_hsub"];
              for (const suffix of suffixes) {
                const checkFolder = `${baseFolder}${suffix}`;
                if (fs.existsSync(path.join(dir, "Anime", checkFolder))) {
                  folderName = checkFolder;
                  folderExists = true;
                  break;
                }
              }
            }

            const folderPath = path.join(dir, "Anime", folderName);

            if (folderExists) {
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

        const mainRecord = await queryOne(
          "SELECT * FROM Manga WHERE id = ? or folder_name = ?",
          [AnimeMangaid, AnimeMangaid],
        );
        if (mainRecord) {
          malIdToUse = mainRecord.MalID || malIdToUse;
        }

        if (malIdToUse) {
          downloadsList = await queryAll(
            "SELECT * FROM Manga WHERE MalID = ?",
            [String(malIdToUse)],
          );
        }
        if (downloadsList.length === 0 && mainRecord) {
          downloadsList = [mainRecord];
        }

        if (downloadsList.length > 0) {
          const firstRecord =
            downloadsList.find(
              (d) => d.id === AnimeMangaid || d.folder_name === AnimeMangaid,
            ) || downloadsList[0];
          const baseImage = firstRecord.image_url || null;
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
              let MalInfo = await queryOne(
                `SELECT * FROM MyMangaList WHERE id = ?`,
                [String(data.malid)],
              );
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

    const existingEntries = await queryAll(
      `SELECT * FROM MyAnimeList WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );

    const existingMap = new Map(
      existingEntries.map((entry) => [entry.id, entry]),
    );

    let NotChanged = false;

    const operations = [];
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

      operations.push({
        sql: `
          INSERT INTO MyAnimeList (id, title, image, totalEpisodes, watched, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            title = excluded.title,
            image = excluded.image,
            totalEpisodes = excluded.totalEpisodes,
            watched = excluded.watched,
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
        params: [
          entry.id.toString(),
          entry.title,
          entry.image,
          parseInt(entry.totalEpisodes ?? 0),
          parseInt(entry.watched ?? 0),
          entry.status,
          entry.updated_at,
        ],
      });
    }

    if (operations.length > 0) {
      await batchRun("main", operations);
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

    const existingEntries = await queryAll(
      `SELECT * FROM MyMangaList WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );

    const existingMap = new Map(
      existingEntries.map((entry) => [entry.id, entry]),
    );

    let NotChanged = false;

    const operations = [];
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

      operations.push({
        sql: `
          INSERT INTO MyMangaList (id, title, image, totalChapters, read, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            title = excluded.title,
            image = excluded.image,
            totalChapters = excluded.totalChapters,
            read = excluded.read,
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
        params: [
          entry.id.toString(),
          entry.title,
          entry.image,
          parseInt(entry.totalChapters ?? 0),
          parseInt(entry.read ?? 0),
          entry.status,
          entry.updated_at,
        ],
      });
    }

    if (operations.length > 0) {
      await batchRun("main", operations);
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
  formatFallbackTitle,
  getMalIdFromMapping,
};
