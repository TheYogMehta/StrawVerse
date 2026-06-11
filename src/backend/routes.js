// Libs
const { app } = require("electron");
const express = require("express");
const axios = require("axios");
const JSZip = require("jszip");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const ffmpegStatic = require("ffmpeg-static");
const { spawn } = require("child_process");

const keyCache = {};
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
} = require("./utils/AnimeManga");
const { logger, getLogs, clearLogs } = require("./utils/AppLogger");
const {
  settingupdate,
  settingfetch,
  providerFetch,
  getScraperIconsPath,
} = require("./utils/settings");
const {
  getQueue,
  updateQueue,
  removeQueue,
  removeMultipleFromQueue,
} = require("./utils/queue");
const {
  MalCreateUrl,
  MalVerifyToken,
  MalAddToList,
  MalSearch,
} = require("./utils/mal");
const {
  getAllMetadata,
  FindMapping,
  getSourceById,
  MalPage,
} = require("./utils/Metadata");
const { getHeaders } = require("./utils/proxyHeaders");
const { getKeyValue, setKeyValue } = require("./utils/db");

// ===================== API routes =====================
// Get settings data
router.get("/api/settings", async (req, res) => {
  try {
    const setting = await settingfetch();
    const settingsWithProviders = {
      ...setting,
      providers: {
        Anime: global.Anime_providers
          ? Object.keys(global.Anime_providers)
          : [],
        Manga: global.Manga_providers
          ? Object.keys(global.Manga_providers)
          : [],
      },
      installedExtensions: {
        Anime: global.Anime_providers
          ? Object.entries(global.Anime_providers).map(([key, val]) => ({
              name: key,
              version: val.version || "1.0.0",
            }))
          : [],
        Manga: global.Manga_providers
          ? Object.entries(global.Manga_providers).map(([key, val]) => ({
              name: key,
              version: val.version || "1.0.0",
            }))
          : [],
      },
    };
    let url = null;
    if (!setting.mal_on_off || setting.mal_on_off === null) {
      url = await MalCreateUrl();
    }
    res.json({
      settings: settingsWithProviders,
      url: url,
      MalLoggedIn: global.MalLoggedIn || false,
      malUsername: setting?.malUsername || global.malUsername || null,
    });
  } catch (err) {
    logger.error(err);
    res.status(500).json({ error: err.message });
  }
});

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

// Get all loaded providers with icon hints — served from locally downloaded icons
router.get("/api/providers", (req, res) => {
  const toInfo = (name, scraper) => ({
    name,
    version: scraper?.version || null,
    icon: scraper?.logo || `/api/extension-icon/${encodeURIComponent(name)}`,
  });
  res.json({
    Anime: Object.entries(global.Anime_providers || {}).map(([n, s]) =>
      toInfo(n, s),
    ),
    Manga: Object.entries(global.Manga_providers || {}).map(([n, s]) =>
      toInfo(n, s),
    ),
  });
});

// Serve a locally-cached extension icon
router.get("/api/extension-icon/:name", (req, res) => {
  try {
    const iconsDir = getScraperIconsPath();
    if (!iconsDir) return res.status(404).end();
    const safeName = req.params.name.replace(/[^a-zA-Z0-9_-]/g, "");
    const iconFile = path.join(iconsDir, `${safeName}.ico`);
    if (fs.existsSync(iconFile)) {
      res.setHeader("Content-Type", "image/x-icon");
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.sendFile(iconFile, { dotfiles: "allow" });
    }
    res.status(404).end();
  } catch (err) {
    res.status(500).end();
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

// Handles Settings update
router.post("/api/settings", async (req, res) => {
  const {
    status,
    quality,
    CustomDownloadLocation,
    Animeprovider,
    Mangaprovider,
    Pagination,
    autoLoadNextChapter,
    enableDiscordRPC,
    mergeSubtitles,
    subtitleFormat,
    malDiscordProfile,
  } = req.body;
  try {
    if (
      status &&
      status !== "watching" &&
      status !== "dropped" &&
      status !== "completed" &&
      status !== "on_hold" &&
      status !== "plan_to_watch"
    )
      return res.status(400).json({ error: "Enter a valid status." });

    if (
      quality &&
      quality !== "1080p" &&
      quality !== "720p" &&
      quality !== "360p"
    )
      return res.status(400).json({ error: "Enter a valid quality." });

    if (CustomDownloadLocation && CustomDownloadLocation !== null)
      await ensureDirectoryExists(CustomDownloadLocation);

    await settingupdate({
      quality: quality,
      CustomDownloadLocation: CustomDownloadLocation,
      Animeprovider: Animeprovider,
      Mangaprovider: Mangaprovider,
      Pagination: Pagination,
      autoLoadNextChapter: autoLoadNextChapter,
      enableDiscordRPC: enableDiscordRPC,
      mergeSubtitles: mergeSubtitles,
      subtitleFormat: subtitleFormat,
      malDiscordProfile: malDiscordProfile,
    });

    res.status(200).json({ message: "Settings saved successfully." });
  } catch (err) {
    const errorMessage = err.message.split("\n")[0];
    logger.error(`Error Updating Settings: \n${err}`);
    res.status(400).json({ error: errorMessage });
  }
});

// Handles Download Progress & Sends To FrontEnd
router.post("/api/logger", async (req, res) => {
  const { caption, totalSegments, currentSegments, epid } = req.body;
  try {
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
      } else if (provider === "mal") {
        data = await MalPage("Anime", config.Animeprovider, filters?.page);
      } else if (provider === "provider") {
        const provider = await providerFetch("Anime");
        if (!provider?.provider) throw new Error("Missing Provider!");
        data = await latestAnime(provider, filters);
        data = { ...data, site: config.Animeprovider };
      } else if (provider === "search") {
        const provider = await providerFetch("Anime");
        if (!provider?.provider) throw new Error("Missing Provider!");
        data = await animesearch(provider, req?.query?.query, filters);
        data = { ...data, site: config.Animeprovider };
      }
    } else if (AnimeManga === "Manga") {
      if (provider === "local") {
        data = await getAllMetadata(
          "Manga",
          config?.CustomDownloadLocation,
          filters?.page,
          filters?.tag,
        );
      } else if (provider === "mal") {
        data = await MalPage("Manga", config.Mangaprovider, filters?.page);
      } else if (provider === "provider") {
        const provider = await providerFetch("Manga");
        if (!provider?.provider) throw new Error("Missing Provider!");
        data = await latestMangas(provider, filters?.page);
      } else if (provider === "search") {
        const provider = await providerFetch("Manga");
        if (!provider?.provider) throw new Error("Missing Provider!");
        data = await MangaSearch(provider, req?.query?.query, filters?.page);
      }
    }

    if (!data) throw new Error(`No ${AnimeManga} Found in ${provider}`);
    return res.json(data);
  } catch (err) {
    logger.error(
      `Failed To Fetch ${provider} ${AnimeManga} page ${filters?.page}`,
    );
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.json({
      data: {
        totalPages: 0,
        currentPage: 1,
        hasNextPage: false,
        totalItems: 0,
        results: [],
      },
      extension_missing: err?.message?.includes("Missing Provider!"),
    });
  }
});

// Fetches Anime / Manga Info
router.post("/api/info/:AnimeManga/:LocalMalProvider", async (req, res) => {
  const { AnimeManga, LocalMalProvider } = req.params;
  const { id } = req.body;

  let data = null;
  let provider = null;

  const setting = await settingfetch();

  try {
    if (!id) throw new Error("ID IS Missing");

    // if local
    if (LocalMalProvider === "local") {
      try {
        let AnimeLocalInfo = await FindMapping(
          AnimeManga,
          id,
          null,
          setting.CustomDownloadLocation,
        );
        if (AnimeLocalInfo) {
          if (AnimeLocalInfo?.genres) {
            AnimeLocalInfo.genres = AnimeLocalInfo.genres.split(",");
          }
          data = AnimeLocalInfo;
          provider = AnimeLocalInfo?.provider;
        }
      } catch (err) {
        console.log(err);
        throw new Error(`No ${AnimeManga} Found with id '${id}'`);
      }
    }

    // loading mal data
    try {
      let localRecord = null;
      if (AnimeManga === "Anime") {
        const strippedId = id.replace(/-(dub|sub|both)$/, "");
        localRecord = global.db
          .prepare(
            `SELECT MalID, CustomTag, provider FROM Anime WHERE id = ? OR id = ? OR id = ? OR id = ?`,
          )
          .get(
            id,
            `${strippedId}-sub`,
            `${strippedId}-dub`,
            `${strippedId}-both`,
          );
      } else {
        localRecord = global.db
          .prepare(`SELECT MalID, CustomTag, provider FROM Manga WHERE id = ?`)
          .get(id);
      }
      if (localRecord) {
        data = {
          malid: localRecord.MalID ? parseInt(localRecord.MalID) : null,
          CustomTag: localRecord.CustomTag || "",
          provider: localRecord.provider || provider,
        };
        provider = localRecord.provider || provider;

        if (data.malid && global.MalLoggedIn) {
          try {
            const tableName =
              AnimeManga === "Anime" ? "MyAnimeList" : "MyMangaList";
            let MalInfo = global.db
              .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
              .get(String(data.malid));
            if (MalInfo) {
              data.watched =
                (AnimeManga === "Anime" ? MalInfo.watched : MalInfo.read) ?? 0;
              data.status = MalInfo.status ?? "";
            }
          } catch (err) {
            // ignore
          }
        }
      }
    } catch (dbErr) {
      // ignore
    }

    if (global?.MalLoggedIn) {
      data = { ...data, MalLoggedIn: true };
    }

    try {
      const cleanDbData = {};
      if (data) {
        Object.keys(data).forEach((key) => {
          if (
            data[key] !== undefined &&
            data[key] !== null &&
            data[key] !== ""
          ) {
            cleanDbData[key] = data[key];
          }
        });
      }

      if (AnimeManga === "Anime") {
        let Animeprovider = await providerFetch("Anime", provider ?? null);
        let AnimeInfo = await animeinfo(
          Animeprovider,
          setting?.CustomDownloadLocation,
          id,
          data?.provider ? false : true,
        );

        data = {
          provider: Animeprovider.provider_name,
          ...AnimeInfo,
          ...cleanDbData,
        };
      } else if (AnimeManga === "Manga") {
        let Mangaprovider = await providerFetch("Manga", provider ?? null);
        data = {
          provider: Mangaprovider.provider_name,
          ...(await MangaInfo(Mangaprovider, id)),
          ...cleanDbData,
        };
      }
    } catch (err) {
      throw err;
    }

    if (data && !data.malid && global.mappingDb) {
      try {
        const unlinkedMap = getKeyValue("Settings", "unlinked_mal_ids") || {};
        const cleanId = id.replace(/-(dub|sub|both)$/, "");
        if (!unlinkedMap[id] && !unlinkedMap[cleanId]) {
          const lowerProv = (data.provider || "").toLowerCase();
          let mappingTable = null;
          if (lowerProv.includes("pahe")) {
            mappingTable = "animepahe";
          } else if (lowerProv.includes("anikoto")) {
            mappingTable = "anikototv";
          }

          if (mappingTable) {
            let row = null;
            if (mappingTable === "animepahe") {
              row = global.mappingDb
                .prepare(`SELECT malid FROM animepahe WHERE id = ? OR uuid = ?`)
                .get(cleanId, cleanId);
            } else {
              row = global.mappingDb
                .prepare(`SELECT malid FROM ${mappingTable} WHERE id = ?`)
                .get(cleanId);
            }

            if (row && row.malid) {
              data.malid = parseInt(row.malid);

              if (global.MalLoggedIn) {
                try {
                  const tableName =
                    AnimeManga === "Anime" ? "MyAnimeList" : "MyMangaList";
                  let MalInfo = global.db
                    .prepare(`SELECT * FROM ${tableName} WHERE id = ?`)
                    .get(String(data.malid));
                  if (MalInfo) {
                    data.watched =
                      (AnimeManga === "Anime"
                        ? MalInfo.watched
                        : MalInfo.read) ?? 0;
                    data.status = MalInfo.status ?? "";
                  }
                } catch (err) {
                  // ignore
                }
              }
            }
          }
        }
      } catch (mappingErr) {
        logger.error(`Error querying mappingDb: ${mappingErr.message}`);
      }
    }

    // Resolve alternative provider mappings linked to the same MAL ID
    if (data && data.malid) {
      try {
        const linkedRecords = global.db
          .prepare(
            `SELECT id, provider, title, folder_name FROM ${AnimeManga} WHERE MalID = ?`,
          )
          .all(String(data.malid));
        data.linkedProviders = linkedRecords.map((r) => ({
          id: r.id,
          provider: r.provider,
          title: r.title,
          folder_name: r.folder_name,
        }));
      } catch (e) {
        // ignore
      }
    }

    if (data) {
      if (AnimeManga === "Anime" && data.malid) {
        try {
          const mappingRow = global.mappingDb
            .prepare("SELECT livechart_id FROM anime WHERE malid = ?")
            .get(Number(data.malid));

          if (mappingRow && mappingRow.livechart_id) {
            const livechartId = mappingRow.livechart_id;
            const now = Math.floor(Date.now() / 1000);
            const nextEp = global.db
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
        } catch (e) {
          // ignore
        }
      }

      try {
        const localMapping = await FindMapping(
          AnimeManga,
          id,
          data.malid || null,
          setting.CustomDownloadLocation,
        );
        if (localMapping) {
          if (AnimeManga === "Anime" && localMapping.DownloadedEpisodes) {
            data.DownloadedEpisodes = localMapping.DownloadedEpisodes;
          } else if (
            AnimeManga === "Manga" &&
            localMapping.DownloadedChapters
          ) {
            data.DownloadedChapters = localMapping.DownloadedChapters;
          }
        }
      } catch (e) {
        // ignore
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
    return res.json({ error: true, message: err?.message });
  }
});

// Fetches Anime Episodes
router.post("/api/episodes", async (req, res) => {
  let { id, page, provider } = req.body;
  page = parseInt(page ?? 1);
  try {
    if (isNaN(page)) throw new Error(`invalid Page '${page}'`);
    if (!id) throw new Error("ID is Missing");

    if (provider !== "local source") {
      const Animeprovider = await providerFetch("Anime", provider ?? null);

      const data = await fetchEpisode(Animeprovider, id, page);
      if (!data) throw new Error("No Episodes Found");
      if (data.hasNextPage === undefined && data.totalPages !== undefined) {
        data.hasNextPage = page < data.totalPages;
      }
      return res.json(data);
    } else {
      return res.json({});
    }
  } catch (err) {
    logger.error(`Error Fetching '${id}' Episodes page : ${page}:`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return res.json({ error: true, message: err?.message });
  }
});

// Fetches Manga Chapters
router.post("/api/chapters", async (req, res) => {
  let { id, page, provider } = req.body;
  page = parseInt(page ?? 1);
  try {
    if (!id) throw new Error("ID is Missing");

    if (provider !== "local source") {
      const Mangaprovider = await providerFetch("Manga", provider ?? null);
      const data = await fetchChapters(Mangaprovider, id, page);
      if (!data) throw new Error("No Chapters Found");
      if (data.hasNextPage === undefined && data.totalPages !== undefined) {
        data.hasNextPage = page < data.totalPages;
      }
      return res.json(data);
    } else {
      return res.json({});
    }
  } catch (err) {
    logger.error(`Error Fetching '${id}' Manga Chapters`);
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
    Response.queue = queue.filter(
      (item) => item?.epid !== itemWithSegments?.epid,
    );
  }

  return res.json(Response);
});

// remove from queue or remove all
router.get("/api/download/remove", async (req, res) => {
  try {
    const { AnimeEpId } = req.query;

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
          });
        } else {
          global.win.webContents.send("download-logger", {
            queue,
            message: "Queue is empty",
          });
        }
      } else {
        global.win.webContents.send("download-logger", {
          queue,
          message: "Queue is empty",
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
    });

    res.json({ message: "All items removed" });
  } catch (err) {
    logger.error(`Error Removing ${req?.query?.AnimeEpId ? "Ep" : "Ep(s)"} `);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.status(500).json({
      message: `Error Removing ${req?.query?.AnimeEpId ? "Ep" : "Ep(s)"}`,
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
      let resolvedEp = ep;
      if (
        subdub &&
        !ep.endsWith("-sub") &&
        !ep.endsWith("-dub") &&
        !ep.endsWith("-both")
      ) {
        resolvedEp = `${ep}-${subdub}`;
      }
      const sourcesArray = await fetchEpisodeSources(Animeprovider, resolvedEp);
      if ((provider === "pahe" || provider === "animepahe") && sourcesArray) {
        if (Array.isArray(sourcesArray.sources)) {
          sourcesArray.sources = sourcesArray.sources.map((src) => {
            if (src.url) {
              src.url = `/proxy?url=${encodeURIComponent(src.url)}`;
            }
            return src;
          });
        }
        if (sourcesArray.sub && Array.isArray(sourcesArray.sub.sources)) {
          sourcesArray.sub.sources = sourcesArray.sub.sources.map((src) => {
            if (src.url) {
              src.url = `/proxy?url=${encodeURIComponent(src.url)}`;
            }
            return src;
          });
        }
        if (sourcesArray.dub && Array.isArray(sourcesArray.dub.sources)) {
          sourcesArray.dub.sources = sourcesArray.dub.sources.map((src) => {
            if (src.url) {
              src.url = `/proxy?url=${encodeURIComponent(src.url)}`;
            }
            return src;
          });
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

    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": contentType,
    });

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
    const { type, id, MalID, provider, title, ImageUrl } = req.body;
    if (!type || !id) {
      throw new Error("Missing type or id");
    }

    let existing = null;
    if (type === "Anime") {
      const strippedId = id.replace(/-(dub|sub|both)$/, "");
      existing = global.db
        .prepare(
          `SELECT * FROM Anime WHERE id = ? OR id = ? OR id = ? OR id = ? OR folder_name = ? OR folder_name = ?`,
        )
        .get(
          id,
          `${strippedId}-sub`,
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

    const resolvedMalID = MalID ? String(MalID) : null;

    try {
      const unlinkedMap = getKeyValue("Settings", "unlinked_mal_ids") || {};
      if (!resolvedMalID) {
        unlinkedMap[id] = true;
        const cleanId = id.replace(/-(dub|sub|both)$/, "");
        unlinkedMap[cleanId] = true;
      } else {
        if (unlinkedMap[id]) delete unlinkedMap[id];
        const cleanId = id.replace(/-(dub|sub|both)$/, "");
        if (unlinkedMap[cleanId]) delete unlinkedMap[cleanId];
      }
      setKeyValue("Settings", "unlinked_mal_ids", unlinkedMap);
    } catch (err) {
      logger.error(
        `Error updating unlinked_mal_ids in /api/mal/link: ${err.message}`,
      );
    }

    if (existing) {
      const updates = ["MalID = ?", "last_updated = CURRENT_TIMESTAMP"];
      const params = [resolvedMalID];
      if (title && (!existing.title || existing.title === "")) {
        updates.push("title = ?");
        params.push(title);
      }
      let finalImageUrl = existing.image_url;
      let needsImageUrlUpdate = false;
      if (ImageUrl && (!existing.image_url || existing.image_url === "")) {
        finalImageUrl = ImageUrl;
        needsImageUrlUpdate = true;
      }
      if (ImageUrl && (!existing.image || existing.image === "")) {
        try {
          let fetchUrl = ImageUrl.trim();
          if (fetchUrl.startsWith("data:image/")) {
            updates.push("image = ?");
            params.push(fetchUrl);
          } else {
            if (fetchUrl.includes("/api/image?url=")) {
              fetchUrl = fetchUrl.split("/api/image?url=")[1];
            }
            const client = global.axios || require("axios");
            const { getHeaders } = require("./utils/proxyHeaders");
            const headersObj = getHeaders(fetchUrl);
            const requestHeaders = {};
            if (headersObj.Referer)
              requestHeaders["Referer"] = headersObj.Referer;
            if (headersObj["User-Agent"])
              requestHeaders["User-Agent"] = headersObj["User-Agent"];
            if (headersObj.Cookie) requestHeaders["Cookie"] = headersObj.Cookie;

            const imgResponse = await client.get(fetchUrl, {
              headers: requestHeaders,
              responseType: "arraybuffer",
            });
            const base64Image = `data:image/png;base64,${Buffer.from(imgResponse.data).toString("base64")}`;
            updates.push("image = ?");
            params.push(base64Image);
          }
        } catch (imgErr) {
          logger.error(
            `Failed to fetch image for linking record ${id}: ${imgErr.message}`,
          );
        }
      }
      if (needsImageUrlUpdate) {
        updates.push("image_url = ?");
        params.push(finalImageUrl);
      }
      params.push(existing.id);
      global.db
        .prepare(`UPDATE ${type} SET ${updates.join(", ")} WHERE id = ?`)
        .run(...params);
    } else {
      // Create minimal database entry for tracking without adding it to user's library tags
      const baseFolderName = id;

      let folderName = baseFolderName;
      try {
        const existingByFolder = global.db
          .prepare(`SELECT provider FROM ${type} WHERE folder_name = ?`)
          .get(baseFolderName);
        if (
          existingByFolder &&
          existingByFolder.provider !== (provider || "")
        ) {
          const pSuffix = (provider || "unknown").replace(/[^a-zA-Z0-9]/g, "_");
          folderName = `${baseFolderName}_${pSuffix}`;
        }
      } catch (_) {}

      let base64Image = null;
      let finalImageUrl = ImageUrl || "";
      if (ImageUrl) {
        try {
          let fetchUrl = ImageUrl.trim();
          if (fetchUrl.startsWith("data:image/")) {
            base64Image = fetchUrl;
          } else {
            if (fetchUrl.includes("/api/image?url=")) {
              fetchUrl = fetchUrl.split("/api/image?url=")[1];
            }
            const client = global.axios || require("axios");
            const { getHeaders } = require("./utils/proxyHeaders");
            const headersObj = getHeaders(fetchUrl);
            const requestHeaders = {};
            if (headersObj.Referer)
              requestHeaders["Referer"] = headersObj.Referer;
            if (headersObj["User-Agent"])
              requestHeaders["User-Agent"] = headersObj["User-Agent"];
            if (headersObj.Cookie) requestHeaders["Cookie"] = headersObj.Cookie;

            const imgResponse = await client.get(fetchUrl, {
              headers: requestHeaders,
              responseType: "arraybuffer",
            });
            base64Image = `data:image/png;base64,${Buffer.from(imgResponse.data).toString("base64")}`;
          }
        } catch (imgErr) {
          logger.error(
            `Failed to fetch image for new linking record ${id}: ${imgErr.message}`,
          );
        }
      }

      global.db
        .prepare(
          `
        INSERT INTO ${type} (id, title, image, image_url, description, genres, provider, folder_name, MalID, CustomTag, last_updated)
        VALUES (?, ?, ?, ?, '', '', ?, ?, ?, '[]', CURRENT_TIMESTAMP)
      `,
        )
        .run(
          id,
          title || "",
          base64Image,
          ImageUrl || "",
          provider || "",
          folderName,
          resolvedMalID,
        );
    }

    // Invalidate cached metadata so details reload cleanly
    try {
      const resolvedProvider = await providerFetch(
        type,
        provider || existing?.provider,
      );
      const actualProviderName =
        resolvedProvider?.provider_name || provider || existing?.provider;
      invalidateCache(type, actualProviderName, id);
    } catch (e) {
      logger.error(`Error invalidating cache in /api/mal/link: ${e.message}`);
    }

    return res.json({
      error: false,
      message: resolvedMalID
        ? "Successfully linked MyAnimeList ID"
        : "Successfully unlinked MyAnimeList ID",
    });
  } catch (err) {
    logger.error(`Error in /api/mal/link: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Get unique custom tags for local catalog filtering
router.get("/api/local/tags/:type", async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== "Anime" && type !== "Manga") {
      throw new Error("Invalid type parameter");
    }
    const defaultTags =
      type === "Manga"
        ? ["Reading", "Plan to Read"]
        : ["Watching", "Plan to Watch"];

    const rows = global.db
      .prepare(
        `SELECT CustomTag FROM ${type} WHERE CustomTag IS NOT NULL AND CustomTag != ''`,
      )
      .all();
    const allTagsSet = new Set(defaultTags);
    for (const r of rows) {
      try {
        const parsed = JSON.parse(r.CustomTag);
        if (Array.isArray(parsed)) {
          parsed.forEach((tag) => {
            if (
              tag &&
              tag.trim() &&
              tag.trim().toLowerCase() !== "myanimelist"
            ) {
              allTagsSet.add(tag.trim());
            }
          });
        } else if (
          typeof parsed === "string" &&
          parsed.trim() &&
          parsed.trim().toLowerCase() !== "myanimelist"
        ) {
          allTagsSet.add(parsed.trim());
        }
      } catch (e) {
        if (
          r.CustomTag.trim() &&
          r.CustomTag.trim().toLowerCase() !== "myanimelist"
        ) {
          allTagsSet.add(r.CustomTag.trim());
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
router.post("/api/local/add", async (req, res) => {
  try {
    const {
      type,
      id,
      title,
      ImageUrl,
      description,
      genres,
      provider,
      MalID,
      CustomTag,
      CustomTags,
    } = req.body;
    if (!type || !id) {
      throw new Error("Missing type or id");
    }

    if (MalID) {
      try {
        const unlinkedMap = getKeyValue("Settings", "unlinked_mal_ids") || {};
        if (unlinkedMap[id]) delete unlinkedMap[id];
        const cleanId = id.replace(/-(dub|sub|both)$/, "");
        if (unlinkedMap[cleanId]) delete unlinkedMap[cleanId];
        setKeyValue("Settings", "unlinked_mal_ids", unlinkedMap);
      } catch (err) {
        logger.error(
          `Error updating unlinked_mal_ids in /api/local/add: ${err.message}`,
        );
      }
    }

    const { MetadataAdd } = require("./utils/Metadata");

    let tagValue = "[]";
    if (Array.isArray(CustomTags)) {
      tagValue = JSON.stringify(
        CustomTags.filter((t) => t && t.trim().toLowerCase() !== "myanimelist"),
      );
    } else if (CustomTag !== undefined) {
      tagValue =
        CustomTag && CustomTag.trim().toLowerCase() !== "myanimelist"
          ? JSON.stringify([CustomTag])
          : JSON.stringify([]);
    }

    let existing = null;
    if (type === "Anime") {
      const strippedId = id.replace(/-(dub|sub|both)$/, "");
      existing = global.db
        .prepare(
          `SELECT * FROM Anime WHERE id = ? OR id = ? OR id = ? OR id = ? OR folder_name = ? OR folder_name = ?`,
        )
        .get(
          id,
          `${strippedId}-sub`,
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
      if (MalID !== undefined) {
        updates.push("MalID = ?");
        params.push(MalID ? String(MalID) : null);
      }
      if (CustomTags !== undefined || CustomTag !== undefined) {
        updates.push("CustomTag = ?");
        params.push(tagValue);
      }
      // Fill in title and provider if the stub record has them blank
      if (title && (!existing.title || existing.title === "")) {
        updates.push("title = ?");
        params.push(title);
      }
      if (provider && (!existing.provider || existing.provider === "")) {
        updates.push("provider = ?");
        params.push(provider);
      }
      let finalImageUrl = existing.image_url;
      let needsImageUrlUpdate = false;
      if (ImageUrl && (!existing.image_url || existing.image_url === "")) {
        finalImageUrl = ImageUrl;
        needsImageUrlUpdate = true;
      }
      // If the record has no image yet but a URL was supplied, fetch and save it now
      if (ImageUrl && (!existing.image || existing.image === "")) {
        try {
          let fetchUrl = ImageUrl.trim();
          if (fetchUrl.startsWith("data:image/")) {
            // Already a base64 data URI — store directly
            updates.push("image = ?");
            params.push(fetchUrl);
          } else {
            if (fetchUrl.includes("/api/image?url=")) {
              fetchUrl = fetchUrl.split("/api/image?url=")[1];
            }
            const client = global.axios || require("axios");
            const { getHeaders } = require("./utils/proxyHeaders");
            const headersObj = getHeaders(fetchUrl);
            const requestHeaders = {};
            if (headersObj.Referer)
              requestHeaders["Referer"] = headersObj.Referer;
            if (headersObj["User-Agent"])
              requestHeaders["User-Agent"] = headersObj["User-Agent"];
            if (headersObj.Cookie) requestHeaders["Cookie"] = headersObj.Cookie;

            const imgResponse = await client.get(fetchUrl, {
              headers: requestHeaders,
              responseType: "arraybuffer",
            });
            const base64Image = `data:image/png;base64,${Buffer.from(imgResponse.data).toString("base64")}`;
            updates.push("image = ?");
            params.push(base64Image);
          }
        } catch (imgErr) {
          logger.error(
            `Failed to fetch image for existing record ${id}: ${imgErr.message}`,
          );
        }
      }
      if (needsImageUrlUpdate) {
        updates.push("image_url = ?");
        params.push(finalImageUrl);
      }
      if (updates.length > 0) {
        params.push(existing.id);
        global.db
          .prepare(
            `UPDATE ${type} SET ${updates.join(", ")}, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          )
          .run(...params);
      }
    } else {
      const values = {
        id,
        title,
        ImageUrl,
        description,
        genres: Array.isArray(genres) ? genres.join(",") : genres || "",
        provider,
        type,
        MalID: MalID ? String(MalID) : "",
        CustomTag: tagValue,
        image_url: ImageUrl,
      };
      await MetadataAdd(type, values);
      // Ensure MalID and CustomTag are updated since MetadataAdd inserts values dynamically
      global.db
        .prepare(`UPDATE ${type} SET MalID = ?, CustomTag = ? WHERE id = ?`)
        .run(MalID ? String(MalID) : "", tagValue, id);
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
    logger.error(`Error in /api/local/add: ${err.message}`);
    return res.json({ error: true, message: err.message });
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

// Proxy for m3u8
router.get("/proxy", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");

  try {
    const targetParam = req?.query?.url || req?.query?.hianime;
    if (targetParam) {
      const targetUrl = decodeURIComponent(targetParam);

      // Handle decryption & transcoding if keyUrl and iv are specified
      const keyUrlParam = req?.query?.keyUrl;
      const ivParam = req?.query?.iv;

      if (keyUrlParam && ivParam) {
        try {
          const headers = getHeaders(targetUrl);

          // Get key
          let keyBuffer;
          if (keyCache[keyUrlParam]) {
            keyBuffer = keyCache[keyUrlParam];
          } else {
            const keyHeaders = getHeaders(keyUrlParam);
            const keyResponse = await global.axios.get(keyUrlParam, {
              responseType: "arraybuffer",
              headers: {
                ...keyHeaders,
                Accept: "*/*",
                Connection: "keep-alive",
              },
            });
            keyBuffer = Buffer.from(keyResponse.data);
            keyCache[keyUrlParam] = keyBuffer;
          }

          // Build IV
          const iv = Buffer.alloc(16);
          if (ivParam.startsWith("0x")) {
            Buffer.from(ivParam.slice(2), "hex").copy(iv);
          } else {
            iv.writeUInt32BE(parseInt(ivParam, 10), 12);
          }

          const ff = spawn(ffmpegStatic, [
            "-y",
            "-copyts",
            "-i",
            "pipe:0",
            "-map",
            "0",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-c:d",
            "copy",
            "-muxdelay",
            "0",
            "-muxpreload",
            "0",
            "-f",
            "mpegts",
            "pipe:1",
          ]);

          res.setHeader("Content-Type", "video/MP2T");
          ff.stdout.pipe(res);

          let ffmpegStderr = "";
          ff.stderr.on("data", (data) => {
            ffmpegStderr += data.toString();
          });

          ff.on("close", (code) => {
            if (code !== 0) {
              console.error(
                "FFmpeg stream transcoding failed with code",
                code,
                ffmpegStderr,
              );
            }
          });

          ff.on("error", (err) => {
            console.error("FFmpeg process error:", err.message);
          });

          // Fetch segment as stream
          const response = await global.axios.get(targetUrl, {
            responseType: "stream",
            headers: {
              ...headers,
              Accept: "*/*",
              Connection: "keep-alive",
            },
          });

          // Decrypt segment stream and pipe it to FFmpeg stdin
          const decipher = crypto.createDecipheriv(
            "aes-128-cbc",
            keyBuffer,
            iv,
          );
          decipher.setAutoPadding(false);

          response.data.pipe(decipher).pipe(ff.stdin);
          return;
        } catch (err) {
          console.error("Error decrypting/transcoding segment:", err.message);
          return res.status(500).json({ error: "Failed to process segment" });
        }
      }

      const headers = getHeaders(targetUrl);

      try {
        const response = await global.axios.get(targetUrl, {
          responseType: "arraybuffer",
          headers: {
            ...headers,
            Accept: "*/*",
            Connection: "keep-alive",
          },
        });

        let contentType =
          response.headers["content-type"] ||
          response.headers["Content-Type"] ||
          "";
        if (
          targetUrl.includes(".jpg") ||
          targetUrl.includes("/segment-") ||
          targetUrl.includes(".ts")
        ) {
          contentType = "video/MP2T";
        }
        res.setHeader("Content-Type", contentType);

        const lowerContentType = contentType.toLowerCase();
        const isPlaylist =
          lowerContentType.includes("mpegurl") ||
          lowerContentType.includes("application/x-mpegurl") ||
          lowerContentType.includes("application/vnd.apple.mpegurl") ||
          targetUrl.includes(".m3u8");

        if (isPlaylist) {
          let m3u8Data = response.data.toString("utf-8");

          let lines = m3u8Data.split(/\r?\n/);
          let currentKeyUrl = null;
          let currentIv = null;
          let mediaSequence = 1;

          const mediaSeqLine = lines.find((l) =>
            l.trim().startsWith("#EXT-X-MEDIA-SEQUENCE:"),
          );
          if (mediaSeqLine) {
            const seqMatch = mediaSeqLine.match(/#EXT-X-MEDIA-SEQUENCE:(\d+)/);
            if (seqMatch) {
              mediaSequence = parseInt(seqMatch[1], 10);
            }
          }

          let segmentCount = 0;

          lines = lines.map((line) => {
            const trimmed = line.trim();
            if (!trimmed) return line;

            if (trimmed.startsWith("#")) {
              if (trimmed.startsWith("#EXT-X-KEY:METHOD=AES-128")) {
                const keyMatch = trimmed.match(
                  /METHOD=AES-128,URI="([^"]+)"(?:,IV=([^,]+))?/,
                );
                if (keyMatch) {
                  let rawUri = keyMatch[1];
                  let absoluteKeyUri = rawUri;
                  if (
                    !rawUri.startsWith("http://") &&
                    !rawUri.startsWith("https://")
                  ) {
                    try {
                      absoluteKeyUri = new URL(rawUri, targetUrl).href;
                    } catch (e) {}
                  }
                  currentKeyUrl = absoluteKeyUri;
                  currentIv = keyMatch[2] || null;
                }
                return "# KEY REMOVED BY PROXY";
              }

              return line.replace(/URI="([^"]+)"/g, (match, p1) => {
                let absoluteUri = p1;
                if (!p1.startsWith("http://") && !p1.startsWith("https://")) {
                  try {
                    absoluteUri = new URL(p1, targetUrl).href;
                  } catch (e) {
                    return match;
                  }
                }
                return `URI="/proxy?url=${encodeURIComponent(absoluteUri)}"`;
              });
            }

            // It's a segment or playlist URL
            let absoluteUrl = trimmed;
            if (
              !trimmed.startsWith("http://") &&
              !trimmed.startsWith("https://")
            ) {
              try {
                absoluteUrl = new URL(trimmed, targetUrl).href;
              } catch (e) {
                return line;
              }
            }

            if (currentKeyUrl) {
              const segIv = currentIv || String(mediaSequence + segmentCount);
              segmentCount++;
              return `/proxy?url=${encodeURIComponent(absoluteUrl)}&keyUrl=${encodeURIComponent(currentKeyUrl)}&iv=${encodeURIComponent(segIv)}`;
            } else {
              return `/proxy?url=${encodeURIComponent(absoluteUrl)}`;
            }
          });

          m3u8Data = lines.join("\n");
          return res.send(m3u8Data);
        }

        return res.end(response.data);
      } catch (error) {
        console.error("Error fetching video:", error.message);
        res.status(500).json({ error: "Failed to fetch video" });
      }
    }
  } catch (error) {
    console.error("Error fetching video:", error.message);
    res.status(500).json({ error: "Failed to fetch video" });
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

    const options = { responseType: "arraybuffer" };
    let response;
    try {
      response = await global.axios.get(decodedUrl, options);
    } catch (err) {
      if (
        err.response &&
        (err.response.status === 403 || err.response.status === 503) &&
        global.cloudflarebypass
      ) {
        console.log(
          "Image proxy 403/503 detected. Retrying with Cloudflare bypass...",
        );
        if (decodedUrl.includes("animepahe")) {
          const paheCheck = (title, html) =>
            title.toLowerCase().includes("animepahe") &&
            !title.toLowerCase().includes("just a moment");
          await global
            .cloudflarebypass("https://animepahe.pw", paheCheck, true)
            .catch(() => {});
        } else if (
          decodedUrl.includes("allmanga") ||
          decodedUrl.includes("allanime") ||
          decodedUrl.includes("youtube-anime")
        ) {
          const allmangaCheck = (title, html) =>
            html.includes("__NUXT__") ||
            title.toLowerCase().includes("allmanga");
          await global
            .cloudflarebypass("https://allmanga.to/", allmangaCheck, true)
            .catch(() => {});
        } else if (decodedUrl.includes("anikoto")) {
          const anikotoCheck = (title, html) =>
            title.toLowerCase().includes("anikoto") &&
            !title.toLowerCase().includes("just a moment");
          await global
            .cloudflarebypass("https://anikototv.to", anikotoCheck, true)
            .catch(() => {});
        }
        response = await global.axios.get(decodedUrl, options);
      } else {
        throw err;
      }
    }
    const contentType = response.headers["content-type"] || "image/jpeg";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(response.data);
  } catch (err) {
    console.error("Image proxy direct fetch failed:", err.message);
    res.status(500).send("Failed to load image");
  }
});

// Delete Local Database Entry
router.post("/api/local/remove", async (req, res) => {
  try {
    const { id, type } = req.body;
    if (!id || !type) throw new Error("ID or Type is missing");

    const setting = await settingfetch();
    const baseDir =
      setting?.CustomDownloadLocation || (await getDownloadsFolder());
    let typeDir = path.join(baseDir, type, id);

    if (!fs.existsSync(typeDir)) {
      try {
        const downloads = global.db
          .prepare(`SELECT * FROM ${type} WHERE id = ?`)
          .all(id);
        if (downloads && downloads.length > 0) {
          const folderName =
            downloads[0].folder_name ||
            downloads[0].title?.replace(/[^a-zA-Z0-9]/g, "_");
          typeDir = path.join(baseDir, type, folderName);
        }
      } catch (e) {
        // ignore global.db errors
      }
    }

    if (fs.existsSync(typeDir)) {
      await fs.promises.rm(typeDir, { recursive: true, force: true });
    }

    const { MetadataRemove } = require("./utils/Metadata");
    await MetadataRemove(type, id);

    return res.json({ error: false, message: "Deleted successfully" });
  } catch (err) {
    logger.error(`Error deleting local entry: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Delete Local Episode
router.post("/api/local/delete-episode", async (req, res) => {
  try {
    const { id, epnum, subdub } = req.body;
    if (!id || !epnum || !subdub) throw new Error("Missing parameters");

    const setting = await settingfetch();
    const baseDir =
      setting?.CustomDownloadLocation || (await getDownloadsFolder());
    let typeDir = path.join(baseDir, "Anime", id);

    if (!fs.existsSync(typeDir)) {
      const idStripped = id.replace(/-(dub|sub|both)$/, "");
      const downloads = global.db
        .prepare("SELECT * FROM Anime WHERE id = ?")
        .all(`${idStripped}-${subdub}`);
      if (downloads && downloads.length > 0) {
        const folderName =
          downloads[0].folder_name ||
          downloads[0].title?.replace(/[^a-zA-Z0-9]/g, "_");
        typeDir = path.join(baseDir, "Anime", folderName);
      }
    }

    if (fs.existsSync(typeDir)) {
      const files = await fs.promises.readdir(typeDir);

      const filesToDelete = files.filter((file) => {
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
          const num = parseFloat(match[0]);
          return num === parseFloat(epnum);
        }
        return false;
      });

      if (filesToDelete.length > 0) {
        for (const fileToDelete of filesToDelete) {
          await fs.promises.unlink(path.join(typeDir, fileToDelete));
        }
        return res.json({ error: false, message: "Episode deleted" });
      } else {
        throw new Error("Episode file not found");
      }
    } else {
      throw new Error("Anime folder not found on disk");
    }
  } catch (err) {
    logger.error(`Error deleting episode: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Delete Multiple Local Episodes or Chapters
router.post("/api/local/delete-multiple", async (req, res) => {
  try {
    const { id, type, numbers, subdub } = req.body;
    if (!id || !type || !numbers || !Array.isArray(numbers)) {
      throw new Error("Missing or invalid parameters");
    }

    const setting = await settingfetch();
    const baseDir =
      setting?.CustomDownloadLocation || (await getDownloadsFolder());

    let typeDir = path.join(baseDir, type, id);

    if (!fs.existsSync(typeDir)) {
      if (type === "Anime") {
        const idStripped = id.replace(/-(dub|sub|both)$/, "");
        const downloads = global.db
          .prepare("SELECT * FROM Anime WHERE id = ?")
          .all(subdub ? `${idStripped}-${subdub}` : id);
        if (downloads && downloads.length > 0) {
          const folderName =
            downloads[0].folder_name ||
            downloads[0].title?.replace(/[^a-zA-Z0-9]/g, "_");
          typeDir = path.join(baseDir, "Anime", folderName);
        }
      } else {
        const downloads = global.db
          .prepare("SELECT * FROM Manga WHERE id = ?")
          .all(id);
        if (downloads && downloads.length > 0) {
          const folderName =
            downloads[0].folder_name ||
            downloads[0].title?.replace(/[^a-zA-Z0-9]/g, "_");
          typeDir = path.join(baseDir, "Manga", folderName);
        }
      }
    }

    if (fs.existsSync(typeDir)) {
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
            if (
              !videoExtensions.includes(ext) &&
              !subExtensions.includes(ext)
            ) {
              return false;
            }
            const match = file.match(/^\d+(\.\d+)?/);
            if (match) {
              const fileEpNum = parseFloat(match[0]);
              return fileEpNum === targetNum;
            }
          } else {
            if (
              file.toLowerCase().endsWith(".cbz") &&
              file.toLowerCase().includes("chapter")
            ) {
              const match = file.toLowerCase().match(/chapter\s*([\d.]+)/);
              if (match) {
                const fileChapNum = parseFloat(match[1]);
                return fileChapNum === targetNum;
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

      return res.json({
        error: false,
        message: `Successfully deleted ${deletedCount} files`,
      });
    } else {
      throw new Error(`${type} folder not found on disk`);
    }
  } catch (err) {
    logger.error(`Error in /api/local/delete-multiple: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Helper for MyAnimeList auto-tracking at 75% progress
async function autoTrackMAL(type, mediaId, number) {
  try {
    if (!global.MalLoggedIn) return;
    const tableName = type === "Anime" ? "Anime" : "Manga";
    let localRecord = null;

    if (type === "Anime") {
      const strippedId = mediaId.replace(/-(dub|sub|both)$/, "");
      localRecord = global.db
        .prepare(
          `
        SELECT MalID FROM Anime 
        WHERE id = ? OR id = ? OR id = ? OR id = ? OR folder_name = ? OR folder_name = ?
      `,
        )
        .get(
          mediaId,
          `${strippedId}-sub`,
          `${strippedId}-dub`,
          `${strippedId}-both`,
          mediaId,
          strippedId,
        );
    } else {
      localRecord = global.db
        .prepare(`SELECT MalID FROM Manga WHERE id = ? OR folder_name = ?`)
        .get(mediaId, mediaId);
    }

    if (localRecord && localRecord.MalID) {
      const malid = parseInt(localRecord.MalID);
      if (malid) {
        const { MalAddToList } = require("./utils/mal");
        const malListTable = type === "Anime" ? "MyAnimeList" : "MyMangaList";
        const totalCol = type === "Anime" ? "totalEpisodes" : "totalChapters";
        const malInfo = global.db
          .prepare(
            `SELECT status, ${totalCol} FROM ${malListTable} WHERE id = ?`,
          )
          .get(String(malid));
        let nextStatus =
          malInfo?.status || (type === "Anime" ? "watching" : "reading");

        const total = malInfo ? malInfo[totalCol] : null;
        if (total && number >= total) {
          nextStatus = "completed";
        }

        logger.info(
          `[MAL Auto-Tracking] Syncing ${type} ${mediaId} (MAL ID: ${malid}) progress: ${number} with status: ${nextStatus}`,
        );
        await MalAddToList(type.toLowerCase(), malid, nextStatus, number);

        // Update local database cache immediately
        const progressCol = type === "Anime" ? "watched" : "read";
        try {
          global.db
            .prepare(
              `
            UPDATE ${malListTable}
            SET ${progressCol} = ?, status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
          `,
            )
            .run(number, nextStatus, String(malid));
        } catch (dbErr) {
          logger.error(
            `Error updating local MAL table in autoTrackMAL: ${dbErr.message}`,
          );
        }

        // Show native system notification
        try {
          let displayTitle = type;
          const titleRecord = global.db
            .prepare(`SELECT title FROM ${tableName} WHERE id = ?`)
            .get(mediaId);
          displayTitle = titleRecord?.title || type;

          const { Notification } = require("electron");
          if (Notification.isSupported()) {
            const notif = new Notification({
              title: "MAL Auto-Tracking Sync",
              body: `Synced "${displayTitle}" ${type === "Anime" ? "Episode" : "Chapter"} ${number} (${nextStatus.toUpperCase()}) to MAL.`,
              icon: path.join(__dirname, "..", "assets", "luffy.png"),
            });
            notif.show();
          }
        } catch (notifErr) {
          logger.error(
            `Failed to show MAL sync notification: ${notifErr.message}`,
          );
        }
      }
    }
  } catch (err) {
    logger.error(`Error in MAL Auto-Tracking: ${err.message}`);
  }
}

// Reset Discord RPC to Idle (called when leaving player/reader)
router.post("/api/discord/reset", async (req, res) => {
  try {
    const { UpdateDiscordRPC } = require("./utils/discord");
    UpdateDiscordRPC().catch(() => {});
    res.json({ success: true });
  } catch (err) {
    res.json({ success: false });
  }
});

// Update tracking/history progress
router.post("/api/history/update", async (req, res) => {
  try {
    const {
      mediaId,
      type,
      title,
      number,
      currentTime,
      duration,
      timeSpent,
      image,
    } = req.body;
    if (!mediaId || !type || !number) {
      throw new Error("Missing parameters for history update");
    }

    const tSpent = parseFloat(timeSpent || 0);
    const parsedNum = parseFloat(number);

    if (type === "Anime") {
      // Find or build correct anime title
      let animeTitle = title;
      if (!animeTitle || animeTitle === "Anime") {
        try {
          const localRec = global.db
            .prepare(`SELECT title FROM Anime WHERE id = ?`)
            .get(mediaId);
          if (localRec && localRec.title) {
            animeTitle = localRec.title;
          }
        } catch (e) {}
      }
      if (!animeTitle || animeTitle === "Anime") {
        if (mediaId && mediaId.includes(":")) {
          const parts = mediaId.split(":");
          const slug = parts[parts.length - 1];
          animeTitle = slug
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        }
      }

      // Sync across all sibling provider IDs linked to same MAL ID
      let siblingIds = [mediaId];
      try {
        const localRec = global.db
          .prepare(`SELECT MalID FROM Anime WHERE id = ?`)
          .get(mediaId);
        if (localRec && localRec.MalID) {
          const siblings = global.db
            .prepare(`SELECT id FROM Anime WHERE MalID = ?`)
            .all(localRec.MalID);
          siblings.forEach((s) => {
            if (s.id) siblingIds.push(s.id);
          });
        }
      } catch (err) {}

      let queryIds = [];
      siblingIds.forEach((id) => {
        queryIds.push(id);
        const stripped = id.replace(/-(dub|sub|both)$/, "");
        queryIds.push(`${stripped}-sub`, `${stripped}-dub`, `${stripped}-both`);
      });
      queryIds = Array.from(new Set(queryIds));

      const placeholders = queryIds.map(() => "?").join(",");
      let record = global.db
        .prepare(
          `
        SELECT * FROM WatchHistory 
        WHERE anime_id IN (${placeholders}) AND episode_number = ?
      `,
        )
        .get(...queryIds, parsedNum);

      if (!record && animeTitle && animeTitle !== "Anime") {
        record = global.db
          .prepare(
            `
          SELECT * FROM WatchHistory 
          WHERE LOWER(anime_title) = LOWER(?) AND episode_number = ?
        `,
          )
          .get(animeTitle, parsedNum);
      }

      const curTime = parseFloat(currentTime || 0);
      const dur = parseFloat(duration || 0);
      const isComp = dur > 0 && curTime / dur >= 0.75 ? 1 : 0;

      if (record) {
        const nextComp = record.is_completed === 1 ? 1 : isComp;
        const compAt =
          record.is_completed === 0 && nextComp === 1
            ? new Date().toISOString()
            : record.completed_at;

        global.db
          .prepare(
            `
          UPDATE WatchHistory 
          SET anime_id = ?, anime_title = ?, current_time = ?, duration = ?, time_spent = time_spent + ?, is_completed = ?, last_watched = CURRENT_TIMESTAMP, completed_at = ?
          WHERE id = ?
        `,
          )
          .run(
            mediaId,
            animeTitle || "Anime",
            curTime,
            dur,
            tSpent,
            nextComp,
            compAt,
            record.id,
          );

        if (record.is_completed === 0 && nextComp === 1) {
          await autoTrackMAL("Anime", mediaId, parsedNum);
        }
      } else {
        const compAt = isComp === 1 ? new Date().toISOString() : null;
        global.db
          .prepare(
            `
          INSERT INTO WatchHistory (anime_id, anime_title, episode_number, current_time, duration, time_spent, is_completed, last_watched, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `,
          )
          .run(
            mediaId,
            animeTitle || "Anime",
            parsedNum,
            curTime,
            dur,
            tSpent,
            isComp,
            compAt,
          );

        if (isComp === 1) {
          await autoTrackMAL("Anime", mediaId, parsedNum);
        }
      }

      // Call Discord RPC Update
      try {
        const { UpdateDiscordRPC } = require("./utils/discord");
        UpdateDiscordRPC(
          animeTitle || "Anime",
          parsedNum,
          "Anime",
          image,
          mediaId,
          currentTime,
          duration,
        ).catch(() => {});
      } catch (rpcErr) {}
    } else {
      // Find or build correct manga title
      let mangaTitle = title;
      if (!mangaTitle || mangaTitle === "Manga") {
        try {
          const localRec = global.db
            .prepare(`SELECT title FROM Manga WHERE id = ?`)
            .get(mediaId);
          if (localRec && localRec.title) {
            mangaTitle = localRec.title;
          }
        } catch (e) {}
      }
      if (!mangaTitle || mangaTitle === "Manga") {
        if (mediaId && mediaId.includes(":")) {
          const parts = mediaId.split(":");
          const slug = parts[parts.length - 1];
          mangaTitle = slug
            .split("-")
            .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
            .join(" ");
        }
      }

      // Sync across all sibling provider IDs linked to same MAL ID
      let siblingIds = [mediaId];
      try {
        const localRec = global.db
          .prepare(`SELECT MalID FROM Manga WHERE id = ?`)
          .get(mediaId);
        if (localRec && localRec.MalID) {
          const siblings = global.db
            .prepare(`SELECT id FROM Manga WHERE MalID = ?`)
            .all(localRec.MalID);
          siblings.forEach((s) => {
            if (s.id) siblingIds.push(s.id);
          });
        }
      } catch (err) {}

      let queryIds = Array.from(new Set(siblingIds));
      const placeholders = queryIds.map(() => "?").join(",");
      let record = global.db
        .prepare(
          `
        SELECT * FROM ReadHistory 
        WHERE manga_id IN (${placeholders}) AND chapter_number = ?
      `,
        )
        .get(...queryIds, parsedNum);

      if (!record && mangaTitle && mangaTitle !== "Manga") {
        record = global.db
          .prepare(
            `
          SELECT * FROM ReadHistory 
          WHERE LOWER(manga_title) = LOWER(?) AND chapter_number = ?
        `,
          )
          .get(mangaTitle, parsedNum);
      }

      const curPage = parseInt(currentTime || 1);
      const totPages = parseInt(duration || 1);
      const isComp = totPages > 0 && curPage / totPages >= 0.75 ? 1 : 0;

      if (record) {
        const nextComp = record.is_completed === 1 ? 1 : isComp;
        const compAt =
          record.is_completed === 0 && nextComp === 1
            ? new Date().toISOString()
            : record.completed_at;

        global.db
          .prepare(
            `
          UPDATE ReadHistory 
          SET manga_id = ?, manga_title = ?, current_page = ?, total_pages = ?, time_spent = time_spent + ?, is_completed = ?, last_read = CURRENT_TIMESTAMP, completed_at = ?
          WHERE id = ?
        `,
          )
          .run(
            mediaId,
            mangaTitle || "Manga",
            curPage,
            totPages,
            tSpent,
            nextComp,
            compAt,
            record.id,
          );

        if (record.is_completed === 0 && nextComp === 1) {
          await autoTrackMAL("Manga", mediaId, parsedNum);
        }
      } else {
        const compAt = isComp === 1 ? new Date().toISOString() : null;
        global.db
          .prepare(
            `
          INSERT INTO ReadHistory (manga_id, manga_title, chapter_number, current_page, total_pages, time_spent, is_completed, last_read, completed_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
        `,
          )
          .run(
            mediaId,
            mangaTitle || "Manga",
            parsedNum,
            curPage,
            totPages,
            tSpent,
            isComp,
            compAt,
          );

        if (isComp === 1) {
          await autoTrackMAL("Manga", mediaId, parsedNum);
        }
      }

      // Call Discord RPC Update
      try {
        const { UpdateDiscordRPC } = require("./utils/discord");
        UpdateDiscordRPC(
          mangaTitle || "Manga",
          parsedNum,
          "Manga",
          image,
          mediaId,
          currentTime,
          duration,
        ).catch(() => {});
      } catch (rpcErr) {}
    }

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
      const strippedId = mediaId.replace(/-(dub|sub|both)$/, "");
      queryIds.push(
        `${strippedId}-sub`,
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
    const limit = parseInt(req.query.limit || 50);

    const watchLogs = global.db
      .prepare(
        `
      SELECT 
        id,
        'Anime' AS type,
        anime_id AS media_id,
        anime_title AS title,
        episode_number AS number,
        current_time,
        duration,
        time_spent,
        is_completed,
        last_watched AS date
      FROM WatchHistory
      ORDER BY last_watched DESC
      LIMIT ?
    `,
      )
      .all(limit);

    const readLogs = global.db
      .prepare(
        `
      SELECT 
        id,
        'Manga' AS type,
        manga_id AS media_id,
        manga_title AS title,
        chapter_number AS number,
        current_page AS current_time,
        total_pages AS duration,
        time_spent,
        is_completed,
        last_read AS date
      FROM ReadHistory
      ORDER BY last_read DESC
      LIMIT ?
    `,
      )
      .all(limit);

    const combined = [...watchLogs, ...readLogs]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    res.json(combined);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
