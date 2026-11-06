const { logger } = require("./AppLogger");
const { mappingQueryAll, mappingQueryOne } = require("./db");

let cachedProviderMetadata = null;
let lastProviderMetadataFetch = 0;

function invalidateMappingMetadataCache() {
  cachedProviderMetadata = null;
  lastProviderMetadataFetch = 0;
}

/**
 * Universal Provider Discovery:
 * Dynamically aggregates providers from:
 * 1. Mapping database SQLite tables (discovering any table with an id & malid column)
 * 2. Live registered scraper extensions (global.Anime_providers, global.Manga_providers)
 */
async function getMappingProviders(
  mediaType = null,
  { installedOnly = false } = {},
) {
  const now = Date.now();
  if (!cachedProviderMetadata || now - lastProviderMetadataFetch > 30000) {
    try {
      const providersMap = new Map();

      // 1. Discover physical tables from mapping DB sqlite_master (only tables with a malid column)
      if (global.mappingDb) {
        try {
          const tableRows = await mappingQueryAll(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('unmapped_items', 'provider_metadata', 'anime', 'manga', 'anime_titles', 'manga_titles', 'version_history', 'next_episodes', 'mapping_changelog', 'extension_settings', 'unlinked_mal_ids', 'custom_mappings', 'sync_history')",
          );
          if (tableRows && tableRows.length > 0) {
            for (const t of tableRows) {
              try {
                const cols = await mappingQueryAll(
                  `PRAGMA table_info("${t.name}")`,
                );
                const hasMalId = cols?.some(
                  (c) => (c.name || "").toLowerCase() === "malid",
                );
                if (!hasMalId) continue;
              } catch (_) {
                continue;
              }

              providersMap.set(t.name, {
                table_name: t.name,
                media_type: null,
                display_name: t.name,
              });
            }
          }
        } catch (_) {}
      }

      // 2. Associate with live registered scrapers (media_type and display_name)
      const matchScraper = (tblName) => {
        const cleanTbl = tblName.toLowerCase().replace(/[^a-z0-9]/g, "");
        const shortTbl = tblName
          .toLowerCase()
          .split("/")
          .pop()
          .replace(/[^a-z0-9]/g, "");

        if (global.Anime_providers) {
          for (const [key, scraper] of Object.entries(global.Anime_providers)) {
            const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
            const cleanName = (scraper?.name || "")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            if (
              cleanKey === cleanTbl ||
              cleanName === cleanTbl ||
              cleanKey === shortTbl ||
              cleanName === shortTbl
            ) {
              return {
                media_type: "Anime",
                display_name: scraper?.name || key,
              };
            }
          }
        }
        if (global.Manga_providers) {
          for (const [key, scraper] of Object.entries(global.Manga_providers)) {
            const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
            const cleanName = (scraper?.name || "")
              .toLowerCase()
              .replace(/[^a-z0-9]/g, "");
            if (
              cleanKey === cleanTbl ||
              cleanName === cleanTbl ||
              cleanKey === shortTbl ||
              cleanName === shortTbl
            ) {
              return {
                media_type: "Manga",
                display_name: scraper?.name || key,
              };
            }
          }
        }
        return null;
      };

      for (const [tblName, entry] of providersMap.entries()) {
        const matched = matchScraper(tblName);
        if (matched) {
          entry.media_type = matched.media_type;
          entry.display_name = matched.display_name;
        }
      }

      // 3. Fallback known media types if not matched to active scraper
      const knownAnime = new Set(["pahe", "anikoto", "animesalt"]);
      const knownManga = new Set([
        "weebcentral",
        "asurascans",
        "comix",
        "mangafire",
      ]);
      for (const entry of providersMap.values()) {
        if (!entry.media_type) {
          const short = entry.table_name.toLowerCase().split("/").pop();
          if (knownAnime.has(short)) entry.media_type = "Anime";
          else if (knownManga.has(short)) entry.media_type = "Manga";
        }
      }

      // 4. Also register live scrapers that might not have a table in mapping.db yet
      const addMissingScrapers = (scrapers, type) => {
        if (!scrapers) return;
        for (const [key, scraper] of Object.entries(scrapers)) {
          const cleanKey = key.toLowerCase().replace(/[^a-z0-9]/g, "");
          const cleanName = (scraper?.name || "")
            .toLowerCase()
            .replace(/[^a-z0-9]/g, "");
          const alreadyPresent = Array.from(providersMap.values()).some((p) => {
            const pClean = p.table_name.toLowerCase().replace(/[^a-z0-9]/g, "");
            const pShort = p.table_name
              .toLowerCase()
              .split("/")
              .pop()
              .replace(/[^a-z0-9]/g, "");
            return (
              pClean === cleanKey ||
              pClean === cleanName ||
              pShort === cleanKey ||
              pShort === cleanName
            );
          });
          if (!alreadyPresent) {
            const tblName = scraper?.name || key;
            providersMap.set(tblName, {
              table_name: tblName,
              media_type: type,
              display_name: scraper?.name || key,
            });
          }
        }
      };
      addMissingScrapers(global.Anime_providers, "Anime");
      addMissingScrapers(global.Manga_providers, "Manga");

      if (providersMap.size > 0) {
        cachedProviderMetadata = Array.from(providersMap.values());
        lastProviderMetadataFetch = now;
      }
    } catch (_) {}
  }

  let list = cachedProviderMetadata ? [...cachedProviderMetadata] : [];

  if (mediaType) {
    const targetType = String(mediaType).toLowerCase();
    list = list.filter(
      (p) => !p.media_type || (p.media_type || "").toLowerCase() === targetType,
    );
  }

  if (installedOnly) {
    const installedAnime = new Set(
      Object.keys(global.Anime_providers || {}).map((k) =>
        k.toLowerCase().replace(/[^a-z0-9]/g, ""),
      ),
    );
    const installedManga = new Set(
      Object.keys(global.Manga_providers || {}).map((k) =>
        k.toLowerCase().replace(/[^a-z0-9]/g, ""),
      ),
    );

    list = list.filter((p) => {
      const cleanTbl = (p.table_name || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const shortTbl = (p.table_name || "")
        .toLowerCase()
        .split("/")
        .pop()
        .replace(/[^a-z0-9]/g, "");
      const isAnime = (p.media_type || "").toLowerCase() === "anime";
      const installedSet = isAnime ? installedAnime : installedManga;
      if (installedSet.has(cleanTbl) || installedSet.has(shortTbl)) return true;
      for (const inst of installedSet) {
        if (
          inst === cleanTbl ||
          inst === shortTbl ||
          inst.includes(cleanTbl) ||
          cleanTbl.includes(inst) ||
          inst.includes(shortTbl) ||
          shortTbl.includes(inst)
        ) {
          return true;
        }
      }
      return false;
    });
  }

  return list;
}

async function resolveMalIdFromMapping({
  id,
  provider = null,
  mediaType = null,
  installedOnly = false,
}) {
  if (!id || !global.mappingDb) return null;
  const cleanId = String(id).trim();
  if (!cleanId) return null;

  try {
    const providers = await getMappingProviders(mediaType, { installedOnly });
    if (!providers || providers.length === 0) return null;

    if (provider && provider !== "provider" && provider !== "local source") {
      const cleanProv = String(provider)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const shortProv = String(provider)
        .toLowerCase()
        .split("/")
        .pop()
        .replace(/[^a-z0-9]/g, "");

      const matchedList = providers.filter((p) => {
        const tbl = (p.table_name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const shortTbl = (p.table_name || "")
          .toLowerCase()
          .split("/")
          .pop()
          .replace(/[^a-z0-9]/g, "");
        const dName = (p.display_name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        return (
          tbl === cleanProv ||
          tbl === shortProv ||
          shortTbl === cleanProv ||
          shortTbl === shortProv ||
          tbl.includes(cleanProv) ||
          cleanProv.includes(tbl) ||
          dName === cleanProv ||
          dName === shortProv ||
          dName.includes(cleanProv) ||
          cleanProv.includes(dName)
        );
      });

      for (const matched of matchedList) {
        try {
          const tbl = matched.table_name;
          const sql =
            tbl === "pahe"
              ? `SELECT malid FROM "${tbl}" WHERE id = ? OR uuid = ? LIMIT 1`
              : `SELECT malid FROM "${tbl}" WHERE id = ? LIMIT 1`;
          const params = tbl === "pahe" ? [cleanId, cleanId] : [cleanId];
          const row = await mappingQueryOne(sql, params);
          if (row?.malid) return Number(row.malid);
        } catch (_) {}
      }
    }

    for (const p of providers) {
      try {
        const sql =
          p.table_name === "pahe"
            ? `SELECT malid FROM "${p.table_name}" WHERE id = ? OR uuid = ? LIMIT 1`
            : `SELECT malid FROM "${p.table_name}" WHERE id = ? LIMIT 1`;
        const params = p.table_name === "pahe" ? [cleanId, cleanId] : [cleanId];
        const row = await mappingQueryOne(sql, params);
        if (row?.malid) return Number(row.malid);
      } catch (_) {}
    }
  } catch (err) {
    logger.error(`[mappingResolver] Error resolving MAL ID: ${err.message}`);
  }

  return null;
}

async function getLinkedProvidersForMalId(
  malid,
  mediaType,
  {
    currentProvider = null,
    currentId = null,
    title = "",
    installedOnly = true,
  } = {},
) {
  const linkedMap = {};

  if (
    currentProvider &&
    currentProvider !== "provider" &&
    currentProvider !== "local source" &&
    currentId
  ) {
    linkedMap[currentProvider.toLowerCase()] = {
      id: String(currentId),
      provider: currentProvider,
      title: title || "",
      folder_name: null,
    };
  }

  if (!malid || !global.mappingDb) {
    return Object.values(linkedMap);
  }

  const numMalId = Number(malid);
  if (isNaN(numMalId) || numMalId <= 0) {
    return Object.values(linkedMap);
  }

  try {
    const providers = await getMappingProviders(mediaType, { installedOnly });

    for (const p of providers) {
      const pNameLower = p.table_name.toLowerCase();
      if (linkedMap[pNameLower]) continue;

      const selectCol = p.table_name === "pahe" ? "id, uuid" : "id";
      try {
        const row = await mappingQueryOne(
          `SELECT ${selectCol} FROM "${p.table_name}" WHERE malid = ? LIMIT 1`,
          [numMalId],
        );

        if (row) {
          const resolvedId =
            p.table_name === "pahe" ? row.id || row.uuid : row.id;
          if (resolvedId) {
            linkedMap[pNameLower] = {
              id: String(resolvedId),
              provider: p.table_name,
              title: title || "",
              folder_name: null,
            };
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    logger.error(
      `[mappingResolver] Error fetching linked providers: ${err.message}`,
    );
  }

  return Object.values(linkedMap);
}

async function getBestProviderForMalId(
  malid,
  mediaType,
  preferredProvider = null,
) {
  if (!malid || !global.mappingDb) return null;
  const numMalId = Number(malid);
  if (isNaN(numMalId) || numMalId <= 0) return null;

  try {
    const providers = await getMappingProviders(mediaType, {
      installedOnly: true,
    });
    if (providers.length === 0) return null;

    const prefLower = (preferredProvider || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    if (prefLower) {
      const preferredMeta = providers.find((p) => {
        const tbl = (p.table_name || "")
          .toLowerCase()
          .replace(/[^a-z0-9]/g, "");
        const shortTbl = (p.table_name || "")
          .toLowerCase()
          .split("/")
          .pop()
          .replace(/[^a-z0-9]/g, "");
        return (
          tbl === prefLower ||
          shortTbl === prefLower ||
          tbl.includes(prefLower) ||
          prefLower.includes(tbl)
        );
      });
      if (preferredMeta) {
        const selectCol =
          preferredMeta.table_name === "pahe" ? "id, uuid" : "id";
        try {
          const row = await mappingQueryOne(
            `SELECT ${selectCol} FROM "${preferredMeta.table_name}" WHERE malid = ? LIMIT 1`,
            [numMalId],
          );
          if (row) {
            const resolvedId =
              preferredMeta.table_name === "pahe" ? row.id || row.uuid : row.id;
            if (resolvedId) {
              return {
                id: String(resolvedId),
                provider: preferredMeta.table_name,
              };
            }
          }
        } catch (_) {}
      }
    }

    for (const p of providers) {
      const selectCol = p.table_name === "pahe" ? "id, uuid" : "id";
      try {
        const row = await mappingQueryOne(
          `SELECT ${selectCol} FROM "${p.table_name}" WHERE malid = ? LIMIT 1`,
          [numMalId],
        );
        if (row) {
          const resolvedId =
            p.table_name === "pahe" ? row.id || row.uuid : row.id;
          if (resolvedId) {
            return { id: String(resolvedId), provider: p.table_name };
          }
        }
      } catch (_) {}
    }
  } catch (err) {
    logger.error(
      `[mappingResolver] Error finding best provider: ${err.message}`,
    );
  }

  return null;
}

module.exports = {
  getMappingProviders,
  resolveMalIdFromMapping,
  getLinkedProvidersForMalId,
  getBestProviderForMalId,
  invalidateMappingMetadataCache,
};
