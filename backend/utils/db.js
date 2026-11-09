const path = require("path");
const { logger } = require("./AppLogger");
const { getUserDataPath } = require("./constants");

let channel = null;
try {
  ({ channel } = require("bridge"));
} catch (_) {
  channel = null;
}

const isAndroid = Boolean(
  channel ||
  process.env.PLATFORM === "android" ||
  (process.env.NODEJS_MOBILE_DATA_DIR && !process.versions?.electron),
);

const tables = {
  Anime: {
    id: "TEXT PRIMARY KEY",
    folder_name: "TEXT",
    title: "TEXT",
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
    episode_number: "NUMERIC",
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
    status: "TEXT",
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
    episode_number: "NUMERIC",
    current_time: "REAL",
    duration: "REAL",
    time_spent: "REAL",
    is_completed: "INTEGER",
    last_watched: "TEXT",
    completed_at: "TEXT",
    hidden: "INTEGER DEFAULT 0",
    sub_dub: "TEXT",
  },
  ReadHistory: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    manga_id: "TEXT",
    manga_title: "TEXT",
    chapter_number: "NUMERIC",
    current_page: "INTEGER",
    total_pages: "INTEGER",
    time_spent: "REAL",
    is_completed: "INTEGER",
    last_read: "TEXT",
    completed_at: "TEXT",
    hidden: "INTEGER DEFAULT 0",
  },
  CatboxCache: {
    original_url: "TEXT PRIMARY KEY",
    catbox_url: "TEXT",
    created_at: "INTEGER",
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
  DomainConcurrency: {
    domain: "TEXT PRIMARY KEY",
    current_concurrency: "INTEGER",
    max_concurrency: "INTEGER",
    total_requests: "INTEGER DEFAULT 0",
    failed_requests: "INTEGER DEFAULT 0",
    updated_at: "INTEGER",
  },
};

function flattenParams(params) {
  if (!params) return [];
  if (Array.isArray(params)) {
    if (params.length === 1 && Array.isArray(params[0])) {
      return params[0];
    }
    return params;
  }
  return [params];
}

const getDesktopUserDataPath = getUserDataPath;

// ─── DESKTOP (node:sqlite) STATE & HELPERS ──────────────────────────────────
let desktopDb = null;
let desktopMappingDb = null;

function initDesktopDb() {
  const { DatabaseSync } = require("node:sqlite");
  const userDataPath = getUserDataPath();

  if (!desktopDb) {
    try {
      desktopDb = new DatabaseSync(path.join(userDataPath, "database.db"));
      try {
        desktopDb.prepare("PRAGMA journal_mode = WAL").run();
      } catch (e) {
        logger.error("Failed to set WAL mode on database.db: " + e.message);
      }
      global.db = desktopDb;
      initDesktopTables();
    } catch (err) {
      logger.error("Failed to initialize Desktop DatabaseSync: " + err.message);
    }
  }

  if (!desktopMappingDb) {
    try {
      const mappingPath = path.join(userDataPath, "mapping.db");
      desktopMappingDb = new DatabaseSync(mappingPath);
      try {
        desktopMappingDb.prepare("PRAGMA journal_mode = WAL").run();
      } catch (e) {
        logger.error("Failed to set WAL mode on mapping.db: " + e.message);
      }
      global.mappingDb = desktopMappingDb;
      initExtensionDbSystem();
    } catch (err) {
      logger.error(
        "Failed to initialize Desktop Mapping DatabaseSync: " + err.message,
      );
    }
  }
}

function initExtensionDbSystem() {
  if (!global.mappingDb) return;
  try {
    global.mappingDb.exec(`
      CREATE TABLE IF NOT EXISTS extension_settings (
        provider TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        PRIMARY KEY (provider, key)
      );
    `);
  } catch (err) {
    logger.warn(`Failed to init extension_settings table: ${err.message}`);
  }

  global.getExtensionDb = function (providerName, repoOwner = "TheYogMehta") {
    const isOfficial = !repoOwner || repoOwner.toLowerCase() === "theyogmehta";
    const tableName = isOfficial
      ? providerName
      : `@${repoOwner}/${providerName}`;
    const providerKey = tableName;

    if (!isOfficial && global.mappingDb) {
      try {
        global.mappingDb.exec(`
          CREATE TABLE IF NOT EXISTS "${tableName}" (
            id TEXT PRIMARY KEY,
            uuid TEXT,
            malid INTEGER,
            metadata TEXT,
            extra TEXT
          );
        `);
      } catch (_) {}
    }

    return {
      tableName,
      providerKey,
      getSetting: async (key) => {
        if (!global.mappingDb) return null;
        try {
          const row = await global.mappingDb
            .prepare(
              "SELECT value FROM extension_settings WHERE provider = ? AND key = ? LIMIT 1",
            )
            .get(providerKey, String(key));
          return row ? row.value : null;
        } catch (_) {
          return null;
        }
      },
      setSetting: async (key, value) => {
        if (!global.mappingDb) return;
        try {
          await global.mappingDb
            .prepare(
              "INSERT OR REPLACE INTO extension_settings (provider, key, value) VALUES (?, ?, ?)",
            )
            .run(providerKey, String(key), String(value));
        } catch (_) {}
      },
      prepare: (sql) => {
        if (!global.mappingDb)
          throw new Error("Mapping database not available");
        const lower = String(sql).toLowerCase();
        if (
          lower.includes("attach") ||
          lower.includes("pragma") ||
          lower.includes("sqlite_master") ||
          lower.includes("sqlite_schema")
        ) {
          throw new Error("Prohibited database operation in extension query");
        }
        return global.mappingDb.prepare(sql);
      },
      exec: (sql) => {
        if (!global.mappingDb)
          throw new Error("Mapping database not available");
        return global.mappingDb.exec(sql);
      },
    };
  };
}

function migrateNumericColumns(dbInstance) {
  const checkCol = (tbl, col) => {
    try {
      const cols = dbInstance.prepare(`PRAGMA table_info(${tbl})`).all() || [];
      const found = cols.find(
        (c) => (c.name || "").toLowerCase() === col.toLowerCase(),
      );
      return found ? (found.type || "").toUpperCase() : "";
    } catch (_) {
      return "";
    }
  };

  if (checkCol("SkipTimes", "episode_number") === "REAL") {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS SkipTimes_new (
        anime_id TEXT,
        episode_number NUMERIC,
        skip_times TEXT
      );
      INSERT INTO SkipTimes_new (anime_id, episode_number, skip_times)
        SELECT anime_id,
               CASE WHEN episode_number = CAST(episode_number AS INTEGER) THEN CAST(episode_number AS INTEGER) ELSE episode_number END,
               skip_times
        FROM SkipTimes;
      DROP TABLE SkipTimes;
      ALTER TABLE SkipTimes_new RENAME TO SkipTimes;
      CREATE UNIQUE INDEX IF NOT EXISTS idx_skiptimes_anime_ep ON SkipTimes (anime_id, episode_number);
    `);
    logger.info("[db] Migrated SkipTimes.episode_number from REAL to NUMERIC");
  }

  if (checkCol("WatchHistory", "episode_number") === "REAL") {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS WatchHistory_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        anime_id TEXT,
        anime_title TEXT,
        episode_number NUMERIC,
        current_time REAL,
        duration REAL,
        time_spent REAL,
        is_completed INTEGER,
        last_watched TEXT,
        completed_at TEXT,
        hidden INTEGER DEFAULT 0,
        sub_dub TEXT
      );
      INSERT INTO WatchHistory_new (id, anime_id, anime_title, episode_number, current_time, duration, time_spent, is_completed, last_watched, completed_at, hidden, sub_dub)
        SELECT id, anime_id, anime_title,
               CASE WHEN episode_number = CAST(episode_number AS INTEGER) THEN CAST(episode_number AS INTEGER) ELSE episode_number END,
               current_time, duration, time_spent, is_completed, last_watched, completed_at, hidden, sub_dub
        FROM WatchHistory;
      DROP TABLE WatchHistory;
      ALTER TABLE WatchHistory_new RENAME TO WatchHistory;
    `);
    logger.info(
      "[db] Migrated WatchHistory.episode_number from REAL to NUMERIC",
    );
  }

  if (checkCol("ReadHistory", "chapter_number") === "REAL") {
    dbInstance.exec(`
      CREATE TABLE IF NOT EXISTS ReadHistory_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        manga_id TEXT,
        manga_title TEXT,
        chapter_number NUMERIC,
        current_page INTEGER,
        total_pages INTEGER,
        time_spent REAL,
        is_completed INTEGER,
        last_read TEXT,
        completed_at TEXT,
        hidden INTEGER DEFAULT 0
      );
      INSERT INTO ReadHistory_new (id, manga_id, manga_title, chapter_number, current_page, total_pages, time_spent, is_completed, last_read, completed_at, hidden)
        SELECT id, manga_id, manga_title,
               CASE WHEN chapter_number = CAST(chapter_number AS INTEGER) THEN CAST(chapter_number AS INTEGER) ELSE chapter_number END,
               current_page, total_pages, time_spent, is_completed, last_read, completed_at, hidden
        FROM ReadHistory;
      DROP TABLE ReadHistory;
      ALTER TABLE ReadHistory_new RENAME TO ReadHistory;
    `);
    logger.info(
      "[db] Migrated ReadHistory.chapter_number from REAL to NUMERIC",
    );
  }
}

function initDesktopTables() {
  if (!desktopDb) return;
  for (const [tableName, columns] of Object.entries(tables)) {
    const columnsString = Object.entries(columns)
      .map(([col, def]) => `${col} ${def}`)
      .join(", ");
    try {
      desktopDb.exec(
        `CREATE TABLE IF NOT EXISTS ${tableName} (${columnsString})`,
      );
      updateTableSchema(tableName, columns, desktopDb);
    } catch (error) {
      logger.error(`Error creating table ${tableName}: ${error.message}`);
    }
  }

  try {
    migrateNumericColumns(desktopDb);
  } catch (migErr) {
    logger.error(
      "[db] Failed to migrate numeric history/skiptimes columns: " +
        migErr.message,
    );
  }

  try {
    desktopDb.exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_skiptimes_anime_ep ON SkipTimes (anime_id, episode_number)",
    );
  } catch (e) {
    logger.error("Failed to create unique index on SkipTimes: " + e.message);
  }

  try {
    desktopDb.exec(`
      UPDATE SkipTimes SET episode_number = CAST(episode_number AS INTEGER) WHERE episode_number = CAST(episode_number AS INTEGER);
      UPDATE WatchHistory SET episode_number = CAST(episode_number AS INTEGER) WHERE episode_number = CAST(episode_number AS INTEGER);
      UPDATE ReadHistory SET chapter_number = CAST(chapter_number AS INTEGER) WHERE chapter_number = CAST(chapter_number AS INTEGER);
    `);
  } catch (_) {}

  try {
    const watchDeleted = desktopDb
      .prepare(
        "DELETE FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
      )
      .run();
    const readDeleted = desktopDb
      .prepare(
        "DELETE FROM ReadHistory WHERE manga_id NOT IN (SELECT id FROM Manga)",
      )
      .run();
    const skipDeleted = desktopDb
      .prepare(
        "DELETE FROM SkipTimes WHERE anime_id NOT IN (SELECT id FROM Anime)",
      )
      .run();
    const changes =
      (watchDeleted?.changes || 0) +
      (readDeleted?.changes || 0) +
      (skipDeleted?.changes || 0);
    if (changes > 0) {
      logger.info(
        `Database cleanup: Deleted ${watchDeleted?.changes || 0} orphaned watch history, ${readDeleted?.changes || 0} read history, and ${skipDeleted?.changes || 0} skip times entries.`,
      );
    }
  } catch (_) {}
}

// ─── UNIFIED SCHEMA UPDATER ──────────────────────────────────────────────────
async function updateTableSchema(
  tableName,
  expectedColumns,
  dbInstance = null,
) {
  try {
    let existingNames = [];
    if (dbInstance) {
      const cols =
        dbInstance.prepare(`PRAGMA table_info(${tableName})`).all() || [];
      existingNames = cols
        .map((col) => (col.name || col.NAME || "").toLowerCase().trim())
        .filter(Boolean);
    } else {
      const cols = (await queryAll(`PRAGMA table_info(${tableName})`)) || [];
      existingNames = cols
        .map((col) => (col.name || col.NAME || "").toLowerCase().trim())
        .filter(Boolean);
    }

    for (const [col, definition] of Object.entries(expectedColumns)) {
      if (
        typeof definition === "string" &&
        definition.toUpperCase().includes("PRIMARY KEY")
      ) {
        continue;
      }
      if (!existingNames.includes(col.toLowerCase().trim())) {
        const alterSql = `ALTER TABLE ${tableName} ADD COLUMN ${col} ${definition}`;
        if (dbInstance) {
          dbInstance.exec(alterSql);
        } else {
          await exec(alterSql);
        }
      }
    }
  } catch (error) {
    logger.error(`Error updating schema for ${tableName}: ${error.message}`);
  }
}

// ─── ANDROID (Java bridge) COMMUNICATION ────────────────────────────────────
const pendingRequests = new Map();
let requestCounter = 0;

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

function dbRequest(eventName, data) {
  return new Promise((resolve, reject) => {
    if (!channel) {
      reject(new Error("Bridge channel not available cannot access database"));
      return;
    }
    const requestId = ++requestCounter;
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(
        new Error(`Database request timeout (${eventName}, id=${requestId})`),
      );
    }, 30000);

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

// ─── MAPPING TABLE CACHE ─────────────────────────────────────────────────────
const mappingTablesCache = new Set();
let lastMappingTablesCheck = 0;

async function refreshMappingTables() {
  if (!isAndroid) return;
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
  } catch (_) {}
}

// ─── UNIFIED EXECUTION ENGINE ────────────────────────────────────────────────
async function executeDb(dbName, action, sql, params = []) {
  if (dbName === "mapping") {
    if (isAndroid) {
      if (
        Date.now() - lastMappingTablesCheck > 10000 ||
        mappingTablesCache.size === 0
      ) {
        await refreshMappingTables();
      }
      if (mappingTablesCache.size === 0) {
        return action === "all" ? [] : null;
      }
    } else if (!global.mappingDb) {
      return action === "all" ? [] : null;
    }
  }

  const tag = dbName === "mapping" ? "Mapping" : "Database";
  const flat = flattenParams(params);

  if (isAndroid) {
    const eventMap = {
      all: "db-query-all",
      one: "db-query-one",
      run: "db-run",
      exec: "db-exec",
    };
    try {
      const res = await dbRequest(eventMap[action], {
        db: dbName,
        sql,
        params: action === "exec" ? [] : flat,
      });
      if (action === "all") return res.rows || [];
      if (action === "one") return res.row || null;
      return res;
    } catch (e) {
      if (
        dbName === "mapping" &&
        (e.message?.includes("no such table") ||
          e.message?.includes("no such column"))
      ) {
        return action === "all" ? [] : null;
      }
      logger.error(`${tag} ${action} error on "${sql}": ${e.message}`);
      throw e;
    }
  }

  // Desktop (node:sqlite)
  try {
    const db = dbName === "mapping" ? global.mappingDb : global.db;
    if (!db) return action === "all" ? [] : null;

    if (action === "exec") {
      return db.exec(sql);
    }
    const stmt = db.prepare(sql);
    if (action === "all") return stmt.all(...flat);
    if (action === "one") return stmt.get(...flat) || null;
    if (action === "run") return stmt.run(...flat);
  } catch (e) {
    if (
      dbName === "mapping" &&
      (e.message?.includes("no such table") ||
        e.message?.includes("no such column"))
    ) {
      return action === "all" ? [] : null;
    }
    logger.error(`${tag} ${action} error on "${sql}": ${e.message}`);
    throw e;
  }
}

// ─── PUBLIC QUERY API ────────────────────────────────────────────────────────
const queryAll = (sql, params) => executeDb("main", "all", sql, params);
const queryOne = (sql, params) => executeDb("main", "one", sql, params);
const run = (sql, params) => executeDb("main", "run", sql, params);
const exec = (sql) => executeDb("main", "exec", sql);

const mappingQueryAll = (sql, params) =>
  executeDb("mapping", "all", sql, params);
const mappingQueryOne = (sql, params) =>
  executeDb("mapping", "one", sql, params);
const mappingRun = (sql, params) => executeDb("mapping", "run", sql, params);
const mappingExec = (sql) => executeDb("mapping", "exec", sql);

function createDbAdapter(dbName) {
  return {
    prepare(sql) {
      return {
        get: (...params) => executeDb(dbName, "one", sql, params),
        all: (...params) => executeDb(dbName, "all", sql, params),
        run: (...params) => executeDb(dbName, "run", sql, params),
      };
    },
    exec: (sql) => executeDb(dbName, "exec", sql),
  };
}

// ─── BOOT INITIALIZATION ─────────────────────────────────────────────────────
if (isAndroid) {
  global.db = createDbAdapter("main");
  global.mappingDb = createDbAdapter("mapping");
} else {
  initDesktopDb();
}

// ─── PRAGMA, TRANSACTIONS & KEY-VALUE ────────────────────────────────────────
async function pragma(sql, dbName = "main") {
  if (isAndroid) {
    try {
      return await dbRequest("db-pragma", { db: dbName, sql });
    } catch (e) {
      logger.error(`Database pragma error on "${sql}": ${e.message}`);
      throw e;
    }
  }
  try {
    const targetDb = dbName === "mapping" ? global.mappingDb : global.db;
    return targetDb
      ? targetDb.exec(
          sql.toUpperCase().startsWith("PRAGMA") ? sql : `PRAGMA ${sql}`,
        )
      : null;
  } catch (e) {
    logger.error(`Database pragma error on "${sql}": ${e.message}`);
    throw e;
  }
}

function unwrapJson(val) {
  if (val === undefined || val === null) return val;
  let curr = val;
  let maxDepth = 10;
  while (typeof curr === "string" && maxDepth-- > 0) {
    const trimmed = curr.trim();
    if (
      (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      trimmed === "true" ||
      trimmed === "false" ||
      trimmed === "null" ||
      (!isNaN(Number(trimmed)) && trimmed !== "")
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        curr = parsed;
      } catch {
        break;
      }
    } else {
      break;
    }
  }
  return curr;
}

async function getKeyValue(tableName, key) {
  try {
    const row = await queryOne(`SELECT value FROM ${tableName} WHERE key = ?`, [
      key,
    ]);
    if (!row || row.value === undefined || row.value === null) return null;
    return unwrapJson(row.value);
  } catch {
    return null;
  }
}

async function setKeyValue(tableName, key, value) {
  try {
    const cleanValue = unwrapJson(value);
    await run(
      `INSERT INTO ${tableName} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, JSON.stringify(cleanValue)],
    );
  } catch (e) {
    logger.error(
      `Error writing key ${key} to SQLite table ${tableName}: ${e.message}`,
    );
  }
}

async function batchRun(dbNameOrOps, maybeOps) {
  let dbName = "main";
  let operations = dbNameOrOps;
  if (typeof dbNameOrOps === "string") {
    dbName = dbNameOrOps;
    operations = maybeOps;
  }
  if (!operations || operations.length === 0) return;

  if (isAndroid) {
    try {
      return await dbRequest("db-batch-run", { db: dbName, operations });
    } catch (e) {
      logger.error(`Database batchRun error on ${dbName}: ${e.message}`);
      throw e;
    }
  }

  const dbInstance = dbName === "mapping" ? global.mappingDb : global.db;
  if (!dbInstance) return;
  dbInstance.prepare("BEGIN").run();
  try {
    for (const op of operations) {
      const flatParams = flattenParams(op.params);
      dbInstance.prepare(op.sql).run(...flatParams);
    }
    dbInstance.prepare("COMMIT").run();
  } catch (e) {
    try {
      dbInstance.prepare("ROLLBACK").run();
    } catch (_) {}
    logger.error(`Database batchRun error on ${dbName}: ${e.message}`);
    throw e;
  }
}

async function mappingBatchRun(operations) {
  return batchRun("mapping", operations);
}

async function closeDb(dbName = "main") {
  if (isAndroid) {
    try {
      return await dbRequest("db-close", { db: dbName });
    } catch (e) {
      logger.error(`Failed to close database ${dbName}: ${e.message}`);
    }
    return;
  }
  try {
    if (dbName === "mapping") {
      if (desktopMappingDb && typeof desktopMappingDb.close === "function") {
        desktopMappingDb.close();
      }
      desktopMappingDb = null;
      global.mappingDb = null;
      try {
        require("./mappingResolver").invalidateMappingMetadataCache();
      } catch (_) {}
    } else {
      if (desktopDb && typeof desktopDb.close === "function") {
        desktopDb.close();
      }
      desktopDb = null;
      global.db = null;
    }
  } catch (e) {
    logger.error(`Failed to close database ${dbName}: ${e.message}`);
  }
}

async function openDb(dbName = "main") {
  if (isAndroid) {
    try {
      return await dbRequest("db-open", { db: dbName });
    } catch (e) {
      logger.error(`Failed to open database ${dbName}: ${e.message}`);
    }
    return;
  }
  initDesktopDb();
}

async function initDatabase() {
  if (!isAndroid) {
    initDesktopDb();
    logger.info("[db] Desktop SQLite database ready");
    return;
  }

  logger.info("[db] Initializing Android database schema via Java bridge...");
  try {
    // Java DatabaseBridge.handleInit requires dataDir (StrawVerse root;
    // it appends "/data" itself). Without it db-init fails and every
    // CREATE TABLE below throws "Database 'main' is not open".
    const root =
      process.env.NODEJS_MOBILE_DATA_DIR || process.env.DATADIR || null;
    await dbRequest("db-init", root ? { dataDir: root } : {});
  } catch (e) {
    logger.error("Failed to send db-init to bridge: " + e.message);
    throw new Error(`Database bridge init failed: ${e.message}`);
  }

  for (const [tableName, columns] of Object.entries(tables)) {
    const columnsString = Object.entries(columns)
      .map(([col, def]) => `${col} ${def}`)
      .join(", ");
    try {
      await exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnsString})`);
      await updateTableSchema(tableName, columns);
    } catch (error) {
      throw new Error(`Error creating table ${tableName}: ${error.message}`);
    }
  }

  try {
    await exec(
      "CREATE UNIQUE INDEX IF NOT EXISTS idx_skiptimes_anime_ep ON SkipTimes (anime_id, episode_number)",
    );
  } catch (e) {
    logger.error("Failed to create unique index on SkipTimes: " + e.message);
  }

  try {
    const watchDeleted = await run(
      "DELETE FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
    );
    const readDeleted = await run(
      "DELETE FROM ReadHistory WHERE manga_id NOT IN (SELECT id FROM Manga)",
    );
    const skipDeleted = await run(
      "DELETE FROM SkipTimes WHERE anime_id NOT IN (SELECT id FROM Anime)",
    );
    await exec(`
      UPDATE SkipTimes SET episode_number = CAST(episode_number AS INTEGER) WHERE episode_number = CAST(episode_number AS INTEGER);
      UPDATE WatchHistory SET episode_number = CAST(episode_number AS INTEGER) WHERE episode_number = CAST(episode_number AS INTEGER);
      UPDATE ReadHistory SET chapter_number = CAST(chapter_number AS INTEGER) WHERE chapter_number = CAST(chapter_number AS INTEGER);
    `);
    const totalChanges =
      (watchDeleted?.changes || 0) +
      (readDeleted?.changes || 0) +
      (skipDeleted?.changes || 0);
    if (totalChanges > 0) {
      logger.info(
        `Database cleanup: Deleted ${watchDeleted?.changes || 0} orphaned watch history, ${readDeleted?.changes || 0} read history, and ${skipDeleted?.changes || 0} skip times entries.`,
      );
    }
  } catch (e) {
    logger.error("Failed to run database history cleanup: " + e.message);
  }

  logger.info("[db] Android database initialization complete");
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
  mappingBatchRun,
  closeDb,
  openDb,
  unwrapJson,
  getUserDataPath,
  getDesktopUserDataPath,
  executeDb,
};
