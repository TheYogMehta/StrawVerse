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
const { run } = require("../utils/db");
const { resolveMalIdFromMapping } = require("../utils/mappingResolver");
const { getOSName, isValidMalStatus } = require("../utils/constants");

const router = express.Router();

// Handles Mal Login
router.get("/mal/callback", async (req, res) => {
  try {
    const code = req.query.code;
    let ToUpdate = await MalVerifyToken(code);
    await settingupdate(ToUpdate);
    global.sendToRenderer("mal", { LoggedIn: true });
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
    global.sendToRenderer("mal", { LoggedIn: false });
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
    if (type === "Movies") {
      return res.status(400).json({ error: "Movies do not support MyAnimeList tracking" });
    }
    const isAnime = !type || type.toLowerCase() === "anime";

    episodes = parseInt(episodes) || 0;

    if (!isValidMalStatus(status, isAnime ? "Anime" : "Manga")) {
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
    if (type === "Movies") {
      return res.status(400).json({ error: "Movies do not support MyAnimeList tracking" });
    }
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
    if (type === "Movies") {
      return res.status(400).json({ error: "Movies do not support MyAnimeList linking" });
    }
    if (!type || !id) {
      throw new Error("Missing type or id");
    }

    MalID = MalID ? String(MalID) : null;

    let targetMalID = MalID ? parseInt(MalID, 10) : null;
    let resolvedProvider = provider || null;

    if (resolvedProvider) {
      if (!targetMalID) {
        let dbRow = null;
        try {
          if (type === "Anime") {
            dbRow = await global.db
              .prepare("SELECT MalID FROM Anime WHERE id = ?")
              .get(id);
          } else {
            dbRow = await global.db
              .prepare("SELECT MalID FROM Manga WHERE id = ?")
              .get(id);
          }
        } catch (e) {}
        if (dbRow && dbRow.MalID) {
          targetMalID = parseInt(dbRow.MalID, 10);
        }
      }

      if (!targetMalID && global.mappingDb && resolvedProvider) {
        try {
          const found = await resolveMalIdFromMapping({
            id,
            provider: resolvedProvider,
            mediaType: type,
          });
          if (found) {
            targetMalID = found;
          }
        } catch (e) {}
      }

      let providerTitle = title || null;
      let metadata = req.body.metadata || {};
      if (req.body.image && !metadata.image) metadata.image = req.body.image;
      if (req.body.type && !metadata.type) metadata.type = req.body.type;
      if (req.body.episodes && !metadata.episodes)
        metadata.episodes = req.body.episodes;
      if (req.body.chapters && !metadata.chapters)
        metadata.chapters = req.body.chapters;

      try {
        const table = type === "Anime" ? "Anime" : "Manga";
        const row = await global.db
          .prepare(`SELECT * FROM ${table} WHERE id = ? LIMIT 1`)
          .get(id);
        if (row) {
          if (!providerTitle) providerTitle = row.title;
          if (!targetMalID && row.MalID) {
            targetMalID = parseInt(row.MalID, 10);
          }
          metadata = {
            title: row.title || providerTitle,
            image: row.image_url || row.image || metadata.image || null,
            type: row.type || metadata.type || null,
            episodes:
              row.episodes || row.total_episodes || metadata.episodes || null,
            chapters:
              row.chapters || row.total_chapters || metadata.chapters || null,
            description: row.description || metadata.description || null,
          };
        }
      } catch (e) {
        logger.error(`Error querying title from local DB: ${e.message}`);
      }

      const cleanProv = (resolvedProvider || "").toLowerCase().split("/").pop();
      if (
        (!metadata.image || !providerTitle) &&
        global.mappingDb &&
        cleanProv
      ) {
        try {
          const unmapped = global.mappingDb
            .prepare(
              "SELECT * FROM unmapped_items WHERE (provider = ? OR provider = ?) AND (id = ? OR id = ?) LIMIT 1",
            )
            .get(cleanProv, resolvedProvider, id, String(id));
          if (unmapped) {
            if (!providerTitle) providerTitle = unmapped.name;
            metadata.title = metadata.title || unmapped.name || providerTitle;
            metadata.image = metadata.image || unmapped.image_url || null;
            metadata.type = metadata.type || unmapped.type || null;
            metadata.episodes = metadata.episodes || unmapped.episodes || null;
          }
        } catch (_) {}
      }

      const osName = getOSName();

      const toCount = (v) => {
        if (Array.isArray(v)) return v.length;
        if (typeof v === "number") return v;
        if (typeof v === "string" && !isNaN(parseInt(v, 10)))
          return parseInt(v, 10);
        return null;
      };

      const finalEpisodes = toCount(metadata.episodes || req.body.episodes);
      const finalChapters = toCount(metadata.chapters || req.body.chapters);

      const cleanMeta = {
        title: metadata.title || providerTitle || null,
        image: metadata.image || req.body.image || null,
        type: metadata.type || type || null,
        episodes: finalEpisodes,
        chapters: finalChapters,
        status: metadata.status || null,
      };

      if (targetMalID && cleanProv) {
        if (MalID) {
          axios
            .post(
              "https://strawverse.theyogmehta.online/mapping",
              {
                malid: targetMalID,
                provider: cleanProv,
                id: id,
                title: providerTitle,
                image: cleanMeta.image,
                type: cleanMeta.type,
                episodes: finalEpisodes,
                chapters: finalChapters,
                metadata: cleanMeta,
              },
              {
                headers: {
                  os: osName,
                },
              },
            )
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
              headers: {
                os: osName,
              },
              data: {
                malid: targetMalID,
                provider: cleanProv,
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

      if (global.mappingDb && cleanProv) {
        try {
          if (MalID && targetMalID) {
            await global.mappingDb
              .prepare(
                "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ?) AND (id = ? OR id = ?)",
              )
              .run(cleanProv, resolvedProvider, id, String(id));

            if (cleanProv === "pahe") {
              const isUuid =
                /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                  String(id),
                );
              if (isUuid) {
                await global.mappingDb
                  .prepare(
                    "INSERT OR REPLACE INTO pahe (id, uuid, malid) VALUES (?, ?, ?)",
                  )
                  .run(id, id, targetMalID);
              } else {
                await global.mappingDb
                  .prepare(
                    "INSERT OR REPLACE INTO pahe (id, malid) VALUES (?, ?)",
                  )
                  .run(id, targetMalID);
              }
            } else {
              try {
                await global.mappingDb.exec(`
                  CREATE TABLE IF NOT EXISTS "${cleanProv}" (
                    id TEXT PRIMARY KEY,
                    malid INTEGER
                  );
                `);
              } catch (_) {}
              await global.mappingDb
                .prepare(
                  `INSERT OR REPLACE INTO "${cleanProv}" (id, malid) VALUES (?, ?)`,
                )
                .run(id, targetMalID);
            }

            const malTable = type === "Anime" ? "anime" : "manga";
            await global.mappingDb
              .prepare(`UPDATE ${malTable} SET has_mapping = 1 WHERE malid = ?`)
              .run(targetMalID);

            try {
              global.mappingDb
                .prepare(
                  "DELETE FROM unmapped_items WHERE (provider = ? OR provider = ? OR provider LIKE ?) AND (id = ? OR id = ?)",
                )
                .run(cleanProv, provider, `%/${cleanProv}`, id, String(id));
            } catch (_) {}
          } else {
            if (cleanProv === "pahe") {
              await global.mappingDb
                .prepare(
                  "DELETE FROM pahe WHERE id = ? OR uuid = ? OR (malid = ? AND malid IS NOT NULL)",
                )
                .run(id, id, targetMalID || 0);
            } else {
              try {
                await global.mappingDb.exec(`
                  CREATE TABLE IF NOT EXISTS "${cleanProv}" (
                    id TEXT PRIMARY KEY,
                    malid INTEGER
                  );
                `);
              } catch (_) {}
              await global.mappingDb
                .prepare(
                  `DELETE FROM "${cleanProv}" WHERE id = ? OR (malid = ? AND malid IS NOT NULL)`,
                )
                .run(id, targetMalID || 0);
            }
          }
        } catch (mErr) {
          logger.error(`Error updating mappingDb on link: ${mErr.message}`);
        }
      }
    }

    try {
      if (MalID) {
        await run(
          "INSERT OR REPLACE INTO unlinked_mal_ids (id, malid) VALUES (?, ?)",
          [id, MalID],
        );
      } else {
        await run(
          "INSERT OR REPLACE INTO unlinked_mal_ids (id, malid) VALUES (?, NULL)",
          [id],
        );
      }
    } catch (err) {
      logger.error(
        `Error updating unlinked_mal_ids in /api/mal/link: ${err.message}`,
      );
    }

    if (type === "Anime") {
      await run(
        `UPDATE Anime SET MalID = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        [MalID, id],
      );
    } else {
      await run(
        `UPDATE Manga SET MalID = ?, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
        [MalID, id],
      );
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
