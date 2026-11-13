function makeStreamSafe(stream) {
  if (!stream) return;
  if (typeof stream.on === "function") {
    stream.on("error", (err) => {
      if (err && (err.code === "EIO" || err.code === "EPIPE")) return;
    });
  }
  if (typeof stream.write === "function") {
    const originalWrite = stream.write.bind(stream);
    stream.write = function (chunk, encoding, callback) {
      try {
        return originalWrite(chunk, encoding, (err) => {
          if (err && (err.code === "EIO" || err.code === "EPIPE")) {
            if (typeof callback === "function") callback();
            return;
          }
          if (typeof callback === "function") callback(err);
        });
      } catch (err) {
        if (err && (err.code === "EIO" || err.code === "EPIPE")) {
          if (typeof callback === "function") callback();
          return false;
        }
        throw err;
      }
    };
  }
}

makeStreamSafe(process.stdout);
makeStreamSafe(process.stderr);
if (console && console._stdout) makeStreamSafe(console._stdout);
if (console && console._stderr) makeStreamSafe(console._stderr);

if (typeof global.sendToRenderer !== "function") {
  global.sendToRenderer = () => {};
}

const winston = require("winston");
const path = require("path");
const fs = require("fs");
const os = require("os");
const { getUserDataPath } = require("./constants");

const logDir = getUserDataPath();

const LogFilePath = path.join(logDir, "app.log");

try {
  if (fs.existsSync(LogFilePath)) {
    fs.unlinkSync(LogFilePath);
  }
} catch (_) {}

function formatLogMessage(info) {
  if (info.message instanceof Error) {
    return info.message.message;
  }
  if (info.message !== undefined && info.message !== null) {
    return info.message;
  }
  if (info.stack) {
    return info.stack;
  }
  return "";
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf((info) => {
      return `${info.timestamp} [${info.level}]: ${formatLogMessage(info)}`;
    }),
  ),
  transports: [
    new winston.transports.File({
      filename: LogFilePath,
    }),
    new winston.transports.Console({
      format: winston.format.printf((info) => {
        return `[${info.level}]: ${formatLogMessage(info)}`;
      }),
    }),
  ],
});

// Extension + backend code logs via console.* everywhere; mirror it
// into app.log so the Logs screen shows scraper diagnostics too.
// (winston's Console transport writes to process streams directly,
// so this cannot recurse. The AppLogger-error marker is skipped to
// avoid any feedback through the logger error handler.)
let mirroringConsole = false;
try {
  const util = require("util");
  const mirror = (level, fnName) => {
    const orig = console[fnName].bind(console);
    console[fnName] = (...args) => {
      try {
        if (!mirroringConsole) {
          const text = util.format(...args);
          if (!text.includes("[AppLogger Error]")) {
            mirroringConsole = true;
            logger.log({ level, message: text });
            mirroringConsole = false;
          }
        }
      } catch (_) {
        mirroringConsole = false;
      }
      return orig(...args);
    };
  };
  mirror("info", "log");
  mirror("info", "info");
  mirror("warn", "warn");
  mirror("debug", "debug");
  mirror("error", "error");
} catch (_) {}

logger.on("error", (err) => {
  console.error("[AppLogger Error]:", err?.message || err);
});

function getLogs() {
  return new Promise((resolve, reject) => {
    const activePath = getCurrentLogPath();
    if (fs.existsSync(activePath)) {
      fs.readFile(activePath, "utf8", (err, data) => {
        if (err) {
          reject("Error reading log file");
        } else {
          resolve(data);
        }
      });
    } else {
      resolve("No logs found.");
    }
  });
}

function clearLogs() {
  return new Promise((resolve, reject) => {
    fs.writeFile(getCurrentLogPath(), "", "utf8", (err) => {
      if (err) {
        reject("Error clearing log file");
      } else {
        resolve();
      }
    });
  });
}

// ---- External (rotated) log files ----
// Kept outside the app data dir so users can find and share them.
const MAX_LOG_FILES_HARD_LIMIT = 10;
const MAX_LOG_TOTAL_BYTES = 500 * 1024 * 1024;

function getExternalLogDir() {
  const dir = path.join(os.homedir(), "StrawVerse", "logs");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {}
  return dir;
}

function listExternalLogFiles(dir) {
  let files = [];
  try {
    files = fs
      .readdirSync(dir)
      .filter((n) => /^strawverse-.*\.log$/i.test(n))
      .map((n) => {
        const p = path.join(dir, n);
        const st = fs.statSync(p);
        return { path: p, name: n, mtimeMs: st.mtimeMs, size: st.size };
      })
      .sort((a, b) => a.mtimeMs - b.mtimeMs);
  } catch (_) {}
  return files;
}

function clampLogFileCount(n) {
  const v = parseInt(n, 10);
  if (isNaN(v)) return 3;
  return Math.min(Math.max(v, 1), MAX_LOG_FILES_HARD_LIMIT);
}

function pruneExternalLogs(dir, maxFiles) {
  const removed = [];
  try {
    const max = clampLogFileCount(maxFiles);
    const files = listExternalLogFiles(dir);
    while (files.length > max) {
      const oldest = files.shift();
      try {
        fs.unlinkSync(oldest.path);
        removed.push(oldest.name);
      } catch (_) {}
    }
    let total = files.reduce((sum, fl) => sum + fl.size, 0);
    while (total > MAX_LOG_TOTAL_BYTES && files.length > 0) {
      const oldest = files.shift();
      try {
        fs.unlinkSync(oldest.path);
        removed.push(oldest.name);
        total -= oldest.size;
      } catch (_) {
        break;
      }
    }
  } catch (_) {}
  return removed;
}

function buildSessionLogPath(dir) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  // Human-readable stamp: YYYY-MM-DD-HH-MMAM/PM. Slashes and colons are
  // illegal in Windows filenames, so dashes stand in for both.
  const hour24 = d.getHours();
  const ampm = hour24 >= 12 ? "PM" : "AM";
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(hour12)}-${pad(d.getMinutes())}${ampm}`;
  let p = path.join(dir, `strawverse-${stamp}.log`);
  let i = 1;
  while (fs.existsSync(p)) {
    p = path.join(dir, `strawverse-${stamp}-${i}.log`);
    i++;
  }
  return p;
}

let externalFileTransport = null;
let currentExternalLogPath = null;
let externalLogActive = false;

function getCurrentLogPath() {
  return externalLogActive && currentExternalLogPath
    ? currentExternalLogPath
    : LogFilePath;
}

function configureExternalLogs(opts = {}) {
  const dirOverride =
    opts && typeof opts.dir === "string" && opts.dir.trim()
      ? opts.dir
      : null;
  const max = clampLogFileCount(opts.maxFiles);
  if (!opts.enabled) {
    if (externalFileTransport) {
      try {
        logger.remove(externalFileTransport);
      } catch (_) {}
      try {
        if (typeof externalFileTransport.close === "function") {
          externalFileTransport.close();
        }
      } catch (_) {}
      externalFileTransport = null;
    }
    externalLogActive = false;
    currentExternalLogPath = null;
    return { active: false };
  }
  try {
    const dir = dirOverride || getExternalLogDir();
    if (!externalLogActive || !currentExternalLogPath) {
      currentExternalLogPath = buildSessionLogPath(dir);
    }
    // Create this session's file before pruning so it counts toward the
    // cap; pruning first keeps `max` old files and the new session then
    // leaves the folder at max + 1 forever.
    try {
      fs.closeSync(fs.openSync(currentExternalLogPath, "a"));
    } catch (_) {}
    if (!externalFileTransport) {
      externalFileTransport = new winston.transports.File({
        filename: currentExternalLogPath,
      });
      logger.add(externalFileTransport);
    }
    const removed = pruneExternalLogs(dir, max);
    externalLogActive = true;
    return { active: true, path: currentExternalLogPath, removed };
  } catch (err) {
    externalLogActive = false;
    return { active: false, error: err?.message };
  }
}

module.exports = {
  logger,
  getLogs,
  clearLogs,
  getExternalLogDir,
  configureExternalLogs,
  pruneExternalLogs,
  getCurrentLogPath,
  MAX_LOG_FILES_HARD_LIMIT,
  MAX_LOG_TOTAL_BYTES,
};
