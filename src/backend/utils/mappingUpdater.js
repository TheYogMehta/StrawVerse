const axios = require("axios");
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { app } = require("electron");
const { logger } = require("./AppLogger");
const { getKeyValue, setKeyValue } = require("./db");
const { DatabaseSync } = require("node:sqlite");

async function checkForMappingUpdates() {
  const userDataPath = app.getPath("userData");
  const mappingTagKey = "mapping_release_tag";
  const storedTag = getKeyValue("Settings", mappingTagKey);

  logger.info("[mappingUpdater] Checking for mapping database updates...");
  let latestRelease = null;
  try {
    const response = await axios.get(
      "https://api.github.com/repos/TheYogMehta/extensions/releases/latest",
    );
    latestRelease = response.data;
  } catch (err) {
    logger.error(
      `[mappingUpdater] Failed to check for mapping updates from GitHub: ${err.message}`,
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
      if (!row) return false;
      const countRow = global.mappingDb
        .prepare(`SELECT count(*) as count FROM ${tableName}`)
        .get();
      return countRow && countRow.count > 0;
    } catch (e) {
      return false;
    }
  };

  const needsUpdate = latestRelease && latestRelease.tag_name !== storedTag;
  const missingTables =
    !tableExists("anime") ||
    !tableExists("animepahe") ||
    !tableExists("anikototv");

  if (needsUpdate || missingTables) {
    if (needsUpdate) {
      logger.info(
        `[mappingUpdater] Found new mapping update: ${latestRelease.tag_name} (stored tag: ${storedTag || "none"})`,
      );
    } else {
      logger.info(
        `[mappingUpdater] Mapping tables are missing or empty in mapping.db. Downloading latest mappings...`,
      );
    }

    let downloadUrl = null;
    if (latestRelease) {
      const asset = latestRelease.assets.find(
        (a) => a.name === "mapping.db.gz",
      );
      if (asset) {
        downloadUrl = asset.browser_download_url;
      }
    }

    if (!downloadUrl) {
      return;
    }

    const tempDbPath = path.join(userDataPath, "mapping_temp.db");
    const mappingDbPath = path.join(userDataPath, "mapping.db");

    try {
      logger.info(
        `[mappingUpdater] Downloading mapping database from: ${downloadUrl}`,
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

      if (latestRelease) {
        setKeyValue("Settings", mappingTagKey, latestRelease.tag_name);
      }
      logger.info(
        `[mappingUpdater] Mapping database successfully updated to tag: ${latestRelease ? latestRelease.tag_name : "fallback"}`,
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
  } else {
    logger.info("[mappingUpdater] Mapping database is up to date.");
  }
}

module.exports = {
  checkForMappingUpdates,
};
