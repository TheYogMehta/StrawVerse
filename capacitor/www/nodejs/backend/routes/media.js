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
const { getHeaders } = require("../utils/proxyHeaders");
const { wrapImagesInObject } = require("../download");
const ImageCacheManager = require("../utils/ImageCacheManager");

const router = express.Router();

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

    return res.json(wrapImagesInObject(data));
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
        SELECT livechart_id, episode, date, title, image FROM next_episodes 
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
      `,
      )
      .all(yesterdayStart, limitEnd);

    const enriched = [];
    const seen = new Set();

    for (const ep of episodes) {
      if (seen.has(ep.livechart_id)) continue;
      seen.add(ep.livechart_id);

      let malid = null;
      if (global.mappingDb) {
        try {
          const row = global.mappingDb
            .prepare("SELECT malid FROM anime WHERE livechart_id = ?")
            .get(ep.livechart_id);
          if (row && row.malid) {
            const mapped = global.mappingDb
              .prepare(
                `
                SELECT 1 FROM pahe WHERE malid = ?
                UNION ALL
                SELECT 1 FROM anikoto WHERE malid = ?
                UNION ALL
                SELECT 1 FROM anineko WHERE malid = ?
                LIMIT 1
              `,
              )
              .get(row.malid, row.malid, row.malid);
            if (mapped) {
              malid = row.malid;
            }
          }
        } catch (dbErr) {
          console.error("Database error in schedule mapping lookup:", dbErr);
        }
      }

      enriched.push({
        ...ep,
        malid,
        title: ep.title || (malid ? `MAL ${malid}` : "Unknown Anime"),
        image: ep.image || "",
      });
    }

    res.json({
      results: enriched,
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

        if (AnimeManga === "Anime" && global.mappingDb && id) {
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
        } else if (AnimeManga === "Manga" && global.mappingDb && id) {
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
                    .prepare(
                      `SELECT id, uuid, malid FROM pahe WHERE malid = ?`,
                    )
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
        } else if (data.malid) {
          resolvedMalId = parseInt(data.malid);
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
          if (AnimeManga === "Anime") {
            const query = `
              WITH resolved AS (
                SELECT malid FROM pahe WHERE uuid = ? OR id = ?
                UNION ALL
                SELECT malid FROM anikoto WHERE id = ?
                UNION ALL
                SELECT malid FROM anineko WHERE id = ?
              )
              SELECT 
                rm.malid,
                p.uuid AS pahe_uuid,
                a.id AS anikoto_id,
                neko.id AS anineko_id,
                an.livechart_id
              FROM (SELECT malid FROM resolved WHERE malid IS NOT NULL LIMIT 1) rm
              LEFT JOIN pahe p ON p.malid = rm.malid
              LEFT JOIN anikoto a ON a.malid = rm.malid
              LEFT JOIN anineko neko ON neko.malid = rm.malid
              LEFT JOIN anime an ON an.malid = rm.malid
            `;
            mappingRow = global.mappingDb
              .prepare(query)
              .get(id, id, id, id);
          } else {
            const query = `
              WITH resolved AS (
                SELECT malid FROM weebcentral WHERE id = ?
                UNION ALL
                SELECT malid FROM allmanga WHERE id = ?
              )
              SELECT 
                rm.malid,
                w.id AS weebcentral_id,
                allm.id AS allmanga_id
              FROM (SELECT malid FROM resolved WHERE malid IS NOT NULL LIMIT 1) rm
              LEFT JOIN weebcentral w ON w.malid = rm.malid
              LEFT JOIN allmanga allm ON allm.malid = rm.malid
            `;
            mappingRow = global.mappingDb.prepare(query).get(id, id);
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

            data.linkedProviders = Object.values(linkedProvidersMap);
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
                      "SELECT watched_episodes FROM WatchHistory WHERE anime_id = ?",
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

    if (!data?.id) throw new Error(`No ${AnimeManga} Found with id '${id}'`);
    return res.json(wrapImagesInObject(data));
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
      const sourcesArray = await fetchEpisodeSources(Animeprovider, ep);
      res.status(200).json(sourcesArray || { sources: [] });
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
      if (cached && fs.existsSync(path.join(cacheDir, cached.filename))) {
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
  if (!url) return res.status(400).send("No URL");
  try {
    const port = global.PORT || 3000;
    const reqHeaders = getHeaders(url);
    const { data } = await global.axios.get(url, {
      headers: reqHeaders,
      responseType: "text",
      timeout: 15000,
    });
    const base = url.substring(0, url.lastIndexOf("/") + 1);
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
                return `URI="${proxy}${encodeURIComponent(abs)}"`;
              })
            : line;
        }
        const abs = t.startsWith("http") ? t : base + t;
        const proxy = abs.includes(".m3u8") ? m3u8Proxy : segProxy;
        return `${proxy}${encodeURIComponent(abs)}`;
      })
      .join("\n");

    res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    res.send(manifest);
  } catch (err) {
    logger.error(`[StreamProxy] m3u8 error: ${err.message}`);
    res.status(502).send(err.message);
  }
});

// Proxy for m3u8 video segment
router.get("/api/stream/segment", async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).send("No URL");
  try {
    const reqHeaders = getHeaders(url);
    let attempts = 0;
    let data, headers;
    while (attempts < 3) {
      try {
        const resp = await global.axios.get(url, {
          headers: reqHeaders,
          responseType: "arraybuffer",
          timeout: 30000,
        });
        data = resp.data;
        headers = resp.headers;
        break;
      } catch (err) {
        attempts++;
        if (err.response?.status === 429 && attempts < 3) {
          await new Promise((r) => setTimeout(r, 200 * attempts));
        } else if (attempts >= 3) {
          throw err;
        }
      }
    }

    let buffer = Buffer.from(data);

    if (
      buffer.length >= 8 &&
      buffer[0] === 0x89 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x4e &&
      buffer[3] === 0x47 &&
      buffer[4] === 0x0d &&
      buffer[5] === 0x0a &&
      buffer[6] === 0x1a &&
      buffer[7] === 0x0a
    ) {
      for (let i = 0; i < Math.min(buffer.length - 3, 1024); i++) {
        if (
          buffer[i] === 0x49 &&
          buffer[i + 1] === 0x45 &&
          buffer[i + 2] === 0x4e &&
          buffer[i + 3] === 0x44
        ) {
          buffer = buffer.subarray(i + 8);
          break;
        }
      }
    }

    const ct = headers?.["content-type"] || "application/octet-stream";
    res.setHeader("Content-Type", ct.includes("image") ? "video/mp2t" : ct);
    res.send(buffer);
  } catch (err) {
    logger.error(`[StreamProxy] segment error: ${err.message}`);
    res.status(502).send(err.message);
  }
});

module.exports = router;
