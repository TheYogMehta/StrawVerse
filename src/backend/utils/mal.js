const { logger } = require("./AppLogger");
const axios = require("axios");
const { MalEpMap, MalMangaMap } = require("./Metadata");
const verifyChallenge = require("./pkce");
const { getKeyValue, setKeyValue } = require("./db");

const MalAppID = "d0b22d129a541dac4d28207f77b15b5f";
let MalAcount = null;
global.MalLoggedIn = false;

function clearMalSession() {
  global.MalLoggedIn = false;
  global.malUsername = null;
  MalAcount = null;
  try {
    const config = getKeyValue("Settings", "config") || {};
    delete config.malToken;
    delete config.malUsername;
    delete config.malLastSync;
    delete config.malMangaLastSync;
    setKeyValue("Settings", "config", config);
    logger.warn("⚠️ Cleared expired or invalid MAL session.");
  } catch (_) {}
}

// Create Authorization URL
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
    logger.error(`Failed to load PKCE challenge: ${error.message}`);
    return null;
  }
}

// Verify OAuth Code & Exchange Token
async function MalVerifyToken(code) {
  try {
    const config = getKeyValue("Settings", "config") || {};
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

    // Clear used PKCE
    delete config.malPkce;

    const now = Date.now();
    const tokenData = {
      ...data,
      created_at: now,
      expires_at: now + data.expires_in * 1000,
    };

    MalAcount = tokenData;
    let tokenStr = JSON.stringify(tokenData);
    config.malToken = tokenStr;
    setKeyValue("Settings", "config", config);

    global.MalLoggedIn = true;

    MalGetUsername(data.access_token).catch(() => {});

    return {
      mal_on_off: true,
      malToken: tokenStr,
    };
  } catch (err) {
    logger.error(`Error getting MAL token: ${err.message}`);
    clearMalSession();

    return {
      mal_on_off: false,
      malToken: null,
    };
  }
}

// Refresh Token Generator
async function MalRefreshTokenGen(json) {
  try {
    let JsonToken = typeof json === "string" ? JSON.parse(json) : json;

    if (!JsonToken || !JsonToken.refresh_token) {
      throw new Error("Invalid token data!");
    }

    const now = Date.now();
    let isExpired = false;

    if (JsonToken.expires_at) {
      // Refresh if expired or within 5 minutes of expiring
      if (now >= JsonToken.expires_at - 5 * 60 * 1000) {
        isExpired = true;
      }
    } else if (JsonToken.created_at) {
      if (now >= JsonToken.created_at + (JsonToken.expires_in || 2678400) * 1000 - 5 * 60 * 1000) {
        isExpired = true;
      }
    } else {
      // Missing timestamp metadata - force refresh
      isExpired = true;
    }

    if (isExpired) {
      logger.info("🔄 MAL Token expired or missing expiration timestamp. Refreshing...");

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

      const updatedToken = {
        ...data,
        created_at: now,
        expires_at: now + data.expires_in * 1000,
      };

      MalAcount = updatedToken;
      let tokenStr = JSON.stringify(updatedToken);
      global.MalLoggedIn = true;

      try {
        const config = getKeyValue("Settings", "config") || {};
        config.malToken = tokenStr;
        setKeyValue("Settings", "config", config);
      } catch (_) {}

      logger.info("✅ MAL Token refreshed successfully!");
      MalFetchListAll();
      MalGetUsername(updatedToken.access_token).catch(() => {});

      return {
        mal_on_off: true,
        malToken: tokenStr,
      };
    }

    MalAcount = JsonToken;
    global.MalLoggedIn = true;
    MalFetchListAll();
    MalGetUsername(JsonToken.access_token).catch(() => {});

    return {
      mal_on_off: true,
      malToken: typeof json === "string" ? json : JSON.stringify(json),
    };
  } catch (err) {
    logger.error(`Failed to refresh MAL token: ${err.message}`);
    clearMalSession();

    return {
      mal_on_off: false,
      malToken: null,
    };
  }
}

// Helper to execute MAL API calls with automatic HTTP 401 retry & token refresh
async function execMalApi(apiCallFn) {
  try {
    return await apiCallFn();
  } catch (err) {
    if (err.response?.status === 401) {
      logger.info("🔑 MAL API returned HTTP 401. Attempting token refresh...");
      const config = getKeyValue("Settings", "config") || {};
      if (config.malToken) {
        // Force token refresh by passing an expired flag
        let tokenObj = JSON.parse(config.malToken);
        tokenObj.expires_at = 0;
        const refreshRes = await MalRefreshTokenGen(tokenObj);
        if (refreshRes.mal_on_off && MalAcount?.access_token) {
          logger.info("🔄 Retrying MAL API call with refreshed token...");
          return await apiCallFn();
        }
      }
      clearMalSession();
      throw new Error("MAL session expired. Please reconnect your account.");
    }
    throw err;
  }
}

// Fetch and store MAL username in settings
async function MalGetUsername(accessToken) {
  return execMalApi(async () => {
    const token =
      accessToken ||
      MalAcount?.access_token ||
      JSON.parse(getKeyValue("Settings", "config")?.malToken || "{}")
        ?.access_token;
    if (!token) return null;

    const { data } = await axios.get(
      "https://api.myanimelist.net/v2/users/@me",
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );
    const username = data?.name || null;
    if (username) {
      const config = getKeyValue("Settings", "config") || {};
      config.malUsername = username;
      setKeyValue("Settings", "config", config);
      global.malUsername = username;
    }
    return username;
  }).catch((err) => {
    logger.error(`Failed to fetch MAL username: ${err.message}`);
    return null;
  });
}

// Add To List
async function MalAddToList(type = "anime", malid, status, numVal = 0) {
  try {
    if (!global.MalLoggedIn || !MalAcount?.access_token) {
      throw new Error("Not logged into MyAnimeList");
    }

    const isAnime = type === "anime";
    const endpoint = isAnime ? "anime" : "manga";
    const paramName = isAnime ? "num_watched_episodes" : "num_chapters_read";

    await execMalApi(async () => {
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
    });

    await MalSyncType(type, true);

    return { title: "MyAnimeList Update Success!", icon: "success" };
  } catch (err) {
    return {
      title: "MyAnimeList Update Fail!",
      icon: "error",
      text: `Error: ${err.message}`,
    };
  }
}

// Sync A Specific Type (Anime or Manga)
async function MalSyncType(type, force = false) {
  if (!global.MalLoggedIn || !MalAcount?.access_token) {
    logger.info(`[MAL-${type.toUpperCase()}-LIST] SKIPPED FETCH (Not logged in)`);
    return;
  }

  const config = getKeyValue("Settings", "config") || {};
  const syncKey = type === "anime" ? "malLastSync" : "malMangaLastSync";
  let MalMappingDate = config[syncKey];

  let limit = MalMappingDate ? 50 : 500;

  const isSyncExpired =
    MalMappingDate &&
    Date.now() - new Date(MalMappingDate).getTime() > 5 * 60 * 1000;

  if (force || isSyncExpired || !MalMappingDate) {
    if (MalMappingDate && !force) {
      try {
        let latestLocal = global.db
          .prepare(
            `SELECT id, updated_at FROM ${type === "anime" ? "MyAnimeList" : "MyMangaList"} ORDER BY updated_at DESC LIMIT 1`,
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
                `[MAL-${type.toUpperCase()}-LIST] SKIPPED FETCH (Nothing changed on MAL)`,
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
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    logger.info(`[MAL-${type.toUpperCase()}-LIST] Successfully Saved`);
    config[syncKey] = new Date().toISOString();
    setKeyValue("Settings", "config", config);
  } else {
    logger.info(`[MAL-${type.toUpperCase()}-LIST] SKIPPED FETCH!`);
  }
}

// Fetch All Watching / Reading
async function MalFetchListAll(force = false) {
  if (!global.MalLoggedIn) return;
  await MalSyncType("anime", force);
  await MalSyncType("manga", force);
}

// Fetch Anime / Manga List
async function MalFetchList(type = "anime", page = 1, limit = 100) {
  try {
    if (!global.MalLoggedIn || !MalAcount?.access_token) {
      return { hasNextPage: false, results: [] };
    }

    const offset = (page - 1) * limit;
    const isAnime = type === "anime";
    const endpoint = isAnime ? "animelist" : "mangalist";
    const fields = isAnime
      ? "list_status,num_episodes"
      : "list_status,num_chapters";

    const { data } = await execMalApi(() =>
      axios.get(
        `https://api.myanimelist.net/v2/users/@me/${endpoint}?nsfw=true&limit=${limit}&offset=${offset}&sort=list_updated_at&fields=${fields}`,
        {
          headers: {
            Authorization: `Bearer ${MalAcount.access_token}`,
          },
        },
      ),
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
    logger.error(`[MAL-LIST] Failed To Fetch ${type} Page : ${page} - ${err.message}`);
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

    const fields =
      type === "anime"
        ? "num_episodes,main_picture"
        : "num_chapters,main_picture";
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

// Helper for MyAnimeList auto-tracking at 75% progress
async function autoTrackMAL(type, mediaId, number) {
  try {
    if (!global.MalLoggedIn) return false;
    let localRecord = null;

    if (type === "Anime") {
      const strippedId = mediaId.replace(/-(dub|sub|hsub|both)$/, "");
      localRecord = global.db
        .prepare(
          `
        SELECT MalID FROM Anime 
        WHERE id = ? OR id = ? OR id = ? OR id = ? OR id = ? OR folder_name = ? OR folder_name = ?
      `,
        )
        .get(
          mediaId,
          `${strippedId}-sub`,
          `${strippedId}-hsub`,
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

    let malid = null;
    if (localRecord && localRecord.MalID) {
      malid = parseInt(localRecord.MalID);
    }

    if (!malid && global.mappingDb && type === "Anime") {
      try {
        const strippedId = mediaId.replace(/-(dub|sub|hsub|both)$/, "");
        const row = global.mappingDb
          .prepare(
            `
            SELECT malid FROM animepahe WHERE id = ? OR uuid = ?
            UNION
            SELECT malid FROM anikototv WHERE id = ?
            LIMIT 1
          `,
          )
          .get(strippedId, strippedId, strippedId);
        if (row?.malid) {
          malid = parseInt(row.malid);
        }
      } catch (err) {}
    }

    if (malid) {
      const malListTable = type === "Anime" ? "MyAnimeList" : "MyMangaList";
      const totalCol = type === "Anime" ? "totalEpisodes" : "totalChapters";
      const progressCol = type === "Anime" ? "watched" : "read";
      const malInfo = global.db
        .prepare(
          `SELECT status, ${progressCol}, ${totalCol} FROM ${malListTable} WHERE id = ?`,
        )
        .get(String(malid));

      const currentProgress = malInfo ? parseInt(malInfo[progressCol] || 0) : 0;
      if (number <= currentProgress) {
        logger.info(
          `[MAL Auto-Tracking] Skipping update for ${type} ${mediaId} (MAL ID: ${malid}) because current MAL progress (${currentProgress}) is >= watched progress (${number})`,
        );
        return false;
      }

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

      // Send in-app notification via IPC
      try {
        let displayTitle = type;
        const titleRecord = global.db
          .prepare(
            `SELECT title FROM ${type === "Anime" ? "Anime" : "Manga"} WHERE id = ?`,
          )
          .get(mediaId);
        displayTitle = titleRecord?.title || type;

        if (global.win && !global.win.isDestroyed()) {
          global.win.webContents.send("mal-sync-notification", {
            title: "MAL Auto-Tracking Sync",
            body: `Synced "${displayTitle}" ${type === "Anime" ? "Episode" : "Chapter"} ${number} (${nextStatus.toUpperCase()}) to MAL.`,
            icon: "/assets/luffy.png",
          });
        }
      } catch (notifErr) {
        logger.error(
          `Failed to send MAL sync notification: ${notifErr.message}`,
        );
      }
      return true;
    }
    return false;
  } catch (err) {
    logger.error(`Error in MAL Auto-Tracking: ${err.message}`);
    return false;
  }
}

// Remove From List (Delete List Entry)
async function MalRemoveFromList(type = "anime", malid) {
  try {
    if (!global.MalLoggedIn || !MalAcount?.access_token) {
      throw new Error("Not logged into MyAnimeList");
    }

    const isAnime = type === "anime";
    const endpoint = isAnime ? "anime" : "manga";

    await execMalApi(async () => {
      await axios.delete(
        `https://api.myanimelist.net/v2/${endpoint}/${malid}/my_list_status`,
        {
          headers: {
            Authorization: `Bearer ${MalAcount.access_token}`,
          },
        },
      );
    });

    const table = isAnime ? "MyAnimeList" : "MyMangaList";
    try {
      global.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(String(malid));
    } catch (_) {}

    await MalSyncType(type, true);

    return { title: "Removed from MyAnimeList successfully!", icon: "success" };
  } catch (err) {
    return {
      title: "MyAnimeList Update Fail!",
      icon: "error",
      text: `Error: ${err.message}`,
    };
  }
}

module.exports = {
  MalCreateUrl,
  MalVerifyToken,
  MalRefreshTokenGen,
  MalAddToList,
  MalRemoveFromList,
  MalFetchList,
  MalSearch,
  MalGetUsername,
  autoTrackMAL,
};
