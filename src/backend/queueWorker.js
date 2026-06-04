// libs
const path = require("path");
const { download } = require("./utils/downloader");
const { logger } = require("./utils/AppLogger");

// imports
const { directoryMaker, MangaDir } = require("./utils/DirectoryMaker");
const {
  MangaChapterFetch,
  DownloadChapters,
  fetchEpisodeSources,
} = require("./utils/AnimeManga");
const {
  getQueue,
  saveQueue,
  removeQueue,
  SaveQueueData,
} = require("./utils/queue");
const { providerFetch } = require("./utils/settings");

// queue start
async function continuousExecution() {
  try {
    let AnimeQueue = await getQueue();

    while (true) {
      if (AnimeQueue?.length === 0) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
        AnimeQueue = await getQueue();
      }

      for (let i = 0; i < AnimeQueue.length; i++) {
        try {
          const currentTask = AnimeQueue[0];
          if (!currentTask) {
            break;
          }

          if (currentTask?.Type === "Anime") {
            let { config, Title, EpNum, epid, SubDub } = currentTask;
            if (config && Title && EpNum && epid && SubDub) {
              await downloadep(config, `${Title} ${SubDub}`, EpNum, epid, SubDub);
            } else {
              logger.error(
                `Error message: Some Anime Data missing [ removing from queue ]`,
              );
              AnimeQueue.splice(0, 1);
              await SaveQueueData(AnimeQueue);
              break;
            }
          } else if (currentTask?.Type === "Manga") {
            let { Title, EpNum, epid, ChapterTitle, config } = currentTask;
            if (Title && EpNum && epid && ChapterTitle && config) {
              await downloadMangaChapters(
                config,
                Title,
                EpNum,
                epid,
                ChapterTitle,
              );
            } else {
              logger.error(
                `Error message: Some Manga Data missing [ removing from queue  ]`,
              );
              AnimeQueue.splice(0, 1);
              await SaveQueueData(AnimeQueue);
              break;
            }
          } else {
            logger.error(
              `Error message: Type is Not Valid [ removing from queue  ]`,
            );
            AnimeQueue.splice(0, 1);
            await SaveQueueData(AnimeQueue);
            break;
          }
          await saveQueue();
          await new Promise((resolve) => setTimeout(resolve, 2000));
        } catch (err) {
          logger.error(`Error message: ${err.message}`);
          logger.error(`Stack trace: ${err.stack}`);
          AnimeQueue.splice(0, 1);
          await SaveQueueData(AnimeQueue);
          break;
        }
      }

      AnimeQueue = await getQueue();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  } catch (err) {
    console.error("Error in continuous execution:", err);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// start downloadloading ep
async function downloadep(Videoconfig, Title, EpNum, AnimeEpId, SubDub) {
  const directoryPath = await directoryMaker(
    Title,
    EpNum,
    Videoconfig?.CustomDownloadLocation,
  );
  try {
    await downloadEpisodeByQuality(
      Videoconfig,
      EpNum,
      directoryPath,
      Title,
      AnimeEpId,
      SubDub,
    );
  } catch (err) {
    throw err;
  }
}

// Download episode by quality
async function downloadEpisodeByQuality(
  config,
  episodeNumber,
  directoryName,
  Title,
  epid,
  subdub,
) {
  try {
    let preferredQualities = ["1080p", "720p", "360p", "default", "backup"];
    const provider = await providerFetch("Anime", config.Animeprovider);
    let resolvedEpid = epid;
    if (subdub && !epid.endsWith("-sub") && !epid.endsWith("-dub") && !epid.endsWith("-both")) {
      resolvedEpid = `${epid}-${subdub}`;
    }
    const sourcesArray = await fetchEpisodeSources(provider, resolvedEpid);

    let selectedSource = sourcesArray?.sources?.find(
      (source) => source?.quality === config?.quality ?? "1080p",
    );

    if (!selectedSource) {
      for (const quality of preferredQualities) {
        selectedSource = sourcesArray?.sources.find(
          (source) => source?.quality === quality,
        );
        if (selectedSource) break;
      }
    }

    if (
      !selectedSource &&
      sourcesArray?.sources[0]?.url &&
      sourcesArray?.sources[0]?.isM3U8
    ) {
      selectedSource = sourcesArray?.sources[0];
      selectedSource.quality = "best";
    }

    if (selectedSource) {
      await downloadVideo(
        selectedSource.url,
        directoryName,
        episodeNumber,
        selectedSource.quality,
        Title,
        epid,
        sourcesArray?.subtitles ?? [],
        config?.mergeSubtitles === "on" ? true : false,
        (config?.subtitleFormat ?? "ttv") === "srt",
        selectedSource.headers ?? {},
      );
    } else {
      throw new Error("No source link found.");
    }
  } catch (err) {
    throw err;
  }
}

// download video
async function downloadVideo(
  Url,
  directoryPath,
  episodeNumber,
  quality,
  Title,
  epid,
  subtitles = [],
  MergeSubtitles,
  subtitleFormat = false,
  headers = {},
) {
  try {
    await download({
      directory: directoryPath,
      Epnum: episodeNumber,
      streamUrl: Url,
      quality: quality,
      caption: `Downloading ${Title} || EP ${episodeNumber} [  ${quality}  ]`,
      EpID: epid,
      subtitles: subtitles,
      MergeSubtitles: MergeSubtitles,
      ChangeTosrt: subtitleFormat,
      headers: headers,
    });
  } catch (err) {
    throw new Error(`Failed To Download \n${err}`);
  }
}

// start downloadloading manga
async function downloadMangaChapters(
  config,
  Title,
  EpNum,
  ChapterId,
  ChapterTitle,
) {
  const provider = await providerFetch("Manga", config?.Mangaprovider);
  const ChapterData = await MangaChapterFetch(provider, ChapterId);

  if (!ChapterData || ChapterData?.length < 1) {
    await removeQueue(ChapterId);
    throw new Error("No Image Found For This Chapter!");
  }

  const directoryPath = await MangaDir(Title, config?.CustomDownloadLocation);
  try {
    const sanitizedChapterName = ChapterTitle.replace(/[<>:"/\\|?*]/g, "-");
    const outputFile = path.join(directoryPath, `${sanitizedChapterName}.cbz`);
    await DownloadChapters(
      outputFile,
      ChapterData,
      Title,
      ChapterTitle,
      ChapterId,
    );
  } catch (err) {
    throw err;
  }
}

module.exports = {
  continuousExecution,
};
