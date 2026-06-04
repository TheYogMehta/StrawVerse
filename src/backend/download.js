// imports
const { animeinfo, MangaInfo } = require("./utils/AnimeManga");
const { providerFetch, settingfetch } = require("./utils/settings");
const {
  addToQueue,
  checkEpisodeDownload,
  addMultipleToQueue,
} = require("./utils/queue");
const { MetadataAdd, FindMapping } = require("./utils/Metadata");

// Handles Multiple Episodes Download
async function downloadAnimeMulti(
  provider = null,
  animeid,
  Episodes = [],
  Title,
  SubDub,
  malid = null,
) {
  if (Episodes?.length <= 0)
    return {
      error: false,
      message: `No Episode Provided To Download!`,
    };

  Episodes.sort((a, b) => {
    const numA = parseFloat(a.number) || 0;
    const numB = parseFloat(b.number) || 0;
    return numA - numB;
  });

  let Message = {
    type: "info",
    message: "",
  };

  let success = 0;
  const itemsToAdd = [];

  const config = await settingfetch();
  const Animeprovider = await providerFetch("Anime", provider);

  for (let i = 0; i < Episodes.length; i++) {
    let Episode = Episodes[i];
    let data = await downloadAnimeSingle(
      provider,
      animeid,
      Episode.id,
      Episode.number,
      Title,
      i === 0,
      config,
      Animeprovider,
      true,
      malid,
      SubDub,
    );

    if (data?.error) {
      if (data?.message !== "Already downloaded") {
        Message.type = "error";
        Message.error = true;
      }
    } else if (data?.queueItem) {
      itemsToAdd.push(data.queueItem);
      success++;
    }
  }

  if (itemsToAdd.length > 0) {
    await addMultipleToQueue(itemsToAdd);
  }

  Message.message = `Added ${success} Episodes To Queue!`;

  return Message;
}

// Handles Single Episode Download
async function downloadAnimeSingle(
  provider = null,
  animeid,
  episodeid,
  number,
  Title,
  saveinfo = false,
  preFetchedConfig = null,
  preFetchedProvider = null,
  returnItemOnly = false,
  malid = null,
  subdub = null,
) {
  try {
    const config = preFetchedConfig || (await settingfetch());
    const Animeprovider =
      preFetchedProvider || (await providerFetch("Anime", provider));

    let resolvedSubDub = subdub;
    if (!resolvedSubDub) {
      resolvedSubDub = animeid.endsWith("dub") ? "dub" : "sub";
    }

    const strippedId = animeid.replace(/-(sub|dub|both)$/, "");
    const dbId = `${strippedId}-${resolvedSubDub}`;

    if (saveinfo) {
      const animedata = await animeinfo(
        Animeprovider,
        config?.CustomDownloadLocation,
        animeid,
      );
      if (animedata) {
        MetadataAdd("Anime", {
          id: dbId,
          title: `${animedata?.title?.replace(/-(dub|sub|both)$/, ``)} ${
            resolvedSubDub
          }`,
          provider: Animeprovider.provider_name,
          subOrDub: resolvedSubDub,
          type: animedata.type ?? null,
          description: animedata.description ?? null,
          status: animedata.status ?? null,
          genres:
            animedata?.genres?.length > 0 ? animedata?.genres?.join(",") : "",
          aired: animedata?.aired ?? null,
          ImageUrl: animedata?.image,
          EpisodesDataId: animedata?.dataId,
          MalID: malid ? String(malid) : null,
        });
      }
    }

    let is_in_queue = await checkEpisodeDownload(episodeid);
    if (is_in_queue) {
      return {
        error: true,
        message: "Already in queue",
      };
    }

    try {
      let animeMapping = await FindMapping("Anime", dbId, null, config?.CustomDownloadLocation);
      if (animeMapping && animeMapping.DownloadedEpisodes) {
        const num = parseFloat(number);
        const downloadedList = animeMapping.DownloadedEpisodes[resolvedSubDub] || [];
        if (downloadedList.map(Number).includes(num)) {
          return {
            error: true,
            message: "Already downloaded",
          };
        }
      }
    } catch (e) {
      // ignore
    }
      const queueItem = {
        Type: "Anime",
        EpNum: number,
        id: dbId,
        Title: Title,
        SubDub: resolvedSubDub,
        config: {
          Animeprovider: Animeprovider?.provider_name,
          quality: config?.quality,
          mergeSubtitles: config?.mergeSubtitles,
          subtitleFormat: config?.subtitleFormat,
          CustomDownloadLocation: config?.CustomDownloadLocation,
        },
        epid: episodeid,
        totalSegments: 0,
        currentSegments: 0,
      };

      if (returnItemOnly) {
        return {
          error: false,
          queueItem,
        };
      }

      await addToQueue(queueItem);
      return {
        error: false,
        message: "Added To Queue!",
      };
  } catch (err) {
    return {
      error: true,
      message: `${err.message}`,
    };
  }
}

// Handles Multiple Chapters Download
async function downloadMangaMulti(
  provider = null,
  mangaid,
  Chapters = [],
  Title,
  malid = null,
) {
  if (Chapters?.length <= 0)
    return {
      error: false,
      message: `No Episode Provided To Download!`,
    };

  Chapters.sort((a, b) => {
    const numA = parseFloat(a.number) || 0;
    const numB = parseFloat(b.number) || 0;
    return numA - numB;
  });

  let Message = {
    type: "info",
    message: "",
  };

  let success = 0;
  const itemsToAdd = [];

  const config = await settingfetch();
  const Mangaprovider = await providerFetch("Manga", provider);

  for (let i = 0; i < Chapters.length; i++) {
    let Chapter = Chapters[i];
    let data = await downloadMangaSingle(
      provider,
      mangaid,
      Chapter.id,
      Chapter.number,
      Title,
      i === 0,
      config,
      Mangaprovider,
      true,
      malid,
    );
    if (data?.error) {
      if (data?.message !== "Already downloaded") {
        Message.error = true;
      }
    } else if (data?.queueItem) {
      itemsToAdd.push(data.queueItem);
      success++;
    }
  }

  if (itemsToAdd.length > 0) {
    await addMultipleToQueue(itemsToAdd);
  }

  return {
    error: Message.error ?? false,
    message: `Added ${success} Chapters To Queue!`,
  };
}

// Handles Single Manga Download
async function downloadMangaSingle(
  provider = null,
  mangaid,
  chapterid,
  number,
  Title,
  saveinfo = false,
  preFetchedConfig = null,
  preFetchedProvider = null,
  returnItemOnly = false,
  malid = null,
) {
  try {
    const config = preFetchedConfig || (await settingfetch());
    const Mangaprovider =
      preFetchedProvider || (await providerFetch("Manga", provider));

    if (saveinfo) {
      let mangainfo = await MangaInfo(Mangaprovider, mangaid);
      if (mangainfo) {
        MetadataAdd("Manga", {
          id: mangaid,
          title: Title,
          provider: Mangaprovider.provider_name,
          description: mangainfo.description ?? null,
          genres: mangainfo?.genres?.join(",") ?? null,
          type: mangainfo.type ?? null,
          author: mangainfo?.author ?? null,
          released: mangainfo?.released ?? null,
          ImageUrl: mangainfo?.image,
          MalID: malid ? String(malid) : null,
        });
      }
    }

    let is_in_queue = await checkEpisodeDownload(chapterid);
    if (is_in_queue) {
      return {
        error: true,
        message: "Already in queue",
      };
    }

    try {
      let mangaMapping = await FindMapping("Manga", mangaid, null, config?.CustomDownloadLocation);
      if (mangaMapping && mangaMapping.DownloadedChapters) {
        const num = parseFloat(number);
        if (mangaMapping.DownloadedChapters.map(Number).includes(num)) {
          return {
            error: true,
            message: "Already downloaded",
          };
        }
      }
    } catch (e) {
      // ignore
    }
      const queueItem = {
        Type: "Manga",
        EpNum: number,
        id: mangaid,
        Title: Title,
        config: {
          Mangaprovider: Mangaprovider.provider_name,
          CustomDownloadLocation: config?.CustomDownloadLocation,
        },
        ChapterTitle: `Chapter ${number}`,
        epid: chapterid,
        totalSegments: 0,
        currentSegments: 0,
      };

      if (returnItemOnly) {
        return {
          error: false,
          queueItem,
        };
      }

      await addToQueue(queueItem);
      return {
        error: false,
        message: "Added To Queue!",
      };
  } catch (err) {
    return {
      error: true,
      message: `${err.message}`,
    };
  }
}

module.exports = {
  downloadAnimeSingle,
  downloadAnimeMulti,
  downloadMangaSingle,
  downloadMangaMulti,
};
