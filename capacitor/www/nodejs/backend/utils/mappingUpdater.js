const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { logger } = require("./AppLogger");
const { sanitizeFolderName } = require("./DirectoryMaker");
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

async function ensureMappingTablesExist() {
  try {
    await mappingExec(`
      CREATE TABLE IF NOT EXISTS mapping_changelog (
        id INTEGER PRIMARY KEY,
        version TEXT
      )
    `);
  } catch (e) {
    logger.error(
      `[mappingUpdater] Failed to ensure mapping_changelog table exists: ${e.message}`,
    );
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
    2: "pahe",
    3: "anikoto",
    4: "anineko",
    5: "manga",
    6: "weebcentral",
    7: "next_episodes",
    8: "allmanga",
    9: "provider_metadata",
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
    let tbl = tblRevMap[tblVal];
    if (!tbl || tblVal === 255) {
      if (buffer.length < offset + 1) return { action: "full_sync" };
      const tblLen = buffer.readUInt8(offset);
      offset += 1;
      if (buffer.length < offset + tblLen) return { action: "full_sync" };
      tbl = buffer.toString("utf8", offset, offset + tblLen);
      offset += tblLen;
    }

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
  let storedTag = await getKeyValue("Settings", mappingTagKey);

  logger.info(
    `[mappingUpdater] Checking for mapping database updates... (local version: ${storedTag || "none"})`,
  );

  let hasNextEpisodesTable = false;
  let hasMappingChangelogTable = false;
  try {
    const tablesList = await mappingQueryAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('next_episodes', 'mapping_changelog')",
    );
    const tableNames = tablesList.map((t) => t.name);
    hasNextEpisodesTable = tableNames.includes("next_episodes");
    hasMappingChangelogTable = tableNames.includes("mapping_changelog");
  } catch (e) {}

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

  let latestVersion = null;
  try {
    const vRes = await axios.get(
      "https://strawverse.theyogmehta.online/api/mapping/version",
      {
        headers: {
          os: "Android",
        },
      },
    );
    latestVersion = vRes.data?.version;
  } catch (e) {
    logger.error(`[mappingUpdater] Failed to get latest version: ${e.message}`);
  }

  if (
    storedTag &&
    latestVersion &&
    storedTag === latestVersion &&
    !hasTriggers
  ) {
    logger.info(
      `[mappingUpdater] Local mapping database is up to date at version ${storedTag}. Skipping download.`,
    );
    dropAllTriggers(global.mappingDb);
    ensureMappingTablesExist(global.mappingDb);
    return;
  }

  let updateResponse = null;
  try {
    const url = storedTag
      ? `https://strawverse.theyogmehta.online/api/mapping/updates?version=${storedTag}&last_id=${lastId}`
      : `https://strawverse.theyogmehta.online/api/mapping/updates?last_id=${lastId}`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      headers: {
        os: "Android",
      },
    });
    const buffer = Buffer.from(response.data);
    updateResponse = deserializeDelta(buffer);
  } catch (err) {
    logger.error(
      `[mappingUpdater] Failed to check for mapping updates from server: ${err.message}`,
    );
  }

  let action = updateResponse?.action || "full_sync";
  if (!latestVersion && updateResponse?.version) {
    latestVersion = updateResponse.version;
  }
  let updates = updateResponse?.updates || [];

  if (action === "delta" && updates.length > 10000) {
    logger.info(
      `[mappingUpdater] Delta update contains ${updates.length} records. Forcing full sync...`,
    );
    action = "full_sync";
  }

  if (hasTriggers) {
    action = "full_sync";
  }

  if (action === "full_sync") {
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
        headers: {
          os: "Android",
        },
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
      await ensureMappingTablesExist();

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
    await ensureMappingTablesExist();

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
            "INSERT OR REPLACE INTO anime (malid, livechart_id, image_url) VALUES (?, ?, ?)",
          manga: "INSERT OR REPLACE INTO manga (malid) VALUES (?)",
          pahe: "INSERT OR REPLACE INTO pahe (id, uuid, malid) VALUES (?, ?, ?)",
          anikoto: "INSERT OR REPLACE INTO anikoto (id, malid) VALUES (?, ?)",
          anineko: "INSERT OR REPLACE INTO anineko (id, malid) VALUES (?, ?)",
          weebcentral:
            "INSERT OR REPLACE INTO weebcentral (id, malid) VALUES (?, ?)",
          allmanga: "INSERT OR REPLACE INTO allmanga (id, malid) VALUES (?, ?)",
          next_episodes:
            "INSERT OR REPLACE INTO next_episodes (livechart_id, episode, date, title, image) VALUES (?, ?, ?, ?, ?)",
          domain_concurrency:
            "INSERT OR REPLACE INTO domain_concurrency (domain, current_concurrency, max_concurrency, updated_at) VALUES (?, ?, ?, ?)",
        };
        const changelogSql =
          "INSERT OR REPLACE INTO mapping_changelog (id, version) VALUES (?, ?)";

        const UPDATE_CHUNK_SIZE = 500;
        for (let i = 0; i < updates.length; i += UPDATE_CHUNK_SIZE) {
          const updateChunk = updates.slice(i, i + UPDATE_CHUNK_SIZE);
          const ops = [];

          for (const update of updateChunk) {
            const { id, action: act, tbl, row_id, data } = update;

            const tableCheck = await mappingQueryOne(
              "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
              [tbl],
            );

            if (!tableCheck) {
              ops.push({
                sql: "INSERT OR REPLACE INTO mapping_changelog (id, version) VALUES (?, ?)",
                params: [id, latestVersion],
              });
              continue;
            }

            if (act === "INSERT" || act === "UPDATE") {
              if (data) {
                const parsedData = JSON.parse(data);
                const tableColsRes = await mappingQueryAll(
                  `PRAGMA table_info(${tbl})`,
                );
                const validCols = new Set(
                  (tableColsRes || []).map((c) => c.name),
                );
                const validKeys = Object.keys(parsedData).filter((k) =>
                  validCols.has(k),
                );

                if (validKeys.length > 0) {
                  const cols = validKeys.join(", ");
                  const placeholders = validKeys.map(() => "?").join(", ");
                  const values = validKeys.map((k) => parsedData[k] ?? null);
                  ops.push({
                    sql: `INSERT OR REPLACE INTO ${tbl} (${cols}) VALUES (${placeholders})`,
                    params: values,
                  });
                }
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
                  params: [
                    livechartId ?? null,
                    isNaN(episode) ? null : episode,
                  ],
                });
              } else if (tbl === "provider_metadata") {
                ops.push({
                  sql: "DELETE FROM provider_metadata WHERE table_name = ?",
                  params: [row_id],
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
              params: [id, latestVersion],
            });
          }

          if (ops.length > 0) {
            await batchRun("mapping", ops);
            await new Promise((r) => setTimeout(r, 0));
          }
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
      try {
        await syncLibraryIdsWithMapping();
      } catch (syncErr) {}
    }
  }
}

async function syncLibraryIdsWithMapping() {
  try {
    // 1. Sync Anime
    const localAnimeList = await queryAll(
      "SELECT id, malid, provider, title, folder_name FROM Anime",
    );
    for (const anime of localAnimeList) {
      let malid = anime.malid ? Number(anime.malid) : null;
      const provider = (anime.provider || "").toLowerCase();

      // If malid is missing, attempt resolution from mappingDb using anime.id
      if (!malid) {
        try {
          const malRow = await mappingQueryOne(
            `
              SELECT malid FROM pahe WHERE id = ? OR uuid = ?
              UNION ALL
              SELECT malid FROM anikoto WHERE id = ?
              UNION ALL
              SELECT malid FROM anineko WHERE id = ?
              LIMIT 1
            `,
            [anime.id, anime.id, anime.id, anime.id],
          );
          if (malRow && malRow.malid) {
            malid = Number(malRow.malid);
            await run("UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?", [
              String(malid),
              anime.id,
              `${anime.id}-%`,
            ]);
          }
        } catch (_) {}
      }

      let targetTable = "";
      let useUuid = false;

      if (provider.includes("pahe")) {
        targetTable = "pahe";
        useUuid = true;
      } else if (provider.includes("anikoto")) {
        targetTable = "anikoto";
      } else if (provider.includes("anineko")) {
        targetTable = "anineko";
      } else {
        targetTable = "pahe";
        useUuid = true;
      }

      if (targetTable) {
        let targetRow = null;
        if (malid) {
          const query = useUuid
            ? `SELECT id, uuid, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`
            : `SELECT id, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`;
          targetRow = await mappingQueryOne(query, [malid]);
        }
        if (!targetRow) {
          const query = useUuid
            ? `SELECT id, uuid, malid FROM ${targetTable} WHERE id = ? OR uuid = ? LIMIT 1`
            : `SELECT id, malid FROM ${targetTable} WHERE id = ? LIMIT 1`;
          targetRow = useUuid
            ? await mappingQueryOne(query, [anime.id, anime.id])
            : await mappingQueryOne(query, [anime.id]);
        }

        if (targetRow) {
          const latestId = useUuid
            ? targetRow.uuid || targetRow.id
            : targetRow.id;
          if (latestId && latestId !== anime.id) {
            const existingFolder =
              anime.folder_name ||
              (anime.title ? sanitizeFolderName(anime.title) : anime.id);
            try {
              await run(
                "UPDATE Anime SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id LIKE ?",
                [existingFolder, anime.id, `${anime.id}-%`],
              );
            } catch (_) {}

            await run(
              "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              [anime.id, latestId, anime.id, `${anime.id}-%`],
            );
            await run(
              "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              [anime.id, latestId, anime.id, `${anime.id}-%`],
            );
            await run(
              "UPDATE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              [anime.id, latestId, anime.id, `${anime.id}-%`],
            );
            try {
              await run(
                "UPDATE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
                [anime.id, latestId, anime.id, `${anime.id}-%`],
              );
            } catch (_) {}

            if (targetRow.malid && !anime.malid) {
              await run(
                "UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?",
                [String(targetRow.malid), latestId, `${latestId}-%`],
              );
            }

            logger.info(
              `[mappingUpdater] Automatically synced local Anime ID from ${anime.id} to ${latestId} to match updated mapping`,
            );
          }
        }
      }
    }

    // 2. Sync Manga
    const localMangaList = await queryAll(
      "SELECT id, malid, provider, title, folder_name FROM Manga",
    );
    for (const manga of localMangaList) {
      let malid = manga.malid ? Number(manga.malid) : null;
      const provider = (manga.provider || "").toLowerCase();

      if (!malid) {
        try {
          const malRow = await mappingQueryOne(
            `
              SELECT malid FROM weebcentral WHERE id = ?
              UNION ALL
              SELECT malid FROM allmanga WHERE id = ?
              LIMIT 1
            `,
            [manga.id, manga.id],
          );
          if (malRow && malRow.malid) {
            malid = Number(malRow.malid);
            await run("UPDATE Manga SET MalID = ? WHERE id = ?", [
              String(malid),
              manga.id,
            ]);
          }
        } catch (_) {}
      }

      let targetTable = "";
      if (provider.includes("weebcentral")) {
        targetTable = "weebcentral";
      } else if (provider.includes("allmanga")) {
        targetTable = "allmanga";
      } else {
        targetTable = "weebcentral";
      }

      if (targetTable) {
        let targetRow = null;
        if (malid) {
          targetRow = await mappingQueryOne(
            `SELECT id, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`,
            [malid],
          );
        }
        if (!targetRow) {
          targetRow = await mappingQueryOne(
            `SELECT id, malid FROM ${targetTable} WHERE id = ? LIMIT 1`,
            [manga.id],
          );
        }

        if (targetRow) {
          const latestId = targetRow.id;
          if (latestId && latestId !== manga.id) {
            const existingFolder =
              manga.folder_name ||
              (manga.title ? sanitizeFolderName(manga.title) : manga.id);
            try {
              await run(
                "UPDATE Manga SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ?",
                [existingFolder, manga.id],
              );
            } catch (_) {}

            await run(
              "UPDATE OR REPLACE Manga SET id = REPLACE(id, ?, ?) WHERE id = ?",
              [manga.id, latestId, manga.id],
            );
            await run(
              "UPDATE ReadHistory SET manga_id = REPLACE(manga_id, ?, ?) WHERE manga_id = ?",
              [manga.id, latestId, manga.id],
            );
            if (targetRow.malid && !manga.malid) {
              await run("UPDATE Manga SET MalID = ? WHERE id = ?", [
                String(targetRow.malid),
                latestId,
              ]);
            }
            logger.info(
              `[mappingUpdater] Automatically synced local Manga ID from ${manga.id} to ${latestId} to match updated mapping`,
            );
          }
        }
      }
    }
    if (typeof syncDomainConcurrencyFromMappingDb === "function") {
      await syncDomainConcurrencyFromMappingDb();
    }
  } catch (err) {
    logger.error(`[mappingUpdater] Failed to sync library IDs: ${err.message}`);
  }
}

module.exports = {
  checkForMappingUpdates,
};
