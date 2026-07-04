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
    EpisodesDataId: "TEXT",
    image_url: "TEXT",
    last_updated: "DATE",
    MalID: "TEXT",
    CustomTag: "TEXT",
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
  Queue: {
    key: "TEXT PRIMARY KEY",
    value: "TEXT",
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
  next_episodes: {
    livechart_id: "TEXT",
    episode: "INTEGER",
    date: "INTEGER",
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

// Create unique index for next_episodes
try {
  global.db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS idx_next_episodes_id_ep ON next_episodes (livechart_id, episode)",
  );
} catch (e) {
  logger.error("Failed to create unique index on next_episodes: " + e.message);
}

// Migrate old Settings unlinked_mal_ids to dedicated table
try {
  const row = global.db
    .prepare("SELECT value FROM Settings WHERE key = 'unlinked_mal_ids'")
    .get();
  if (row && row.value) {
    const map = JSON.parse(row.value);
    const insertStmt = global.db.prepare(
      "INSERT OR IGNORE INTO unlinked_mal_ids (id, malid) VALUES (?, NULL)",
    );
    Object.keys(map).forEach((id) => {
      if (map[id]) {
        insertStmt.run(id);
      }
    });
    global.db
      .prepare("DELETE FROM Settings WHERE key = 'unlinked_mal_ids'")
      .run();
    logger.info(
      "Migrated Settings unlinked_mal_ids to dedicated database table.",
    );
  }
} catch (e) {
  logger.error("Failed to migrate unlinked_mal_ids to table: " + e.message);
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
