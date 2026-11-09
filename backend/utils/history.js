const { queryOne, queryAll, run } = require("./db");
const { logger } = require("./AppLogger");
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
  isCompleted,
  timestamp,
}) {
  const tSpent = parseFloat(timeSpent || 0);
  const rawNum = parseFloat(number);
  const parsedNum =
    !isNaN(rawNum) && Number.isInteger(rawNum) ? Math.trunc(rawNum) : rawNum;
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
      let exists = await queryOne(`SELECT id FROM ${mainTable} WHERE id = ?`, [
        mediaId,
      ]);
      if (!exists && malid) {
        const byMal = await queryOne(
          `SELECT id FROM ${mainTable} WHERE MalID = ? LIMIT 1`,
          [String(malid)],
        );
        if (byMal && byMal.id) {
          mediaId = byMal.id;
          exists = byMal;
        }
      }
      if (!exists) {
        await run(
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
        await run(
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
  try {
    const localRec = await queryOne(
      `SELECT MalID FROM ${mainTable} WHERE id = ?`,
      [mediaId],
    );
    if (localRec && localRec.MalID) {
      const siblings = await queryAll(
        `SELECT id FROM ${mainTable} WHERE MalID = ?`,
        [localRec.MalID],
      );
      siblings.forEach((s) => {
        if (s.id) queryIds.push(s.id);
      });
    }
  } catch (err) {}
  queryIds = Array.from(new Set(queryIds));

  const placeholders = queryIds.map(() => "?").join(",");
  const strNum = String(number);
  let record = null;

  if (queryIds.length > 0) {
    if (resolvedTitle && resolvedTitle !== type) {
      record = await queryOne(
        `SELECT * FROM ${historyTable} WHERE (${idField} IN (${placeholders}) OR LOWER(${titleField}) = LOWER(?)) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) ORDER BY id DESC LIMIT 1`,
        [...queryIds, resolvedTitle, parsedNum, parsedNum, strNum],
      );
    } else {
      record = await queryOne(
        `SELECT * FROM ${historyTable} WHERE ${idField} IN (${placeholders}) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) ORDER BY id DESC LIMIT 1`,
        [...queryIds, parsedNum, parsedNum, strNum],
      );
    }
  } else if (resolvedTitle && resolvedTitle !== type) {
    record = await queryOne(
      `SELECT * FROM ${historyTable} WHERE LOWER(${titleField}) = LOWER(?) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) ORDER BY id DESC LIMIT 1`,
      [resolvedTitle, parsedNum, parsedNum, strNum],
    );
  }

  let curVal = isAnime ? parseSeconds(currentTime) : parseInt(currentTime || 1);
  const totVal = isAnime ? parseFloat(duration || 0) : parseInt(duration || 1);
  if (isAnime && totVal > 0 && curVal > totVal) {
    curVal = totVal;
  }
  let isComp = 0;
  if (isCompleted !== undefined && isCompleted !== null) {
    isComp = isCompleted ? 1 : 0;
  } else {
    if (isAnime) {
      isComp = totVal > 0 && curVal / totVal >= 0.75 ? 1 : 0;
    } else {
      const cumulativeTime = (record?.time_spent || 0) + tSpent;
      const isNearEnd = totVal > 0 && curVal / totVal >= 0.85;
      isComp = isNearEnd && cumulativeTime >= 8 ? 1 : 0;
    }
  }

  const nowIso = timestamp
    ? new Date(timestamp).toISOString()
    : new Date().toISOString();

  const cleanDuplicates = async (excludeId) => {
    try {
      if (queryIds.length > 0) {
        await run(
          `DELETE FROM ${historyTable} WHERE (LOWER(${titleField}) = LOWER(?) OR ${idField} IN (${placeholders})) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) AND id != ?`,
          [
            resolvedTitle || type,
            ...queryIds,
            parsedNum,
            parsedNum,
            strNum,
            excludeId,
          ],
        );
      } else {
        await run(
          `DELETE FROM ${historyTable} WHERE LOWER(${titleField}) = LOWER(?) AND (${numberField} = ? OR CAST(${numberField} AS REAL) = ? OR ${numberField} = ?) AND id != ?`,
          [resolvedTitle || type, parsedNum, parsedNum, strNum, excludeId],
        );
      }
    } catch (e) {}
  };

  const notifyCompletion = async () => {
    const synced = await autoTrackMAL(type, mediaId, parsedNum);
    if (!synced) {
      global.sendToRenderer("mal-sync-notification", {
        title: `${isAnime ? "Episode" : "Chapter"} Completed`,
        body: `Finished ${isAnime ? "watching" : "reading"} "${resolvedTitle || type}" ${isAnime ? "Episode" : "Chapter"} ${parsedNum}.`,
        icon: "/assets/luffy.png",
      });
    }
  };

  if (record) {
    const nextComp =
      isCompleted === false ? 0 : record.is_completed === 1 ? 1 : isComp;
    const compAt =
      record.is_completed === 0 && nextComp === 1
        ? nowIso
        : nextComp === 0
          ? null
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

    await run(
      `
      UPDATE ${historyTable} 
      SET ${idField} = ?, ${titleField} = ?, ${currentField} = ?, ${totalField} = ?, time_spent = time_spent + ?, is_completed = ?, ${timeField} = ?, completed_at = ?, hidden = 0${subDubUpdate}
      WHERE id = ?
    `,
      updateParams,
    );

    await cleanDuplicates(record.id);

    if (record.is_completed === 0 && nextComp === 1) {
      await notifyCompletion();
    }
  } else {
    const compAt = isComp === 1 ? nowIso : null;
    const insertCols = [
      idField,
      titleField,
      numberField,
      currentField,
      totalField,
      "time_spent",
      "is_completed",
      timeField,
      "completed_at",
    ];
    const insertVals = [
      mediaId,
      resolvedTitle || type,
      parsedNum,
      curVal,
      totVal,
      tSpent,
      isComp,
      nowIso,
      compAt,
    ];
    if (isAnime) {
      insertCols.push("sub_dub");
      insertVals.push(langSubDub || "sub");
    }

    const res = await run(
      `INSERT INTO ${historyTable} (${insertCols.join(", ")}) VALUES (${insertCols.map(() => "?").join(", ")})`,
      insertVals,
    );
    const newId = res?.lastInsertRowid || 0;

    if (newId > 0) {
      await cleanDuplicates(newId);
    }

    if (isComp === 1) {
      await notifyCompletion();
    }
  }

  if (process.versions?.electron) {
    try {
      const { UpdateDiscordRPC } = require("./discord");
      if (typeof UpdateDiscordRPC === "function") {
        UpdateDiscordRPC(
          resolvedTitle || type,
          parsedNum,
          type,
          image,
          mediaId,
          currentTime,
          duration,
        ).catch(() => {});
      }
    } catch (rpcErr) {}
  }
}

module.exports = {
  updateHistory,
  parseSeconds,
};
