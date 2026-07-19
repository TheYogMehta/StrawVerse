const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { app } = require("electron");
const { logger } = require("./AppLogger");
const { getKeyValue, setKeyValue } = require("./db");
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
  const mappingTagKey = "mapping_release_tag";
  const storedTag = getKeyValue("Settings", mappingTagKey);

  logger.info("[mappingUpdater] Checking for mapping database updates...");

  const tableExists = (tableName) => {
    try {
      if (!global.mappingDb) return false;
      const row = global.mappingDb
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name = ?",
        )
        .get(tableName);
      return !!row;
    } catch (e) {
      return false;
    }
  };

  const missingTables =
    !tableExists("anime") ||
    !tableExists("animepahe") ||
    !tableExists("anikototv") ||
    !tableExists("anineko") ||
    !tableExists("manga") ||
    !tableExists("weebcentral") ||
    !tableExists("allmanga") ||
    !tableExists("next_episodes");

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
    const tempDbPath = path.join(userDataPath, "mapping_temp.db");
    const mappingDbPath = path.join(userDataPath, "mapping.db");

    try {
      logger.info(
        `[mappingUpdater] Downloading full mapping database from: ${downloadUrl}`,
      );
      const response = await axios.get(downloadUrl, {
        responseType: "arraybuffer",
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

      try {
        global.mappingDb
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS mapping_changelog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT,
            action TEXT,
            tbl TEXT,
            row_id TEXT,
            data TEXT
          )
        `,
          )
          .run();
      } catch (e) {}

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
    try {
      if (global.mappingDb) {
        global.mappingDb
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS mapping_changelog (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            version TEXT,
            action TEXT,
            tbl TEXT,
            row_id TEXT,
            data TEXT
          )
        `,
          )
          .run();

        global.mappingDb
          .prepare(
            `
          CREATE TABLE IF NOT EXISTS next_episodes (
            livechart_id TEXT,
            episode INTEGER,
            date INTEGER,
            title TEXT,
            image TEXT,
            PRIMARY KEY (livechart_id, episode)
          )
        `,
          )
          .run();
      }
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
        global.mappingDb.prepare("PRAGMA foreign_keys = OFF").run();

        global.mappingDb.prepare("BEGIN").run();
        try {
          const stmtInsertAnime = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO anime (malid, livechart_id) VALUES (?, ?)",
          );
          const stmtInsertManga = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO manga (malid) VALUES (?)",
          );
          const stmtInsertAnimepahe = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO animepahe (id, uuid, malid) VALUES (?, ?, ?)",
          );
          const stmtInsertAnikototv = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO anikototv (id, malid) VALUES (?, ?)",
          );
          const stmtInsertAnineko = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO anineko (id, malid) VALUES (?, ?)",
          );
          const stmtInsertWeebcentral = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO weebcentral (id, malid) VALUES (?, ?)",
          );
          const stmtInsertAllmanga = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO allmanga (id, malid) VALUES (?, ?)",
          );
          const stmtInsertChangelog = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO mapping_changelog (id, version, action, tbl, row_id, data) VALUES (?, ?, ?, ?, ?, ?)",
          );
          const stmtInsertNextEpisodes = global.mappingDb.prepare(
            "INSERT OR REPLACE INTO next_episodes (livechart_id, episode, date, title, image) VALUES (?, ?, ?, ?, ?)",
          );

          for (const update of updates) {
            const { id, action: act, tbl, row_id, data } = update;

            if (act === "INSERT" || act === "UPDATE") {
              const parsedData = JSON.parse(data);
              if (tbl === "anime") {
                stmtInsertAnime.run(
                  parsedData.malid ?? null,
                  parsedData.livechart_id ?? null,
                );
              } else if (tbl === "manga") {
                stmtInsertManga.run(parsedData.malid ?? null);
              } else if (tbl === "animepahe") {
                stmtInsertAnimepahe.run(
                  parsedData.id ?? null,
                  parsedData.uuid ?? null,
                  parsedData.malid ?? null,
                );
              } else if (tbl === "anikototv") {
                stmtInsertAnikototv.run(
                  parsedData.id ?? null,
                  parsedData.malid ?? null,
                );
              } else if (tbl === "anineko") {
                stmtInsertAnineko.run(
                  parsedData.id ?? null,
                  parsedData.malid ?? null,
                );
              } else if (tbl === "weebcentral") {
                stmtInsertWeebcentral.run(
                  parsedData.id ?? null,
                  parsedData.malid ?? null,
                );
              } else if (tbl === "allmanga") {
                stmtInsertAllmanga.run(
                  parsedData.id ?? null,
                  parsedData.malid ?? null,
                );
              } else if (tbl === "next_episodes") {
                stmtInsertNextEpisodes.run(
                  parsedData.livechart_id ?? null,
                  parsedData.episode ?? null,
                  parsedData.date ?? null,
                  parsedData.title ?? null,
                  parsedData.image ?? null,
                );
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
              } else {
                global.mappingDb
                  .prepare(`DELETE FROM ${tbl} WHERE id = ?`)
                  .run(row_id);
              }
            }

            stmtInsertChangelog.run(id, latestVersion, act, tbl, row_id, data);
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
      .prepare("SELECT id, malid, provider FROM Anime")
      .all();
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

        const targetRow = global.mappingDb
          .prepare(query)
          .get(Number(anime.malid));
        if (targetRow) {
          const latestId = useUuid
            ? targetRow.uuid || targetRow.id
            : targetRow.id;
          const cleanId = anime.id.replace(/-(sub|dub|hsub|both)$/, "");
          if (latestId && latestId !== cleanId) {
            global.db
              .prepare(
                "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              )
              .run(cleanId, latestId, cleanId, `${cleanId}-%`);

            global.db
              .prepare(
                "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              )
              .run(cleanId, latestId, cleanId, `${cleanId}-%`);

            global.db
              .prepare(
                "UPDATE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
              )
              .run(cleanId, latestId, cleanId, `${cleanId}-%`);

            logger.info(
              `[mappingUpdater] Automatically synced local Anime ID from ${cleanId} to ${latestId} to match updated mapping`,
            );
          }
        }
      }
    }

    // 2. Sync Manga
    const localMangaList = global.db
      .prepare("SELECT id, malid, provider FROM Manga")
      .all();
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
        const targetRow = global.mappingDb
          .prepare(`SELECT id FROM ${targetTable} WHERE malid = ? LIMIT 1`)
          .get(Number(manga.malid));
        if (targetRow) {
          const latestId = targetRow.id;
          const cleanId = manga.id;
          if (latestId && latestId !== cleanId) {
            global.db
              .prepare(
                "UPDATE OR REPLACE Manga SET id = REPLACE(id, ?, ?) WHERE id = ?",
              )
              .run(cleanId, latestId, cleanId);

            global.db
              .prepare(
                "UPDATE ReadHistory SET manga_id = REPLACE(manga_id, ?, ?) WHERE manga_id = ?",
              )
              .run(cleanId, latestId, cleanId);

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
  dropAllTriggers,
  syncLibraryIdsWithMapping,
};
