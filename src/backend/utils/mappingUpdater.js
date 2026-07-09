const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { app } = require("electron");
const { logger } = require("./AppLogger");
const { getKeyValue, setKeyValue } = require("./db");
const { DatabaseSync } = require("node:sqlite");

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
  const userDataPath = app.getPath("userData");
  const mappingTagKey = "mapping_release_tag";
  const storedTag = getKeyValue("Settings", mappingTagKey);

  logger.info("[mappingUpdater] Checking for mapping database updates...");
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
      ? `https://mapper.theyogmehta.online/api/mapping/updates?version=${storedTag}&last_id=${lastId}`
      : `https://mapper.theyogmehta.online/api/mapping/updates?last_id=${lastId}`;
    const response = await axios.get(url, { responseType: "arraybuffer" });
    const buffer = Buffer.from(response.data);
    updateResponse = deserializeDelta(buffer);
  } catch (err) {
    logger.error(
      `[mappingUpdater] Failed to check for mapping updates from server: ${err.message}`,
    );
  }

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
    }
  } catch (e) {
    logger.error(
      `[mappingUpdater] Failed to ensure mapping_changelog table exists: ${e.message}`,
    );
  }

  const missingTables =
    !tableExists("anime") ||
    !tableExists("animepahe") ||
    !tableExists("anikototv") ||
    !tableExists("anineko") ||
    !tableExists("manga") ||
    !tableExists("weebcentral") ||
    !tableExists("allmanga");

  let action = "full_sync";
  let latestVersion = null;
  let updates = [];

  if (updateResponse) {
    action = updateResponse.action;
    latestVersion = updateResponse.version;
    updates = updateResponse.updates || [];
  }

  if (missingTables) {
    action = "full_sync";
  }

  if (action === "full_sync") {
    if (!latestVersion) {
      try {
        const vRes = await axios.get(
          "https://mapper.theyogmehta.online/api/mapping/version",
        );
        latestVersion = vRes.data?.version;
      } catch (e) {
        logger.error(
          `[mappingUpdater] Failed to get latest version: ${e.message}`,
        );
      }
    }

    const downloadUrl =
      "https://mapper.theyogmehta.online/api/mapping/download";
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
      const decompressedData = zlib.gunzipSync(gzippedData);

      fs.writeFileSync(tempDbPath, decompressedData);

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

      fs.copyFileSync(tempDbPath, mappingDbPath);
      fs.unlinkSync(tempDbPath);

      global.mappingDb = new DatabaseSync(mappingDbPath);

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
      } catch (reopenErr) {
        logger.error(
          `[mappingUpdater] Failed to re-open mapping database after error: ${reopenErr.message}`,
        );
      }
    }
  } else if (action === "delta" && updates.length > 0) {
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

        for (const update of updates) {
          const { id, action: act, tbl, row_id, data } = update;

          if (act === "INSERT" || act === "UPDATE") {
            const parsedData = JSON.parse(data);
            if (tbl === "anime") {
              stmtInsertAnime.run(parsedData.malid, parsedData.livechart_id);
            } else if (tbl === "manga") {
              stmtInsertManga.run(parsedData.malid);
            } else if (tbl === "animepahe") {
              stmtInsertAnimepahe.run(
                parsedData.id,
                parsedData.uuid,
                parsedData.malid,
              );
            } else if (tbl === "anikototv") {
              stmtInsertAnikototv.run(parsedData.id, parsedData.malid);
            } else if (tbl === "anineko") {
              stmtInsertAnineko.run(parsedData.id, parsedData.malid);
            } else if (tbl === "weebcentral") {
              stmtInsertWeebcentral.run(parsedData.id, parsedData.malid);
            } else if (tbl === "allmanga") {
              stmtInsertAllmanga.run(parsedData.id, parsedData.malid);
            }
          } else if (act === "DELETE") {
            if (tbl === "anime" || tbl === "manga") {
              global.mappingDb
                .prepare(`DELETE FROM ${tbl} WHERE malid = ?`)
                .run(row_id);
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
  }
}

module.exports = {
  checkForMappingUpdates,
};
