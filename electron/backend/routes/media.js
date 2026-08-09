const express = require("express");
const fs = require("fs");
const path = require("path");
const JSZip = require("jszip");
const { logger } = require("../utils/AppLogger");
const { settingfetch, providerFetch } = require("../utils/settings");
const {
  latestMangas,
  MangaSearch,
  MangaInfo,
  latestAnime,
  animeinfo,
  animesearch,
  fetchEpisode,
  fetchEpisodeSources,
  processServer,
  MangaChapterFetch,
  fetchChapters,
  getProviderOrThrow,
} = require("../utils/AnimeManga");
const {
  getAllMetadata,
  getSourceById,
  FindMapping,
} = require("../utils/Metadata");
const { getKeyValue, queryOne, run } = require("../utils/db");
const ImageCacheManager = require("../utils/ImageCacheManager");
const { getHeaders } = require("../utils/proxyHeaders");
const { MalFetchList } = require("../utils/mal");
const { stripPngHeader } = require("../utils/downloader");

const router = express.Router();

function enrichResultsWithMappingImages(results, AnimeManga) {
  if (!results || !Array.isArray(results) || results.length === 0) {
    return results;
  }

  const isAnime = AnimeManga === "Anime";

  for (const item of results) {
    if (!item) continue;

    const originalScraperImage =
      item.scraper_image || item.image || item.poster || null;
    item.scraper_image = originalScraperImage;

    let malid = item.malid || item.mal_id || item.MalID || null;

    if (!malid && item.id && global.db) {
      try {
        const table = isAnime ? "Anime" : "Manga";
        const row = global.db
          .prepare(`SELECT MalID FROM ${table} WHERE id = ?`)
          .get(item.id);
        if (row && row.MalID) {
          malid = parseInt(row.MalID);
        }
      } catch (_) {}
    }

    if (!malid && item.id && global.mappingDb) {
      try {
        if (isAnime) {
          const row = global.mappingDb
            .prepare(
              `
            WITH resolved AS (
              SELECT malid FROM pahe WHERE uuid = ? OR id = ?
              UNION ALL
              SELECT malid FROM anikoto WHERE id = ?
              UNION ALL
              SELECT malid FROM anineko WHERE id = ?
            )
            SELECT malid FROM resolved WHERE malid IS NOT NULL LIMIT 1
          `,
            )
            .get(item.id, item.id, item.id, item.id);
          if (row && row.malid) {
            malid = parseInt(row.malid);
          }
        } else {
          const row = global.mappingDb
            .prepare(
              `
            WITH resolved AS (
              SELECT malid FROM weebcentral WHERE id = ?
              UNION ALL
              SELECT malid FROM allmanga WHERE id = ?
            )
            SELECT malid FROM resolved WHERE malid IS NOT NULL LIMIT 1
          `,
            )
            .get(item.id, item.id);
          if (row && row.malid) {
            malid = parseInt(row.malid);
          }
        }
      } catch (_) {}
    }

    if (malid) {
      item.malid = malid;
      let remoteImg = null;
      if (global.mappingDb) {
        try {
          const imgRow = global.mappingDb
            .prepare(
              isAnime
                ? "SELECT image_url FROM anime WHERE malid = ?"
                : "SELECT image_url FROM manga WHERE malid = ?",
            )
            .get(malid);
          if (imgRow && imgRow.image_url) {
            remoteImg = imgRow.image_url;
          }
        } catch (_) {}
      }
      if (!remoteImg && global.db) {
        try {
          const listTable = isAnime ? "MyAnimeList" : "MyMangaList";
          const malRow = global.db
            .prepare(`SELECT image FROM ${listTable} WHERE id = ?`)
            .get(String(malid));
          if (malRow) {
            remoteImg = malRow.image;
          }
        } catch (_) {}
      }
      if (remoteImg) {
        item.image_url = remoteImg;
        item.image = remoteImg;
        item.scraper_image = remoteImg;
        if (item.id && global.db) {
          try {
            const table = isAnime ? "Anime" : "Manga";
            global.db
              .prepare(`UPDATE ${table} SET image_url = ? WHERE id = ?`)
              .run(remoteImg, item.id);
          } catch (_) {}
        }
      }
    }
  }

  return results;
}

// Catalog listing endpoint
router.post("/api/list/:AnimeManga/:provider/", async (req, res) => {
  const { AnimeManga, provider } = req.params;
  let filters = {};

  if (req?.body?.filters && typeof req.body.filters === "object") {
    for (const [key, value] of Object.entries(req.body.filters)) {
      if (value != null && value !== "") {
        const num = Number(value);
        filters[key] = !isNaN(num) ? num : value;
      }
    }
  }

  try {
    if (!AnimeManga || !provider) {
      return res.status(400).json({ error: "Missing parameters" });
    }

    const config = await settingfetch();
    let data = null;

    if (AnimeManga === "Anime") {
      if (provider === "local") {
        data = await getAllMetadata(
          "Anime",
          config?.CustomDownloadLocation,
          filters?.page,
          filters?.tag,
        );
      } else if (provider === "provider") {
        const pObj = await getProviderOrThrow("Anime");
        data = await latestAnime(pObj, filters);
        data = { ...data, site: config.Animeprovider };
      } else if (provider === "search") {
        const pObj = await getProviderOrThrow("Anime");
        data = await animesearch(
          pObj,
          req?.query?.query || req?.body?.keyword,
          filters,
        );
        data = { ...data, site: config.Animeprovider };
      } else {
        const pObj = await getProviderOrThrow("Anime", provider);
        const searchKeyword = req?.body?.keyword || req?.query?.query || "";
        if (searchKeyword) {
          data = await animesearch(pObj, searchKeyword, filters);
        } else {
          data = await latestAnime(pObj, filters);
        }
        data = { ...data, site: provider };
      }
    } else if (AnimeManga === "Manga") {
      if (provider === "local") {
        data = await getAllMetadata(
          "Manga",
          config?.CustomDownloadLocation,
          filters?.page,
          filters?.tag,
        );
      } else if (provider === "provider") {
        const pObj = await getProviderOrThrow("Manga");
        data = await latestMangas(pObj, filters?.page);
      } else if (provider === "search") {
        const pObj = await getProviderOrThrow("Manga");
        data = await MangaSearch(
          pObj,
          req?.query?.query || req?.body?.keyword,
          filters?.page,
        );
      } else {
        const pObj = await getProviderOrThrow("Manga", provider);
        const searchKeyword = req?.body?.keyword || req?.query?.query || "";
        if (searchKeyword) {
          data = await MangaSearch(pObj, searchKeyword, filters?.page);
        } else {
          data = await latestMangas(pObj, filters?.page);
        }
      }
    }

    if (!data) throw new Error(`No ${AnimeManga} Found in ${provider}`);

    if (data?.results && data.results.length > 0) {
      try {
        enrichResultsWithMappingImages(data.results, AnimeManga);
      } catch (_) {}

      try {
        const orderKey = `custom_order_${AnimeManga}_${provider}_${filters?.tag || "all"}`;
        const savedOrder = getKeyValue("Settings", orderKey);
        if (savedOrder && Array.isArray(savedOrder) && savedOrder.length > 0) {
          const orderMap = new Map();
          savedOrder.forEach((id, idx) => orderMap.set(id, idx));
          data.results.sort((a, b) => {
            const indexA = orderMap.has(a.id) ? orderMap.get(a.id) : 9999;
            const indexB = orderMap.has(b.id) ? orderMap.get(b.id) : 9999;
            return indexA - indexB;
          });
        }
      } catch (_) {}
    }

    return res.json(data);
  } catch (err) {
    logger.error(
      `Failed To Fetch ${provider} ${AnimeManga} page ${filters?.page}`,
    );
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.json({
      totalPages: 0,
      currentPage: 1,
      hasNextPage: false,
      totalItems: 0,
      results: [],
      error: true,
      message: err.message,
      extension_missing: err?.message?.includes("Missing Provider!"),
    });
  }
});

// Weekly episode schedule
router.get("/api/schedule/weekly", async (req, res) => {
  try {
    const localToday = new Date();
    const todayStart =
      new Date(
        localToday.getFullYear(),
        localToday.getMonth(),
        localToday.getDate(),
        0,
        0,
        0,
      ).getTime() / 1000;
    const yesterdayStart = todayStart - 24 * 3600;
    const limitEnd = todayStart + 7 * 24 * 3600;

    const episodes = global.mappingDb
      .prepare(
        `
        SELECT ne.livechart_id, ne.episode, ne.date, ne.title, ne.image, a.malid
        FROM next_episodes ne
        LEFT JOIN anime a ON ne.livechart_id = a.livechart_id
        WHERE ne.date >= ? AND ne.date <= ?
        GROUP BY ne.livechart_id, DATE(ne.date, 'unixepoch')
        ORDER BY ne.date ASC
      `,
      )
      .all(yesterdayStart, limitEnd);

    res.json({
      results: episodes,
      updating: !!global.livechart_updating,
    });
  } catch (err) {
    logger.error(`Error in /api/schedule/weekly: ${err.message}`);
    res.status(500).json({ error: true, message: err.message });
  }
});

// Fetches Anime / Manga Info
router.post("/api/info/:AnimeManga/:LocalMalProvider", async (req, res) => {
  const { AnimeManga } = req.params;
  let { LocalMalProvider } = req.params;
  let { id } = req.body;

  const data = {
    MalLoggedIn: !!global?.MalLoggedIn,
  };
  let provider = null;

  const setting = await settingfetch();

  try {
    if (!id) throw new Error("ID IS Missing");

    try {
      const AnimeLocalInfo = await FindMapping(
        AnimeManga,
        id,
        null,
        setting.CustomDownloadLocation,
      );
      if (AnimeLocalInfo && AnimeLocalInfo.id) {
        Object.assign(data, AnimeLocalInfo);
        data.genres = AnimeLocalInfo?.genres
          ? AnimeLocalInfo.genres.split(",")
          : [];
        provider = AnimeLocalInfo?.provider;
      } else {
        throw new Error("Metadata not found locally");
      }
    } catch (err) {
      if (LocalMalProvider === "local") {
        let resolvedId = null;
        let resolvedProvider = null;
        let resolvedMalId = null;

        if (global.db && id) {
          try {
            const unlinkedRow = global.db
              .prepare("SELECT malid FROM unlinked_mal_ids WHERE id = ?")
              .get(id);
            if (unlinkedRow && unlinkedRow.malid) {
              resolvedMalId = parseInt(unlinkedRow.malid);
            }
          } catch (_) {}

          if (!resolvedMalId) {
            try {
              const localRow = global.db
                .prepare(
                  `SELECT MalID FROM ${AnimeManga} WHERE id = ? OR folder_name = ? OR LOWER(title) = LOWER(?) LIMIT 1`,
                )
                .get(id, id, id);
              if (localRow && localRow.MalID) {
                resolvedMalId = parseInt(localRow.MalID);
              }
            } catch (_) {}
          }
        }

        if (
          !resolvedMalId &&
          AnimeManga === "Anime" &&
          global.mappingDb &&
          id
        ) {
          try {
            const row = global.mappingDb
              .prepare(
                `
                SELECT malid, 'pahe' AS provider FROM pahe WHERE uuid = ? OR id = ?
                UNION
                SELECT malid, 'anikoto' AS provider FROM anikoto WHERE id = ?
                UNION
                SELECT malid, 'anineko' AS provider FROM anineko WHERE id = ?
                LIMIT 1
              `,
              )
              .get(id, id, id, id);
            if (row) {
              resolvedMalId = row.malid;
              resolvedProvider = row.provider;
              resolvedId = id;
            }
          } catch (err2) {}
        } else if (
          !resolvedMalId &&
          AnimeManga === "Manga" &&
          global.mappingDb &&
          id
        ) {
          try {
            const row = global.mappingDb
              .prepare(
                `
                SELECT malid, 'weebcentral' AS provider FROM weebcentral WHERE id = ?
                UNION
                SELECT malid, 'allmanga' AS provider FROM allmanga WHERE id = ?
                LIMIT 1
              `,
              )
              .get(id, id);
            if (row) {
              resolvedMalId = row.malid;
              resolvedProvider = row.provider;
              resolvedId = id;
            }
          } catch (err2) {}
        }

        if (resolvedMalId) {
          if (AnimeManga === "Anime") {
            const currentAnimeProvider = (
              setting.Animeprovider || "pahe"
            ).toLowerCase();
            if (currentAnimeProvider !== resolvedProvider) {
              try {
                const targetRow = global.mappingDb
                  .prepare(
                    currentAnimeProvider === "pahe"
                      ? "SELECT id, uuid FROM pahe WHERE malid = ? LIMIT 1"
                      : `SELECT id FROM ${currentAnimeProvider} WHERE malid = ? LIMIT 1`,
                  )
                  .get(resolvedMalId);
                if (targetRow) {
                  resolvedId = targetRow.uuid || targetRow.id;
                  resolvedProvider = currentAnimeProvider;
                }
              } catch (err2) {}
            }
          } else if (AnimeManga === "Manga") {
            const currentMangaProvider = (
              setting.Mangaprovider || "weebcentral"
            ).toLowerCase();
            if (currentMangaProvider !== resolvedProvider) {
              try {
                const targetRow = global.mappingDb
                  .prepare(
                    `SELECT id FROM ${currentMangaProvider} WHERE malid = ? LIMIT 1`,
                  )
                  .get(resolvedMalId);
                if (targetRow) {
                  resolvedId = targetRow.id;
                  resolvedProvider = currentMangaProvider;
                }
              } catch (err2) {}
            }
          }
        }

        if (resolvedId && resolvedProvider) {
          resolvedId = String(resolvedId);
          id = resolvedId;
          LocalMalProvider = resolvedProvider;
          provider = resolvedProvider;
          data.id = resolvedId;
          data.provider = resolvedProvider;
          data.malid = resolvedMalId;
        } else {
          throw new Error(`No ${AnimeManga} Found with id '${id}'`);
        }
      } else if (LocalMalProvider === "mal") {
        let resolvedId = null;
        let resolvedProvider = null;
        const targetMalId = Number(id);

        if (AnimeManga === "Anime") {
          const preferred = (setting.Animeprovider || "pahe").toLowerCase();

          let rows = [];
          try {
            if (global.mappingDb) {
              rows = global.mappingDb
                .prepare(
                  `
                SELECT 'pahe' AS provider, id, uuid FROM pahe WHERE malid = ?
                UNION ALL
                SELECT 'anikoto' AS provider, id, NULL AS uuid FROM anikoto WHERE malid = ?
                UNION ALL
                SELECT 'anineko' AS provider, id, NULL AS uuid FROM anineko WHERE malid = ?
              `,
                )
                .all(targetMalId, targetMalId, targetMalId);
            }
          } catch (_) {}

          const match = rows.find((r) => r.provider === preferred) || rows[0];
          if (match) {
            resolvedId = match.uuid || match.id;
            resolvedProvider = match.provider;
          }
        } else if (AnimeManga === "Manga") {
          const preferred = (
            setting.Mangaprovider || "weebcentral"
          ).toLowerCase();

          let rows = [];
          try {
            if (global.mappingDb) {
              rows = global.mappingDb
                .prepare(
                  `
                SELECT 'weebcentral' AS provider, id FROM weebcentral WHERE malid = ?
                UNION ALL
                SELECT 'allmanga' AS provider, id FROM allmanga WHERE malid = ?
              `,
                )
                .all(targetMalId, targetMalId);
            }
          } catch (_) {}

          const match = rows.find((r) => r.provider === preferred) || rows[0];
          if (match) {
            resolvedId = match.id;
            resolvedProvider = match.provider;
          }
        }

        if (resolvedId && resolvedProvider) {
          resolvedId = String(resolvedId);
          id = resolvedId;
          LocalMalProvider = resolvedProvider;
          provider = resolvedProvider;
          data.id = resolvedId;
          data.provider = resolvedProvider;
          data.malid = targetMalId;
        } else {
          throw new Error(
            `This ${AnimeManga.toLowerCase()} is not mapped to any provider yet.`,
          );
        }
      }
    }

    if (
      LocalMalProvider !== "local" ||
      (provider && provider !== "local source")
    ) {
      try {
        if (AnimeManga === "Anime") {
          const Animeprovider = await providerFetch(
            "Anime",
            (LocalMalProvider !== "local" && LocalMalProvider !== "provider"
              ? LocalMalProvider
              : provider) ?? null,
          );
          const lookupId = id;
          let AnimeInfo = null;
          try {
            AnimeInfo = await animeinfo(
              Animeprovider,
              setting?.CustomDownloadLocation,
              lookupId,
              data?.provider ? false : true,
            );
          } catch (fetchErr) {
            logger.warn(
              `Failed to fetch initial online metadata for ${lookupId}: ${fetchErr.message}`,
            );
          }

          if (
            Animeprovider.provider_name === "pahe" &&
            (!AnimeInfo || !AnimeInfo.title || AnimeInfo.results)
          ) {
            if (global?.mappingDb) {
              try {
                let mappingRow = null;
                const cleanOldId = id;
                if (data.malid) {
                  mappingRow = global.mappingDb
                    .prepare(`SELECT id, uuid, malid FROM pahe WHERE malid = ?`)
                    .get(Number(data.malid));
                }
                if (!mappingRow) {
                  mappingRow = global.mappingDb
                    .prepare(
                      `SELECT id, uuid, malid FROM pahe WHERE uuid = ? OR id = ?`,
                    )
                    .get(cleanOldId, cleanOldId);
                }
                if (mappingRow) {
                  const newId = mappingRow.uuid || mappingRow.id;
                  if (newId && newId !== cleanOldId) {
                    AnimeInfo = await animeinfo(
                      Animeprovider,
                      setting?.CustomDownloadLocation,
                      newId,
                      false,
                    );

                    if (AnimeInfo && AnimeInfo?.title) {
                      try {
                        global.db
                          .prepare(
                            "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ?",
                          )
                          .run(cleanOldId, newId, cleanOldId);

                        global.db
                          .prepare(
                            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ?",
                          )
                          .run(cleanOldId, newId, cleanOldId);

                        global.db
                          .prepare(
                            "UPDATE SkipTimes SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ?",
                          )
                          .run(cleanOldId, newId, cleanOldId);

                        try {
                          global.db
                            .prepare(
                              "UPDATE unlinked_mal_ids SET id = REPLACE(id, ?, ?) WHERE id = ?",
                            )
                            .run(cleanOldId, newId, cleanOldId);
                        } catch (_) {}

                        id = newId;
                        data.id = newId;
                        if (mappingRow.malid) {
                          data.malid = Number(mappingRow.malid);
                        }

                        logger.info(
                          `[pahe-resolve] Successfully updated Anime ID from ${cleanOldId} to ${newId}`,
                        );
                      } catch (dbErr) {
                        logger.error(
                          `[pahe-resolve] Failed to update resolved ID in database : ${dbErr.message}`,
                        );
                      }
                    }
                  }
                }
              } catch (err2) {
                logger.error(
                  `[pahe-resolve] Error resolving new animepahe ID: ${err2.message}`,
                );
              }
            }
          }

          if (AnimeInfo) {
            const fieldsToOverwrite = [
              "description",
              "status",
              "genres",
              "aired",
              "image_url",
              "totalEpisodes",
              "nextEpisodeIn",
              "dataId",
            ];
            fieldsToOverwrite.forEach((key) => {
              if (
                AnimeInfo[key] !== undefined &&
                AnimeInfo[key] !== null &&
                AnimeInfo[key] !== ""
              ) {
                data[key] = AnimeInfo[key];
              }
            });

            for (const key in AnimeInfo) {
              if (Object.prototype.hasOwnProperty.call(AnimeInfo, key)) {
                if (
                  data[key] === undefined ||
                  data[key] === null ||
                  data[key] === ""
                ) {
                  data[key] = AnimeInfo[key];
                }
              }
            }

            try {
              global.db
                .prepare(
                  `UPDATE Anime SET description = ?, status = ?, genres = ?, aired = ?, image_url = ?, provider = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                )
                .run(
                  AnimeInfo.description || "",
                  AnimeInfo.status || "",
                  Array.isArray(AnimeInfo.genres)
                    ? AnimeInfo.genres.join(",")
                    : AnimeInfo.genres || "",
                  AnimeInfo.aired || "",
                  AnimeInfo.image_url || AnimeInfo.image || "",
                  Animeprovider.provider_name,
                  id,
                );
            } catch (dbErr) {
              logger.error(
                `Failed to update local metadata for Anime ${id}: ${dbErr.message}`,
              );
            }
          }
          data.provider = Animeprovider.provider_name;
        } else if (AnimeManga === "Manga") {
          const Mangaprovider = await providerFetch(
            "Manga",
            (LocalMalProvider !== "local" && LocalMalProvider !== "provider"
              ? LocalMalProvider
              : provider) ?? null,
          );
          const MangaInfoData = await MangaInfo(Mangaprovider, id);
          if (MangaInfoData) {
            const fieldsToOverwrite = [
              "description",
              "genres",
              "released",
              "author",
              "image_url",
              "totalChapters",
            ];
            fieldsToOverwrite.forEach((key) => {
              if (
                MangaInfoData[key] !== undefined &&
                MangaInfoData[key] !== null &&
                MangaInfoData[key] !== ""
              ) {
                data[key] = MangaInfoData[key];
              }
            });

            for (const key in MangaInfoData) {
              if (Object.prototype.hasOwnProperty.call(MangaInfoData, key)) {
                if (
                  data[key] === undefined ||
                  data[key] === null ||
                  data[key] === ""
                ) {
                  data[key] = MangaInfoData[key];
                }
              }
            }

            try {
              global.db
                .prepare(
                  `UPDATE Manga SET description = ?, genres = ?, released = ?, author = ?, image_url = ?, provider = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
                )
                .run(
                  MangaInfoData.description || "",
                  Array.isArray(MangaInfoData.genres)
                    ? MangaInfoData.genres.join(",")
                    : MangaInfoData.genres || "",
                  MangaInfoData.released || "",
                  MangaInfoData.author || "",
                  MangaInfoData.image_url || MangaInfoData.image || "",
                  Mangaprovider.provider_name,
                  id,
                );
            } catch (dbErr) {
              logger.error(
                `Failed to update local metadata for Manga ${id}: ${dbErr.message}`,
              );
            }
          }
          data.provider = Mangaprovider.provider_name;
        }
      } catch (err) {
        if (data && data.id) {
          logger.warn(
            `Failed to fetch online metadata for ${id} (using cached local data): ${err.message}`,
          );
        } else {
          throw err;
        }
      }
    }

    if (data && global.mappingDb) {
      try {
        const customMappingRow = global.db
          .prepare("SELECT malid FROM unlinked_mal_ids WHERE id = ?")
          .get(id);

        let resolvedMalId = undefined;
        let isCustom = false;

        if (customMappingRow) {
          isCustom = true;
          if (customMappingRow.malid) {
            resolvedMalId = parseInt(customMappingRow.malid);
          } else {
            resolvedMalId = null;
          }
        } else if (data.malid || data.MalID) {
          resolvedMalId = parseInt(data.malid || data.MalID);
        }

        let mappingRow = null;
        if (resolvedMalId !== undefined) {
          if (resolvedMalId !== null) {
            data.malid = resolvedMalId;
            if (isCustom) {
              try {
                global.db
                  .prepare(`UPDATE ${AnimeManga} SET MalID = ? WHERE id = ?`)
                  .run(String(resolvedMalId), id);
              } catch (_) {}
            }

            if (AnimeManga === "Anime") {
              const query = `
                SELECT 
                  ? AS malid,
                  p.uuid AS pahe_uuid,
                  a.id AS anikoto_id,
                  neko.id AS anineko_id,
                  an.livechart_id
                FROM (SELECT ? AS malid) rm
                LEFT JOIN pahe p ON p.malid = rm.malid
                LEFT JOIN anikoto a ON a.malid = rm.malid
                LEFT JOIN anineko neko ON neko.malid = rm.malid
                LEFT JOIN anime an ON an.malid = rm.malid
                LIMIT 1
              `;
              mappingRow = global.mappingDb
                .prepare(query)
                .get(resolvedMalId, resolvedMalId);
            } else {
              const query = `
                SELECT 
                  ? AS malid,
                  w.id AS weebcentral_id,
                  allm.id AS allmanga_id
                FROM (SELECT ? AS malid) rm
                LEFT JOIN weebcentral w ON w.malid = rm.malid
                LEFT JOIN allmanga allm ON allm.malid = rm.malid
                LIMIT 1
              `;
              mappingRow = global.mappingDb
                .prepare(query)
                .get(resolvedMalId, resolvedMalId);
            }
          } else {
            data.malid = null;
            if (isCustom) {
              try {
                global.db
                  .prepare(`UPDATE ${AnimeManga} SET MalID = NULL WHERE id = ?`)
                  .run(id);
              } catch (_) {}
            }
          }
        } else {
          if (global.mappingDb) {
            try {
              let providers = [];
              try {
                providers = global.mappingDb
                  .prepare(
                    "SELECT table_name, media_type, primary_key_field FROM provider_metadata",
                  )
                  .all()
                  .filter(
                    (r) =>
                      r.media_type.toLowerCase() ===
                      (AnimeManga || "").toLowerCase(),
                  );
              } catch (e) {}

              if (providers.length === 0) return;

              const resolvedQueries = providers.map(
                (p) =>
                  `SELECT malid FROM ${p.table_name} WHERE ${p.primary_key_field} = ?`,
              );
              const params = providers.map(() => id);

              const selectCols = [
                "rm.malid",
                ...providers.map(
                  (p) =>
                    `p_${p.table_name}.${p.primary_key_field} AS ${p.table_name}_id`,
                ),
                AnimeManga === "Anime" ? "an.livechart_id" : null,
              ]
                .filter(Boolean)
                .join(", ");

              const leftJoins = [
                ...providers.map(
                  (p) =>
                    `LEFT JOIN ${p.table_name} p_${p.table_name} ON p_${p.table_name}.malid = rm.malid`,
                ),
                AnimeManga === "Anime"
                  ? "LEFT JOIN anime an ON an.malid = rm.malid"
                  : null,
              ]
                .filter(Boolean)
                .join("\n");

              const query = `
                WITH resolved AS (
                  ${resolvedQueries.join("\n UNION ALL \n")}
                )
                SELECT ${selectCols}
                FROM (SELECT malid FROM resolved WHERE malid IS NOT NULL LIMIT 1) rm
                ${leftJoins}
              `;
              mappingRow = global.mappingDb.prepare(query).get(...params);
            } catch (e) {}
          }

          if (mappingRow && mappingRow.malid) {
            data.malid = parseInt(mappingRow.malid);
            try {
              global.db
                .prepare(`UPDATE ${AnimeManga} SET MalID = ? WHERE id = ?`)
                .run(String(data.malid), id);
            } catch (_) {}
          }
        }

        if (mappingRow && mappingRow.malid) {
          try {
            const linkedRecords = global.db
              .prepare(
                `SELECT id, provider, title, folder_name FROM ${AnimeManga} WHERE MalID = ?`,
              )
              .all(String(data.malid));

            const linkedProvidersMap = {};
            linkedRecords.forEach((r) => {
              linkedProvidersMap[r.provider] = {
                id: r.id,
                provider: r.provider,
                title: r.title,
                folder_name: r.folder_name,
              };
            });

            if (AnimeManga === "Anime") {
              if (mappingRow.pahe_uuid && !linkedProvidersMap["pahe"]) {
                linkedProvidersMap["pahe"] = {
                  id: mappingRow.pahe_uuid,
                  provider: "pahe",
                  title: data.title || "",
                  folder_name: null,
                };
              }

              if (mappingRow.anikoto_id && !linkedProvidersMap["anikoto"]) {
                linkedProvidersMap["anikoto"] = {
                  id: mappingRow.anikoto_id,
                  provider: "anikoto",
                  title: data.title || "",
                  folder_name: null,
                };
              }

              if (mappingRow.anineko_id && !linkedProvidersMap["anineko"]) {
                linkedProvidersMap["anineko"] = {
                  id: mappingRow.anineko_id,
                  provider: "anineko",
                  title: data.title || "",
                  folder_name: null,
                };
              }
            } else {
              if (
                mappingRow.weebcentral_id &&
                !linkedProvidersMap["weebcentral"]
              ) {
                linkedProvidersMap["weebcentral"] = {
                  id: mappingRow.weebcentral_id,
                  provider: "weebcentral",
                  title: data.title || "",
                  folder_name: null,
                };
              }

              if (mappingRow.allmanga_id && !linkedProvidersMap["allmanga"]) {
                linkedProvidersMap["allmanga"] = {
                  id: mappingRow.allmanga_id,
                  provider: "allmanga",
                  title: data.title || "",
                  folder_name: null,
                };
              }
            }

            if (
              data.provider &&
              !linkedProvidersMap[data.provider] &&
              data.provider !== "provider" &&
              data.provider !== "local source"
            ) {
              linkedProvidersMap[data.provider] = {
                id: data.id || id,
                provider: data.provider,
                title: data.title || "",
                folder_name: data.folder_name || null,
              };
            }

            data.linkedProviders = Object.values(linkedProvidersMap);
            if (
              (!data.provider || data.provider === "local source") &&
              data.linkedProviders.length > 0
            ) {
              const activep =
                data.linkedProviders.find(
                  (p) => p.provider && p.provider !== "local source",
                ) || data.linkedProviders[0];
              if (activep) {
                data.provider = activep.provider;
                data.id = activep.id;
              }
            }
          } catch (e) {}

          if (AnimeManga === "Anime") {
            try {
              if (mappingRow.livechart_id) {
                const livechartId = mappingRow.livechart_id;
                const now = Math.floor(Date.now() / 1000);

                let watchedEpisodes = 0;
                try {
                  const watchedRow = global.db
                    .prepare(
                      "SELECT MAX(episode_number) AS watched_episodes FROM WatchHistory WHERE anime_id = ?",
                    )
                    .get(id);
                  if (watchedRow && watchedRow.watched_episodes) {
                    watchedEpisodes = watchedRow.watched_episodes;
                  }
                } catch (_) {}

                const localToday = new Date();
                const localTodayStart =
                  new Date(
                    localToday.getFullYear(),
                    localToday.getMonth(),
                    localToday.getDate(),
                    0,
                    0,
                    0,
                  ).getTime() / 1000;
                const localYesterdayStart = localTodayStart - 24 * 3600;

                const airedEp = global.mappingDb
                  .prepare(
                    `
                    SELECT episode, date FROM next_episodes 
                    WHERE livechart_id = ? AND date <= ? 
                    ORDER BY date DESC LIMIT 1
                  `,
                  )
                  .get(livechartId, now);

                const upcomingEp = global.mappingDb
                  .prepare(
                    `
                    SELECT episode, date FROM next_episodes 
                    WHERE livechart_id = ? AND date > ? 
                    ORDER BY date ASC LIMIT 1
                  `,
                  )
                  .get(livechartId, now);

                let nextEp = upcomingEp;
                let showAired = false;
                if (
                  airedEp &&
                  airedEp.date >= localYesterdayStart &&
                  watchedEpisodes < airedEp.episode
                ) {
                  nextEp = airedEp;
                  showAired = true;
                }

                if (nextEp) {
                  if (showAired) {
                    data.nextEpisodeIn = `Ep ${nextEp.episode}: Aired`;
                  } else {
                    const diff = nextEp.date - now;
                    const minutes = Math.ceil(diff / 60);
                    const hours = Math.ceil(diff / 3600);
                    const days = Math.ceil(diff / (24 * 3600));

                    if (days > 0) {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: ${days} day${days > 1 ? "s" : ""}`;
                    } else if (hours > 0) {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: ${hours} hr${hours > 1 ? "s" : ""}`;
                    } else if (minutes > 0) {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: ${minutes} min${minutes > 1 ? "s" : ""}`;
                    } else {
                      data.nextEpisodeIn = `Ep ${nextEp.episode}: soon`;
                    }
                  }
                }
              }
            } catch (_) {}
          }
        }
      } catch (mappingErr) {
        logger.error(`Error querying mappingDb: ${mappingErr.message}`);
      }
    }

    if (data.malid && global.MalLoggedIn) {
      try {
        if (AnimeManga === "Anime") {
          const MalInfo = global.db
            .prepare("SELECT * FROM MyAnimeList WHERE id = ?")
            .get(String(data.malid));
          if (MalInfo) {
            data.watched = MalInfo.watched ?? 0;
            data.malStatus = MalInfo.status ?? "watching";
            if (MalInfo.totalEpisodes > 0) {
              data.totalEpisodes = MalInfo.totalEpisodes;
            }
          }
        } else if (AnimeManga === "Manga") {
          const MalInfo = global.db
            .prepare("SELECT * FROM MyMangaList WHERE id = ?")
            .get(String(data.malid));
          if (MalInfo) {
            data.watched = MalInfo.read ?? 0;
            data.malStatus = MalInfo.status ?? "plan_to_read";
            if (MalInfo.totalChapters > 0) {
              data.totalChapters = MalInfo.totalChapters;
            }
          }
        }
      } catch (malDbErr) {
        logger.error(
          `Failed to load MAL list stats for resolved malid ${data.malid}: ${malDbErr.message}`,
        );
      }
    }

    try {
      let tagRow = null;
      if (AnimeManga === "Anime") {
        tagRow = global.db
          .prepare(
            `SELECT CustomTag FROM Anime WHERE id = ? OR folder_name = ?`,
          )
          .get(id, id);
      } else {
        tagRow = global.db
          .prepare(
            `SELECT CustomTag FROM Manga WHERE id = ? OR folder_name = ?`,
          )
          .get(id, id);
      }

      const targetMalId = data?.malid || data?.MalID;
      if (!tagRow?.CustomTag && targetMalId) {
        const malRow = global.db
          .prepare(
            `SELECT CustomTag FROM ${AnimeManga} WHERE MalID = ? AND CustomTag IS NOT NULL AND CustomTag != ''`,
          )
          .get(String(targetMalId));
        if (malRow && malRow.CustomTag) {
          tagRow = malRow;
        }
      }

      if (tagRow && tagRow.CustomTag) {
        data.CustomTag = tagRow.CustomTag;
      }
    } catch (tagDbErr) {
      logger.error(`Failed to load CustomTag for ${id}: ${tagDbErr.message}`);
    }

    if (data) {
      const originalScraperImage =
        data.scraper_image || data.image || data.poster || null;
      data.scraper_image = originalScraperImage;

      if (data.malid) {
        try {
          let remoteImg = null;
          if (global.mappingDb && AnimeManga === "Anime") {
            const imgRow = global.mappingDb
              .prepare("SELECT image_url FROM anime WHERE malid = ?")
              .get(Number(data.malid));
            if (imgRow && imgRow.image_url) {
              remoteImg = imgRow.image_url;
            }
          }
          if (!remoteImg) {
            const listTable =
              AnimeManga === "Anime" ? "MyAnimeList" : "MyMangaList";
            const malRow = global.db
              .prepare(
                `SELECT image, main_picture FROM ${listTable} WHERE id = ?`,
              )
              .get(String(data.malid));
            if (malRow) {
              remoteImg = malRow.image || malRow.main_picture;
            }
          }
          if (remoteImg) {
            data.image_url = remoteImg;
            data.image = remoteImg;
            data.scraper_image = remoteImg;
            try {
              global.db
                .prepare(`UPDATE ${AnimeManga} SET image_url = ? WHERE id = ?`)
                .run(remoteImg, id);
            } catch (_) {}
          }
        } catch (_) {}

        const isCjkTitle = (t) => t && !/[a-zA-Z]/.test(t);
        if (
          !data.title ||
          data.title.startsWith("MAL ") ||
          isCjkTitle(data.title)
        ) {
          try {
            const titleRes = await fetch(
              `https://strawverse.theyogmehta.online/api/title/${AnimeManga}/${data.malid}`,
            );
            if (titleRes.ok) {
              const tData = await titleRes.json();
              if (tData && tData.title) {
                data.title = tData.title;
                try {
                  global.db
                    .prepare(`UPDATE ${AnimeManga} SET title = ? WHERE id = ?`)
                    .run(data.title, id);
                } catch (_) {}
              }
            }
          } catch (_) {}
        }
      }
    }

    if (!data?.id) throw new Error(`No ${AnimeManga} Found with id '${id}'`);
    return res.json(data);
  } catch (err) {
    logger.error(
      `Failed To Fetch ${LocalMalProvider} ${AnimeManga} with AnimeID : '${id}'`,
    );
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    let localTag = data?.CustomTag || "";
    if (!localTag) {
      try {
        const row = global.db
          .prepare(`SELECT CustomTag FROM ${AnimeManga} WHERE id = ?`)
          .get(id);
        if (row) localTag = row.CustomTag || "";
      } catch (_) {}
    }
    return res.json({
      error: true,
      message: err?.message,
      CustomTag: localTag,
    });
  }
});

// Fetches Anime Episodes or Manga Chapters
router.post("/api/info/items", async (req, res) => {
  let { id, page, provider, type } = req.body;
  page = parseInt(page ?? 1);
  const isAnime = type === "Anime";
  const fetchFunction = isAnime ? fetchEpisode : fetchChapters;
  const errorName = isAnime ? "Episodes" : "Chapters";

  try {
    if (isNaN(page)) throw new Error(`invalid Page '${page}'`);
    if (!id) throw new Error("ID is Missing");

    if (provider !== "local source") {
      const providerObj = await providerFetch(type, provider ?? null);
      const data = await fetchFunction(providerObj, id, page);
      if (!data) throw new Error(`No ${errorName} Found`);
      if (data.hasNextPage === undefined && data.totalPages !== undefined) {
        data.hasNextPage = page < data.totalPages;
      }

      return res.json(data);
    } else {
      return res.json({});
    }
  } catch (err) {
    logger.error(`Error Fetching '${id}' ${errorName} page : ${page}:`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return res.json({ error: true, message: err?.message });
  }
});

// Play Video From m3u8 url
router.post("/api/watch", async (req, res) => {
  const { ep, epNum, Downloaded, provider = null, subdub } = req.body;
  try {
    if (!Downloaded) {
      if (!ep) throw new Error("Episode ID Not Found");
      const Animeprovider = await providerFetch("Anime", provider);
      let sourcesArray = await fetchEpisodeSources(Animeprovider, ep, subdub);

      if (!sourcesArray) {
        sourcesArray = { sources: [], subtitles: [] };
      }

      const prefSubDub = (subdub || "sub").toLowerCase();
      let rawSources = Array.isArray(sourcesArray.sources)
        ? sourcesArray.sources
        : Array.isArray(sourcesArray[prefSubDub]?.sources)
          ? sourcesArray[prefSubDub].sources
          : Array.isArray(sourcesArray[prefSubDub])
            ? sourcesArray[prefSubDub]
            : [];

      let rawSubtitles =
        prefSubDub === "hsub"
          ? []
          : Array.isArray(sourcesArray.subtitles)
            ? sourcesArray.subtitles
            : Array.isArray(sourcesArray[prefSubDub]?.subtitles)
              ? sourcesArray[prefSubDub].subtitles
              : [];

      const formatSubtitleLabel = (sub) => {
        return sub?.lang || sub?.label || sub?.name || "";
      };

      const formattedSubtitles = rawSubtitles.map((s, idx) => ({
        ...s,
        lang: formatSubtitleLabel(s, idx),
        label: formatSubtitleLabel(s, idx),
      }));

      const cleanSources = rawSources.map((s) => {
        if (!s) return s;
        const { subtitles: _sub, ...sourceWithoutSubtitles } = s;
        return sourceWithoutSubtitles;
      });

      res.status(200).json({
        sources: cleanSources,
        subtitles: formattedSubtitles,
      });
    } else {
      if (!epNum) throw new Error("Episode Number Not Found");
      if (!ep) throw new Error("Anime ID Not Found");

      const config = await settingfetch();

      let videoData = {
        sources: [],
        subtitles: [],
        intro: null,
      };

      const SourcesData = await getSourceById(
        "Anime",
        config?.CustomDownloadLocation,
        ep,
        epNum,
        subdub,
      );

      if (SourcesData?.filepath) {
        videoData.sources.push({
          url: `/video?path=${encodeURIComponent(SourcesData?.filepath)}`,
          quality: "HD",
          server: "Local",
          provider: "Local",
        });
      }

      if (SourcesData?.subtitleFiles?.length > 0) {
        videoData.subtitles = SourcesData?.subtitleFiles;
      }

      if (SourcesData?.skipTimes) {
        videoData.skipTimes = SourcesData.skipTimes;
      }

      res.status(200).json(videoData);
    }
  } catch (err) {
    logger.error(`Error Fetching M3U8 Playlist`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(200).json({
      sources: [],
    });
  }
});

// Resolve specific server stream on demand (lazy loading)
router.post("/api/watch/server", async (req, res) => {
  const { provider = null, server } = req.body;
  try {
    if (!server) throw new Error("Server payload missing");
    const Animeprovider = await providerFetch("Anime", provider);
    const resolved = await processServer(Animeprovider, server);
    if (!resolved) {
      return res.json({ error: true, message: "Failed to resolve server" });
    }
    const { subtitles: _sub, ...cleanResolved } = resolved;
    res.status(200).json(cleanResolved);
  } catch (err) {
    logger.error(`Error resolving server stream: ${err.message}`);
    res.status(500).json({ error: true, message: err.message });
  }
});

// Play Video From Local Source
router.get("/video", (req, res) => {
  const filePath = req.query.path;
  if (!filePath) return res.status(400).send("No file path provided");

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Accept-Ranges", "bytes");

  if (!fs.existsSync(filePath)) {
    return res.status(404).send("File not found");
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  let contentType = "video/mp4";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".webm") contentType = "video/webm";
  else if (ext === ".mkv") contentType = "video/x-matroska";
  else if (ext === ".avi") contentType = "video/x-msvideo";
  else if (ext === ".mov") contentType = "video/quicktime";
  else if (ext === ".ts") contentType = "video/mp2t";

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize) {
      res.status(416).send("Requested range not satisfiable");
      return;
    }

    const chunkSize = end - start + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": contentType,
    });

    if (req.method === "HEAD") {
      return res.end();
    }
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    });

    if (req.method === "HEAD") {
      return res.end();
    }
    fs.createReadStream(filePath).pipe(res);
  }
});

// Serve Local Subtitles
router.get("/subtitles", (req, res) => {
  try {
    let subtitlePath = req.query.file;
    if (!subtitlePath) {
      return res.status(400).json({ error: "Subtitle file path required" });
    }

    subtitlePath = decodeURIComponent(subtitlePath);

    if (!fs.existsSync(subtitlePath)) {
      return res.status(404).json({ error: "Subtitle file not found" });
    }

    const ext = path.extname(subtitlePath);
    const mimeType = ext === ".srt" ? "application/x-subrip" : "text/vtt";
    res.setHeader("Content-Type", mimeType);
    return res.sendFile(subtitlePath, { dotfiles: "allow" });
  } catch (err) {
    console.error("Error serving subtitle:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Fetch Manga Chapter
router.post("/api/read", async (req, res) => {
  const { chapterID, Downloaded = false, MangaID, provider = null } = req.body;
  try {
    if (!chapterID) throw new Error("Chapter ID is missing");

    let isLocal = Downloaded;
    let SourcesData = null;
    const config = await settingfetch();

    if (MangaID) {
      try {
        SourcesData = await getSourceById(
          "Manga",
          config?.CustomDownloadLocation,
          MangaID,
          chapterID,
        );
        if (SourcesData?.filepath && fs.existsSync(SourcesData.filepath)) {
          isLocal = true;
        }
      } catch (e) {}
    }

    if (isLocal) {
      if (!SourcesData) {
        if (!MangaID) throw new Error("Manga ID is missing");
        SourcesData = await getSourceById(
          "Manga",
          config?.CustomDownloadLocation,
          MangaID,
          chapterID,
        );
      }

      if (SourcesData?.filepath) {
        const zipData = fs.readFileSync(SourcesData.filepath);
        const zip = await JSZip.loadAsync(zipData);

        const pages = await Promise.all(
          Object.keys(zip.files)
            .filter((file) => file.match(/^\d+\./))
            .sort((a, b) => parseInt(a) - parseInt(b))
            .map(async (file) => ({
              page: parseInt(file),
              img: `data:image/jpeg;base64,${await zip
                .file(file)
                .async("base64")}`,
            })),
        );
        res.json(pages);
      } else {
        throw new Error("Chapter Not Found In Downloads!");
      }
    } else {
      const providerObj = await providerFetch("Manga", provider);
      const chapters = await MangaChapterFetch(providerObj, chapterID);
      return res.status(200).json(chapters);
    }
  } catch (err) {
    logger.error(`Failed To Fetch Manga Chapters`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(200).json([]);
  }
});

// Proxy for Images
router.get("/api/image", async (req, res) => {
  let decodedUrl = "";
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send("Missing image url");
    }

    decodedUrl = decodeURIComponent(imageUrl);

    if (decodedUrl.startsWith("file://") || decodedUrl.startsWith("/")) {
      const filePath = decodedUrl.startsWith("file://")
        ? decodedUrl.slice(7)
        : decodedUrl;
      if (fs.existsSync(filePath)) {
        res.setHeader("Content-Type", "image/jpeg");
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(filePath, { dotfiles: "allow" });
      } else {
        return res.status(404).send("Local file not found");
      }
    }

    try {
      const cached = queryOne("SELECT filename FROM ImageCache WHERE url = ?", [
        decodedUrl,
      ]);
      const cacheDir = ImageCacheManager.getImageCacheDir();
      if (
        cached &&
        cached.filename &&
        fs.existsSync(path.join(cacheDir, cached.filename))
      ) {
        run("UPDATE ImageCache SET last_accessed = ? WHERE url = ?", [
          Date.now(),
          decodedUrl,
        ]);

        let contentType = "image/jpeg";
        if (cached.filename.endsWith(".png")) contentType = "image/png";
        else if (cached.filename.endsWith(".gif")) contentType = "image/gif";
        else if (cached.filename.endsWith(".webp")) contentType = "image/webp";

        res.setHeader("Content-Type", contentType);
        res.setHeader("Cache-Control", "public, max-age=86400");
        return res.sendFile(path.join(cacheDir, cached.filename), {
          dotfiles: "allow",
        });
      }
    } catch (cacheErr) {
      logger.error("Error reading from image cache: " + cacheErr.message);
    }

    let imageBuffer = null;
    let contentType = "image/jpeg";

    try {
      const resolvedHeaders = getHeaders(decodedUrl);
      const options = {
        responseType: "arraybuffer",
        headers: {
          ...(resolvedHeaders.Referer
            ? { Referer: resolvedHeaders.Referer }
            : {}),
          ...(resolvedHeaders["User-Agent"]
            ? { "User-Agent": resolvedHeaders["User-Agent"] }
            : {}),
          ...(resolvedHeaders.Cookie ? { Cookie: resolvedHeaders.Cookie } : {}),
        },
      };
      const response = await global.axios.get(decodedUrl, options);
      imageBuffer = Buffer.from(response.data);
      contentType = response.headers["content-type"] || "image/jpeg";
    } catch (err) {
      if (global.scrapperFetchDataUrl) {
        try {
          const dataUrl = await global.scrapperFetchDataUrl(decodedUrl);
          if (dataUrl && dataUrl.startsWith("data:")) {
            const matches = dataUrl.match(
              /^data:(image\/[a-zA-Z0-9+-]+);base64,(.+)$/,
            );
            if (matches) {
              contentType = matches[1];
              imageBuffer = Buffer.from(matches[2], "base64");
            }
          }
        } catch (scrapperErr) {
          console.error(
            "scrapperFetchDataUrl failed for image:",
            scrapperErr.message,
          );
        }
      }
    }

    if (imageBuffer) {
      try {
        ImageCacheManager.cacheImage(decodedUrl, imageBuffer).catch(() => {});
      } catch (_) {}

      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(imageBuffer);
    }
    res.status(500).send("Failed to load image");
  } catch (err) {
    console.error("Image proxy fetch failed:", err.message);
    res.status(500).send("Failed to load image");
  }
});

// Proxy for m3u8 playlist
router.get("/api/stream/m3u8", async (req, res) => {
  const url = req.query.url;
  const customReferer = req.query.referer;
  if (!url) return res.status(400).send("No URL");
  try {
    if (customReferer && global.setDynamicReferer) {
      global.setDynamicReferer(url, customReferer);
    }
    const port = global.PORT || 3000;
    const reqHeaders = getHeaders(url);
    if (customReferer) {
      reqHeaders.Referer = customReferer;
    }
    let data;
    try {
      const resp = await global.axios.get(url, {
        headers: reqHeaders,
        responseType: "text",
        timeout: 15000,
      });
      data = resp.data;
    } catch (fetchErr) {
      if (
        fetchErr.response &&
        (fetchErr.response.status === 403 ||
          fetchErr.response.status === 503) &&
        global.cloudflarebypass
      ) {
        try {
          await global.cloudflarebypass(url, true);
          const freshHeaders = getHeaders(url);
          if (customReferer) freshHeaders.Referer = customReferer;
          const retry = await global.axios.get(url, {
            headers: freshHeaders,
            responseType: "text",
            timeout: 15000,
          });
          data = retry.data;
        } catch (bypassErr) {
          throw bypassErr;
        }
      } else {
        throw fetchErr;
      }
    }
    const base = url.substring(0, url.lastIndexOf("/") + 1);
    const refParam = customReferer
      ? `&referer=${encodeURIComponent(customReferer)}`
      : "";
    const segProxy = `http://127.0.0.1:${port}/api/stream/segment?url=`;
    const m3u8Proxy = `http://127.0.0.1:${port}/api/stream/m3u8?url=`;

    const manifest = String(data)
      .split("\n")
      .map((line) => {
        const t = line.trim();
        if (!t) return line;
        if (t.startsWith("#")) {
          return t.includes('URI="')
            ? t.replace(/URI="([^"]+)"/, (_, u) => {
                const abs = u.startsWith("http") ? u : base + u;
                const proxy = abs.includes(".m3u8") ? m3u8Proxy : segProxy;
                return `URI="${proxy}${encodeURIComponent(abs)}${refParam}"`;
              })
            : line;
        }
        const abs = t.startsWith("http") ? t : base + t;
        const proxy = abs.includes(".m3u8") ? m3u8Proxy : segProxy;
        return `${proxy}${encodeURIComponent(abs)}${refParam}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(manifest);
  } catch (err) {
    logger.error(`[StreamProxy] m3u8 error: ${err.message}`);
    res.status(502).send(err.message);
  }
});

// Proxy for m3u8 video segment & video streams
router.get("/api/stream/segment", async (req, res) => {
  const url = req.query.url;
  const customReferer = req.query.referer;
  if (!url) return res.status(400).send("No URL");
  try {
    if (customReferer && global.setDynamicReferer) {
      global.setDynamicReferer(url, customReferer);
    }
    const reqHeaders = getHeaders(url);
    if (customReferer) {
      reqHeaders.Referer = customReferer;
    }
    if (req.headers.range) {
      reqHeaders.range = req.headers.range;
    }

    let attempts = 0;
    let resp;
    while (attempts < 4) {
      try {
        resp = await global.axios.get(url, {
          headers: reqHeaders,
          responseType: "stream",
          timeout: 30000,
        });
        break;
      } catch (err) {
        attempts++;
        const status = err.response?.status;
        if (status === 429 && attempts < 4) {
          const delay = Math.min(6000, 1500 * Math.pow(2, attempts - 1));
          await new Promise((r) => setTimeout(r, delay));
        } else if (
          (status === 403 || status === 503) &&
          attempts < 4 &&
          global.cloudflarebypass
        ) {
          try {
            await global.cloudflarebypass(url, true);
            const fresh = getHeaders(url);
            if (customReferer) fresh.Referer = customReferer;
            if (req.headers.range) fresh.range = req.headers.range;
            Object.assign(reqHeaders, fresh);
          } catch (_) {}
        } else if (attempts >= 4) {
          throw err;
        }
      }
    }

    // Buffer the response to strip fake PNG headers that some servers
    // prepend to video segments as an anti-scraping measure.
    // Without this, MPV/FFmpeg detects segments as PNG images and fails.
    const chunks = [];
    if (resp.data && typeof resp.data.pipe === "function") {
      await new Promise((resolve, reject) => {
        resp.data.on("data", (chunk) => chunks.push(chunk));
        resp.data.on("end", resolve);
        resp.data.on("error", reject);
      });
    } else {
      chunks.push(Buffer.isBuffer(resp.data) ? resp.data : Buffer.from(resp.data));
    }
    const rawBuffer = Buffer.concat(chunks);
    const cleanBuffer = stripPngHeader(rawBuffer);

    res.status(resp.status || 200);
    const forwardHeaders = [
      "content-type",
      "content-range",
      "accept-ranges",
    ];
    forwardHeaders.forEach((h) => {
      if (resp.headers[h]) {
        res.setHeader(h, resp.headers[h]);
      }
    });
    // Set correct content-length after stripping PNG header
    res.setHeader("content-length", cleanBuffer.length);
    // Override content-type to avoid the client seeing image/png
    if (url.includes(".ts") || url.includes("segment") || url.includes("seg")) {
      res.setHeader("content-type", "video/mp2t");
    }
    res.send(cleanBuffer);
  } catch (err) {
    logger.error(`[StreamProxy] segment error: ${err.message}`);
    if (!res.headersSent) {
      res.status(502).send(err.message);
    }
  }
});

router.post("/api/mapping/link-item", async (req, res) => {
  try {
    const { oldId, malId, type, title, image } = req.body;
    const itemType = type || "Anime";
    const malIdStr = malId ? String(malId) : null;

    if (!malIdStr && !oldId) {
      return res.status(400).json({ error: "Missing malId or oldId" });
    }

    let resolvedProviderId = null;
    let resolvedMalId = malIdStr;

    if (global.mappingDb && malIdStr) {
      try {
        const numMalId = Number(malIdStr);
        const querySql =
          itemType === "Anime"
            ? `
              SELECT COALESCE(uuid, id) AS targetId FROM pahe WHERE malid = ?
              UNION ALL
              SELECT id AS targetId FROM anikoto WHERE malid = ?
              UNION ALL
              SELECT id AS targetId FROM anineko WHERE malid = ?
              LIMIT 1
            `
            : `
              SELECT id AS targetId FROM weebcentral WHERE malid = ?
              UNION ALL
              SELECT id AS targetId FROM asurascans WHERE malid = ?
              UNION ALL
              SELECT id AS targetId FROM mangafire WHERE malid = ?
              UNION ALL
              SELECT id AS targetId FROM comix WHERE malid = ?
              LIMIT 1
            `;

        const row = global.mappingDb
          .prepare(querySql)
          .get(
            ...(itemType === "Anime"
              ? [numMalId, numMalId, numMalId]
              : [numMalId, numMalId, numMalId, numMalId]),
          );

        if (row && row.targetId) {
          resolvedProviderId = row.targetId;
        }
      } catch (err) {
        logger.error(`Error querying mappingDb for link-item: ${err.message}`);
      }
    }

    const finalId = resolvedProviderId || oldId || malIdStr;

    if (resolvedMalId) {
      const isCjkTitle = (t) => t && !/[a-zA-Z]/.test(t);
      if (!title || isCjkTitle(title)) {
        try {
          const titleRes = await fetch(
            `https://strawverse.theyogmehta.online/api/title/${itemType}/${resolvedMalId}`,
          );
          if (titleRes.ok) {
            const tData = await titleRes.json();
            if (tData && tData.title) {
              title = tData.title;
            }
          }
        } catch (_) {}
      }

      if (!image && global.mappingDb) {
        try {
          const imgRow = global.mappingDb
            .prepare(
              itemType === "Anime"
                ? "SELECT image_url FROM anime WHERE malid = ?"
                : "SELECT image_url FROM manga WHERE malid = ?",
            )
            .get(Number(resolvedMalId));
          if (imgRow && imgRow.image_url) {
            image = imgRow.image_url;
          }
        } catch (_) {}
      }
    }

    const sanitizeFolderName = (t) =>
      t ? t.replace(/[^a-zA-Z0-9 _-]/g, "").trim() : "";
    const cleanFolder = sanitizeFolderName(title || oldId || finalId);

    const existing = global.db
      .prepare(`SELECT * FROM ${itemType} WHERE id = ? OR id = ?`)
      .get(finalId, oldId);

    if (existing) {
      global.db
        .prepare(
          `UPDATE ${itemType} SET id = ?, MalID = ?, title = COALESCE(NULLIF(?, ''), title), image_url = COALESCE(NULLIF(?, ''), image_url), folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id = ?`,
        )
        .run(
          finalId,
          resolvedMalId || existing.MalID || "",
          title || existing.title || "",
          image || existing.image_url || "",
          cleanFolder,
          oldId || finalId,
          finalId,
        );
    } else {
      global.db
        .prepare(
          `INSERT OR REPLACE INTO ${itemType} (id, title, image_url, folder_name, MalID, CustomTag) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          finalId,
          title || finalId,
          image || "",
          cleanFolder,
          resolvedMalId || "",
          JSON.stringify(["downloads"]),
        );
    }

    if (oldId && oldId !== finalId) {
      try {
        if (itemType === "Anime") {
          global.db
            .prepare("UPDATE WatchHistory SET anime_id = ? WHERE anime_id = ?")
            .run(finalId, oldId);
          global.db
            .prepare("UPDATE SkipTimes SET anime_id = ? WHERE anime_id = ?")
            .run(finalId, oldId);
        } else {
          global.db
            .prepare("UPDATE ReadHistory SET manga_id = ? WHERE manga_id = ?")
            .run(finalId, oldId);
        }
      } catch (_) {}
    }

    return res.json({ success: true, newId: finalId });
  } catch (err) {
    logger.error(`Failed to link item: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Dedicated route for linking local downloaded entries to provider mappings
router.post("/api/local/link-mapping", async (req, res) => {
  try {
    let { oldId, malId, type, title, image } = req.body;
    const itemType = type || "Anime";
    const malIdStr = malId ? String(malId) : null;

    if (!malIdStr && !oldId) {
      return res.status(400).json({ error: "Missing malId or oldId" });
    }

    const numMalId = Number(malIdStr);
    let mappingRow = null;
    let selectedProvider = itemType === "Anime" ? "pahe" : "weebcentral";
    let resolvedProviderId = null;

    if (global.mappingDb && numMalId) {
      try {
        if (itemType === "Anime") {
          mappingRow = global.mappingDb
            .prepare(
              `
              SELECT 
                p.uuid AS pahe_uuid,
                p.id AS pahe_id,
                a.id AS anikoto_id,
                neko.id AS anineko_id,
                an.livechart_id
              FROM (SELECT ? AS malid) rm
              LEFT JOIN pahe p ON p.malid = rm.malid
              LEFT JOIN anikoto a ON a.malid = rm.malid
              LEFT JOIN anineko neko ON neko.malid = rm.malid
              LEFT JOIN anime an ON an.malid = rm.malid
              LIMIT 1
            `,
            )
            .get(numMalId, numMalId);

          if (mappingRow) {
            if (mappingRow.pahe_uuid) {
              selectedProvider = "pahe";
              resolvedProviderId = mappingRow.pahe_uuid;
            } else if (mappingRow.anikoto_id) {
              selectedProvider = "anikoto";
              resolvedProviderId = mappingRow.anikoto_id;
            } else if (mappingRow.anineko_id) {
              selectedProvider = "anineko";
              resolvedProviderId = mappingRow.anineko_id;
            }
          }
        } else {
          mappingRow = global.mappingDb
            .prepare(
              `
              SELECT 
                w.id AS weebcentral_id,
                m.id AS allmanga_id
              FROM (SELECT ? AS malid) rm
              LEFT JOIN weebcentral w ON w.malid = rm.malid
              LEFT JOIN allmanga m ON m.malid = rm.malid
              LIMIT 1
            `,
            )
            .get(numMalId, numMalId);

          if (mappingRow) {
            if (mappingRow.weebcentral_id) {
              selectedProvider = "weebcentral";
              resolvedProviderId = mappingRow.weebcentral_id;
            } else if (mappingRow.allmanga_id) {
              selectedProvider = "allmanga";
              resolvedProviderId = mappingRow.allmanga_id;
            }
          }
        }
      } catch (err) {
        logger.error(
          `Error querying mappingDb for local link-mapping: ${err.message}`,
        );
      }
    }

    const finalId = resolvedProviderId || oldId || malIdStr;

    if (numMalId) {
      const isCjkTitle = (t) => t && !/[a-zA-Z]/.test(t);
      if (!title || isCjkTitle(title)) {
        try {
          const titleRes = await fetch(
            `https://strawverse.theyogmehta.online/api/title/${itemType}/${numMalId}`,
          );
          if (titleRes.ok) {
            const tData = await titleRes.json();
            if (tData && tData.title) {
              title = tData.title;
            }
          }
        } catch (_) {}
      }

      if (!image && global.mappingDb) {
        try {
          const imgRow = global.mappingDb
            .prepare(
              itemType === "Anime"
                ? "SELECT image_url FROM anime WHERE malid = ?"
                : "SELECT image_url FROM manga WHERE malid = ?",
            )
            .get(numMalId);
          if (imgRow && imgRow.image_url) {
            image = imgRow.image_url;
          }
        } catch (_) {}
      }
    }

    const sanitizeFolderName = (t) =>
      t ? t.replace(/[^a-zA-Z0-9 _-]/g, "").trim() : "";
    const cleanFolder = sanitizeFolderName(title || oldId || finalId);

    if (global.db) {
      try {
        const stmt = global.db.prepare(
          "INSERT OR REPLACE INTO unlinked_mal_ids (id, malid) VALUES (?, ?)",
        );
        if (oldId) stmt.run(oldId, String(numMalId));
        if (finalId) stmt.run(finalId, String(numMalId));
        if (cleanFolder) stmt.run(cleanFolder, String(numMalId));

        const existing = global.db
          .prepare(
            `SELECT * FROM ${itemType} WHERE id = ? OR id = ? OR folder_name = ?`,
          )
          .get(finalId, oldId, cleanFolder);

        if (existing) {
          global.db
            .prepare(
              `UPDATE ${itemType} SET id = ?, MalID = ?, provider = ?, title = COALESCE(NULLIF(?, ''), title), image_url = COALESCE(NULLIF(?, ''), image_url), folder_name = COALESCE(NULLIF(folder_name, ''), ?) WHERE id = ? OR id = ? OR folder_name = ?`,
            )
            .run(
              finalId,
              String(numMalId),
              selectedProvider,
              title || existing.title || "",
              image || existing.image_url || "",
              cleanFolder,
              oldId || finalId,
              finalId,
              cleanFolder,
            );
        } else {
          global.db
            .prepare(
              `INSERT OR REPLACE INTO ${itemType} (id, title, image_url, folder_name, MalID, provider, CustomTag) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              finalId,
              title || finalId,
              image || "",
              cleanFolder,
              String(numMalId),
              selectedProvider,
              JSON.stringify(["downloads"]),
            );
        }
      } catch (err) {
        logger.error
          ? logger.error(
              `Error updating local db in local link-mapping: ${err.message}`,
            )
          : null;
      }
    }

    if (oldId && oldId !== finalId && global.db) {
      try {
        if (itemType === "Anime") {
          global.db
            .prepare("UPDATE WatchHistory SET anime_id = ? WHERE anime_id = ?")
            .run(finalId, oldId);
          global.db
            .prepare("UPDATE SkipTimes SET anime_id = ? WHERE anime_id = ?")
            .run(finalId, oldId);
        } else {
          global.db
            .prepare("UPDATE ReadHistory SET manga_id = ? WHERE manga_id = ?")
            .run(finalId, oldId);
        }
      } catch (_) {}
    }

    const linkedProvidersMap = {};
    if (mappingRow) {
      if (itemType === "Anime") {
        if (mappingRow.pahe_uuid) {
          linkedProvidersMap["pahe"] = {
            id: mappingRow.pahe_uuid,
            provider: "pahe",
            title: title || "",
          };
        }
        if (mappingRow.anikoto_id) {
          linkedProvidersMap["anikoto"] = {
            id: mappingRow.anikoto_id,
            provider: "anikoto",
            title: title || "",
          };
        }
        if (mappingRow.anineko_id) {
          linkedProvidersMap["anineko"] = {
            id: mappingRow.anineko_id,
            provider: "anineko",
            title: title || "",
          };
        }
      } else {
        if (mappingRow.weebcentral_id) {
          linkedProvidersMap["weebcentral"] = {
            id: mappingRow.weebcentral_id,
            provider: "weebcentral",
            title: title || "",
          };
        }
        if (mappingRow.allmanga_id) {
          linkedProvidersMap["allmanga"] = {
            id: mappingRow.allmanga_id,
            provider: "allmanga",
            title: title || "",
          };
        }
      }
    }

    const details = {
      id: finalId,
      dataId: oldId,
      malid: numMalId,
      title: title || finalId,
      image: image || "",
      image_url: image || "",
      provider: selectedProvider,
      linkedProviders: Object.values(linkedProvidersMap),
      CustomTag: JSON.stringify(["downloads"]),
    };

    return res.json({
      success: true,
      newId: finalId,
      provider: selectedProvider,
      details,
    });
  } catch (err) {
    logger.error(`Failed to link local item: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
