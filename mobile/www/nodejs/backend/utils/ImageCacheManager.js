const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

const { logger } = require("./AppLogger");
const { getKeyValue } = require("./db");
const { getHeaders } = require("./proxyHeaders");

function getImageCacheDir() {
  const dir = path.join(app.getPath("userData"), "image_cache");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getHash(url) {
  return crypto.createHash("md5").update(url).digest("hex");
}

function getCacheStats() {
  try {
    const row = global.db
      .prepare(
        "SELECT COUNT(*) as count, SUM(file_size) as size FROM ImageCache",
      )
      .get();
    return {
      filesCount: row?.count || 0,
      sizeInBytes: row?.size || 0,
    };
  } catch (e) {
    logger.error("Failed to get cache stats: " + e.message);
    return { filesCount: 0, sizeInBytes: 0 };
  }
}

async function clearCache() {
  try {
    const dir = getImageCacheDir();
    const files = await fs.promises.readdir(dir);
    for (const file of files) {
      try {
        await fs.promises.unlink(path.join(dir, file));
      } catch (_) {}
    }
    global.db.prepare("DELETE FROM ImageCache").run();
    logger.info("Image cache cleared successfully.");
    return { success: true };
  } catch (e) {
    logger.error("Failed to clear image cache: " + e.message);
    return { success: false, error: e.message };
  }
}

async function cacheImage(url, buffer = null) {
  try {
    if (!url) return null;
    if (
      url.startsWith("data:") ||
      url.startsWith("file://") ||
      url.startsWith("/")
    ) {
      return null;
    }

    const hash = getHash(url);
    let ext = "jpg";
    try {
      const u = new URL(url);
      const pathname = u.pathname;
      const matchedExt = pathname.match(/\.(jpg|jpeg|png|gif|webp|svg|ico)$/i);
      if (matchedExt) {
        ext = matchedExt[1].toLowerCase();
      }
    } catch (_) {}

    const filename = `${hash}.${ext}`;
    const cacheDir = getImageCacheDir();
    const filePath = path.join(cacheDir, filename);

    let imageBuffer = buffer;
    if (!imageBuffer) {
      const headersObj = getHeaders(url);
      const requestHeaders = {};
      if (headersObj.Referer) requestHeaders["Referer"] = headersObj.Referer;
      if (headersObj["User-Agent"])
        requestHeaders["User-Agent"] = headersObj["User-Agent"];
      if (headersObj.Cookie) requestHeaders["Cookie"] = headersObj.Cookie;

      const response = await axios.get(url, {
        headers: requestHeaders,
        responseType: "arraybuffer",
        timeout: 10000,
      });
      imageBuffer = Buffer.from(response.data);
    }

    await fs.promises.writeFile(filePath, imageBuffer);
    const fileSize = imageBuffer.length;

    const now = Date.now();
    global.db
      .prepare(
        `
      INSERT INTO ImageCache (url, filename, file_size, last_accessed)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        filename = excluded.filename,
        file_size = excluded.file_size,
        last_accessed = excluded.last_accessed
    `,
      )
      .run(url, filename, fileSize, now);

    enforceLimit().catch((err) =>
      logger.error("Cache eviction error: " + err.message),
    );

    return filename;
  } catch (e) {
    logger.error(`Failed to cache image for ${url}: ${e.message}`);
    return null;
  }
}

async function enforceLimit() {
  try {
    const limitGb = getKeyValue("Settings", "imageCacheSizeLimit") ?? 5;
    const limitBytes = limitGb * 1024 * 1024 * 1024;

    const stats = getCacheStats();
    if (stats.sizeInBytes <= limitBytes) {
      return;
    }

    logger.info(
      `Image cache size (${(stats.sizeInBytes / (1024 * 1024)).toFixed(1)} MB) exceeds limit (${limitGb} GB). Evicting oldest items...`,
    );

    const items = global.db
      .prepare(
        "SELECT url, filename, file_size FROM ImageCache ORDER BY last_accessed ASC",
      )
      .all();
    let currentSize = stats.sizeInBytes;
    const cacheDir = getImageCacheDir();

    const deleteStmt = global.db.prepare(
      "DELETE FROM ImageCache WHERE url = ?",
    );

    for (const item of items) {
      if (currentSize <= limitBytes * 0.9) {
        break;
      }
      try {
        const filePath = path.join(cacheDir, item.filename);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (_) {}

      deleteStmt.run(item.url);
      currentSize -= item.file_size;
    }

    logger.info(
      "Cache eviction completed. New size: " +
        (currentSize / (1024 * 1024)).toFixed(1) +
        " MB",
    );
  } catch (e) {
    logger.error("Error enforcing cache limit: " + e.message);
  }
}

async function runStartupCleanup() {
  logger.info("Running startup image cache cleanup...");
  try {
    const cacheDir = getImageCacheDir();

    const cutoff = Date.now() - 518400000;
    const expiredItems = global.db
      .prepare("SELECT url, filename FROM ImageCache WHERE last_accessed < ?")
      .all(cutoff);

    const deleteStmt = global.db.prepare(
      "DELETE FROM ImageCache WHERE url = ?",
    );
    for (const item of expiredItems) {
      try {
        const filePath = path.join(cacheDir, item.filename);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (_) {}
      deleteStmt.run(item.url);
    }
    if (expiredItems.length > 0) {
      logger.info(`Evicted ${expiredItems.length} expired image cache files.`);
    }

    await enforceLimit();

    const diskFiles = await fs.promises.readdir(cacheDir);
    const trackedFiles = new Set(
      global.db
        .prepare("SELECT filename FROM ImageCache")
        .all()
        .map((r) => r.filename),
    );

    let orphansDeleted = 0;
    for (const file of diskFiles) {
      if (!trackedFiles.has(file)) {
        try {
          await fs.promises.unlink(path.join(cacheDir, file));
          orphansDeleted++;
        } catch (_) {}
      }
    }
    if (orphansDeleted > 0) {
      logger.info(
        `Deleted ${orphansDeleted} untracked/orphaned files in image cache directory.`,
      );
    }

    const allDbItems = global.db
      .prepare("SELECT url, filename FROM ImageCache")
      .all();
    for (const item of allDbItems) {
      const filePath = path.join(cacheDir, item.filename);
      if (!fs.existsSync(filePath)) {
        deleteStmt.run(item.url);
      }
    }

    await migrateDatabaseBase64Images();
  } catch (e) {
    logger.error("Startup image cache cleanup failed: " + e.message);
  }
}

async function migrateDatabaseBase64Images() {
  try {
    const types = ["Anime", "Manga"];
    let migratedCount = 0;

    for (const type of types) {
      const cols = global.db
        .prepare(`PRAGMA table_info(${type})`)
        .all()
        .map((col) => col.name);
      if (!cols.includes("image")) {
        continue;
      }

      const rows = global.db
        .prepare(
          `SELECT id, image, image_url FROM ${type} WHERE image IS NOT NULL`,
        )
        .all();
      if (rows.length === 0) {
        global.db.exec(`ALTER TABLE ${type} DROP COLUMN image`);
        logger.info(`Dropped empty 'image' column from ${type} table.`);
        continue;
      }

      logger.info(
        `Migrating ${rows.length} images from database ${type} table to cache directory...`,
      );

      for (const row of rows) {
        let buffer = null;
        let ext = "jpg";

        if (typeof row.image === "string") {
          const match = row.image.match(
            /^data:image\/([a-zA-Z+]+);base64,(.+)$/,
          );
          if (match) {
            ext = match[1];
            buffer = Buffer.from(match[2], "base64");
          } else {
            if (
              row.image.startsWith("http://") ||
              row.image.startsWith("https://")
            ) {
              global.db
                .prepare(
                  `UPDATE ${type} SET image = NULL, image_url = COALESCE(image_url, ?) WHERE id = ?`,
                )
                .run(row.image, row.id);
              migratedCount++;
              continue;
            }
          }
        } else if (
          Buffer.isBuffer(row.image) ||
          row.image instanceof Uint8Array
        ) {
          buffer = Buffer.from(row.image);
          ext = "jpg";
        }

        if (buffer) {
          const imageUrl =
            row.image_url ||
            `https://strawverse.internal/fallback-image/${type}/${row.id}`;

          await cacheImage(imageUrl, buffer);
          global.db
            .prepare(
              `UPDATE ${type} SET image = NULL, image_url = ? WHERE id = ?`,
            )
            .run(imageUrl, row.id);
          migratedCount++;
        }
      }

      global.db.exec(`ALTER TABLE ${type} DROP COLUMN image`);
      logger.info(
        `Successfully dropped migrated 'image' column from ${type} table.`,
      );
    }

    if (migratedCount > 0) {
      logger.info(
        `Successfully migrated ${migratedCount} database images to disk cache. Running vacuum...`,
      );
      global.db.exec("VACUUM");
      logger.info("Database vacuum completed.");
    }
  } catch (e) {
    logger.error("Error migrating database base64/BLOB images: " + e.message);
  }
}

async function removeCachedImage(url) {
  try {
    if (!url) return;
    const row = global.db
      .prepare("SELECT filename FROM ImageCache WHERE url = ?")
      .get(url);
    if (row) {
      const cacheDir = getImageCacheDir();
      const filePath = path.join(cacheDir, row.filename);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      global.db.prepare("DELETE FROM ImageCache WHERE url = ?").run(url);
    }
  } catch (e) {
    logger.error(`Failed to remove cached image for ${url}: ${e.message}`);
  }
}

module.exports = {
  getImageCacheDir,
  getHash,
  getCacheStats,
  clearCache,
  cacheImage,
  removeCachedImage,
  runStartupCleanup,
  migrateDatabaseBase64Images,
};
