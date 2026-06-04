const { app } = require("electron");
const path = require("path");
const fs = require("fs");
const { DatabaseSync } = require("node:sqlite");
const { logger } = require("./AppLogger");

// database create [ gets created in /user/your_name/AppData/Roaming ]
const userDataPath = app.getPath("userData");

const oldDbPath = path.join(userDataPath, "metadata.db");
const dbPath = path.join(userDataPath, "database.db");

if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) {
  try {
    fs.copyFileSync(oldDbPath, dbPath);
    logger.info("Migrated SQLite database from metadata.db to database.db");
    fs.renameSync(oldDbPath, oldDbPath + ".bak");
  } catch (err) {
    logger.error(
      `Failed to migrate metadata.db to database.db: ${err.message}`,
    );
  }
}

const db = new DatabaseSync(dbPath);

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
    image: "BLOB",
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
    image: "BLOB",
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
};

function getKeyValue(tableName, key) {
  try {
    const row = db
      .prepare(`SELECT value FROM ${tableName} WHERE key = ?`)
      .get(key);
    return row ? JSON.parse(row.value) : null;
  } catch {
    return null;
  }
}

function setKeyValue(tableName, key, value) {
  try {
    db.prepare(
      `INSERT INTO ${tableName} (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    ).run(key, JSON.stringify(value));
  } catch (e) {
    logger.error(
      `Error writing key ${key} to SQLite table ${tableName}: ${e.message}`,
    );
  }
}

function queryAll(sql, params = []) {
  try {
    return db.prepare(sql).all(...params);
  } catch (e) {
    logger.error(`Database queryAll error on "${sql}": ${e.message}`);
    throw e;
  }
}

function queryOne(sql, params = []) {
  try {
    return db.prepare(sql).get(...params);
  } catch (e) {
    logger.error(`Database queryOne error on "${sql}": ${e.message}`);
    throw e;
  }
}

function run(sql, params = []) {
  try {
    return db.prepare(sql).run(...params);
  } catch (e) {
    logger.error(`Database run error on "${sql}": ${e.message}`);
    throw e;
  }
}

function exec(sql) {
  try {
    return db.exec(sql);
  } catch (e) {
    logger.error(`Database exec error on "${sql}": ${e.message}`);
    throw e;
  }
}

// Drop deprecated/unused tables from user database file dynamically
try {
  const existingTables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    )
    .all()
    .map((r) => r.name);
  existingTables.forEach((name) => {
    if (!tables.hasOwnProperty(name)) {
      db.exec(`DROP TABLE IF EXISTS ${name}`);
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
    db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnsString})`);
    updateTableSchema(tableName, columns);
  } catch (error) {
    throw new Error(`Error creating table ${tableName}: ${error.message}`);
  }
});

function updateTableSchema(tableName, expectedColumns) {
  try {
    const existingColumns = db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((col) => col.name);

    Object.entries(expectedColumns).forEach(([col, definition]) => {
      if (!existingColumns.includes(col)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col} ${definition}`);
      }
    });
  } catch (error) {
    throw new Error(
      `Error updating table schema for ${tableName}: ${error.message}`,
    );
  }
}

// --- Migrations from JSON files to SQLite tables ---
if (userDataPath) {
  const databaseJsonPath = path.join(userDataPath, "database.json");
  if (fs.existsSync(databaseJsonPath)) {
    try {
      const raw = fs.readFileSync(databaseJsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.config) {
        setKeyValue("Settings", "config", parsed.config);
        logger.info("Migrated settings from database.json to SQLite");
      }
      fs.renameSync(databaseJsonPath, databaseJsonPath + ".bak");
    } catch (err) {
      logger.error(`Failed to migrate database.json: ${err.message}`);
    }
  }

  const queueJsonPath = path.join(userDataPath, "queue.json");
  if (fs.existsSync(queueJsonPath)) {
    try {
      const raw = fs.readFileSync(queueJsonPath, "utf-8");
      const parsed = JSON.parse(raw);
      if (parsed && parsed.queue) {
        setKeyValue("Queue", "queue", parsed.queue);
        logger.info("Migrated queue from queue.json to SQLite");
      }
      fs.renameSync(queueJsonPath, queueJsonPath + ".bak");
    } catch (err) {
      logger.error(`Failed to migrate queue.json: ${err.message}`);
    }
  }
}

module.exports = {
  db,
  tables,
  getKeyValue,
  setKeyValue,
  queryAll,
  queryOne,
  run,
  exec,
};
