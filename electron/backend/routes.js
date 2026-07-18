// Libs
const { app } = require("electron");
const express = require("express");
const axios = require("axios");
const JSZip = require("jszip");
const path = require("path");
const fs = require("fs");

const router = express.Router();

// functions
const {
  ensureDirectoryExists,
  getDownloadsFolder,
} = require("./utils/DirectoryMaker");
const {
  downloadAnimeSingle,
  downloadAnimeMulti,
  downloadMangaSingle,
  downloadMangaMulti,
  getBaseDownloadDir,
  cleanupEmptyDownloadFolder,
  wrapImagesInObject,
} = require("./download");
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
  invalidateCache,
  getProviderOrThrow,
  resolveDownloadFolder,
} = require("./utils/AnimeManga");
const { logger, getLogs, clearLogs } = require("./utils/AppLogger");
const {
  settingupdate,
  settingfetch,
  providerFetch,
} = require("./utils/settings");
const {
  getQueue,
  updateQueue,
  removeQueue,
  removeMultipleFromQueue,
  pauseQueue,
  resumeQueue,
  isQueuePaused,
} = require("./utils/queue");
const {
  MalCreateUrl,
  MalVerifyToken,
  MalAddToList,
  MalRemoveFromList,
  MalSearch,
} = require("./utils/mal");
const {
  getAllMetadata,
  FindMapping,
  getSourceById,
  MetadataRemove,
  MetadataAdd,
  getMalIdFromMapping,
} = require("./utils/Metadata");
const { updateHistory } = require("./utils/history");
const { getHeaders } = require("./utils/proxyHeaders");
const {
  getKeyValue,
  setKeyValue,
  queryOne,
  run,
} = require("./utils/db");
const ImageCacheManager = require("./utils/ImageCacheManager");
const { UpdateDiscordRPC } = require("./utils/discord");
const segmentKeyCache = {};

// ===================== API routes =====================

// Get application logs
router.get("/api/logs", async (req, res) => {
  try {
    const logs = await getLogs();
    res.json({ logs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear application logs
router.delete("/api/logs", async (req, res) => {
  try {
    await clearLogs();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get app version
router.get("/api/version", (req, res) => {
  res.json({ version: app.getVersion() });
});

// Get application changelog / release notes
router.get("/api/changelog", (req, res) => {
  try {
    let changelogPath = path.join(__dirname, "..", "..", "CHANGELOG.md");
    if (!fs.existsSync(changelogPath)) {
      changelogPath = path.join(__dirname, "..", "CHANGELOG.md");
    }

    if (fs.existsSync(changelogPath)) {
      const changelog = fs.readFileSync(changelogPath, "utf-8");
      res.json({ changelog });
    } else {
      res.status(404).json({ error: "Changelog file not found" });
    }
  } catch (err) {
    logger.error("Failed to read changelog: " + err.message);
    res.status(500).json({ error: err.message });
  }
});

// Handles Mal Login
router.get("/mal/callback", async (req, res) => {
  code = req.query.code;
  let ToUpdate = await MalVerifyToken(code);
  await settingupdate(ToUpdate);
  global.win.webContents.send("mal", {
    LoggedIn: true,
  });
  return res.send(`
      <p>Authentication successful! You can close this window.</p>
  `);
});

// Handles Mal Logout
router.get("/mal/logout", async (req, res) => {
  await settingupdate({ mal_on_off: "logout", status: null, malToken: null });

  global.win.webContents.send("mal", {
    LoggedIn: false,
  });

  global.MalLoggedIn = false;

  return res.send("logged out!");
});

// Handles Download Progress & Sends To FrontEnd
router.post("/api/logger", async (req, res) => {
  const { caption, totalSegments, currentSegments, epid } = req.body;
  try {
    const currentQueue = (await getQueue()) ?? [];
    const exists = currentQueue.some((item) => item.epid === epid);
    if (!exists) {
      return res.status(200).json({ message: "Task no longer in queue" });
    }

    let queue =
      (await updateQueue(epid, totalSegments, currentSegments, caption)) ?? [];

    if (currentSegments < totalSegments) {
      global.win.webContents.send("download-logger", {
        caption,
        totalSegments,
        currentSegments,
        epid,
        queue: queue.filter((item) => item?.currentSegments === 0),
      });
    } else {
      global.win.webContents.send("download-logger", {
        caption: "Nothing in progress",
        queue,
      });
    }

    res.status(200).json({ message: "Download progress received" });
  } catch (err) {
    logger.error(`Error Logging Download Segment`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// download api for anime & manga
router.post("/api/download/:AnimeManga/:singleMulti", async (req, res) => {
  const { AnimeManga, singleMulti } = req.params;

  try {
    let MessageData = null;

    if (AnimeManga === "Anime") {
      if (singleMulti === "Single") {
        let {
          id,
          ep,
          Title,
          number,
          provider,
          malid = null,
          subdub = null,
        } = req.body;
        const targetEpId = ep && typeof ep === "object" ? ep.id : ep;
        MessageData = await downloadAnimeSingle(
          provider,
          id,
          targetEpId,
          number,
          Title,
          true,
          null,
          null,
          false,
          malid,
          subdub,
        );
      } else if (singleMulti === "Multi") {
        let { id, Episodes, Title, SubDub, provider, malid = null } = req.body;
        MessageData = await downloadAnimeMulti(
          provider,
          id,
          Episodes,
          Title,
          SubDub,
          malid,
        );
      }
    } else if (AnimeManga === "Manga") {
      if (singleMulti === "Single") {
        let { id, ep, Title, number, provider, malid = null } = req.body;
        const targetEpId = ep && typeof ep === "object" ? ep.id : ep;
        MessageData = await downloadMangaSingle(
          provider,
          id,
          targetEpId,
          number,
          Title,
          true,
          null,
          null,
          false,
          malid,
        );
      } else if (singleMulti === "Multi") {
        let { id, Chapters, Title, provider, malid = null } = req.body;
        MessageData = await downloadMangaMulti(
          provider,
          id,
          Chapters,
          Title,
          malid,
        );
      }
    }

    if (!MessageData || MessageData?.message?.length <= 0)
      throw new Error("No Response Found From Functions");

    const queue = (await getQueue()) ?? [];
    return res.json({
      error: MessageData?.error,
      message: MessageData.message,
      queue: queue.length ?? 0,
    });
  } catch (err) {
    logger.error(`Error Updating Download Queue`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return res.json({
      error: true,
      message: `Internal server error: ${err.message}`,
    });
  }
});

// Fetchs Lists : Latest , Local , Search Anime & Manga
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
    data = null;

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

router.get("/api/schedule/weekly", async (req, res) => {
  try {
    const now = Math.floor(Date.now() / 1000);
    const oneWeekLater = now + 7 * 24 * 3600;

    const episodes = global.mappingDb
      .prepare(
        `
        SELECT livechart_id, episode, date, title, image FROM next_episodes 
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
      `,
      )
      .all(now, oneWeekLater);

    const enriched = [];

    for (const ep of episodes) {
      let malid = null;
      if (global.mappingDb) {
        try {
          const row = global.mappingDb
            .prepare("SELECT malid FROM anime WHERE livechart_id = ?")
            .get(ep.livechart_id);
          if (row && row.malid) {
            malid = row.malid;
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
  if (id !== undefined && id !== null) {
    id = String(id);
  }

  const data = {
    MalLoggedIn: !!global?.MalLoggedIn,
  };
  let provider = null;

  const setting = await settingfetch();

  try {
    if (!id) throw new Error("ID IS Missing");

    // load local metadata
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
        let cleanId = id?.replace(/-(dub|sub|hsub|both)$/, "");
        let suffix = "";
        if (id.endsWith("-sub")) suffix = "-sub";
        else if (id.endsWith("-dub")) suffix = "-dub";
        else if (id.endsWith("-hsub")) suffix = "-hsub";
        else if (id.endsWith("-both")) suffix = "-both";

        if (AnimeManga === "Anime" && global.mappingDb && cleanId) {
          try {
            const row = global.mappingDb
              .prepare(
                `
                SELECT malid, 'pahe' AS provider FROM animepahe WHERE id = ? OR uuid = ?
                UNION
                SELECT malid, 'anikoto' AS provider FROM anikototv WHERE id = ?
                UNION
                SELECT malid, 'anineko' AS provider FROM anineko WHERE id = ?
                LIMIT 1
              `,
              )
              .get(cleanId, cleanId, cleanId, cleanId);
            if (row) {
              resolvedMalId = row.malid;
              resolvedProvider = row.provider;
              resolvedId = cleanId;
            }
          } catch (err2) {}
        } else if (AnimeManga === "Manga" && global.mappingDb && cleanId) {
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
              .get(cleanId, cleanId);
            if (row) {
              resolvedMalId = row.malid;
              resolvedProvider = row.provider;
              resolvedId = cleanId;
            }
          } catch (err2) {}
        }

        if (resolvedMalId) {
          if (AnimeManga === "Anime") {
            const settingProviderLower = (
              setting.Animeprovider || "pahe"
            ).toLowerCase();
            const currentAnimeProvider = settingProviderLower.includes(
              "anikoto",
            )
              ? "anikoto"
              : settingProviderLower.includes("anineko")
                ? "anineko"
                : "pahe";
            if (currentAnimeProvider !== resolvedProvider) {
              if (currentAnimeProvider === "pahe") {
                try {
                  const targetRow = global.mappingDb
                    .prepare(
                      "SELECT id, uuid FROM animepahe WHERE malid = ? LIMIT 1",
                    )
                    .get(resolvedMalId);
                  if (targetRow) {
                    resolvedId = targetRow.uuid || targetRow.id;
                    resolvedProvider = "pahe";
                  }
                } catch (err2) {}
              } else if (currentAnimeProvider === "anikoto") {
                try {
                  const targetRow = global.mappingDb
                    .prepare("SELECT id FROM anikototv WHERE malid = ? LIMIT 1")
                    .get(resolvedMalId);
                  if (targetRow) {
                    resolvedId = targetRow.id;
                    resolvedProvider = "anikoto";
                  }
                } catch (err2) {}
              } else if (currentAnimeProvider === "anineko") {
                try {
                  const targetRow = global.mappingDb
                    .prepare("SELECT id FROM anineko WHERE malid = ? LIMIT 1")
                    .get(resolvedMalId);
                  if (targetRow) {
                    resolvedId = targetRow.id;
                    resolvedProvider = "anineko";
                  }
                } catch (err2) {}
              }
            }
          } else if (AnimeManga === "Manga") {
            const settingProviderLower = (
              setting.Mangaprovider || "weebcentral"
            ).toLowerCase();
            const currentMangaProvider = settingProviderLower.includes(
              "allmanga",
            )
              ? "allmanga"
              : "weebcentral";
            if (currentMangaProvider !== resolvedProvider) {
              if (currentMangaProvider === "weebcentral") {
                try {
                  const targetRow = global.mappingDb
                    .prepare(
                      "SELECT id FROM weebcentral WHERE malid = ? LIMIT 1",
                    )
                    .get(resolvedMalId);
                  if (targetRow) {
                    resolvedId = targetRow.id;
                    resolvedProvider = "weebcentral";
                  }
                } catch (err2) {}
              } else if (currentMangaProvider === "allmanga") {
                try {
                  const targetRow = global.mappingDb
                    .prepare("SELECT id FROM allmanga WHERE malid = ? LIMIT 1")
                    .get(resolvedMalId);
                  if (targetRow) {
                    resolvedId = targetRow.id;
                    resolvedProvider = "allmanga";
                  }
                } catch (err2) {}
              }
            }
          }
        }

        if (resolvedId && resolvedProvider) {
          if (resolvedProvider === "pahe") {
            resolvedId = resolvedId + (suffix || "-sub");
          }
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
          const settingProviderLower = (
            setting.Animeprovider || "pahe"
          ).toLowerCase();
          const preferred = settingProviderLower.includes("anikoto")
            ? "anikoto"
            : settingProviderLower.includes("anineko")
              ? "anineko"
              : "pahe";

          let rows = [];
          try {
            if (global.mappingDb) {
              rows = global.mappingDb
                .prepare(
                  `
                SELECT 'pahe' AS provider, id, uuid FROM animepahe WHERE malid = ?
                UNION ALL
                SELECT 'anikoto' AS provider, id, NULL AS uuid FROM anikototv WHERE malid = ?
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
          const settingProviderLower = (
            setting.Mangaprovider || "weebcentral"
          ).toLowerCase();
          const preferred = settingProviderLower.includes("allmanga")
            ? "allmanga"
            : "weebcentral";

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
          if (resolvedProvider === "pahe") {
            if (
              !resolvedId.endsWith("-sub") &&
              !resolvedId.endsWith("-dub") &&
              !resolvedId.endsWith("-hsub") &&
              !resolvedId.endsWith("-both")
            ) {
              resolvedId = resolvedId + "-sub";
            }
          }
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

    // load online metadata
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
          const lookupId =
            Animeprovider.provider_name === "pahe"
              ? id
              : id.replace(/-(dub|sub|hsub|both)$/, "");
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

          // pahe keeps on updating uuids
          if (
            Animeprovider.provider_name === "pahe" &&
            (!AnimeInfo || !AnimeInfo.title || AnimeInfo.results)
          ) {
            if (global?.mappingDb && data.malid) {
              try {
                const mappingRow = global.mappingDb
                  .prepare(`SELECT id, uuid FROM animepahe WHERE malid = ?`)
                  .get(Number(data.malid));
                if (mappingRow) {
                  const cleanOldId = id.replace(/-(dub|sub|hsub|both)$/, "");
                  const newId = mappingRow.uuid || mappingRow.id;
                  if (newId && newId !== cleanOldId) {
                    let suffix = "both";
                    if (id.endsWith("dub")) suffix = "dub";
                    else if (id.endsWith("sub")) suffix = "sub";
                    else if (id.endsWith("hsub")) suffix = "hsub";

                    AnimeInfo = await animeinfo(
                      Animeprovider,
                      setting?.CustomDownloadLocation,
                      `${newId}-${suffix}`,
                      false,
                    );

                    if (AnimeInfo && AnimeInfo?.title) {
                      try {
                        global.db
                          .prepare(
                            "UPDATE OR REPLACE Anime SET id = REPLACE(id, ?, ?) WHERE id = ? OR id LIKE ?",
                          )
                          .run(
                            cleanOldId,
                            newId,
                            cleanOldId,
                            `${cleanOldId}-%`,
                          );

                        global.db
                          .prepare(
                            "UPDATE WatchHistory SET anime_id = REPLACE(anime_id, ?, ?) WHERE anime_id = ? OR anime_id LIKE ?",
                          )
                          .run(
                            cleanOldId,
                            newId,
                            cleanOldId,
                            `${cleanOldId}-%`,
                          );

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
            // Overwrite basic metadata with fresh online info
            const fieldsToOverwrite = [
              "description",
              "status",
              "genres",
              "aired",
              "image_url",
              "totalEpisodes",
              "nextEpisodeIn",
              "dataId",
              "subOrDub",
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

            // Update SQLite database with fresh online metadata so the cache is updated
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
            // Overwrite basic metadata with fresh online info
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

            // Update SQLite database with fresh online metadata so the cache is updated
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

    // Resolve MAL ID and mapping details
    if (data && global.mappingDb) {
      try {
        const cleanId = id.replace(/-(dub|sub|hsub|both)$/, "");

        // 1. Check if there is a custom mapping/unlink record
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
            resolvedMalId = null; // Explicitly unlinked
          }
        } else if (data.malid) {
          resolvedMalId = parseInt(data.malid);
        }

        // Now perform mapping.db query based on the resolution
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
                LEFT JOIN animepahe p ON p.malid = rm.malid
                LEFT JOIN anikototv a ON a.malid = rm.malid
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
          // Case 2: No custom mapping and no malid provided. Take from mapping.db.
          if (AnimeManga === "Anime") {
            const query = `
              WITH resolved AS (
                SELECT malid FROM animepahe WHERE id = ? OR uuid = ?
                UNION ALL
                SELECT malid FROM anikototv WHERE id = ?
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
              LEFT JOIN animepahe p ON p.malid = rm.malid
              LEFT JOIN anikototv a ON a.malid = rm.malid
              LEFT JOIN anineko neko ON neko.malid = rm.malid
              LEFT JOIN anime an ON an.malid = rm.malid
            `;
            mappingRow = global.mappingDb
              .prepare(query)
              .get(cleanId, cleanId, cleanId, cleanId);
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
            mappingRow = global.mappingDb.prepare(query).get(cleanId, cleanId);
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
              // Add from mappingDb if not already in local records
              const suffix = id.endsWith("-dub")
                ? "-dub"
                : id.endsWith("-sub")
                  ? "-sub"
                  : id.endsWith("-hsub")
                    ? "-hsub"
                    : "-both";

              if (mappingRow.pahe_uuid && !linkedProvidersMap["pahe"]) {
                linkedProvidersMap["pahe"] = {
                  id: `${mappingRow.pahe_uuid}${suffix}`,
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
              // Manga
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
          } catch (e) {
            // ignore
          }

          if (AnimeManga === "Anime") {
            try {
              if (mappingRow.livechart_id) {
                const livechartId = mappingRow.livechart_id;
                const now = Math.floor(Date.now() / 1000);
                const nextEp = global.mappingDb
                  .prepare(
                    `
                    SELECT episode, date FROM next_episodes 
                    WHERE livechart_id = ? AND date > ? 
                    ORDER BY date ASC LIMIT 1
                  `,
                  )
                  .get(livechartId, now);

                if (nextEp) {
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

router.post("/downloads", async (req, res) => {
  let queue = (await getQueue()) ?? [];

  let Response = {
    caption: "Nothing in progress",
    queue,
    isPaused: isQueuePaused(),
  };

  let itemWithSegments = queue.find((item) => item.currentSegments > 0);

  if (itemWithSegments) {
    let caption = itemWithSegments.caption;
    if (!caption) {
      if (itemWithSegments.Type === "Anime") {
        caption = `Downloading ${itemWithSegments.Title} || EP ${itemWithSegments.EpNum}`;
      } else if (itemWithSegments.Type === "Manga") {
        caption = `Downloading ${itemWithSegments.Title} || ${itemWithSegments.ChapterTitle || "Chapter " + itemWithSegments.EpNum}`;
      } else {
        caption = "Downloading...";
      }
    }
    Response.caption = caption;
    Response.totalSegments = itemWithSegments.totalSegments;
    Response.currentSegments = itemWithSegments.currentSegments;
    Response.epid = itemWithSegments.epid;
    Response.id = itemWithSegments.id;
    Response.queue = queue.filter(
      (item) => item?.epid !== itemWithSegments?.epid,
    );
  }

  return res.json(Response);
});

// Pause queue
router.post("/api/download/pause", async (req, res) => {
  try {
    const paused = await pauseQueue();
    const queue = (await getQueue()) ?? [];
    if (global.win && !global.win.isDestroyed()) {
      global.win.webContents.send("download-logger", {
        queue,
        isPaused: true,
        message: "Queue paused",
      });
    }
    return res.json({ message: "Queue paused successfully", isPaused: true });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Resume queue
router.post("/api/download/resume", async (req, res) => {
  try {
    const paused = await resumeQueue();
    const queue = (await getQueue()) ?? [];
    if (global.win && !global.win.isDestroyed()) {
      global.win.webContents.send("download-logger", {
        queue,
        isPaused: false,
        message: "Queue resumed",
      });
    }
    return res.json({ message: "Queue resumed successfully", isPaused: false });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// Save custom local card order
router.post("/api/local/reorder", async (req, res) => {
  try {
    const { key, order } = req.body;
    if (key && Array.isArray(order)) {
      setKeyValue("Settings", `custom_order_${key}`, order);
    }
    return res.json({ success: true });
  } catch (err) {
    return res.status(500).json({ error: true, message: err.message });
  }
});

// remove from queue or remove all
router.post("/api/download/remove", async (req, res) => {
  try {
    const { AnimeEpId } = req.body;

    if (AnimeEpId) {
      let queue = await removeQueue(AnimeEpId);

      if (queue?.length > 0) {
        const itemWithSegments = queue.find((item) => item.totalSegments > 0);
        if (itemWithSegments) {
          let caption = itemWithSegments.caption;
          if (!caption) {
            if (itemWithSegments.Type === "Anime") {
              caption = `Downloading ${itemWithSegments.Title} || EP ${itemWithSegments.EpNum}`;
            } else if (itemWithSegments.Type === "Manga") {
              caption = `Downloading ${itemWithSegments.Title} || ${itemWithSegments.ChapterTitle || "Chapter " + itemWithSegments.EpNum}`;
            } else {
              caption = "Downloading...";
            }
          }
          global.win.webContents.send("download-logger", {
            caption,
            totalSegments: itemWithSegments.totalSegments,
            currentSegments: itemWithSegments.currentSegments,
            epid: itemWithSegments.epid,
            queue,
            isPaused: isQueuePaused(),
          });
        } else {
          global.win.webContents.send("download-logger", {
            queue,
            message: "Queue is empty",
            isPaused: isQueuePaused(),
          });
        }
      } else {
        global.win.webContents.send("download-logger", {
          queue,
          message: "Queue is empty",
          isPaused: isQueuePaused(),
        });
      }

      return res.json({ message: `Item with ID ${AnimeEpId} removed` });
    }

    let queue = await getQueue();
    const toRemove = queue.filter((item) => item.totalSegments <= 0);
    const epidsToRemove = toRemove.map((item) => item.epid);
    const updatedQueue = await removeMultipleFromQueue(epidsToRemove);

    global.win.webContents.send("download-logger", {
      queue: updatedQueue,
      isPaused: isQueuePaused(),
    });

    res.json({ message: "All items removed" });
  } catch (err) {
    logger.error(`Error Removing ${req?.body?.AnimeEpId ? "Ep" : "Ep(s)"} `);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(500).json({
      message: `Error Removing ${req?.body?.AnimeEpId ? "Ep" : "Ep(s)"}`,
      err,
    });
  }
});

// Play Video From m3u8 url
router.post("/api/watch", async (req, res) => {
  const { ep, epNum, Downloaded, provider = null, subdub } = req.body;
  try {
    if (!Downloaded) {
      if (!ep) throw new Error("Episode ID Not Found");
      const Animeprovider = await providerFetch("Anime", provider);
      let resolvedEp = String(ep);
      if (
        subdub &&
        !resolvedEp.endsWith("-sub") &&
        !resolvedEp.endsWith("-dub") &&
        !resolvedEp.endsWith("-both")
      ) {
        resolvedEp = `${resolvedEp}-${subdub}`;
      }
      const sourcesArray = await fetchEpisodeSources(Animeprovider, resolvedEp);
      if (provider === "pahe" && sourcesArray) {
        const allSources = [
          ...(Array.isArray(sourcesArray.sources) ? sourcesArray.sources : []),
          ...(sourcesArray.sub?.sources || []),
          ...(sourcesArray.dub?.sources || []),
        ];
        for (const src of allSources) {
          if (src.url) {
            try {
              const cdnDomain = new URL(src.url).hostname;
              const ref = src.headers?.Referer || "https://kwik.cx/";
              global.setDynamicReferer(cdnDomain, ref);
              global.setFallbackReferer(ref);
            } catch (e) {}
          }
        }
      }
      if (sourcesArray?.sources) {
        for (const src of sourcesArray.sources) {
          const ref =
            src.headers?.Referer ||
            src.headers?.referer ||
            (src.extra && src.extra[0]);
          if (ref) {
            global.setFallbackReferer(ref.endsWith("/") ? ref : ref + "/");
            break;
          }
        }
      }
      res.status(200).json(sourcesArray);
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

      // url
      if (SourcesData?.filepath) {
        videoData.sources.push({
          url: `/video?path=${encodeURIComponent(SourcesData?.filepath)}`,
          quality: "HD",
        });
      }

      // subtitles
      if (SourcesData?.subtitleFiles?.length > 0) {
        videoData.subtitles = SourcesData?.subtitleFiles;
      }

      if (SourcesData?.skipTimes) {
        videoData.skipTimes = SourcesData.skipTimes;
      }

      res.status(200).json(videoData);
    }
  } catch (err) {
    // logging
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

// Get Local Subtitles
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

// get chapter
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
      } catch (e) {
        // ignore
      }
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

// Update Mal Listings
router.post("/api/mal/update", async (req, res) => {
  try {
    let { malid, episodes, status, type } = req.body;
    const isAnime = !type || type.toLowerCase() === "anime";

    episodes = parseInt(episodes) || 0;

    const validStatuses = isAnime
      ? ["watching", "completed", "plan_to_watch", "on_hold", "dropped"]
      : ["reading", "completed", "plan_to_read", "on_hold", "dropped"];

    if (!validStatuses.includes(status)) {
      status = null;
    }

    if (!malid || !status) throw new Error("Some thing is missing");

    let data = await MalAddToList(
      isAnime ? "anime" : "manga",
      malid,
      status,
      episodes,
    );

    return res.json(data);
  } catch (err) {
    // log error
    res.json({
      title: "MyAnimeList Update Fail!",
      icon: "error",
      text: `Error : ${err.message}`,
    });
  }
});

// Remove/Delete from MyAnimeList list
router.post("/api/mal/remove", async (req, res) => {
  try {
    const { malid, type } = req.body;
    if (!malid) throw new Error("MAL ID is missing");
    const isAnime = !type || type.toLowerCase() === "anime";

    const data = await MalRemoveFromList(isAnime ? "anime" : "manga", malid);

    return res.json(data);
  } catch (err) {
    res.json({
      title: "MyAnimeList Update Fail!",
      icon: "error",
      text: `Error : ${err.message}`,
    });
  }
});

// Get MyAnimeList access token for Watch Together authentication
router.get("/api/mal/token", async (req, res) => {
  try {
    const config = await settingfetch();
    if (config.malToken) {
      const tokenObj = JSON.parse(config.malToken);
      if (tokenObj && tokenObj.access_token) {
        return res.json({ access_token: tokenObj.access_token });
      }
    }
    res.status(401).json({ error: "Not logged into MyAnimeList" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Search MyAnimeList
router.get("/api/mal/search", async (req, res) => {
  try {
    const { query, type } = req.query;
    if (!query) throw new Error("Query is missing");
    const results = await MalSearch(query, type || "anime");
    res.json(results);
  } catch (err) {
    logger.error(`Error searching MAL: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Link/Unlink MyAnimeList mapping
router.post("/api/mal/link", async (req, res) => {
  try {
    let { type, id, MalID, provider, title } = req.body;
    if (!type || !id) {
      throw new Error("Missing type or id");
    }

    MalID = MalID ? String(MalID) : null;
    id = id.replace(/-(dub|sub|hsub|both)$/, "");

    let targetMalID = MalID ? parseInt(MalID, 10) : null;
    let resolvedProvider = null;
    if (provider) {
      const p = provider.toLowerCase();
      if (p.includes("pahe")) resolvedProvider = "animepahe";
      else if (p.includes("anikoto")) resolvedProvider = "anikototv";
      else if (p.includes("anineko")) resolvedProvider = "anineko";
      else if (p.includes("weebcentral")) resolvedProvider = "weebcentral";
      else if (p.includes("allmanga")) resolvedProvider = "allmanga";
    }

    if (resolvedProvider) {
      const cleanId = id.replace(/-(dub|sub|hsub|both)$/, "");

      if (!targetMalID) {
        let dbRow = null;
        try {
          if (type === "Anime") {
            dbRow = global.db
              .prepare(
                "SELECT MalID FROM Anime WHERE id = ? OR id = ? OR id = ? OR id = ? OR id = ?",
              )
              .get(
                cleanId,
                `${cleanId}-sub`,
                `${cleanId}-hsub`,
                `${cleanId}-dub`,
                `${cleanId}-both`,
              );
          } else {
            dbRow = global.db
              .prepare("SELECT MalID FROM Manga WHERE id = ?")
              .get(cleanId);
          }
        } catch (e) {}
        if (dbRow && dbRow.MalID) {
          targetMalID = parseInt(dbRow.MalID, 10);
        }
      }

      if (!targetMalID && global.mappingDb) {
        try {
          const rule = [
            {
              key: "pahe",
              query: "SELECT malid FROM animepahe WHERE id = ? OR uuid = ?",
              params: [cleanId, cleanId],
            },
            {
              key: "anikoto",
              query: "SELECT malid FROM anikototv WHERE id = ?",
              params: [cleanId],
            },
            {
              key: "anineko",
              query: "SELECT malid FROM anineko WHERE id = ?",
              params: [cleanId],
            },
            {
              key: "weebcentral",
              query: "SELECT malid FROM weebcentral WHERE id = ?",
              params: [cleanId],
            },
            {
              key: "allmanga",
              query: "SELECT malid FROM allmanga WHERE id = ?",
              params: [cleanId],
            },
          ].find((r) => resolvedProvider.includes(r.key));
          if (rule) {
            const row = global.mappingDb
              .prepare(rule.query)
              .get(...rule.params);
            if (row && row.malid) {
              targetMalID = parseInt(row.malid, 10);
            }
          }
        } catch (e) {}
      }

      let providerTitle = title || null;
      if (!providerTitle) {
        try {
          if (type === "Anime") {
            const row = global.db
              .prepare(
                "SELECT title, MalID FROM Anime WHERE id = ? OR id = ? OR id = ? OR id = ? OR id = ? LIMIT 1",
              )
              .get(
                cleanId,
                `${cleanId}-sub`,
                `${cleanId}-hsub`,
                `${cleanId}-dub`,
                `${cleanId}-both`,
              );
            if (row) {
              providerTitle = row.title;
              if (!targetMalID && row.MalID) {
                targetMalID = parseInt(row.MalID, 10);
              }
            }
          } else {
            const row = global.db
              .prepare("SELECT title, MalID FROM Manga WHERE id = ? LIMIT 1")
              .get(cleanId);
            if (row) {
              providerTitle = row.title;
              if (!targetMalID && row.MalID) {
                targetMalID = parseInt(row.MalID, 10);
              }
            }
          }
        } catch (e) {
          logger.error(`Error querying title from local DB: ${e.message}`);
        }
      }

      if (targetMalID) {
        if (MalID) {
          axios
            .post("https://strawverse.theyogmehta.online/mapping", {
              malid: targetMalID,
              provider: resolvedProvider,
              id: cleanId,
              title: providerTitle,
            })
            .then(() =>
              logger.info(
                `[Mapper] Successfully reported custom mapping link for MAL ID ${targetMalID}`,
              ),
            )
            .catch((err) =>
              logger.error(
                `[Mapper] Failed to report custom mapping link: ${err.message}`,
              ),
            );
        } else {
          axios
            .delete("https://strawverse.theyogmehta.online/mapping", {
              data: {
                malid: targetMalID,
                provider: resolvedProvider,
                title: providerTitle,
              },
            })
            .then(() =>
              logger.info(
                `[Mapper] Successfully reported custom mapping unlink for MAL ID ${targetMalID}`,
              ),
            )
            .catch((err) =>
              logger.error(
                `[Mapper] Failed to report custom mapping unlink: ${err.message}`,
              ),
            );
        }
      }
    }

    try {
      const stmt = MalID
        ? global.db.prepare(
            "INSERT OR REPLACE INTO unlinked_mal_ids (id, malid) VALUES (?, ?)",
          )
        : global.db.prepare(
            "INSERT OR REPLACE INTO unlinked_mal_ids (id, malid) VALUES (?, NULL)",
          );
      stmt.run(id, ...(MalID ? [MalID] : []));
    } catch (err) {
      logger.error(
        `Error updating unlinked_mal_ids in /api/mal/link: ${err.message}`,
      );
    }

    if (type === "Anime") {
      global.db
        .prepare(
          `UPDATE Anime SET MalID = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ? OR id = ? OR id = ? OR id = ? OR id = ?`,
        )
        .run(MalID, id, `${id}-sub`, `${id}-hsub`, `${id}-dub`, `${id}-both`);
    } else {
      global.db
        .prepare(
          `UPDATE Manga SET MalID = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(MalID, id);
    }

    return res.json({
      error: false,
      message: MalID
        ? "Successfully linked MyAnimeList ID"
        : "Successfully unlinked MyAnimeList ID",
    });
  } catch (err) {
    logger.error(`Error in /api/mal/link: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Get unique custom tags for local catalog filtering
router.get("/api/local/tags/view/:type", async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== "Anime" && type !== "Manga") {
      throw new Error("Invalid type parameter");
    }
    const defaultTags =
      type === "Manga"
        ? ["Reading", "Downloads", "Plan to Read"]
        : ["Watching", "Downloads", "Plan to Watch"];

    const rows = global.db
      .prepare(
        `SELECT CustomTag FROM ${type} WHERE CustomTag IS NOT NULL AND CustomTag != ''`,
      )
      .all();
    const allTagsSet = new Set(defaultTags);
    for (const r of rows) {
      const tag = r.CustomTag ? r.CustomTag.trim() : "";
      if (tag) {
        try {
          const parsed = JSON.parse(tag);
          if (Array.isArray(parsed)) {
            parsed.forEach((t) => {
              if (t && t.trim()) allTagsSet.add(t.trim());
            });
          } else if (typeof parsed === "string" && parsed.trim()) {
            allTagsSet.add(parsed.trim());
          }
        } catch (e) {
          allTagsSet.add(tag);
        }
      }
    }
    res.json(Array.from(allTagsSet));
  } catch (err) {
    logger.error(`Error fetching tags for ${req.params.type}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Add/Update local database item (e.g. library addition, tag, or MAL link)
router.post("/api/local/tags/add", async (req, res) => {
  try {
    let { type, id, provider, MalID, CustomTag } = req.body;
    if (!type || !id) {
      throw new Error("Missing type or id");
    }

    if (provider === "provider" || provider === "local source") {
      provider = null;
    }

    id = id.replace(/-(dub|sub|hsub|both)$/, "");
    let resolvedMalID = MalID ? String(MalID) : null;

    // find mal id with provider anime/manga id
    if (!resolvedMalID) {
      if (global.mappingDb && id) {
        try {
          const rule = [
            {
              key: "pahe",
              query: "SELECT malid FROM animepahe WHERE id = ? OR uuid = ?",
              params: [id, id],
            },
            {
              key: "anikoto",
              query: "SELECT malid FROM anikototv WHERE id = ?",
              params: [id],
            },
            {
              key: "anineko",
              query: "SELECT malid FROM anineko WHERE id = ?",
              params: [id],
            },
            {
              key: "weebcentral",
              query: "SELECT malid FROM weebcentral WHERE id = ?",
              params: [id],
            },
            {
              key: "allmanga",
              query: "SELECT malid FROM allmanga WHERE id = ?",
              params: [id],
            },
          ].find((r) => (provider || "").toLowerCase().includes(r.key));
          if (rule) {
            const row = global.mappingDb
              .prepare(rule.query)
              .get(...rule.params);
            if (row && row.malid) {
              resolvedMalID = String(row.malid);
            }
          }
        } catch (err) {
          logger.error(
            `Error resolving MAL ID from mapping DB: ${err.message}`,
          );
        }
      }
    }

    let tagValue = "";
    if (CustomTag !== undefined) {
      tagValue = (CustomTag || "").trim();
    }

    let existing = null;
    if (type === "Anime") {
      const strippedId = id.replace(/-(dub|sub|hsub|both)$/, "");
      existing = global.db
        .prepare(
          `SELECT * FROM Anime WHERE id = ? OR id = ? OR id = ? OR id = ? OR id = ? OR folder_name = ? OR folder_name = ?`,
        )
        .get(
          id,
          `${strippedId}-sub`,
          `${strippedId}-hsub`,
          `${strippedId}-dub`,
          `${strippedId}-both`,
          id,
          strippedId,
        );
    } else {
      existing = global.db
        .prepare(`SELECT * FROM Manga WHERE id = ? OR folder_name = ?`)
        .get(id, id);
    }

    if (existing) {
      const updates = [];
      const params = [];
      if (resolvedMalID) {
        updates.push("MalID = ?");
        params.push(resolvedMalID);
      } else if (existing.MalID) {
        resolvedMalID = existing.MalID;
      } else if (MalID !== undefined) {
        updates.push("MalID = ?");
        params.push(null);
      }
      if (CustomTag !== undefined) {
        updates.push("CustomTag = ?");
        params.push(tagValue);
      }
      if (updates.length > 0) {
        params.push(existing.id);
        global.db
          .prepare(
            `UPDATE ${type} SET ${updates.join(", ")}, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          )
          .run(...params);

        // SYNC TAGS to other rows sharing same MalID
        const targetMalID = resolvedMalID || existing.MalID;
        if (CustomTag !== undefined && targetMalID && targetMalID !== "") {
          global.db
            .prepare(`UPDATE ${type} SET CustomTag = ? WHERE MalID = ?`)
            .run(tagValue, targetMalID);
        }
      }
    } else {
      let values = {
        id,
        provider: provider || "",
        type,
        MalID: resolvedMalID,
        CustomTag: tagValue,
      };

      // Fetch full online metadata from online provider
      try {
        const resolvedProvider = await providerFetch(type, provider);
        const config = await settingfetch();
        if (resolvedProvider && resolvedProvider.provider) {
          if (type === "Anime") {
            const lookupId =
              resolvedProvider.provider_name === "pahe"
                ? id
                : id.replace(/-(dub|sub|hsub|both)$/, "");
            const animedata = await animeinfo(
              resolvedProvider,
              config?.CustomDownloadLocation,
              lookupId,
            );
            if (animedata) {
              if (animedata.malid && !resolvedMalID) {
                resolvedMalID = String(animedata.malid);
              }
              values = {
                ...values,
                title: animedata.title
                  ? animedata.title.replace(/-(dub|sub|hsub|both)$/, "")
                  : "",
                provider: resolvedProvider.provider_name,
                subOrDub: id.endsWith("dub")
                  ? "dub"
                  : id.endsWith("hsub")
                    ? "hsub"
                    : "sub",
                type: animedata.type ?? null,
                description: animedata.description ?? null,
                status: animedata.status ?? null,
                genres:
                  animedata?.genres?.length > 0
                    ? animedata.genres.join(",")
                    : "",
                aired: animedata?.aired ?? null,
                ImageUrl: animedata?.image,
                EpisodesDataId: animedata?.dataId,
                MalID: resolvedMalID,
              };
            }
          } else if (type === "Manga") {
            const mangainfo = await MangaInfo(resolvedProvider, id);
            if (mangainfo) {
              if (mangainfo.malid && !resolvedMalID) {
                resolvedMalID = String(mangainfo.malid);
              }
              values = {
                ...values,
                title: mangainfo.title || "",
                provider: resolvedProvider.provider_name,
                description: mangainfo.description ?? null,
                genres:
                  mangainfo?.genres?.length > 0
                    ? mangainfo.genres.join(",")
                    : "",
                type: mangainfo.type ?? null,
                author: mangainfo?.author ?? null,
                released: mangainfo?.released ?? null,
                ImageUrl: mangainfo?.image,
                MalID: resolvedMalID,
              };
            }
          }
        }
      } catch (fetchErr) {
        logger.error(
          `Failed to fetch online metadata in /api/local/tags/add for ${id}: ${fetchErr.message}`,
        );
      }

      await MetadataAdd(type, values);
      global.db
        .prepare(`UPDATE ${type} SET MalID = ?, CustomTag = ? WHERE id = ?`)
        .run(resolvedMalID, tagValue, id);

      if (resolvedMalID && resolvedMalID !== "") {
        global.db
          .prepare(`UPDATE ${type} SET CustomTag = ? WHERE MalID = ?`)
          .run(tagValue, resolvedMalID);
      }
    }

    // Clean up duplicate entries sharing the same MalID if they don't have active folders on disk
    const targetMalID = MalID ? String(MalID) : existing?.MalID;
    if (
      CustomTag !== undefined &&
      (tagValue === "" || tagValue === "[]") &&
      targetMalID &&
      targetMalID !== ""
    ) {
      try {
        const rowsToClean = global.db
          .prepare(`SELECT id, folder_name FROM ${type} WHERE MalID = ?`)
          .all(targetMalID);

        const baseDir = await getBaseDownloadDir();

        for (const row of rowsToClean) {
          const folderName = row.folder_name || "";
          const folderPath = path.join(baseDir, type, folderName);
          const folderExists = folderName && fs.existsSync(folderPath);

          if (!folderExists) {
            global.db.prepare(`DELETE FROM ${type} WHERE id = ?`).run(row.id);
          }
        }
      } catch (err) {
        logger.error(
          `Error cleaning up duplicate MalID entries: ${err.message}`,
        );
      }
    }

    try {
      const resolvedProvider = await providerFetch(
        type,
        provider || existing?.provider,
      );
      const actualProviderName =
        resolvedProvider?.provider_name || provider || existing?.provider;
      invalidateCache(type, actualProviderName, id);
    } catch (e) {
      logger.error(`Error invalidating cache for ${type} ${id}: ${e.message}`);
    }

    return res.json({
      error: false,
      message: "Successfully updated library item",
    });
  } catch (err) {
    logger.error(`Error in /api/local/tags/add: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Delete Local Database Entry
router.post("/api/local/tags/remove", async (req, res) => {
  try {
    const { id, type } = req.body;
    if (!id || !type) throw new Error("ID or Type is missing");

    const baseDir = await getBaseDownloadDir();
    let typeDir = path.join(baseDir, type, id);

    let dbRecord = null;
    try {
      dbRecord = global.db
        .prepare(`SELECT * FROM ${type} WHERE id = ?`)
        .get(id);
    } catch (e) {
      // ignore
    }

    if (!fs.existsSync(typeDir) && dbRecord) {
      const folderName =
        dbRecord.folder_name || dbRecord.title?.replace(/[^a-zA-Z0-9]/g, "_");
      typeDir = path.join(baseDir, type, folderName);
    }

    if (fs.existsSync(typeDir)) {
      await fs.promises.rm(typeDir, { recursive: true, force: true });
    }

    if (
      !(
        dbRecord &&
        dbRecord?.CustomTag &&
        dbRecord?.CustomTag !== "" &&
        dbRecord?.CustomTag !== "[]"
      ) &&
      !(dbRecord && dbRecord?.MalID && dbRecord?.MalID !== "")
    ) {
      await MetadataRemove(type, id);
    }

    return res.json({ error: false, message: "Deleted successfully" });
  } catch (err) {
    logger.error(`Error in /api/local/tags/remove: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

router.post("/api/metadata/switch-provider", async (req, res) => {
  try {
    const { type, oldId, newId, newProvider } = req.body;
    if (!type || !oldId || !newId || !newProvider) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    if (oldId === newId) {
      return res.json({ success: true, message: "No change needed" });
    }

    const table = type === "Anime" ? "Anime" : "Manga";
    const existing = global.db
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .get(oldId);

    if (existing) {
      global.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(oldId);
      existing.id = newId;
      existing.provider = newProvider;
      existing.last_updated = new Date().toISOString();
      const columns = Object.keys(existing);
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map((col) => existing[col]);

      global.db
        .prepare(
          `
        INSERT OR REPLACE INTO ${table} (${columns.join(", ")})
        VALUES (${placeholders})
      `,
        )
        .run(...values);
      if (type === "Anime") {
        global.db
          .prepare(`UPDATE WatchHistory SET anime_id = ? WHERE anime_id = ?`)
          .run(newId, oldId);
      } else {
        global.db
          .prepare(`UPDATE ReadHistory SET manga_id = ? WHERE manga_id = ?`)
          .run(newId, oldId);
      }
      return res.json({ success: true, migrated: true });
    }

    return res.json({ success: true, migrated: false });
  } catch (err) {
    logger.error(`Error in /api/metadata/switch-provider: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Proxy for all Images
router.get("/api/image", async (req, res) => {
  let decodedUrl = "";
  try {
    const imageUrl = req.query.url;
    if (!imageUrl) {
      return res.status(400).send("Missing image url");
    }

    decodedUrl = decodeURIComponent(imageUrl);

    // local file
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

    // Check if the image is in cache
    try {
      const cached = queryOne("SELECT filename FROM ImageCache WHERE url = ?", [
        decodedUrl,
      ]);
      const cacheDir = ImageCacheManager.getImageCacheDir();
      if (cached && fs.existsSync(path.join(cacheDir, cached.filename))) {
        // Update last_accessed
        run("UPDATE ImageCache SET last_accessed = ? WHERE url = ?", [
          Date.now(),
          decodedUrl,
        ]);

        // Determine content type based on extension
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
    let response = await global.axios.get(decodedUrl, options);
    const contentType = response.headers["content-type"] || "image/jpeg";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(response.data);
  } catch (err) {
    console.error("Image proxy direct fetch failed:", err.message);
    res.status(500).send("Failed to load image");
  }
});

// Get image cache stats
router.get("/api/cache/stats", (req, res) => {
  try {
    const stats = ImageCacheManager.getCacheStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear image cache
router.post("/api/cache/clear", async (req, res) => {
  try {
    const result = await ImageCacheManager.clearCache();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete Local Episodes or Chapters
router.post("/api/local/delete", async (req, res) => {
  try {
    const { id, type = "Anime", numbers, subdub } = req.body;
    if (!id || !numbers || !Array.isArray(numbers) || numbers.length === 0) {
      throw new Error("Missing or invalid parameters");
    }

    const baseDir = await getBaseDownloadDir();
    let typeDir = resolveDownloadFolder(type, id, subdub, baseDir);

    if (!fs.existsSync(typeDir)) {
      throw new Error(`${type} folder not found on disk`);
    }

    const files = await fs.promises.readdir(typeDir);
    let deletedCount = 0;

    for (const num of numbers) {
      const targetNum = parseFloat(num);
      if (isNaN(targetNum)) continue;

      const filesToDelete = files.filter((file) => {
        if (type === "Anime") {
          const ext = path.extname(file).toLowerCase();
          const videoExtensions = [
            ".mp4",
            ".mkv",
            ".webm",
            ".ts",
            ".avi",
            ".mov",
            ".flv",
            ".m4v",
            ".3gp",
          ];
          const subExtensions = [".srt", ".vtt", ".ass", ".ssa"];
          if (!videoExtensions.includes(ext) && !subExtensions.includes(ext)) {
            return false;
          }
          const match = file.match(/^\d+(\.\d+)?/);
          if (match) {
            return parseFloat(match[0]) === targetNum;
          }
        } else {
          if (
            file.toLowerCase().endsWith(".cbz") &&
            file.toLowerCase().includes("chapter")
          ) {
            const match = file.toLowerCase().match(/chapter\s*([\d.]+)/);
            if (match) {
              return parseFloat(match[1]) === targetNum;
            }
          }
        }
        return false;
      });

      for (const fileToDelete of filesToDelete) {
        try {
          await fs.promises.unlink(path.join(typeDir, fileToDelete));
          deletedCount++;
        } catch (e) {
          // ignore individual file deletion errors
        }
      }
    }

    await cleanupEmptyDownloadFolder(typeDir, type, id);

    const label = type === "Anime" ? "episode(s)" : "chapter(s)";
    return res.json({
      error: false,
      message: `Successfully deleted ${deletedCount} ${label}`,
    });
  } catch (err) {
    logger.error(`Error in /api/local/delete: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Reset Discord RPC to Idle (called when leaving player/reader)
router.post("/api/discord/reset", async (req, res) => {
  try {
    UpdateDiscordRPC().catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// Update tracking/history progress
router.post("/api/history/update", async (req, res) => {
  try {
    const { mediaId, type, number } = req.body;
    if (!mediaId || !type || !number) {
      throw new Error("Missing parameters for history update");
    }
    await updateHistory(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all watch and read history records
router.post("/api/history/clear", async (req, res) => {
  try {
    global.db.prepare(`DELETE FROM WatchHistory`).run();
    global.db.prepare(`DELETE FROM ReadHistory`).run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete specific tracking history record
router.delete("/api/history/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const historyTable = type === "Anime" ? "WatchHistory" : "ReadHistory";
    global.db.prepare(`DELETE FROM ${historyTable} WHERE id = ?`).run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hide specific media tracking from continue watching/reading shelf
router.post("/api/history/hide", async (req, res) => {
  try {
    const { mediaId, type, malId, title } = req.body;
    if (!mediaId || !type) {
      throw new Error("Missing parameters");
    }

    const isAnime = type === "Anime";
    const historyTable = isAnime ? "WatchHistory" : "ReadHistory";
    const idField = isAnime ? "anime_id" : "manga_id";
    const titleField = isAnime ? "anime_title" : "manga_title";
    const mainTable = isAnime ? "Anime" : "Manga";

    let queryIds = [mediaId];

    if (malId) {
      const siblings = global.db
        .prepare(`SELECT id FROM ${mainTable} WHERE MalID = ?`)
        .all(String(malId));
      siblings.forEach((s) => {
        if (s.id) queryIds.push(s.id);
      });
    }

    if (isAnime) {
      let suffixIds = [];
      queryIds.forEach((id) => {
        suffixIds.push(id);
        const stripped = id.replace(/-(dub|sub|hsub|both)$/, "");
        suffixIds.push(
          `${stripped}-sub`,
          `${stripped}-hsub`,
          `${stripped}-dub`,
          `${stripped}-both`,
        );
      });
      queryIds = Array.from(new Set(suffixIds));
    }

    const placeholders = queryIds.map(() => "?").join(",");
    global.db
      .prepare(
        `UPDATE ${historyTable} SET hidden = 1 WHERE ${idField} IN (${placeholders})`,
      )
      .run(...queryIds);

    if (title) {
      global.db
        .prepare(
          `UPDATE ${historyTable} SET hidden = 1 WHERE LOWER(${titleField}) = LOWER(?)`,
        )
        .run(title);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch progress history for specific title
router.get("/api/history/progress", async (req, res) => {
  try {
    const { mediaId, type } = req.query;
    if (!mediaId || !type) throw new Error("Missing parameters");

    let suggestedNumber = null;
    let lastProgress = null;
    let hasBefore = false;
    let episodesStatus = [];
    let chaptersStatus = [];

    if (type === "Anime") {
      let queryIds = [mediaId];
      const strippedId = mediaId.replace(/-(dub|sub|hsub|both)$/, "");
      queryIds.push(
        `${strippedId}-sub`,
        `${strippedId}-hsub`,
        `${strippedId}-dub`,
        `${strippedId}-both`,
      );

      // Resolve sibling IDs from DB if linked via MalID
      let resolvedTitle = null;
      try {
        const localRec = global.db
          .prepare(`SELECT MalID, title FROM Anime WHERE id = ?`)
          .get(mediaId);
        if (localRec) {
          if (localRec.MalID) {
            const siblings = global.db
              .prepare(`SELECT id FROM Anime WHERE MalID = ?`)
              .all(localRec.MalID);
            siblings.forEach((s) => {
              if (s.id) queryIds.push(s.id);
            });
          }
          if (localRec.title) {
            resolvedTitle = localRec.title;
          }
        }
      } catch (err) {}
      queryIds = Array.from(new Set(queryIds));

      const placeholders = queryIds.map(() => "?").join(",");
      let sql = `SELECT * FROM WatchHistory WHERE anime_id IN (${placeholders})`;
      let params = [...queryIds];
      if (resolvedTitle && resolvedTitle !== "Anime") {
        sql += ` OR LOWER(anime_title) = LOWER(?)`;
        params.push(resolvedTitle);
      }

      const history = global.db.prepare(sql).all(...params);

      // Sort chronological descending
      history.sort(
        (a, b) =>
          new Date(b.last_watched).getTime() -
          new Date(a.last_watched).getTime(),
      );

      if (history.length > 0) {
        hasBefore = true;
        const latest = history[0];
        lastProgress = {
          number: latest.episode_number,
          currentTime: latest.current_time,
          duration: latest.duration,
          isCompleted: latest.is_completed === 1,
        };

        if (latest.is_completed === 1) {
          suggestedNumber = latest.episode_number + 1;
        } else {
          suggestedNumber = latest.episode_number;
        }
      }

      episodesStatus = history.map((h) => ({
        number: h.episode_number,
        isCompleted: h.is_completed === 1,
        currentTime: h.current_time,
        duration: h.duration,
      }));
    } else {
      let queryIds = [mediaId];
      let resolvedTitle = null;
      try {
        const localRec = global.db
          .prepare(`SELECT MalID, title FROM Manga WHERE id = ?`)
          .get(mediaId);
        if (localRec) {
          if (localRec.MalID) {
            const siblings = global.db
              .prepare(`SELECT id FROM Manga WHERE MalID = ?`)
              .all(localRec.MalID);
            siblings.forEach((s) => {
              if (s.id) queryIds.push(s.id);
            });
          }
          if (localRec.title) {
            resolvedTitle = localRec.title;
          }
        }
      } catch (err) {}
      queryIds = Array.from(new Set(queryIds));

      const placeholders = queryIds.map(() => "?").join(",");
      let sql = `SELECT * FROM ReadHistory WHERE manga_id IN (${placeholders})`;
      let params = [...queryIds];
      if (resolvedTitle && resolvedTitle !== "Manga") {
        sql += ` OR LOWER(manga_title) = LOWER(?)`;
        params.push(resolvedTitle);
      }

      const history = global.db.prepare(sql).all(...params);
      history.sort(
        (a, b) =>
          new Date(b.last_read).getTime() - new Date(a.last_read).getTime(),
      );

      if (history.length > 0) {
        hasBefore = true;
        const latest = history[0];
        lastProgress = {
          number: latest.chapter_number,
          currentPage: latest.current_page,
          totalPages: latest.total_pages,
          isCompleted: latest.is_completed === 1,
        };

        if (latest.is_completed === 1) {
          suggestedNumber = latest.chapter_number + 1;
        } else {
          suggestedNumber = latest.chapter_number;
        }
      }

      chaptersStatus = history.map((h) => ({
        number: h.chapter_number,
        isCompleted: h.is_completed === 1,
        currentPage: h.current_page,
        totalPages: h.total_pages,
      }));
    }

    res.json({
      hasProgress: hasBefore,
      lastProgress,
      suggestedNumber,
      episodesStatus,
      chaptersStatus,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch overall history statistics
router.get("/api/history/stats", async (req, res) => {
  try {
    const watchStats = global.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(time_spent), 0) AS total_seconds,
        COUNT(DISTINCT anime_id) AS distinct_anime,
        COUNT(CASE WHEN is_completed = 1 THEN 1 END) AS completed_episodes
      FROM WatchHistory
    `,
      )
      .get();

    const readStats = global.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(time_spent), 0) AS total_seconds,
        COUNT(DISTINCT manga_id) AS distinct_manga,
        COUNT(CASE WHEN is_completed = 1 THEN 1 END) AS completed_chapters
      FROM ReadHistory
    `,
      )
      .get();

    res.json({
      watchHours: parseFloat((watchStats.total_seconds / 3600).toFixed(2)),
      readHours: parseFloat((readStats.total_seconds / 3600).toFixed(2)),
      completedEpisodes: watchStats.completed_episodes,
      completedChapters: readStats.completed_chapters,
      distinctAnime: watchStats.distinct_anime,
      distinctManga: readStats.distinct_manga,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch paginated history list
router.get("/api/history/list", async (req, res) => {
  try {
    try {
      global.db
        .prepare(
          "DELETE FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
        )
        .run();
      global.db
        .prepare(
          "DELETE FROM ReadHistory WHERE manga_id NOT IN (SELECT id FROM Manga)",
        )
        .run();
    } catch (e) {}

    const limit = parseInt(req.query.limit || 50);
    const includeHidden = req.query.include_hidden === "true";
    const watchWhereClause = includeHidden
      ? ""
      : "WHERE (w.hidden IS NULL OR w.hidden = 0)";
    const readWhereClause = includeHidden
      ? ""
      : "WHERE (r.hidden IS NULL OR r.hidden = 0)";

    const watchLogs = global.db
      .prepare(
        `
      SELECT 
        w.id,
        'Anime' AS type,
        w.anime_id AS media_id,
        w.anime_title AS title,
        w.episode_number AS number,
        w.current_time,
        w.duration,
        w.time_spent,
        w.is_completed,
        w.last_watched AS date,
        a.image_url,
        a.provider,
        a.MalID AS mal_id,
        CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS exists_in_catalog,
        mal.totalEpisodes AS total_count
      FROM WatchHistory w
      LEFT JOIN Anime a ON a.id = w.anime_id
      LEFT JOIN MyAnimeList mal ON mal.id = a.MalID
      ${watchWhereClause}
      ORDER BY w.last_watched DESC
      LIMIT ?
    `,
      )
      .all(limit);

    watchLogs.forEach((log) => {
      log.image = log.image_url || null;
      delete log.image_url;
    });

    const readLogs = global.db
      .prepare(
        `
      SELECT 
        r.id,
        'Manga' AS type,
        r.manga_id AS media_id,
        r.manga_title AS title,
        r.chapter_number AS number,
        r.current_page AS current_time,
        r.total_pages AS duration,
        r.time_spent,
        r.is_completed,
        r.last_read AS date,
        m.image_url,
        m.provider,
        m.MalID AS mal_id,
        CASE WHEN m.id IS NOT NULL THEN 1 ELSE 0 END AS exists_in_catalog,
        mml.totalChapters AS total_count
      FROM ReadHistory r
      LEFT JOIN Manga m ON m.id = r.manga_id
      LEFT JOIN MyMangaList mml ON mml.id = m.MalID
      ${readWhereClause}
      ORDER BY r.last_read DESC
      LIMIT ?
    `,
      )
      .all(limit);

    readLogs.forEach((log) => {
      log.image = log.image_url || null;
      delete log.image_url;
    });

    const combined = [...watchLogs, ...readLogs]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    res.json(wrapImagesInObject(combined));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ===================== SPA routes =====================
const SPA_ROUTES = [
  "/",
  "/local/anime",
  "/local/manga",
  "/anime",
  "/mal/anime",
  "/manga",
  "/search",
  "/setting",
  "/log",
  "/info/:AnimeManga/:LocalMalProvider",
  "/downloads",
  "/marketplace",
  "/error",
];

SPA_ROUTES.forEach((route) => {
  router.get(route, (req, res) => {
    res.sendFile(path.join(__dirname, "..", "gui", "dist", "index.html"), {
      dotfiles: "allow",
    });
  });
});

module.exports = router;
