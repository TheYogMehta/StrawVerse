const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const axios = require("axios");

const { logger } = require("./AppLogger");
const { getKeyValue, queryOne, queryAll, run } = require("./db");
const { getHeaders } = require("./proxyHeaders");

function getImageCacheDir() {
  const userDataPath = process.env.NODEJS_MOBILE_DATA_DIR || process.cwd();
  const dir = path.join(userDataPath, ".cache");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getHash(url) {
  return crypto.createHash("md5").update(url).digest("hex");
}

async function getCacheStats() {
  try {
    const row = await queryOne("SELECT COUNT(*) as count, SUM(file_size) as size FROM ImageCache");
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
    await run("DELETE FROM ImageCache");
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
      const response = await axios.get(url, {
        headers: headersObj,
        responseType: "arraybuffer",
        timeout: 10000,
      });
      imageBuffer = Buffer.from(response.data);
    }

    await fs.promises.writeFile(filePath, imageBuffer);
    const fileSize = imageBuffer.length;

    const now = Date.now();
    await run(`
      INSERT INTO ImageCache (url, filename, file_size, last_accessed)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET
        filename = excluded.filename,
        file_size = excluded.file_size,
        last_accessed = excluded.last_accessed
    `, [url, filename, fileSize, now]);

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
    const limitGb = await getKeyValue("Settings", "imageCacheSizeLimit") ?? 5;
    const limitBytes = limitGb * 1024 * 1024 * 1024;

    const stats = await getCacheStats();
    if (stats.sizeInBytes <= limitBytes) {
      return;
    }

    logger.info(
      `Image cache size (${(stats.sizeInBytes / (1024 * 1024)).toFixed(1)} MB) exceeds limit (${limitGb} GB). Evicting oldest items...`,
    );

    const items = await queryAll("SELECT url, filename, file_size FROM ImageCache ORDER BY last_accessed ASC");
    let currentSize = stats.sizeInBytes;
    const cacheDir = getImageCacheDir();

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

      await run("DELETE FROM ImageCache WHERE url = ?", [item.url]);
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
    const expiredItems = await queryAll("SELECT url, filename FROM ImageCache WHERE last_accessed < ?", [cutoff]);

    for (const item of expiredItems) {
      try {
        const filePath = path.join(cacheDir, item.filename);
        if (fs.existsSync(filePath)) {
          await fs.promises.unlink(filePath);
        }
      } catch (_) {}
      await run("DELETE FROM ImageCache WHERE url = ?", [item.url]);
    }
    if (expiredItems.length > 0) {
      logger.info(`Evicted ${expiredItems.length} expired image cache files.`);
    }

    await enforceLimit();

    const diskFiles = await fs.promises.readdir(cacheDir);
    const trackedFiles = new Set(
      (await queryAll("SELECT filename FROM ImageCache"))
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

    const allDbItems = await queryAll("SELECT url, filename FROM ImageCache");
    for (const item of allDbItems) {
      const filePath = path.join(cacheDir, item.filename);
      if (!fs.existsSync(filePath)) {
        await run("DELETE FROM ImageCache WHERE url = ?", [item.url]);
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
      const cols = await queryAll(`PRAGMA table_info(${type})`)
        .map((col) => col.name);
      if (!cols.includes("image")) {
        continue;
      }

      const rows = await queryAll(`SELECT id, image, image_url FROM ${type} WHERE image IS NOT NULL`);
      if (rows.length === 0) {
        await exec(`ALTER TABLE ${type} DROP COLUMN image`);
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
              await run(`UPDATE ${type} SET image = NULL, image_url = COALESCE(image_url, ?) WHERE id = ?`, [row.image, row.id]);
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
          await run(`UPDATE ${type} SET image = NULL, image_url = ? WHERE id = ?`, [imageUrl, row.id]);
          migratedCount++;
        }
      }

      await exec(`ALTER TABLE ${type} DROP COLUMN image`);
      logger.info(
        `Successfully dropped migrated 'image' column from ${type} table.`,
      );
    }

    if (migratedCount > 0) {
      logger.info(
        `Successfully migrated ${migratedCount} database images to disk cache. Running vacuum...`,
      );
      await exec("VACUUM");
      logger.info("Database vacuum completed.");
    }
  } catch (e) {
    logger.error("Error migrating database base64/BLOB images: " + e.message);
  }
}

async function removeCachedImage(url) {
  try {
    if (!url) return;
    const row = await queryOne("SELECT filename FROM ImageCache WHERE url = ?", [url]);
    if (row) {
      const cacheDir = getImageCacheDir();
      const filePath = path.join(cacheDir, row.filename);
      if (fs.existsSync(filePath)) {
        await fs.promises.unlink(filePath);
      }
      await run("DELETE FROM ImageCache WHERE url = ?", [url]);
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
