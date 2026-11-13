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
  mappingQueryAll,
} = require("./db");
const ImageCacheManager = require("./ImageCacheManager");
const { sanitizeFolderName, getDownloadsFolder } = require("./DirectoryMaker");
const { migrateLegacyFolderIfNeeded } = require("./AnimeManga");
const {
  isVideoFile,
  isSubtitleFile,
  isMangaFile,
  hasLocalMediaFiles,
  getEpisodeNumberFromFilename,
  getChapterNumberFromFilename,
  parseTags,
  SEASON_FOLDER_RE,
} = require("./constants");
const { resolveMalIdFromMapping } = require("./mappingResolver");

function formatFallbackTitle(str) {
  if (!str) return "Untitled";
  return str
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
    .replace(/-[a-z0-9]{5}$/i, "")
    .replace(/[^a-z0-9]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function getMalIdFromMapping(type, providerName, cleanId) {
  if (!cleanId) return null;
  try {
    return await resolveMalIdFromMapping({
      id: cleanId,
      provider: providerName,
      mediaType: type,
    });
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

  if (type === "Movies") {
    delete valuesToAdd.MalID;
  } else if (!valuesToAdd.MalID || valuesToAdd.MalID === "") {
    try {
      const customMappingRow = await queryOne(
        "SELECT malid FROM unlinked_mal_ids WHERE id = ?",
        [valuesToAdd.id],
      );

      if (customMappingRow) {
        valuesToAdd.MalID = customMappingRow.malid
          ? String(customMappingRow.malid)
          : null;
      } else {
        const malId = await getMalIdFromMapping(
          type,
          valuesToAdd.provider,
          valuesToAdd.id,
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
          const response = await global.axios.get(Imageurl, {
            responseType: "arraybuffer",
          });

          await ImageCacheManager.cacheImage(
            Imageurl,
            Buffer.from(response.data),
          );
          valuesToAdd.image = null;
        } catch (err) {
          logger.error(`Failed to fetch and cache image from: ${Imageurl}`);
          const fallbackUrl = valuesToAdd.scraper_image;
          if (
            fallbackUrl &&
            fallbackUrl !== Imageurl &&
            typeof fallbackUrl === "string" &&
            fallbackUrl.startsWith("http")
          ) {
            try {
              logger.info(
                `Attempting fallback image caching from: ${fallbackUrl}`,
              );
              const fallbackResponse = await global.axios.get(fallbackUrl, {
                responseType: "arraybuffer",
              });
              await ImageCacheManager.cacheImage(
                fallbackUrl,
                Buffer.from(fallbackResponse.data),
              );
              valuesToAdd.image_url = fallbackUrl;
            } catch (fallbackErr) {
              logger.error(
                `Failed to fetch fallback image from: ${fallbackUrl}`,
              );
            }
          }
          valuesToAdd.image = null;
        }
      }
    }

    if (valuesToAdd?.title) {
      const baseFolderName = sanitizeFolderName(valuesToAdd.title);
      valuesToAdd.folder_name = baseFolderName;
    }

    if (!valuesToAdd.hasOwnProperty("CustomTag")) {
      valuesToAdd.CustomTag = "";
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
        `INSERT OR REPLACE INTO ${type} (${fields}) VALUES (${placeholders})`,
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

    if (type !== "Movies" && (!existingRecord.MalID || existingRecord.MalID === "")) {
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
      const countMovies =
        (await queryOne(
          "SELECT COUNT(*) as count FROM Movies WHERE image_url = ?",
          [imageUrl],
        )?.count) || 0;
      if (countAnime + countManga + countMovies <= 1) {
        ImageCacheManager.removeCachedImage(imageUrl).catch((err) => {
          logger.error(`Error in removeCachedImage: ${err.message}`);
        });
      }
    }

    await run(`DELETE FROM ${type} WHERE id = ? OR folder_name = ?`, [id, id]);
    if (type === "Anime") {
      try {
        await run(
          "DELETE FROM SkipTimes WHERE anime_id = ? OR anime_id LIKE ?",
          [id, `${id}-%`],
        );
      } catch (_) {}
    }
  } catch (error) {
    throw new Error(`Error deleting from ${type}: ${error.message}`);
  }
}

function resolveLocalFolder(metadata, folderSet, type) {
  let resolvedFolder = metadata.folder_name || "";
  if (resolvedFolder && folderSet.has(resolvedFolder)) {
    return resolvedFolder;
  }
  if (metadata.id && folderSet.has(metadata.id)) {
    return metadata.id;
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
    const baseName = sanitizeFolderName(metadata.title);
    const nameCandidates = [
      baseName,
      `${baseName}_sub`,
      `${baseName}_dub`,
      `${baseName}_hsub`,
      cleanStringForMatching(metadata.title),
    ];
    for (const cand of nameCandidates) {
      if (cand && folderSet.has(cand)) {
        return cand;
      }
    }
  }

  if (metadata.linkedProviders) {
    for (const lp of metadata.linkedProviders) {
      const lpName = lp.folder_name || sanitizeFolderName(lp.title);
      if (lpName) {
        const lpCandidates = [
          lpName,
          lp.id,
          `${lpName}_sub`,
          `${lpName}_dub`,
          `${lpName}_hsub`,
        ];
        for (const cand of lpCandidates) {
          if (cand && folderSet.has(cand)) {
            return cand;
          }
        }
      }
    }
  }

  return null;
}

function matchSeasonYearHelper(airedStr, season, year) {
  if (!airedStr && (season || year)) return false;
  if (!season && !year) return true;
  const s = String(airedStr).toLowerCase();

  if (year && year !== "All" && year !== "") {
    if (year === "Older") {
      const match = s.match(/\b(19\d\d|200\d)\b/);
      if (!match) return false;
    } else if (!s.includes(String(year).toLowerCase())) {
      return false;
    }
  }

  if (season && season !== "All" && season !== "") {
    const sLower = season.toLowerCase();
    if (s.includes(sLower)) return true;

    const winterMonths = ["jan", "feb", "mar", "-01-", "-02-", "-03-"];
    const springMonths = ["apr", "may", "jun", "-04-", "-05-", "-06-"];
    const summerMonths = ["jul", "aug", "sep", "-07-", "-08-", "-09-"];
    const fallMonths = ["oct", "nov", "dec", "-10-", "-11-", "-12-"];

    let months = [];
    if (sLower === "winter") months = winterMonths;
    else if (sLower === "spring") months = springMonths;
    else if (sLower === "summer") months = summerMonths;
    else if (sLower === "fall") months = fallMonths;

    return months.some((m) => s.includes(m));
  }

  return true;
}

// Get All Metadata
async function getAllMetadata(
  type,
  baseDir,
  page = 1,
  tag = null,
  filters = {},
  keyword = "",
) {
  baseDir =
    typeof baseDir === "string" && baseDir.trim()
      ? baseDir
      : getDownloadsFolder();
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  try {
    const candidateDirs = [];
    const addDir = (d) => {
      if (d && fs.existsSync(d)) {
        const resolved = path.resolve(d);
        if (!candidateDirs.includes(resolved)) {
          candidateDirs.push(resolved);
        }
      }
    };
    addDir(path.join(baseDir, type));
    addDir(baseDir);
    const downloadsRoot = getDownloadsFolder();
    addDir(path.join(downloadsRoot, type));

    const folders = [];
    const seenFolders = new Set();
    for (const cDir of candidateDirs) {
      try {
        const directories = await fs.promises.readdir(cDir, {
          withFileTypes: true,
        });
        for (const dir of directories) {
          if (
            dir.isDirectory() &&
            dir.name !== type &&
            dir.name !== "Anime" &&
            dir.name !== "Manga" &&
            dir.name !== "Movies" &&
            !dir.name.startsWith(".")
          ) {
            const subDirPath = path.join(cDir, dir.name);
            if (hasLocalMediaFiles(subDirPath, type)) {
              if (!seenFolders.has(dir.name)) {
                seenFolders.add(dir.name);
                folders.push(dir.name);
              }
            }
            // Media-server layout: each "<Show>/Season NN" is its own entry
            for (const sub of fs.readdirSync(subDirPath, {
              withFileTypes: true,
            })) {
              if (
                sub.isDirectory() &&
                SEASON_FOLDER_RE.test(sub.name) &&
                hasLocalMediaFiles(path.join(subDirPath, sub.name), type)
              ) {
                const seasonKey = `${dir.name}/${sub.name}`;
                if (!seenFolders.has(seasonKey)) {
                  seenFolders.add(seasonKey);
                  folders.push(seasonKey);
                }
              }
            }
          }
        }
      } catch (_) {}
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
      if (type === "Anime") {
        run(
          "DELETE FROM SkipTimes WHERE anime_id NOT IN (SELECT id FROM Anime)",
        );
      }
    }

    try {
      storedMetadata = await queryAll(
        `SELECT * FROM ${type} ORDER BY last_updated DESC`,
      );

      if (
        tag &&
        tag !== "All" &&
        tag !== "" &&
        tag.toLowerCase() !== "downloads"
      ) {
        const targetTag = tag.toLowerCase().trim();
        storedMetadata = storedMetadata.filter((item) => {
          if (!item.CustomTag) return false;
          const tags = parseTags(item.CustomTag);
          return tags.some(
            (t) => t && String(t).toLowerCase().trim() === targetTag,
          );
        });
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
        title: formatFallbackTitle(alltitles),
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
        const folder = resolveLocalFolder(item, folderSet, type);
        return !!folder;
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
          SELECT anime_id, MAX(episode_number) as max_ep 
          FROM WatchHistory 
          GROUP BY anime_id
        `);
        watchRows.forEach((r) => {
          if (r.max_ep != null) {
            const num = Number(r.max_ep);
            watchMap[r.anime_id] = Math.max(
              watchMap[r.anime_id] || 0,
              isNaN(num) ? 0 : num,
            );
          }
        });
      } catch (e) {}
    } else if (type === "Manga") {
      try {
        const readRows = await queryAll(`
          SELECT manga_id, MAX(chapter_number) as max_ch 
          FROM ReadHistory 
          GROUP BY manga_id
        `);
        readRows.forEach((r) => {
          if (r.max_ch != null) {
            const num = Number(r.max_ch);
            watchMap[r.manga_id] = Math.max(
              watchMap[r.manga_id] || 0,
              isNaN(num) ? 0 : num,
            );
          }
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
    const recentlyAiredMap = {};
    if (type === "Anime") {
      try {
        const now = Math.floor(Date.now() / 1000);
        const localToday = new Date();
        const localTodayStart =
          new Date(
            localToday.getFullYear(),
            localToday.getMonth(),
            localToday.getDate(),
            0,
            0,
            0,
          ).getTime() / 1000;
        const localYesterdayStart = localTodayStart - 24 * 3600;

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

        const recentlyAiredRows = await mappingQueryAll(
          `
          SELECT livechart_id, episode, date 
          FROM next_episodes 
          WHERE date <= ? AND date >= ?
        `,
          [now, localYesterdayStart],
        );
        recentlyAiredRows.forEach((r) => {
          if (
            !recentlyAiredMap[r.livechart_id] ||
            recentlyAiredMap[r.livechart_id].date < r.date
          ) {
            recentlyAiredMap[r.livechart_id] = {
              episode: r.episode,
              date: r.date,
            };
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

      if (type === "Anime" || type === "Manga") {
        const mediaIds = Array.from(
          new Set([item.id, ...(siblingsMap[item.MalID] || [])]),
        );

        let localWatched = 0;
        mediaIds.forEach((mediaId) => {
          if (watchMap[mediaId]) {
            localWatched = Math.max(localWatched, watchMap[mediaId]);
          }
        });
        watchedEpisodes = Math.max(watchedEpisodes, localWatched);
      }

      if (type === "Anime") {
        if (item.MalID && mappingMap[Number(item.MalID)]) {
          const livechartId = mappingMap[Number(item.MalID)];

          if (maxAiredMap[livechartId] !== undefined) {
            maxAired = maxAiredMap[livechartId];
          }

          let nextEp = upcomingMap[livechartId];
          let showAired = false;

          if (recentlyAiredMap[livechartId]) {
            const airedEp = recentlyAiredMap[livechartId];
            if (watchedEpisodes < airedEp.episode) {
              nextEp = airedEp;
              showAired = true;
            }
          }

          if (nextEp) {
            if (watchedEpisodes >= nextEp.episode - 1) {
              if (showAired) {
                nextEpisodeIn = `Ep ${nextEp.episode}: Aired`;
              } else {
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
      item.isCompleted = isCompleted;
      item.status = isCompleted ? "completed" : malStatus || item.status;
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

    if (keyword && typeof keyword === "string" && keyword.trim()) {
      const cleanKw = keyword.trim().toLowerCase();
      storedMetadata = storedMetadata.filter((item) =>
        (item.title || "").toLowerCase().includes(cleanKw),
      );
    }

    if (filters && typeof filters === "object") {
      if (filters.genre && filters.genre !== "All" && filters.genre !== "") {
        const targetGenre = String(filters.genre).toLowerCase();
        storedMetadata = storedMetadata.filter((item) =>
          (item.genres || "").toLowerCase().includes(targetGenre),
        );
      }

      if (
        filters.mapping &&
        filters.mapping !== "All" &&
        filters.mapping !== ""
      ) {
        if (filters.mapping === "mapped") {
          storedMetadata = storedMetadata.filter((item) =>
            Boolean(item.MalID && String(item.MalID).trim() !== ""),
          );
        } else if (filters.mapping === "unmapped") {
          storedMetadata = storedMetadata.filter(
            (item) => !item.MalID || String(item.MalID).trim() === "",
          );
        }
      }

      if (filters.source && filters.source !== "All" && filters.source !== "") {
        const targetSource = String(filters.source).toLowerCase();
        storedMetadata = storedMetadata.filter((item) =>
          (item.provider || "").toLowerCase().includes(targetSource),
        );
      }

      if (filters.format && filters.format !== "All" && filters.format !== "") {
        const targetFormat = String(filters.format).toLowerCase();
        storedMetadata = storedMetadata.filter(
          (item) => (item.type || "").toLowerCase() === targetFormat,
        );
      }

      if (filters.status && filters.status !== "All" && filters.status !== "") {
        const targetStatus = String(filters.status).toLowerCase();
        storedMetadata = storedMetadata.filter((item) => {
          const itemStatus = (item.status || "").toLowerCase();
          if (targetStatus === "airing" || targetStatus === "ongoing") {
            return (
              itemStatus.includes("airing") || itemStatus.includes("ongoing")
            );
          }
          if (targetStatus === "completed" || targetStatus === "finished") {
            return (
              itemStatus.includes("completed") ||
              itemStatus.includes("finished")
            );
          }
          return itemStatus.includes(targetStatus);
        });
      }

      if (
        filters.malStatus &&
        filters.malStatus !== "All" &&
        filters.malStatus !== ""
      ) {
        const targetMalStatus = String(filters.malStatus).toLowerCase();
        storedMetadata = storedMetadata.filter((item) => {
          const mStatus = (item.malStatus || "").toLowerCase();
          if (targetMalStatus === "watching" || targetMalStatus === "reading") {
            return mStatus === "watching" || mStatus === "reading";
          }
          return mStatus === targetMalStatus;
        });
      }

      if (filters.season || filters.year) {
        storedMetadata = storedMetadata.filter((item) =>
          matchSeasonYearHelper(item.aired, filters.season, filters.year),
        );
      }
    }

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
        await migrateLegacyFolderIfNeeded(type, metadata, baseDir);
        let resolvedFolder = metadata.folder_name || "";
        let folderPath = null;

        const checkFolderExists = async (folderName) => {
          if (!folderName) return null;
          for (const cDir of candidateDirs) {
            const p = path.join(cDir, folderName);
            try {
              await fs.promises.access(p);
              return p;
            } catch (_) {}
          }
          return null;
        };

        if (resolvedFolder) {
          folderPath = await checkFolderExists(resolvedFolder);
          if (!folderPath) {
            const suffixes = ["_sub", "_dub", "_hsub"];
            for (const suffix of suffixes) {
              const checkFolder = `${resolvedFolder}${suffix}`;
              folderPath = await checkFolderExists(checkFolder);
              if (folderPath) {
                resolvedFolder = checkFolder;
                break;
              }
            }
          }
        }

        if (!folderPath && metadata.id) {
          folderPath = await checkFolderExists(metadata.id);
          if (folderPath) {
            resolvedFolder = metadata.id;
          }
        }

        if (!folderPath && metadata.title) {
          const baseName = sanitizeFolderName(metadata.title);
          const nameCandidates = [
            baseName,
            `${baseName}_sub`,
            `${baseName}_dub`,
            `${baseName}_hsub`,
          ];
          for (const cand of nameCandidates) {
            folderPath = await checkFolderExists(cand);
            if (folderPath) {
              resolvedFolder = cand;
              break;
            }
          }
        }

        if (!folderPath && metadata.linkedProviders) {
          for (const lp of metadata.linkedProviders) {
            const lpName = lp.folder_name || sanitizeFolderName(lp.title);
            if (lpName) {
              const lpCandidates = [
                lpName,
                lp.id,
                `${lpName}_sub`,
                `${lpName}_dub`,
                `${lpName}_hsub`,
              ];
              for (const cand of lpCandidates) {
                folderPath = await checkFolderExists(cand);
                if (folderPath) {
                  resolvedFolder = cand;
                  break;
                }
              }
            }
            if (folderPath) break;
          }
        }

        const folderExists = Boolean(folderPath);

        if (
          !folderExists &&
          (!metadata.CustomTag || metadata.CustomTag === "") &&
          (!metadata.MalID || metadata.MalID === "")
        ) {
          run(`DELETE FROM ${type} WHERE id = ?`, [metadata.id]);
          return null;
        }

        let content = [];
        if (folderExists && folderPath) {
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
                .filter((file) => file.isFile() && isMangaFile(file.name))
                .map((file) => getChapterNumberFromFilename(file.name))
                .filter((num) => num !== null && !isNaN(num))
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
      const validResults = [];
      for (const item of updatedMetadata) {
        if (!item) continue;
        const hasFiles =
          Array.isArray(item.Downloaded) && item.Downloaded.length > 0;
        const inQueue =
          global.isEpisodeInQueue &&
          (global.isEpisodeInQueue(item.id) ||
            (item.title && global.isEpisodeInQueue(item.title)));

        if (hasFiles || inQueue) {
          validResults.push(item);
        }
      }
      finalResults = validResults;
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
  baseDir =
    typeof baseDir === "string" && baseDir.trim()
      ? baseDir
      : getDownloadsFolder();
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  if (
    number == null ||
    String(number).trim() === "" ||
    isNaN(Number(number))
  ) {
    return null;
  }
  const targetNum = Number(number);

  let folder_name = id;
  let malId = null;
  try {
    const metadata = await queryOne(`SELECT * FROM ${type} WHERE id = ?`, [id]);
    if (metadata) {
      await migrateLegacyFolderIfNeeded(type, metadata, baseDir);
      folder_name =
        metadata.folder_name ||
        (metadata.title ? sanitizeFolderName(metadata.title) : id);
      malId = metadata.MalID;
    }
  } catch (err) {
    // ignore
  }

  try {
    let folderPath = path.join(baseDir, type, folder_name);
    if (
      !fs.existsSync(folderPath) &&
      fs.existsSync(path.join(baseDir, folder_name))
    ) {
      folderPath = path.join(baseDir, folder_name);
    }
    let finalPath = "";
    let fileFound = false;

    const searchInFolder = (fPath) => {
      if (!fs.existsSync(fPath)) return null;
      if (type === "Anime") {
        const files = fs.readdirSync(fPath);
        const match = files.find((f) => {
          if (
            f.startsWith(".") ||
            f.includes(".temp") ||
            f.endsWith(".tmp") ||
            f.endsWith(".part")
          ) {
            return false;
          }
          const num = getEpisodeNumberFromFilename(f);
          return num !== null && num === targetNum;
        });
        return match ? path.join(fPath, match) : null;
      } else if (type === "Manga") {
        const files = fs.readdirSync(fPath);
        const match = files.find((f) => {
          if (!isMangaFile(f)) return false;
          const num = getChapterNumberFromFilename(f);
          return num !== null && num === targetNum;
        });
        if (match) return path.join(fPath, match);
        const fallbackPath = path.join(fPath, `Chapter ${targetNum}.cbz`);
        return fs.existsSync(fallbackPath) ? fallbackPath : null;
      }
      return null;
    };

    let dirsToSearch = [];
    dirsToSearch.push(folderPath);

    if (malId) {
      try {
        const linked = await queryAll(
          `SELECT folder_name FROM ${type} WHERE MalID = ?`,
          [String(malId)],
        );

        linked.forEach((r) => {
          if (r.folder_name && r.folder_name !== folder_name) {
            let p = path.join(baseDir, type, r.folder_name);
            if (
              !fs.existsSync(p) &&
              fs.existsSync(path.join(baseDir, r.folder_name))
            ) {
              p = path.join(baseDir, r.folder_name);
            }
            if (!dirsToSearch.includes(p)) {
              dirsToSearch.push(p);
            }
          }
        });
      } catch (err) {}
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
        fileName = `${targetNum}Ep.mp4`;
      } else if (type === "Manga") {
        fileName = `Chapter ${targetNum}.cbz`;
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
          const isSub = isSubtitleFile(file);
          if (!isSub) return false;
          const match = file.match(/^(?:ep)?(\d+(?:\.\d+)?)/i);
          if (match) {
            return parseFloat(match[1]) === targetNum;
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

    if (fs.existsSync(parentDir)) {
      const videoBaseName = path.parse(finalPath).name;
      try {
        const siblingSubs = fs
          .readdirSync(parentDir)
          .filter((file) => {
            if (!isSubtitleFile(file)) return false;
            return file.startsWith(videoBaseName);
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
                path.join(parentDir, subtitle),
              )}`,
              lang: lang,
            };
          });

        for (const s of siblingSubs) {
          if (!subtitleFiles.some((existing) => existing.url === s.url)) {
            subtitleFiles.push(s);
          }
        }
      } catch (e) {}
    }

    if (
      subtitleFiles.length === 0 &&
      type === "Anime" &&
      fs.existsSync(finalPath)
    ) {
      subtitleFiles = await extractSubtitlesFromVideo(finalPath, targetNum);
    }

    let skipTimes = [];
    if (id != null) {
      try {
        const rawNum = targetNum;
        const cleanNum = Number.isInteger(rawNum) ? Math.trunc(rawNum) : rawNum;
        const row = await queryOne(
          "SELECT skip_times FROM SkipTimes WHERE (anime_id = ? OR anime_id LIKE ?) AND (episode_number = ? OR episode_number = ?) LIMIT 1",
          [String(id), `${String(id)}-%`, cleanNum, rawNum],
        );
        if (row && row.skip_times) {
          skipTimes = JSON.parse(row.skip_times) || [];
        }
      } catch (e) {
        // ignore
      }
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
  dir = typeof dir === "string" && dir.trim() ? dir : getDownloadsFolder();
  try {
    let data = {};

    // if logged in mal && Anime or Movies
    if (type === "Anime" || type === "Movies") {
      const mainTable = type === "Movies" ? "Movies" : "Anime";
      data.DownloadedEpisodes = [];
      let FoundRow = null;

      try {
        if (malid && type === "Anime") {
          FoundRow = await queryOne(
            `SELECT * FROM ${mainTable} WHERE MalID = ? LIMIT 1`,
            [String(malid)],
          );
        }

        if (!FoundRow) {
          FoundRow = await queryOne(
            `SELECT * FROM ${mainTable} WHERE id = ? OR folder_name = ? OR LOWER(REPLACE(title, ' ', '-')) = LOWER(?) LIMIT 1`,
            [AnimeMangaid, AnimeMangaid, AnimeMangaid],
          );
        }

        if (!FoundRow) {
          try {
            const histRow = await queryOne(
              `SELECT anime_title FROM WatchHistory WHERE anime_id = ? LIMIT 1`,
              [AnimeMangaid],
            );
            if (histRow && histRow.anime_title) {
              FoundRow = await queryOne(
                `SELECT * FROM ${mainTable} WHERE LOWER(title) = LOWER(?) LIMIT 1`,
                [histRow.anime_title],
              );
            }
          } catch (_) {}
        }

        if (!FoundRow && type === "Anime" && AnimeMangaid) {
          try {
            const customRow = await queryOne(
              "SELECT malid FROM unlinked_mal_ids WHERE id = ? LIMIT 1",
              [AnimeMangaid],
            );
            let resolvedMal = customRow?.malid ? String(customRow.malid) : null;
            if (!resolvedMal) {
              resolvedMal = await resolveMalIdFromMapping({
                id: AnimeMangaid,
                mediaType: type,
                installedOnly: true,
              });
            }
            if (resolvedMal) {
              FoundRow = await queryOne(
                `SELECT * FROM ${mainTable} WHERE MalID = ? LIMIT 1`,
                [String(resolvedMal)],
              );
              if (FoundRow && !malid) {
                data.malid = parseInt(resolvedMal);
              }
            }
          } catch (_) {}
        }

        if (!FoundRow && AnimeMangaid) {
          try {
            FoundRow = await queryOne(
              `SELECT * FROM ${mainTable} WHERE LOWER(title) = LOWER(?) LIMIT 1`,
              [AnimeMangaid],
            );
          } catch (_) {}
        }

        if (FoundRow) {
          await migrateLegacyFolderIfNeeded(type, FoundRow, dir);
        }

        data.CustomTag = FoundRow?.CustomTag || "";

        if (!malid && type === "Anime") {
          data.malid = FoundRow?.MalID ? parseInt(FoundRow.MalID) : null;
          if (!data.malid && FoundRow?.id) {
            const resolvedMalId = await getMalIdFromMapping(
              type,
              FoundRow.provider,
              FoundRow.id,
            );
            if (resolvedMalId) {
              data.malid = parseInt(resolvedMalId);
              try {
                await run("UPDATE Anime SET MalID = ? WHERE id = ?", [
                  String(resolvedMalId),
                  FoundRow.id,
                ]);
              } catch (_) {}
            }
          }
        } else if (type === "Anime") {
          data.malid = malid;
        }

        // if mal id find in list if it exists
        if (data.malid && global.MalLoggedIn && type === "Anime") {
          let MalInfo = await queryOne(
            `SELECT * FROM MyAnimeList WHERE id = ?`,
            [String(data.malid)],
          );

          if (MalInfo) {
            data = {
              ...data,
              totalEpisodes:
                MalInfo.totalEpisodes > 0
                  ? MalInfo.totalEpisodes
                  : MalInfo.lastEpisode
                    ? MalInfo.lastEpisode
                    : 0,
              lastEpisode: MalInfo.lastEpisode ?? null,
              watched: MalInfo.watched ?? 0,
              status: MalInfo.status ?? "",
            };
          }
        }
      } catch (err) {
        logger.error(`[FindMapping DB Error] ${err.message}`);
      }

      // Finding If Its Downloaded
      try {
        let Downloads = [];
        if (data.malid && type === "Anime") {
          Downloads = await queryAll(`SELECT * FROM ${mainTable} WHERE MalID = ?`, [
            String(data.malid),
          ]);
        }
        if (Downloads.length === 0) {
          Downloads = await queryAll(
            `SELECT * FROM ${mainTable} WHERE id = ? OR folder_name = ? OR LOWER(REPLACE(title, ' ', '-')) = LOWER(?)`,
            [AnimeMangaid, AnimeMangaid, AnimeMangaid],
          );
        }
        if (Downloads.length === 0 && FoundRow) {
          Downloads = [FoundRow];
        }
        if (Downloads.length === 0 && AnimeMangaid) {
          const directDir = path.join(dir, type, AnimeMangaid);
          const sanitizedDir = path.join(
            dir,
            type,
            sanitizeFolderName(AnimeMangaid),
          );
          if (fs.existsSync(directDir) || fs.existsSync(sanitizedDir)) {
            Downloads = [
              {
                id: AnimeMangaid,
                title: AnimeMangaid,
                folder_name: fs.existsSync(directDir)
                  ? AnimeMangaid
                  : sanitizeFolderName(AnimeMangaid),
              },
            ];
          }
        }

        if (Downloads?.length > 0) {
          const mainDownload =
            Downloads.find(
              (d) =>
                d.id === AnimeMangaid ||
                (d.folder_name && d.folder_name === AnimeMangaid),
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
            DownloadedEpisodes: [],
            ...data,
          };

          for (const SubDub of Downloads) {
            await migrateLegacyFolderIfNeeded(type, SubDub, dir);
            const folderName =
              SubDub.folder_name || `${sanitizeFolderName(SubDub.title)}`;
            let folderPath = path.join(dir, type, folderName);
            if (
              !fs.existsSync(folderPath) &&
              fs.existsSync(path.join(dir, folderName))
            ) {
              folderPath = path.join(dir, folderName);
            }
            const folderExists = fs.existsSync(folderPath);

            if (folderExists) {
              const filesAndFolders = await fs.promises.readdir(folderPath, {
                withFileTypes: true,
              });

              const scanned = filesAndFolders
                .filter((file) => file.isFile() && isVideoFile(file.name))
                .map((file) => getEpisodeNumberFromFilename(file.name))
                .filter((num) => num !== null && !isNaN(num))
                .sort((a, b) => a - b);

              if (
                scanned.length === 0 &&
                filesAndFolders.some((f) => f.isFile() && isVideoFile(f.name))
              ) {
                scanned.push(1);
              }

              data.DownloadedEpisodes = Array.from(
                new Set([
                  ...(Array.isArray(data.DownloadedEpisodes)
                    ? data.DownloadedEpisodes
                    : []),
                  ...scanned,
                ]),
              ).sort((a, b) => a - b);
            }
          }
        }
      } catch (err) {
        logger.error(`[FindMapping FS Error] ${err.message}`);
      }
    } else {
      try {
        let downloadsList = [];
        let malIdToUse = malid;

        let mainRecord = null;
        if (malIdToUse) {
          mainRecord = await queryOne(
            "SELECT * FROM Manga WHERE MalID = ? LIMIT 1",
            [String(malIdToUse)],
          );
        }
        if (!mainRecord) {
          const querySql = `
            SELECT * FROM Manga 
            WHERE id = ? 
               OR id LIKE ? 
               OR folder_name = ? 
               OR LOWER(REPLACE(folder_name, ' ', '-')) = LOWER(?) 
               OR LOWER(REPLACE(title, ' ', '-')) LIKE LOWER(?)
            LIMIT 1
          `;
          mainRecord = await queryOne(querySql, [
            AnimeMangaid,
            `${AnimeMangaid}%`,
            AnimeMangaid,
            AnimeMangaid,
            `${AnimeMangaid}%`,
          ]);
        }
        if (!mainRecord) {
          try {
            const histRow = await queryOne(
              `SELECT manga_title FROM ReadHistory WHERE manga_id = ? LIMIT 1`,
              [AnimeMangaid],
            );
            if (histRow && histRow.manga_title) {
              const querySql = `
                SELECT * FROM Manga 
                WHERE LOWER(title) = LOWER(?)
                LIMIT 1
              `;
              mainRecord = await queryOne(querySql, [histRow.manga_title]);
            }
          } catch (_) {}
        }
        if (mainRecord) {
          await migrateLegacyFolderIfNeeded("Manga", mainRecord, dir);
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
            let folderPath = path.join(dir, type, dRecord.folder_name);
            if (!fs.existsSync(folderPath) && fs.existsSync(path.join(dir, dRecord.folder_name))) {
              folderPath = path.join(dir, dRecord.folder_name);
            }
            if (fs.existsSync(folderPath)) {
              const filesAndFolders = await fs.promises.readdir(folderPath, {
                withFileTypes: true,
              });

              filesAndFolders
                .filter((file) => file.isFile() && isMangaFile(file.name))
                .map((file) => getChapterNumberFromFilename(file.name))
                .filter((num) => num !== null && !isNaN(num))
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

// Shared MAL cache sync for Anime and Manga
async function syncMalCache(mediaType, data = []) {
  try {
    if (!data.length) return true;
    const isAnime = mediaType === "Anime";
    const tableName = isAnime ? "MyAnimeList" : "MyMangaList";
    const totalCol = isAnime ? "totalEpisodes" : "totalChapters";
    const progCol = isAnime ? "watched" : "read";

    const ids = data.map((entry) => entry.id.toString());

    const existingEntries = await queryAll(
      `SELECT * FROM ${tableName} WHERE id IN (${ids.map(() => "?").join(",")})`,
      ids,
    );

    const existingMap = new Map(
      existingEntries.map((entry) => [entry.id, entry]),
    );

    let notChanged = false;

    const operations = [];
    for (const entry of data) {
      const existing = existingMap.get(entry.id.toString());
      const totalVal = parseInt(entry[totalCol] ?? 0);
      const progVal = parseInt(entry[progCol] ?? 0);

      if (
        existing &&
        existing.title === entry.title &&
        existing.image === entry.image &&
        existing[totalCol] === totalVal &&
        existing[progCol] === progVal &&
        existing.status === entry.status &&
        existing.updated_at === entry.updated_at
      ) {
        notChanged = true;
        continue;
      }

      operations.push({
        sql: `
          INSERT INTO ${tableName} (id, title, image, ${totalCol}, ${progCol}, status, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET 
            title = excluded.title,
            image = excluded.image,
            ${totalCol} = excluded.${totalCol},
            ${progCol} = excluded.${progCol},
            status = excluded.status,
            updated_at = excluded.updated_at
        `,
        params: [
          entry.id.toString(),
          entry.title,
          entry.image,
          totalVal,
          progVal,
          entry.status,
          entry.updated_at,
        ],
      });
    }

    if (operations.length > 0) {
      await batchRun("main", operations);
    }

    return notChanged;
  } catch (err) {
    logger.error(
      `Failed To Update ${mediaType === "Anime" ? "MyAnimeList" : "MyMangaList"}`,
    );
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return true;
  }
}

const MalEpMap = (data = []) => syncMalCache("Anime", data);
const MalMangaMap = (data = []) => syncMalCache("Manga", data);

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
  matchSeasonYearHelper,
};
