/**
 * `node:sqlite` shim for the Android (nodejs-mobile) runtime.
 *
 * nodejs-mobile is pinned to Node 18, which has no `node:sqlite` module.
 * This shim provides a `DatabaseSync`-compatible class with two backends:
 *
 *   1. better-sqlite3 (preferred) - native module cross-compiled for Android
 *      by the nodejs-mobile gradle plugin. Its Database/Statement API is
 *      already compatible with node:sqlite's DatabaseSync surface used by
 *      the backend (prepare / exec / close, stmt.get / .all / .run).
 *
 *   2. sql.js (WASM fallback) - zero native code. main.js pre-initializes the
 *      WASM module into `global.__sqljs` before the backend loads, so the
 *      constructor here can stay synchronous. Writes are persisted to disk
 *      with a debounce.
 */

const fs = require("fs");
const path = require("path");

let Better = null;
try {
  Better = require("better-sqlite3");
} catch (_) {
  Better = null;
}

// ---------------------------------------------------------------------------
// Backend 1: better-sqlite3 (API-compatible, thin wrapper)
// ---------------------------------------------------------------------------
class BetterDatabaseSync {
  constructor(dbPath, options = {}) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this._db = new Better(dbPath, options);
    this._db.pragma("journal_mode = WAL");
  }
  prepare(sql) {
    const stmt = this._db.prepare(sql);
    return {
      get: (...params) => stmt.get(...params),
      all: (...params) => stmt.all(...params),
      run: (...params) => {
        const info = stmt.run(...params);
        return { changes: info.changes, lastInsertRowid: info.lastInsertRowid };
      },
    };
  }
  exec(sql) {
    return this._db.exec(sql);
  }
  close() {
    return this._db.close();
  }
}

// ---------------------------------------------------------------------------
// Backend 2: sql.js (WASM) with debounced write-back persistence
// ---------------------------------------------------------------------------
class SqlJsDatabaseSync {
  constructor(dbPath) {
    const SQL = global.__sqljs;
    if (!SQL) {
      throw new Error(
        "sql.js not initialized. main.js must await initSqlJs() and set global.__sqljs before the backend loads.",
      );
    }
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this._path = dbPath;
    this._persistTimer = null;
    if (fs.existsSync(dbPath)) {
      this._db = new SQL.Database(fs.readFileSync(dbPath));
    } else {
      this._db = new SQL.Database();
      this._persistNow();
    }
  }

  _schedulePersist() {
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistNow();
    }, 500);
  }

  _persistNow() {
    try {
      fs.writeFileSync(this._path, Buffer.from(this._db.export()));
    } catch (e) {
      console.error(`[sqlite-shim] Failed to persist ${this._path}:`, e);
    }
  }

  prepare(sql) {
    const self = this;
    const isWrite = !/^\s*(SELECT|PRAGMA)\b/i.test(sql);
    return {
      get(...params) {
        const stmt = self._db.prepare(sql);
        try {
          stmt.bind(params);
          if (stmt.step()) return stmt.getAsObject();
          return undefined;
        } finally {
          stmt.free();
          if (isWrite) self._schedulePersist();
        }
      },
      all(...params) {
        const stmt = self._db.prepare(sql);
        const rows = [];
        try {
          stmt.bind(params);
          while (stmt.step()) rows.push(stmt.getAsObject());
          return rows;
        } finally {
          stmt.free();
          if (isWrite) self._schedulePersist();
        }
      },
      run(...params) {
        const stmt = self._db.prepare(sql);
        try {
          stmt.bind(params);
          stmt.step();
        } finally {
          stmt.free();
        }
        const changes = self._db.getRowsModified();
        let lastInsertRowid = 0;
        try {
          const r = self._db.exec("SELECT last_insert_rowid() AS id");
          lastInsertRowid = r.length ? r[0].values[0][0] : 0;
        } catch (_) {
          /* ignore */
        }
        self._schedulePersist();
        return { changes, lastInsertRowid };
      },
    };
  }

  exec(sql) {
    this._db.run(sql);
    this._schedulePersist();
  }

  close() {
    if (this._persistTimer) clearTimeout(this._persistTimer);
    this._persistNow();
    this._db.close();
  }
}

const DatabaseSync = Better ? BetterDatabaseSync : SqlJsDatabaseSync;

module.exports = {
  DatabaseSync,
  __backend: Better ? "better-sqlite3" : "sql.js",
};
