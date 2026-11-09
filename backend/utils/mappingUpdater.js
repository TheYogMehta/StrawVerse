const axios = require("axios");
const http = require("http");
const https = require("https");
const path = require("path");

const mappingClient = axios.create({
  httpAgent: new http.Agent({ family: 4, keepAlive: true }),
  httpsAgent: new https.Agent({ family: 4, keepAlive: true }),
  timeout: 60000,
});
let app = null;
try {
  app = require("electron").app;
} catch (e) {}
const { logger } = require("./AppLogger");
const { syncDomainConcurrencyFromMappingDb } = require("./domainConcurrency");
const {
  getKeyValue,
  setKeyValue,
  mappingQueryAll,
  mappingQueryOne,
  mappingRun,
  mappingExec,
  batchRun,
  queryAll,
  queryOne,
  run,
} = require("./db");
const {
  getUserDataPath,
  getOSName,
  sanitizeFolderName,
} = require("./constants");
const {
  getMappingProviders,
  resolveMalIdFromMapping,
} = require("./mappingResolver");

const userDataPath = getUserDataPath();
const MAPPING_API_BASE =
  process.env.MAPPING_API_URL || "https://strawverse.theyogmehta.online";

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

async function ensureProviderTable(providerName) {
  const cleanProv = String(providerName).toLowerCase().trim().split("/").pop();
  if (!cleanProv) return;

  if (cleanProv === "pahe") {
    await mappingExec(`
      CREATE TABLE IF NOT EXISTS pahe (
        id TEXT PRIMARY KEY,
        uuid TEXT,
        malid INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pahe_malid ON pahe(malid);
    `);
  } else {
    await mappingExec(`
      CREATE TABLE IF NOT EXISTS "${cleanProv}" (
        id TEXT PRIMARY KEY,
        malid INTEGER
      );
      CREATE INDEX IF NOT EXISTS "idx_${cleanProv}_malid" ON "${cleanProv}"(malid);
    `);
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
                if (global.db && targetIds.length > 0) {
                  for (const tid of targetIds) {
                    try {
                      const localEntry = await queryOne(
                        "SELECT malid FROM unlinked_mal_ids WHERE id = ? LIMIT 1",
                        [tid],
                      );
                      if (localEntry) {
                        await run("DELETE FROM unlinked_mal_ids WHERE id = ?", [
                          tid,
                        ]);
                        logger.info(
                          `[mappingUpdater] Pruned duplicate local mapping for ${tid} (canonical MAL ID ${row.malid})`,
                        );
                      }
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

async function checkForMappingUpdates(force = false) {
  logger.info("[mappingUpdater] Checking for mapping database updates...");

  await dropAllTriggers();
  await ensureMappingTablesExist();

  const installedProviders = new Set();
  if (global.Anime_providers) {
    for (const p of Object.values(global.Anime_providers)) {
      if (p?.name) {
        const clean = String(p.name).toLowerCase().trim().split("/").pop();
        if (clean) installedProviders.add(clean);
      }
    }
  }
  if (global.Manga_providers) {
    for (const p of Object.values(global.Manga_providers)) {
      if (p?.name) {
        const clean = String(p.name).toLowerCase().trim().split("/").pop();
        if (clean) installedProviders.add(clean);
      }
    }
  }

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

  try {
    const res = await mappingClient.post(
      `${MAPPING_API_BASE}/api/mapping/sync`,
      {
        tables: reqTables,
        unmapped: reqUnmapped,
      },
      {
        headers: {
          os: osName,
          "Accept-Encoding": "gzip",
        },
      },
    );

    if (res.data) {
      if (
        res.data.upToDate &&
        (!res.data.tables || Object.keys(res.data.tables).length === 0)
      ) {
        logger.info("[mappingUpdater] Mapping database is already up to date.");
      } else {
        const changed = await applySyncResponse(res.data);
        if (changed) {
          logger.info(
            "[mappingUpdater] Mapping database sync completed successfully.",
          );
        } else {
          logger.info("[mappingUpdater] Mapping database is up to date.");
        }
      }
    }
  } catch (err) {
    logger.error(
      `[mappingUpdater] Failed to sync mapping database: ${err.message}`,
    );
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

async function applyDeltaUpdates(updates, latestVersion, storedTag) {
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
          const isUuid =
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(
              item.anime_id,
            );
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
  applyDeltaUpdates,
  syncExtensionMapping,
  cleanupExtensionMapping,
};
