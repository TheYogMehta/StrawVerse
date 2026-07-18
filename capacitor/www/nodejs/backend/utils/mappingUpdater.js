const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { logger } = require("./AppLogger");
const {
  getKeyValue,
  setKeyValue,
  mappingQueryAll,
  mappingQueryOne,
  mappingRun,
  mappingExec,
  closeDb,
  openDb,
  batchRun,
  queryAll,
  run,
} = require("./db");

async function dropAllTriggers() {
  try {
    const triggers = await mappingQueryAll(
      "SELECT name FROM sqlite_master WHERE type='trigger'",
    );
    for (const trigger of triggers) {
      await mappingRun(`DROP TRIGGER IF EXISTS ${trigger.name}`);
    }
  } catch (e) {
    logger.error(`[mappingUpdater] Failed to drop triggers: ${e.message}`);
  }
}

function deserializeDelta(buffer) {
  let offset = 0;
  if (buffer.length < 1) return { action: "full_sync" };
  const actionFlag = buffer.readUInt8(offset);
  offset += 1;

  if (actionFlag === 0) {
    return { action: "full_sync" };
  }
  if (buffer.length < offset + 2) return { action: "full_sync" };
  const vLen = buffer.readUInt16BE(offset);
  offset += 2;
  if (buffer.length < offset + vLen) return { action: "full_sync" };
  const version = buffer.toString("utf8", offset, offset + vLen);
  offset += vLen;
  if (buffer.length < offset + 4) return { action: "full_sync" };
  const numUpdates = buffer.readUInt32BE(offset);
  offset += 4;

  const tblRevMap = {
    1: "anime",
    2: "animepahe",
    3: "anikototv",
    4: "anineko",
    5: "manga",
    6: "weebcentral",
    7: "allmanga",
    8: "next_episodes",
  };
  const actRevMap = { 1: "INSERT", 2: "UPDATE", 3: "DELETE" };

  const updates = [];
  for (let i = 0; i < numUpdates; i++) {
    if (buffer.length < offset + 6) return { action: "full_sync" };
    const id = buffer.readUInt32BE(offset);
    offset += 4;

    const actVal = buffer.readUInt8(offset);
    offset += 1;
    const action = actRevMap[actVal] || "INSERT";

    const tblVal = buffer.readUInt8(offset);
    offset += 1;
    const tbl = tblRevMap[tblVal] || "anime";

    if (buffer.length < offset + 2) return { action: "full_sync" };
    const rowIdLen = buffer.readUInt16BE(offset);
    offset += 2;

    if (buffer.length < offset + rowIdLen) return { action: "full_sync" };
    const row_id = buffer.toString("utf8", offset, offset + rowIdLen);
    offset += rowIdLen;

    if (buffer.length < offset + 4) return { action: "full_sync" };
    const dataLen = buffer.readUInt32BE(offset);
    offset += 4;

    let data = null;
    if (dataLen > 0) {
      if (buffer.length < offset + dataLen) return { action: "full_sync" };
      data = buffer.toString("utf8", offset, offset + dataLen);
      offset += dataLen;
    }

    updates.push({ id, action, tbl, row_id, data });
  }

  return { action: "delta", version, updates };
}

async function checkForMappingUpdates() {
  const userDataPath = process.env.NODEJS_MOBILE_DATA_DIR || process.cwd();
  const mappingTagKey = "mapping_release_tag";
  const storedTag = await getKeyValue("Settings", mappingTagKey);

  logger.info("[mappingUpdater] Checking for mapping database updates...");

  let missingTables = true;
  let hasNextEpisodesTable = false;
  let hasMappingChangelogTable = false;
  try {
    const tablesList = await mappingQueryAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('anime', 'animepahe', 'anikototv', 'anineko', 'manga', 'weebcentral', 'allmanga', 'next_episodes', 'mapping_changelog')",
    );
    const tableNames = tablesList.map((t) => t.name);

    // Check if the core 8 tables exist (excluding changelog)
    const coreTables = [
      "anime",
      "animepahe",
      "anikototv",
      "anineko",
      "manga",
      "weebcentral",
      "allmanga",
      "next_episodes",
    ];
    missingTables = !coreTables.every((name) => tableNames.includes(name));

    hasNextEpisodesTable = tableNames.includes("next_episodes");
    hasMappingChangelogTable = tableNames.includes("mapping_changelog");
  } catch (e) {
    missingTables = true;
  }

  let hasTriggers = false;
  try {
    const row = await mappingQueryOne(
      "SELECT 1 FROM sqlite_master WHERE type='trigger' LIMIT 1",
    );
    if (row) {
      logger.info(
        "[mappingUpdater] Legacy triggers detected in mapping database. Forcing full sync to clean up database.",
      );
      hasTriggers = true;
    }
  } catch (e) {}

  let isNextEpisodesEmpty = false;
  if (hasNextEpisodesTable) {
    try {
      const row = await mappingQueryOne(
        "SELECT COUNT(*) as count FROM next_episodes",
      );
      if (!row || row.count === 0) {
        isNextEpisodesEmpty = true;
      }
    } catch (e) {
      isNextEpisodesEmpty = true;
    }
  } else {
    isNextEpisodesEmpty = true;
  }

  let lastId = 0;
  if (hasMappingChangelogTable) {
    try {
      const row = await mappingQueryOne(
        "SELECT MAX(id) as maxId FROM mapping_changelog",
      );
      if (row && typeof row.maxId === "number") {
        lastId = row.maxId;
      }
    } catch (e) {}
  }

  let updateResponse = null;
  try {
    const url = storedTag
      ? `https://strawverse.theyogmehta.online/api/mapping/updates?version=${storedTag}&last_id=${lastId}`
      : `https://strawverse.theyogmehta.online/api/mapping/updates?last_id=${lastId}`;
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    updateResponse = deserializeDelta(buffer);
  } catch (err) {
    logger.error(
      `[mappingUpdater] Failed to check for mapping updates from server: ${err.message}`,
    );
  }

  let action = "full_sync";
  let latestVersion = null;
  let updates = [];

  if (updateResponse) {
    action = updateResponse.action;
    latestVersion = updateResponse.version;
    updates = updateResponse.updates || [];
  }

  if (missingTables || hasTriggers || (isNextEpisodesEmpty && storedTag)) {
    action = "full_sync";
  }

  if (action === "full_sync") {
    if (!latestVersion) {
      try {
        const vRes = await axios.get(
          "https://strawverse.theyogmehta.online/api/mapping/version",
        );
        latestVersion = vRes.data?.version;
      } catch (e) {
        logger.error(
          `[mappingUpdater] Failed to get latest version: ${e.message}`,
        );
      }
    }

    const downloadUrl =
      "https://strawverse.theyogmehta.online/api/mapping/download";
    const tempDbPath = path.join(userDataPath, "data", "mapping_temp.db");
    const mappingDbPath = path.join(userDataPath, "data", "mapping.db");

    try {
      logger.info(
        `[mappingUpdater] Downloading full mapping database from: ${downloadUrl}`,
      );
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
      });
      const gzippedData = Buffer.from(response.data);

      logger.info("[mappingUpdater] Decompressing mapping database...");
      const decompressedData = zlib.gunzipSync(gzippedData);

      fs.writeFileSync(tempDbPath, decompressedData);

      logger.info("[mappingUpdater] Replacing mapping database file...");

      try {
        await closeDb("mapping");
      } catch (closeErr) {
        logger.error(
          `[mappingUpdater] Error closing database connection: ${closeErr.message}`,
        );
      }

      fs.copyFileSync(tempDbPath, mappingDbPath);
      fs.unlinkSync(tempDbPath);

      await openDb("mapping");
      await dropAllTriggers();

      try {
        await mappingExec(`
          CREATE TABLE IF NOT EXISTS mapping_changelog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT,
            action TEXT,
            tbl TEXT,
            row_id TEXT,
            data TEXT
          )
        `);
      } catch (e) {}

      if (latestVersion) {
        await setKeyValue("Settings", mappingTagKey, latestVersion);
      }
      logger.info(
        `[mappingUpdater] Mapping database successfully updated to version: ${latestVersion || "fallback"}`,
      );
      try {
        await syncLibraryIdsWithMapping();
      } catch (syncErr) {}
    } catch (err) {
      logger.error(
        `[mappingUpdater] Failed to update mapping database: ${err.message}`,
      );
      try {
        await closeDb("mapping");
      } catch (e) {}
      try {
        await openDb("mapping");
        await dropAllTriggers();
      } catch (reopenErr) {
        logger.error(
          `[mappingUpdater] Failed to re-open mapping database after error: ${reopenErr.message}`,
        );
      }
    }
  } else {
    await dropAllTriggers();
    try {
      await mappingExec(`
        CREATE TABLE IF NOT EXISTS mapping_changelog (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          version TEXT,
          action TEXT,
          tbl TEXT,
          row_id TEXT,
          data TEXT
        )
      `);

      await mappingExec(`
        CREATE TABLE IF NOT EXISTS next_episodes (
          livechart_id TEXT,
          episode INTEGER,
          date INTEGER,
          title TEXT,
          image TEXT,
          PRIMARY KEY (livechart_id, episode)
        )
      `);
    } catch (e) {
      logger.error(
        `[mappingUpdater] Failed to ensure mapping tables exist: ${e.message}`,
      );
    }

    if (action === "delta" && updates.length > 0) {
      logger.info(
        `[mappingUpdater] Applying ${updates.length} delta updates since version ${storedTag}...`,
      );
      try {
        await mappingExec("PRAGMA foreign_keys = OFF");

        // Build batch operations for all delta updates
        const ops = [];

        const stmtSqlMap = {
          anime:
            "INSERT OR REPLACE INTO anime (malid, livechart_id) VALUES (?, ?)",
          manga: "INSERT OR REPLACE INTO manga (malid) VALUES (?)",
          animepahe:
            "INSERT OR REPLACE INTO animepahe (id, uuid, malid) VALUES (?, ?, ?)",
          anikototv:
            "INSERT OR REPLACE INTO anikototv (id, malid) VALUES (?, ?)",
          anineko: "INSERT OR REPLACE INTO anineko (id, malid) VALUES (?, ?)",
          weebcentral:
            "INSERT OR REPLACE INTO weebcentral (id, malid) VALUES (?, ?)",
          allmanga: "INSERT OR REPLACE INTO allmanga (id, malid) VALUES (?, ?)",
          next_episodes:
            "INSERT OR REPLACE INTO next_episodes (livechart_id, episode, date, title, image) VALUES (?, ?, ?, ?, ?)",
        };
        const changelogSql =
          "INSERT OR REPLACE INTO mapping_changelog (id, version, action, tbl, row_id, data) VALUES (?, ?, ?, ?, ?, ?)";

        for (const update of updates) {
          const { id, action: act, tbl, row_id, data } = update;

          if (act === "INSERT" || act === "UPDATE") {
            const parsedData = JSON.parse(data);
            if (tbl === "anime") {
              ops.push({
                sql: stmtSqlMap.anime,
                params: [
                  parsedData.malid ?? null,
                  parsedData.livechart_id ?? null,
                ],
              });
            } else if (tbl === "manga") {
              ops.push({
                sql: stmtSqlMap.manga,
                params: [parsedData.malid ?? null],
              });
            } else if (tbl === "animepahe") {
              ops.push({
                sql: stmtSqlMap.animepahe,
                params: [
                  parsedData.id ?? null,
                  parsedData.uuid ?? null,
                  parsedData.malid ?? null,
                ],
              });
            } else if (tbl === "anikototv") {
              ops.push({
                sql: stmtSqlMap.anikototv,
                params: [parsedData.id ?? null, parsedData.malid ?? null],
              });
            } else if (tbl === "anineko") {
              ops.push({
                sql: stmtSqlMap.anineko,
                params: [parsedData.id ?? null, parsedData.malid ?? null],
              });
            } else if (tbl === "weebcentral") {
              ops.push({
                sql: stmtSqlMap.weebcentral,
                params: [parsedData.id ?? null, parsedData.malid ?? null],
              });
            } else if (tbl === "allmanga") {
              ops.push({
                sql: stmtSqlMap.allmanga,
                params: [parsedData.id ?? null, parsedData.malid ?? null],
              });
            } else if (tbl === "next_episodes") {
              ops.push({
                sql: stmtSqlMap.next_episodes,
                params: [
                  parsedData.livechart_id ?? null,
                  parsedData.episode ?? null,
                  parsedData.date ?? null,
                  parsedData.title ?? null,
                  parsedData.image ?? null,
                ],
              });
            }
          } else if (act === "DELETE") {
            if (tbl === "anime" || tbl === "manga") {
              ops.push({
                sql: `DELETE FROM ${tbl} WHERE malid = ?`,
                params: [row_id],
              });
            } else if (tbl === "next_episodes") {
              const parts = row_id.split("_");
              const livechartId = parts[0];
              const episode = parseInt(parts[1], 10);
              ops.push({
                sql: "DELETE FROM next_episodes WHERE livechart_id = ? AND episode = ?",
                params: [livechartId ?? null, isNaN(episode) ? null : episode],
              });
            } else {
              ops.push({
                sql: `DELETE FROM ${tbl} WHERE id = ?`,
                params: [row_id],
              });
            }
          }

          ops.push({
            sql: changelogSql,
            params: [id, latestVersion, act, tbl, row_id, data],
          });
        }

        if (ops.length > 0) {
          await batchRun("mapping", ops);
        }

        await mappingExec("PRAGMA foreign_keys = ON");

        if (latestVersion) {
          await setKeyValue("Settings", mappingTagKey, latestVersion);
        }
        logger.info(
          `[mappingUpdater] Mapping database successfully updated via delta to version: ${latestVersion}`,
        );
        try {
          await syncLibraryIdsWithMapping();
        } catch (syncErr) {}
      } catch (err) {
        logger.error(
          `[mappingUpdater] Failed to apply delta updates: ${err.message}`,
        );
        try {
          await mappingExec("PRAGMA foreign_keys = ON");
        } catch (e) {}
      }
    } else {
      logger.info("[mappingUpdater] Mapping database is up to date.");
      if (latestVersion && latestVersion !== storedTag) {
        await setKeyValue("Settings", mappingTagKey, latestVersion);
        logger.info(
          `[mappingUpdater] Updated client version tag to: ${latestVersion}`,
        );
      }
    }
  }
}

async function syncLibraryIdsWithMapping() {
  try {
    // 1. Sync Anime
    const localAnimeList = await queryAll(
      "SELECT id, malid, provider FROM Anime",
    );
    for (const anime of localAnimeList) {
      if (!anime.malid) continue;
      const provider = (anime.provider || "").toLowerCase();
      let targetTable = "";
      let useUuid = false;

      if (provider === "pahe") {
        targetTable = "animepahe";
        useUuid = true;
      } else if (provider === "anikoto") {
        targetTable = "anikototv";
      } else if (provider === "anineko") {
        targetTable = "anineko";
      }

      if (targetTable) {
        const query = useUuid
          ? `SELECT id, uuid FROM ${targetTable} WHERE malid = ? LIMIT 1`
          : `SELECT id FROM ${targetTable} WHERE malid = ? LIMIT 1`;
        const targetRow = await mappingQueryOne(query, [Number(anime.malid)]);
        if (targetRow) {
          const latestId = useUuid
            ? targetRow.uuid || targetRow.id
            : targetRow.id;
          const cleanId = anime.id.replace(/-(sub|dub|hsub|both)$/, "");
          if (latestId && latestId !== cleanId) {
            await run(
              "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              [cleanId, latestId, cleanId, `${cleanId}-%`],
            );
            await run(
              "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              [cleanId, latestId, cleanId, `${cleanId}-%`],
            );
            await run(
              "UPDATE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              [cleanId, latestId, cleanId, `${cleanId}-%`],
            );
            logger.info(
              `[mappingUpdater] Automatically synced local Anime ID from ${cleanId} to ${latestId} to match updated mapping`,
            );
          }
        }
      }
    }

    // 2. Sync Manga
    const localMangaList = await queryAll(
      "SELECT id, malid, provider FROM Manga",
    );
    for (const manga of localMangaList) {
      if (!manga.malid) continue;
      const provider = (manga.provider || "").toLowerCase();
      let targetTable = "";

      if (provider.includes("weebcentral")) {
        targetTable = "weebcentral";
      } else if (provider.includes("allmanga")) {
        targetTable = "allmanga";
      }

      if (targetTable) {
        const targetRow = await mappingQueryOne(
          `SELECT id FROM ${targetTable} WHERE malid = ? LIMIT 1`,
          [Number(manga.malid)],
        );
        if (targetRow) {
          const latestId = targetRow.id;
          const cleanId = manga.id;
          if (latestId && latestId !== cleanId) {
            await run(
              "UPDATE OR REPLACE Manga SET id = REPLACE(id, ?, ?) WHERE id = ?",
              [cleanId, latestId, cleanId],
            );
            await run(
              "UPDATE ReadHistory SET manga_id = REPLACE(manga_id, ?, ?) WHERE manga_id = ?",
              [cleanId, latestId, cleanId],
            );
            logger.info(
              `[mappingUpdater] Automatically synced local Manga ID from ${cleanId} to ${latestId} to match updated mapping`,
            );
          }
        }
      }
    }
  } catch (err) {
    logger.error(`[mappingUpdater] Failed to sync library IDs: ${err.message}`);
  }
}

module.exports = {
  checkForMappingUpdates,
};
