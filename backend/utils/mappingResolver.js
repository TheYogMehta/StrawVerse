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
  title = null,
  year = null,
}) {
  if ((!id && !title) || !global.mappingDb || mediaType === "Movies")
    return null;
  const cleanId = id ? String(id).trim() : null;

  try {
    const providers = await getMappingProviders(mediaType, { installedOnly });
    const isManga = mediaType === "Manga";
    const metaTable = isManga ? "manga" : "anime";

    let matchedProviderTable = null;

    if (provider && provider !== "provider" && provider !== "local source") {
      const cleanProv = String(provider)
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");
      const shortProv = String(provider)
        .toLowerCase()
        .split("/")
        .pop()
        .replace(/[^a-z0-9]/g, "");

      const matchedList = (providers || []).filter((p) => {
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

      if (matchedList.length > 0) {
        matchedProviderTable = matchedList[0].table_name;
      }

      if (cleanId) {
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
    }

    if (cleanId && providers && providers.length > 0) {
      for (const p of providers) {
        try {
          const sql =
            p.table_name === "pahe"
              ? `SELECT malid FROM "${p.table_name}" WHERE id = ? OR uuid = ? LIMIT 1`
              : `SELECT malid FROM "${p.table_name}" WHERE id = ? LIMIT 1`;
          const params =
            p.table_name === "pahe" ? [cleanId, cleanId] : [cleanId];
          const row = await mappingQueryOne(sql, params);
          if (row?.malid) return Number(row.malid);
        } catch (_) {}
      }
    }

    if (title && typeof title === "string" && title.trim()) {
      const cleanTitle = title.trim();
      const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
      const normQuery = norm(cleanTitle);

      let parsedYear = year ? parseInt(year, 10) : null;
      if (!parsedYear) {
        const yMatch = cleanTitle.match(/\b(19\d\d|20\d\d)\b/);
        if (yMatch) parsedYear = parseInt(yMatch[1], 10);
      }

      try {
        const exactRows = await mappingQueryAll(
          `SELECT malid, title ${!isManga ? ", year" : ""} FROM "${metaTable}" WHERE LOWER(title) = LOWER(?)`,
          [cleanTitle],
        );
        if (exactRows && exactRows.length > 0) {
          let chosen = exactRows[0];
          if (exactRows.length > 1 && parsedYear && !isManga) {
            const byYear = exactRows.find(
              (r) => r.year && parseInt(r.year, 10) === parsedYear,
            );
            if (byYear) chosen = byYear;
          }
          if (chosen?.malid) {
            const resolvedMalId = Number(chosen.malid);
            if (matchedProviderTable && cleanId) {
              try {
                global.mappingDb
                  .prepare(
                    `INSERT OR REPLACE INTO "${matchedProviderTable}" (id, malid) VALUES (?, ?)`,
                  )
                  .run(cleanId, resolvedMalId);
              } catch (_) {}
            }
            return resolvedMalId;
          }
        }

        const firstWord = cleanTitle
          .replace(/[^a-zA-Z0-9 ]/g, " ")
          .trim()
          .split(" ")[0];
        if (firstWord && firstWord.length >= 3) {
          const allCandidates = await mappingQueryAll(
            `SELECT malid, title ${!isManga ? ", year" : ""} FROM "${metaTable}" WHERE LOWER(title) LIKE ? LIMIT 50`,
            [`%${firstWord}%`],
          );
          const normMatches = (allCandidates || []).filter(
            (c) => norm(c.title) === normQuery,
          );
          if (normMatches.length > 0) {
            let chosen = normMatches[0];
            if (normMatches.length > 1 && parsedYear && !isManga) {
              const byYear = normMatches.find(
                (r) => r.year && parseInt(r.year, 10) === parsedYear,
              );
              if (byYear) chosen = byYear;
            }
            if (chosen?.malid) {
              const resolvedMalId = Number(chosen.malid);
              if (matchedProviderTable && cleanId) {
                try {
                  global.mappingDb
                    .prepare(
                      `INSERT OR REPLACE INTO "${matchedProviderTable}" (id, malid) VALUES (?, ?)`,
                    )
                    .run(cleanId, resolvedMalId);
                } catch (_) {}
              }
              return resolvedMalId;
            }
          }
        }
      } catch (_) {}

      const targetProviders = installedOnly
        ? providers
        : await getMappingProviders(mediaType, { installedOnly: true });

      const siblingTables = [
        ...new Set(
          (targetProviders && targetProviders.length > 0
            ? targetProviders
            : providers || []
          )
            .map((p) => p.table_name)
            .filter((tbl) => Boolean(tbl) && tbl !== matchedProviderTable),
        ),
      ];

      for (const sib of siblingTables) {
        if (sib === matchedProviderTable) continue;
        try {
          const slug = cleanTitle
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-|-$/g, "");
          const rows = await mappingQueryAll(
            `SELECT malid FROM "${sib}" WHERE id LIKE ? OR id LIKE ? LIMIT 1`,
            [`%${slug}%`, `%${cleanId || slug}%`],
          );
          if (rows && rows.length > 0 && rows[0].malid) {
            const resolvedMalId = Number(rows[0].malid);
            if (matchedProviderTable && cleanId) {
              try {
                global.mappingDb
                  .prepare(
                    `INSERT OR REPLACE INTO "${matchedProviderTable}" (id, malid) VALUES (?, ?)`,
                  )
                  .run(cleanId, resolvedMalId);
              } catch (_) {}
            }
            return resolvedMalId;
          }
        } catch (_) {}
      }
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
