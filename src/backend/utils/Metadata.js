// libs
const BetterSqlite3 = require("better-sqlite3");
const { logger } = require("./AppLogger");
const { app } = require("electron");
const axios = require("axios");
const path = require("path");
const fs = require("fs");

// Database creation [gets created in /user/your_name/AppData/Roaming]
const userDataPath = app.getPath("userData");
const db = new BetterSqlite3(path.join(userDataPath, "metadata.db"));

const tables = {
  Anime: {
    id: "TEXT PRIMARY KEY",
    folder_name: "TEXT",
    title: "TEXT",
    subOrDub: "TEXT",
    type: "TEXT",
    provider: "TEXT",
    description: "TEXT",
    status: "TEXT",
    genres: "TEXT",
    aired: "TEXT",
    EpisodesDataId: "TEXT",
    image: "BLOB",
    last_updated: "DATE",
  },
  Manga: {
    id: "TEXT PRIMARY KEY",
    title: "TEXT",
    folder_name: "TEXT",
    provider: "TEXT",
    description: "TEXT",
    genres: "TEXT",
    type: "TEXT",
    author: "TEXT",
    released: "TEXT",
    image: "BLOB",
    last_updated: "DATE",
  },
  Mapping: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    MalID: "TEXT",
    AnimeKai: "TEXT",
    HiAnime: "TEXT",
    AnimePahe: "TEXT",
    NextEpisodes: "TEXT",
  },
  MyAnimeList: {
    id: "TEXT UNIQUE",
    title: "TEXT",
    image: "TEXT",
    totalEpisodes: "INTEGER",
    lastEpisode: "INTEGER",
    watched: "INTEGER",
    status: "TEXT",
    sortOrder: "INTEGER",
    updated_at: "TEXT",
    NextEpisodeIn: "TEXT",
  },
  last_ran_Mapping: {
    id: "INTEGER PRIMARY KEY AUTOINCREMENT",
    last_ran: "TEXT",
    last_fetched: "TEXT",
    last_Sync_Mal: "TEXT",
  },
};

// Create tables & update schema
Object.entries(tables).forEach(([tableName, columns]) => {
  const columnsString = Object.entries(columns)
    .map(([col, definition]) => `${col} ${definition}`)
    .join(", ");

  try {
    db.exec(`CREATE TABLE IF NOT EXISTS ${tableName} (${columnsString})`);
    updateTableSchema(tableName, columns);
  } catch (error) {
    throw new Error(`Error creating table ${tableName}: ${error.message}`);
  }
});

function updateTableSchema(tableName, expectedColumns) {
  try {
    const existingColumns = db
      .prepare(`PRAGMA table_info(${tableName})`)
      .all()
      .map((col) => col.name);

    Object.entries(expectedColumns).forEach(([col, definition]) => {
      if (!existingColumns.includes(col)) {
        db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${col} ${definition}`);
      }
    });
  } catch (error) {
    throw new Error(
      `Error updating table schema for ${tableName}: ${error.message}`
    );
  }
}

// Add metadata
async function MetadataAdd(type, valuesToAdd) {
  if (!tables[type] || !valuesToAdd?.id) {
    throw new Error(`Invalid args!`);
  }

  let existingRecord = db
    .prepare(`SELECT * FROM ${type} WHERE id = ? OR title = ?`)
    .get(valuesToAdd?.id, valuesToAdd?.title);

  if (!existingRecord) {
    if (valuesToAdd?.ImageUrl) {
      let Imageurl = valuesToAdd?.ImageUrl?.trim();

      try {
        const response = await axios.get(Imageurl, {
          responseType: "arraybuffer",
        });

        valuesToAdd.image = `data:image/png;base64,${Buffer.from(
          response.data
        ).toString("base64")}`;
      } catch (err) {
        logger.error(`Failed to fetch image from: ${Imageurl}`);
        logger.error(`Error message: ${err.message}`);
        logger.error(`Stack trace: ${err.stack}`);
      }
    }

    if (valuesToAdd?.title) {
      valuesToAdd.folder_name = valuesToAdd?.title?.replace(
        /[^a-zA-Z0-9]/g,
        "_"
      );
    }

    try {
      const validColumns = Object.keys(tables[type]);
      const filteredValues = {};

      validColumns.forEach((column) => {
        if (valuesToAdd.hasOwnProperty(column)) {
          filteredValues[column] = valuesToAdd[column];
        } else {
          const columnType = tables[type][column];
          if (columnType.includes("TEXT")) {
            filteredValues[column] = "";
          } else if (columnType.includes("INTEGER")) {
            filteredValues[column] = 0;
          } else if (columnType.includes("BLOB")) {
            filteredValues[column] = null;
          }
        }
      });

      const fields = Object.keys(filteredValues).join(", ") + ", last_updated";
      const placeholders =
        Object.keys(filteredValues)
          .map(() => "?")
          .join(", ") + ", CURRENT_TIMESTAMP";
      const values = Object.values(filteredValues);

      db.prepare(
        `INSERT INTO ${type} (${fields}) VALUES (${placeholders})`
      ).run(...values);
    } catch (error) {
      throw new Error(`Error inserting into ${type}: ${error.message}`);
    }
  }
}

// Remove metadata
function MetadataRemove(type, id) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  try {
    db.exec(`DELETE FROM ${type} WHERE id = '${id}'`);
  } catch (error) {
    throw new Error(`Error deleting from ${type}: ${error.message}`);
  }
}

// Get All Metadata
async function getAllMetadata(type, baseDir, page = 1) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  try {
    const typeDir = path.join(baseDir, type);

    if (!fs.existsSync(typeDir)) {
      return {
        totalPages: 0,
        currentPage: 1,
        hasNextPage: false,
        totalItems: 0,
        results: [],
      };
    }

    const directories = await fs.promises.readdir(typeDir, {
      withFileTypes: true,
    });

    const folders = directories
      .filter((dir) => dir.isDirectory())
      .map((dir) => dir.name);

    if (folders?.length > 0) {
      let storedMetadata = [];
      try {
        storedMetadata = db
          .prepare(`SELECT * FROM ${type} ORDER BY last_updated DESC`)
          .all();
      } catch (err) {
        // ignore
        storedMetadata = [];
      }

      const missingFolders = storedMetadata
        .filter((entry) => !folders.includes(entry.folder_name))
        .map((entry) => entry.folder_name);

      missingFolders.forEach((folder) => {
        db.exec(`DELETE FROM ${type} WHERE folder_name = '${folder}'`);
      });

      folders.map((alltitles) => {
        if (
          storedMetadata.some(
            (meta_data) => meta_data.folder_name === alltitles
          )
        )
          return;
        storedMetadata.push({
          title: alltitles.replaceAll("_", ""),
          folder_name: alltitles,
          id: alltitles,
          type: type,
          provider: "local source",
        });
      });

      // Pagination logic
      const limit = 15;
      const totalPages = Math.ceil(storedMetadata?.length / limit);
      const startIndex = (page - 1) * limit;
      const paginatedMetadata = storedMetadata.slice(
        startIndex,
        startIndex + limit
      );
      const hasNextPage = page < totalPages;

      const updatedMetadata = [];

      for (const metadata of paginatedMetadata) {
        const folderPath = path.join(baseDir, type, metadata.folder_name);

        if (!fs.existsSync(folderPath)) {
          db.exec(`DELETE FROM ${type} WHERE id = '${metadata.id}'`);
          continue;
        }

        let content = [];
        const filesAndFolders = await fs.promises.readdir(folderPath, {
          withFileTypes: true,
        });

        if (type === "Anime") {
          content = filesAndFolders
            .filter(
              (file) =>
                file.isFile() &&
                file.name.endsWith(".mp4") &&
                file.name.toLowerCase().includes("ep")
            )
            .map((file) =>
              parseInt(file?.name?.toLowerCase()?.split("ep")?.[0])
            )
            .filter(Boolean)
            .sort((a, b) => a - b);
        } else if (type === "Manga") {
          content = filesAndFolders
            .filter(
              (file) =>
                file.isFile() &&
                file.name.endsWith(".cbz") &&
                file.name.toLowerCase().includes("chapter")
            )
            .map((file) =>
              parseInt(
                file?.name
                  ?.toLowerCase()
                  ?.split("chapter")?.[1]
                  ?.split(".cbz")[0]
              )
            )
            .filter(Boolean)
            .sort((a, b) => a - b);
        }

        updatedMetadata.push({
          ...metadata,
          Downloaded: content,
        });
      }

      return {
        totalPages,
        currentPage: page,
        hasNextPage,
        results: updatedMetadata,
      };
    }

    throw new Error("No Anime Found!");
  } catch (err) {
    throw new Error(`Error fetching metadata: ${err.message}`);
  }
}

// Get Local Provider And Info
async function FetchLocalProviderInfo(type, id) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  try {
    const metadata = db.prepare(`SELECT * FROM ${type} WHERE id = ?`).get(id);
    if (!metadata) {
      throw new Error(`No metadata found for ID: ${id}`);
    }

    if (metadata?.genres) {
      try {
        metadata.genres = metadata?.genres?.split(",") ?? [];
      } catch (error) {
        metadata.genres = [];
      }
    }

    if (metadata?.EpisodesDataId) {
      metadata.dataId = metadata?.EpisodesDataId;
      delete metadata.EpisodesDataId;
    }

    return metadata;
  } catch (err) {
    throw new Error(`Error fetching metadata by ID: ${err.message}`);
  }
}

// Get Local Source By id
async function getSourceById(type, baseDir, id, number) {
  if (!tables[type]) {
    throw new Error(`Invalid table: ${type}`);
  }

  let folder_name = id;
  try {
    const metadata = db.prepare(`SELECT * FROM ${type} WHERE id = ?`).get(id);
    if (metadata) {
      folder_name = metadata.folder_name;
    }
  } catch (err) {
    // ignore
  }

  try {
    const folderPath = path.join(baseDir, type, folder_name);
    if (!fs.existsSync(folderPath)) {
      throw new Error(`Folder does not exist: ${folderPath}`);
    }

    DataToReturn = {};
    let fileName = null;

    if (type === "Anime") {
      fileName = `${number}Ep.mp4`;
    } else if (type === "Manga") {
      fileName = `Chapter ${number}.cbz`;
    }

    if (!fileName) {
      throw new Error(`File not found for ${type} ${number}`);
    }

    const subtitlesDir = path.join(folderPath, `subs`);
    let subtitleFiles = [];

    if (fs.existsSync(subtitlesDir)) {
      subtitleFiles = fs
        .readdirSync(subtitlesDir)
        .filter(
          (file) =>
            (file.endsWith(".srt") || file.endsWith(".vtt")) &&
            file?.startsWith(`${number}Ep.`)
        )
        .map((subtitle) => {
          return {
            url: `/subtitles?file=${encodeURIComponent(
              path.join(subtitlesDir, subtitle)
            )}`,
            lang: subtitle.split(".")[1],
          };
        });
    }
    return {
      filepath: path.join(folderPath, fileName),
      ...DataToReturn,
      subtitleFiles: subtitleFiles,
    };
  } catch (err) {
    throw new Error(`Error fetching file by ID: ${err.message}`);
  }
}

// get last mapping updated time
function getMappingLastRun() {
  try {
    const row = db
      .prepare(
        "SELECT last_ran, last_fetched FROM last_ran_Mapping WHERE id = 1"
      )
      .get();
    return {
      last_ran: row?.last_ran ?? "1970-01-01T00:00:00.000Z",
      last_fetched: row?.last_fetched ?? null,
    };
  } catch (error) {
    return {
      last_ran: "1970-01-01T00:00:00.000Z",
      last_fetched: null,
    };
  }
}

// get last malsync updated time
async function getMALLastSync() {
  try {
    const row = db
      .prepare("SELECT last_Sync_Mal FROM last_ran_Mapping WHERE id = 2")
      .get();

    return row?.last_Sync_Mal ?? null;
  } catch (error) {
    return null;
  }
}

// save mapping data
function SaveMappingDatabase(data, last_ran) {
  db.exec("DROP TABLE IF EXISTS Mapping;");
  db.exec(
    `CREATE TABLE Mapping (${Object.entries(tables.Mapping)
      .map(([col, definition]) => `${col} ${definition}`)
      .join(", ")});`
  );
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'Mapping';");
  const insert = db.prepare(
    `INSERT INTO Mapping (MalID , AnimeKai, HiAnime, AnimePahe, NextEpisodes) VALUES (?, ?, ?, ?, ?)`
  );

  const insertMany = db.transaction((entries) => {
    for (const entry of entries) {
      insert.run(
        String(entry?.MalId) || null,
        JSON.stringify(entry?.AnimeKai || []),
        JSON.stringify(entry?.HiAnime || []),
        JSON.stringify(entry?.AnimePahe || []),
        JSON.stringify(entry?.NextEpisodes || [])
      );
    }
  });

  insertMany(data);

  db.prepare(
    "INSERT OR REPLACE INTO last_ran_Mapping (id, last_ran, last_fetched) VALUES (1, ?, ?)"
  ).run(last_ran, new Date().toISOString());
}

// fetch updates
async function fetchAndUpdateMappingDatabase() {
  const { last_ran, last_fetched } = getMappingLastRun();

  let timeDiffInHours = null;

  if (last_fetched) {
    const now = new Date();
    const lastFetchedTime = new Date(last_fetched);
    timeDiffInHours = (now - lastFetchedTime) / (1000 * 60 * 60);
  }

  if (!timeDiffInHours || timeDiffInHours > 1) {
    try {
      const response = await axios.post("http://194.164.125.5:6145/last_ran", {
        last_ran: last_ran,
      });
      if (
        response.data &&
        response.data.data &&
        response.data.data.length > 0
      ) {
        logger.info("[MAL-LIST] NEW MAPPING FOUND");
        SaveMappingDatabase(response.data.data, response.data.last_ran);
        logger.info("[MAL-LIST] MAPPING UPDATED");
      }
    } catch (err) {
      logger.error("[MAL-LIST] MAPPING FAILED");
      logger.error(`Error message: ${err.message}`);
      logger.error(`Stack trace: ${err.stack}`);
    }
  }
}

// find mapping ids
async function FindMapping(type, AnimeMangaid, malid, dir) {
  try {
    let data = {};

    // if logged in mal && Anime
    if (type === "Anime") {
      let id = AnimeMangaid?.replace(/-(dub|sub|both)$/, "");

      try {
        // if no malid find mapping
        if (!malid) {
          const FoundRow = db
            .prepare(
              "SELECT * FROM Mapping WHERE AnimeKai LIKE ? OR HiAnime LIKE ? OR AnimePahe LIKE ?"
            )
            .get(`%${id}%`, `%${id}%`, `%${id}%`);

          data.malid = FoundRow?.MalID ? parseInt(FoundRow.MalID) : null;
        } else {
          data.malid = malid;
        }

        // if mal id find in list if it exists
        if (data.malid && global.MalLoggedIn) {
          let MalInfo = db
            .prepare(`SELECT * FROM MyAnimeList WHERE id = ?`)
            .get(String(data.malid));

          data = {
            ...data,
            totalEpisodes:
              MalInfo?.totalEpisodes > 0
                ? MalInfo.totalEpisodes
                : MalInfo?.lastEpisode
                ? MalInfo.lastEpisode
                : 0,
            lastEpisode: MalInfo.lastEpisode ?? null,
            watched: MalInfo.watched ?? 0,
            status: MalInfo.status ?? "",
          };
        }
      } catch (err) {
        // ignore
      }

      // Finding If Its Downloaded
      try {
        const Downloads = db
          .prepare("SELECT * FROM Anime WHERE id = ? or id = ?")
          .all(`${id}-sub`, `${id}-dub`);

        if (Downloads?.length > 0) {
          Downloads[0].dataId = Downloads[0]?.EpisodesDataId;
          delete Downloads[0].EpisodesDataId;

          data = {
            ...Downloads[0],
            DownloadedEpisodes: {
              sub: [],
              dub: [],
            },
            ...data,
          };

          for (const SubDub of Downloads) {
            const folderPath = path.join(
              dir,
              "Anime",
              `${SubDub.title?.replace(/[^a-zA-Z0-9]/g, "_")}`
            );

            if (fs.existsSync(folderPath)) {
              const filesAndFolders = await fs.promises.readdir(folderPath, {
                withFileTypes: true,
              });

              data.DownloadedEpisodes[SubDub.subOrDub] = filesAndFolders
                .filter(
                  (file) =>
                    file.isFile() &&
                    file.name.endsWith(".mp4") &&
                    file.name.match(/\d+/)
                )
                .map((file) => parseInt(file.name.match(/\d+/)[0]))
                .filter(Boolean)
                .sort((a, b) => a - b);
            }
          }
        } else {
          const folderPath = path.join(dir, "Anime", AnimeMangaid);

          if (fs.existsSync(folderPath)) {
            const filesAndFolders = await fs.promises.readdir(folderPath, {
              withFileTypes: true,
            });

            data = {
              title: AnimeMangaid.replaceAll("_", ""),
              folder_name: AnimeMangaid,
              id: AnimeMangaid,
              type: "Anime",
              provider: "local source",
              DownloadedEpisodes: {
                sub: [],
                dub: [],
              },
            };

            data.DownloadedEpisodes["sub"] = filesAndFolders
              .filter(
                (file) =>
                  file.isFile() &&
                  file.name.endsWith(".mp4") &&
                  file.name.match(/\d+/)
              )
              .map((file) => parseInt(file.name.match(/\d+/)[0]))
              .filter(Boolean)
              .sort((a, b) => a - b);
          }
        }
      } catch (err) {
        // ignore
      }
    } else {
      try {
        const Downloads = db
          .prepare("SELECT * FROM Manga WHERE id = ?")
          .get(AnimeMangaid);

        if (Downloads) {
          data = { ...Downloads, DownloadedChapters: [] };

          const folderPath = path.join(dir, type, Downloads.folder_name);

          if (fs.existsSync(folderPath)) {
            const filesAndFolders = await fs.promises.readdir(folderPath, {
              withFileTypes: true,
            });

            data.DownloadedChapters = filesAndFolders
              .filter(
                (file) =>
                  file.isFile() &&
                  file.name.endsWith(".cbz") &&
                  file.name.toLowerCase().includes("chapter")
              )
              .map((file) =>
                parseInt(file.name.toLowerCase().split("chapter")[1])
              )
              .filter(Boolean)
              .sort((a, b) => a - b);
          }
        }
      } catch (err) {
        // ignore erro
      }
    }

    return data;
  } catch (err) {
    logger.error(`Error Fetching Mapping`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return null;
  }
}

// Map MAL
async function MalEpMap(data = []) {
  try {
    if (!data.length) return true;

    const ids = data.map((entry) => entry.id.toString());

    const existingEntries = db
      .prepare(
        `SELECT * FROM MyAnimeList WHERE id IN (${ids
          .map(() => "?")
          .join(",")})`
      )
      .all(...ids);

    const existingMap = new Map(
      existingEntries.map((entry) => [entry.id, entry])
    );

    let NotChanged = false;

    let InsertOrUpdateQuery = db.prepare(`
      INSERT INTO MyAnimeList (id, title, image, totalEpisodes, watched, status, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET 
        title = excluded.title,
        image = excluded.image,
        totalEpisodes = excluded.totalEpisodes,
        watched = excluded.watched,
        status = excluded.status,
        updated_at = excluded.updated_at
    `);

    const insertMany = db.transaction((entries) => {
      for (const entry of entries) {
        const existing = existingMap.get(entry.id.toString());

        if (
          existing &&
          existing.title === entry.title &&
          existing.image === entry.image &&
          existing.totalEpisodes === parseInt(entry.totalEpisodes ?? 0) &&
          existing.watched === parseInt(entry.watched ?? 0) &&
          existing.status === entry.status &&
          existing.updated_at === entry.updated_at
        ) {
          NotChanged = true;
          continue;
        }

        InsertOrUpdateQuery.run(
          entry.id.toString(),
          entry.title,
          entry.image,
          parseInt(entry.totalEpisodes ?? 0),
          parseInt(entry.watched ?? 0),
          entry.status,
          entry.updated_at
        );
      }
    });

    insertMany(data);

    return NotChanged;
  } catch (err) {
    logger.error(`Failed To Update MyAnimeList`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
    return true;
  }
}

// Mal Sort
async function processAndSortMyAnimeList() {
  try {
    let animeList = db
      .prepare(`SELECT * FROM MyAnimeList WHERE status = 'watching'`)
      .all();
    if (animeList.length === 0) return;

    let malIds = animeList.map((anime) => anime.id);

    let mappingData = db
      .prepare(
        `SELECT MalID, NextEpisodes FROM Mapping WHERE MalID IN (${malIds
          .map(() => "?")
          .join(",")})`
      )
      .all(...malIds);

    let mappingMap = new Map();
    for (let { MalID, NextEpisodes } of mappingData) {
      if (NextEpisodes && NextEpisodes !== "[]") {
        try {
          let parsedEpisodes = JSON.parse(NextEpisodes);
          if (parsedEpisodes.length) {
            mappingMap.set(MalID, parsedEpisodes);
          }
        } catch (e) {}
      }
    }

    let now = Date.now();

    let animeData = animeList.map((anime) => {
      let totalEpisodes = parseInt(anime.totalEpisodes) || 0;

      let NextEpisodes =
        mappingMap
          ?.get(anime.id)
          ?.filter((item) => item?.Episode > totalEpisodes) ?? [];

      if (NextEpisodes.length > 0) {
        let lastEpisode = NextEpisodes[0].Episode - 1;
        let lastDate = parseInt(NextEpisodes[0].date) * 1000;
        return {
          ...anime,
          hasNext: true,
          lastEpisode: lastEpisode,
          lastDate: lastDate,
          daysLeft: Math.floor((lastDate - now) / (1000 * 60 * 60 * 24)),
          watchedLast: anime.watched === lastEpisode,
          isCompleted: anime.watched >= totalEpisodes,
        };
      } else {
        return {
          ...anime,
          hasNext: false,
        };
      }
    });

    animeData.sort((a, b) => {
      if (a.hasUnwatchedReleased !== b.hasUnwatchedReleased)
        return Number(b.hasUnwatchedReleased) - Number(a.hasUnwatchedReleased);

      if (a.hasNext !== b.hasNext) return Number(b.hasNext) - Number(a.hasNext);

      if (a.watchedLast !== b.watchedLast)
        return Number(b.watchedLast) - Number(a.watchedLast);

      if (a.lastDate && b.lastDate) {
        let isWithin14DaysA = a.daysLeft >= 1 && a.daysLeft <= 14;
        let isWithin14DaysB = b.daysLeft >= 1 && b.daysLeft <= 14;

        if (isWithin14DaysA !== isWithin14DaysB)
          return Number(isWithin14DaysB) - Number(isWithin14DaysA);

        return a.daysLeft - b.daysLeft;
      }

      if (a.isCompleted !== b.isCompleted)
        return Number(a.isCompleted) - Number(b.isCompleted);

      return 0;
    });

    let updateQuery = db.prepare(`
      UPDATE MyAnimeList 
      SET title = ?, image = ?, totalEpisodes = ?, watched = ?, sortOrder = ?, NextEpisodeIn = ? 
      WHERE id = ?
    `);

    animeData.forEach((entry, index) => {
      updateQuery.run(
        entry.title,
        entry.image,
        entry?.totalEpisodes > 0
          ? entry.totalEpisodes
          : entry?.lastEpisode
          ? entry?.lastEpisode
          : 0,
        entry.watched,
        index,
        entry?.lastDate ? String(entry.lastDate) : null,
        entry.id
      );
    });

    db.prepare(
      "INSERT OR REPLACE INTO last_ran_Mapping (id, last_Sync_Mal) VALUES (2, ?)"
    ).run(new Date().toISOString());

    logger.info(`[MyAnimeList] Successfully Sorted!`);
  } catch (err) {
    logger.error(`Error processing MyAnimeList`);
    logger.error(`Error message: ${err.message}`);
    logger.error(`Stack trace: ${err.stack}`);
  }
}

// Mal Retrive Pages
async function MalPage(provider_name, page = 1) {
  try {
    const limit = 30;
    const offset = (page - 1) * limit;
    let animeList = db
      .prepare(
        `SELECT * FROM MyAnimeList 
       WHERE status = 'watching' 
       AND sortOrder > 0 
       ORDER BY sortOrder 
       LIMIT ? OFFSET ?`
      )
      .all(limit, offset);

    let totalRecords =
      db
        .prepare(
          `SELECT COUNT(*) AS total FROM MyAnimeList WHERE status = 'watching'`
        )
        .get()?.total || 0;

    let hasNextPage = offset + limit < totalRecords;
    let totalPages = Math.ceil(totalRecords / limit);

    if (animeList.length === 0) throw new Error("Empty");

    let malIds = animeList.map((anime) => anime.id);
    let mappingData = db
      .prepare(
        `SELECT MalID, AnimeKai, HiAnime, AnimePahe FROM Mapping WHERE MalID IN (${malIds
          .map(() => "?")
          .join(",")})`
      )
      .all(...malIds);

    let filteredAnime = animeList.map((anime) => {
      let mapping = mappingData.find((map) => map.MalID === anime.id);
      if (!mapping) return null;

      let providerId = null;
      switch (provider_name) {
        case "animekai":
          providerId = mapping.AnimeKai;
          break;
        case "hianime":
          providerId = mapping.HiAnime;
          break;
        case "pahe":
          providerId = mapping.AnimePahe;
          break;
      }

      if (providerId && providerId !== "[]" && providerId !== "{}") {
        try {
          providerId = JSON.parse(providerId);
          providerId =
            Array.isArray(providerId) && providerId.length > 0
              ? providerId[0]
              : null;
        } catch (e) {
          providerId = null;
        }
      } else {
        providerId = null;
      }

      return providerId ? { ...anime, MalID: anime.id, id: providerId } : null;
    });

    let lists = filteredAnime.filter((anime) => anime !== null);

    return {
      totalPages,
      currentPage: page,
      hasNextPage,
      totalItems: totalRecords,
      results: lists,
    };
  } catch (err) {
    return {
      totalPages: 0,
      currentPage: page,
      hasNextPage: false,
      totalItems: 0,
      results: [],
    };
  }
}

module.exports = {
  MetadataAdd,
  MetadataRemove,
  getAllMetadata,
  getSourceById,
  fetchAndUpdateMappingDatabase,
  FindMapping,
  MalEpMap,
  processAndSortMyAnimeList,
  getMALLastSync,
  MalPage,
  FetchLocalProviderInfo,
};
