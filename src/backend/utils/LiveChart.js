const axios = require("axios");
const cheerio = require("cheerio");
const { logger } = require("./AppLogger");
const { getKeyValue, setKeyValue } = require("./db");

async function getRandomDelay(min, max) {
  return Math.floor(Math.random() * (max - min + 1) + min);
}

async function getWeeklyDates(weeks) {
  const dates = [];
  const currentDate = new Date();
  for (let i = 0; i < weeks; i++) {
    const date = new Date(currentDate.getTime() + i * 7 * 24 * 60 * 60 * 1000);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    dates.push(`${yyyy}-${mm}-${dd}`);
  }
  return dates;
}

async function LiveChartSchedule() {
  try {
    let WeeksToExtract = await getWeeklyDates(5);
    let Schedule = [];

    for (let i = 0; i < WeeksToExtract.length; i++) {
      try {
        const { data } = await axios.get(
          `https://www.livechart.me/schedule?date=${WeeksToExtract[i]}`,
          {
            headers: {
              Cookie: `preferences.schedule=${encodeURIComponent(
                JSON.stringify({
                  layout: "full",
                  start: "today",
                  sort: "release_date",
                  sort_dir: "asc",
                  included_marks: {
                    unmarked: true,
                  },
                }),
              )}`,
            },
          },
        );

        const $ = cheerio.load(data);

        const TodaysSchedules = $("article[data-anime-id]")
          .map((i, ele) => {
            let livechart_id = $(ele).attr("data-anime-id");
            if (!livechart_id) return null;

            let TimeElement = $(ele).find("a > time");

            let date = parseInt(TimeElement?.attr("data-timestamp"));
            if (!date || isNaN(date)) return null;

            let Episode = TimeElement?.closest("a")
              ?.find("span")
              ?.text()
              ?.toLocaleLowerCase();

            let EP = null;
            if (Episode?.length === 0) {
              EP = 1;
            } else if (Episode?.includes("-")) {
              let range = Episode.split("-").map((x) => parseInt(x.trim(), 10));
              EP = range.length > 1 ? Math.min(...range) : range[0];
            } else if (Episode) {
              EP = parseInt(Episode.replace(/[^\d]/g, ""), 10);
            }

            if (!EP || isNaN(EP)) {
              logger.info(
                `[livechart] not able to process : EP : ${Episode} | ID : ${livechart_id}`,
              );
              return null;
            }

            let MalId = $(ele)
              .find(`a[href*="https://myanimelist.net/anime/"]`)
              .first()
              ?.attr("href")
              ?.split("/anime/")[1];

            if (!MalId) return null;

            return {
              Episode: EP,
              date: date,
              MalId: parseInt(MalId),
              livechart_id: livechart_id,
            };
          })
          .get()
          .filter(
            (item) =>
              item?.Episode && item?.date && item?.MalId && item?.livechart_id,
          );

        if (TodaysSchedules.length > 0) {
          Schedule.push(...TodaysSchedules);
        }
      } catch (err) {
        logger.error(
          `[livechart] Failed To Extract ${WeeksToExtract[i]} Schedules: ${err.message}`,
        );
      }
      await new Promise(async (resolve) =>
        setTimeout(resolve, await getRandomDelay(1000, 5000)),
      );
    }

    logger.info(`[livechart] Found ${Schedule.length} Total Schedules`);

    if (Schedule.length > 0) {
      const selectAnime = global.mappingDb.prepare(`
        SELECT livechart_id FROM anime WHERE malid = ?
      `);

      const insertAnime = global.mappingDb.prepare(`
        INSERT INTO anime (malid, livechart_id)
        VALUES (?, ?)
        ON CONFLICT(malid) DO UPDATE SET livechart_id = excluded.livechart_id
      `);

      const selectEpisode = global.db.prepare(`
        SELECT date FROM next_episodes WHERE livechart_id = ? AND episode = ?
      `);

      const insertEpisode = global.db.prepare(`
        INSERT INTO next_episodes (livechart_id, episode, date)
        VALUES (?, ?, ?)
      `);

      const updateEpisode = global.db.prepare(`
        UPDATE next_episodes SET date = ?
        WHERE livechart_id = ? AND episode = ?
      `);

      global.mappingDb.exec("BEGIN");
      global.db.exec("BEGIN");

      try {
        for (const element of Schedule) {
          try {
            const existingAnime = selectAnime.get(element.MalId);
            if (
              !existingAnime ||
              existingAnime.livechart_id !== element.livechart_id
            ) {
              insertAnime.run(element.MalId, element.livechart_id);
            }
            const existingEp = selectEpisode.get(
              element.livechart_id,
              element.Episode,
            );

            if (!existingEp) {
              insertEpisode.run(
                element.livechart_id,
                element.Episode,
                element.date,
              );
            } else if (existingEp.date !== element.date) {
              updateEpisode.run(
                element.date,
                element.livechart_id,
                element.Episode,
              );
            }
          } catch (err) {
            logger.error(
              `[livechart] Failed to process Schedule entry for MalId ${element.MalId}, livechart_id ${element.livechart_id}: ${err.message}`,
            );
          }
        }
        global.mappingDb.exec("COMMIT");
        global.db.exec("COMMIT");
        logger.info(
          `[livechart] Successfully processed and synchronized ${Schedule.length} schedules.`,
        );
      } catch (err) {
        try {
          global.mappingDb.exec("ROLLBACK");
        } catch (_) {}
        try {
          global.db.exec("ROLLBACK");
        } catch (_) {}
        throw err;
      }
    }
  } catch (err) {
    logger.error(`[livechart] Error: ${err.message}`);
  }
}

async function runLiveChartScheduleIfNeeded() {
  try {
    const lastRunKey = "last_livechart_schedule_run";
    const lastRun = getKeyValue("Settings", lastRunKey);
    const oneWeekMs = 7 * 24 * 60 * 60 * 1000;

    if (!lastRun || Date.now() - Number(lastRun) >= oneWeekMs) {
      logger.info("[livechart] Running weekly LiveChart schedule update...");
      await LiveChartSchedule();
      setKeyValue("Settings", lastRunKey, Date.now());
    } else {
      const daysLeft = ((oneWeekMs - (Date.now() - Number(lastRun))) / (24 * 60 * 60 * 1000)).toFixed(1);
      logger.info(`[livechart] Weekly LiveChart schedule update skipped (last run was ${daysLeft} days ago).`);
    }
  } catch (err) {
    logger.error(`[livechart] Error checking/running schedule: ${err.message}`);
  }
}

module.exports = {
  LiveChartSchedule,
  runLiveChartScheduleIfNeeded,
};
