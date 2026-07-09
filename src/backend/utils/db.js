const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const { logger } = require("./AppLogger");

// database create [ gets created in /user/your_name/AppData/Roaming ]
const userDataPath = app.getPath("userData");

global.db = new DatabaseSync(path.join(userDataPath, "database.db"));
global.mappingDb = new DatabaseSync(path.join(userDataPath, "mapping.db"));

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
};

function getKeyValue(tableName, key) {
  try {
    const row = global.db
      .prepare(`SELECT value FROM ${tableName} WHERE key = ?`)
      .get(key);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function setKeyValue(tableName, key, value) {
  try {
    global.db
      .prepare(
        `INSERT INTO ${tableName} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, JSON.stringify(value));
  } catch (e) {
    logger.error(
      `Error writing key ${key} to SQLite table ${tableName}: ${e.message}`,
    );
  }
}

function queryAll(sql, params = []) {
  try {
    return global.db.prepare(sql).all(...params);
  } catch (e) {
    logger.error(`Database queryAll error on "${sql}": ${e.message}`);
    throw e;
  }
}

function queryOne(sql, params = []) {
  try {
    return global.db.prepare(sql).get(...params);
  } catch (e) {
    logger.error(`Database queryOne error on "${sql}": ${e.message}`);
    throw e;
  }
}

function run(sql, params = []) {
  try {
    return global.db.prepare(sql).run(...params);
  } catch (e) {
    logger.error(`Database run error on "${sql}": ${e.message}`);
    throw e;
  }
}

function exec(sql) {
  try {
    return global.db.exec(sql);
  } catch (e) {
    logger.error(`Database exec error on "${sql}": ${e.message}`);
    throw e;
  }
}

// Drop deprecated/unused tables from user database file dynamically
try {
  const existingTables = global.db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r) => r.name);
  existingTables.forEach((name) => {
    if (!tables.hasOwnProperty(name)) {
      global.db.exec(`DROP TABLE IF EXISTS ${name}`);
      logger.info(`Dropped deprecated table: ${name}`);
    }
  });
} catch (e) {
  logger.error("Failed to clean up deprecated tables: " + e.message);
}

try {
  global.db.exec("DROP TABLE IF EXISTS next_episodes");
  global.db.exec(
    "DELETE FROM Settings WHERE key = 'last_livechart_schedule_run'",
  );
} catch (e) {
  logger.error(
    "[db] Failed to drop next_episodes table from global.db: " + e.message,
  );
}

// Create tables & update schema
Object.entries(tables).forEach(([tableName, columns]) => {
  const columnsString = Object.entries(columns)
    .map(([col, definition]) => `${col} ${definition}`)
    .join(", ");

  try {
    global.db.exec(
      `CREATE TABLE IF NOT EXISTS ${tableName} (${columnsString})`,
    );
    updateTableSchema(tableName, columns);
  } catch (error) {
    throw new Error(`Error creating table ${tableName}: ${error.message}`);
  }
});

// Migrate legacy "config" JSON settings row to individual rows if it exists
try {
  const rawConfigRow = global.db
    .prepare("SELECT value FROM Settings WHERE key = ?")
    .get("config");
  if (rawConfigRow && rawConfigRow.value) {
    const parsed = JSON.parse(rawConfigRow.value);
    if (parsed && typeof parsed === "object") {
      const booleanKeys = new Set([
        "developerMode",
        "autoLoadNextChapter",
        "enableDiscordRPC",
        "mergeSubtitles",
        "malDiscordProfile",
        "autoSkipIntro",
        "Pagination",
      ]);
      const insertStmt = global.db.prepare(
        "INSERT INTO Settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      );
      for (const [k, v] of Object.entries(parsed)) {
        let val = v;
        if (booleanKeys.has(k)) {
          if (v === "on") val = true;
          else if (v === "off") val = false;
        }
        insertStmt.run(k, JSON.stringify(val));
      }
      global.db.prepare("DELETE FROM Settings WHERE key = ?").run("config");
      logger.info(
        "[db] Successfully migrated legacy config JSON row to individual database rows",
      );
    }
  }
} catch (migErr) {
  logger.error("[db] Error migrating legacy settings: " + migErr.message);
}

// Create unique index for SkipTimes
try {
  global.db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_skiptimes_anime_ep ON SkipTimes (anime_id, episode_number)",
  );
} catch (e) {
  logger.error("Failed to create unique index on SkipTimes: " + e.message);
}

// Drop unused EpisodesDataId column from Anime table
try {
  const animeColumns = global.db
    .prepare("PRAGMA table_info(Anime)")
    .all()
    .map((col) => col.name);
  if (animeColumns.includes("EpisodesDataId")) {
    global.db.exec("ALTER TABLE Anime DROP COLUMN EpisodesDataId");
    logger.info("[db] Dropped unused EpisodesDataId column from Anime table");
  }
} catch (e) {
  logger.error("[db] Failed to drop EpisodesDataId column: " + e.message);
}

function updateTableSchema(tableName, expectedColumns) {
  try {
    const existingColumns = global.db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((col) => col.name);

    Object.entries(expectedColumns).forEach(([col, definition]) => {
      if (!existingColumns.includes(col)) {
        global.db.exec(
          `ALTER TABLE ${tableName} ADD COLUMN ${col} ${definition}`,
        );
      }
    });
  } catch (error) {
    throw new Error(
      `Error updating table schema for ${tableName}: ${error.message}`,
    );
  }
}

// Clean up history records that don't have matching local Anime/Manga metadata
try {
  const watchDeleted = global.db
    .prepare(
      "DELETE FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
    )
    .run();
  const readDeleted = global.db
    .prepare(
      "DELETE FROM ReadHistory WHERE manga_id NOT IN (SELECT id FROM Manga)",
    )
    .run();
  if (watchDeleted.changes > 0 || readDeleted.changes > 0) {
    logger.info(
      `Database cleanup: Deleted ${watchDeleted.changes} orphaned watch history entries and ${readDeleted.changes} read history entries.`,
    );
  }
} catch (e) {
  logger.error("Failed to run database history cleanup: " + e.message);
}

module.exports = {
  tables,
  getKeyValue,
  setKeyValue,
  queryAll,
  queryOne,
  run,
  exec,
};
