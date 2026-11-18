const axios = require("axios");
const http = require("http");
const https = require("https");

const mappingClient = axios.create({
  httpAgent: new http.Agent({ family: 4, keepAlive: true }),
  httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
  timeout: 60000,
});
const { logger } = require("./AppLogger");
const { syncDomainConcurrencyFromMappingDb } = require("./domainConcurrency");
const {
  mappingQueryAll,
  mappingQueryOne,
  mappingRun,
  mappingExec,
  batchRun,
  queryAll,
  queryOne,
  run,
} = require("./db");
const { getOSName, sanitizeFolderName } = require("./constants");
const {
  getMappingProviders,
  resolveMalIdFromMapping,
  ensureProviderTable,
} = require("./mappingResolver");

const MAPPING_API_BASE =
  process.env.MAPPING_API_URL || "https://strawverse.theyogmehta.online";

// Tables the mapping server answered with an error for during this session.
// One broken provider table used to fail the entire combined sync request
// (HTTP 500), which also blocked anime/manga/next_episodes from updating.
// Remembered here so later requests skip only the broken table.
const syncFailedTables = new Set();

// Hours between scheduled background syncs (settings key
// mappingSyncIntervalHours): 0 = timer off, missing/garbage = 1 hour.
function parseSyncIntervalHours(raw) {
  if (raw === null || raw === undefined || raw === "") return 1;
  const v = Number(raw);
  if (!Number.isFinite(v) || v < 0) return 1;
  return Math.floor(v);
}

async function getSyncIntervalHours() {
  try {
    return parseSyncIntervalHours(
      await getKeyValue("Settings", "mappingSyncIntervalHours"),
    );
  } catch (_) {
    return 1;
  }
}

// Freshness window for skipping a sync: the configured interval (a restart
// right after a run must not sync twice), or a day when the timer is off.
async function getFreshTtlMs() {
  const hours = await getSyncIntervalHours();
  return (hours > 0 ? hours : 24) * 60 * 60 * 1000;
}

async function shouldAutoSyncMapping(opts = {}) {
  try {
    // Scheduled (watchdog) runs ignore the startup toggle — the interval
    // is the only switch for those — and stay quiet, because the watchdog
    // re-evaluates them every minute.
    if (!opts.scheduled) {
      const toggle = await getKeyValue("Settings", "mappingAutoSync");
      if (toggle === false) {
        logger.info(
          "[mappingUpdater] Auto-sync disabled in settings; skipping.",
        );
        return false;
      }
    }
    const ttl = await getFreshTtlMs();
    const last = Number(await getKeyValue("Settings", "mappingLastSync")) || 0;
    if (last && Date.now() - last < ttl) {
      if (!opts.scheduled) {
        logger.info("[mappingUpdater] Mapping data is fresh; skipping sync.");
      }
      return false;
    }
  } catch (_) {
    // Unreadable settings: sync anyway (previous behavior).
  }
  return true;
}

async function dropAllTriggers() {
  try {
    const triggers = await mappingQueryAll(
      "SELECT name FROM sqlite_master WHERE type='trigger'",
    );
    for (const trigger of triggers) {
      await mappingRun(`DROP TRIGGER IF EXISTS "${trigger.name}"`);
    }
  } catch (e) {
    logger.error(`[mappingUpdater] Failed to drop triggers: ${e.message}`);
  }
}

async function ensureMappingTablesExist() {
  try {
    await mappingExec(`
      DROP TABLE IF EXISTS mapping_changelog;
      DROP TABLE IF EXISTS provider_metadata;
      CREATE TABLE IF NOT EXISTS sync_versions (
        table_name TEXT PRIMARY KEY,
        timestamp INTEGER DEFAULT 0,
        row_count INTEGER DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS unmapped_items (
        id TEXT NOT NULL,
        provider TEXT NOT NULL,
        media_type TEXT,
        name TEXT,
        image_url TEXT,
        type TEXT,
        episodes TEXT,
        status TEXT,
        season TEXT,
        year INTEGER,
        last_fetched TEXT,
        PRIMARY KEY (provider, id)
      );
      CREATE TABLE IF NOT EXISTS next_episodes (
        livechart_id TEXT,
        episode INTEGER,
        date TEXT,
        title TEXT,
        image TEXT,
        PRIMARY KEY (livechart_id, episode)
      );
      CREATE TABLE IF NOT EXISTS anime (
        malid INTEGER PRIMARY KEY,
        title TEXT,
        type TEXT,
        episodes INTEGER,
        status TEXT,
        season TEXT,
        year INTEGER,
        image_url TEXT,
        livechart_id TEXT UNIQUE,
        has_mapping INTEGER DEFAULT 0,
        genres TEXT
      );
      CREATE TABLE IF NOT EXISTS manga (
        malid INTEGER PRIMARY KEY,
        title TEXT,
        type TEXT,
        chapters INTEGER,
        volumes INTEGER,
        status TEXT,
        image_url TEXT,
        has_mapping INTEGER DEFAULT 0,
        genres TEXT
      );
    `);

    try {
      await mappingExec(`
        CREATE INDEX IF NOT EXISTS idx_unmapped_provider ON unmapped_items(provider);
        CREATE INDEX IF NOT EXISTS idx_unmapped_media_type ON unmapped_items(media_type);
        CREATE INDEX IF NOT EXISTS idx_next_episodes_date ON next_episodes(date);
        CREATE INDEX IF NOT EXISTS idx_anime_genres ON anime(genres);
        CREATE INDEX IF NOT EXISTS idx_manga_genres ON manga(genres);
      `);
    } catch (_) {}

    // Every title lookup used to scan the whole catalogue (30k anime / 87k
    // manga rows). An expression index turns those scans into index lookups.
    // Kept in its own statement so an old SQLite without expression index
    // support only loses the speed-up, not the other indexes.
    try {
      await mappingExec(`
        CREATE INDEX IF NOT EXISTS idx_anime_title_key ON anime(LOWER(TRIM(title)));
        CREATE INDEX IF NOT EXISTS idx_manga_title_key ON manga(LOWER(TRIM(title)));
      `);
    } catch (_) {}

    // Ensure all required columns exist if tables were created with an earlier schema
    const coreTableSchemas = {
      anime: {
        title: "TEXT",
        type: "TEXT",
        episodes: "INTEGER",
        status: "TEXT",
        season: "TEXT",
        year: "INTEGER",
        image_url: "TEXT",
        livechart_id: "TEXT",
        has_mapping: "INTEGER DEFAULT 0",
        genres: "TEXT",
      },
      manga: {
        title: "TEXT",
        type: "TEXT",
        chapters: "INTEGER",
        volumes: "INTEGER",
        status: "TEXT",
        image_url: "TEXT",
        has_mapping: "INTEGER DEFAULT 0",
        genres: "TEXT",
      },
      next_episodes: {
        livechart_id: "TEXT",
        episode: "INTEGER",
        date: "TEXT",
        title: "TEXT",
        image: "TEXT",
      },
      unmapped_items: {
        id: "TEXT",
        provider: "TEXT",
        media_type: "TEXT",
        name: "TEXT",
        image_url: "TEXT",
        type: "TEXT",
        episodes: "TEXT",
        status: "TEXT",
        season: "TEXT",
        year: "INTEGER",
        last_fetched: "TEXT",
      },
    };

    for (const [tbl, cols] of Object.entries(coreTableSchemas)) {
      try {
        const pragmaCols = await mappingQueryAll(`PRAGMA table_info("${tbl}")`);
        if (pragmaCols && pragmaCols.length > 0) {
          const existingColNames = new Set(
            pragmaCols.map((c) => (c.name || "").toLowerCase()),
          );
          for (const [colName, colDef] of Object.entries(cols)) {
            if (!existingColNames.has(colName.toLowerCase())) {
              try {
                await mappingExec(
                  `ALTER TABLE "${tbl}" ADD COLUMN "${colName}" ${colDef};`,
                );
                logger.info(
                  `[mappingUpdater] Added column ${colName} to ${tbl}`,
                );
              } catch (alterErr) {
                logger.warn(
                  `[mappingUpdater] Could not add column ${colName} to ${tbl}: ${alterErr.message}`,
                );
              }
            }
          }
        }
      } catch (colErr) {
        logger.warn(
          `[mappingUpdater] Failed checking columns for ${tbl}: ${colErr.message}`,
        );
      }
    }
  } catch (e) {
    logger.error(
      `[mappingUpdater] Failed to ensure mapping tables exist: ${e.message}`,
    );
  }
}

async function applySyncResponse(data) {
  if (!data) return false;
  const { tables, unmapped } = data;
  let hasChanges = false;
  const paheRotations = [];

  await ensureMappingTablesExist();
  await mappingExec("PRAGMA foreign_keys = OFF");

  try {
    // Load local unlinked ids once up front. The pruning below used to run
    // one SELECT per incoming row — 80k+ queries on a full anime+manga
    // snapshot — which blocked the event loop during startup sync.
    let unlinkedIds = null;
    if (global.db) {
      try {
        const unlinkedRows = await queryAll("SELECT id FROM unlinked_mal_ids");
        unlinkedIds = new Set((unlinkedRows || []).map((r) => String(r.id)));
      } catch (_) {
        unlinkedIds = new Set();
      }
    }

    // 1. Process regular & core tables (anime, manga, next_episodes, pahe, etc.)
    if (tables && typeof tables === "object") {
      for (const [tbl, tableData] of Object.entries(tables)) {
        if (!tableData) continue;
        const { type, timestamp, count, rows } = tableData;

        // If snapshot, handle UUID rotation tracking for pahe before wiping
        if (type === "snapshot") {
          logger.info(
            `[mappingUpdater] Applying full snapshot for table: ${tbl} (${rows?.length || 0} rows)`,
          );
          if (tbl === "pahe") {
            try {
              const existingRows = await mappingQueryAll(
                "SELECT id, uuid FROM pahe WHERE uuid IS NOT NULL",
              );
              const existingMap = new Map();
              for (const r of existingRows || []) {
                if (r.id && r.uuid) existingMap.set(String(r.id), r.uuid);
              }
              if (existingMap.size > 0 && Array.isArray(rows)) {
                for (const r of rows) {
                  const oldUuid = existingMap.get(String(r.id));
                  if (
                    oldUuid &&
                    r.uuid &&
                    oldUuid.toLowerCase() !== r.uuid.toLowerCase()
                  ) {
                    paheRotations.push({
                      oldUuid,
                      newUuid: r.uuid,
                      malid: r.malid || null,
                    });
                  }
                }
              }
            } catch (_) {}
          }
          await mappingRun(`DELETE FROM "${tbl}"`);
          hasChanges = true;
        }

        if (rows && rows.length > 0) {
          hasChanges = true;
          logger.info(
            `[mappingUpdater] Applying ${rows.length} ${type} rows for table: ${tbl}`,
          );

          if (
            tbl !== "anime" &&
            tbl !== "manga" &&
            tbl !== "next_episodes" &&
            tbl !== "unmapped_items" &&
            tbl !== "sync_versions"
          ) {
            await ensureProviderTable(tbl);
          }

          // Dynamically ensure all columns present in incoming rows exist in target table
          const pragmaCols =
            (await mappingQueryAll(`PRAGMA table_info("${tbl}")`)) || [];
          const existingColSet = new Set(
            pragmaCols.map((c) => (c.name || "").toLowerCase()),
          );

          const sampleRow = rows.find((r) => r && typeof r === "object");
          if (sampleRow) {
            for (const key of Object.keys(sampleRow)) {
              if (!existingColSet.has(key.toLowerCase())) {
                try {
                  await mappingExec(
                    `ALTER TABLE "${tbl}" ADD COLUMN "${key}" TEXT;`,
                  );
                  existingColSet.add(key.toLowerCase());
                  logger.info(
                    `[mappingUpdater] Dynamically added column "${key}" to "${tbl}"`,
                  );
                } catch (addColErr) {
                  logger.warn(
                    `[mappingUpdater] Failed to add column "${key}" to "${tbl}": ${addColErr.message}`,
                  );
                }
              }
            }
          }

          const CHUNK_SIZE = 500;
          for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const ops = [];

            for (const row of chunk) {
              if (!row || typeof row !== "object") continue;

              // Delta Pahe UUID rotation check
              if (type !== "snapshot" && tbl === "pahe" && row.id && row.uuid) {
                try {
                  const existingPahe = await mappingQueryOne(
                    "SELECT uuid FROM pahe WHERE id = ?",
                    [row.id],
                  );
                  if (
                    existingPahe?.uuid &&
                    existingPahe.uuid.toLowerCase() !== row.uuid.toLowerCase()
                  ) {
                    paheRotations.push({
                      oldUuid: existingPahe.uuid,
                      newUuid: row.uuid,
                      malid: row.malid || null,
                    });
                  }
                } catch (_) {}
              }

              // Prune duplicate local mappings and unmapped items if malid provided
              if (row.malid) {
                const targetIds = [row.id, row.uuid]
                  .filter(Boolean)
                  .map(String);
                if (
                  unlinkedIds &&
                  unlinkedIds.size > 0 &&
                  targetIds.length > 0
                ) {
                  for (const tid of targetIds) {
                    if (!unlinkedIds.has(tid)) continue;
                    try {
                      await run("DELETE FROM unlinked_mal_ids WHERE id = ?", [
                        tid,
                      ]);
                      unlinkedIds.delete(tid);
                      logger.info(
                        `[mappingUpdater] Pruned duplicate local mapping for ${tid} (canonical MAL ID ${row.malid})`,
                      );
                    } catch (_) {}
                  }
                }
                for (const tid of targetIds) {
                  ops.push({
                    sql: "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider LIKE ?) AND (id = ? OR id = ?)",
                    params: [tbl, tbl, `%/${tbl}`, tid, tid],
                  });
                }
              }

              // Build INSERT OR REPLACE safely matching existing columns
              const colKeys = Object.keys(row).filter((k) =>
                existingColSet.has(k.toLowerCase()),
              );
              if (colKeys.length > 0) {
                const cols = colKeys.map((c) => `"${c}"`).join(", ");
                const placeholders = colKeys.map(() => "?").join(", ");
                const values = colKeys.map((k) => row[k] ?? null);
                ops.push({
                  sql: `INSERT OR REPLACE INTO "${tbl}" (${cols}) VALUES (${placeholders})`,
                  params: values,
                });
              }
            }

            if (ops.length > 0) {
              await batchRun("mapping", ops);
              await new Promise((r) => setTimeout(r, 0));
            }
          }
        }

        // Update sync_versions for this table
        if (timestamp != null) {
          const rowCountRes = await mappingQueryOne(
            `SELECT COUNT(*) as count FROM "${tbl}"`,
          );
          const currentCount = rowCountRes?.count ?? count ?? 0;
          await mappingRun(
            "INSERT OR REPLACE INTO sync_versions (table_name, timestamp, row_count) VALUES (?, ?, ?)",
            [tbl, timestamp, currentCount],
          );
        }
      }
    }

    // 2. Process unmapped_items per provider
    if (unmapped && typeof unmapped === "object") {
      for (const [provider, provData] of Object.entries(unmapped)) {
        if (!provData) continue;
        const { type, timestamp, count, rows } = provData;

        if (type === "snapshot") {
          logger.info(
            `[mappingUpdater] Applying full snapshot for unmapped_items of ${provider} (${rows?.length || 0} rows)`,
          );
          await mappingRun(
            "DELETE FROM unmapped_items WHERE provider = ? OR provider = ? OR provider LIKE ?",
            [provider, provider, `%/${provider}`],
          );
          hasChanges = true;
        }

        if (rows && rows.length > 0) {
          hasChanges = true;
          logger.info(
            `[mappingUpdater] Applying ${rows.length} ${type} rows for unmapped_items of ${provider}`,
          );

          // Dynamically ensure all columns present in incoming rows exist in unmapped_items
          const pragmaCols =
            (await mappingQueryAll('PRAGMA table_info("unmapped_items")')) ||
            [];
          const existingColSet = new Set(
            pragmaCols.map((c) => (c.name || "").toLowerCase()),
          );

          const sampleRow = rows.find((r) => r && typeof r === "object");
          if (sampleRow) {
            for (const key of Object.keys(sampleRow)) {
              if (!existingColSet.has(key.toLowerCase())) {
                try {
                  await mappingExec(
                    `ALTER TABLE "unmapped_items" ADD COLUMN "${key}" TEXT;`,
                  );
                  existingColSet.add(key.toLowerCase());
                  logger.info(
                    `[mappingUpdater] Dynamically added column "${key}" to "unmapped_items"`,
                  );
                } catch (addColErr) {
                  logger.warn(
                    `[mappingUpdater] Failed to add column "${key}" to "unmapped_items": ${addColErr.message}`,
                  );
                }
              }
            }
          }

          const CHUNK_SIZE = 500;
          for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
            const chunk = rows.slice(i, i + CHUNK_SIZE);
            const ops = [];

            for (const row of chunk) {
              if (!row || typeof row !== "object") continue;
              const colKeys = Object.keys(row).filter((k) =>
                existingColSet.has(k.toLowerCase()),
              );
              if (colKeys.length > 0) {
                const cols = colKeys.map((c) => `"${c}"`).join(", ");
                const placeholders = colKeys.map(() => "?").join(", ");
                const values = colKeys.map((k) => row[k] ?? null);
                ops.push({
                  sql: `INSERT OR REPLACE INTO unmapped_items (${cols}) VALUES (${placeholders})`,
                  params: values,
                });
              }
            }

            if (ops.length > 0) {
              await batchRun("mapping", ops);
              await new Promise((r) => setTimeout(r, 0));
            }
          }
        }

        if (timestamp != null) {
          const rowCountRes = await mappingQueryOne(
            "SELECT COUNT(*) as count FROM unmapped_items WHERE provider = ? OR provider = ? OR provider LIKE ?",
            [provider, provider, `%/${provider}`],
          );
          const currentCount = rowCountRes?.count ?? count ?? 0;
          await mappingRun(
            "INSERT OR REPLACE INTO sync_versions (table_name, timestamp, row_count) VALUES (?, ?, ?)",
            [`unmapped_${provider}`, timestamp, currentCount],
          );
        }
      }
    }

    // Apply Pahe UUID rotations if any
    if (paheRotations.length > 0) {
      for (const rot of paheRotations) {
        try {
          await run(
            "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
            [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
          );
          await run(
            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
          );
          await run(
            "UPDATE OR REPLACE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
          );
          await run(
            "UPDATE DownloadQueue SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
            [rot.oldUuid, rot.newUuid, rot.oldUuid, `${rot.oldUuid}-%`],
          );
          if (rot.malid) {
            await run(
              "UPDATE Anime SET MalID = ? WHERE (id = ? OR id LIKE ?) AND (MalID IS NULL OR MalID = '')",
              [String(rot.malid), rot.newUuid, `${rot.newUuid}-%`],
            );
          }
          if (typeof global.sendToRenderer === "function") {
            global.sendToRenderer("anime-id-updated", {
              oldId: rot.oldUuid,
              newId: rot.newUuid,
              provider: "pahe",
              mediaType: "Anime",
            });
          }
        } catch (rotErr) {
          logger.error(
            `[mappingUpdater] Error applying delta UUID rotation ${rot.oldUuid} -> ${rot.newUuid}: ${rotErr.message}`,
          );
        }
      }
    }
  } finally {
    await mappingExec("PRAGMA foreign_keys = ON");
  }

  return hasChanges;
}

async function checkCanaries(osName) {
  try {
    const vRes = await mappingClient.get(
      `${MAPPING_API_BASE}/api/mapping/version`,
      {
        headers: { os: osName },
        timeout: 10000,
      },
    );
    const canaryChecks =
      vRes.data?.canaryChecks ||
      (vRes.data?.paheCanaryCheck ? { pahe: vRes.data.paheCanaryCheck } : null);
    if (canaryChecks && typeof canaryChecks === "object") {
      let activeAnime = "";
      let activeManga = "";
      try {
        const { settingfetch } = require("./settings");
        const cfg = await settingfetch();
        activeAnime = (cfg?.Animeprovider || "").toLowerCase();
        activeManga = (cfg?.Mangaprovider || "").toLowerCase();
      } catch (_) {}

      for (const [providerName, canaryData] of Object.entries(canaryChecks)) {
        const pLower = providerName.toLowerCase();
        const isSelected =
          activeAnime === pLower ||
          activeAnime.endsWith(`/${pLower}`) ||
          activeManga === pLower ||
          activeManga.endsWith(`/${pLower}`);
        if (!isSelected) continue;

        const provider =
          (global.Anime_providers &&
            (global.Anime_providers[providerName] ||
              global.Anime_providers[`TheYogMehta/${providerName}`])) ||
          (global.Manga_providers &&
            (global.Manga_providers[providerName] ||
              global.Manga_providers[`TheYogMehta/${providerName}`])) ||
          null;
        if (provider && typeof provider.checkCanary === "function") {
          try {
            provider.checkCanary(canaryData).catch(() => {});
          } catch (_) {}
        }
      }
    }
  } catch (_) {}
}

// The watchdog wakes once a minute, re-reads the interval setting (so a
// change — including 0 = off — takes effect within a minute, with no
// reschedule plumbing in the settings save paths) and runs a scheduled
// sync once the interval has elapsed since the last attempt. Attempts are
// tracked in memory: a failed sync retries next interval instead of every
// minute, and a restart starts clean (the boot sync covers that run).
let lastMappingSyncAttempt = 0;
let watchdogTimer = null;

function armMappingWatchdog() {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(runMappingWatchdogTick, 60 * 1000);
  // Never keep the process alive just for the timer.
  if (typeof watchdogTimer.unref === "function") watchdogTimer.unref();
}

async function runMappingWatchdogTick() {
  try {
    const hours = await getSyncIntervalHours();
    if (hours === 0) return; // 0 = no scheduled sync
    if (Date.now() - lastMappingSyncAttempt < hours * 60 * 60 * 1000) return;
    await checkForMappingUpdates(false, { scheduled: true });
  } catch (e) {
    logger.error(`[mappingUpdater] Scheduled sync failed: ${e.message}`);
  }
}

// Never two syncs at once: a watchdog tick or a manual "Sync now" that
// lands mid-run joins the in-flight run instead of starting a second one
// (shortcut: a forced sync during an in-flight run resolves with that run
// rather than forcing a fresh one — rare, and a sync is happening either way).
let activeMappingSync = null;

async function checkForMappingUpdates(force = false, opts = {}) {
  armMappingWatchdog();
  if (activeMappingSync) return activeMappingSync;
  activeMappingSync = runMappingSyncCheck(force, opts).finally(() => {
    activeMappingSync = null;
  });
  return activeMappingSync;
}

async function runMappingSyncCheck(force = false, opts = {}) {
  if (!force && !(await shouldAutoSyncMapping(opts))) return;

  // Any run that actually starts anchors the next scheduled run: the
  // watchdog will not fire another one for a full interval.
  lastMappingSyncAttempt = Date.now();
  logger.info("[mappingUpdater] Checking for mapping database updates...");

  await dropAllTriggers();
  await ensureMappingTablesExist();

  const installedProviders = new Set();
  const collect = (map) => {
    if (!map) return;
    for (const p of Object.values(map)) {
      if (p?.name) {
        const clean = String(p.name).toLowerCase().trim().split("/").pop();
        if (clean) installedProviders.add(clean);
      }
    }
  };
  collect(global.Anime_providers);
  collect(global.Manga_providers);

  for (const prov of installedProviders) {
    await ensureProviderTable(prov);
  }

  const tablesToSync = [
    "anime",
    "manga",
    "next_episodes",
    ...Array.from(installedProviders),
  ];
  const reqTables = {};

  for (const tbl of tablesToSync) {
    let storedTs = 0;
    let actualCount = 0;
    try {
      const vRow = await mappingQueryOne(
        "SELECT timestamp, row_count FROM sync_versions WHERE table_name = ?",
        [tbl],
      );
      if (vRow?.timestamp) storedTs = Number(vRow.timestamp);
    } catch (_) {}

    try {
      const cRow = await mappingQueryOne(
        `SELECT COUNT(*) as count FROM "${tbl}"`,
      );
      if (cRow?.count != null) actualCount = Number(cRow.count);
    } catch (_) {}

    const effectiveTs = force || actualCount === 0 ? 0 : storedTs;
    reqTables[tbl] = {
      timestamp: effectiveTs,
      count: actualCount,
    };
  }

  const reqUnmapped = {};
  for (const prov of installedProviders) {
    let storedTs = 0;
    let actualCount = 0;
    try {
      const vRow = await mappingQueryOne(
        "SELECT timestamp, row_count FROM sync_versions WHERE table_name = ?",
        [`unmapped_${prov}`],
      );
      if (vRow?.timestamp) storedTs = Number(vRow.timestamp);
    } catch (_) {}

    try {
      const cRow = await mappingQueryOne(
        "SELECT COUNT(*) as count FROM unmapped_items WHERE provider = ? OR provider = ? OR provider LIKE ?",
        [prov, prov, `%/${prov}`],
      );
      if (cRow?.count != null) actualCount = Number(cRow.count);
    } catch (_) {}

    const effectiveTs = force || actualCount === 0 ? 0 : storedTs;
    reqUnmapped[prov] = {
      timestamp: effectiveTs,
      count: actualCount,
    };
  }

  const osName = getOSName();

  // Exclude tables the server already failed on this session.
  const liveTables = {};
  for (const [tbl, meta] of Object.entries(reqTables)) {
    if (!syncFailedTables.has(tbl)) liveTables[tbl] = meta;
  }
  const liveUnmapped = {};
  for (const [prov, meta] of Object.entries(reqUnmapped)) {
    if (!syncFailedTables.has(prov)) liveUnmapped[prov] = meta;
  }

  const postSync = async (tables, unmapped) => {
    const res = await mappingClient.post(
      `${MAPPING_API_BASE}/api/mapping/sync`,
      { tables, unmapped },
      {
        headers: {
          os: osName,
          "Accept-Encoding": "gzip",
        },
      },
    );
    return res.data || null;
  };

  let syncSucceeded = false;
  const scopeLabel = "Mapping database";
  const applyData = async (data, label = scopeLabel) => {
    if (!data) return;
    if (
      data.upToDate &&
      (!data.tables || Object.keys(data.tables).length === 0)
    ) {
      logger.info(`[mappingUpdater] ${label} is already up to date.`);
      syncSucceeded = true;
      return;
    }
    const changed = await applySyncResponse(data);
    syncSucceeded = true;
    logger.info(
      changed
        ? `[mappingUpdater] ${label} sync completed successfully.`
        : `[mappingUpdater] ${label} is up to date.`,
    );
  };

  // Fast path: one combined request for everything.
  try {
    await applyData(await postSync(liveTables, liveUnmapped), scopeLabel);
  } catch (err) {
    const status = err.response && err.response.status;
    logger.error(
      `[mappingUpdater] Failed to sync mapping database: ${err.message}`,
    );

    // The server answered with an error: retry split by table group so a
    // single broken table no longer aborts the whole sync. (Verified: the
    // API can 500 on one provider table while anime/manga stay healthy.)
    if (status && status >= 400) {
      logger.warn(
        "[mappingUpdater] Retrying sync split by table group so one bad table cannot block the rest.",
      );

      const core = {};
      const providers = {};
      for (const [tbl, meta] of Object.entries(liveTables)) {
        if (tbl === "anime" || tbl === "manga" || tbl === "next_episodes") {
          core[tbl] = meta;
        } else {
          providers[tbl] = meta;
        }
      }

      // 1) Core tables together with every unmapped bucket.
      if (Object.keys(core).length > 0) {
        try {
          await applyData(
            await postSync(core, liveUnmapped),
            "Mapping database (core tables)",
          );
        } catch (coreErr) {
          logger.error(
            `[mappingUpdater] Core table sync failed: ${coreErr.message}`,
          );
          try {
            await applyData(
              await postSync(core, {}),
              "Mapping database (core tables)",
            );
          } catch (coreOnlyErr) {
            logger.error(
              `[mappingUpdater] Core table sync failed without unmapped data: ${coreOnlyErr.message}`,
            );
          }
        }
      }

      // 2) Each provider table on its own; remember the ones that fail.
      for (const [tbl, meta] of Object.entries(providers)) {
        try {
          await applyData(
            await postSync({ [tbl]: meta }, {}),
            `Provider table "${tbl}"`,
          );
        } catch (provErr) {
          syncFailedTables.add(tbl);
          logger.warn(
            `[mappingUpdater] Skipping provider table "${tbl}" for this session: ${provErr.message}`,
          );
        }
      }
    }
  }

  if (syncSucceeded) {
    try {
      await setKeyValue("Settings", "mappingLastSync", Date.now());
    } catch (_) {}
  }

  try {
    await syncLibraryIdsWithMapping();
  } catch (syncErr) {
    logger.error(
      `[mappingUpdater] Failed to sync library IDs: ${syncErr.message}`,
    );
  }

  checkCanaries(osName).catch(() => {});
}

async function syncExtensionMapping(extensionName) {
  if (!extensionName || !global.mappingDb) return;
  const cleanProv = String(extensionName).toLowerCase().trim().split("/").pop();
  if (!cleanProv) return;

  try {
    await ensureMappingTablesExist();
    await ensureProviderTable(cleanProv);

    const osName = getOSName();
    const res = await mappingClient.post(
      `${MAPPING_API_BASE}/api/mapping/sync`,
      {
        tables: {
          [cleanProv]: { timestamp: 0, count: 0 },
        },
        unmapped: {
          [cleanProv]: { timestamp: 0, count: 0 },
        },
      },
      {
        headers: {
          os: osName,
          "Accept-Encoding": "gzip",
        },
        timeout: 30000,
      },
    );

    if (res.data) {
      await applySyncResponse(res.data);
      logger.info(`[mappingUpdater] Initialized mappings for ${cleanProv}`);
    }
  } catch (err) {
    if (err.response && err.response.status >= 400) {
      // Server-side failure for this provider table: remember it so the
      // next full sync skips it instead of failing the whole request.
      syncFailedTables.add(cleanProv);
    }
    logger.warn(
      `[mappingUpdater] Could not fetch mappings for ${cleanProv}: ${err.message}`,
    );
  }
}

async function cleanupExtensionMapping(extensionName) {
  if (!extensionName || !global.mappingDb) return;
  const cleanProv = String(extensionName).toLowerCase().trim().split("/").pop();
  if (!cleanProv) return;

  try {
    await mappingExec(`DROP TABLE IF EXISTS "${cleanProv}"`);
    try {
      global.mappingDb
        .prepare(
          "DELETE FROM unmapped_items WHERE provider = ? OR provider = ? OR provider LIKE ?",
        )
        .run(cleanProv, extensionName, `%/${cleanProv}`);
    } catch (_) {}

    try {
      global.mappingDb
        .prepare(
          "DELETE FROM extension_settings WHERE provider = ? OR provider = ?",
        )
        .run(cleanProv, extensionName);
    } catch (_) {}

    try {
      global.mappingDb
        .prepare(
          "DELETE FROM sync_versions WHERE table_name = ? OR table_name = ?",
        )
        .run(cleanProv, `unmapped_${cleanProv}`);
    } catch (_) {}

    logger.info(
      `[mappingUpdater] Purged all mapping data for deleted extension: ${cleanProv}`,
    );
  } catch (err) {
    logger.error(
      `[mappingUpdater] Failed to cleanup mapping data for ${cleanProv}: ${err.message}`,
    );
  }
}

async function applyDeltaUpdates(updates, _latestVersion, _storedTag) {
  // Legacy compatibility stub
  if (!updates || updates.length === 0) return;
  logger.info(
    `[mappingUpdater] applyDeltaUpdates called with ${updates.length} records (legacy stub).`,
  );
}

global.checkForMappingUpdates = checkForMappingUpdates;

async function syncLibraryIdsWithMapping() {
  try {
    // 1. Sync Anime
    const animeProviders = await getMappingProviders("Anime");
    const localAnimeList = await queryAll(
      "SELECT id, MalID, malid, provider, title, folder_name FROM Anime",
    );
    for (const anime of localAnimeList || []) {
      let rawMalId = anime.MalID || anime.malid;
      let malid =
        rawMalId && !isNaN(Number(rawMalId)) && Number(rawMalId) > 0
          ? Number(rawMalId)
          : null;
      const provider = (anime.provider || "").toLowerCase();

      if (!malid) {
        try {
          const unlinkedRow = await queryOne(
            "SELECT malid FROM unlinked_mal_ids WHERE id = ? OR id LIKE ? LIMIT 1",
            [anime.id, `${anime.id}-%`],
          );
          if (unlinkedRow?.malid && !isNaN(Number(unlinkedRow.malid))) {
            malid = Number(unlinkedRow.malid);
          }
        } catch (_) {}
      }

      if (!malid && (anime.title || anime.folder_name)) {
        try {
          const candidates = [anime.title, anime.folder_name].filter(Boolean);
          for (const cand of candidates) {
            const malRow = await queryOne(
              "SELECT id FROM MyAnimeList WHERE LOWER(title) = LOWER(?) LIMIT 1",
              [cand],
            );
            if (malRow?.id && !isNaN(Number(malRow.id))) {
              malid = Number(malRow.id);
              break;
            }
          }
        } catch (_) {}
      }

      if (!malid) {
        try {
          const resolved = await resolveMalIdFromMapping({
            id: anime.id,
            provider,
            mediaType: "Anime",
          });
          if (resolved && !isNaN(Number(resolved))) {
            malid = Number(resolved);
          }
        } catch (_) {}
      }

      if (malid && !rawMalId) {
        try {
          await run("UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?", [
            String(malid),
            anime.id,
            `${anime.id}-%`,
          ]);
        } catch (_) {}
      }

      const cleanProv = provider.replace(/[^a-z0-9]/g, "");
      let matched = animeProviders.find((p) => {
        const tbl = p.table_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          cleanProv &&
          (tbl === cleanProv ||
            tbl.includes(cleanProv) ||
            cleanProv.includes(tbl))
        );
      });

      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
          anime.id,
        );
      if (!matched) {
        if (isUuid) {
          matched = animeProviders.find(
            (p) =>
              (p.primary_key_field || "").toLowerCase() === "uuid" ||
              p.table_name === "pahe",
          );
        } else if (!provider || provider === "local source") {
          matched = animeProviders.find((p) => p.table_name === "pahe");
        }
      }
      if (!matched) continue;

      const targetTable = matched.table_name;
      const isPahe = targetTable === "pahe";

      let targetRow = null;
      if (malid) {
        const query = isPahe
          ? `SELECT id, uuid, malid FROM "${targetTable}" WHERE malid = ? LIMIT 1`
          : `SELECT id, malid FROM "${targetTable}" WHERE malid = ? LIMIT 1`;
        targetRow = await mappingQueryOne(query, [malid]);
      }
      if (!targetRow) {
        const query = isPahe
          ? `SELECT id, uuid, malid FROM "${targetTable}" WHERE id = ? OR uuid = ? LIMIT 1`
          : `SELECT id, malid FROM "${targetTable}" WHERE id = ? LIMIT 1`;
        targetRow = isPahe
          ? await mappingQueryOne(query, [anime.id, anime.id])
          : await mappingQueryOne(query, [anime.id]);
      }

      if (targetRow) {
        const latestId = isPahe ? targetRow.id || targetRow.uuid : targetRow.id;
        if (latestId && latestId !== anime.id) {
          const existingFolder =
            anime.folder_name ||
            (anime.title ? sanitizeFolderName(anime.title) : anime.id);
          try {
            await run(
              "UPDATE Anime SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id LIKE ?",
              [existingFolder, anime.id, `${anime.id}-%`],
            );
          } catch (_) {}

          await run(
            "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
            [anime.id, latestId, anime.id, `${anime.id}-%`],
          );

          await run(
            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [anime.id, latestId, anime.id, `${anime.id}-%`],
          );

          await run(
            "UPDATE OR REPLACE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [anime.id, latestId, anime.id, `${anime.id}-%`],
          );

          try {
            await run(
              "UPDATE DownloadQueue SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              [anime.id, latestId, anime.id, `${anime.id}-%`],
            );
          } catch (_) {}

          try {
            await run(
              "UPDATE OR REPLACE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
              [anime.id, latestId, anime.id, `${anime.id}-%`],
            );
          } catch (_) {}

          if (targetRow.malid || malid) {
            const saveMalId = String(targetRow.malid || malid);
            await run("UPDATE Anime SET MalID = ? WHERE id = ? OR id LIKE ?", [
              saveMalId,
              latestId,
              `${latestId}-%`,
            ]);
          }

          try {
            if (typeof global.sendToRenderer === "function") {
              global.sendToRenderer("anime-id-updated", {
                oldId: anime.id,
                newId: latestId,
                provider: anime.provider || targetTable,
                mediaType: "Anime",
              });
            }
          } catch (_) {}
        }
      }
    }

    // 1.5 Sync standalone WatchHistory entries that are not in Anime table
    try {
      const standaloneHistory = await queryAll(
        "SELECT DISTINCT anime_id, anime_title FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
      );
      for (const hist of standaloneHistory || []) {
        if (!hist.anime_id) continue;
        const isUuid =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
            hist.anime_id,
          );
        if (!isUuid) continue;

        let targetRow = null;
        try {
          targetRow = await mappingQueryOne(
            "SELECT id, uuid, malid FROM pahe WHERE id = ? OR uuid = ? LIMIT 1",
            [hist.anime_id, hist.anime_id],
          );
        } catch (_) {}

        if (!targetRow && hist.anime_title) {
          try {
            const malRow = await queryOne(
              "SELECT id FROM MyAnimeList WHERE LOWER(title) = LOWER(?) LIMIT 1",
              [hist.anime_title],
            );
            if (malRow?.id) {
              targetRow = await mappingQueryOne(
                "SELECT id, uuid, malid FROM pahe WHERE malid = ? LIMIT 1",
                [Number(malRow.id)],
              );
            }
          } catch (_) {}
        }

        const targetId = targetRow ? targetRow.id || targetRow.uuid : null;
        if (targetId && targetId !== hist.anime_id) {
          await run(
            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [hist.anime_id, targetId, hist.anime_id, `${hist.anime_id}-%`],
          );
          await run(
            "UPDATE OR REPLACE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
            [hist.anime_id, targetId, hist.anime_id, `${hist.anime_id}-%`],
          );
        }
      }
    } catch (whErr) {
      logger.error(
        `[mappingUpdater] Failed to sync standalone WatchHistory: ${whErr.message}`,
      );
    }

    // 2. Sync Manga
    const mangaProviders = await getMappingProviders("Manga");
    const localMangaList = await queryAll(
      "SELECT id, MalID, malid, provider, title, folder_name FROM Manga",
    );
    for (const manga of localMangaList || []) {
      let rawMalId = manga.MalID || manga.malid;
      let malid =
        rawMalId && !isNaN(Number(rawMalId)) && Number(rawMalId) > 0
          ? Number(rawMalId)
          : null;
      const provider = (manga.provider || "").toLowerCase();

      if (!malid) {
        try {
          const unlinkedRow = await queryOne(
            "SELECT malid FROM unlinked_mal_ids WHERE id = ? LIMIT 1",
            [manga.id],
          );
          if (unlinkedRow?.malid && !isNaN(Number(unlinkedRow.malid))) {
            malid = Number(unlinkedRow.malid);
          }
        } catch (_) {}
      }

      if (!malid && (manga.title || manga.folder_name)) {
        try {
          const candidates = [manga.title, manga.folder_name].filter(Boolean);
          for (const cand of candidates) {
            const malRow = await queryOne(
              "SELECT id FROM MyMangaList WHERE LOWER(title) = LOWER(?) LIMIT 1",
              [cand],
            );
            if (malRow?.id && !isNaN(Number(malRow.id))) {
              malid = Number(malRow.id);
              break;
            }
          }
        } catch (_) {}
      }

      if (!malid) {
        try {
          const resolved = await resolveMalIdFromMapping({
            id: manga.id,
            provider,
            mediaType: "Manga",
          });
          if (resolved && !isNaN(Number(resolved))) {
            malid = Number(resolved);
          }
        } catch (_) {}
      }

      if (malid && !rawMalId) {
        try {
          await run("UPDATE Manga SET MalID = ? WHERE id = ?", [
            String(malid),
            manga.id,
          ]);
        } catch (_) {}
      }

      const cleanProv = provider.replace(/[^a-z0-9]/g, "");
      let matched = mangaProviders.find((p) => {
        const tbl = p.table_name.toLowerCase().replace(/[^a-z0-9]/g, "");
        return (
          cleanProv &&
          (tbl === cleanProv ||
            tbl.includes(cleanProv) ||
            cleanProv.includes(tbl))
        );
      });
      if (!matched) continue;

      const targetTable = matched.table_name;
      let targetRow = null;
      if (malid) {
        targetRow = await mappingQueryOne(
          `SELECT id, malid FROM "${targetTable}" WHERE malid = ? LIMIT 1`,
          [malid],
        );
      }
      if (!targetRow) {
        targetRow = await mappingQueryOne(
          `SELECT id, malid FROM "${targetTable}" WHERE id = ? LIMIT 1`,
          [manga.id],
        );
      }

      if (targetRow) {
        const latestId = targetRow.id;
        if (latestId && latestId !== manga.id) {
          const existingFolder =
            manga.folder_name ||
            (manga.title ? sanitizeFolderName(manga.title) : manga.id);
          try {
            await run(
              "UPDATE Manga SET folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ?",
              [existingFolder, manga.id],
            );
          } catch (_) {}

          await run(
            "UPDATE OR REPLACE Manga SET id = REPLACE(id, ?, ?) WHERE id = ?",
            [manga.id, latestId, manga.id],
          );

          await run(
            "UPDATE ReadHistory SET manga_id = REPLACE(manga_id, ?, ?) WHERE manga_id = ?",
            [manga.id, latestId, manga.id],
          );

          try {
            await run(
              "UPDATE DownloadQueue SET id = REPLACE(id, ?, ?) WHERE id = ?",
              [manga.id, latestId, manga.id],
            );
          } catch (_) {}

          try {
            await run(
              "UPDATE OR REPLACE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ?",
              [manga.id, latestId, manga.id],
            );
          } catch (_) {}

          if (targetRow.malid || malid) {
            const saveMalId = String(targetRow.malid || malid);
            await run("UPDATE Manga SET MalID = ? WHERE id = ?", [
              saveMalId,
              latestId,
            ]);
          }

          try {
            if (typeof global.sendToRenderer === "function") {
              global.sendToRenderer("anime-id-updated", {
                oldId: manga.id,
                newId: latestId,
                provider: manga.provider || targetTable,
                mediaType: "Manga",
              });
            }
          } catch (_) {}
        }
      }
    }

    try {
      const orphanWatchList = await queryAll(
        "SELECT DISTINCT anime_id, anime_title FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
      );
      for (const item of orphanWatchList || []) {
        if (!item.anime_id) continue;
        let malid = null;
        if (item.anime_title) {
          const malRow = await queryOne(
            "SELECT id FROM MyAnimeList WHERE LOWER(title) = LOWER(?) LIMIT 1",
            [item.anime_title],
          );
          if (malRow?.id && !isNaN(Number(malRow.id))) {
            malid = Number(malRow.id);
          }
        }
        if (!malid) {
          try {
            const resolved = await resolveMalIdFromMapping({
              id: item.anime_id,
              mediaType: "Anime",
            });
            if (resolved && !isNaN(Number(resolved))) {
              malid = Number(resolved);
            }
          } catch (_) {}
        }
        if (malid) {
          const targetTable = "pahe";
          const targetRow = await mappingQueryOne(
            `SELECT id, uuid, malid FROM "${targetTable}" WHERE malid = ? LIMIT 1`,
            [malid],
          );
          if (targetRow) {
            const latestId = targetRow.id || targetRow.uuid;
            if (latestId && latestId !== item.anime_id) {
              await run(
                "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
                [item.anime_id, latestId, item.anime_id, `${item.anime_id}-%`],
              );
              await run(
                "UPDATE OR REPLACE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
                [item.anime_id, latestId, item.anime_id, `${item.anime_id}-%`],
              );
              try {
                if (typeof global.sendToRenderer === "function") {
                  global.sendToRenderer("anime-id-updated", {
                    oldId: item.anime_id,
                    newId: latestId,
                    provider: targetTable,
                    mediaType: "Anime",
                  });
                }
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}

    // 3. Prune duplicate local mappings in unlinked_mal_ids that now exist in mapping.db
    try {
      if (global.db && global.mappingDb) {
        const localOverrides = await queryAll(
          "SELECT id, malid FROM unlinked_mal_ids WHERE malid IS NOT NULL",
        );
        for (const row of localOverrides || []) {
          if (!row.id) continue;
          let resolvedMalId = await resolveMalIdFromMapping({ id: row.id });
          if (!resolvedMalId && row.id.includes("-")) {
            const stripped = row.id.replace(/-[^-]+$/, "");
            resolvedMalId = await resolveMalIdFromMapping({ id: stripped });
          }
          if (resolvedMalId) {
            await run("DELETE FROM unlinked_mal_ids WHERE id = ?", [row.id]);
            try {
              await mappingRun(
                "DELETE FROM unmapped_items WHERE id = ? OR id LIKE ?",
                [row.id, `%${row.id}%`],
              );
            } catch (_) {}
            logger.info(
              `[mappingUpdater] Pruned duplicate local mapping for ${row.id} as it is mapped in server mapping.db (MAL ID: ${resolvedMalId})`,
            );
          }
        }
      }
    } catch (pruneErr) {
      logger.error(
        `[mappingUpdater] Error pruning duplicate local mappings: ${pruneErr.message}`,
      );
    }

    if (typeof syncDomainConcurrencyFromMappingDb === "function") {
      await syncDomainConcurrencyFromMappingDb();
    }
  } catch (err) {
    logger.error(`[mappingUpdater] Failed to sync library IDs: ${err.message}`);
  }
}

module.exports = {
  checkForMappingUpdates,
  parseSyncIntervalHours,
  applyDeltaUpdates,
  syncExtensionMapping,
  cleanupExtensionMapping,
};
