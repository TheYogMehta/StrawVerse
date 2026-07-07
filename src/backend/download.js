// imports
const {
  animeinfo,
  MangaInfo,
  fetchEpisode,
  fetchChapters,
} = require("./utils/AnimeManga");
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

  const needsResolution = Episodes.some((ep) => !ep.id);
  if (needsResolution) {
    try {
      const allEps = await fetchAllEpisodes(Animeprovider, animeid);
      Episodes.forEach((ep) => {
        if (!ep.id) {
          const matched = allEps.find(
            (x) => Number(x.number) === Number(ep.number),
          );
          if (matched) {
            ep.id = matched.id;
          }
        }
      });
    } catch (err) {
      console.error(`Error resolving episode IDs: ${err.message}`);
    }
  }

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

    const strippedId = animeid.replace(/-(sub|dub|hsub|both)$/, "");
    const dbId = `${strippedId}-${resolvedSubDub}`;

    if (saveinfo) {
      const lookupId =
        Animeprovider.provider_name === "pahe"
          ? animeid
          : animeid.replace(/-(dub|sub|hsub|both)$/, "");
      const animedata = await animeinfo(
        Animeprovider,
        config?.CustomDownloadLocation,
        lookupId,
      );
      if (animedata) {
        MetadataAdd("Anime", {
          id: dbId,
          title: `${animedata?.title?.replace(/-(dub|sub|hsub|both)$/, ``)} ${
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
      let animeMapping = await FindMapping(
        "Anime",
        dbId,
        null,
        config?.CustomDownloadLocation,
      );
      if (animeMapping && animeMapping.DownloadedEpisodes) {
        const num = parseFloat(number);
        const downloadedList =
          animeMapping.DownloadedEpisodes[resolvedSubDub] || [];
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

  const needsResolution = Chapters.some((ch) => !ch.id);
  if (needsResolution) {
    try {
      const allChs = await fetchAllChapters(Mangaprovider, mangaid);
      Chapters.forEach((ch) => {
        if (!ch.id) {
          const matched = allChs.find(
            (x) => Number(x.number) === Number(ch.number),
          );
          if (matched) {
            ch.id = matched.id;
          }
        }
      });
    } catch (err) {
      console.error(`Error resolving chapter IDs: ${err.message}`);
    }
  }

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
      let mangaMapping = await FindMapping(
        "Manga",
        mangaid,
        null,
        config?.CustomDownloadLocation,
      );
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

async function fetchAllEpisodes(Animeprovider, animeid) {
  let allEps = [];
  const firstPage = await fetchEpisode(Animeprovider, animeid, 1);
  if (firstPage && firstPage.episodes) {
    allEps = [...firstPage.episodes];
    const totalPages = firstPage.totalPages || 1;

    if (totalPages > 1) {
      const promises = [];
      for (let p = 2; p <= totalPages; p++) {
        promises.push(fetchEpisode(Animeprovider, animeid, p));
      }
      const results = await Promise.all(promises);
      for (const res of results) {
        if (res && res.episodes) {
          allEps = [...allEps, ...res.episodes];
        }
      }
    }
  }
  return allEps;
}

async function fetchAllChapters(Mangaprovider, mangaid) {
  let allChs = [];
  const firstPage = await fetchChapters(Mangaprovider, mangaid, 1);
  if (firstPage && firstPage.Chapters) {
    allChs = [...firstPage.Chapters];
    const totalPages = firstPage.totalPages || 1;

    if (totalPages > 1) {
      const promises = [];
      for (let p = 2; p <= totalPages; p++) {
        promises.push(fetchChapters(Mangaprovider, mangaid, p));
      }
      const results = await Promise.all(promises);
      for (const res of results) {
        if (res && res.Chapters) {
          allChs = [...allChs, ...res.Chapters];
        }
      }
    }
  }
  return allChs;
}

module.exports = {
  downloadAnimeSingle,
  downloadAnimeMulti,
  downloadMangaSingle,
  downloadMangaMulti,
};
