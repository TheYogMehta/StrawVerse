const { logger } = require("./AppLogger");
const axios = require("axios");
const {
  MalEpMap,
  processAndSortMyAnimeList,
  MalMangaMap,
  processAndSortMyMangaList,
} = require("./Metadata");
const verifyChallenge = require("./pkce");
const { getKeyValue, setKeyValue, db } = require("./db");

const MalAppID = "d0b22d129a541dac4d28207f77b15b5f";
let MalAcount = null;
let pkce;
global.MalLoggedIn = false;

// Create A url
async function MalCreateUrl() {
  try {
    const config = getKeyValue("Settings", "config") || {};

    let currentPkce = config.malPkce;
    if (!currentPkce) {
      const generatedPkce = await verifyChallenge(128);
      currentPkce = generatedPkce.code_challenge;
      config.malPkce = currentPkce;
      setKeyValue("Settings", "config", config);
    }

    return `https://myanimelist.net/v1/oauth2/authorize?response_type=code&client_id=${MalAppID}&code_challenge_method=plain&code_challenge=${currentPkce}`;
  } catch (error) {
    console.error("Failed to load pkce-challenge:", error);
    return null;
  }
}

// Mal Verify Token
async function MalVerifyToken(code) {
  try {
    const config = settings.get("config") || {};
    const storedPkce = config.malPkce;

    if (!storedPkce) {
      throw new Error(
        "No stored PKCE code challenge found. Please re-authenticate.",
      );
    }

    const { data } = await axios.post(
      "https://myanimelist.net/v1/oauth2/token",
      new URLSearchParams({
        client_id: MalAppID,
        grant_type: "authorization_code",
        code: code,
        code_verifier: storedPkce,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
      },
    );

    // Clear the used PKCE from settings
    delete config.malPkce;
    setKeyValue("Settings", "config", config);

    MalAcount = data;

    let token = JSON.stringify(data);
    global.MalLoggedIn = true;

    return {
      mal_on_off: true,
      malToken: token,
    };
  } catch (err) {
    logger.error(`Error getting MAL token:`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);

    global.MalLoggedIn = false;

    // Clear PKCE on failure as well so they can start fresh
    try {
      const { getKeyValue, setKeyValue } = require("./db");
      const config = getKeyValue("Settings", "config") || {};
      if (config.malPkce) {
        delete config.malPkce;
        setKeyValue("Settings", "config", config);
      }
    } catch (e) {
      // Ignore
    }

    return {
      mal_on_off: false,
      malToken: null,
    };
  }
}

// Mal Refresh Token
async function MalRefreshTokenGen(json) {
  try {
    let JsonToken = JSON.parse(json);

    if (!JsonToken || !JsonToken.refresh_token || !JsonToken.expires_in) {
      throw new Error("Invalid token data!");
    }

    let expires_at = Date.now() + JsonToken.expires_in * 1000;

    if (Date.now() >= expires_at) {
      logger.info("🔄 Token expired! Refreshing...");

      const { data } = await axios.post(
        "https://myanimelist.net/v1/oauth2/token",
        new URLSearchParams({
          client_id: MalAppID,
          grant_type: "refresh_token",
          refresh_token: JsonToken.refresh_token,
        }).toString(),
        {
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
          },
        },
      );

      MalAcount = data;
      let token = JSON.stringify(data);
      global.MalLoggedIn = true;

      return {
        mal_on_off: true,
        malToken: token,
      };
    }

    MalAcount = JsonToken;
    global.MalLoggedIn = true;
    MalFetchListAll();

    return {
      mal_on_off: true,
      malToken: json,
    };
  } catch (err) {
    logger.error("Failed to refresh token");
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);

    global.MalLoggedIn = false;

    return {
      mal_on_off: false,
      malToken: null,
    };
  }
}

// Add To List
async function MalAddToList(type = "anime", malid, status, numVal = 0) {
  try {
    if (!MalAcount?.access_token)
      throw new Error("No access token please login");

    const isAnime = type === "anime";
    const endpoint = isAnime ? "anime" : "manga";
    const paramName = isAnime ? "num_watched_episodes" : "num_chapters_read";

    await axios.put(
      `https://api.myanimelist.net/v2/${endpoint}/${malid}/my_list_status`,
      new URLSearchParams({
        status: status,
        [paramName]: numVal,
      }).toString(),
      {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Bearer ${MalAcount.access_token}`,
        },
      },
    );

    await MalSyncType(type, true);

    return { title: "MyAnimeList Update Success!", icon: "success" };
  } catch (err) {
    return {
      title: "MyAnimeList Update Fail!",
      icon: "error",
      text: `Error : ${err.message}`,
    };
  }
}

// Sync A Specific Type (Anime or Manga)
async function MalSyncType(type, force = false) {
  const config = getKeyValue("Settings", "config") || {};

  const syncKey = type === "anime" ? "malLastSync" : "malMangaLastSync";
  let MalMappingDate = config[syncKey];

  let limit = MalMappingDate ? 50 : 500;

  const isSyncExpired =
    MalMappingDate &&
    Date.now() - new Date(MalMappingDate).getTime() > 5 * 60 * 1000;

  const tableName = type === "anime" ? "MyAnimeList" : "MyMangaList";

  if (force || isSyncExpired || !MalMappingDate) {
    if (MalMappingDate && !force) {
      try {
        let latestLocal = db
          .prepare(
            `SELECT id, updated_at FROM ${tableName} ORDER BY updated_at DESC LIMIT 1`,
          )
          .get();
        if (latestLocal) {
          let checkData = await MalFetchList(type, 1, 1);
          if (checkData?.results?.length > 0) {
            let latestMal = checkData.results[0];
            if (
              latestLocal.id === latestMal.id.toString() &&
              latestLocal.updated_at === latestMal.updated_at
            ) {
              logger.info(
                `[MAL-${type.toUpperCase()}-LIST] SKIPED FETCH (Nothing changed on MAL)`,
              );
              config[syncKey] = new Date().toISOString();
              setKeyValue("Settings", "config", config);
              return;
            }
          }
        }
      } catch (err) {
        logger.error(`Error during MAL ${type} quick-check: ${err.message}`);
      }
    }

    let i = 1;
    while (true) {
      logger.info(
        `[MAL-${type.toUpperCase()}-LIST] FETCHING PAGE ${i} ( ${limit} )`,
      );
      let data = await MalFetchList(type, i, limit);
      if (data?.results?.length > 0) {
        let stop =
          type === "anime"
            ? await MalEpMap(data.results)
            : await MalMangaMap(data.results);
        if (stop && limit === 50) break;
      } else {
        break;
      }

      if (!data?.hasNextPage) break;
      i++;
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2s wait
    }
    logger.info(`[MAL-${type.toUpperCase()}-LIST] Successfully Saved`);
    config[syncKey] = new Date().toISOString();
    setKeyValue("Settings", "config", config);

    if (type === "anime") {
      await processAndSortMyAnimeList();
    } else {
      await processAndSortMyMangaList();
    }
  } else {
    logger.info(`[MAL-${type.toUpperCase()}-LIST] SKIPED FETCH!`);
  }
}

// Fetch All Watching / Reading
async function MalFetchListAll(force = false) {
  await MalSyncType("anime", force);
  await MalSyncType("manga", force);
}

// Fetch Anime / Manga List
async function MalFetchList(type = "anime", page = 1, limit = 100) {
  try {
    if (!MalAcount?.access_token)
      throw new Error("No access token please login");

    const offset = (page - 1) * limit;
    const isAnime = type === "anime";
    const endpoint = isAnime ? "animelist" : "mangalist";
    const fields = isAnime
      ? "list_status,num_episodes"
      : "list_status,num_chapters";

    let { data } = await axios.get(
      `https://api.myanimelist.net/v2/users/@me/${endpoint}?nsfw=true&limit=${limit}&offset=${offset}&sort=list_updated_at&fields=${fields}`,
      {
        headers: {
          Authorization: `Bearer ${MalAcount.access_token}`,
        },
      },
    );

    let list = data.data.map((items) => {
      const baseInfo = {
        title: items?.node?.title,
        id: items?.node?.id,
        image:
          items?.node?.main_picture?.medium ??
          items?.node?.main_picture?.large ??
          null,
        status: items?.list_status?.status ?? null,
        updated_at: items?.list_status?.updated_at ?? null,
      };

      if (isAnime) {
        return {
          ...baseInfo,
          totalEpisodes: items?.node?.num_episodes ?? null,
          watched: items?.list_status?.num_episodes_watched ?? 0,
        };
      } else {
        return {
          ...baseInfo,
          totalChapters: items?.node?.num_chapters ?? null,
          read: items?.list_status?.num_chapters_read ?? 0,
        };
      }
    });

    return {
      hasNextPage: data?.paging?.next ? true : false,
      results: list,
    };
  } catch (err) {
    logger.error(`[MAL-LIST] Failed To Fetch ${type} Page : ${page}`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return {
      hasNextPage: false,
      results: [],
    };
  }
}

// Search MAL
async function MalSearch(query, type = "anime", limit = 10) {
  try {
    const headers = {};
    if (MalAcount?.access_token) {
      headers.Authorization = `Bearer ${MalAcount.access_token}`;
    } else {
      headers["X-MAL-CLIENT-ID"] = MalAppID;
    }

    const fields = type === "anime" ? "num_episodes,main_picture" : "num_chapters,main_picture";
    const { data } = await axios.get(
      `https://api.myanimelist.net/v2/${type}?q=${encodeURIComponent(query)}&limit=${limit}&fields=${fields}`,
      { headers },
    );

    return data.data.map((item) => ({
      id: item.node.id,
      title: item.node.title,
      image:
        item.node.main_picture?.medium || item.node.main_picture?.large || null,
      totalEpisodes: item.node.num_episodes || 0,
      totalChapters: item.node.num_chapters || 0,
    }));
  } catch (err) {
    logger.error(`Error searching MAL for ${query}: ${err.message}`);
    return [];
  }
}

module.exports = {
  MalCreateUrl,
  MalVerifyToken,
  MalRefreshTokenGen,
  MalAddToList,
  MalFetchList,
  MalSearch,
};
