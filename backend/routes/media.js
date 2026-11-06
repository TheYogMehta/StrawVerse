const express = require("express");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { logger } = require("../utils/AppLogger");
const {
  settingfetch,
  providerFetch,
  reconcileActiveProvider,
} = require("../utils/settings");
const {
  latestMangas,
  MangaSearch,
  MangaInfo,
  latestAnime,
  animeinfo,
  animesearch,
  fetchEpisode,
  fetchEpisodeSources,
  MangaChapterFetch,
  fetchChapters,
  getProviderOrThrow,
  processServer,
} = require("../utils/AnimeManga");
const {
  getAllMetadata,
  getSourceById,
  FindMapping,
} = require("../utils/Metadata");
const { getKeyValue, queryOne, queryAll, run } = require("../utils/db");
const ImageCacheManager = require("../utils/ImageCacheManager");
const { getHeaders } = require("../utils/proxyHeaders");
const {
  resolveMalIdFromMapping,
  getLinkedProvidersForMalId,
  getBestProviderForMalId,
} = require("../utils/mappingResolver");
const { sanitizeFolderName, getUserDataPath } = require("../utils/constants");
const { getDownloadsFolder } = require("../utils/DirectoryMaker");

const router = express.Router();

function generateNormalizedTitleCandidates(rawTitle) {
  if (!rawTitle || typeof rawTitle !== "string") return [];
  const candidates = new Set();
  const trimmed = rawTitle.trim();
  if (!trimmed) return [];

  candidates.add(trimmed);

  const noDots = trimmed.replace(/[\.…]+\s*$/, "").trim();
  if (noDots && noDots !== trimmed) candidates.add(noDots);

  const noParen = trimmed
    .replace(/\s*\((?:tv|ona|ova|movie|special|dub|sub|\d{4})\)\s*$/i, "")
    .trim();
  if (noParen && noParen !== trimmed) candidates.add(noParen);

  let stripped = trimmed.replace(/[\.…]+\s*$/, "");
  const patterns = [
    /\s+(?:part|cour)\s+\d+.*$/i,
    /\s*-\s*(?:part|cour)\s+\d+.*$/i,
    /\s+(?:season|\b\d+(?:st|nd|rd|th)\s+season)\s*.*$/i,
    /\s*-\s*(?:season|\b\d+(?:st|nd|rd|th)\s+season)\s*.*$/i,
    /\s*\((?:season|\b\d+(?:st|nd|rd|th)\s+season)\s*.*\)$/i,
    /\s*-\s*[^:]+$/i,
  ];

  for (const pat of patterns) {
    const next = stripped.replace(pat, "").trim();
    if (next && next.length >= 2 && next !== stripped) {
      candidates.add(next);
      stripped = next;
    }
  }

  if (trimmed.includes(":")) {
    const beforeColon = trimmed.split(":")[0].trim();
    if (beforeColon && beforeColon.length >= 3) {
      candidates.add(beforeColon);
    }
  }

  return Array.from(candidates);
}

function cleanBaseTitle(title) {
  if (!title || typeof title !== "string") return "";
  return title
    .replace(/[\.…]+\s*$/, "")
    .replace(/\s+(?:season|\b\d+(?:st|nd|rd|th)\s+season|part|cour)\s*.*$/i, "")
    .replace(
      /\s*-\s*(?:season|\b\d+(?:st|nd|rd|th)\s+season|part|cour)\s*.*$/i,
      "",
    )
    .replace(
      /\s*\((?:season|\b\d+(?:st|nd|rd|th)\s+season|tv|part|cour)\s*.*\)$/i,
      "",
    )
    .trim();
}

async function enrichResultsWithMappingImages(results, AnimeManga) {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return results;
  }

  const isAnime = AnimeManga === "Anime";

  for (const item of results) {
    if (!item) continue;

    item.scraper_image = item.image || null;

    let malid =
      item.MalID || item.malid ? Number(item.MalID || item.malid) : null;

    if (!malid && item.id && global.db) {
      try {
        const table = isAnime ? "Anime" : "Manga";
        const row = await global.db
          .prepare(`SELECT MalID FROM ${table} WHERE id = ?`)
          .get(String(item.id));
        if (row && row.MalID) {
          malid = parseInt(row.MalID);
        }
      } catch (_) {}
    }

    if (!malid && item.id && global.mappingDb) {
      try {
        const resolved = await resolveMalIdFromMapping({
          id: item.id,
          mediaType: isAnime ? "Anime" : "Manga",
        });
        if (resolved) malid = resolved;
      } catch (_) {}
    }

    if (!malid && item.title) {
      const candidates = generateNormalizedTitleCandidates(item.title);
      for (const cand of candidates) {
        const cleanTitle = cand.trim().toLowerCase();
        if (!malid && global.db) {
          try {
            const table = isAnime ? "Anime" : "Manga";
            const row = await global.db
              .prepare(
                `SELECT MalID FROM ${table} WHERE LOWER(TRIM(title)) = ? LIMIT 1`,
              )
              .get(cleanTitle);
            if (row && row.MalID) {
              malid = parseInt(row.MalID);
            }
          } catch (_) {}
        }
        if (!malid && global.db) {
          try {
            const listTable = isAnime ? "MyAnimeList" : "MyMangaList";
            const row = await global.db
              .prepare(
                `SELECT id FROM ${listTable} WHERE LOWER(TRIM(title)) = ? LIMIT 1`,
              )
              .get(cleanTitle);
            if (row && row.id) {
              malid = parseInt(row.id);
            }
          } catch (_) {}
        }
        if (!malid && global.mappingDb) {
          try {
            const malTable = isAnime ? "anime" : "manga";
            const row = await global.mappingDb
              .prepare(
                `SELECT malid, image_url FROM ${malTable} WHERE LOWER(TRIM(title)) = ? LIMIT 1`,
              )
              .get(cleanTitle);
            if (row && row.malid) {
              malid = parseInt(row.malid);
            }
          } catch (_) {}
        }
        if (malid) break;
      }

      if (!malid && global.mappingDb) {
        try {
          const malTable = isAnime ? "anime" : "manga";
          const baseClean = cleanBaseTitle(item.title);
          if (baseClean && baseClean.length >= 4) {
            let orderSql = "ORDER BY LENGTH(title) ASC";
            if (/\b(?:season\s*2|2nd\s*season)\b/i.test(item.title)) {
              orderSql =
                "ORDER BY CASE WHEN title LIKE '%2%' OR title LIKE '%Season 2%' THEN 0 ELSE 1 END, LENGTH(title) ASC";
            }
            const row = await global.mappingDb
              .prepare(
                `SELECT malid, image_url FROM ${malTable} WHERE title LIKE ? ${orderSql} LIMIT 1`,
              )
              .get(`${baseClean}%`);
            if (row && row.malid) {
              malid = parseInt(row.malid);
            }
          }
        } catch (_) {}
      }
    }

    if (malid) {
      item.malid = malid;
      let remoteImg = null;
      if (global.mappingDb) {
        try {
          const imgRow = await global.mappingDb
            .prepare(
              isAnime
                ? "SELECT image_url, genres FROM anime WHERE malid = ? LIMIT 1"
                : "SELECT image_url, genres FROM manga WHERE malid = ? LIMIT 1",
            )
            .get(malid);
          if (imgRow && imgRow.image_url) {
            remoteImg = imgRow.image_url;
          }
          if (imgRow && imgRow.genres && !item.genres) {
            item.genres = imgRow.genres;
          }
        } catch (_) {}
      }
      if (!remoteImg && global.db) {
        try {
          const listTable = isAnime ? "MyAnimeList" : "MyMangaList";
          const malRow = await global.db
            .prepare(`SELECT image FROM ${listTable} WHERE id = ? LIMIT 1`)
            .get(String(malid));
          if (malRow && malRow.image) {
            remoteImg = malRow.image;
          }
        } catch (_) {}
      }
      if (remoteImg) {
        item.mal_image = remoteImg;
        item.image_url = remoteImg;
        item.image = remoteImg;
        if (item.id && global.db) {
          try {
            const table = isAnime ? "Anime" : "Manga";
            await global.db
              .prepare(`UPDATE ${table} SET image_url = ? WHERE id = ?`)
              .run(remoteImg, item.id);
          } catch (_) {}
        }
      }
    }

    if (!item.mal_image && global.mappingDb && (item.id || item.title)) {
      try {
        const uRow = await global.mappingDb
          .prepare(
            "SELECT image_url FROM unmapped_items WHERE (id = ? OR name = ?) AND image_url IS NOT NULL AND image_url != '' LIMIT 1",
          )
          .get(String(item.id || ""), String(item.title || ""));
        if (uRow && uRow.image_url) {
          item.image = uRow.image_url;
          item.image_url = uRow.image_url;
        }
      } catch (_) {}
    }

    if (!item.image && !item.scraper_image) {
      item.image = "/images/image-404.png";
    }
  }

  return results;
}

async function enrichResultsWithWatchProgress(results, AnimeManga) {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return results;
  }

  const isAnime = AnimeManga === "Anime";
  const listTable = isAnime ? "MyAnimeList" : "MyMangaList";
  const histTable = isAnime ? "WatchHistory" : "ReadHistory";
  const mediaTable = isAnime ? "Anime" : "Manga";
  const idCol = isAnime ? "anime_id" : "manga_id";
  const titleCol = isAnime ? "anime_title" : "manga_title";
  const epCol = isAnime ? "episode_number" : "chapter_number";

  try {
    const itemIds = new Set();
    const itemTitles = new Set();
    const malIdSet = new Set();
    const mediaMetaMap = new Map();

    for (const item of results) {
      if (!item) continue;
      if (item.id) itemIds.add(String(item.id));
      if (item.malid || item.MalID) {
        malIdSet.add(String(item.malid || item.MalID));
      }
      if (item.title) {
        itemTitles.add(String(item.title).toLowerCase().trim());
      }
    }

    // 1. Resolve any additional MalIDs and metadata from Anime/Manga table
    if (global.db && (itemIds.size > 0 || itemTitles.size > 0)) {
      try {
        const idArr = Array.from(itemIds);
        const titleArr = Array.from(itemTitles);
        const idPlaceholders = idArr.map(() => "?").join(",");
        const titlePlaceholders = titleArr.map(() => "?").join(",");

        let whereClause = "";
        let params = [];
        if (idArr.length > 0 && titleArr.length > 0) {
          whereClause = `id IN (${idPlaceholders}) OR LOWER(title) IN (${titlePlaceholders})`;
          params = [...idArr, ...titleArr];
        } else if (idArr.length > 0) {
          whereClause = `id IN (${idPlaceholders})`;
          params = idArr;
        } else if (titleArr.length > 0) {
          whereClause = `LOWER(title) IN (${titlePlaceholders})`;
          params = titleArr;
        }

        if (whereClause) {
          const selectCols = isAnime
            ? "id, title, MalID, genres, aired, status, type, provider, CustomTag"
            : "id, title, MalID, genres, released as aired, status, type, provider, CustomTag";
          const mediaRows = await global.db
            .prepare(
              `SELECT ${selectCols} FROM ${mediaTable} WHERE ${whereClause}`,
            )
            .all(...params);
          mediaRows?.forEach((r) => {
            if (r.MalID) malIdSet.add(String(r.MalID));
            if (r.id) mediaMetaMap.set(String(r.id), r);
            if (r.title) {
              mediaMetaMap.set(
                "title:" + String(r.title).toLowerCase().trim(),
                r,
              );
            }
          });
        }
      } catch (_) {}
    }

    // 2. Batch query MyAnimeList / MyMangaList
    const malMap = new Map();
    if (global.db && global.MalLoggedIn) {
      try {
        const malIdArr = Array.from(malIdSet);
        const titleArr = Array.from(itemTitles);
        const malPlaceholders = malIdArr.map(() => "?").join(",");
        const titlePlaceholders = titleArr.map(() => "?").join(",");

        let malWhere = "";
        let malParams = [];
        if (malIdArr.length > 0 && titleArr.length > 0) {
          malWhere = `id IN (${malPlaceholders}) OR LOWER(title) IN (${titlePlaceholders})`;
          malParams = [...malIdArr, ...titleArr];
        } else if (malIdArr.length > 0) {
          malWhere = `id IN (${malPlaceholders})`;
          malParams = malIdArr;
        } else if (titleArr.length > 0) {
          malWhere = `LOWER(title) IN (${titlePlaceholders})`;
          malParams = titleArr;
        }

        if (malWhere) {
          const selectCols = isAnime
            ? "id, title, totalEpisodes, watched, status"
            : "id, title, totalChapters AS totalEpisodes, read AS watched, status";
          const malRows = await global.db
            .prepare(`SELECT ${selectCols} FROM ${listTable} WHERE ${malWhere}`)
            .all(...malParams);

          malRows?.forEach((r) => {
            if (r.id) {
              malMap.set(String(r.id), r);
              malIdSet.add(String(r.id));
            }
            if (r.title) {
              malMap.set("title:" + String(r.title).toLowerCase().trim(), r);
            }
          });
        }
      } catch (_) {}
    }

    // Also look up sibling IDs in Anime/Manga table for all resolved MalIDs so WatchHistory matches
    if (global.db && malIdSet.size > 0) {
      try {
        const malIdArr = Array.from(malIdSet);
        const placeholders = malIdArr.map(() => "?").join(",");
        const siblingRows = await global.db
          .prepare(
            `SELECT id FROM ${mediaTable} WHERE MalID IN (${placeholders})`,
          )
          .all(...malIdArr);
        siblingRows?.forEach((r) => {
          if (r.id) itemIds.add(String(r.id));
        });
      } catch (_) {}
    }

    // 3. Batch query WatchHistory / ReadHistory
    const histMap = new Map();
    if (global.db && (itemIds.size > 0 || itemTitles.size > 0)) {
      try {
        const idArr = Array.from(itemIds);
        const titleArr = Array.from(itemTitles);
        const idPlaceholders = idArr.map(() => "?").join(",");
        const titlePlaceholders = titleArr.map(() => "?").join(",");

        let histWhere = "";
        let histParams = [];
        if (idArr.length > 0 && titleArr.length > 0) {
          histWhere = `${idCol} IN (${idPlaceholders}) OR LOWER(${titleCol}) IN (${titlePlaceholders})`;
          histParams = [...idArr, ...titleArr];
        } else if (idArr.length > 0) {
          histWhere = `${idCol} IN (${idPlaceholders})`;
          histParams = idArr;
        } else if (titleArr.length > 0) {
          histWhere = `LOWER(${titleCol}) IN (${titlePlaceholders})`;
          histParams = titleArr;
        }

        if (histWhere) {
          const histQuery = `
            SELECT ${idCol} AS id, ${titleCol} AS title,
                   COUNT(DISTINCT CASE WHEN is_completed = 1 THEN ${epCol} END) AS completed_count,
                   COUNT(DISTINCT ${epCol}) AS watched_count,
                   MAX(${epCol}) AS max_ep,
                   MAX(is_completed) AS any_completed
            FROM ${histTable}
            WHERE ${histWhere}
            GROUP BY ${idCol}, LOWER(${titleCol})
          `;
          const histRows = await global.db
            .prepare(histQuery)
            .all(...histParams);
          histRows?.forEach((r) => {
            if (r.id) histMap.set(String(r.id), r);
            if (r.title) {
              histMap.set("title:" + String(r.title).toLowerCase().trim(), r);
            }
          });
        }
      } catch (_) {}
    }

    // 4. Batch query upcoming episodes if Anime
    const upcomingMap = new Map();
    if (isAnime && global.mappingDb && malIdSet.size > 0) {
      try {
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

        const malIdArr = Array.from(malIdSet);
        const placeholders = malIdArr.map(() => "?").join(",");
        const animeMapRows = await global.mappingDb
          .prepare(
            `SELECT malid, livechart_id FROM anime WHERE malid IN (${placeholders}) AND livechart_id IS NOT NULL`,
          )
          .all(...malIdArr);

        if (animeMapRows && animeMapRows.length > 0) {
          const lcToMal = new Map();
          const lcIds = [];
          for (const row of animeMapRows) {
            lcToMal.set(row.livechart_id, Number(row.malid));
            lcIds.push(row.livechart_id);
          }

          const lcPlaceholders = lcIds.map(() => "?").join(",");
          const epRows = await global.mappingDb
            .prepare(
              `SELECT livechart_id, episode, date FROM next_episodes WHERE livechart_id IN (${lcPlaceholders}) AND date >= ? ORDER BY date ASC`,
            )
            .all(...lcIds, localYesterdayStart);

          for (const ep of epRows || []) {
            const malId = lcToMal.get(ep.livechart_id);
            if (malId && !upcomingMap.has(malId)) {
              upcomingMap.set(malId, ep);
            }
          }
        }
      } catch (_) {}
    }

    // 5. Enrich results
    const now = Math.floor(Date.now() / 1000);
    for (const item of results) {
      if (!item) continue;

      const cleanTitle = item.title
        ? String(item.title).toLowerCase().trim()
        : "";
      const itemMalId =
        item.malid || item.MalID ? String(item.malid || item.MalID) : null;

      let malRec = null;
      if (itemMalId && malMap.has(itemMalId)) {
        malRec = malMap.get(itemMalId);
      } else if (cleanTitle && malMap.has("title:" + cleanTitle)) {
        malRec = malMap.get("title:" + cleanTitle);
      }

      if (malRec && !item.malid && malRec.id) {
        item.malid = Number(malRec.id);
        item.MalID = item.malid;
      }

      let mediaMeta = null;
      if (item.id && mediaMetaMap.has(String(item.id))) {
        mediaMeta = mediaMetaMap.get(String(item.id));
      } else if (cleanTitle && mediaMetaMap.has("title:" + cleanTitle)) {
        mediaMeta = mediaMetaMap.get("title:" + cleanTitle);
      }

      if (mediaMeta) {
        if (!item.genres && mediaMeta.genres) item.genres = mediaMeta.genres;
        if (!item.aired && mediaMeta.aired) item.aired = mediaMeta.aired;
        if (!item.status && mediaMeta.status) item.status = mediaMeta.status;
        if (!item.type && mediaMeta.type) item.type = mediaMeta.type;
        if (!item.provider && mediaMeta.provider) {
          item.provider = mediaMeta.provider;
        }
        if (!item.CustomTag && mediaMeta.CustomTag) {
          item.CustomTag = mediaMeta.CustomTag;
        }
        if (!item.malid && mediaMeta.MalID) {
          item.malid = Number(mediaMeta.MalID);
          item.MalID = item.malid;
        }
      }

      let histRec = null;
      if (item.id && histMap.has(String(item.id))) {
        histRec = histMap.get(String(item.id));
      } else if (cleanTitle && histMap.has("title:" + cleanTitle)) {
        histRec = histMap.get("title:" + cleanTitle);
      }

      let watched = 0;
      let totalEpisodes = item.totalEpisodes || item.totalChapters || 0;
      let isCompleted = false;
      let malStatus = "";

      if (malRec) {
        const malWatched = Number(malRec.watched || 0);
        const malTotal = Number(malRec.totalEpisodes || 0);
        malStatus = malRec.status || "";
        if (malWatched > 0) watched = Math.max(watched, malWatched);
        if (malTotal > 0) totalEpisodes = Math.max(totalEpisodes, malTotal);
        if (
          malStatus === "completed" ||
          (malTotal > 0 && malWatched >= malTotal)
        ) {
          isCompleted = true;
        }
      }

      if (histRec) {
        const histWatched = Number(
          histRec.max_ep || histRec.watched_count || 0,
        );
        const completedCount = Number(histRec.completed_count || 0);
        if (histWatched > 0) watched = Math.max(watched, histWatched);
        if (totalEpisodes > 0 && completedCount >= totalEpisodes) {
          isCompleted = true;
        }
      }

      if (totalEpisodes > 0 && watched >= totalEpisodes) {
        isCompleted = true;
      }

      if (watched > 0 || isCompleted || malStatus) {
        item.watched = watched;
        item.totalEpisodes = totalEpisodes || 0;
        item.isCompleted = isCompleted;
        item.malStatus = malStatus;
      }

      const resolvedMalId =
        item.malid || item.MalID ? Number(item.malid || item.MalID) : null;
      if (isAnime && resolvedMalId && upcomingMap.has(resolvedMalId)) {
        const nextEp = upcomingMap.get(resolvedMalId);
        if (nextEp) {
          if (nextEp.date < now) {
            item.nextEpisodeIn = `Ep ${nextEp.episode}: Aired`;
          } else {
            const diff = nextEp.date - now;
            const minutes = Math.ceil(diff / 60);
            const hours = Math.ceil(diff / 3600);
            const days = Math.ceil(diff / (24 * 3600));

            if (days > 0) {
              item.nextEpisodeIn = `Ep ${nextEp.episode}: ${days} day${days > 1 ? "s" : ""}`;
            } else if (hours > 0) {
              item.nextEpisodeIn = `Ep ${nextEp.episode}: ${hours} hr${hours > 1 ? "s" : ""}`;
            } else if (minutes > 0) {
              item.nextEpisodeIn = `Ep ${nextEp.episode}: ${minutes} min${minutes > 1 ? "s" : ""}`;
            } else {
              item.nextEpisodeIn = `Ep ${nextEp.episode}: soon`;
            }
          }
        }
      }
    }
  } catch (err) {
    logger.error(`Error in enrichResultsWithWatchProgress: ${err.message}`);
  }

  return results;
}

async function buildLocalCatalogWhere(AnimeManga, filters = {}, keyword = "") {
  const isAnime = AnimeManga === "Anime";
  const table = isAnime ? "anime" : "manga";

  let conditions = ["has_mapping = 1"];
  let params = [];

  if (isAnime) {
    conditions.push(
      "status NOT IN ('UPCOMING', 'NOT_YET_AIRED', 'Not yet aired', 'not_yet_aired', 'upcoming')",
    );
  } else {
    conditions.push(
      "status NOT IN ('UPCOMING', 'NOT_YET_PUBLISHED', 'not_yet_published', 'upcoming')",
    );
  }

  // MAL Status Filter (Watching, Reading, Completed, Plan to Watch/Read, On Hold, Dropped)
  if (
    filters?.malStatus &&
    filters.malStatus !== "All" &&
    filters.malStatus !== ""
  ) {
    if (!global.MalLoggedIn) {
      conditions.push("1 = 0");
    } else {
      const listTable = isAnime ? "MyAnimeList" : "MyMangaList";
      let targetStatus = String(filters.malStatus).toLowerCase();
      if (isAnime && targetStatus === "reading") targetStatus = "watching";
      if (!isAnime && targetStatus === "watching") targetStatus = "reading";
      if (isAnime && targetStatus === "plan_to_read")
        targetStatus = "plan_to_watch";
      if (!isAnime && targetStatus === "plan_to_watch")
        targetStatus = "plan_to_read";

      try {
        const rows = await queryAll(
          `SELECT id FROM ${listTable} WHERE status = ?`,
          [targetStatus],
        );
        const ids = (rows || [])
          .map((r) => Number(r.id))
          .filter((id) => !isNaN(id) && id > 0);

        if (ids.length === 0) {
          conditions.push("1 = 0");
        } else if (ids.length <= 900) {
          const placeholders = ids.map(() => "?").join(",");
          conditions.push(`malid IN (${placeholders})`);
          params.push(...ids);
        } else {
          const safeIds = ids.join(",");
          conditions.push(`malid IN (${safeIds})`);
        }
      } catch (err) {
        logger.error(
          `Error querying ${listTable} for status ${targetStatus}: ${err.message}`,
        );
        conditions.push("1 = 0");
      }
    }
  }

  const searchKeyword = (
    keyword ||
    filters?.keyword ||
    filters?.query ||
    ""
  ).trim();
  if (searchKeyword) {
    conditions.push("(LOWER(title) LIKE ? OR CAST(malid AS TEXT) = ?)");
    params.push(`%${searchKeyword.toLowerCase()}%`, searchKeyword);
  }

  if (
    isAnime &&
    filters?.season &&
    filters.season !== "All" &&
    filters.season !== ""
  ) {
    conditions.push("LOWER(season) = ?");
    params.push(String(filters.season).toLowerCase());
  }

  if (
    isAnime &&
    filters?.year &&
    filters.year !== "All" &&
    filters.year !== ""
  ) {
    if (filters.year === "Older") {
      conditions.push("year < 2010");
    } else {
      const yrNum = Number(filters.year);
      if (!isNaN(yrNum)) {
        conditions.push("year = ?");
        params.push(yrNum);
      }
    }
  }

  if (filters?.format && filters.format !== "All" && filters.format !== "") {
    conditions.push("LOWER(type) = ?");
    params.push(String(filters.format).toLowerCase());
  }

  if (filters?.genre && filters.genre !== "All" && filters.genre !== "") {
    conditions.push("LOWER(genres) LIKE ?");
    params.push(`%${String(filters.genre).toLowerCase()}%`);
  }

  if (filters?.status && filters.status !== "All" && filters.status !== "") {
    const s = String(filters.status).toLowerCase();
    if (s === "airing" || s === "ongoing") {
      conditions.push(
        "LOWER(status) IN ('ongoing', 'currently_airing', 'currently airing', 'publishing', 'currently publishing')",
      );
    } else if (s === "completed" || s === "finished") {
      conditions.push(
        "LOWER(status) IN ('finished', 'finished_airing', 'finished airing', 'completed')",
      );
    } else {
      conditions.push("LOWER(status) = ?");
      params.push(s);
    }
  }

  const whereClause = conditions.join(" AND ");
  const orderClause = isAnime
    ? "ORDER BY (CASE WHEN year IS NULL THEN 0 ELSE year END) DESC, (CASE season WHEN 'FALL' THEN 4 WHEN 'SUMMER' THEN 3 WHEN 'SPRING' THEN 2 WHEN 'WINTER' THEN 1 ELSE 0 END) DESC, malid DESC"
    : "ORDER BY malid DESC";

  return { table, whereClause, orderClause, params };
}

function buildUniqueProviderWhere(
  AnimeManga,
  rawProvider,
  filters = {},
  keyword = "",
) {
  const provider = (rawProvider || "")
    .split("/")
    .pop()
    .toLowerCase()
    .replace(/^unique[:-]/, "")
    .replace(/^unique_/, "");

  let conditions = [
    "(provider = ? OR provider = ? OR provider LIKE ?)",
    "media_type = ?",
  ];
  let params = [provider, `@%/${provider}`, `%/${provider}`, AnimeManga];

  // Exclude any items that are already mapped in the provider's mapping table
  if (provider === "pahe") {
    conditions.push(
      "id NOT IN (SELECT id FROM pahe WHERE malid IS NOT NULL UNION SELECT uuid FROM pahe WHERE malid IS NOT NULL)",
    );
  } else if (global.mappingDb) {
    try {
      const tableCheck = global.mappingDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?")
        .get(provider);
      if (tableCheck) {
        conditions.push(
          `id NOT IN (SELECT id FROM "${provider}" WHERE malid IS NOT NULL)`,
        );
      }
    } catch (_) {}
  }

  // Also exclude any items that the user has linked locally in unlinked_mal_ids
  if (global.db) {
    try {
      const customMapped = global.db
        .prepare("SELECT id FROM unlinked_mal_ids WHERE malid IS NOT NULL")
        .all();
      if (customMapped && customMapped.length > 0) {
        const ids = customMapped.map((c) => String(c.id)).filter(Boolean);
        if (ids.length > 0) {
          conditions.push(`id NOT IN (${ids.map(() => "?").join(",")})`);
          params.push(...ids);
        }
      }
    } catch (_) {}
  }

  const searchKeyword = (
    keyword ||
    filters?.keyword ||
    filters?.query ||
    ""
  ).trim();
  if (searchKeyword) {
    conditions.push("(LOWER(name) LIKE ? OR id LIKE ?)");
    params.push(`%${searchKeyword.toLowerCase()}%`, `%${searchKeyword}%`);
  }

  if (filters?.format && filters.format !== "All" && filters.format !== "") {
    conditions.push("LOWER(type) = ?");
    params.push(String(filters.format).toLowerCase());
  }

  if (filters?.genre && filters.genre !== "All" && filters.genre !== "") {
    conditions.push("LOWER(genres) LIKE ?");
    params.push(`%${String(filters.genre).toLowerCase()}%`);
  }

  const whereClause = conditions.join(" AND ");
  return { provider, whereClause, params };
}

// Local MyAnimeList catalog provider querying mapping.db
async function getLocalCatalogList(AnimeManga, filters = {}, keyword = "") {
  const isAnime = AnimeManga === "Anime";
  const table = isAnime ? "anime" : "manga";
  const page = Math.max(1, parseInt(filters?.page || 1, 10));
  const limit = 24;
  const offset = (page - 1) * limit;

  if (!global.mappingDb) {
    return {
      currentPage: page,
      hasNextPage: false,
      results: [],
      site: "mal",
      lastFetched: null,
    };
  }

  const { whereClause, orderClause, params } = await buildLocalCatalogWhere(
    AnimeManga,
    filters,
    keyword,
  );

  let rows = [];
  try {
    rows = await global.mappingDb
      .prepare(
        `SELECT * FROM ${table} WHERE ${whereClause} ${orderClause} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit + 1, offset);
  } catch (err) {
    logger.error(`Error querying ${table} catalog: ${err.message}`);
  }

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

  // Upcoming episode lookup (if Anime)
  const nextEpMap = new Map();
  if (isAnime && global.mappingDb && pageRows.length > 0) {
    try {
      const lcIds = pageRows.map((r) => r.livechart_id).filter(Boolean);
      if (lcIds.length > 0) {
        const placeholders = lcIds.map(() => "?").join(",");
        const now = Math.floor(Date.now() / 1000);
        const epRows = await global.mappingDb
          .prepare(
            `SELECT livechart_id, episode, date FROM next_episodes WHERE livechart_id IN (${placeholders}) AND date > ?`,
          )
          .all(...lcIds, now);
        epRows?.forEach((ep) => {
          if (
            !nextEpMap.has(ep.livechart_id) ||
            ep.date < nextEpMap.get(ep.livechart_id).date
          ) {
            nextEpMap.set(ep.livechart_id, ep);
          }
        });
      }
    } catch (_) {}
  }

  const setting = await settingfetch();
  const preferred = (
    isAnime
      ? setting?.Animeprovider || "pahe"
      : setting?.Mangaprovider || "weebcentral"
  ).toLowerCase();

  const results = await Promise.all(
    (pageRows || []).map(async (r) => {
      let nextEpisodeIn = null;
      if (r.livechart_id && nextEpMap.has(r.livechart_id)) {
        const nextEp = nextEpMap.get(r.livechart_id);
        const now = Math.floor(Date.now() / 1000);
        const diff = nextEp.date - now;
        const days = Math.ceil(diff / (24 * 3600));
        const hours = Math.ceil(diff / 3600);
        if (days > 0) {
          nextEpisodeIn = `Ep ${nextEp.episode}: ${days} day${days > 1 ? "s" : ""}`;
        } else if (hours > 0) {
          nextEpisodeIn = `Ep ${nextEp.episode}: ${hours} hr${hours > 1 ? "s" : ""}`;
        } else {
          nextEpisodeIn = `Ep ${nextEp.episode}: soon`;
        }
      }

      let resolvedProvider = null;
      let resolvedId = null;

      try {
        const best = await getBestProviderForMalId(
          r.malid,
          AnimeManga,
          preferred,
        );
        if (best) {
          resolvedProvider = best.provider;
          resolvedId = best.id;
        }
      } catch (_) {}

      return {
        id: resolvedId ? String(resolvedId) : String(r.malid),
        malid: Number(r.malid),
        MalID: Number(r.malid),
        title: r.title,
        image: r.image_url,
        type: r.type,
        episodes: r.episodes,
        chapters: r.chapters,
        volumes: r.volumes,
        status: r.status,
        season: r.season,
        year: r.year,
        genres: r.genres,
        aired: r.year ? `${r.season ? r.season + " " : ""}${r.year}` : null,
        nextEpisodeIn,
        provider: resolvedProvider || preferred,
        isMapped: !!resolvedProvider,
      };
    }),
  );

  let lastFetched = null;
  if (global.mappingDb) {
    try {
      const syncRow = await global.mappingDb
        .prepare(
          "SELECT last_run FROM sync_history WHERE task_name = 'mapping_db_version' OR task_name = 'updateMALSeasons' ORDER BY last_run DESC LIMIT 1",
        )
        .get();
      lastFetched = syncRow?.last_run || null;
    } catch (_) {}
  }

  return {
    currentPage: page,
    hasNextPage,
    results,
    site: "mal",
    lastFetched,
    malLoggedIn: !!global.MalLoggedIn,
  };
}

// Unique unmapped provider catalog list
async function getUniqueProviderList(
  AnimeManga,
  rawProvider,
  filters = {},
  keyword = "",
) {
  const page = Math.max(1, parseInt(filters?.page || 1, 10));
  const limit = 24;
  const offset = (page - 1) * limit;

  if (!global.mappingDb) {
    return {
      currentPage: page,
      hasNextPage: false,
      results: [],
      site: rawProvider,
      lastFetched: null,
    };
  }

  const { provider, whereClause, params } = buildUniqueProviderWhere(
    AnimeManga,
    rawProvider,
    filters,
    keyword,
  );

  // Get last_fetched from unmapped_items
  let lastFetched = null;
  try {
    const row = await global.mappingDb
      .prepare(
        "SELECT MAX(last_fetched) as last_fetched FROM unmapped_items WHERE provider = ?",
      )
      .get(provider);
    lastFetched = row?.last_fetched || null;
  } catch (_) {}

  let rows = [];
  try {
    rows = await global.mappingDb
      .prepare(
        `SELECT * FROM unmapped_items WHERE ${whereClause} ORDER BY name ASC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit + 1, offset);
  } catch (err) {
    logger.error(
      `Error querying unmapped items for ${provider}: ${err.message}`,
    );
  }

  const hasNextPage = rows.length > limit;
  const pageRows = hasNextPage ? rows.slice(0, limit) : rows;

  const results = (pageRows || []).map((r) => ({
    id: r.id,
    title: r.name,
    image: r.image_url,
    type: r.type,
    episodes: r.episodes,
    status: r.status,
    season: r.season,
    year: r.year,
    aired: r.year ? `${r.season ? r.season + " " : ""}${r.year}` : null,
    provider: r.provider,
    isUnmapped: true,
  }));

  // Fast batch enrich of missing images from local DB and MAL mapping table
  const titles = results
    .map((r) => (r.title || "").toLowerCase().trim())
    .filter(Boolean);

  if (titles.length > 0) {
    if (global.db) {
      try {
        const table = AnimeManga === "Anime" ? "Anime" : "Manga";
        const placeholders = titles.map(() => "?").join(",");
        const localRows = await global.db
          .prepare(
            `SELECT LOWER(TRIM(title)) as t, image_url FROM ${table} WHERE LOWER(TRIM(title)) IN (${placeholders}) AND image_url IS NOT NULL`,
          )
          .all(...titles);
        const map = new Map(localRows.map((r) => [r.t, r.image_url]));
        for (const item of results) {
          if (!item.image) {
            const t = (item.title || "").toLowerCase().trim();
            if (map.has(t)) item.image = map.get(t);
          }
        }
      } catch (_) {}
    }

    if (global.mappingDb) {
      try {
        const malTable = AnimeManga === "Anime" ? "anime" : "manga";
        const placeholders = titles.map(() => "?").join(",");
        const malRows = await global.mappingDb
          .prepare(
            `SELECT LOWER(TRIM(title)) as t, image_url FROM ${malTable} WHERE LOWER(TRIM(title)) IN (${placeholders}) AND image_url IS NOT NULL`,
          )
          .all(...titles);
        const map = new Map(malRows.map((r) => [r.t, r.image_url]));
        for (const item of results) {
          if (!item.image) {
            const t = (item.title || "").toLowerCase().trim();
            if (map.has(t)) item.image = map.get(t);
          }
        }
      } catch (_) {}
    }
  }

  for (const item of results) {
    if (!item.image) {
      item.image = "/images/image-404.png";
    }
  }

  const missingInDb = results.filter(
    (it) => it.image === "/images/image-404.png",
  );
  if (missingInDb.length > 0) {
    setImmediate(async () => {
      try {
        const pObj = await getProviderOrThrow(AnimeManga, provider);
        const searchFn =
          pObj?.provider?.SearchAnime ||
          pObj?.provider?.animesearch ||
          pObj?.provider?.MangaSearch ||
          pObj?.provider?.Search;
        if (typeof searchFn !== "function") return;

        for (const item of missingInDb.slice(0, 5)) {
          try {
            const sRes = await searchFn(item.title);
            const sResults = sRes?.results || (Array.isArray(sRes) ? sRes : []);
            if (sResults.length > 0) {
              const exact =
                sResults.find(
                  (s) =>
                    (s.title || "").toLowerCase().trim() ===
                    (item.title || "").toLowerCase().trim(),
                ) || sResults[0];
              const fetchedImg = exact?.image || exact?.image_url || null;
              const fetchedId =
                provider === "pahe" && exact?.id ? String(exact.id) : null;
              if (fetchedImg && global.mappingDb) {
                await global.mappingDb
                  .prepare(
                    "UPDATE unmapped_items SET image_url = ?, id = COALESCE(?, id) WHERE provider = ? AND (id = ? OR LOWER(TRIM(name)) = ?)",
                  )
                  .run(
                    fetchedImg,
                    fetchedId || null,
                    provider,
                    item.id,
                    (item.title || "").toLowerCase().trim(),
                  );
              }
            }
          } catch (_) {}
        }
      } catch (_) {}
    });
  }

  return {
    currentPage: page,
    hasNextPage,
    results,
    site: provider,
    lastFetched,
  };
}

function cleanEpCount(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return String(raw.length);
  if (typeof raw === "number" && !isNaN(raw)) return String(raw);
  if (typeof raw === "string") {
    if (raw.includes("[object")) {
      const parts = raw.split(",").filter((s) => s.includes("[object"));
      return parts.length > 0 ? String(parts.length) : null;
    }
    const trimmed = raw.trim();
    if (!isNaN(parseInt(trimmed, 10))) return String(parseInt(trimmed, 10));
    return trimmed === "?" || trimmed.toLowerCase() === "unknown"
      ? null
      : trimmed;
  }
  return null;
}

router.get("/api/providers/metadata", async (_, res) => {
  try {
    const providerMap = new Map();

    // 1. Gather all installed extensions
    const installedAnime = new Map();
    const installedManga = new Map();

    for (const p of Object.values(global.Anime_providers || {})) {
      if (p?.name) {
        const cleanName = String(p.name)
          .toLowerCase()
          .split("/")
          .pop()
          .replace(/^@/, "");
        const displayName =
          p.displayName ||
          p.display_name ||
          cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        installedAnime.set(cleanName, { cleanName, displayName });
      }
    }

    for (const p of Object.values(global.Manga_providers || {})) {
      if (p?.name) {
        const cleanName = String(p.name)
          .toLowerCase()
          .split("/")
          .pop()
          .replace(/^@/, "");
        const displayName =
          p.displayName ||
          p.display_name ||
          cleanName.charAt(0).toUpperCase() + cleanName.slice(1);
        installedManga.set(cleanName, { cleanName, displayName });
      }
    }

    const hasUnmappedResults = (cleanName, mediaType) => {
      if (!global.mappingDb) return false;
      try {
        const { whereClause, params } = buildUniqueProviderWhere(
          mediaType,
          cleanName,
          {},
          "",
        );
        const row = global.mappingDb
          .prepare(`SELECT 1 FROM unmapped_items WHERE ${whereClause} LIMIT 1`)
          .get(...params);
        return !!row;
      } catch (_) {
        return false;
      }
    };

    // 2. Only include installed Anime extensions that have unmapped results
    for (const [cleanName, info] of installedAnime.entries()) {
      if (cleanName === "anineko") continue;
      if (hasUnmappedResults(cleanName, "Anime")) {
        providerMap.set(`Anime:${cleanName}`, {
          table_name: cleanName,
          media_type: "Anime",
          primary_key_field: "id",
          display_name: info.displayName,
          last_fetched: null,
        });
      }
    }

    // 3. Only include installed Manga extensions that have unmapped results
    for (const [cleanName, info] of installedManga.entries()) {
      if (hasUnmappedResults(cleanName, "Manga")) {
        providerMap.set(`Manga:${cleanName}`, {
          table_name: cleanName,
          media_type: "Manga",
          primary_key_field: "id",
          display_name: info.displayName,
          last_fetched: null,
        });
      }
    }

    const providers = Array.from(providerMap.values()).sort((a, b) =>
      a.display_name.localeCompare(b.display_name),
    );

    res.json({ providers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Catalog listing endpoint
router.post(
  [
    "/api/list/:AnimeManga/:provider",
    "/api/list/:AnimeManga/:repoOwner/:provider",
  ],
  async (req, res) => {
    const { AnimeManga } = req.params;
    let provider = req.params.repoOwner
      ? `${req.params.repoOwner}/${req.params.provider}`
      : req.params.provider;
    let filters = {};

    if (req?.body?.filters && typeof req.body.filters === "object") {
      for (const [key, value] of Object.entries(req.body.filters)) {
        if (value != null && value !== "") {
          const num = Number(value);
          filters[key] = !isNaN(num) ? num : value;
        }
      }
    }

    try {
      if (!AnimeManga || !provider) {
        return res.status(400).json({ error: "Missing parameters" });
      }

      const config = await settingfetch();
      let data = null;
      const searchKeyword = req?.body?.keyword || req?.query?.query || "";

      if (AnimeManga === "Anime") {
        if (provider === "local") {
          data = await getAllMetadata(
            "Anime",
            config?.CustomDownloadLocation,
            filters?.page,
            filters?.tag,
            filters,
            searchKeyword,
          );
        } else if (
          provider.startsWith("unique:") ||
          provider.startsWith("unique_")
        ) {
          data = await getUniqueProviderList(
            "Anime",
            provider,
            filters,
            searchKeyword,
          );
        } else if (provider === "mal") {
          data = await getLocalCatalogList("Anime", filters, searchKeyword);
        } else if (provider === "search") {
          if (global.mappingDb) {
            data = await getLocalCatalogList("Anime", filters, searchKeyword);
          } else {
            const pObj = await getProviderOrThrow("Anime");
            data = await animesearch(pObj, searchKeyword, filters);
            data = { ...data, site: config?.Animeprovider };
          }
        } else {
          const activeProvName =
            provider === "provider"
              ? config?.Animeprovider ||
                (await reconcileActiveProvider("Anime"))
              : provider;
          const pObj = await getProviderOrThrow("Anime", activeProvName);
          if (searchKeyword) {
            data = await animesearch(pObj, searchKeyword, filters);
          } else {
            data = await latestAnime(pObj, filters);
          }
          const siteName =
            pObj?.provider_name ||
            pObj?.provider?.name ||
            activeProvName ||
            provider;
          if (data?.results && Array.isArray(data.results)) {
            for (const item of data.results) {
              if (item) {
                item.provider = siteName;
              }
            }
          }
          data = { ...data, site: siteName };
        }
      } else if (AnimeManga === "Manga") {
        if (provider === "local") {
          data = await getAllMetadata(
            "Manga",
            config?.CustomDownloadLocation,
            filters?.page,
            filters?.tag,
            filters,
            searchKeyword,
          );
        } else if (
          provider.startsWith("unique:") ||
          provider.startsWith("unique_")
        ) {
          data = await getUniqueProviderList(
            "Manga",
            provider,
            filters,
            searchKeyword,
          );
        } else if (provider === "mal") {
          data = await getLocalCatalogList("Manga", filters, searchKeyword);
        } else if (provider === "search") {
          if (global.mappingDb) {
            data = await getLocalCatalogList("Manga", filters, searchKeyword);
          } else {
            const pObj = await getProviderOrThrow("Manga");
            data = await MangaSearch(
              pObj,
              searchKeyword,
              filters?.page,
              filters,
            );
            data = { ...data, site: config?.Mangaprovider };
          }
        } else {
          const activeProvName =
            provider === "provider"
              ? config?.Mangaprovider ||
                (await reconcileActiveProvider("Manga"))
              : provider;
          const pObj = await getProviderOrThrow("Manga", activeProvName);
          if (searchKeyword) {
            data = await MangaSearch(
              pObj,
              searchKeyword,
              filters?.page,
              filters,
            );
          } else {
            data = await latestMangas(pObj, filters?.page, filters);
          }
          const siteName =
            pObj?.provider_name ||
            pObj?.provider?.name ||
            activeProvName ||
            provider;
          if (data?.results && Array.isArray(data.results)) {
            for (const item of data.results) {
              if (item) {
                item.provider = siteName;
              }
            }
          }
          data = { ...data, site: siteName };
        }
      }

      if (!data) throw new Error(`No ${AnimeManga} Found in ${provider}`);

      if (data?.results && data.results.length > 0) {
        try {
          await enrichResultsWithMappingImages(data.results, AnimeManga);
        } catch (_) {}

        try {
          if (provider !== "local") {
            await enrichResultsWithWatchProgress(data.results, AnimeManga);
          }
        } catch (_) {}

        try {
          if (provider === "local") {
            const orderKey = `custom_order_${AnimeManga}_local_${filters?.tag || "all"}`;
            const savedOrder = await getKeyValue("Settings", orderKey);
            if (
              savedOrder &&
              Array.isArray(savedOrder) &&
              savedOrder.length > 0
            ) {
              const orderMap = new Map();
              savedOrder.forEach((id, idx) => orderMap.set(id, idx));
              data.results.sort((a, b) => {
                const indexA = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
                const indexB = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
                return indexA - indexB;
              });
            }
          }
        } catch (_) {}
      }

      return res.json(data);
    } catch (err) {
      logger.error(
        `Failed To Fetch ${provider} ${AnimeManga} page ${filters?.page}`,
      );
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
      res.json({
        totalPages: 0,
        currentPage: 1,
        hasNextPage: false,
        totalItems: 0,
        results: [],
        error: true,
        message: err.message,
        extension_missing:
          err?.message?.includes("Missing Provider!") ||
          err?.message?.includes("not found") ||
          err?.message?.includes("Provider "),
      });
    }
  },
);

router.post(
  [
    "/api/count/:AnimeManga/:provider",
    "/api/count/:AnimeManga/:repoOwner/:provider",
    "/api/list/:AnimeManga/:provider/count",
    "/api/list/:AnimeManga/:repoOwner/:provider/count",
  ],
  async (req, res) => {
    const { AnimeManga } = req.params;
    let provider = req.params.repoOwner
      ? `${req.params.repoOwner}/${req.params.provider}`
      : req.params.provider;

    let filters = {};
    if (req?.body?.filters && typeof req.body.filters === "object") {
      for (const [key, value] of Object.entries(req.body.filters)) {
        if (value != null && value !== "") {
          const num = Number(value);
          filters[key] = !isNaN(num) ? num : value;
        }
      }
    }
    const searchKeyword = req?.body?.keyword || req?.query?.query || "";

    if (!global.mappingDb) {
      return res.json({ count: 0 });
    }

    try {
      let count = 0;
      if (provider.startsWith("unique:") || provider.startsWith("unique_")) {
        const { whereClause, params } = buildUniqueProviderWhere(
          AnimeManga,
          provider,
          filters,
          searchKeyword,
        );
        const row = await global.mappingDb
          .prepare(
            `SELECT COUNT(*) as count FROM unmapped_items WHERE ${whereClause}`,
          )
          .get(...params);
        count = row?.count || 0;
      } else {
        const { table, whereClause, params } = await buildLocalCatalogWhere(
          AnimeManga,
          filters,
          searchKeyword,
        );
        const row = await global.mappingDb
          .prepare(
            `SELECT COUNT(*) as count FROM ${table} WHERE ${whereClause}`,
          )
          .get(...params);
        count = row?.count || 0;
      }
      return res.json({ count });
    } catch (err) {
      logger.error(`Error in count endpoint for ${provider}: ${err.message}`);
      return res.json({ count: 0 });
    }
  },
);

// Weekly episode schedule
router.get("/api/schedule/weekly", async (_, res) => {
  try {
    const localToday = new Date();
    const todayStart =
      new Date(
        localToday.getFullYear(),
        localToday.getMonth(),
        localToday.getDate(),
        0,
        0,
        0,
      ).getTime() / 1000;
    const yesterdayStart = todayStart - 24 * 3600;
    const limitEnd = todayStart + 7 * 24 * 3600;

    const episodes = await global.mappingDb
      .prepare(
        `
        SELECT ne.livechart_id, ne.episode, ne.date, ne.title, COALESCE(a.image_url, ne.image, '/images/image-404.png') AS image, ne.image AS scraper_image, a.malid
        FROM next_episodes ne
        LEFT JOIN anime a ON ne.livechart_id = a.livechart_id
        WHERE ne.date >= ? AND ne.date <= ?
        GROUP BY ne.livechart_id, DATE(ne.date, 'unixepoch')
        ORDER BY ne.date ASC
      `,
      )
      .all(yesterdayStart, limitEnd);

    res.json({
      results: episodes,
      updating: !!global.livechart_updating,
    });
  } catch (err) {
    logger.error(`Error in /api/schedule/weekly: ${err.message}`);
    res.status(500).json({ error: true, message: err.message });
  }
});

async function healProviderId(
  providerObj,
  { oldId, malid, title, folderName },
) {
  if (!providerObj || !oldId) return null;
  const cleanOldId = String(oldId).trim();
  let newId = null;

  if (typeof providerObj.healId === "function") {
    try {
      newId = await providerObj.healId({
        oldId: cleanOldId,
        malid,
        title,
        folderName,
      });
    } catch (err) {
      logger.error(
        `[healProviderId] Error healing ID for ${providerObj.name || "provider"}: ${err.message}`,
      );
    }
  }

  if (newId && newId !== cleanOldId) {
    try {
      if (global.db) {
        await global.db
          .prepare(
            "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
          )
          .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);

        await global.db
          .prepare(
            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
          )
          .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);

        await global.db
          .prepare(
            "UPDATE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
          )
          .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);

        try {
          await global.db
            .prepare(
              "UPDATE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
            )
            .run(cleanOldId, newId, cleanOldId, `${cleanOldId}-%`);
        } catch (_) {}
      }

      if (typeof global.sendToRenderer === "function") {
        global.sendToRenderer("anime-id-updated", {
          oldId: cleanOldId,
          newId: newId,
          provider: providerObj.name || "Anime",
          mediaType: "Anime",
        });
      }

      logger.info(
        `[healProviderId] Successfully updated Anime ID from ${cleanOldId} to ${newId}`,
      );
      return newId;
    } catch (dbErr) {
      logger.error(
        `[healProviderId] Failed to update resolved ID in database: ${dbErr.message}`,
      );
    }
  }

  return null;
}

// Fetches Anime / Manga Info
router.post(
  [
    "/api/info/:AnimeManga/:LocalMalProvider",
    "/api/info/:AnimeManga/:repoOwner/:LocalMalProvider",
  ],
  async (req, res) => {
    const { AnimeManga } = req.params;
    let LocalMalProvider = req.params.repoOwner
      ? `${req.params.repoOwner}/${req.params.LocalMalProvider}`
      : req.params.LocalMalProvider;
    let { id } = req.body;

    const data = {
      MalLoggedIn: !!global?.MalLoggedIn,
    };
    let provider = null;

    const setting = await settingfetch();

    try {
      if (!id) throw new Error("ID IS Missing");

      try {
        const AnimeLocalInfo = await FindMapping(
          AnimeManga,
          id,
          null,
          setting.CustomDownloadLocation,
        );
        if (AnimeLocalInfo && AnimeLocalInfo.id) {
          Object.assign(data, AnimeLocalInfo);
          data.genres = AnimeLocalInfo?.genres
            ? AnimeLocalInfo.genres.split(",")
            : [];
          provider = AnimeLocalInfo?.provider;
        } else {
          throw new Error("Metadata not found locally");
        }
      } catch (err) {
        if (LocalMalProvider === "local") {
          let resolvedId = null;
          let resolvedProvider = null;
          let resolvedMalId = null;

          if (global.db && id) {
            try {
              const unlinkedRow = await global.db
                .prepare("SELECT malid FROM unlinked_mal_ids WHERE id = ?")
                .get(id);
              if (unlinkedRow && unlinkedRow.malid) {
                resolvedMalId = parseInt(unlinkedRow.malid);
              }
            } catch (_) {}

            let fallbackTitle = null;
            if (!resolvedMalId) {
              try {
                let localRow = await global.db
                  .prepare(
                    `SELECT MalID, id, provider FROM ${AnimeManga} WHERE id = ? OR folder_name = ? OR LOWER(title) = LOWER(?) LIMIT 1`,
                  )
                  .get(id, id, id);
                if (!localRow) {
                  const histTable =
                    AnimeManga === "Anime" ? "WatchHistory" : "ReadHistory";
                  const idCol =
                    AnimeManga === "Anime" ? "anime_id" : "manga_id";
                  const titleCol =
                    AnimeManga === "Anime" ? "anime_title" : "manga_title";
                  const histRow = await global.db
                    .prepare(
                      `SELECT ${titleCol} FROM ${histTable} WHERE ${idCol} = ? LIMIT 1`,
                    )
                    .get(id);
                  if (histRow && histRow[titleCol]) {
                    fallbackTitle = histRow[titleCol];
                    localRow = await global.db
                      .prepare(
                        `SELECT MalID, id, provider FROM ${AnimeManga} WHERE LOWER(title) = LOWER(?) LIMIT 1`,
                      )
                      .get(fallbackTitle);
                  }
                }
                if (localRow) {
                  if (localRow.MalID) {
                    resolvedMalId = parseInt(localRow.MalID);
                  }
                  resolvedId = localRow.id;
                  resolvedProvider = localRow.provider || "pahe";
                }
              } catch (_) {}
            }
          }

          if (!resolvedMalId && global.mappingDb && id) {
            try {
              const foundMalId = await resolveMalIdFromMapping({
                id,
                mediaType: AnimeManga,
                installedOnly: true,
              });
              if (foundMalId) {
                resolvedMalId = foundMalId;
                const preferred = (
                  AnimeManga === "Anime"
                    ? setting.Animeprovider || "pahe"
                    : setting.Mangaprovider || "weebcentral"
                ).toLowerCase();
                const best = await getBestProviderForMalId(
                  resolvedMalId,
                  AnimeManga,
                  preferred,
                );
                if (best) {
                  resolvedId = best.id;
                  resolvedProvider = best.provider;
                }
              }
            } catch (_) {}
          }

          if (!resolvedId && AnimeManga === "Anime" && id) {
            try {
              const preferred = (setting.Animeprovider || "").toLowerCase();
              const providerToHeal =
                (global.Anime_providers &&
                  (global.Anime_providers[preferred] ||
                    global.Anime_providers[setting.Animeprovider])) ||
                (global.Anime_providers &&
                  Object.values(global.Anime_providers)[0]) ||
                null;
              const healedId = await healProviderId(providerToHeal, {
                oldId: id,
                title: fallbackTitle || data?.title,
                malid: resolvedMalId,
              });
              if (healedId) {
                resolvedId = healedId;
                resolvedProvider = providerToHeal?.name || preferred;
                if (global.db) {
                  const healedRow = await global.db
                    .prepare(
                      "SELECT MalID, id, provider FROM Anime WHERE id = ? LIMIT 1",
                    )
                    .get(healedId);
                  if (healedRow) {
                    if (healedRow.MalID)
                      resolvedMalId = parseInt(healedRow.MalID);
                    resolvedProvider = healedRow.provider || resolvedProvider;
                  }
                }
              }
            } catch (_) {}
          }

          if (resolvedId && resolvedProvider) {
            resolvedId = String(resolvedId);
            id = resolvedId;
            LocalMalProvider = resolvedProvider;
            provider = resolvedProvider;
            data.id = resolvedId;
            data.provider = resolvedProvider;
            data.malid = resolvedMalId;
          } else {
            throw new Error(`No ${AnimeManga} Found with id '${id}'`);
          }
        } else if (LocalMalProvider === "mal") {
          let resolvedId = null;
          let resolvedProvider = null;
          let targetMalId = Number(id);

          if (isNaN(targetMalId)) {
            try {
              const found = await resolveMalIdFromMapping({
                id,
                mediaType: AnimeManga,
              });
              if (found) {
                targetMalId = Number(found);
              }
            } catch (_) {}
          }

          const preferred = (
            AnimeManga === "Anime"
              ? setting.Animeprovider || "pahe"
              : setting.Mangaprovider || "weebcentral"
          ).toLowerCase();

          if (targetMalId && !isNaN(targetMalId)) {
            const best = await getBestProviderForMalId(
              targetMalId,
              AnimeManga,
              preferred,
            );
            if (best) {
              resolvedId = best.id;
              resolvedProvider = best.provider;
            }
          }

          if (!resolvedId && global.mappingDb && id) {
            try {
              const unmapped = await global.mappingDb
                .prepare(
                  "SELECT provider FROM unmapped_items WHERE id = ? LIMIT 1",
                )
                .get(id);
              if (unmapped?.provider) {
                resolvedId = id;
                resolvedProvider = unmapped.provider;
              }
            } catch (_) {}
          }

          if (resolvedId && resolvedProvider) {
            resolvedId = String(resolvedId);
            id = resolvedId;
            LocalMalProvider = resolvedProvider;
            provider = resolvedProvider;
            data.id = resolvedId;
            data.provider = resolvedProvider;
            data.malid =
              targetMalId && !isNaN(targetMalId) ? targetMalId : null;
          } else {
            throw new Error(
              `This ${AnimeManga.toLowerCase()} is not mapped to any provider yet.`,
            );
          }
        }
      }

      if (
        LocalMalProvider !== "local" ||
        (provider && provider !== "local source")
      ) {
        try {
          if (AnimeManga === "Anime") {
            const Animeprovider = await providerFetch(
              "Anime",
              (LocalMalProvider !== "local" && LocalMalProvider !== "provider"
                ? LocalMalProvider
                : provider) ?? null,
            );
            const lookupId = id;
            let AnimeInfo = null;
            try {
              AnimeInfo = await animeinfo(
                Animeprovider,
                setting?.CustomDownloadLocation,
                lookupId,
                data?.provider ? false : true,
              );
            } catch (fetchErr) {
              logger.warn(
                `Failed to fetch initial online metadata for ${lookupId}: ${fetchErr.message}`,
              );
            }

            if (
              typeof Animeprovider.healId === "function" &&
              (!AnimeInfo ||
                !AnimeInfo.title ||
                AnimeInfo.results ||
                AnimeInfo.needsMappingSync)
            ) {
              let newId =
                AnimeInfo?.newUuid && AnimeInfo.newUuid !== lookupId
                  ? AnimeInfo.newUuid
                  : null;
              if (!newId || newId === lookupId) {
                newId = await healProviderId(Animeprovider, {
                  oldId: lookupId,
                  title: data.title,
                  malid: data.malid,
                });
              }
              if (newId && newId !== lookupId) {
                AnimeInfo = await animeinfo(
                  Animeprovider,
                  setting?.CustomDownloadLocation,
                  newId,
                  false,
                );
                id = newId;
                data.id = newId;
              }

              if (typeof global.sendToRenderer === "function") {
                global.sendToRenderer("info-loading-status", {
                  text: "",
                });
              }
            }

            if (AnimeInfo) {
              Object.assign(data, AnimeInfo);

              try {
                await global.db
                  .prepare(
                    `UPDATE Anime SET description = ?, status = ?, genres = ?, aired = ?, image_url = ?, provider = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                  )
                  .run(
                    AnimeInfo.description || "",
                    AnimeInfo.status || "",
                    Array.isArray(AnimeInfo.genres)
                      ? AnimeInfo.genres.join(",")
                      : AnimeInfo.genres || "",
                    AnimeInfo.aired || "",
                    AnimeInfo.image_url || AnimeInfo.image || "",
                    Animeprovider.provider_name,
                    id,
                  );
              } catch (dbErr) {
                logger.error(
                  `Failed to update local metadata for Anime ${id}: ${dbErr.message}`,
                );
              }
            }
            data.provider = Animeprovider.provider_name;

            if (
              !data.malid &&
              Array.isArray(Animeprovider?.provider?.MappingRules)
            ) {
              for (const rule of Animeprovider.provider.MappingRules) {
                if (typeof rule?.extractMalId === "function") {
                  try {
                    const m = rule.extractMalId(AnimeInfo);
                    if (m) {
                      data.malid = Number(m);
                      break;
                    }
                  } catch (_) {}
                }
              }
            }

            const provName = Animeprovider.provider_name;
            const cleanProv = (provName || "").toLowerCase().split("/").pop();
            const targetProvider =
              provName && (provName.startsWith("@") || provName.includes("/"))
                ? provName.toLowerCase().startsWith("theyogmehta/")
                  ? cleanProv
                  : provName.startsWith("@")
                    ? provName.trim()
                    : `@${provName.trim()}`
                : cleanProv;

            const safeAnimeApi = {
              isMapped: async (itemId) => {
                if (!global.mappingDb) return false;
                const tid = String(itemId || id);
                try {
                  let row = null;
                  if (cleanProv === "pahe") {
                    row = await global.mappingDb
                      .prepare(
                        "SELECT malid FROM pahe WHERE (id = ? OR uuid = ?) AND malid IS NOT NULL LIMIT 1",
                      )
                      .get(tid, tid);
                  } else {
                    row = await global.mappingDb
                      .prepare(
                        `SELECT malid FROM "${cleanProv}" WHERE id = ? AND malid IS NOT NULL LIMIT 1`,
                      )
                      .get(tid);
                  }
                  return !!(row && row.malid);
                } catch (_) {
                  return false;
                }
              },
              getMappedMalId: async (itemId) => {
                if (!global.mappingDb) return null;
                const tid = String(itemId || id);
                try {
                  let row = null;
                  if (cleanProv === "pahe") {
                    row = await global.mappingDb
                      .prepare(
                        "SELECT malid FROM pahe WHERE (id = ? OR uuid = ?) AND malid IS NOT NULL LIMIT 1",
                      )
                      .get(tid, tid);
                  } else {
                    row = await global.mappingDb
                      .prepare(
                        `SELECT malid FROM "${cleanProv}" WHERE id = ? AND malid IS NOT NULL LIMIT 1`,
                      )
                      .get(tid);
                  }
                  return row && row.malid ? Number(row.malid) : null;
                } catch (_) {
                  return null;
                }
              },
              saveUnmapped: async (unmappedData) => {
                if (!unmappedData || !global.mappingDb) return;
                const targetId = String(unmappedData.id || id);

                try {
                  if (global.db) {
                    const customRow = await global.db
                      .prepare(
                        "SELECT malid FROM unlinked_mal_ids WHERE id = ? AND malid IS NOT NULL LIMIT 1",
                      )
                      .get(targetId);
                    if (customRow && customRow.malid) {
                      await global.mappingDb
                        .prepare(
                          "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                        )
                        .run(
                          targetProvider,
                          cleanProv,
                          provName,
                          targetId,
                          targetId,
                        );
                      return;
                    }
                  }

                  let mappedRow = null;
                  if (cleanProv === "pahe") {
                    mappedRow = await global.mappingDb
                      .prepare(
                        "SELECT malid FROM pahe WHERE (id = ? OR uuid = ?) AND malid IS NOT NULL LIMIT 1",
                      )
                      .get(targetId, targetId);
                  } else {
                    mappedRow = await global.mappingDb
                      .prepare(
                        `SELECT malid FROM "${cleanProv}" WHERE id = ? AND malid IS NOT NULL LIMIT 1`,
                      )
                      .get(targetId);
                  }
                  if (mappedRow && mappedRow.malid) {
                    await global.mappingDb
                      .prepare(
                        "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                      )
                      .run(
                        targetProvider,
                        cleanProv,
                        provName,
                        targetId,
                        targetId,
                      );
                    return;
                  }

                  // Guard: Check if series title matches canonical anime in mapping.db
                  const checkTitle = (
                    unmappedData.name ||
                    unmappedData.title ||
                    data.title ||
                    ""
                  ).trim();
                  if (checkTitle) {
                    const matchAnime = await global.mappingDb
                      .prepare(
                        "SELECT malid FROM anime WHERE LOWER(TRIM(title)) = LOWER(TRIM(?)) LIMIT 1",
                      )
                      .get(checkTitle);
                    if (matchAnime && matchAnime.malid) {
                      if (cleanProv === "pahe") {
                        await global.mappingDb
                          .prepare(
                            "INSERT OR REPLACE INTO pahe (id, uuid, malid) VALUES (?, ?, ?)",
                          )
                          .run(targetId, targetId, matchAnime.malid);
                      } else {
                        await global.mappingDb
                          .prepare(
                            `INSERT OR REPLACE INTO "${cleanProv}" (id, malid) VALUES (?, ?)`,
                          )
                          .run(targetId, matchAnime.malid);
                      }
                      await global.mappingDb
                        .prepare(
                          "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                        )
                        .run(
                          targetProvider,
                          cleanProv,
                          provName,
                          targetId,
                          targetId,
                        );
                      return;
                    }
                  }
                } catch (_) {}

                try {
                  await global.mappingDb
                    .prepare(
                      `INSERT OR REPLACE INTO unmapped_items (
                      id, provider, media_type, name, image_url, type, episodes, status, season, year, last_fetched
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                    )
                    .run(
                      targetId,
                      targetProvider,
                      "Anime",
                      unmappedData.name ||
                        unmappedData.title ||
                        data.title ||
                        "Unknown",
                      unmappedData.image_url ||
                        unmappedData.image ||
                        data.image_url ||
                        null,
                      unmappedData.type || data.type || "TV",
                      cleanEpCount(unmappedData.episodes) ||
                        cleanEpCount(data.episodes) ||
                        (data.totalEpisodes
                          ? String(data.totalEpisodes)
                          : null),
                      unmappedData.status || data.status || "Unknown",
                      unmappedData.season || data.season || null,
                      unmappedData.year
                        ? parseInt(unmappedData.year, 10)
                        : data.year
                          ? parseInt(data.year, 10)
                          : null,
                    );
                } catch (_) {}

                try {
                  const axiosClient = global.axios || require("axios");
                  axiosClient
                    .post(
                      "https://strawverse.theyogmehta.online/api/unmapped/report",
                      {
                        id: targetId,
                        provider: targetProvider,
                        media_type: "Anime",
                        name:
                          unmappedData.name ||
                          unmappedData.title ||
                          data.title ||
                          "Unknown",
                        image_url:
                          unmappedData.image_url ||
                          unmappedData.image ||
                          data.image_url ||
                          null,
                        type: unmappedData.type || data.type || "TV",
                        episodes:
                          cleanEpCount(unmappedData.episodes) ||
                          cleanEpCount(data.episodes) ||
                          (data.totalEpisodes
                            ? String(data.totalEpisodes)
                            : null),
                        status: unmappedData.status || data.status || "Unknown",
                        season: unmappedData.season || data.season || null,
                        year: unmappedData.year
                          ? parseInt(unmappedData.year, 10)
                          : data.year
                            ? parseInt(data.year, 10)
                            : null,
                      },
                      { timeout: 5000 },
                    )
                    .catch(() => {});
                } catch (_) {}
              },
              deleteUnmapped: async (itemId) => {
                if (!global.mappingDb) return;
                try {
                  await global.mappingDb
                    .prepare(
                      "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                    )
                    .run(
                      targetProvider,
                      cleanProv,
                      provName,
                      String(itemId || id),
                      String(itemId || id),
                    );
                } catch (_) {}
              },
              reportMapping: async (mappingReport) => {
                if (!mappingReport) return;
                try {
                  const axiosClient = global.axios || require("axios");
                  await axiosClient.post(
                    "https://strawverse.theyogmehta.online/api/pahe/report",
                    mappingReport,
                    { timeout: 5000 },
                  );
                } catch (_) {}
              },
            };

            if (typeof Animeprovider?.provider?.onInfoFetched === "function") {
              try {
                await Animeprovider.provider.onInfoFetched({
                  id,
                  info: AnimeInfo,
                  api: safeAnimeApi,
                });
              } catch (extErr) {
                logger.error(
                  `[onInfoFetched] Anime provider hook error: ${extErr.message}`,
                );
              }
            }
          } else if (AnimeManga === "Manga") {
            const Mangaprovider = await providerFetch(
              "Manga",
              (LocalMalProvider !== "local" && LocalMalProvider !== "provider"
                ? LocalMalProvider
                : provider) ?? null,
            );
            const MangaInfoData = await MangaInfo(Mangaprovider, id);
            if (MangaInfoData) {
              Object.assign(data, MangaInfoData);

              try {
                await global.db
                  .prepare(
                    `UPDATE Manga SET description = ?, genres = ?, released = ?, author = ?, image_url = ?, provider = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                  )
                  .run(
                    MangaInfoData.description || "",
                    Array.isArray(MangaInfoData.genres)
                      ? MangaInfoData.genres.join(",")
                      : MangaInfoData.genres || "",
                    MangaInfoData.released || "",
                    MangaInfoData.author || "",
                    MangaInfoData.image_url || MangaInfoData.image || "",
                    Mangaprovider.provider_name,
                    id,
                  );
              } catch (dbErr) {
                logger.error(
                  `Failed to update local metadata for Manga ${id}: ${dbErr.message}`,
                );
              }
            }
            data.provider = Mangaprovider.provider_name;

            if (
              !data.malid &&
              Array.isArray(Mangaprovider?.provider?.MappingRules)
            ) {
              for (const rule of Mangaprovider.provider.MappingRules) {
                if (typeof rule?.extractMalId === "function") {
                  try {
                    const m = rule.extractMalId(MangaInfoData);
                    if (m) {
                      data.malid = Number(m);
                      break;
                    }
                  } catch (_) {}
                }
              }
            }

            if (typeof Mangaprovider?.provider?.onInfoFetched === "function") {
              try {
                const provName = Mangaprovider.provider_name;
                const cleanProv = (provName || "")
                  .toLowerCase()
                  .split("/")
                  .pop();
                const targetProvider =
                  provName &&
                  (provName.startsWith("@") || provName.includes("/"))
                    ? provName.toLowerCase().startsWith("theyogmehta/")
                      ? cleanProv
                      : provName.startsWith("@")
                        ? provName.trim()
                        : `@${provName.trim()}`
                    : cleanProv;

                const safeMangaApi = {
                  isMapped: async (itemId) => {
                    if (!global.mappingDb) return false;
                    const tid = String(itemId || id);
                    try {
                      const row = await global.mappingDb
                        .prepare(
                          `SELECT malid FROM "${cleanProv}" WHERE id = ? AND malid IS NOT NULL LIMIT 1`,
                        )
                        .get(tid);
                      return !!(row && row.malid);
                    } catch (_) {
                      return false;
                    }
                  },
                  getMappedMalId: async (itemId) => {
                    if (!global.mappingDb) return null;
                    const tid = String(itemId || id);
                    try {
                      const row = await global.mappingDb
                        .prepare(
                          `SELECT malid FROM "${cleanProv}" WHERE id = ? AND malid IS NOT NULL LIMIT 1`,
                        )
                        .get(tid);
                      return row && row.malid ? Number(row.malid) : null;
                    } catch (_) {
                      return null;
                    }
                  },
                  saveUnmapped: async (unmappedData) => {
                    if (!unmappedData || !global.mappingDb) return;
                    const targetId = String(unmappedData.id || id);

                    // Guard: If already mapped in provider table or locally linked, NEVER save to unmapped_items!
                    try {
                      if (global.db) {
                        const customRow = await global.db
                          .prepare(
                            "SELECT malid FROM unlinked_mal_ids WHERE id = ? AND malid IS NOT NULL LIMIT 1",
                          )
                          .get(targetId);
                        if (customRow && customRow.malid) {
                          await global.mappingDb
                            .prepare(
                              "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                            )
                            .run(
                              targetProvider,
                              cleanProv,
                              provName,
                              targetId,
                              targetId,
                            );
                          return;
                        }
                      }

                      const mappedRow = await global.mappingDb
                        .prepare(
                          `SELECT malid FROM "${cleanProv}" WHERE id = ? AND malid IS NOT NULL LIMIT 1`,
                        )
                        .get(targetId);
                      if (mappedRow && mappedRow.malid) {
                        await global.mappingDb
                          .prepare(
                            "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                          )
                          .run(
                            targetProvider,
                            cleanProv,
                            provName,
                            targetId,
                            targetId,
                          );
                        return;
                      }

                      // Guard: Check if series title matches canonical manga in mapping.db
                      const checkTitle = (
                        unmappedData.name ||
                        unmappedData.title ||
                        data.title ||
                        ""
                      ).trim();
                      if (checkTitle) {
                        const matchManga = await global.mappingDb
                          .prepare(
                            "SELECT malid FROM manga WHERE LOWER(TRIM(title)) = LOWER(TRIM(?)) LIMIT 1",
                          )
                          .get(checkTitle);
                        if (matchManga && matchManga.malid) {
                          const hasTbl = await global.mappingDb
                            .prepare(
                              "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
                            )
                            .get(cleanProv);
                          if (hasTbl) {
                            await global.mappingDb
                              .prepare(
                                `INSERT OR REPLACE INTO "${cleanProv}" (id, malid) VALUES (?, ?)`,
                              )
                              .run(targetId, matchManga.malid);
                          }
                          await global.mappingDb
                            .prepare(
                              "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                            )
                            .run(
                              targetProvider,
                              cleanProv,
                              provName,
                              targetId,
                              targetId,
                            );
                          return;
                        }
                      }
                    } catch (_) {}

                    try {
                      await global.mappingDb
                        .prepare(
                          `INSERT OR REPLACE INTO unmapped_items (
                          id, provider, media_type, name, image_url, type, episodes, status, season, year, last_fetched
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                        )
                        .run(
                          targetId,
                          targetProvider,
                          "Manga",
                          unmappedData.name ||
                            unmappedData.title ||
                            data.title ||
                            "Unknown",
                          unmappedData.image_url ||
                            unmappedData.image ||
                            data.image_url ||
                            null,
                          unmappedData.type || data.type || "Manga",
                          cleanEpCount(unmappedData.episodes) ||
                            cleanEpCount(unmappedData.chapters) ||
                            cleanEpCount(data.chapters) ||
                            (data.totalChapters
                              ? String(data.totalChapters)
                              : null),
                          unmappedData.status || data.status || "Unknown",
                          unmappedData.season || null,
                          unmappedData.year
                            ? parseInt(unmappedData.year, 10)
                            : data.year
                              ? parseInt(data.year, 10)
                              : null,
                        );
                    } catch (_) {}

                    try {
                      const axiosClient = global.axios || require("axios");
                      axiosClient
                        .post(
                          "https://strawverse.theyogmehta.online/api/unmapped/report",
                          {
                            id: targetId,
                            provider: targetProvider,
                            media_type: "Manga",
                            name:
                              unmappedData.name ||
                              unmappedData.title ||
                              data.title ||
                              "Unknown",
                            image_url:
                              unmappedData.image_url ||
                              unmappedData.image ||
                              data.image_url ||
                              null,
                            type: unmappedData.type || data.type || "Manga",
                            episodes:
                              cleanEpCount(unmappedData.episodes) ||
                              cleanEpCount(unmappedData.chapters) ||
                              cleanEpCount(data.chapters) ||
                              (data.totalChapters
                                ? String(data.totalChapters)
                                : null),
                            status:
                              unmappedData.status || data.status || "Unknown",
                            season: unmappedData.season || null,
                            year: unmappedData.year
                              ? parseInt(unmappedData.year, 10)
                              : data.year
                                ? parseInt(data.year, 10)
                                : null,
                          },
                          { timeout: 5000 },
                        )
                        .catch(() => {});
                    } catch (_) {}
                  },
                  deleteUnmapped: async (itemId) => {
                    if (!global.mappingDb) return;
                    try {
                      await global.mappingDb
                        .prepare(
                          "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider = ?) AND (id = ? OR id = ?)",
                        )
                        .run(
                          targetProvider,
                          cleanProv,
                          provName,
                          String(itemId || id),
                          String(itemId || id),
                        );
                    } catch (_) {}
                  },
                };

                await Mangaprovider.provider.onInfoFetched({
                  id,
                  info: MangaInfoData,
                  api: safeMangaApi,
                });
              } catch (extErr) {
                logger.error(
                  `[onInfoFetched] Manga provider hook error: ${extErr.message}`,
                );
              }
            }
          }
        } catch (err) {
          if (data && data.id) {
            logger.warn(
              `Failed to fetch online metadata for ${id} (using cached local data): ${err.message}`,
            );
          } else {
            throw err;
          }
        }
      }

      if (data && global.mappingDb) {
        try {
          const customMappingRow = await global.db
            .prepare("SELECT malid FROM unlinked_mal_ids WHERE id = ?")
            .get(id);

          let resolvedMalId = undefined;
          let isCustom = false;

          if (customMappingRow) {
            isCustom = true;
            if (customMappingRow.malid) {
              resolvedMalId = parseInt(customMappingRow.malid);
            } else {
              resolvedMalId = null;
            }
          } else if (data.malid) {
            resolvedMalId = parseInt(data.malid);
          }

          if (resolvedMalId !== undefined) {
            if (resolvedMalId !== null) {
              data.malid = resolvedMalId;
              if (isCustom) {
                try {
                  await global.db
                    .prepare(`UPDATE ${AnimeManga} SET MalID = ? WHERE id = ?`)
                    .run(String(resolvedMalId), id);
                } catch (_) {}
              }
            } else {
              data.malid = null;
              if (isCustom) {
                try {
                  await global.db
                    .prepare(
                      `UPDATE ${AnimeManga} SET MalID = NULL WHERE id = ?`,
                    )
                    .run(id);
                } catch (_) {}
              }
            }
          } else {
            if (!data.malid && global.mappingDb && id) {
              const foundMalId = await resolveMalIdFromMapping({
                id,
                mediaType: AnimeManga,
                installedOnly: true,
              });
              if (foundMalId) {
                data.malid = foundMalId;
                try {
                  await global.db
                    .prepare(`UPDATE ${AnimeManga} SET MalID = ? WHERE id = ?`)
                    .run(String(data.malid), id);
                } catch (_) {}
              }
            }
          }

          if (data.malid) {
            if (global.mappingDb) {
              try {
                const prov = data.provider || LocalMalProvider || "";
                const clean = (prov || "").toLowerCase().split("/").pop();
                global.mappingDb
                  .prepare(
                    "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider LIKE ?) AND (id = ? OR id = ?)",
                  )
                  .run(
                    clean,
                    prov,
                    `%/${clean}`,
                    String(id),
                    String(data.id || id),
                  );
              } catch (_) {}
            }
            try {
              const linkedRecords = await global.db
                .prepare(
                  `SELECT id, provider, title, folder_name FROM ${AnimeManga} WHERE MalID = ?`,
                )
                .all(String(data.malid));

              const linkedProvidersMap = {};
              linkedRecords.forEach((r) => {
                linkedProvidersMap[r.provider] = {
                  id: r.id,
                  provider: r.provider,
                  title: r.title,
                  folder_name: r.folder_name,
                };
              });

              const mappedLinked = await getLinkedProvidersForMalId(
                data.malid,
                AnimeManga,
                {
                  currentProvider: data.provider,
                  currentId: data.id || id,
                  title: data.title || "",
                  installedOnly: true,
                },
              );

              mappedLinked.forEach((p) => {
                if (!linkedProvidersMap[p.provider]) {
                  linkedProvidersMap[p.provider] = p;
                }
              });

              if (
                data.provider &&
                !linkedProvidersMap[data.provider] &&
                data.provider !== "provider" &&
                data.provider !== "local source"
              ) {
                linkedProvidersMap[data.provider] = {
                  id: data.id || id,
                  provider: data.provider,
                  title: data.title || "",
                  folder_name: data.folder_name || null,
                };
              }

              data.linkedProviders = Object.values(linkedProvidersMap);
              if (
                (!data.provider || data.provider === "local source") &&
                data.linkedProviders.length > 0
              ) {
                const activep =
                  data.linkedProviders.find(
                    (p) => p.provider && p.provider !== "local source",
                  ) || data.linkedProviders[0];
                if (activep) {
                  data.provider = activep.provider;
                  data.id = activep.id;
                }
              }
            } catch (e) {}

            if (AnimeManga === "Anime") {
              try {
                let livechartId = null;
                if (global.mappingDb) {
                  try {
                    const lcRow = await global.mappingDb
                      .prepare(
                        "SELECT livechart_id FROM anime WHERE malid = ? LIMIT 1",
                      )
                      .get(data.malid);
                    if (lcRow?.livechart_id) {
                      livechartId = lcRow.livechart_id;
                    }
                  } catch (_) {}
                }

                if (livechartId) {
                  const now = Math.floor(Date.now() / 1000);

                  let watchedEpisodes = 0;
                  try {
                    const watchedRow = await global.db
                      .prepare(
                        "SELECT MAX(episode_number) AS watched_episodes FROM WatchHistory WHERE anime_id = ?",
                      )
                      .get(id);
                    if (watchedRow && watchedRow.watched_episodes) {
                      watchedEpisodes = watchedRow.watched_episodes;
                    }
                  } catch (_) {}

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

                  const airedEp = await global.mappingDb
                    .prepare(
                      `
                    SELECT episode, date FROM next_episodes 
                    WHERE livechart_id = ? AND date <= ? 
                    ORDER BY date DESC LIMIT 1
                  `,
                    )
                    .get(livechartId, now);

                  const upcomingEp = await global.mappingDb
                    .prepare(
                      `
                    SELECT episode, date FROM next_episodes 
                    WHERE livechart_id = ? AND date > ? 
                    ORDER BY date ASC LIMIT 1
                  `,
                    )
                    .get(livechartId, now);

                  let nextEp = upcomingEp;
                  let showAired = false;
                  if (
                    airedEp &&
                    airedEp.date >= localYesterdayStart &&
                    watchedEpisodes < airedEp.episode
                  ) {
                    nextEp = airedEp;
                    showAired = true;
                  }

                  if (nextEp) {
                    if (showAired) {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: Aired`;
                    } else {
                      const diff = nextEp.date - now;
                      const minutes = Math.ceil(diff / 60);
                      const hours = Math.ceil(diff / 3600);
                      const days = Math.ceil(diff / (24 * 3600));

                      if (days > 0) {
                        data.nextEpisodeIn = `Ep ${nextEp.episode}: ${days} day${days > 1 ? "s" : ""}`;
                      } else if (hours > 0) {
                        data.nextEpisodeIn = `Ep ${nextEp.episode}: ${hours} hr${hours > 1 ? "s" : ""}`;
                      } else if (minutes > 0) {
                        data.nextEpisodeIn = `Ep ${nextEp.episode}: ${minutes} min${minutes > 1 ? "s" : ""}`;
                      } else {
                        data.nextEpisodeIn = `Ep ${nextEp.episode}: soon`;
                      }
                    }
                  }
                }
              } catch (_) {}
            }
          }

          if (!data.malid && !customMappingRow && global.mappingDb && id) {
            try {
              const prov = data.provider || LocalMalProvider || "";
              const clean = (prov || "").toLowerCase().split("/").pop();
              const targetProvider =
                prov && (prov.startsWith("@") || prov.includes("/"))
                  ? prov.toLowerCase().startsWith("theyogmehta/")
                    ? clean
                    : prov.startsWith("@")
                      ? prov.trim()
                      : `@${prov.trim()}`
                  : clean;
              global.mappingDb
                .prepare(
                  `INSERT OR REPLACE INTO unmapped_items (
                    id, provider, media_type, name, image_url, type, episodes, status, season, year, last_fetched
                  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                )
                .run(
                  String(id),
                  targetProvider,
                  AnimeManga,
                  data.title || data.name || "Unknown",
                  data.image_url || data.image || null,
                  data.type || (AnimeManga === "Anime" ? "TV" : "Manga"),
                  cleanEpCount(data.episodes) ||
                    cleanEpCount(data.chapters) ||
                    (data.totalEpisodes ? String(data.totalEpisodes) : null) ||
                    (data.totalChapters ? String(data.totalChapters) : null),
                  data.status || "Unknown",
                  data.season || null,
                  data.year ? parseInt(data.year, 10) : null,
                );

              const axiosClient = global.axios || require("axios");
              axiosClient
                .post(
                  "https://strawverse.theyogmehta.online/api/unmapped/report",
                  {
                    id: String(id),
                    provider: targetProvider,
                    media_type: AnimeManga,
                    name: data.title || data.name || "Unknown",
                    image_url: data.image_url || data.image || null,
                    type:
                      data.type || (AnimeManga === "Anime" ? "TV" : "Manga"),
                    episodes:
                      cleanEpCount(data.episodes) ||
                      cleanEpCount(data.chapters) ||
                      (data.totalEpisodes
                        ? String(data.totalEpisodes)
                        : null) ||
                      (data.totalChapters ? String(data.totalChapters) : null),
                    status: data.status || "Unknown",
                    season: data.season || null,
                    year: data.year ? parseInt(data.year, 10) : null,
                  },
                  { timeout: 5000 },
                )
                .catch(() => {});
            } catch (_) {}
          }
        } catch (mappingErr) {
          logger.error(`Error querying mappingDb: ${mappingErr.message}`);
        }
      }

      if (data.malid && global.MalLoggedIn) {
        try {
          if (AnimeManga === "Anime") {
            const MalInfo = await global.db
              .prepare("SELECT * FROM MyAnimeList WHERE id = ?")
              .get(String(data.malid));
            if (MalInfo) {
              data.watched = MalInfo.watched ?? 0;
              data.malStatus = MalInfo.status ?? "watching";
              if (MalInfo.totalEpisodes > 0) {
                data.totalEpisodes = MalInfo.totalEpisodes;
              }
            }
          } else if (AnimeManga === "Manga") {
            const MalInfo = await global.db
              .prepare("SELECT * FROM MyMangaList WHERE id = ?")
              .get(String(data.malid));
            if (MalInfo) {
              data.watched = MalInfo.read ?? 0;
              data.malStatus = MalInfo.status ?? "plan_to_read";
              if (MalInfo.totalChapters > 0) {
                data.totalChapters = MalInfo.totalChapters;
              }
            }
          }
        } catch (malDbErr) {
          logger.error(
            `Failed to load MAL list stats for resolved malid ${data.malid}: ${malDbErr.message}`,
          );
        }
      }

      try {
        let tagRow = null;
        if (AnimeManga === "Anime") {
          tagRow = await global.db
            .prepare(
              `SELECT CustomTag FROM Anime WHERE id = ? OR folder_name = ?`,
            )
            .get(id, id);
        } else {
          tagRow = await global.db
            .prepare(
              `SELECT CustomTag FROM Manga WHERE id = ? OR folder_name = ?`,
            )
            .get(id, id);
        }

        const targetMalId = data?.malid;
        if (!tagRow?.CustomTag && targetMalId) {
          const malRow = await global.db
            .prepare(
              `SELECT CustomTag FROM ${AnimeManga} WHERE MalID = ? AND CustomTag IS NOT NULL AND CustomTag != ''`,
            )
            .get(String(targetMalId));
          if (malRow && malRow.CustomTag) {
            tagRow = malRow;
          }
        }

        if (tagRow && tagRow.CustomTag) {
          data.CustomTag = tagRow.CustomTag;
        }
      } catch (tagDbErr) {
        logger.error(`Failed to load CustomTag for ${id}: ${tagDbErr.message}`);
      }

      if (data) {
        data.scraper_image = data.image || null;

        if (data.malid) {
          try {
            let remoteImg = null;
            if (global.mappingDb && AnimeManga === "Anime") {
              const imgRow = await global.mappingDb
                .prepare("SELECT image_url FROM anime WHERE malid = ?")
                .get(Number(data.malid));
              if (imgRow && imgRow.image_url) {
                remoteImg = imgRow.image_url;
              }
            }
            if (!remoteImg) {
              const listTable =
                AnimeManga === "Anime" ? "MyAnimeList" : "MyMangaList";
              const malRow = await global.db
                .prepare(
                  `SELECT image, main_picture FROM ${listTable} WHERE id = ?`,
                )
                .get(String(data.malid));
              if (malRow) {
                remoteImg = malRow.image || malRow.main_picture;
              }
            }
            if (remoteImg) {
              data.image_url = remoteImg;
              data.image = remoteImg;
              try {
                await global.db
                  .prepare(
                    `UPDATE ${AnimeManga} SET image_url = ? WHERE id = ?`,
                  )
                  .run(remoteImg, id);
              } catch (_) {}
            }
          } catch (_) {}

          const isCjkTitle = (t) => t && !/[a-zA-Z]/.test(t);
          if (
            !data.title ||
            data.title.startsWith("MAL ") ||
            isCjkTitle(data.title)
          ) {
            try {
              const titleRes = await fetch(
                `https://strawverse.theyogmehta.online/api/title/${AnimeManga}/${data.malid}`,
              );
              if (titleRes.ok) {
                const tData = await titleRes.json();
                if (tData && tData.title) {
                  data.title = tData.title;
                  try {
                    await global.db
                      .prepare(
                        `UPDATE ${AnimeManga} SET title = ? WHERE id = ?`,
                      )
                      .run(data.title, id);
                  } catch (_) {}
                }
              }
            } catch (_) {}
          }
        }
      }

      if (!data?.id) throw new Error(`No ${AnimeManga} Found with id '${id}'`);
      return res.json(data);
    } catch (err) {
      logger.error(
        `Failed To Fetch ${LocalMalProvider} ${AnimeManga} with AnimeID : '${id}'`,
      );
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
      let localTag = data?.CustomTag || "";
      if (!localTag) {
        try {
          const row = await global.db
            .prepare(`SELECT CustomTag FROM ${AnimeManga} WHERE id = ?`)
            .get(id);
          if (row) localTag = row.CustomTag || "";
        } catch (_) {}
      }
      return res.json({
        error: true,
        message: err?.message,
        CustomTag: localTag,
      });
    }
  },
);

// Fetches Anime Episodes or Manga Chapters
router.post("/api/info/items", async (req, res) => {
  let { id, page, provider, type } = req.body;
  page = parseInt(page ?? 1);
  const isAnime = type === "Anime";
  const fetchFunction = isAnime ? fetchEpisode : fetchChapters;
  const errorName = isAnime ? "Episodes" : "Chapters";

  if (global.db && id) {
    try {
      const table = isAnime ? "Anime" : "Manga";
      const exists = await global.db
        .prepare(`SELECT id FROM ${table} WHERE id = ?`)
        .get(id);
      if (!exists) {
        const histTable = isAnime ? "WatchHistory" : "ReadHistory";
        const idCol = isAnime ? "anime_id" : "manga_id";
        const titleCol = isAnime ? "anime_title" : "manga_title";
        const hist = await global.db
          .prepare(
            `SELECT ${titleCol} FROM ${histTable} WHERE ${idCol} = ? LIMIT 1`,
          )
          .get(id);
        if (hist && hist[titleCol]) {
          const actual = await global.db
            .prepare(
              `SELECT id FROM ${table} WHERE LOWER(title) = LOWER(?) LIMIT 1`,
            )
            .get(hist[titleCol]);
          if (actual && actual.id) id = actual.id;
        }
      }
    } catch (_) {}
  }

  try {
    if (isNaN(page)) throw new Error(`invalid Page '${page}'`);
    if (!id) throw new Error("ID is Missing");

    if (provider !== "local source") {
      const providerObj = await providerFetch(type, provider ?? null);
      let data = null;
      try {
        data = await fetchFunction(providerObj, id, page);
        if (
          isAnime &&
          typeof providerObj?.healId === "function" &&
          page === 1 &&
          (!data?.episodes || data.episodes.length === 0)
        ) {
          const emptyErr = new Error(
            `${providerObj.name || "Provider"} returned 404 or empty episodes`,
          );
          emptyErr.status = 404;
          throw emptyErr;
        }
      } catch (fetchErr) {
        if (
          isAnime &&
          typeof providerObj?.healId === "function" &&
          (fetchErr?.response?.status === 404 ||
            fetchErr?.status === 404 ||
            fetchErr?.message?.includes("404"))
        ) {
          let animeTitle = null;
          let animeFolderName = null;
          let animeMalId = null;
          if (global.db) {
            try {
              const aRow = await global.db
                .prepare(
                  "SELECT title, folder_name, MalID FROM Anime WHERE id = ? OR id LIKE ?",
                )
                .get(id, `${id}-%`);
              if (aRow) {
                animeTitle = aRow.title;
                animeFolderName = aRow.folder_name;
                animeMalId = aRow.MalID;
              }
            } catch (_) {}
          }
          if (!animeTitle && global.db) {
            try {
              const whRow = await global.db
                .prepare(
                  "SELECT anime_title FROM WatchHistory WHERE anime_id = ? OR anime_id LIKE ? LIMIT 1",
                )
                .get(id, `${id}-%`);
              if (whRow?.anime_title) {
                animeTitle = whRow.anime_title;
              }
            } catch (_) {}
          }
          const healedId = await healProviderId(providerObj, {
            oldId: id,
            title: animeTitle,
            folderName: animeFolderName,
            malid: animeMalId,
          });
          if (healedId) {
            logger.info(
              `[api/info/items] Retrying episode fetch with healed id: ${id} -> ${healedId}`,
            );
            data = await fetchFunction(providerObj, healedId, page);
          } else {
            throw fetchErr;
          }
        } else {
          throw fetchErr;
        }
      }
      if (!data) throw new Error(`No ${errorName} Found`);
      if (data.hasNextPage === undefined && data.totalPages !== undefined) {
        data.hasNextPage = page < data.totalPages;
      }

      return res.json(data);
    } else {
      return res.json({});
    }
  } catch (err) {
    logger.error(`Error Fetching '${id}' ${errorName} page : ${page}:`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return res.json({ error: true, message: err?.message });
  }
});

// Play Video From m3u8 url
router.post("/api/watch", async (req, res) => {
  const { ep, epNum, Downloaded, provider = null, subdub } = req.body;
  try {
    if (!Downloaded) {
      if (!ep) throw new Error("Episode ID Not Found");
      const Animeprovider = await providerFetch("Anime", provider);
      let sourcesArray = await fetchEpisodeSources(Animeprovider, ep, subdub);

      if (sourcesArray) {
        const prefSubDub = subdub || "sub";
        let rawSources = [];
        if (
          prefSubDub &&
          Array.isArray(sourcesArray[prefSubDub]?.sources) &&
          sourcesArray[prefSubDub].sources.length > 0
        ) {
          rawSources = sourcesArray[prefSubDub].sources;
        } else if (
          prefSubDub &&
          Array.isArray(sourcesArray[prefSubDub]) &&
          sourcesArray[prefSubDub].length > 0
        ) {
          rawSources = sourcesArray[prefSubDub];
        } else if (
          Array.isArray(sourcesArray.sources) &&
          sourcesArray.sources.length > 0
        ) {
          rawSources = sourcesArray.sources;
        } else {
          const subSrcs = Array.isArray(sourcesArray.sub?.sources)
            ? sourcesArray.sub.sources
            : Array.isArray(sourcesArray.sub)
              ? sourcesArray.sub
              : [];
          const dubSrcs = Array.isArray(sourcesArray.dub?.sources)
            ? sourcesArray.dub.sources
            : Array.isArray(sourcesArray.dub)
              ? sourcesArray.dub
              : [];
          const hsubSrcs = Array.isArray(sourcesArray.hsub?.sources)
            ? sourcesArray.hsub.sources
            : Array.isArray(sourcesArray.hsub)
              ? sourcesArray.hsub
              : [];

          rawSources = [...subSrcs, ...dubSrcs, ...hsubSrcs];
        }

        const isHSub = (s) =>
          s.isHsub ||
          s.type === "hsub" ||
          s.quality?.toLowerCase().includes("hsub");
        const isDub = (s) =>
          s.isDub ||
          s.type === "dub" ||
          s.quality?.toLowerCase().includes("dub");

        let mainSources = rawSources;
        if (prefSubDub === "sub") {
          const cleanSub = rawSources.filter((s) => !isHSub(s) && !isDub(s));
          if (cleanSub.length > 0) mainSources = cleanSub;
        } else if (prefSubDub === "hsub") {
          const cleanHsub = rawSources.filter((s) => isHSub(s));
          if (cleanHsub.length > 0) mainSources = cleanHsub;
        } else if (prefSubDub === "dub") {
          const cleanDub = rawSources.filter((s) => isDub(s));
          if (cleanDub.length > 0) mainSources = cleanDub;
        }

        const rawSubtitles =
          prefSubDub === "hsub"
            ? []
            : Array.isArray(sourcesArray.subtitles)
              ? sourcesArray.subtitles
              : [];

        const formattedSubtitles = rawSubtitles.map((s) => {
          const label = s?.lang || s?.label || s?.name || "";
          return {
            ...s,
            lang: label,
            label,
          };
        });

        sourcesArray = {
          ...sourcesArray,
          sources: mainSources,
          subtitles: formattedSubtitles,
        };
      }

      res.status(200).json(sourcesArray || { sources: [] });
    } else {
      if (!epNum) throw new Error("Episode Number Not Found");
      if (!ep) throw new Error("Anime ID Not Found");

      const config = await settingfetch();

      let videoData = {
        sources: [],
        subtitles: [],
        intro: null,
      };

      const SourcesData = await getSourceById(
        "Anime",
        config?.CustomDownloadLocation,
        ep,
        epNum,
        subdub,
      );

      if (SourcesData?.filepath) {
        videoData.sources.push({
          url: `/video?path=${encodeURIComponent(SourcesData?.filepath)}`,
          quality: "HD",
          server: "Local",
          provider: "Local",
        });
      }

      if (SourcesData?.subtitleFiles?.length > 0) {
        videoData.subtitles = SourcesData?.subtitleFiles;
      }

      if (SourcesData?.skipTimes) {
        videoData.skipTimes = SourcesData.skipTimes;
      }

      res.status(200).json(videoData);
    }
  } catch (err) {
    logger.error(`Error Fetching M3U8 Playlist`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(200).json({
      sources: [],
    });
  }
});

// Resolve specific server stream on demand (lazy loading)
router.post("/api/watch/server", async (req, res) => {
  const { provider = null, server } = req.body;
  try {
    if (!server) throw new Error("Server payload missing");
    const Animeprovider = await providerFetch("Anime", provider);
    const resolved = await processServer(Animeprovider, server);
    if (!resolved) {
      return res.json({ error: true, message: "Failed to resolve server" });
    }
    res.status(200).json(resolved);
  } catch (err) {
    logger.error(`Error resolving server stream: ${err.message}`);
    res.status(500).json({ error: true, message: err.message });
  }
});

const ALLOWED_SUBTITLE_EXTENSIONS = new Set([
  ".vtt",
  ".srt",
  ".ass",
  ".ssa",
  ".sub",
]);

const ALLOWED_VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".mkv",
  ".webm",
  ".avi",
  ".mov",
  ".ts",
  ".m4v",
  ".flv",
]);

async function getAllowedMediaBases() {
  const allowedBases = new Set();

  try {
    const userData = getUserDataPath();
    if (userData) {
      allowedBases.add(path.resolve(userData));
      try {
        allowedBases.add(fs.realpathSync(userData));
      } catch (_) {}
    }
  } catch (_) {}

  try {
    const dlFolder = getDownloadsFolder();
    if (dlFolder) {
      allowedBases.add(path.resolve(dlFolder));
      try {
        allowedBases.add(fs.realpathSync(dlFolder));
      } catch (_) {}
    }
  } catch (_) {}

  try {
    const config = await settingfetch();
    if (config?.CustomDownloadLocation) {
      allowedBases.add(path.resolve(config.CustomDownloadLocation));
      try {
        allowedBases.add(fs.realpathSync(config.CustomDownloadLocation));
      } catch (_) {}
    }
  } catch (_) {}

  return Array.from(allowedBases);
}

function isPathInsideBases(targetPath, allowedBases) {
  return allowedBases.some(
    (base) => targetPath === base || targetPath.startsWith(base + path.sep),
  );
}

// Play Video From Local Source
router.get("/video", async (req, res) => {
  try {
    let filePath = req.query.path;
    if (!filePath) return res.status(400).send("No file path provided");

    filePath = decodeURIComponent(filePath);

    const ext = path.extname(filePath).toLowerCase();
    if (!ALLOWED_VIDEO_EXTENSIONS.has(ext)) {
      return res.status(400).send("Invalid video file format");
    }

    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(path.resolve(filePath));
    } catch (_) {
      return res.status(404).send("File not found");
    }

    const allowedBases = await getAllowedMediaBases();
    if (!isPathInsideBases(resolvedPath, allowedBases)) {
      return res.status(403).send("Access denied");
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).send("File not found");
    }

    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Accept-Ranges", "bytes");

    const stat = fs.statSync(resolvedPath);
    const fileSize = stat.size;
    const range = req.headers.range;

    const contentType = ext === ".ts" ? "video/mp2t" : "video/mp4";

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).send("Requested range not satisfiable");
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(resolvedPath, { start, end });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
      });

      if (req.method === "HEAD") {
        return res.end();
      }
      fileStream.pipe(res);
    } else {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
      });

      if (req.method === "HEAD") {
        return res.end();
      }
      fs.createReadStream(resolvedPath).pipe(res);
    }
  } catch (err) {
    console.error("Error streaming video:", err);
    res.status(500).send("Internal Server Error");
  }
});

// Serve Local Subtitles
router.get("/subtitles", async (req, res) => {
  try {
    let subtitlePath = req.query.file;
    if (!subtitlePath) {
      return res.status(400).json({ error: "Subtitle file path required" });
    }

    subtitlePath = decodeURIComponent(subtitlePath);

    const ext = path.extname(subtitlePath).toLowerCase();
    if (!ALLOWED_SUBTITLE_EXTENSIONS.has(ext)) {
      return res.status(400).json({ error: "Invalid subtitle file format" });
    }

    let resolvedPath;
    try {
      resolvedPath = fs.realpathSync(path.resolve(subtitlePath));
    } catch (_) {
      return res.status(404).json({ error: "Subtitle file not found" });
    }

    const allowedBases = await getAllowedMediaBases();
    if (!isPathInsideBases(resolvedPath, allowedBases)) {
      return res.status(403).json({ error: "Access denied" });
    }

    if (!fs.existsSync(resolvedPath)) {
      return res.status(404).json({ error: "Subtitle file not found" });
    }

    const mimeType = ext === ".srt" ? "application/x-subrip" : "text/vtt";
    res.setHeader("Content-Type", mimeType);
    return res.sendFile(resolvedPath, { dotfiles: "deny" });
  } catch (err) {
    console.error("Error serving subtitle:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Fetch Manga Chapter
router.post("/api/read", async (req, res) => {
  const { chapterID, Downloaded = false, MangaID, provider = null } = req.body;
  try {
    if (!chapterID) throw new Error("Chapter ID is missing");

    let isLocal = Downloaded;
    let SourcesData = null;
    const config = await settingfetch();

    if (MangaID) {
      try {
        SourcesData = await getSourceById(
          "Manga",
          config?.CustomDownloadLocation,
          MangaID,
          chapterID,
        );
        if (SourcesData?.filepath && fs.existsSync(SourcesData.filepath)) {
          isLocal = true;
        }
      } catch (e) {}
    }

    if (isLocal) {
      if (!SourcesData) {
        if (!MangaID) throw new Error("Manga ID is missing");
        SourcesData = await getSourceById(
          "Manga",
          config?.CustomDownloadLocation,
          MangaID,
          chapterID,
        );
      }

      if (SourcesData?.filepath) {
        const zipData = fs.readFileSync(SourcesData.filepath);
        const zip = await JSZip.loadAsync(zipData);

        const pages = await Promise.all(
          Object.keys(zip.files)
            .filter((file) => file.match(/^\d+\./))
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(async (file) => ({
              page: parseInt(file),
              img: `data:image/jpeg;base64,${await zip
                .file(file)
                .async("base64")}`,
            })),
        );
        res.json(pages);
      } else {
        throw new Error("Chapter Not Found In Downloads!");
      }
    } else {
      const providerObj = await providerFetch("Manga", provider);
      const chapters = await MangaChapterFetch(providerObj, chapterID);
      return res.status(200).json(chapters);
    }
  } catch (err) {
    logger.error(`Failed To Fetch Manga Chapters`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(200).json([]);
  }
});

const inFlightImageFetches = new Map();
const failedImageUrls = new Map();
const reportedBrokenImages = new Set();

function get404PlaceholderPath() {
  const candidates = [
    path.join(__dirname, "../../gui/public/images/image-404.png"),
    path.join(__dirname, "../../gui/dist/images/image-404.png"),
    path.join(process.cwd(), "gui/public/images/image-404.png"),
    path.join(process.cwd(), "gui/dist/images/image-404.png"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// Proxy for Images
router.get("/api/image", async (req, res) => {
  let decodedUrl = "";
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send("Missing image url");
    }

    decodedUrl = decodeURIComponent(imageUrl).trim();
    if (decodedUrl.startsWith("//")) {
      decodedUrl = "https:" + decodedUrl;
    }

    const failedTime = failedImageUrls.get(decodedUrl);
    if (failedTime && Date.now() - failedTime < 86400000) {
      const p404 = get404PlaceholderPath();
      if (p404) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(p404);
      }
      return res.status(404).send("Image not found");
    }

    if (decodedUrl.startsWith("file://") || decodedUrl.startsWith("/")) {
      const filePath = decodedUrl.startsWith("file://")
        ? decodedUrl.slice(7)
        : decodedUrl;
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(filePath, { dotfiles: "allow" });
      } else {
        return res.status(404).send("Local file not found");
      }
    }

    try {
      const cached = queryOne("SELECT filename FROM ImageCache WHERE url = ?", [
        decodedUrl,
      ]);
      const cacheDir = ImageCacheManager.getImageCacheDir();
      if (
        cached &&
        cached.filename &&
        fs.existsSync(path.join(cacheDir, cached.filename))
      ) {
        run("UPDATE ImageCache SET last_accessed = ? WHERE url = ?", [
          Date.now(),
          decodedUrl,
        ]);

        let contentType = "image/jpeg";
        if (cached.filename.endsWith(".png")) contentType = "image/png";
        else if (cached.filename.endsWith(".gif")) contentType = "image/gif";
        else if (cached.filename.endsWith(".webp")) contentType = "image/webp";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(path.join(cacheDir, cached.filename), {
          dotfiles: "allow",
        });
      }
    } catch (cacheErr) {
      logger.error("Error reading from image cache: " + cacheErr.message);
    }

    async function fetchImageBuffer(url) {
      const resolvedHeaders = getHeaders(url);
      const options = {
        responseType: "arraybuffer",
        skipBypass: true,
        timeout: 12000,
        headers: {
          ...resolvedHeaders,
          Accept:
            resolvedHeaders.Accept ||
            "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        },
      };

      try {
        const response = await global.axios.get(url, options);
        const buf = Buffer.isBuffer(response.data)
          ? response.data
          : Buffer.from(response.data);
        const ct = response.headers["content-type"] || "image/jpeg";
        return { buffer: buf, contentType: ct };
      } catch (err) {
        const isCfChallenge =
          err?.response &&
          (err.response.status === 403 || err.response.status === 503);
        if (isCfChallenge && global.scrapperFetchDataUrl) {
          try {
            const dataUrl = await global.scrapperFetchDataUrl(url);
            if (dataUrl && dataUrl.startsWith("data:")) {
              const matches = dataUrl.match(
                /^data:(image\/[a-zA-Z0-9+-]+);base64,(.+)$/,
              );
              if (matches) {
                return {
                  contentType: matches[1],
                  buffer: Buffer.from(matches[2], "base64"),
                };
              }
            }
          } catch (scrapperErr) {
            console.error(
              "scrapperFetchDataUrl failed for image:",
              scrapperErr.message,
            );
          }
        }
        throw err;
      }
    }

    let fetchPromise = inFlightImageFetches.get(decodedUrl);
    if (!fetchPromise) {
      fetchPromise = fetchImageBuffer(decodedUrl).finally(() => {
        inFlightImageFetches.delete(decodedUrl);
      });
      inFlightImageFetches.set(decodedUrl, fetchPromise);
    }

    const { buffer: imageBuffer, contentType } = await fetchPromise;

    if (imageBuffer) {
      try {
        ImageCacheManager.cacheImage(decodedUrl, imageBuffer).catch(() => {});
      } catch (_) {}

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(imageBuffer);
    }
    res.status(500).send("Failed to load image");
  } catch (err) {
    const is404 =
      err?.response &&
      (err.response.status === 404 || err.response.status === 410);

    if (is404) {
      failedImageUrls.set(decodedUrl, Date.now());

      if (
        decodedUrl.includes("myanimelist.net") &&
        !reportedBrokenImages.has(decodedUrl)
      ) {
        reportedBrokenImages.add(decodedUrl);

        let malid = req.query.malid ? parseInt(req.query.malid, 10) : null;
        let title = req.query.title ? String(req.query.title) : null;
        let mediaType = req.query.type;
        if (!mediaType) {
          if (
            decodedUrl.includes("/images/manga/") ||
            decodedUrl.includes("/manga/")
          ) {
            mediaType = "manga";
          } else if (
            decodedUrl.includes("/images/anime/") ||
            decodedUrl.includes("/anime/")
          ) {
            mediaType = "anime";
          } else {
            mediaType = "anime";
          }
        }

        if (!malid && global.mappingDb) {
          try {
            const aRow = global.mappingDb
              .prepare(
                "SELECT malid, title FROM anime WHERE image_url = ? LIMIT 1",
              )
              .get(decodedUrl);
            if (aRow) {
              malid = aRow.malid;
              title = title || aRow.title;
              mediaType = "anime";
            } else {
              const mRow = global.mappingDb
                .prepare(
                  "SELECT malid, title FROM manga WHERE image_url = ? LIMIT 1",
                )
                .get(decodedUrl);
              if (mRow) {
                malid = mRow.malid;
                title = title || mRow.title;
                mediaType = "manga";
              }
            }
          } catch (_) {}
        }

        // Fire-and-forget report to server
        axios
          .post(
            "https://strawverse.theyogmehta.online/api/mal/broken-image",
            {
              malid,
              url: decodedUrl,
              title,
              type: mediaType,
            },
            {
              headers: {
                "Content-Type": "application/json",
                "User-Agent": "StrawVerse-Client",
              },
              timeout: 5000,
            },
          )
          .catch((rErr) => {
            logger.debug(`Failed to report broken MAL image: ${rErr.message}`);
          });
      }

      const p404 = get404PlaceholderPath();
      if (p404) {
        res.setHeader("Content-Type", "image/png");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(p404);
      }
    }

    console.error("Image proxy fetch failed:", err.message);
    res.status(500).send("Failed to load image");
  }
});

// Proxy for m3u8 playlist
router.get("/api/stream/m3u8", async (req, res) => {
  const url = req.query.url;
  const customReferer = req.query.referer;
  if (!url) return res.status(400).send("No URL");
  try {
    if (customReferer && global.setDynamicReferer) {
      global.setDynamicReferer(url, customReferer);
    }
    const reqHeaders = getHeaders(url);
    if (customReferer) {
      reqHeaders.Referer = customReferer;
    }
    let data;
    try {
      const resp = await global.axios.get(url, {
        headers: reqHeaders,
        responseType: "text",
        timeout: 15000,
      });
      data = resp.data;
    } catch (fetchErr) {
      if (
        fetchErr.response &&
        (fetchErr.response.status === 403 ||
          fetchErr.response.status === 503) &&
        global.cloudflarebypass
      ) {
        const bypassTarget = customReferer || url;
        await global.cloudflarebypass(bypassTarget, true);
        const freshHeaders = getHeaders(url);
        if (customReferer) freshHeaders.Referer = customReferer;
        const retry = await global.axios.get(url, {
          headers: freshHeaders,
          responseType: "text",
          timeout: 15000,
        });
        data = retry.data;
      } else {
        throw fetchErr;
      }
    }
    if (typeof data !== "string" || !data.includes("#EXTM3U")) {
      logger.warn(
        `[Stream Proxy] Upstream returned invalid m3u8 playlist for ${url}`,
      );
      return res
        .status(502)
        .send("Upstream returned invalid playlist manifest");
    }
    const base = url.substring(0, url.lastIndexOf("/") + 1);
    const refParam = customReferer
      ? `&referer=${encodeURIComponent(customReferer)}`
      : "";
    const segProxy = `http://127.0.0.1:${global.PORT}/api/stream/segment.ts?url=`;
    const m3u8Proxy = `http://127.0.0.1:${global.PORT}/api/stream/m3u8?url=`;

    const regHost = (targetAbs) => {
      if (
        customReferer &&
        global.setDynamicReferer &&
        targetAbs.startsWith("http")
      ) {
        try {
          global.setDynamicReferer(new URL(targetAbs).hostname, customReferer);
        } catch (_) {}
      }
    };

    let nextIsVariantPlaylist = false;
    const manifest = String(data)
      .split("\n")
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith("#")) {
          if (t.startsWith("#EXT-X-STREAM-INF:")) {
            nextIsVariantPlaylist = true;
          }
          return t.includes('URI="')
            ? t.replace(/URI="([^"]+)"/, (_, u) => {
                const abs = u.startsWith("http") ? u : base + u;
                regHost(abs);
                const isSubOrAudio =
                  t.includes("TYPE=SUBTITLES") || t.includes("TYPE=AUDIO");
                const proxy =
                  abs.includes(".m3u8") || isSubOrAudio ? m3u8Proxy : segProxy;
                return `URI="${proxy}${encodeURIComponent(abs)}${refParam}"`;
              })
            : line;
        }

        const isVariant = nextIsVariantPlaylist;
        nextIsVariantPlaylist = false;

        const abs = t.startsWith("http") ? t : base + t;
        regHost(abs);
        const proxy = isVariant || abs.includes(".m3u8") ? m3u8Proxy : segProxy;
        return `${proxy}${encodeURIComponent(abs)}${refParam}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(manifest);
  } catch (err) {
    logger.error(`[StreamProxy] m3u8 error: ${err.message}`);
    res.status(502).send(err.message);
  }
});

// Proxy for m3u8 video segment
router.get(
  ["/api/stream/segment", "/api/stream/segment.ts"],
  async (req, res) => {
    const url = req.query.url;
    const customReferer = req.query.referer;
    if (!url) return res.status(400).send("No URL");
    try {
      if (customReferer && global.setDynamicReferer) {
        global.setDynamicReferer(url, customReferer);
      }
      const reqHeaders = getHeaders(url);
      if (customReferer) {
        reqHeaders.Referer = customReferer;
      }

      const isDirectVideo = Boolean(
        url.split("?")[0].match(/\.(mp4|mkv|webm|mov|avi)$/i),
      );

      if (isDirectVideo) {
        if (req.headers.range) {
          reqHeaders.Range = req.headers.range;
        }
        let attempts = 0;
        let resp;
        while (attempts < 2) {
          try {
            resp = await global.axios.get(url, {
              headers: reqHeaders,
              responseType: "stream",
              timeout: 30000,
              validateStatus: (s) => s < 400,
            });
            break;
          } catch (err) {
            attempts++;
            const status = err.response?.status;
            if (
              (status === 403 || status === 503) &&
              attempts < 2 &&
              global.cloudflarebypass
            ) {
              try {
                const bypassTarget = customReferer || url;
                await global.cloudflarebypass(bypassTarget, true);
                const fresh = getHeaders(url);
                if (customReferer) fresh.Referer = customReferer;
                if (req.headers.range) fresh.Range = req.headers.range;
                Object.assign(reqHeaders, fresh);
              } catch (_) {}
            } else if (attempts >= 2) {
              throw err;
            }
          }
        }

        const status = resp.status || (req.headers.range ? 206 : 200);
        res.status(status);
        const copyHeaders = [
          "content-type",
          "content-length",
          "content-range",
          "accept-ranges",
          "last-modified",
          "etag",
        ];
        copyHeaders.forEach((h) => {
          const val = resp.headers?.[h];
          if (val) res.setHeader(h, val);
        });
        if (!res.getHeader("accept-ranges")) {
          res.setHeader("Accept-Ranges", "bytes");
        }
        if (req.method === "HEAD") {
          return res.end();
        }
        resp.data.pipe(res);
        return;
      }

      let attempts = 0;
      let data, headers;
      while (attempts < 2) {
        try {
          const resp = await global.axios.get(url, {
            headers: reqHeaders,
            responseType: "arraybuffer",
            timeout: 10000,
          });
          data = resp.data;
          headers = resp.headers;
          break;
        } catch (err) {
          attempts++;
          const status = err.response?.status;
          if (status === 429 && attempts < 2) {
            await new Promise((r) => setTimeout(r, 1000));
          } else if (
            (status === 403 || status === 503) &&
            attempts < 2 &&
            global.cloudflarebypass
          ) {
            try {
              const bypassTarget = customReferer || url;
              await global.cloudflarebypass(bypassTarget, true);
              const fresh = getHeaders(url);
              if (customReferer) fresh.Referer = customReferer;
              Object.assign(reqHeaders, fresh);
            } catch (_) {}
          } else if (attempts >= 2) {
            throw err;
          }
        }
      }

      if (
        !Buffer.isBuffer(data) &&
        !(data instanceof ArrayBuffer) &&
        !ArrayBuffer.isView(data) &&
        typeof data !== "string"
      ) {
        throw new Error("Invalid binary/stream payload from upstream");
      }
      let buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);

      if (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      ) {
        for (let i = 0; i < Math.min(buffer.length - 3, 1024); i++) {
          if (
            buffer[i] === 0x49 &&
            buffer[i + 1] === 0x45 &&
            buffer[i + 2] === 0x4e &&
            buffer[i + 3] === 0x44
          ) {
            buffer = buffer.subarray(i + 8);
            break;
          }
        }
      }

      const ct = headers?.["content-type"] || "application/octet-stream";
      res.setHeader("Content-Type", ct.includes("image") ? "video/mp2t" : ct);

      if (req.headers.range) {
        const match = req.headers.range.match(/bytes=(\d+)-(\d*)/);
        if (match) {
          const start = parseInt(match[1], 10);
          const end = match[2] ? parseInt(match[2], 10) : buffer.length - 1;
          if (start < buffer.length && end >= start) {
            const chunk = buffer.subarray(start, end + 1);
            res.status(206);
            res.setHeader(
              "Content-Range",
              `bytes ${start}-${end}/${buffer.length}`,
            );
            res.setHeader("Content-Length", chunk.length);
            res.setHeader("Accept-Ranges", "bytes");
            return res.send(chunk);
          }
        }
      }

      res.send(buffer);
    } catch (err) {
      logger.error(`[StreamProxy] segment error: ${err.message}`);
      res.status(502).send(err.message);
    }
  },
);

async function linkMediaItem({ oldId, malId, type, title, image }) {
  const itemType = type || "Anime";
  const malIdStr = malId ? String(malId) : null;

  if (!malIdStr && !oldId) {
    throw new Error("Missing malId or oldId");
  }

  const numMalId = Number(malIdStr);
  let selectedProvider = null;
  let resolvedProviderId = null;

  if (global.mappingDb && numMalId) {
    try {
      const best = await getBestProviderForMalId(numMalId, itemType);
      if (best) {
        selectedProvider = best.provider;
        resolvedProviderId = best.id;
      }
    } catch (err) {
      logger.error(`Error querying mappingDb for link-mapping: ${err.message}`);
    }
  }
  if (!selectedProvider) {
    selectedProvider =
      itemType === "Anime"
        ? setting?.Animeprovider ||
          Object.keys(global.Anime_providers || {})[0] ||
          "pahe"
        : setting?.Mangaprovider ||
          Object.keys(global.Manga_providers || {})[0] ||
          "weebcentral";
  }

  const finalId = resolvedProviderId || oldId || malIdStr;

  if (numMalId) {
    if (!title) {
      try {
        const titleRes = await fetch(
          `https://strawverse.theyogmehta.online/api/title/${itemType}/${numMalId}`,
        );
        if (titleRes.ok) {
          const tData = await titleRes.json();
          if (tData && tData.title) {
            title = tData.title;
          }
        }
      } catch (_) {}
    }

    if (!image && global.mappingDb) {
      try {
        const imgRow = await global.mappingDb
          .prepare(
            itemType === "Anime"
              ? "SELECT image_url FROM anime WHERE malid = ?"
              : "SELECT image_url FROM manga WHERE malid = ?",
          )
          .get(numMalId);
        if (imgRow && imgRow.image_url) {
          image = imgRow.image_url;
        }
      } catch (_) {}
    }
  }

  const cleanFolder = sanitizeFolderName(title || oldId || finalId);

  if (global.db) {
    try {
      const stmt = global.db.prepare(
        "INSERT OR REPLACE INTO unlinked_mal_ids (id, malid) VALUES (?, ?)",
      );
      if (oldId) await stmt.run(oldId, String(numMalId));
      if (finalId) await stmt.run(finalId, String(numMalId));
      if (cleanFolder) await stmt.run(cleanFolder, String(numMalId));

      const existing = await queryOne(
        `SELECT * FROM ${itemType} WHERE id = ? OR id = ? OR folder_name = ?`,
        [finalId, oldId, cleanFolder],
      );

      if (existing) {
        await run(
          `UPDATE ${itemType} SET id = ?, MalID = ?, provider = ?, title = COALESCE(NULLIF(?, ''), title), image_url = COALESCE(NULLIF(?, ''), image_url), folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id = ? OR folder_name = ?`,
          [
            finalId,
            String(numMalId),
            selectedProvider,
            title || existing.title || "",
            image || existing.image_url || "",
            cleanFolder,
            oldId || finalId,
            finalId,
            cleanFolder,
          ],
        );
      } else {
        await run(
          `INSERT OR REPLACE INTO ${itemType} (id, title, image_url, folder_name, MalID, provider, CustomTag) VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            finalId,
            title || finalId,
            image || "",
            cleanFolder,
            String(numMalId),
            selectedProvider,
            JSON.stringify(["downloads"]),
          ],
        );
      }
    } catch (err) {
      logger.error(`Error updating local db in link-mapping: ${err.message}`);
    }
  }

  if (oldId && oldId !== finalId && global.db) {
    try {
      if (itemType === "Anime") {
        await run("UPDATE WatchHistory SET anime_id = ? WHERE anime_id = ?", [
          finalId,
          oldId,
        ]);
        await run("UPDATE SkipTimes SET anime_id = ? WHERE anime_id = ?", [
          finalId,
          oldId,
        ]);
      } else {
        await run("UPDATE ReadHistory SET manga_id = ? WHERE manga_id = ?", [
          finalId,
          oldId,
        ]);
      }
    } catch (_) {}
  }

  if (global.mappingDb && (oldId || finalId)) {
    try {
      const cleanProv = (selectedProvider || "").toLowerCase().split("/").pop();
      await global.mappingDb
        .prepare(
          "DELETE FROM unmapped_items WHERE (id = ? OR id = ?) OR (provider = ? AND id = ?)",
        )
        .run(oldId || "", finalId || "", cleanProv, oldId || finalId);

      if (cleanProv && numMalId) {
        if (cleanProv === "pahe") {
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              String(finalId),
            );
          if (isUuid) {
            await global.mappingDb
              .prepare(
                "INSERT OR REPLACE INTO pahe (id, uuid, malid) VALUES (?, ?, ?)",
              )
              .run(finalId, finalId, numMalId);
          } else {
            await global.mappingDb
              .prepare("INSERT OR REPLACE INTO pahe (id, malid) VALUES (?, ?)")
              .run(finalId, numMalId);
          }
        } else {
          try {
            await global.mappingDb.exec(`
              CREATE TABLE IF NOT EXISTS "${cleanProv}" (
                id TEXT PRIMARY KEY,
                malid INTEGER
              );
            `);
          } catch (_) {}
          await global.mappingDb
            .prepare(
              `INSERT OR REPLACE INTO "${cleanProv}" (id, malid) VALUES (?, ?)`,
            )
            .run(finalId, numMalId);
        }
        const malTable = itemType === "Anime" ? "anime" : "manga";
        await global.mappingDb
          .prepare(`UPDATE ${malTable} SET has_mapping = 1 WHERE malid = ?`)
          .run(numMalId);
      }
    } catch (_) {}
  }

  const linkedProviders = await getLinkedProvidersForMalId(numMalId, itemType, {
    currentProvider: selectedProvider,
    currentId: finalId,
    title: title || "",
    installedOnly: true,
  });

  const details = {
    id: finalId,
    dataId: oldId,
    malid: numMalId,
    title: title || finalId,
    image: image || "",
    image_url: image || "",
    provider: selectedProvider,
    linkedProviders,
    CustomTag: JSON.stringify(["downloads"]),
  };

  return {
    success: true,
    newId: finalId,
    provider: selectedProvider,
    details,
  };
}

// Handles linking local downloaded entries to provider mappings
router.post(
  ["/api/local/link-mapping", "/api/mapping/link-item"],
  async (req, res) => {
    try {
      const result = await linkMediaItem(req.body);
      return res.json(result);
    } catch (err) {
      logger.error(`Failed to link item: ${err.message}`);
      const isClientError = err.message && err.message.startsWith("Missing");
      return res.status(isClientError ? 400 : 500).json({ error: err.message });
    }
  },
);

module.exports = router;
