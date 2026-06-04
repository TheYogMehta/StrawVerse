const fs = require("fs");
const os = require("os");
const path = require("path");
const RPC = require("discord-rpc");
const settingsDb = require("./db");
const pkg = require("../../package.json");

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
    const { settings: settingsDb } = require("./db");
    const config = settingsDb.get("config");
    return config?.enableDiscordRPC === "on";
  } catch (err) {
    return false;
  }
}

async function StartDiscordRPC() {
  if (!isDiscordRunning()) {
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
  if (os.platform() === "win32") {
    return fs.existsSync("\\\\?\\pipe\\discord-ipc-0");
  } else {
    return fs.existsSync(
      path.join(
        process.env.XDG_RUNTIME_DIR || process.env.TMPDIR || "/tmp",
        "discord-ipc-0",
      ),
    );
  }
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

async function UpdateDiscordRPC(Title = null, Number = null) {
  if (!isDiscordRPCEnabled()) {
    if (rpcConnected) {
      await StopDiscordRPC();
    }
    return;
  }

  if (!rpcConnected) {
    if (isDiscordRunning()) {
      try {
        await StartDiscordRPC();
      } catch (err) {
        return;
      }
    } else {
      return;
    }
  } else {
    if (!isDiscordRunning()) {
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

  let Activity = {
    details: `idle`,
    state: `${
      idle_messages[Math.floor(Math.random() * idle_messages.length)]
    } ${
      InDownloads > 0 ? `| downloading ${InDownloads} Anime / Chapters` : ""
    }`,
    type: 3,
    instance: false,
    buttons: [
      {
        label: "Download StrawVerse App",
        url: releaseUrl,
      },
    ],
  };

  if (Title) {
    Activity.details =
      Title.length > 125 ? `${Title.slice(0, 125)}...` : `${Title}`;
  }

  if (Number) {
    Activity.state = `${Number} ${
      InDownloads > 0 ? `| downloading ${InDownloads} Anime / Chapters` : ""
    }`;
  }

  try {
    rpcClient.setActivity(Activity);
  } catch (err) {
    rpcConnected = false;
    rpcClient = null;
  }
}

module.exports = {
  StartDiscordRPC,
  StopDiscordRPC,
  UpdateDiscordRPC,
};
