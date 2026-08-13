const { queryOne, queryAll, run } = require("./db");
const { logger } = require("./AppLogger");
const { UpdateDiscordRPC } = require("./discord");
const { autoTrackMAL } = require("./mal");

function parseSeconds(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === "number") return isNaN(val) || val > 10800 ? 0 : val;
  const str = String(val).trim();
  if (!str) return 0;
  if (
    str.includes(" ") ||
    str.includes("-") ||
    str.includes("T") ||
    str.includes("Z") ||
    str.length > 12
  ) {
    return 0;
  }

  if (str.includes(":")) {
    const parts = str.split(":").map((p) => parseFloat(p));
    if (parts.some(isNaN)) return 0;
    if (parts.length === 3) {
      const totalSec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      return totalSec > 10800 ? 0 : totalSec;
    } else if (parts.length === 2) {
      const totalSec = parts[0] * 60 + parts[1];
      return totalSec > 10800 ? 0 : totalSec;
    }
    return 0;
  }

  const num = parseFloat(str);
  return isNaN(num) || num > 10800 ? 0 : num;
}

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
  subdub,
  sub_dub,
}) {
  const tSpent = parseFloat(timeSpent || 0);
  const parsedNum = parseFloat(number);
  const isAnime = type === "Anime";
  const langSubDub = subdub || sub_dub || null;

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
      const localRec = queryOne(`SELECT title FROM ${mainTable} WHERE id = ?`, [
        mediaId,
      ]);
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
      const exists = queryOne(`SELECT id FROM ${mainTable} WHERE id = ?`, [
        mediaId,
      ]);
      if (!exists) {
        run(
          `
          INSERT OR IGNORE INTO ${mainTable} (id, title, provider, MalID, image_url, last_updated)
          VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `,
          [
            mediaId,
            resolvedTitle || type,
            provider,
            malid ? String(malid) : null,
            image || null,
          ],
        );
      } else {
        run(
          `
          UPDATE ${mainTable} 
          SET provider = COALESCE(provider, ?), 
              MalID = COALESCE(MalID, ?), 
              image_url = COALESCE(image_url, ?)
          WHERE id = ?
        `,
          [provider, malid ? String(malid) : null, image || null, mediaId],
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
      const localRec = queryOne(`SELECT MalID FROM Anime WHERE id = ?`, [
        mediaId,
      ]);
      if (localRec && localRec.MalID) {
        const siblings = queryAll(`SELECT id FROM Anime WHERE MalID = ?`, [
          localRec.MalID,
        ]);
        siblings.forEach((s) => {
          if (s.id) queryIds.push(s.id);
        });
      }
    } catch (err) {}

    queryIds = Array.from(new Set(queryIds));
  } else {
    try {
      const localRec = queryOne(`SELECT MalID FROM Manga WHERE id = ?`, [
        mediaId,
      ]);
      if (localRec && localRec.MalID) {
        const siblings = queryAll(`SELECT id FROM Manga WHERE MalID = ?`, [
          localRec.MalID,
        ]);
        siblings.forEach((s) => {
          if (s.id) queryIds.push(s.id);
        });
      }
    } catch (err) {}
    queryIds = Array.from(new Set(queryIds));
  }

  const placeholders = queryIds.map(() => "?").join(",");
  const strNum = String(number);
  let record = null;

  if (queryIds.length > 0) {
    if (resolvedTitle && resolvedTitle !== type) {
      record = queryOne(
        `SELECT * FROM ${historyTable} WHERE (${idField} IN (${placeholders}) OR LOWER(${titleField}) = LOWER(?)) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) ORDER BY id DESC LIMIT 1`,
        [...queryIds, resolvedTitle, parsedNum, parsedNum, strNum],
      );
    } else {
      record = queryOne(
        `SELECT * FROM ${historyTable} WHERE ${idField} IN (${placeholders}) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) ORDER BY id DESC LIMIT 1`,
        [...queryIds, parsedNum, parsedNum, strNum],
      );
    }
  } else if (resolvedTitle && resolvedTitle !== type) {
    record = queryOne(
      `SELECT * FROM ${historyTable} WHERE LOWER(${titleField}) = LOWER(?) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) ORDER BY id DESC LIMIT 1`,
      [resolvedTitle, parsedNum, parsedNum, strNum],
    );
  }

  const curVal = isAnime
    ? parseSeconds(currentTime)
    : parseInt(currentTime || 1);
  const totVal = isAnime ? parseFloat(duration || 0) : parseInt(duration || 1);
  const isComp = totVal > 0 && curVal / totVal >= 0.75 ? 1 : 0;

  const nowIso = new Date().toISOString();

  if (record) {
    const nextComp = record.is_completed === 1 ? 1 : isComp;
    const compAt =
      record.is_completed === 0 && nextComp === 1
        ? nowIso
        : record.completed_at;

    const subDubUpdate = isAnime && langSubDub ? `, sub_dub = ?` : ``;
    const updateParams = [
      mediaId,
      resolvedTitle || type,
      curVal,
      totVal,
      tSpent,
      nextComp,
      nowIso,
      compAt,
    ];
    if (isAnime && langSubDub) updateParams.push(langSubDub);
    updateParams.push(record.id);

    run(
      `
      UPDATE ${historyTable} 
      SET ${idField} = ?, ${titleField} = ?, ${currentField} = ?, ${totalField} = ?, time_spent = time_spent + ?, is_completed = ?, ${timeField} = ?, completed_at = ?, hidden = 0${subDubUpdate}
      WHERE id = ?
    `,
      updateParams,
    );

    try {
      if (queryIds.length > 0) {
        run(
          `DELETE FROM ${historyTable} WHERE (LOWER(${titleField}) = LOWER(?) OR ${idField} IN (${placeholders})) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) AND id != ?`,
          [
            resolvedTitle || type,
            ...queryIds,
            parsedNum,
            parsedNum,
            strNum,
            record.id,
          ],
        );
      } else {
        run(
          `DELETE FROM ${historyTable} WHERE LOWER(${titleField}) = LOWER(?) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) AND id != ?`,
          [resolvedTitle || type, parsedNum, parsedNum, strNum, record.id],
        );
      }
    } catch (e) {}

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
    const compAt = isComp === 1 ? nowIso : null;
    let newId = 0;
    if (isAnime) {
      const res = run(
        `
        INSERT INTO ${historyTable} (${idField}, ${titleField}, ${numberField}, ${currentField}, ${totalField}, time_spent, is_completed, ${timeField}, completed_at, sub_dub)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          mediaId,
          resolvedTitle || type,
          parsedNum,
          curVal,
          totVal,
          tSpent,
          isComp,
          nowIso,
          compAt,
          langSubDub || "sub",
        ],
      );
      newId = res?.lastInsertRowid || 0;
    } else {
      const res = run(
        `
        INSERT INTO ${historyTable} (${idField}, ${titleField}, ${numberField}, ${currentField}, ${totalField}, time_spent, is_completed, ${timeField}, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
        [
          mediaId,
          resolvedTitle || type,
          parsedNum,
          curVal,
          totVal,
          tSpent,
          isComp,
          nowIso,
          compAt,
        ],
      );
      newId = res?.lastInsertRowid || 0;
    }

    if (newId > 0) {
      try {
        if (queryIds.length > 0) {
          run(
            `DELETE FROM ${historyTable} WHERE (LOWER(${titleField}) = LOWER(?) OR ${idField} IN (${placeholders})) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) AND id != ?`,
            [
              resolvedTitle || type,
              ...queryIds,
              parsedNum,
              parsedNum,
              strNum,
              newId,
            ],
          );
        } else {
          run(
            `DELETE FROM ${historyTable} WHERE LOWER(${titleField}) = LOWER(?) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) AND id != ?`,
            [resolvedTitle || type, parsedNum, parsedNum, strNum, newId],
          );
        }
      } catch (e) {}
    }

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

  try {
    UpdateDiscordRPC(
      resolvedTitle || type,
      parsedNum,
      type,
      image,
      mediaId,
      currentTime,
      duration,
    ).catch(() => {});
  } catch (rpcErr) {}
}

module.exports = {
  updateHistory,
};
