const { queryOne, queryAll, run } = require("./db");
const { logger } = require("./AppLogger");
const { autoTrackMAL } = require("./mal");

async function updateHistory({
  mediaId,
  type,
  title,
  number,
  currentTime,
  duration,
  timeSpent,
  image,
  provider,
  malid,
}) {
  const tSpent = parseFloat(timeSpent || 0);
  const parsedNum = parseFloat(number);
  const isAnime = type === "Anime";

  // Resolve title
  let resolvedTitle = title;
  const mainTable = isAnime ? "Anime" : "Manga";
  const historyTable = isAnime ? "WatchHistory" : "ReadHistory";
  const idField = isAnime ? "anime_id" : "manga_id";
  const titleField = isAnime ? "anime_title" : "manga_title";
  const numberField = isAnime ? "episode_number" : "chapter_number";
  const currentField = isAnime ? "current_time" : "current_page";
  const totalField = isAnime ? "duration" : "total_pages";
  const timeField = isAnime ? "last_watched" : "last_read";

  if (!resolvedTitle || resolvedTitle === type) {
    try {
      const localRec = await queryOne(
        `SELECT title FROM ${mainTable} WHERE id = ?`,
        [mediaId],
      );
      if (localRec && localRec.title) {
        resolvedTitle = localRec.title;
      }
    } catch (e) {}
  }
  if (!resolvedTitle || resolvedTitle === type) {
    if (mediaId && mediaId.includes(":")) {
      const parts = mediaId.split(":");
      const slug = parts[parts.length - 1];
      resolvedTitle = slug
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");
    }
  }

  // Update main table cache entry
  if (provider) {
    try {
      const cleanId = isAnime
        ? mediaId.replace(/-(dub|sub|hsub|both)$/, "")
        : mediaId;
      const exists = await queryOne(
        `SELECT id FROM ${mainTable} WHERE id = ?`,
        [cleanId],
      );
      if (!exists) {
        await run(
          `
          INSERT INTO ${mainTable} (id, title, provider, MalID, image_url, last_updated)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
          [
            cleanId,
            resolvedTitle || type,
            provider,
            malid ? String(malid) : null,
            image || null,
          ],
        );
      } else {
        await run(
          `
          UPDATE ${mainTable} 
          SET provider = COALESCE(provider, ?), 
              MalID = COALESCE(MalID, ?), 
              image_url = COALESCE(image_url, ?)
          WHERE id = ?
        `,
          [provider, malid ? String(malid) : null, image || null, cleanId],
        );
      }
    } catch (cacheErr) {
      logger.error(`Error saving ${type} history cache: ${cacheErr.message}`);
    }
  }

  // Sync across all sibling provider IDs linked to same MAL ID
  let queryIds = [mediaId];
  if (isAnime) {
    try {
      const localRec = await queryOne(`SELECT MalID FROM Anime WHERE id = ?`, [
        mediaId,
      ]);
      if (localRec && localRec.MalID) {
        const siblings = await queryAll(
          `SELECT id FROM Anime WHERE MalID = ?`,
          [localRec.MalID],
        );
        siblings.forEach((s) => {
          if (s.id) queryIds.push(s.id);
        });
      }
    } catch (err) {}

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
  } else {
    try {
      const localRec = await queryOne(`SELECT MalID FROM Manga WHERE id = ?`, [
        mediaId,
      ]);
      if (localRec && localRec.MalID) {
        const siblings = await queryAll(
          `SELECT id FROM Manga WHERE MalID = ?`,
          [localRec.MalID],
        );
        siblings.forEach((s) => {
          if (s.id) queryIds.push(s.id);
        });
      }
    } catch (err) {}
    queryIds = Array.from(new Set(queryIds));
  }

  const placeholders = queryIds.map(() => "?").join(",");
  let record = await queryOne(
    `
    SELECT * FROM ${historyTable} 
    WHERE ${idField} IN (${placeholders}) AND ${numberField} = ?
  `,
    [...queryIds, parsedNum],
  );

  if (!record && resolvedTitle && resolvedTitle !== type) {
    record = await queryOne(
      `
      SELECT * FROM ${historyTable} 
      WHERE LOWER(${titleField}) = LOWER(?) AND ${numberField} = ?
    `,
      [resolvedTitle, parsedNum],
    );
  }

  const curVal = isAnime
    ? parseFloat(currentTime || 0)
    : parseInt(currentTime || 1);
  const totVal = isAnime ? parseFloat(duration || 0) : parseInt(duration || 1);
  const isComp = totVal > 0 && curVal / totVal >= 0.75 ? 1 : 0;

  if (record) {
    const nextComp = record.is_completed === 1 ? 1 : isComp;
    const compAt =
      record.is_completed === 0 && nextComp === 1
        ? new Date().toISOString()
        : record.completed_at;

    await run(
      `
      UPDATE ${historyTable} 
      SET ${idField} = ?, ${titleField} = ?, ${currentField} = ?, ${totalField} = ?, time_spent = time_spent + ?, is_completed = ?, ${timeField} = CURRENT_TIMESTAMP, completed_at = ?, hidden = 0
      WHERE id = ?
    `,
      [
        mediaId,
        resolvedTitle || type,
        curVal,
        totVal,
        tSpent,
        nextComp,
        compAt,
        record.id,
      ],
    );

    if (record.is_completed === 0 && nextComp === 1) {
      const synced = await autoTrackMAL(type, mediaId, parsedNum);
      if (!synced) {
        if (global.win && !global.win.isDestroyed()) {
          global.win.webContents.send("mal-sync-notification", {
            title: `${isAnime ? "Episode" : "Chapter"} Completed`,
            body: `Finished ${isAnime ? "watching" : "reading"} "${resolvedTitle || type}" ${isAnime ? "Episode" : "Chapter"} ${parsedNum}.`,
            icon: "/assets/luffy.png",
          });
        }
      }
    }
  } else {
    const compAt = isComp === 1 ? new Date().toISOString() : null;
    await run(
      `
      INSERT INTO ${historyTable} (${idField}, ${titleField}, ${numberField}, ${currentField}, ${totalField}, time_spent, is_completed, ${timeField}, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
    `,
      [
        mediaId,
        resolvedTitle || type,
        parsedNum,
        curVal,
        totVal,
        tSpent,
        isComp,
        compAt,
      ],
    );

    if (isComp === 1) {
      const synced = await autoTrackMAL(type, mediaId, parsedNum);
      if (!synced) {
        if (global.win && !global.win.isDestroyed()) {
          global.win.webContents.send("mal-sync-notification", {
            title: `${isAnime ? "Episode" : "Chapter"} Completed`,
            body: `Finished ${isAnime ? "watching" : "reading"} "${resolvedTitle || type}" ${isAnime ? "Episode" : "Chapter"} ${parsedNum}.`,
            icon: "/assets/luffy.png",
          });
        }
      }
    }
  }
}

module.exports = {
  updateHistory,
};
