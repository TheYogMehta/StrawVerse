const { DatabaseSync } = require("node:sqlite");
const path = require("path");
const os = require("os");

const dbPath = path.join(os.homedir(), ".config", "strawverse", "database.db");
const db = new DatabaseSync(dbPath);
const mappingDb = new DatabaseSync(path.join(os.homedir(), ".config", "strawverse", "mapping.db"));

// Get all Anime rows
const rows = db.prepare("SELECT id, title, MalID, CustomTag FROM Anime").all();

for (const item of rows) {
  if (!item.MalID) continue;
  
  let totalEpisodes = 0;
  let watchedEpisodes = 0;
  let nextEpisodeIn = null;
  let maxAired = null;
  let malStatus = "";

  const malInfo = db
    .prepare("SELECT totalEpisodes, watched, status FROM MyAnimeList WHERE id = ?")
    .get(String(item.MalID));
  if (malInfo) {
    totalEpisodes = malInfo.totalEpisodes || 0;
    watchedEpisodes = malInfo.watched || 0;
    malStatus = malInfo.status || "";
  }

  // Watch history
  let animeIds = [item.id];
  const siblings = db
    .prepare("SELECT id FROM Anime WHERE MalID = ?")
    .all(String(item.MalID));
  siblings.forEach((s) => {
    if (s.id) animeIds.push(s.id);
  });
  animeIds = Array.from(new Set(animeIds));
  const placeholders = animeIds.map(() => "?").join(",");
  const watchRow = db
    .prepare(`
      SELECT COUNT(DISTINCT episode_number) as count 
      FROM WatchHistory 
      WHERE anime_id IN (${placeholders}) AND is_completed = 1
    `)
    .get(...animeIds);
  
  if (watchRow && watchRow.count > 0) {
    watchedEpisodes = Math.max(watchedEpisodes, watchRow.count);
  }

  const mappingRow = mappingDb
    .prepare("SELECT livechart_id FROM anime WHERE malid = ?")
    .get(Number(item.MalID));
  
  if (mappingRow && mappingRow.livechart_id) {
    const livechartId = mappingRow.livechart_id;
    const now = Math.floor(Date.now() / 1000);
    
    // Get max aired
    const maxAiredRow = db
      .prepare(`
        SELECT MAX(episode) as max_aired FROM next_episodes 
        WHERE livechart_id = ? AND date <= ?
      `)
      .get(livechartId, now);
    if (maxAiredRow && maxAiredRow.max_aired !== null) {
      maxAired = maxAiredRow.max_aired;
    }

    // Get next episode countdown
    const nextEp = db
      .prepare(`
        SELECT episode, date FROM next_episodes 
        WHERE livechart_id = ? AND date > ? 
        ORDER BY date ASC LIMIT 1
      `)
      .get(livechartId, now);
    
    if (nextEp) {
      if (watchedEpisodes >= nextEp.episode - 1) {
        const diff = nextEp.date - now;
        const days = Math.ceil(diff / (24 * 3600));
        nextEpisodeIn = `Ep ${nextEp.episode}: ${days} days`;
      }
    }
  }

  const isCompleted = 
    malStatus === "completed" || 
    (totalEpisodes > 0 && watchedEpisodes >= totalEpisodes);

  let sortWeight = 30; // default
  if (isCompleted && nextEpisodeIn === null) {
    sortWeight = 50;
  } else if (nextEpisodeIn !== null) {
    sortWeight = 40;
  } else if (watchedEpisodes > 0) {
    if (maxAired !== null && watchedEpisodes < maxAired) {
      sortWeight = 10;
    } else {
      sortWeight = 20;
    }
  }

  console.log(`Title: ${item.title}`);
  console.log(`  MalID: ${item.MalID}`);
  console.log(`  Watched: ${watchedEpisodes}/${totalEpisodes}`);
  console.log(`  Max Aired: ${maxAired}`);
  console.log(`  Next Ep In: ${nextEpisodeIn}`);
  console.log(`  Sort Weight: ${sortWeight}`);
  console.log(`  MAL Status: ${malStatus}`);
}
