// Libs
const { app } = require("electron");
const express = require("express");
const axios = require("axios");
const JSZip = require("jszip");
const path = require("path");
const fs = require("fs");
const router = express.Router();

// functions
const { ensureDirectoryExists } = require("./utils/DirectoryMaker");
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
} = require("./utils/AnimeManga");
const { logger, getLogs } = require("./utils/AppLogger");
const {
  settingupdate,
  settingfetch,
  providerFetch,
} = require("./utils/settings");
const { getQueue, updateQueue, removeQueue } = require("./utils/queue");
const { MalCreateUrl, MalVerifyToken, MalAddToList } = require("./utils/mal");
const {
  getAllMetadata,
  FindMapping,
  getSourceById,
  MalPage,
} = require("./utils/Metadata");

// ===================== API routes =====================
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
    autotrack,
    CustomDownloadLocation,
    Animeprovider,
    Mangaprovider,
    Pagination,
    autoLoadNextChapter,
    enableDiscordRPC,
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

    if (autotrack && autotrack !== "on" && autotrack !== "off")
      return res.status(400).json({ error: "Enter on / off in autotracking." });

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
    });

    const data = await settingfetch();

    message = [
      `Quality: ${data?.quality}`,
      `${data?.mal_on_off ? `Auto Add To: ${data?.status}` : ""}`,
      `${data?.mal_on_off ? `Auto Track Ep: ${data?.autotrack}` : ""}`,
      `Download Location: ${data?.CustomDownloadLocation}`,
      `Anime Provider : ${data?.Animeprovider}`,
      `Manga Provider : ${data?.Mangaprovider}`,
      `Autoload Next Chapter : ${data?.autoLoadNextChapter}`,
      `Pagination : ${data?.Pagination}`,
      `Discord RPC Enabled: ${data?.enableDiscordRPC}`,
    ]
      .filter(Boolean)
      .join("\n");

    res.status(200).json({ message: message });
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
    let queue = (await updateQueue(epid, totalSegments, currentSegments)) ?? [];

    if (totalSegments !== currentSegments) {
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
        let { id, ep, Title, number, provider } = req.body;
        MessageData = await downloadAnimeSingle(
          provider,
          id,
          ep,
          number,
          Title,
          true
        );
      } else if (singleMulti === "Multi") {
        let { id, Episodes, Title, SubDub, provider } = req.body;
        MessageData = await downloadAnimeMulti(
          provider,
          id,
          Episodes,
          Title,
          SubDub
        );
      }
    } else if (AnimeManga === "Manga") {
      if (singleMulti === "Single") {
        let { id, ep, Title, number, provider } = req.body;
        MessageData = await downloadMangaSingle(
          provider,
          id,
          ep,
          number,
          Title,
          true
        );
      } else if (singleMulti === "Multi") {
        let { id, Chapters, Title, provider } = req.body;
        MessageData = await downloadMangaMulti(provider, id, Chapters, Title);
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
          filters?.page
        );
      } else if (provider === "mal") {
        data = await MalPage(config.Animeprovider, filters?.page);
      } else if (provider === "provider") {
        const provider = await providerFetch("Anime");
        data = await latestAnime(provider, filters);
        data = { ...data, site: config.Animeprovider };
      } else if (provider === "search") {
        const provider = await providerFetch("Anime");
        data = await animesearch(provider, req?.query?.query, filters);
        data = { ...data, site: config.Animeprovider };
      }
    } else if (AnimeManga === "Manga") {
      if (provider === "local") {
        data = await getAllMetadata(
          "Manga",
          config?.CustomDownloadLocation,
          filters?.page
        );
      } else if (provider === "provider") {
        const provider = await providerFetch("Manga");
        data = await latestMangas(provider, filters?.page);
      } else if (provider === "search") {
        const provider = await providerFetch("Manga");
        data = await MangaSearch(provider, req?.query?.query, filters?.page);
      }
    }

    if (!data) throw new Error(`No ${AnimeManga} Found in ${provider}`);
    return res.json(data);
  } catch (err) {
    logger.error(
      `Failed To Fetch ${provider} ${AnimeManga} page ${filters?.page}`
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

    if (LocalMalProvider === "local") {
      try {
        let AnimeLocalInfo = await FindMapping(
          AnimeManga,
          id,
          null,
          setting.CustomDownloadLocation
        );
        if (AnimeLocalInfo) {
          if (AnimeLocalInfo?.genres) {
            AnimeLocalInfo.genres = AnimeLocalInfo.genres.split(",");
          }
          data = AnimeLocalInfo;
          provider = AnimeLocalInfo?.provider;
        }

        if (global?.MalLoggedIn) {
          data = { ...data, MalLoggedIn: true };
        }
      } catch (err) {
        console.log(err);
        throw new Error(`No ${AnimeManga} Found with id '${id}'`);
      }
    }

    try {
      if (AnimeManga === "Anime") {
        let Animeprovider = await providerFetch("Anime", provider ?? null);
        let AnimeInfo = await animeinfo(
          Animeprovider,
          setting?.CustomDownloadLocation,
          id,
          data?.provider ? false : true
        );

        data = {
          ...data,
          ...AnimeInfo,
        };
      } else if (AnimeManga === "Manga") {
        let Mangaprovider = await providerFetch("Manga", provider ?? null);
        data = { ...data, ...(await MangaInfo(Mangaprovider, id)) };
      }
    } catch (err) {
      throw err;
    }

    if (!data?.id) throw new Error(`No ${AnimeManga} Found with id '${id}'`);

    return res.json(data);
  } catch (err) {
    logger.error(
      `Failed To Fetch ${LocalMalProvider} ${AnimeManga} with AnimeID : '${id}'`
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
  let { id, provider } = req.body;
  try {
    if (!id) throw new Error("ID is Missing");

    const Mangaprovider = await providerFetch("Manga", provider ?? null);
    const data = await fetchChapters(Mangaprovider, id);
    if (!data) throw new Error("No Episodes Found");

    return res.json(data);
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
    Response.caption = itemWithSegments.caption;
    Response.totalSegments = itemWithSegments.totalSegments;
    Response.currentSegments = itemWithSegments.currentSegments;
    Response.queue = queue.filter(
      (item) => item?.epid !== itemWithSegments?.epid
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
          global.win.webContents.send("download-logger", {
            caption: itemWithSegments.caption,
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
    queue = queue.filter((item) => item.totalSegments <= 0);

    for (const anime of queue) {
      await removeQueue(anime.epid);
    }

    global.win.webContents.send("download-logger", {
      queue,
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
  const { ep, epNum, Downloaded, provider = null } = req.body;
  try {
    if (!Downloaded) {
      if (!ep) throw new Error("Episode ID Not Found");
      const Animeprovider = await providerFetch("Anime", provider);
      const sourcesArray = await fetchEpisodeSources(Animeprovider, ep);
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
        epNum
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

      // Subtitles : TODO
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
      "Content-Type": "video/mp4",
    });

    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
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
    return res.sendFile(subtitlePath);
  } catch (err) {
    console.error("Error serving subtitle:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// get chapter
router.post("/api/read", async (req, res) => {
  const { chapterID, Downloaded = false, MangaID } = req.body;
  try {
    if (!chapterID) throw new Error("");
    if (Downloaded) {
      if (!MangaID) throw new Error("");
      const config = await settingfetch();
      const SourcesData = await getSourceById(
        "Manga",
        config?.CustomDownloadLocation,
        MangaID,
        chapterID
      );

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
            }))
        );
        res.json(pages);
      } else {
        throw new Error("Chapter Not Found In Downloads!");
      }
    } else {
      const provider = await providerFetch("Manga");
      const chapters = await MangaChapterFetch(provider, chapterID);
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
    let { malid, episodes, status } = req.body;

    episodes = parseInt(episodes) || 0;

    switch (status) {
      case "watching":
      case "completed":
      case "plan_to_watch":
      case "on_hold":
      case "dropped":
        break;
      default:
        status = null;
    }

    if (!malid || !status) throw new Error("Some thing is missing");

    let data = await MalAddToList(malid, status, episodes);

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

// ===================== routes =====================

// Local Anime Page
router.get(["/", "/local/anime"], async (req, res) => {
  const config = await settingfetch();
  res.render("index.ejs", {
    catagorie: "Local Anime's",
    api: "/api/list/Anime/local",
    infoapi: "/info/Anime/local?id=",
    Pagination: config?.Pagination || "off",
  });
});

// Local Manga Page
router.get("/local/manga", async (req, res) => {
  const config = await settingfetch();
  res.render("index.ejs", {
    catagorie: "Local Manga's",
    api: "/api/list/Manga/local",
    infoapi: "/info/Manga/local?id=",
    Pagination: config?.Pagination || "off",
  });
});

// home page anime
router.get("/anime", async (req, res) => {
  const config = await settingfetch();
  res.render("index.ejs", {
    catagorie: "Recent Anime's",
    api: "/api/list/Anime/provider",
    infoapi: "/info/Anime/provider?id=",
    Pagination: config?.Pagination || "off",
  });
});

// Mal Page Anime
router.get("/mal/anime", async (req, res) => {
  const config = await settingfetch();
  res.render("index.ejs", {
    catagorie: "MyAnimelist Anime's",
    api: "/api/list/Anime/mal",
    infoapi: "/info/Anime/provider?id=",
    Pagination: config?.Pagination || "off",
  });
});

// home page manga
router.get("/manga", async (req, res) => {
  const config = await settingfetch();
  res.render("index.ejs", {
    catagorie: "Latest Manga's",
    api: "/api/list/Manga/provider",
    infoapi: "/info/Manga/provider?id=",
    Pagination: config?.Pagination || "off",
  });
});

// search anime
router.get("/search", async (req, res) => {
  const anime = req?.query?.animetosearch;
  const manga = req?.query?.mangatosearch;

  const config = await settingfetch();
  res.render("index.ejs", {
    catagorie: `Results For ${anime ? anime : manga}`,
    api: `/api/list/${anime ? "Anime" : "Manga"}/search?query=${
      anime ? anime : manga
    }`,
    infoapi: `/info/${anime ? "Anime" : "Manga"}/provider?id=`,
    Pagination: config?.Pagination || "off",
  });
});

// settings
router.get("/setting", async (req, res) => {
  try {
    const setting = await settingfetch();
    let url = null;
    
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
    };

    if (!setting.mal_on_off || setting.mal_on_off === null) {
      url = await MalCreateUrl();
      return res.render("settings.ejs", { settings: settingsWithProviders, url: url });
    }
    res.render("settings.ejs", {
      settings: settingsWithProviders,
      url: url,
    });
  } catch (err) {
    logger.error(err);
    res.render("error.ejs", {
      error: err,
    });
  }
});

// log page
router.get("/log", async (req, res) => {
  const logs = await getLogs();
  res.render("logs.ejs", { logs });
});

// info page
router.get("/info/:AnimeManga/:LocalMalProvider", async (req, res) => {
  const { AnimeManga, LocalMalProvider } = req.params;
  let id = decodeURIComponent(req?.query?.id ?? "");
  const setting = await settingfetch();
  try {
    if (!id) throw new Error(`No ${AnimeManga} 'id' found in request!`);
    if (
      (AnimeManga === "Anime" || AnimeManga === "Manga") &&
      (LocalMalProvider === "provider" || LocalMalProvider === "local")
    ) {
      return res.render("info.ejs", {
        type: AnimeManga,
        infoapi: `/api/info/${AnimeManga}/${LocalMalProvider}`,
        id: id,
        autoLoadNextChapter: setting?.autoLoadNextChapter ?? "on",
      });
    }
    throw new Error("Something is missing in request /info");
  } catch (err) {
    logger.error(`Failed To Fetch Anime Info`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    res.render("error.ejs", {
      error: err.message,
    });
  }
});

// downloads page
router.get("/downloads", async (req, res) => {
  return res.render("downloads.ejs");
});

// Proxy for m3u8
router.get("/proxy", async (req, res) => {
  try {
    if (req?.query?.hianime) {
      try {
        const response = await axios.get(
          decodeURIComponent(req.query.hianime),
          {
            responseType: "arraybuffer",
            headers: {
              Referer: "https://megacloud.blog/",
              "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
              Accept: "*/*",
              Connection: "keep-alive",
            },
          }
        );

        const contentType = response.headers["content-type"];
        res.setHeader("Content-Type", contentType);

        if (
          contentType.includes("application/vnd.apple.mpegurl") ||
          contentType.includes("video/MP2T")
        ) {
          let m3u8Data = response.data.toString("utf-8");

          m3u8Data = m3u8Data.replace(
            /^https?:\/\/.*$/gm,
            (match) => `/proxy?hianime=${encodeURIComponent(match)}`
          );

          return res.send(m3u8Data);
        }

        return res.send(response.data);
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

// Error Page
router.get("/error", async (req, res) => {
  return res.render("error.ejs", {
    error: req?.query?.message ?? "Internal Error",
  });
});

// MarketPlace
router.get("/marketplace", async (req, res) => {
  let AnimeManga = req.query.type?.trim() === "Anime" ? "Anime" : "Manga";
  return res.render("marketplace.ejs", {
    AppVersion: app.getVersion(),
    AnimeManga: AnimeManga,
    providers: {
      Anime: Object.entries(global.Anime_providers || {}).map(([key, val]) => ({
        name: key,
        version: val.version,
      })),
      Manga: Object.entries(global.Manga_providers || {}).map(([key, val]) => ({
        name: key,
        version: val.version,
      })),
    },
  });
});

module.exports = router;
