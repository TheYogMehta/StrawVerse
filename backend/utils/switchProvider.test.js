// Run: node --test backend/utils/switchProvider.test.js
const test = require("node:test");
const assert = require("node:assert");
const { DatabaseSync } = require("node:sqlite");
const { switchProviderMetadata } = require("./providerSwitch");

function createTestDb() {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE Movies (
      id TEXT PRIMARY KEY,
      folder_name TEXT,
      title TEXT,
      type TEXT,
      provider TEXT,
      description TEXT,
      status TEXT,
      genres TEXT,
      aired TEXT,
      image_url TEXT,
      last_updated DATE,
      CustomTag TEXT,
      episodes_json TEXT
    );
    CREATE TABLE SeriesMovieWatchHistory (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      movie_id TEXT,
      title TEXT,
      episode_number NUMERIC,
      season INTEGER DEFAULT 1,
      current_time REAL,
      duration REAL,
      time_spent REAL,
      is_completed INTEGER,
      last_watched TEXT,
      completed_at TEXT,
      hidden INTEGER DEFAULT 0,
      sub_dub TEXT
    );
    CREATE TABLE DownloadQueue (
      epid TEXT PRIMARY KEY,
      id TEXT
    );
    CREATE TABLE Settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);

  const deps = {
    queryOne: async (sql, params = []) => db.prepare(sql).get(...params) || null,
    queryAll: async (sql, params = []) => db.prepare(sql).all(...params),
    batchRun: async (ops) => {
      db.exec("BEGIN");
      try {
        for (const op of ops) {
          db.prepare(op.sql).run(...(op.params || []));
        }
        db.exec("COMMIT");
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
    installedMovieProviders: {
      "@repo/cinejoy": {},
      "@repo/bingr": {},
    },
  };

  return { db, deps };
}

test("switchProviderMetadata migrates Movies row, SeriesMovieWatchHistory, and custom_order", async () => {
  const { db, deps } = createTestDb();
  db.prepare(
    `INSERT INTO Movies (id, folder_name, title, type, provider, CustomTag, episodes_json)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("old-1", "Inception", "Inception", "Movie", "@repo/cinejoy", '["favorites"]', '{"1":1}');
  db.prepare(
    `INSERT INTO SeriesMovieWatchHistory (movie_id, title, episode_number, season, current_time, is_completed, last_watched)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run("old-1", "Inception", 1, 1, 420.5, 0, "2026-11-20T10:00:00.000Z");
  db.prepare(`INSERT INTO Settings (key, value) VALUES (?, ?)`).run(
    "custom_order_Movies_local_all",
    JSON.stringify(["other-1", "old-1"]),
  );

  const res = await switchProviderMetadata(
    {
      type: "Movies",
      oldId: "old-1",
      newId: "new-2",
      newProvider: "@repo/bingr",
    },
    deps,
  );

  assert.strictEqual(res.migrated, true);
  assert.strictEqual(res.merged, false);
  assert.strictEqual(db.prepare("SELECT * FROM Movies WHERE id = 'old-1'").get(), undefined);

  const migrated = db.prepare("SELECT * FROM Movies WHERE id = 'new-2'").get();
  assert.strictEqual(migrated.provider, "@repo/bingr");
  assert.strictEqual(migrated.folder_name, "Inception");
  assert.strictEqual(migrated.CustomTag, '["favorites"]');
  assert.strictEqual(migrated.episodes_json, null);

  const hist = db.prepare("SELECT * FROM SeriesMovieWatchHistory WHERE movie_id = 'new-2'").get();
  assert.strictEqual(hist.current_time, 420.5);

  const order = JSON.parse(
    db.prepare("SELECT value FROM Settings WHERE key = 'custom_order_Movies_local_all'").get().value,
  );
  assert.deepStrictEqual(order, ["other-1", "new-2"]);
});

test("switchProviderMetadata merges tags, folder_name, and watch history on newId conflict", async () => {
  const { db, deps } = createTestDb();
  db.prepare(
    `INSERT INTO Movies (id, folder_name, title, type, provider, CustomTag)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("old-1", "Dune (2021)", "Dune", "Movie", "@repo/cinejoy", '["downloads","sci-fi"]');
  db.prepare(
    `INSERT INTO Movies (id, folder_name, title, type, provider, CustomTag)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run("new-2", "", "Dune", "Movie", "@repo/bingr", '["favorites","sci-fi"]');

  db.prepare(
    `INSERT INTO SeriesMovieWatchHistory (movie_id, title, episode_number, season, current_time, time_spent, is_completed, last_watched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("old-1", "Dune", 1, 1, 900, 300, 1, "2026-11-21T12:00:00.000Z");
  db.prepare(
    `INSERT INTO SeriesMovieWatchHistory (movie_id, title, episode_number, season, current_time, time_spent, is_completed, last_watched)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("new-2", "Dune", 1, 1, 200, 100, 0, "2026-11-20T12:00:00.000Z");

  const res = await switchProviderMetadata(
    {
      type: "Movies",
      oldId: "old-1",
      newId: "new-2",
      newProvider: "@repo/bingr",
    },
    deps,
  );

  assert.strictEqual(res.migrated, true);
  assert.strictEqual(res.merged, true);

  const target = db.prepare("SELECT * FROM Movies WHERE id = 'new-2'").get();
  assert.strictEqual(target.folder_name, "Dune (2021)");
  assert.deepStrictEqual(JSON.parse(target.CustomTag).sort(), ["downloads", "favorites", "sci-fi"]);

  const histRows = db.prepare("SELECT * FROM SeriesMovieWatchHistory WHERE movie_id = 'new-2'").all();
  assert.strictEqual(histRows.length, 1);
  assert.strictEqual(histRows[0].is_completed, 1);
  assert.strictEqual(histRows[0].current_time, 900);
  assert.strictEqual(histRows[0].time_spent, 400);
});

test("switchProviderMetadata supports same ID across different providers and blocks queued downloads", async () => {
  const { db, deps } = createTestDb();
  db.prepare(
    `INSERT INTO Movies (id, folder_name, title, type, provider) VALUES (?, ?, ?, ?, ?)`,
  ).run("movie:550", "Fight Club", "Fight Club", "Movie", "@repo/cinejoy");

  const sameIdRes = await switchProviderMetadata(
    {
      type: "Movies",
      oldId: "movie:550",
      newId: "movie:550",
      newProvider: "@repo/bingr",
    },
    deps,
  );
  assert.strictEqual(sameIdRes.migrated, true);
  assert.strictEqual(
    db.prepare("SELECT provider FROM Movies WHERE id = 'movie:550'").get().provider,
    "@repo/bingr",
  );

  // Queue guard
  db.prepare("INSERT INTO DownloadQueue (epid, id) VALUES (?, ?)").run("ep-1", "movie:550");
  await assert.rejects(
    () =>
      switchProviderMetadata(
        {
          type: "Movies",
          oldId: "movie:550",
          newId: "other-id",
          newProvider: "@repo/cinejoy",
        },
        deps,
      ),
    (err) => err.statusCode === 409 && err.code === "DOWNLOAD_IN_QUEUE",
  );
});
