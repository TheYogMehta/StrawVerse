const express = require("express");
const axios = require("axios");
const { logger } = require("../utils/AppLogger");
const { settingupdate, settingfetch } = require("../utils/settings");
const {
  MalVerifyToken,
  MalAddToList,
  MalRemoveFromList,
  MalSearch,
} = require("../utils/mal");
const { sendToRenderer } = require("../utils/rendererIPC");

const router = express.Router();

// Handles Mal Login
router.get("/mal/callback", async (req, res) => {
  try {
    const code = req.query.code;
    let ToUpdate = await MalVerifyToken(code);
    await settingupdate(ToUpdate);
    sendToRenderer("mal", { LoggedIn: true });
    return res.send(`
        <p>Authentication successful! You can close this window.</p>
    `);
  } catch (err) {
    logger.error(`Error in MAL callback: ${err.message}`);
    return res.status(500).send("Authentication failed");
  }
});

// Handles Mal Logout
router.get("/mal/logout", async (req, res) => {
  try {
    await settingupdate({ mal_on_off: "logout", status: null, malToken: null });
    sendToRenderer("mal", { LoggedIn: false });
    global.MalLoggedIn = false;
    return res.send("logged out!");
  } catch (err) {
    logger.error(`Error in MAL logout: ${err.message}`);
    return res.status(500).send("Logout failed");
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

    if (!malid || !status) throw new Error("Something is missing");

    let data = await MalAddToList(
      isAnime ? "anime" : "manga",
      malid,
      status,
      episodes,
    );

    return res.json(data);
  } catch (err) {
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

// Get MyAnimeList access token
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

module.exports = router;
