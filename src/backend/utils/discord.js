const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const RPC = require("discord-rpc");
const settingsDb = require("./db");
const pkg = require("../../package.json");
const { getKeyValue } = require("./db");
const { logger } = require("./AppLogger");

const clientId = "1372260492982358016";
let idle_messages = [
  "Taking a quick snack break 🍕",
  "Browsing the anime shelves...",
  "Just chilling with some tea ☕",
  "Plotting the next binge watch...",
  "Waiting for the next episode drop 📺",
  "In a deep anime rabbit hole 🌀",
  "Dreaming of anime worlds ✨",
  "Catching up on all the latest manga 📚",
  "In anime zen mode 🧘",
  "Lost in thought (and anime) 🤔",
  "Currently AFK — send snacks! 🍩",
  "Daydreaming about the next arc...",
];

let rpcClient = null;
let rpcConnected = false;

function isDiscordRPCEnabled() {
  try {
    const config = getKeyValue("Settings", "config");
    return config?.enableDiscordRPC === "on";
  } catch (err) {
    return false;
  }
}

async function StartDiscordRPC() {
  const running = await isDiscordRunning();
  if (!running) {
    throw new Error("Discord is not open in the background!");
  }

  if (rpcConnected) return true;

  rpcClient = new RPC.Client({ transport: "ipc" });
  RPC.register(clientId);

  return new Promise(async (resolve, reject) => {
    rpcClient.once("ready", () => {
      rpcConnected = true;
      UpdateDiscordRPC();
      resolve(true);
    });

    try {
      await rpcClient.login({ clientId });
    } catch (err) {
      rpcConnected = false;
      reject(
        new Error("Failed to login to Discord Rich Presence: " + err.message),
      );
    }
  });
}

function isDiscordRunning() {
  return new Promise((resolve) => {
    let socketPath;
    if (os.platform() === "win32") {
      socketPath = "\\\\?\\pipe\\discord-ipc-0";
    } else {
      socketPath = path.join(
        process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp",
        "discord-ipc-0",
      );
    }

    if (!fs.existsSync(socketPath)) {
      return resolve(false);
    }

    const socket = net.connect(socketPath, () => {
      socket.destroy();
      resolve(true);
    });

    socket.setTimeout(1000);

    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });

    socket.on("error", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

async function StopDiscordRPC() {
  if (rpcClient) {
    try {
      await rpcClient.destroy();
    } catch (err) {
    } finally {
      rpcClient = null;
      rpcConnected = false;
      return true;
    }
  }
  return false;
}

async function UpdateDiscordRPC(
  Title = null,
  Number = null,
  Type = null,
  Image = null,
  MediaId = null,
  CurrentTime = null,
  Duration = null,
) {
  if (!isDiscordRPCEnabled()) {
    if (rpcConnected) {
      await StopDiscordRPC();
    }
    return;
  }

  if (!rpcConnected) {
    const running = await isDiscordRunning();
    if (running) {
      try {
        await StartDiscordRPC();
      } catch (err) {
        return;
      }
    } else {
      return;
    }
  } else {
    const running = await isDiscordRunning();
    if (!running) {
      rpcConnected = false;
      rpcClient = null;
      return;
    }
  }

  if (!rpcConnected || !rpcClient) return;

  let InDownloads = global.getQueueNumber();

  let rawUrl = "";
  if (typeof pkg.repository === "string") {
    rawUrl = pkg.repository;
  } else if (pkg.repository && typeof pkg.repository.url === "string") {
    rawUrl = pkg.repository.url;
  }

  let repoUrl = rawUrl.replace(/^git\+/, "");
  if (repoUrl.endsWith(".git")) {
    repoUrl = repoUrl.slice(0, -4);
  }
  if (!repoUrl) {
    repoUrl = "https://github.com/TheYogMehta/StrawVerse";
  }
  const releaseUrl = `${repoUrl}/releases/latest`;

  let downloadSuffix =
    InDownloads > 0 ? ` | downloading ${InDownloads} items` : "";

  let resolvedImage = "luffy";
  let imageToResolve = null;

  if (Image && typeof Image === "string" && Image.length > 0) {
    imageToResolve = Image;
  } else if (MediaId) {
    const dbImage = await getMediaImage(MediaId, Type);
    if (dbImage && dbImage.length > 0) {
      imageToResolve = dbImage;
    }
  }

  if (imageToResolve) {
    if (
      imageToResolve.startsWith("http") ||
      imageToResolve.startsWith("data:image/")
    ) {
      const uploadedUrl = await resolveAndUploadToCatbox(
        imageToResolve,
        MediaId,
        Type,
      );
      if (uploadedUrl && uploadedUrl.startsWith("http")) {
        resolvedImage = uploadedUrl;
      } else {
        resolvedImage = imageToResolve;
      }
    }
  }

  if (
    resolvedImage &&
    resolvedImage.startsWith("http") &&
    !resolvedImage.includes("catbox.moe")
  ) {
    resolvedImage = `https://images.weserv.nl/?url=${encodeURIComponent(resolvedImage)}`;
  }

  let Activity = {
    details: `Idle`,
    state: `${
      idle_messages[Math.floor(Math.random() * idle_messages.length)]
    }${downloadSuffix}`,
    largeImageKey: "luffy",
    largeImageText: "StrawVerse",
    instance: false,
    buttons: [
      {
        label: "Download StrawVerse App",
        url: releaseUrl,
      },
    ],
  };

  const cfg = getKeyValue("Settings", "config") || {};
  const malProfileEnabled = cfg.malDiscordProfile === "on";
  const malUsername = cfg.malUsername || global.malUsername || null;
  const malProfileButton =
    malProfileEnabled && malUsername
      ? {
          label: "My MAL Profile",
          url: `https://myanimelist.net/profile/${encodeURIComponent(malUsername)}`,
        }
      : null;

  if (Title) {
    if (Type === "Anime") {
      Activity.details = "Watching Anime";
      const stateStr = `${Title} - Ep ${Number}${downloadSuffix}`;
      Activity.state =
        stateStr.length > 125
          ? `${stateStr.slice(0, 125 - downloadSuffix.length - 3)}...${downloadSuffix}`
          : stateStr;

      const curTime = parseFloat(CurrentTime || 0);
      const dur = parseFloat(Duration || 0);
      if (dur > 0) {
        Activity.startTimestamp = Math.round(Date.now() - curTime * 1000);
        Activity.endTimestamp = Math.round(Date.now() + (dur - curTime) * 1000);
      }

      Activity.largeImageKey =
        resolvedImage !== "luffy" ? resolvedImage : "luffy";
      Activity.largeImageText = Title;
      if (resolvedImage !== "luffy") {
        Activity.smallImageKey = "luffy";
        Activity.smallImageText = "StrawVerse";
      }
    } else if (Type === "Manga") {
      Activity.details = "Reading Manga";
      const curPage = parseInt(CurrentTime || 1);
      const totPages = parseInt(Duration || 1);
      const pageInfo = totPages > 0 ? ` (Page ${curPage}/${totPages})` : "";
      const stateStr = `${Title} - Ch ${Number}${pageInfo}${downloadSuffix}`;
      Activity.state =
        stateStr.length > 125
          ? `${stateStr.slice(0, 125 - downloadSuffix.length - 3)}...${downloadSuffix}`
          : stateStr;

      Activity.largeImageKey =
        resolvedImage !== "luffy" ? resolvedImage : "luffy";
      Activity.largeImageText = Title;
      if (resolvedImage !== "luffy") {
        Activity.smallImageKey = "luffy";
        Activity.smallImageText = "StrawVerse";
      }
    } else {
      Activity.details =
        Title.length > 125 ? `${Title.slice(0, 125)}...` : Title;
      if (Number) {
        const stateStr = `${Number}${downloadSuffix}`;
        Activity.state =
          stateStr.length > 125
            ? `${stateStr.slice(0, 125 - downloadSuffix.length - 3)}...${downloadSuffix}`
            : stateStr;
      }
    }
  }

  const buttons = [{ label: "Download StrawVerse App", url: releaseUrl }];
  if (malProfileButton) buttons.push(malProfileButton);
  Activity.buttons = buttons;

  try {
    rpcClient.setActivity(Activity);
  } catch (err) {
    rpcConnected = false;
    rpcClient = null;
  }
}

async function getMediaImage(mediaId, type) {
  try {
    let localRec = null;
    if (type === "Anime") {
      const strippedId = mediaId.replace(/-(dub|sub|hsub|both)$/, "");
      localRec = db
        .prepare(
          `
        SELECT MalID, image_url FROM Anime 
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
      if (localRec) {
        if (localRec.image_url && localRec.image_url.startsWith("http")) {
          return localRec.image_url;
        }
        if (localRec.MalID) {
          const malInfo = db
            .prepare(`SELECT image FROM MyAnimeList WHERE id = ?`)
            .get(String(localRec.MalID));
          return malInfo?.image || null;
        }
      }
    } else if (type === "Manga") {
      localRec = db
        .prepare(
          `SELECT MalID, image_url FROM Manga WHERE id = ? OR folder_name = ?`,
        )
        .get(mediaId, mediaId);
      if (localRec) {
        if (localRec.image_url && localRec.image_url.startsWith("http")) {
          return localRec.image_url;
        }
        if (localRec.MalID) {
          const malInfo = db
            .prepare(`SELECT image FROM MyMangaList WHERE id = ?`)
            .get(String(localRec.MalID));
          return malInfo?.image || null;
        }
      }
    }
  } catch (err) {}
  return null;
}

async function resolveAndUploadToCatbox(imageUrl, mediaId, type) {
  if (!imageUrl || typeof imageUrl !== "string") return null;

  const cachedUrl = getCachedCatboxUrl(imageUrl);
  if (cachedUrl) {
    return cachedUrl;
  }

  if (imageUrl.includes("catbox.moe")) {
    setCachedCatboxUrl(imageUrl, imageUrl);
    return imageUrl;
  }

  if (imageUrl.startsWith("data:image/")) {
    try {
      const base64Data = imageUrl.split(";base64,").pop();
      const buffer = Buffer.from(base64Data, "base64");
      const catboxUrl = await uploadToCatbox(buffer);
      if (catboxUrl) {
        setCachedCatboxUrl(imageUrl, catboxUrl);
        return catboxUrl;
      }
    } catch (e) {
      // ignore
    }
    return imageUrl;
  }

  if (mediaId && type) {
    const dbImage = await getMediaImage(mediaId, type);
    if (dbImage && dbImage.includes("catbox.moe")) {
      setCachedCatboxUrl(imageUrl, dbImage);
      return dbImage;
    }
  }

  try {
    let fetchUrl = imageUrl.trim();
    if (fetchUrl.includes("/api/image?url=")) {
      fetchUrl = fetchUrl.split("/api/image?url=")[1];
    }

    const response = await global.axios.get(fetchUrl, {
      responseType: "arraybuffer",
    });

    const buffer = Buffer.from(response.data);
    const catboxUrl = await uploadToCatbox(buffer);
    if (catboxUrl) {
      setCachedCatboxUrl(imageUrl, catboxUrl);

      if (mediaId && type) {
        try {
          const table = type === "Anime" ? "Anime" : "Manga";
          let localRec = null;
          if (type === "Anime") {
            const strippedId = mediaId.replace(/-(dub|sub|hsub|both)$/, "");
            localRec = db
              .prepare(
                `SELECT id, image, image_url FROM Anime WHERE id = ? OR id = ? OR id = ? OR id = ? OR id = ?`,
              )
              .get(
                mediaId,
                `${strippedId}-sub`,
                `${strippedId}-hsub`,
                `${strippedId}-dub`,
                `${strippedId}-both`,
              );
          } else {
            localRec = db
              .prepare(`SELECT id, image, image_url FROM Manga WHERE id = ?`)
              .get(mediaId);
          }

          if (localRec) {
            const updates = [
              "image_url = ?",
              "last_updated = CURRENT_TIMESTAMP",
            ];
            const params = [catboxUrl];
            if (!localRec.image || localRec.image === "") {
              const base64Image = `data:image/png;base64,${buffer.toString("base64")}`;
              updates.push("image = ?");
              params.push(base64Image);
            }
            params.push(localRec.id);
            global.db
              .prepare(`UPDATE ${table} SET ${updates.join(", ")} WHERE id = ?`)
              .run(...params);
          }
        } catch (dbErr) {
          // ignore
        }
      }

      return catboxUrl;
    }
  } catch (err) {
    // ignore
  }

  return imageUrl;
}

async function uploadToCatbox(imageBuffer) {
  try {
    const boundary =
      "----WebKitFormBoundary" + Math.random().toString(36).substring(2);

    const response = await global.axios.post(
      "https://litterbox.catbox.moe/resources/internals/api.php",
      Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="reqtype"\r\n\r\nfileupload\r\n`,
          "utf-8",
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="time"\r\n\r\n1h\r\n`,
          "utf-8",
        ),
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="fileToUpload"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`,
          "utf-8",
        ),
        imageBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8"),
      ]),
      {
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
      },
    );

    if (
      response.data &&
      typeof response.data === "string" &&
      response.data.startsWith("http")
    ) {
      return response.data.trim();
    }
  } catch (err) {
    logger.error("Failed to upload image to Catbox: " + (err.message || err));
  }
  return null;
}

function getCachedCatboxUrl(originalUrl) {
  if (!originalUrl || typeof originalUrl !== "string") return null;
  try {
    const row = global.db
      .prepare(
        "SELECT catbox_url, created_at FROM CatboxCache WHERE original_url = ?",
      )
      .get(originalUrl);
    if (!row) return null;

    const oneHourMs = 3600000;
    if (!row.created_at || Date.now() - row.created_at > oneHourMs) {
      try {
        global.db
          .prepare("DELETE FROM CatboxCache WHERE original_url = ?")
          .run(originalUrl);
      } catch (err) {
        // ignore
      }
      return null;
    }
    return row.catbox_url;
  } catch (err) {
    return null;
  }
}

function setCachedCatboxUrl(originalUrl, catboxUrl) {
  if (!originalUrl || !catboxUrl) return;
  try {
    global.db
      .prepare(
        "INSERT INTO CatboxCache (original_url, catbox_url, created_at) VALUES (?, ?, ?) ON CONFLICT(original_url) DO UPDATE SET catbox_url = excluded.catbox_url, created_at = excluded.created_at",
      )
      .run(originalUrl, catboxUrl, Date.now());
  } catch (err) {
    // ignore
  }
}

module.exports = {
  StartDiscordRPC,
  StopDiscordRPC,
  UpdateDiscordRPC,
};
