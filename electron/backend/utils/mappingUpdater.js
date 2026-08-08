const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { app } = require("electron");
const { logger } = require("./AppLogger");
const { getKeyValue, setKeyValue } = require("./db");
const { sanitizeFolderName } = require("./DirectoryMaker");
const { DatabaseSync } = require("node:sqlite");

const userDataPath = app.getPath("userData");

function dropAllTriggers(dbInstance) {
  if (!dbInstance) return;
  try {
    const triggers = dbInstance
      .prepare("SELECT name FROM sqlite_master WHERE type='trigger'")
      .all();
    for (const trigger of triggers) {
      dbInstance.prepare(`DROP TRIGGER IF EXISTS ${trigger.name}`).run();
    }
  } catch (e) {
    logger.error(`[mappingUpdater] Failed to drop triggers: ${e.message}`);
  }
}

function ensureMappingTablesExist(dbInstance) {
  if (!dbInstance) return;
  try {
    dbInstance
      .prepare(
        `
      CREATE TABLE IF NOT EXISTS mapping_changelog (
        id INTEGER PRIMARY KEY,
        version TEXT
      )
    `,
      )
      .run();
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
  const mappingTagKey = "mapping_release_tag";
  let storedTag = getKeyValue("Settings", mappingTagKey);

  logger.info(
    `[mappingUpdater] Checking for mapping database updates... (local version: ${storedTag || "none"})`,
  );

  let hasTriggers = false;
  try {
    if (global.mappingDb) {
      const row = global.mappingDb
        .prepare("SELECT 1 FROM sqlite_master WHERE type='trigger' LIMIT 1")
        .get();
      if (row) {
        logger.info(
          "[mappingUpdater] Legacy triggers detected in mapping database. Forcing full sync to clean up database.",
        );
        hasTriggers = true;
      }
    }
  } catch (e) {}

  let isNextEpisodesEmpty = false;
  try {
    if (global.mappingDb) {
      const row = global.mappingDb
        .prepare("SELECT COUNT(*) as count FROM next_episodes")
        .get();
      if (!row || row.count === 0) {
        isNextEpisodesEmpty = true;
      }
    }
  } catch (e) {
    isNextEpisodesEmpty = true;
  }

  let lastId = 0;
  try {
    if (global.mappingDb) {
      const row = global.mappingDb
        .prepare("SELECT MAX(id) as maxId FROM mapping_changelog")
        .get();
      if (row && typeof row.maxId === "number") {
        lastId = row.maxId;
      }
    }
  } catch (e) {}

  let latestVersion = null;
  try {
    const vRes = await axios.get(
      "https://strawverse.theyogmehta.online/api/mapping/version",
      {
        headers: {
          os:
            process.platform === "win32"
              ? "Windows"
              : process.platform === "darwin"
                ? "macOS"
                : "Linux",
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
        os:
          process.platform === "win32"
            ? "Windows"
            : process.platform === "darwin"
              ? "macOS"
              : "Linux",
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
    const tempDbPath = path.join(userDataPath, "mapping_temp.db");
    const mappingDbPath = path.join(userDataPath, "mapping.db");

    try {
      logger.info(
        `[mappingUpdater] Downloading full mapping database from: ${downloadUrl}`,
      );
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
        headers: {
          os:
            process.platform === "win32"
              ? "Windows"
              : process.platform === "darwin"
                ? "macOS"
                : "Linux",
        },
      });
      const gzippedData = Buffer.from(response.data);

      logger.info("[mappingUpdater] Decompressing mapping database...");
      const decompressedData = await new Promise((resolve, reject) => {
        zlib.gunzip(gzippedData, (err, result) => {
          if (err) reject(err);
          else resolve(result);
        });
      });

      await fs.promises.writeFile(tempDbPath, decompressedData);

      logger.info("[mappingUpdater] Replacing mapping database file...");

      if (global.mappingDb) {
        try {
          global.mappingDb.close();
        } catch (closeErr) {
          logger.error(
            `[mappingUpdater] Error closing database connection: ${closeErr.message}`,
          );
        }
      }

      await fs.promises.copyFile(tempDbPath, mappingDbPath);
      await fs.promises.unlink(tempDbPath);

      global.mappingDb = new DatabaseSync(mappingDbPath);
      try {
        global.mappingDb.prepare("PRAGMA journal_mode = WAL").run();
      } catch (e) {}
      dropAllTriggers(global.mappingDb);
      ensureMappingTablesExist(global.mappingDb);

      if (latestVersion) {
        setKeyValue("Settings", mappingTagKey, latestVersion);
      }
      logger.info(
        `[mappingUpdater] Mapping database successfully updated to version: ${latestVersion || "fallback"}`,
      );
      try {
        syncLibraryIdsWithMapping();
      } catch (syncErr) {}
    } catch (err) {
      logger.error(
        `[mappingUpdater] Failed to update mapping database: ${err.message}`,
      );
      try {
        if (global.mappingDb) {
          global.mappingDb.close();
        }
      } catch (e) {}
      try {
        global.mappingDb = new DatabaseSync(mappingDbPath);
        dropAllTriggers(global.mappingDb);
      } catch (reopenErr) {
        logger.error(
          `[mappingUpdater] Failed to re-open mapping database after error: ${reopenErr.message}`,
        );
      }
    }
  } else {
    dropAllTriggers(global.mappingDb);
    ensureMappingTablesExist(global.mappingDb);

    if (action === "delta" && updates.length > 0) {
      logger.info(
        `[mappingUpdater] Applying ${updates.length} delta updates since version ${storedTag}...`,
      );
      try {
        global.mappingDb.prepare("PRAGMA foreign_keys = OFF").run();

        global.mappingDb.prepare("BEGIN").run();
        try {
          const stmtInsertChangelog = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO mapping_changelog (id, version) VALUES (?, ?)",
          );

          for (const update of updates) {
            const { id, action: act, tbl, row_id, data } = update;

            // Ensure target table exists in local mappingDb schema before executing SQL
            const tableCheck = global.mappingDb
              .prepare(
                "SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?",
              )
              .get(tbl);

            if (!tableCheck) {
              stmtInsertChangelog.run(id, latestVersion);
              continue;
            }

            if (act === "INSERT" || act === "UPDATE") {
              if (data) {
                const parsedData = JSON.parse(data);
                const tableColsRes = global.mappingDb
                  .prepare(`PRAGMA table_info(${tbl})`)
                  .all();
                const validCols = new Set(tableColsRes.map((c) => c.name));

                const validKeys = Object.keys(parsedData).filter((k) =>
                  validCols.has(k),
                );
                if (validKeys.length > 0) {
                  const cols = validKeys.join(", ");
                  const placeholders = validKeys.map(() => "?").join(", ");
                  const values = validKeys.map((k) => parsedData[k] ?? null);
                  global.mappingDb
                    .prepare(
                      `INSERT OR REPLACE INTO ${tbl} (${cols}) VALUES (${placeholders})`,
                    )
                    .run(...values);
                }
              }
            } else if (act === "DELETE") {
              if (tbl === "anime" || tbl === "manga") {
                global.mappingDb
                  .prepare(`DELETE FROM ${tbl} WHERE malid = ?`)
                  .run(row_id);
              } else if (tbl === "next_episodes") {
                const parts = row_id.split("_");
                const livechartId = parts[0];
                const episode = parseInt(parts[1], 10);
                global.mappingDb
                  .prepare(
                    "DELETE FROM next_episodes WHERE livechart_id = ? AND episode = ?",
                  )
                  .run(livechartId ?? null, isNaN(episode) ? null : episode);
              } else if (tbl === "provider_metadata") {
                global.mappingDb
                  .prepare("DELETE FROM provider_metadata WHERE table_name = ?")
                  .run(row_id);
              } else {
                global.mappingDb
                  .prepare(`DELETE FROM ${tbl} WHERE id = ?`)
                  .run(row_id);
              }
            }

            stmtInsertChangelog.run(id, latestVersion);
          }

          global.mappingDb.prepare("COMMIT").run();
        } catch (txErr) {
          global.mappingDb.prepare("ROLLBACK").run();
          throw txErr;
        }

        global.mappingDb.prepare("PRAGMA foreign_keys = ON").run();

        if (latestVersion) {
          setKeyValue("Settings", mappingTagKey, latestVersion);
        }
        logger.info(
          `[mappingUpdater] Mapping database successfully updated via delta to version: ${latestVersion}`,
        );
        try {
          syncLibraryIdsWithMapping();
        } catch (syncErr) {}
      } catch (err) {
        logger.error(
          `[mappingUpdater] Failed to apply delta updates: ${err.message}`,
        );
        try {
          global.mappingDb.prepare("PRAGMA foreign_keys = ON").run();
        } catch (e) {}
      }
    } else {
      logger.info("[mappingUpdater] Mapping database is up to date.");
      if (latestVersion && latestVersion !== storedTag) {
        setKeyValue("Settings", mappingTagKey, latestVersion);
        logger.info(
          `[mappingUpdater] Updated client version tag to: ${latestVersion}`,
        );
      }
    }
  }
}

function syncLibraryIdsWithMapping() {
  if (!global.db || !global.mappingDb) return;
  try {
    // 1. Sync Anime
    const localAnimeList = global.db
      .prepare("SELECT id, malid, provider, title, folder_name FROM Anime")
      .all();
    for (const anime of localAnimeList) {
      let malid = anime.malid ? Number(anime.malid) : null;
      const provider = (anime.provider || "").toLowerCase();

      // If malid is missing, attempt resolution from mappingDb using anime.id
      if (!malid) {
        try {
          const malRow = global.mappingDb
            .prepare(
              `
              SELECT malid FROM pahe WHERE id = ? OR uuid = ?
              UNION ALL
              SELECT malid FROM anikoto WHERE id = ?
              UNION ALL
              SELECT malid FROM anineko WHERE id = ?
              LIMIT 1
            `,
            )
            .get(anime.id, anime.id, anime.id, anime.id);
          if (malRow && malRow.malid) {
            malid = Number(malRow.malid);
            global.db
              .prepare("UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?")
              .run(String(malid), anime.id, `${anime.id}-%`);
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
          targetRow = global.mappingDb.prepare(query).get(malid);
        }
        if (!targetRow) {
          const query = useUuid
            ? `SELECT id, uuid, malid FROM ${targetTable} WHERE id = ? OR uuid = ? LIMIT 1`
            : `SELECT id, malid FROM ${targetTable} WHERE id = ? LIMIT 1`;
          targetRow = useUuid
            ? global.mappingDb.prepare(query).get(anime.id, anime.id)
            : global.mappingDb.prepare(query).get(anime.id);
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
              global.db
                .prepare(
                  "UPDATE Anime SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id LIKE ?",
                )
                .run(existingFolder, anime.id, `${anime.id}-%`);
            } catch (_) {}

            global.db
              .prepare(
                "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              )
              .run(anime.id, latestId, anime.id, `${anime.id}-%`);

            global.db
              .prepare(
                "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              )
              .run(anime.id, latestId, anime.id, `${anime.id}-%`);

            global.db
              .prepare(
                "UPDATE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              )
              .run(anime.id, latestId, anime.id, `${anime.id}-%`);

            try {
              global.db
                .prepare(
                  "UPDATE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
                )
                .run(anime.id, latestId, anime.id, `${anime.id}-%`);
            } catch (_) {}

            if (targetRow.malid && !anime.malid) {
              global.db
                .prepare("UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?")
                .run(String(targetRow.malid), latestId, `${latestId}-%`);
            }

            logger.info(
              `[mappingUpdater] Automatically synced local Anime ID from ${anime.id} to ${latestId} to match updated mapping`,
            );
          }
        }
      }
    }

    // 2. Sync Manga
    const localMangaList = global.db
      .prepare("SELECT id, malid, provider, title, folder_name FROM Manga")
      .all();
    for (const manga of localMangaList) {
      let malid = manga.malid ? Number(manga.malid) : null;
      const provider = (manga.provider || "").toLowerCase();

      if (!malid) {
        try {
          const malRow = global.mappingDb
            .prepare(
              `
              SELECT malid FROM weebcentral WHERE id = ?
              UNION ALL
              SELECT malid FROM allmanga WHERE id = ?
              LIMIT 1
            `,
            )
            .get(manga.id, manga.id);
          if (malRow && malRow.malid) {
            malid = Number(malRow.malid);
            global.db
              .prepare("UPDATE Manga SET MalID = ? WHERE id = ?")
              .run(String(malid), manga.id);
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
          targetRow = global.mappingDb
            .prepare(
              `SELECT id, malid FROM ${targetTable} WHERE malid = ? LIMIT 1`,
            )
            .get(malid);
        }
        if (!targetRow) {
          targetRow = global.mappingDb
            .prepare(
              `SELECT id, malid FROM ${targetTable} WHERE id = ? LIMIT 1`,
            )
            .get(manga.id);
        }

        if (targetRow) {
          const latestId = targetRow.id;
          if (latestId && latestId !== manga.id) {
            const existingFolder =
              manga.folder_name ||
              (manga.title ? sanitizeFolderName(manga.title) : manga.id);
            try {
              global.db
                .prepare(
                  "UPDATE Manga SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ?",
                )
                .run(existingFolder, manga.id);
            } catch (_) {}

            global.db
              .prepare(
                "UPDATE OR REPLACE Manga SET id = REPLACE(id, ?, ?) WHERE id = ?",
              )
              .run(manga.id, latestId, manga.id);

            global.db
              .prepare(
                "UPDATE ReadHistory SET manga_id = REPLACE(manga_id, ?, ?) WHERE manga_id = ?",
              )
              .run(manga.id, latestId, manga.id);

            if (targetRow.malid && !manga.malid) {
              global.db
                .prepare("UPDATE Manga SET MalID = ? WHERE id = ?")
                .run(String(targetRow.malid), latestId);
            }

            logger.info(
              `[mappingUpdater] Automatically synced local Manga ID from ${manga.id} to ${latestId} to match updated mapping`,
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
  dropAllTriggers,
  syncLibraryIdsWithMapping,
};
