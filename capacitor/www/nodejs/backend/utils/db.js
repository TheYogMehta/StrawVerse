const path = require("path");
const fs = require("fs");
const { logger } = require("./AppLogger");

let channel = null;
try {
  ({ channel } = require("bridge"));
} catch (_) {
  channel = null;
}

global.db = true;
global.mappingDb = true;

// Request-response tracking
const pendingRequests = new Map();
let requestCounter = 0;

// Listen for responses from Java's DatabaseBridge
if (channel) {
  channel.addListener("db-response", (response) => {
    if (!response || typeof response.requestId === "undefined") return;
    const pending = pendingRequests.get(response.requestId);
    if (pending) {
      pendingRequests.delete(response.requestId);
      if (response.error) {
        pending.reject(new Error(response.error));
      } else {
        pending.resolve(response.result);
      }
    }
  });
}

/**
 * Send a database request to Java and return a Promise for the result.
 */
function dbRequest(eventName, data) {
  return new Promise((resolve, reject) => {
    if (!channel) {
      reject(
        new Error("Bridge channel not available — cannot access database"),
      );
      return;
    }
    const requestId = ++requestCounter;
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error(`Database request timeout (${eventName}, id=${requestId})`),
      );
    }, 30000); // 30s timeout

    pendingRequests.set(requestId, {
      resolve: (result) => {
        clearTimeout(timeout);
        resolve(result);
      },
      reject: (err) => {
        clearTimeout(timeout);
        reject(err);
      },
    });

    channel.send(eventName, { requestId, ...data });
  });
}

// ─── Public API (async) ─────────────────────────────────────────────────────

// Main database helpers
async function queryAll(sql, params = []) {
  try {
    const result = await dbRequest("db-query-all", { db: "main", sql, params });
    return result.rows || [];
  } catch (e) {
    logger.error(`Database queryAll error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function queryOne(sql, params = []) {
  try {
    const result = await dbRequest("db-query-one", { db: "main", sql, params });
    return result.row || null;
  } catch (e) {
    logger.error(`Database queryOne error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function run(sql, params = []) {
  try {
    return await dbRequest("db-run", { db: "main", sql, params });
  } catch (e) {
    logger.error(`Database run error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function exec(sql) {
  try {
    return await dbRequest("db-exec", { db: "main", sql, params: [] });
  } catch (e) {
    logger.error(`Database exec error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function pragma(sql, dbName = "main") {
  try {
    return await dbRequest("db-pragma", { db: dbName, sql });
  } catch (e) {
    logger.error(`Database pragma error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function getKeyValue(tableName, key) {
  try {
    const row = await queryOne(`SELECT value FROM ${tableName} WHERE key = ?`, [
      key,
    ]);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

async function setKeyValue(tableName, key, value) {
  try {
    await run(
      `INSERT INTO ${tableName} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(value)],
    );
  } catch (e) {
    logger.error(
      `Error writing key ${key} to SQLite table ${tableName}: ${e.message}`,
    );
  }
}

// Mapping database helpers
const mappingTablesCache = new Set();
let lastMappingTablesCheck = 0;

async function refreshMappingTables() {
  try {
    const result = await dbRequest("db-query-all", {
      db: "mapping",
      sql: "SELECT name FROM sqlite_master WHERE type='table'",
      params: [],
    });
    const rows = result.rows || [];
    mappingTablesCache.clear();
    for (const r of rows) {
      if (r.name) mappingTablesCache.add(r.name.toLowerCase());
    }
    lastMappingTablesCheck = Date.now();
  } catch (e) {}
}

async function mappingQueryAll(sql, params = []) {
  if (
    Date.now() - lastMappingTablesCheck > 10000 ||
    mappingTablesCache.size === 0
  ) {
    await refreshMappingTables();
  }

  const tablesToCheck = [
    "anime",
    "animepahe",
    "anikototv",
    "anineko",
    "manga",
    "weebcentral",
    "allmanga",
    "next_episodes",
  ];
  const sqlLower = sql.toLowerCase();
  for (const t of tablesToCheck) {
    if (sqlLower.includes(t) && !mappingTablesCache.has(t)) {
      return [];
    }
  }

  try {
    const result = await dbRequest("db-query-all", {
      db: "mapping",
      sql,
      params,
    });
    return result.rows || [];
  } catch (e) {
    if (e.message?.includes("no such table")) {
      return [];
    }
    logger.error(`Mapping queryAll error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function mappingQueryOne(sql, params = []) {
  if (
    Date.now() - lastMappingTablesCheck > 10000 ||
    mappingTablesCache.size === 0
  ) {
    await refreshMappingTables();
  }

  const tablesToCheck = [
    "anime",
    "animepahe",
    "anikototv",
    "anineko",
    "manga",
    "weebcentral",
    "allmanga",
    "next_episodes",
  ];
  const sqlLower = sql.toLowerCase();
  for (const t of tablesToCheck) {
    if (sqlLower.includes(t) && !mappingTablesCache.has(t)) {
      return null;
    }
  }

  try {
    const result = await dbRequest("db-query-one", {
      db: "mapping",
      sql,
      params,
    });
    return result.row || null;
  } catch (e) {
    if (e.message?.includes("no such table")) {
      return null;
    }
    logger.error(`Mapping queryOne error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function mappingRun(sql, params = []) {
  try {
    return await dbRequest("db-run", { db: "mapping", sql, params });
  } catch (e) {
    logger.error(`Mapping run error on "${sql}": ${e.message}`);
    throw e;
  }
}

async function mappingExec(sql) {
  try {
    return await dbRequest("db-exec", { db: "mapping", sql, params: [] });
  } catch (e) {
    logger.error(`Mapping exec error on "${sql}": ${e.message}`);
    throw e;
  }
}

/**
 * Batch run: execute many SQL statements in a single bridge call + transaction.
 * Each operation is { sql: string, params: any[] }.
 * Significantly faster for bulk inserts (mapping updates, etc.)
 */
async function batchRun(dbName, operations) {
  try {
    return await dbRequest("db-batch-run", { db: dbName, operations });
  } catch (e) {
    logger.error(`Database batchRun error: ${e.message}`);
    throw e;
  }
}

/**
 * Close and reopen a database connection (used during mapping updates).
 */
async function closeDb(dbName) {
  return dbRequest("db-close", { db: dbName });
}

async function openDb(dbName) {
  return dbRequest("db-open", { db: dbName });
}

// ─── Table schema ───────────────────────────────────────────────────────────

const tables = {
  Anime: {
    id: "TEXT PRIMARY KEY",
    folder_name: "TEXT",
    title: "TEXT",
    subOrDub: "TEXT",
    type: "TEXT",
    provider: "TEXT",
    description: "TEXT",
    status: "TEXT",
    genres: "TEXT",
    aired: "TEXT",
    image_url: "TEXT",
    last_updated: "DATE",
    MalID: "TEXT",
    CustomTag: "TEXT",
  },
  SkipTimes: {
    anime_id: "TEXT",
    episode_number: "REAL",
    skip_times: "TEXT",
  },
  Manga: {
    id: "TEXT PRIMARY KEY",
    title: "TEXT",
    folder_name: "TEXT",
    provider: "TEXT",
    description: "TEXT",
    genres: "TEXT",
    type: "TEXT",
    author: "TEXT",
    released: "TEXT",
    image_url: "TEXT",
    last_updated: "DATE",
    MalID: "TEXT",
    CustomTag: "TEXT",
  },
  MyAnimeList: {
    id: "TEXT UNIQUE",
    title: "TEXT",
    image: "TEXT",
    totalEpisodes: "INTEGER",
    lastEpisode: "INTEGER",
    watched: "INTEGER",
    status: "TEXT",
    sortOrder: "INTEGER",
    updated_at: "TEXT",
    NextEpisodeIn: "TEXT",
  },
  MyMangaList: {
    id: "TEXT UNIQUE",
    title: "TEXT",
    image: "TEXT",
    totalChapters: "INTEGER",
    lastChapter: "INTEGER",
    read: "INTEGER",
    status: "TEXT",
    sortOrder: "INTEGER",
    updated_at: "TEXT",
  },
  Settings: {
    key: "TEXT PRIMARY KEY",
    value: "TEXT",
  },
  DownloadQueue: {
    epid: "TEXT PRIMARY KEY",
    Type: "TEXT",
    Title: "TEXT",
    EpNum: "TEXT",
    SubDub: "TEXT",
    malid: "TEXT",
    id: "TEXT",
    ChapterTitle: "TEXT",
    status: "TEXT",
    totalSegments: "INTEGER",
    currentSegments: "INTEGER",
    caption: "TEXT",
    added_at: "INTEGER",
    config: "TEXT",
  },
  cookie: {
    id: "TEXT PRIMARY KEY",
    name: "TEXT",
    domain: "TEXT",
    url: "TEXT",
    value: "TEXT",
    path: "TEXT",
    secure: "TEXT",
    httpOnly: "TEXT",
    expirationDate: "TEXT",
    local_saved_at: "INTEGER",
  },
  WatchHistory: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    anime_id: "TEXT",
    anime_title: "TEXT",
    episode_number: "REAL",
    current_time: "REAL",
    duration: "REAL",
    time_spent: "REAL",
    is_completed: "INTEGER",
    last_watched: "TEXT",
    completed_at: "TEXT",
    hidden: "INTEGER DEFAULT 0",
  },
  ReadHistory: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    manga_id: "TEXT",
    manga_title: "TEXT",
    chapter_number: "REAL",
    current_page: "INTEGER",
    total_pages: "INTEGER",
    time_spent: "REAL",
    is_completed: "INTEGER",
    last_read: "TEXT",
    completed_at: "TEXT",
    hidden: "INTEGER DEFAULT 0",
  },
  StreamReferer: {
    domain: "TEXT PRIMARY KEY",
    referer: "TEXT",
    updatedAt: "INTEGER",
  },
  unlinked_mal_ids: {
    id: "TEXT PRIMARY KEY",
    malid: "TEXT",
  },
  ImageCache: {
    url: "TEXT PRIMARY KEY",
    filename: "TEXT",
    file_size: "INTEGER",
    last_accessed: "INTEGER",
  },
};

// ─── Async initialization ───────────────────────────────────────────────────

/**
 * Initialize both databases via the Java bridge.
 * Must be called once at boot before any DB operations.
 */
async function initDatabase() {
  const dbPath =
    process.env.STRAWVERSE_PUBLIC_ROOT ||
    process.env.NODEJS_MOBILE_DATA_DIR ||
    process.cwd();
  logger.info(`[db] Initializing databases at: ${dbPath}`);

  // Tell Java to open both databases
  await dbRequest("db-init", { dataDir: dbPath });
  logger.info("[db] Java bridge connected — databases opened");

  // Create tables & update schema
  for (const [tableName, columns] of Object.entries(tables)) {
    const columnsString = Object.entries(columns)
      .map(([col, definition]) => `${col} ${definition}`)
      .join(", ");

    try {
      await exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnsString})`);
      await updateTableSchema(tableName, columns);
    } catch (error) {
      throw new Error(`Error creating table ${tableName}: ${error.message}`);
    }
  }

  // Drop deprecated/unused tables
  try {
    const existingTables = await queryAll(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );
    for (const { name } of existingTables) {
      if (!tables.hasOwnProperty(name)) {
        await exec(`DROP TABLE IF EXISTS ${name}`);
        logger.info(`Dropped deprecated table: ${name}`);
      }
    }
  } catch (e) {
    logger.error("Failed to clean up deprecated tables: " + e.message);
  }

  // Create unique index for SkipTimes
  try {
    await exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_skiptimes_anime_ep ON SkipTimes (anime_id, episode_number)",
    );
  } catch (e) {
    logger.error("Failed to create unique index on SkipTimes: " + e.message);
  }

  // Clean up orphaned history records
  try {
    const watchRows = await queryAll(
      "SELECT DISTINCT anime_id FROM WatchHistory",
    );
    const animeRows = await queryAll("SELECT id FROM Anime");
    const animeIds = new Set(animeRows.map((r) => r.id));
    const toDelete = [];
    for (const row of watchRows) {
      if (row.anime_id) {
        const strippedId = row.anime_id.replace(/-(dub|sub|hsub|both)$/, "");
        if (!animeIds.has(strippedId)) {
          toDelete.push(row.anime_id);
        }
      }
    }
    let watchChanges = 0;
    if (toDelete.length > 0) {
      const placeholders = toDelete.map(() => "?").join(",");
      const deleteRes = await run(
        `DELETE FROM WatchHistory WHERE anime_id IN (${placeholders})`,
        toDelete,
      );
      watchChanges = deleteRes.changes || 0;
    }
    const readDeleted = await run(
      "DELETE FROM ReadHistory WHERE manga_id NOT IN (SELECT id FROM Manga)",
    );
    if (watchChanges > 0 || readDeleted.changes > 0) {
      logger.info(
        `Database cleanup: Deleted ${watchChanges} orphaned watch history entries and ${readDeleted.changes} read history entries.`,
      );
    }
  } catch (e) {
    logger.error("Failed to run database history cleanup: " + e.message);
  }

  logger.info("[db] Database initialization complete");
}

async function updateTableSchema(tableName, expectedColumns) {
  try {
    const existingColumns = await queryAll(`PRAGMA table_info(${tableName})`);
    const existingNames = existingColumns.map((col) => col.name);

    for (const [col, definition] of Object.entries(expectedColumns)) {
      if (!existingNames.includes(col)) {
        await exec(`ALTER TABLE ${tableName} ADD COLUMN ${col} ${definition}`);
      }
    }
  } catch (error) {
    throw new Error(
      `Error updating table schema for ${tableName}: ${error.message}`,
    );
  }
}

module.exports = {
  tables,
  initDatabase,
  getKeyValue,
  setKeyValue,
  queryAll,
  queryOne,
  run,
  exec,
  pragma,
  mappingQueryAll,
  mappingQueryOne,
  mappingRun,
  mappingExec,
  batchRun,
  closeDb,
  openDb,
};
