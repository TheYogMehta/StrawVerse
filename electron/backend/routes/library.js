const express = require("express");
const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/AppLogger");
const { settingfetch, providerFetch } = require("../utils/settings");
const {
  animeinfo,
  MangaInfo,
  invalidateCache,
  resolveDownloadFolder,
} = require("../utils/AnimeManga");
const { MetadataRemove, MetadataAdd } = require("../utils/Metadata");
const {
  getBaseDownloadDir,
  cleanupEmptyDownloadFolder,
} = require("../download");
const { updateHistory } = require("../utils/history");
const { getKeyValue, setKeyValue } = require("../utils/db");
const { sanitizeFolderName } = require("../utils/DirectoryMaker");

const { GetDir } = require("../utils/DirectoryMaker");
const ImageCacheManager = require("../utils/ImageCacheManager");
const { sendToRenderer } = require("../utils/rendererIPC");

const router = express.Router();

function getReservedTags(type) {
  return type === "Manga"
    ? ["Reading", "Downloads", "Plan to Read"]
    : ["Watching", "Downloads", "Plan to Watch"];
}

// View tags for Anime/Manga in custom user order
router.get("/api/local/tags", (req, res) => {
  const type = req.query.type === "Manga" ? "Manga" : "Anime";
  res.redirect(
    `/api/local/tags/view/${type}${req.query.includeHidden ? "?includeHidden=true" : ""}`,
  );
});

router.get("/api/local/tags/view/:type", async (req, res) => {
  try {
    const { type } = req.params;
    if (type !== "Anime" && type !== "Manga") {
      throw new Error("Invalid type parameter");
    }
    const includeHidden = req.query.includeHidden === "true";
    const defaultTags = getReservedTags(type);
    const savedOrder =
      getKeyValue("Settings", `tag_order_${type}`) || defaultTags;
    const hiddenTags = getKeyValue("Settings", `hidden_tags_${type}`) || [];

    const rows = global.db
      .prepare(
        `SELECT CustomTag FROM ${type} WHERE CustomTag IS NOT NULL AND CustomTag != ''`,
      )
      .all();
    const allTagsSet = new Set([...defaultTags, ...savedOrder]);
    for (const r of rows) {
      const tag = r.CustomTag ? r.CustomTag.trim() : "";
      if (tag) {
        try {
          const parsed = JSON.parse(tag);
          if (Array.isArray(parsed)) {
            parsed.forEach((t) => {
              if (t && t.trim()) allTagsSet.add(t.trim());
            });
          } else if (typeof parsed === "string" && parsed.trim()) {
            allTagsSet.add(parsed.trim());
          }
        } catch (e) {
          if (tag.includes(",")) {
            tag.split(",").forEach((t) => {
              if (t && t.trim()) allTagsSet.add(t.trim());
            });
          } else {
            allTagsSet.add(tag);
          }
        }
      }
    }

    const orderedList = [];

    for (const tag of savedOrder) {
      if (allTagsSet.has(tag)) {
        orderedList.push(tag);
        allTagsSet.delete(tag);
      }
    }

    for (const tag of allTagsSet) {
      orderedList.push(tag);
    }

    if (includeHidden) {
      const tagsWithState = orderedList.map((tag) => ({
        name: tag,
        hidden: hiddenTags.includes(tag),
      }));
      return res.json({ tags: tagsWithState, hiddenTags });
    }

    const visibleTags = orderedList.filter((t) => !hiddenTags.includes(t));
    res.json(visibleTags);
  } catch (err) {
    logger.error(`Error fetching tags for ${req.params.type}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Create custom tag in settings
router.post("/api/local/tags/create", async (req, res) => {
  try {
    const { type, tag } = req.body;
    if (!type || !tag || (type !== "Anime" && type !== "Manga")) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const trimmed = tag.trim();
    if (!trimmed) {
      return res.status(400).json({ error: "Tag name cannot be empty" });
    }

    const reservedLower = [
      "watching",
      "plan to watch",
      "reading",
      "plan to read",
      "downloads",
    ];
    if (reservedLower.includes(trimmed.toLowerCase())) {
      return res.status(400).json({
        error: `"${trimmed}" is a reserved system tag and cannot be created manually.`,
      });
    }

    const defaultTags = getReservedTags(type);
    const savedOrder = getKeyValue("Settings", `tag_order_${type}`) || [
      ...defaultTags,
    ];
    if (
      savedOrder.some((t) => t.trim().toLowerCase() === trimmed.toLowerCase())
    ) {
      return res.status(400).json({
        error: `A tag named "${trimmed}" already exists. Tag names must be unique.`,
      });
    }

    savedOrder.push(trimmed);
    setKeyValue("Settings", `tag_order_${type}`, savedOrder);

    return res.json({
      error: false,
      message: "Tag created successfully",
      tags: savedOrder,
    });
  } catch (err) {
    logger.error(`Error in /api/local/tags/create: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Reorder tags in settings
router.post("/api/local/tags/reorder", async (req, res) => {
  try {
    const { type, tags } = req.body;
    if (
      !type ||
      !Array.isArray(tags) ||
      (type !== "Anime" && type !== "Manga")
    ) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    setKeyValue("Settings", `tag_order_${type}`, tags);
    return res.json({
      error: false,
      message: "Tag order saved successfully",
      tags,
    });
  } catch (err) {
    logger.error(`Error in /api/local/tags/reorder: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Toggle tag visibility (hide / unhide)
router.post("/api/local/tags/toggle-visibility", async (req, res) => {
  try {
    const { type, tag, hidden } = req.body;
    if (!type || !tag || (type !== "Anime" && type !== "Manga")) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const trimmed = tag.trim();
    let hiddenTags = getKeyValue("Settings", `hidden_tags_${type}`) || [];

    if (hidden) {
      if (!hiddenTags.includes(trimmed)) {
        hiddenTags.push(trimmed);
      }
    } else {
      hiddenTags = hiddenTags.filter((t) => t !== trimmed);
    }

    setKeyValue("Settings", `hidden_tags_${type}`, hiddenTags);
    return res.json({
      error: false,
      message: `Tag "${trimmed}" ${hidden ? "hidden" : "unhidden"} successfully`,
      hiddenTags,
    });
  } catch (err) {
    logger.error(`Error in /api/local/tags/toggle-visibility: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Delete custom tag from settings and library items
router.post("/api/local/tags/delete-tag", async (req, res) => {
  try {
    const { type, tag } = req.body;
    if (!type || !tag || (type !== "Anime" && type !== "Manga")) {
      return res.status(400).json({ error: "Invalid parameters" });
    }

    const trimmed = tag.trim();
    const reservedLower = [
      "watching",
      "plan to watch",
      "reading",
      "plan to read",
      "downloads",
    ];
    if (reservedLower.includes(trimmed.toLowerCase())) {
      return res
        .status(400)
        .json({ error: `System tag "${trimmed}" cannot be deleted.` });
    }

    // 1. Remove from saved order & hidden list
    const defaultTags = getReservedTags(type);
    let savedOrder =
      getKeyValue("Settings", `tag_order_${type}`) || defaultTags;
    savedOrder = savedOrder.filter((t) => t !== trimmed);
    setKeyValue("Settings", `tag_order_${type}`, savedOrder);

    let hiddenTags = getKeyValue("Settings", `hidden_tags_${type}`) || [];
    if (hiddenTags.includes(trimmed)) {
      hiddenTags = hiddenTags.filter((t) => t !== trimmed);
      setKeyValue("Settings", `hidden_tags_${type}`, hiddenTags);
    }

    // 2. Remove from database items
    const rows = global.db
      .prepare(
        `SELECT id, CustomTag FROM ${type} WHERE CustomTag IS NOT NULL AND CustomTag != ''`,
      )
      .all();

    for (const r of rows) {
      if (!r.CustomTag) continue;
      let tagsArr = [];
      try {
        const parsed = JSON.parse(r.CustomTag);
        if (Array.isArray(parsed)) tagsArr = parsed;
        else if (typeof parsed === "string") tagsArr = [parsed];
      } catch (e) {
        tagsArr = [r.CustomTag];
      }

      if (tagsArr.includes(trimmed)) {
        const updatedTags = tagsArr.filter((t) => t !== trimmed);
        const newCustomTag =
          updatedTags.length > 0 ? JSON.stringify(updatedTags) : null;
        global.db
          .prepare(`UPDATE ${type} SET CustomTag = ? WHERE id = ?`)
          .run(newCustomTag, r.id);
      }
    }

    return res.json({
      error: false,
      message: `Tag "${trimmed}" deleted successfully`,
      tags: savedOrder,
    });
  } catch (err) {
    logger.error(`Error in /api/local/tags/delete-tag: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// Add/Update local library tags or entry
router.post("/api/local/tags/add", async (req, res) => {
  try {
    let { type, id, provider, MalID, CustomTag } = req.body;
    if (!type || !id) {
      throw new Error("Missing type or id");
    }

    if (provider === "provider" || provider === "local source") {
      provider = null;
    }

    let resolvedMalID = MalID ? String(MalID) : null;

    if (!resolvedMalID) {
      if (global.mappingDb && id && provider) {
        try {
          const row = global.mappingDb
            .prepare(
              `SELECT malid FROM ${provider} WHERE uuid = ? OR id = ? LIMIT 1`,
            )
            .get(id, id);
          if (row && row.malid) {
            resolvedMalID = String(row.malid);
          }
        } catch (err) {
          logger.error(
            `Error resolving MAL ID from mapping DB: ${err.message}`,
          );
        }
      }
    }

    let tagValue = "";
    if (CustomTag !== undefined) {
      if (Array.isArray(CustomTag)) {
        const cleanArr = CustomTag.map((t) => String(t).trim()).filter(Boolean);
        tagValue = cleanArr.length > 0 ? JSON.stringify(cleanArr) : "[]";
      } else if (typeof CustomTag === "string") {
        const trimmed = CustomTag.trim();
        if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
          try {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed)) {
              const cleanArr = parsed
                .map((t) => String(t).trim())
                .filter(Boolean);
              tagValue = cleanArr.length > 0 ? JSON.stringify(cleanArr) : "[]";
            } else {
              tagValue = trimmed;
            }
          } catch (_) {
            tagValue = trimmed;
          }
        } else if (trimmed.includes(",")) {
          const parsed = trimmed
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean);
          tagValue = JSON.stringify(parsed);
        } else {
          tagValue = trimmed ? JSON.stringify([trimmed]) : "[]";
        }
      } else {
        tagValue = String(CustomTag || "").trim();
      }
    }

    const existing = global.db
      .prepare(
        `SELECT * FROM ${type === "Anime" ? "Anime" : "Manga"} WHERE id = ? OR folder_name = ?`,
      )
      .get(id, id);

    if (existing) {
      const updates = [];
      const params = [];
      if (resolvedMalID) {
        updates.push("MalID = ?");
        params.push(resolvedMalID);
      } else if (existing.MalID) {
        resolvedMalID = existing.MalID;
      } else if (MalID !== undefined) {
        updates.push("MalID = ?");
        params.push(null);
      }
      if (CustomTag !== undefined) {
        updates.push("CustomTag = ?");
        params.push(tagValue);
      }
      if (updates.length > 0) {
        params.push(existing.id);
        global.db
          .prepare(
            `UPDATE ${type} SET ${updates.join(", ")}, last_updated = CURRENT_TIMESTAMP WHERE id = ?`,
          )
          .run(...params);

        const targetMalID = resolvedMalID || existing.MalID;
        if (CustomTag !== undefined && targetMalID && targetMalID !== "") {
          global.db
            .prepare(`UPDATE ${type} SET CustomTag = ? WHERE MalID = ?`)
            .run(tagValue, targetMalID);
        }
      }
    } else {
      let values = {
        id,
        provider: provider || "",
        type,
        MalID: resolvedMalID,
        CustomTag: tagValue,
      };

      try {
        const resolvedProvider = await providerFetch(type, provider);
        const config = await settingfetch();
        if (resolvedProvider && resolvedProvider.provider) {
          if (type === "Anime") {
            const lookupId = id;
            const animedata = await animeinfo(
              resolvedProvider,
              config?.CustomDownloadLocation,
              lookupId,
            );
            if (animedata) {
              if (animedata.malid && !resolvedMalID) {
                resolvedMalID = String(animedata.malid);
              }
              values = {
                ...values,
                title: animedata.title,
                provider: resolvedProvider.provider_name,
                type: animedata.type ?? null,
                description: animedata.description ?? null,
                status: animedata.status ?? null,
                genres:
                  animedata?.genres?.length > 0
                    ? animedata.genres.join(",")
                    : "",
                aired: animedata?.aired ?? null,
                ImageUrl: animedata?.image,
                EpisodesDataId: animedata?.dataId,
                MalID: resolvedMalID,
              };
            }
          } else if (type === "Manga") {
            const mangainfo = await MangaInfo(resolvedProvider, id);
            if (mangainfo) {
              if (mangainfo.malid && !resolvedMalID) {
                resolvedMalID = String(mangainfo.malid);
              }
              values = {
                ...values,
                title: mangainfo.title || "",
                provider: resolvedProvider.provider_name,
                description: mangainfo.description ?? null,
                genres:
                  mangainfo?.genres?.length > 0
                    ? mangainfo.genres.join(",")
                    : "",
                type: mangainfo.type ?? null,
                author: mangainfo?.author ?? null,
                released: mangainfo?.released ?? null,
                ImageUrl: mangainfo?.image,
                MalID: resolvedMalID,
              };
            }
          }
        }
      } catch (fetchErr) {
        logger.error(
          `Failed to fetch online metadata in /api/local/tags/add for ${id}: ${fetchErr.message}`,
        );
      }

      await MetadataAdd(type, values);
      global.db
        .prepare(`UPDATE ${type} SET MalID = ?, CustomTag = ? WHERE id = ?`)
        .run(resolvedMalID, tagValue, id);

      if (resolvedMalID && resolvedMalID !== "") {
        global.db
          .prepare(`UPDATE ${type} SET CustomTag = ? WHERE MalID = ?`)
          .run(tagValue, resolvedMalID);
      }
    }

    const targetMalID = MalID ? String(MalID) : existing?.MalID;
    if (
      CustomTag !== undefined &&
      (tagValue === "" || tagValue === "[]") &&
      targetMalID &&
      targetMalID !== ""
    ) {
      try {
        const rowsToClean = global.db
          .prepare(`SELECT id, folder_name FROM ${type} WHERE MalID = ?`)
          .all(targetMalID);

        const baseDir = await getBaseDownloadDir();

        for (const row of rowsToClean) {
          const folderName = row.folder_name || "";
          const folderPath = path.join(baseDir, type, folderName);
          const folderExists = folderName && fs.existsSync(folderPath);

          if (!folderExists) {
            global.db.prepare(`DELETE FROM ${type} WHERE id = ?`).run(row.id);
          }
        }
      } catch (err) {
        logger.error(
          `Error cleaning up duplicate MalID entries: ${err.message}`,
        );
      }
    }

    if (
      req.body.deleteFiles ||
      (CustomTag !== undefined && (tagValue === "" || tagValue === "[]"))
    ) {
      try {
        const baseDir = await getBaseDownloadDir();
        const typeDir = await resolveDownloadFolder(type, id, null, baseDir);
        if (typeDir && fs.existsSync(typeDir)) {
          await fs.promises.rm(typeDir, { recursive: true, force: true });
          logger.info(`[tags/add] Deleted download folder: ${typeDir}`);
        }
      } catch (errDir) {
        logger.warn(
          `[tags/add] Could not delete folder for ${id}: ${errDir.message}`,
        );
      }

      if (req.body.deleteFiles && global.db) {
        try {
          const malIdStr = resolvedMalID ? String(resolvedMalID) : null;
          global.db
            .prepare(
              `DELETE FROM ${type} WHERE id = ? OR folder_name = ?${malIdStr ? " OR MalID = ?" : ""}`,
            )
            .run(...(malIdStr ? [id, id, malIdStr] : [id, id]));

          global.db
            .prepare(
              `DELETE FROM unlinked_mal_ids WHERE id = ?${malIdStr ? " OR malid = ?" : ""}`,
            )
            .run(...(malIdStr ? [id, malIdStr] : [id]));
        } catch (errDb) {
          logger.warn(
            `[tags/add] Could not delete DB entry for ${id}: ${errDb.message}`,
          );
        }
      }
    }

    try {
      const resolvedProvider = await providerFetch(
        type,
        provider || existing?.provider,
      );
      const actualProviderName =
        resolvedProvider?.provider_name || provider || existing?.provider;
      invalidateCache(type, actualProviderName, id);
    } catch (e) {
      logger.error(`Error invalidating cache for ${type} ${id}: ${e.message}`);
    }

    return res.json({
      error: false,
      message: "Successfully updated library item",
    });
  } catch (err) {
    logger.error(`Error in /api/local/tags/add: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Delete Local Tag / Library Entry
router.post("/api/local/tags/remove", async (req, res) => {
  try {
    const { id, type } = req.body;
    if (!id || !type) throw new Error("ID or Type is missing");

    const baseDir = await getBaseDownloadDir();
    let typeDir = path.join(baseDir, type, id);

    let dbRecord = null;
    try {
      dbRecord = global.db
        .prepare(`SELECT * FROM ${type} WHERE id = ?`)
        .get(id);
    } catch (e) {}

    if (!fs.existsSync(typeDir) && dbRecord) {
      const folderName =
        dbRecord.folder_name ||
        (dbRecord.title ? sanitizeFolderName(dbRecord.title) : id);
      typeDir = path.join(baseDir, type, folderName);
    }

    if (fs.existsSync(typeDir)) {
      await fs.promises.rm(typeDir, { recursive: true, force: true });
    }

    if (
      !(
        dbRecord &&
        dbRecord?.CustomTag &&
        dbRecord?.CustomTag !== "" &&
        dbRecord?.CustomTag !== "[]"
      ) &&
      !(dbRecord && dbRecord?.MalID && dbRecord?.MalID !== "")
    ) {
      await MetadataRemove(type, id);
    }

    return res.json({ error: false, message: "Deleted successfully" });
  } catch (err) {
    logger.error(`Error in /api/local/tags/remove: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Switch Provider Metadata Migration
router.post("/api/metadata/switch-provider", async (req, res) => {
  try {
    const { type, oldId, newId, newProvider } = req.body;
    if (!type || !oldId || !newId || !newProvider) {
      return res.status(400).json({ error: "Missing required parameters" });
    }
    if (oldId === newId) {
      return res.json({ success: true, message: "No change needed" });
    }

    const table = type === "Anime" ? "Anime" : "Manga";
    const existing = global.db
      .prepare(`SELECT * FROM ${table} WHERE id = ?`)
      .get(oldId);

    if (existing) {
      global.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(oldId);
      existing.id = newId;
      existing.provider = newProvider;
      existing.last_updated = new Date().toISOString();
      const columns = Object.keys(existing);
      const placeholders = columns.map(() => "?").join(", ");
      const values = columns.map((col) => existing[col]);

      global.db
        .prepare(
          `
        INSERT OR REPLACE INTO ${table} (${columns.join(", ")})
        VALUES (${placeholders})
      `,
        )
        .run(...values);
      if (type === "Anime") {
        global.db
          .prepare(`UPDATE WatchHistory SET anime_id = ? WHERE anime_id = ?`)
          .run(newId, oldId);
      } else {
        global.db
          .prepare(`UPDATE ReadHistory SET manga_id = ? WHERE manga_id = ?`)
          .run(newId, oldId);
      }
      return res.json({ success: true, migrated: true });
    }

    return res.json({ success: true, migrated: false });
  } catch (err) {
    logger.error(`Error in /api/metadata/switch-provider: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// Delete Local Files
router.post("/api/local/delete", async (req, res) => {
  try {
    const { id, type = "Anime", numbers, subdub } = req.body;
    if (!id || !numbers || !Array.isArray(numbers) || numbers.length === 0) {
      throw new Error("Missing or invalid parameters");
    }

    const baseDir = await getBaseDownloadDir();
    let typeDir = await resolveDownloadFolder(type, id, subdub, baseDir);

    if (!fs.existsSync(typeDir)) {
      throw new Error(`${type} folder not found on disk`);
    }

    const files = await fs.promises.readdir(typeDir);
    let deletedCount = 0;

    for (const num of numbers) {
      const targetNum = parseFloat(num);
      if (isNaN(targetNum)) continue;

      const filesToDelete = files.filter((file) => {
        if (type === "Anime") {
          const ext = path.extname(file).toLowerCase();
          const videoExtensions = [
            ".mp4",
            ".mkv",
            ".webm",
            ".ts",
            ".avi",
            ".mov",
            ".flv",
            ".m4v",
            ".3gp",
          ];
          const subExtensions = [".srt", ".vtt", ".ass", ".ssa"];
          if (!videoExtensions.includes(ext) && !subExtensions.includes(ext)) {
            return false;
          }
          const match = file.match(/^\d+(\.\d+)?/);
          if (match) {
            return parseFloat(match[0]) === targetNum;
          }
        } else {
          if (
            file.toLowerCase().endsWith(".cbz") &&
            file.toLowerCase().includes("chapter")
          ) {
            const match = file.toLowerCase().match(/chapter\s*([\d.]+)/);
            if (match) {
              return parseFloat(match[1]) === targetNum;
            }
          }
        }
        return false;
      });

      for (const fileToDelete of filesToDelete) {
        try {
          await fs.promises.unlink(path.join(typeDir, fileToDelete));
          deletedCount++;
        } catch (e) {}
      }
    }

    await cleanupEmptyDownloadFolder(typeDir, type, id);

    const label = type === "Anime" ? "episode(s)" : "chapter(s)";
    return res.json({
      error: false,
      message: `Successfully deleted ${deletedCount} ${label}`,
    });
  } catch (err) {
    logger.error(`Error in /api/local/delete: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

async function openPathInSystem(targetPath, openFolder = false) {
  let electron;
  try {
    electron = require("electron");
  } catch (e) {}

  if (electron && electron.shell) {
    if (openFolder) {
      const isDir =
        fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory();
      if (isDir) {
        await electron.shell.openPath(targetPath);
      } else {
        electron.shell.showItemInFolder(targetPath);
      }
    } else {
      await electron.shell.openPath(targetPath);
    }
    return true;
  }

  sendToRenderer("open-file", { path: targetPath, openFolder });

  const isWindows = process.platform === "win32";
  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  if (fs.existsSync(targetPath)) {
    const isDir = fs.statSync(targetPath).isDirectory();
    if (isWindows) {
      if (openFolder && !isDir) {
        exec(`explorer.exe /select,"${targetPath}"`);
      } else {
        exec(`start "" "${targetPath}"`);
      }
    } else if (isMac) {
      if (openFolder && !isDir) {
        exec(`open -R "${targetPath}"`);
      } else {
        exec(`open "${targetPath}"`);
      }
    } else if (isLinux) {
      if (openFolder && !isDir) {
        const dir = path.dirname(targetPath);
        exec(`xdg-open "${dir}"`);
      } else {
        exec(`xdg-open "${targetPath}"`);
      }
    }
  }

  return true;
}

// Open Local File or Folder in File Explorer / OS viewer
router.post("/api/local/open", async (req, res) => {
  try {
    const {
      type = "Anime",
      id,
      number,
      subdub,
      action = "open_file",
      customPath,
    } = req.body;
    let targetPath = customPath || "";

    if (!targetPath) {
      const baseDir = await getBaseDownloadDir();
      if (!id) {
        targetPath = baseDir;
      } else {
        targetPath = await resolveDownloadFolder(type, id, subdub, baseDir);
        if (number != null && fs.existsSync(targetPath)) {
          const files = await fs.promises.readdir(targetPath);
          const targetNum = parseFloat(number);
          if (!isNaN(targetNum)) {
            const matchedFile = files.find((file) => {
              if (type === "Anime") {
                const match = file.match(/^\d+(\.\d+)?/);
                return match && parseFloat(match[0]) === targetNum;
              } else {
                const match =
                  file.toLowerCase().match(/chapter\s*([\d.]+)/) ||
                  file.match(/^\d+(\.\d+)?/);
                return match && parseFloat(match[1] || match[0]) === targetNum;
              }
            });
            if (matchedFile) {
              targetPath = path.join(targetPath, matchedFile);
            }
          }
        }
      }
    }

    if (!targetPath || !fs.existsSync(targetPath)) {
      throw new Error(
        `File or directory does not exist: ${targetPath || "Unknown path"}`,
      );
    }

    await openPathInSystem(targetPath, action === "open_folder");
    return res.json({
      error: false,
      path: targetPath,
      message: "Opened successfully",
    });
  } catch (err) {
    logger.error(`Error in /api/local/open: ${err.message}`);
    return res.json({ error: true, message: err.message });
  }
});

// Update history progress
router.post("/api/history/update", async (req, res) => {
  try {
    const { mediaId, type, number } = req.body;
    if (!mediaId || !type || !number) {
      throw new Error("Missing parameters for history update");
    }
    await updateHistory(req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Clear all history records
router.post("/api/history/clear", async (req, res) => {
  try {
    global.db.prepare(`DELETE FROM WatchHistory`).run();
    global.db.prepare(`DELETE FROM ReadHistory`).run();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Delete specific tracking history record
router.delete("/api/history/:type/:id", async (req, res) => {
  try {
    const { type, id } = req.params;
    const historyTable = type === "Anime" ? "WatchHistory" : "ReadHistory";
    global.db.prepare(`DELETE FROM ${historyTable} WHERE id = ?`).run(id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Hide tracking record from shelf
router.post("/api/history/hide", async (req, res) => {
  try {
    const { mediaId, type, malId, title } = req.body;
    if (!mediaId || !type) {
      throw new Error("Missing parameters");
    }

    const isAnime = type === "Anime";
    const historyTable = isAnime ? "WatchHistory" : "ReadHistory";
    const idField = isAnime ? "anime_id" : "manga_id";
    const titleField = isAnime ? "anime_title" : "manga_title";
    const mainTable = isAnime ? "Anime" : "Manga";

    let queryIds = [mediaId];

    if (malId) {
      const siblings = global.db
        .prepare(`SELECT id FROM ${mainTable} WHERE MalID = ?`)
        .all(String(malId));
      siblings.forEach((s) => {
        if (s.id) queryIds.push(s.id);
      });
    }

    queryIds = Array.from(new Set(queryIds));

    const placeholders = queryIds.map(() => "?").join(",");
    global.db
      .prepare(
        `UPDATE ${historyTable} SET hidden = 1 WHERE ${idField} IN (${placeholders})`,
      )
      .run(...queryIds);

    if (title) {
      global.db
        .prepare(
          `UPDATE ${historyTable} SET hidden = 1 WHERE LOWER(${titleField}) = LOWER(?)`,
        )
        .run(title);
    }

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch progress history for specific title
router.get("/api/history/progress", async (req, res) => {
  try {
    const { mediaId, type } = req.query;
    if (!mediaId || !type) throw new Error("Missing parameters");

    let suggestedNumber = null;
    let lastProgress = null;
    let hasBefore = false;
    let episodesStatus = [];
    let chaptersStatus = [];

    if (type === "Anime") {
      let queryIds = [mediaId];

      let resolvedTitle = null;
      try {
        const localRec = global.db
          .prepare(`SELECT MalID, title FROM Anime WHERE id = ?`)
          .get(mediaId);
        if (localRec) {
          if (localRec.MalID) {
            const siblings = global.db
              .prepare(`SELECT id FROM Anime WHERE MalID = ?`)
              .all(localRec.MalID);
            siblings.forEach((s) => {
              if (s.id) queryIds.push(s.id);
            });
          }
          if (localRec.title) {
            resolvedTitle = localRec.title;
          }
        }
      } catch (err) {}
      queryIds = Array.from(new Set(queryIds));

      const placeholders = queryIds.map(() => "?").join(",");
      let sql = `SELECT * FROM WatchHistory WHERE anime_id IN (${placeholders})`;
      let params = [...queryIds];
      if (resolvedTitle && resolvedTitle !== "Anime") {
        sql += ` OR LOWER(anime_title) = LOWER(?)`;
        params.push(resolvedTitle);
      }

      const history = global.db.prepare(sql).all(...params);

      history.sort(
        (a, b) =>
          new Date(b.last_watched).getTime() -
          new Date(a.last_watched).getTime(),
      );

      if (history.length > 0) {
        hasBefore = true;
        const latest = history[0];
        lastProgress = {
          number: latest.episode_number,
          currentTime: latest.current_time,
          duration: latest.duration,
          isCompleted: latest.is_completed === 1,
        };

        if (latest.is_completed === 1) {
          suggestedNumber = latest.episode_number + 1;
        } else {
          suggestedNumber = latest.episode_number;
        }
      }

      episodesStatus = history.map((h) => ({
        number: h.episode_number,
        isCompleted: h.is_completed === 1,
        currentTime: h.current_time,
        duration: h.duration,
      }));
    } else {
      let queryIds = [mediaId];
      let resolvedTitle = null;
      try {
        const localRec = global.db
          .prepare(`SELECT MalID, title FROM Manga WHERE id = ?`)
          .get(mediaId);
        if (localRec) {
          if (localRec.MalID) {
            const siblings = global.db
              .prepare(`SELECT id FROM Manga WHERE MalID = ?`)
              .all(localRec.MalID);
            siblings.forEach((s) => {
              if (s.id) queryIds.push(s.id);
            });
          }
          if (localRec.title) {
            resolvedTitle = localRec.title;
          }
        }
      } catch (err) {}
      queryIds = Array.from(new Set(queryIds));

      const placeholders = queryIds.map(() => "?").join(",");
      let sql = `SELECT * FROM ReadHistory WHERE manga_id IN (${placeholders})`;
      let params = [...queryIds];
      if (resolvedTitle && resolvedTitle !== "Manga") {
        sql += ` OR LOWER(manga_title) = LOWER(?)`;
        params.push(resolvedTitle);
      }

      const history = global.db.prepare(sql).all(...params);
      history.sort(
        (a, b) =>
          new Date(b.last_read).getTime() - new Date(a.last_read).getTime(),
      );

      if (history.length > 0) {
        hasBefore = true;
        const latest = history[0];
        lastProgress = {
          number: latest.chapter_number,
          currentPage: latest.current_page,
          totalPages: latest.total_pages,
          isCompleted: latest.is_completed === 1,
        };

        if (latest.is_completed === 1) {
          suggestedNumber = latest.chapter_number + 1;
        } else {
          suggestedNumber = latest.chapter_number;
        }
      }

      chaptersStatus = history.map((h) => ({
        number: h.chapter_number,
        isCompleted: h.is_completed === 1,
        currentPage: h.current_page,
        totalPages: h.total_pages,
      }));
    }

    res.json({
      hasProgress: hasBefore,
      lastProgress,
      suggestedNumber,
      episodesStatus,
      chaptersStatus,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Fetch history statistics
router.get("/api/history/stats", async (req, res) => {
  try {
    const watchStats = global.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(time_spent), 0) AS total_seconds,
        COUNT(DISTINCT anime_id) AS distinct_anime,
        COUNT(CASE WHEN is_completed = 1 THEN 1 END) AS completed_episodes
      FROM WatchHistory
    `,
      )
      .get();

    const readStats = global.db
      .prepare(
        `
      SELECT 
        COALESCE(SUM(time_spent), 0) AS total_seconds,
        COUNT(DISTINCT manga_id) AS distinct_manga,
        COUNT(CASE WHEN is_completed = 1 THEN 1 END) AS completed_chapters
      FROM ReadHistory
    `,
      )
      .get();

    res.json({
      watchHours: parseFloat((watchStats.total_seconds / 3600).toFixed(2)),
      readHours: parseFloat((readStats.total_seconds / 3600).toFixed(2)),
      completedEpisodes: watchStats.completed_episodes,
      completedChapters: readStats.completed_chapters,
      distinctAnime: watchStats.distinct_anime,
      distinctManga: readStats.distinct_manga,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function resolveHistoryCoverImage(
  mediaId,
  title,
  type = "Anime",
  malId = null,
  rawScraperImg = null,
  rawMalImg = null,
) {
  let localSrc = null;

  const urlsToCheck = [rawMalImg, rawScraperImg].filter(Boolean);
  for (const url of urlsToCheck) {
    try {
      const cached = queryOne("SELECT filename FROM ImageCache WHERE url = ?", [
        url,
      ]);
      if (cached) {
        const cacheDir = ImageCacheManager.getImageCacheDir();
        if (fs.existsSync(path.join(cacheDir, cached.filename))) {
          localSrc = `/api/image?url=${encodeURIComponent(url)}`;
          break;
        }
      }
    } catch (_) {}
  }

  if (!localSrc && title) {
    try {
      const dirPath = await GetDir(title, null, type, mediaId);
      if (fs.existsSync(dirPath)) {
        const files = fs.readdirSync(dirPath);
        const coverFile = files.find((f) =>
          /^(cover|poster|folder)\.(jpg|jpeg|png|webp)$/i.test(f),
        );
        if (coverFile) {
          const p = path.join(dirPath, coverFile);
          localSrc = `/api/image?url=${encodeURIComponent("file://" + p)}`;
        }
      }
    } catch (_) {}
  }

  const malSrc = rawMalImg
    ? `/api/image?url=${encodeURIComponent(rawMalImg)}`
    : null;

  const scraperSrc = rawScraperImg
    ? `/api/image?url=${encodeURIComponent(rawScraperImg)}`
    : null;

  return {
    image: localSrc || malSrc || scraperSrc || "/images/image-404.png",
    local_image: localSrc,
    mal_image: malSrc,
    scraper_image: scraperSrc,
    fallback_image: "/images/image-404.png",
  };
}

// Fetch history list
router.get("/api/history/list", async (req, res) => {
  try {
    try {
      global.db
        .prepare(
          "DELETE FROM WatchHistory WHERE anime_id NOT IN (SELECT id FROM Anime)",
        )
        .run();
      global.db
        .prepare(
          "DELETE FROM ReadHistory WHERE manga_id NOT IN (SELECT id FROM Manga)",
        )
        .run();
    } catch (e) {}

    const limit = parseInt(req.query.limit || 50);
    const includeHidden = req.query.include_hidden === "true";
    const watchWhereClause = includeHidden
      ? ""
      : "WHERE (w.hidden IS NULL OR w.hidden = 0)";
    const readWhereClause = includeHidden
      ? ""
      : "WHERE (r.hidden IS NULL OR r.hidden = 0)";

    const watchLogs =
      global.db
        .prepare(
          `
      SELECT 
        w.id,
        'Anime' AS type,
        w.anime_id AS media_id,
        w.anime_title AS title,
        w.episode_number AS number,
        w.current_time,
        w.duration,
        w.time_spent,
        w.is_completed,
        w.last_watched AS date,
        a.image_url,
        a.provider,
        a.MalID AS mal_id,
        CASE WHEN a.id IS NOT NULL THEN 1 ELSE 0 END AS exists_in_catalog,
        mal.totalEpisodes AS total_count,
        mal.image AS mal_image
      FROM WatchHistory w
      LEFT JOIN Anime a ON a.id = w.anime_id
      LEFT JOIN MyAnimeList mal ON mal.id = a.MalID
      ${watchWhereClause}
      ORDER BY w.last_watched DESC
      LIMIT ?
    `,
        )
        .all(limit) || [];

    for (const log of watchLogs) {
      const coverRes = await resolveHistoryCoverImage(
        log.media_id,
        log.title,
        "Anime",
        log.mal_id,
        log.image_url,
        log.mal_image,
      );
      delete log.image_url;
      Object.assign(log, coverRes);
    }

    const readLogs =
      global.db
        .prepare(
          `
      SELECT 
        r.id,
        'Manga' AS type,
        r.manga_id AS media_id,
        r.manga_title AS title,
        r.chapter_number AS number,
        r.current_page AS current_time,
        r.total_pages AS duration,
        r.time_spent,
        r.is_completed,
        r.last_read AS date,
        m.image_url,
        m.provider,
        m.MalID AS mal_id,
        CASE WHEN m.id IS NOT NULL THEN 1 ELSE 0 END AS exists_in_catalog,
        mml.totalChapters AS total_count,
        mml.image AS mal_image
      FROM ReadHistory r
      LEFT JOIN Manga m ON m.id = r.manga_id
      LEFT JOIN MyMangaList mml ON mml.id = m.MalID
      ${readWhereClause}
      ORDER BY r.last_read DESC
      LIMIT ?
    `,
        )
        .all(limit) || [];

    for (const log of readLogs) {
      const coverRes = await resolveHistoryCoverImage(
        log.media_id,
        log.title,
        "Manga",
        log.mal_id,
        log.image_url,
        log.mal_image,
      );
      delete log.image_url;
      Object.assign(log, coverRes);
    }

    const combined = [...watchLogs, ...readLogs]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, limit);

    res.json(combined);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
