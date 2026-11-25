const { parseTags } = require("./constants");

const TABLE_BY_TYPE = {
  Anime: "Anime",
  Movies: "Movies",
  Manga: "Manga",
};

/**
 * Migrate a saved media entry to a new provider/ID atomically.
 * Handles same-ID provider changes, DownloadQueue safety guards,
 * WatchHistory / SeriesMovieWatchHistory migration, CustomTag merging,
 * and custom_order_* updates.
 */
async function switchProviderMetadata(
  { type, oldId, newId, newProvider },
  deps = {},
) {
  const table = TABLE_BY_TYPE[type];
  if (!table || !oldId || !newId || !newProvider) {
    const err = new Error("Missing or invalid parameters");
    err.statusCode = 400;
    throw err;
  }

  const {
    queryOne,
    queryAll,
    batchRun,
    installedMovieProviders = null,
  } = deps;

  if (type === "Movies" && installedMovieProviders) {
    const isInstalled = Object.keys(installedMovieProviders).some(
      (k) => k === newProvider || k.toLowerCase() === newProvider.toLowerCase(),
    );
    if (!isInstalled) {
      const err = new Error(`Target provider '${newProvider}' is not installed`);
      err.statusCode = 400;
      throw err;
    }
  }

  const queued = await queryOne(
    "SELECT 1 AS found FROM DownloadQueue WHERE id = ? LIMIT 1",
    [oldId],
  );
  if (queued) {
    const err = new Error(
      "Cannot switch extension while downloads for this title are in the queue.",
    );
    err.statusCode = 409;
    err.code = "DOWNLOAD_IN_QUEUE";
    throw err;
  }

  const existingOld = await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [
    oldId,
  ]);
  if (!existingOld) {
    return { success: true, migrated: false, merged: false };
  }

  const nowIso = new Date().toISOString();

  if (oldId === newId) {
    if (existingOld.provider === newProvider) {
      return { success: true, migrated: false, merged: false };
    }
    const ops = [
      {
        sql:
          type === "Movies"
            ? `UPDATE Movies SET provider = ?, episodes_json = NULL, last_updated = ? WHERE id = ?`
            : `UPDATE ${table} SET provider = ?, last_updated = ? WHERE id = ?`,
        params: [newProvider, nowIso, oldId],
      },
    ];
    await batchRun(ops);
    return { success: true, migrated: true, merged: false };
  }

  const existingNew = await queryOne(`SELECT * FROM ${table} WHERE id = ?`, [
    newId,
  ]);
  const ops = [];
  let merged = false;

  if (existingNew) {
    merged = true;
    const mergedTags = Array.from(
      new Set([
        ...parseTags(existingNew.CustomTag),
        ...parseTags(existingOld.CustomTag),
      ]),
    );
    const mergedTagStr = mergedTags.length > 0 ? JSON.stringify(mergedTags) : "";
    const preservedFolder =
      existingNew.folder_name && String(existingNew.folder_name).trim()
        ? existingNew.folder_name
        : existingOld.folder_name || null;

    if (type === "Movies") {
      ops.push({
        sql: `UPDATE Movies SET provider = ?, CustomTag = ?, folder_name = ?, episodes_json = NULL, last_updated = ? WHERE id = ?`,
        params: [newProvider, mergedTagStr, preservedFolder, nowIso, newId],
      });
    } else {
      ops.push({
        sql: `UPDATE ${table} SET provider = ?, CustomTag = ?, folder_name = ?, last_updated = ? WHERE id = ?`,
        params: [newProvider, mergedTagStr, preservedFolder, nowIso, newId],
      });
    }
    ops.push({
      sql: `DELETE FROM ${table} WHERE id = ?`,
      params: [oldId],
    });
  } else {
    const updatedRow = {
      ...existingOld,
      id: newId,
      provider: newProvider,
      last_updated: nowIso,
    };
    if (type === "Movies") {
      updatedRow.episodes_json = null;
    }

    const columns = Object.keys(updatedRow);
    const placeholders = columns.map(() => "?").join(", ");
    const values = columns.map((col) => updatedRow[col]);

    ops.push({
      sql: `DELETE FROM ${table} WHERE id = ?`,
      params: [oldId],
    });
    ops.push({
      sql: `INSERT OR REPLACE INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
      params: values,
    });
  }

  if (type === "Movies") {
    if (merged) {
      const oldHist = await queryAll(
        "SELECT * FROM SeriesMovieWatchHistory WHERE movie_id = ?",
        [oldId],
      );
      const newHist = await queryAll(
        "SELECT * FROM SeriesMovieWatchHistory WHERE movie_id = ?",
        [newId],
      );
      const newByKey = new Map();
      for (const h of newHist || []) {
        const key = `${h.season ?? 1}:${h.episode_number}`;
        newByKey.set(key, h);
      }

      for (const oh of oldHist || []) {
        const key = `${oh.season ?? 1}:${oh.episode_number}`;
        const nh = newByKey.get(key);
        if (!nh) {
          ops.push({
            sql: "UPDATE SeriesMovieWatchHistory SET movie_id = ? WHERE id = ?",
            params: [newId, oh.id],
          });
        } else {
          const bestCompleted = Math.max(
            Number(nh.is_completed) || 0,
            Number(oh.is_completed) || 0,
          );
          const bestTime = Math.max(
            Number(nh.current_time) || 0,
            Number(oh.current_time) || 0,
          );
          const bestSpent =
            (Number(nh.time_spent) || 0) + (Number(oh.time_spent) || 0);
          const latestWatched =
            String(oh.last_watched || "") > String(nh.last_watched || "")
              ? oh.last_watched
              : nh.last_watched;
          ops.push({
            sql: "UPDATE SeriesMovieWatchHistory SET is_completed = ?, current_time = ?, time_spent = ?, last_watched = ? WHERE id = ?",
            params: [bestCompleted, bestTime, bestSpent, latestWatched, nh.id],
          });
          ops.push({
            sql: "DELETE FROM SeriesMovieWatchHistory WHERE id = ?",
            params: [oh.id],
          });
        }
      }
    } else {
      ops.push({
        sql: "UPDATE SeriesMovieWatchHistory SET movie_id = ? WHERE movie_id = ?",
        params: [newId, oldId],
      });
    }
  } else if (type === "Anime") {
    ops.push({
      sql: "UPDATE WatchHistory SET anime_id = ? WHERE anime_id = ?",
      params: [newId, oldId],
    });
  } else {
    ops.push({
      sql: "UPDATE ReadHistory SET manga_id = ? WHERE manga_id = ?",
      params: [newId, oldId],
    });
  }

  // Update any custom sort orders referencing oldId
  try {
    const orderRows = await queryAll(
      "SELECT key, value FROM Settings WHERE key LIKE 'custom_order_%'",
    );
    for (const row of orderRows || []) {
      let arr;
      try {
        arr = JSON.parse(row.value);
      } catch (_) {
        continue;
      }
      if (!Array.isArray(arr) || !arr.includes(oldId)) continue;
      const updatedArr = [];
      const seenIds = new Set();
      for (const itemId of arr) {
        const mapped = itemId === oldId ? newId : itemId;
        if (!seenIds.has(mapped)) {
          seenIds.add(mapped);
          updatedArr.push(mapped);
        }
      }
      ops.push({
        sql: "UPDATE Settings SET value = ? WHERE key = ?",
        params: [JSON.stringify(updatedArr), row.key],
      });
    }
  } catch (_) {}

  await batchRun(ops);
  return { success: true, migrated: true, merged };
}

module.exports = {
  switchProviderMetadata,
};
