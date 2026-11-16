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
const PrevLogFilePath = path.join(logDir, "app-previous.log");
const CrashLogFilePath = path.join(logDir, "crash.log");

try {
  if (fs.existsSync(LogFilePath)) {
    try {
      fs.copyFileSync(LogFilePath, PrevLogFilePath);
    } catch (_) {}
    fs.unlinkSync(LogFilePath);
  }
} catch (_) {}

process.on("uncaughtException", (err) => {
  if (err && (err.code === "EIO" || err.code === "EPIPE")) return;
  const msg = `[FATAL UNCAUGHT EXCEPTION] ${err?.stack || err?.message || err}`;
  try {
    if (logger && typeof logger.error === "function") {
      logger.error(msg);
    }
  } catch (_) {}
  try {
    fs.appendFileSync(LogFilePath, `\n${new Date().toISOString()} [fatal]: ${msg}\n`);
    fs.appendFileSync(CrashLogFilePath, `\n${new Date().toISOString()} [fatal]: ${msg}\n`);
  } catch (_) {}
});

process.on("unhandledRejection", (reason) => {
  const msg = `[FATAL UNHANDLED REJECTION] ${reason?.stack || reason?.message || reason}`;
  try {
    if (logger && typeof logger.error === "function") {
      logger.error(msg);
    }
  } catch (_) {}
  try {
    fs.appendFileSync(LogFilePath, `\n${new Date().toISOString()} [fatal]: ${msg}\n`);
    fs.appendFileSync(CrashLogFilePath, `\n${new Date().toISOString()} [fatal]: ${msg}\n`);
  } catch (_) {}
});

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
  return new Promise((resolve) => {
    try {
      const activePath = getCurrentLogPath();
      let currentLogs = "";
      if (fs.existsSync(activePath)) {
        try {
          currentLogs = fs.readFileSync(activePath, "utf8");
        } catch (_) {}
      }

      let crashLogs = "";
      const crashCandidates = [
        CrashLogFilePath,
        path.join(os.homedir(), "Strawverse", "data", "crash.log"),
        "/sdcard/Strawverse/data/crash.log",
      ];
      for (const cp of crashCandidates) {
        if (fs.existsSync(cp)) {
          try {
            const content = fs.readFileSync(cp, "utf8");
            if (content && content.trim()) {
              crashLogs += `\n[CRASH REPORT: ${cp}]\n${content.trim()}\n`;
            }
          } catch (_) {}
        }
      }

      let prevLogs = "";
      if (fs.existsSync(PrevLogFilePath)) {
        try {
          const content = fs.readFileSync(PrevLogFilePath, "utf8");
          if (content && content.trim()) {
            prevLogs = content.trim();
          }
        } catch (_) {}
      }

      let combined = "";
      if (crashLogs.trim()) {
        combined += `=======================================================\n${crashLogs.trim()}\n=======================================================\n\n`;
      }
      if (prevLogs) {
        combined += `=== PREVIOUS SESSION (BEFORE LAST RESTART / CRASH) ===\n${prevLogs}\n\n=== CURRENT SESSION ===\n`;
      }
      combined += currentLogs || "No current session log messages available.";
      resolve(combined);
    } catch (err) {
      resolve("Error reading log file: " + err.message);
    }
  });
}

function clearLogs() {
  return new Promise((resolve, reject) => {
    try {
      fs.writeFileSync(getCurrentLogPath(), "", "utf8");
      if (fs.existsSync(PrevLogFilePath)) {
        try {
          fs.unlinkSync(PrevLogFilePath);
        } catch (_) {}
      }
      if (fs.existsSync(CrashLogFilePath)) {
        try {
          fs.unlinkSync(CrashLogFilePath);
        } catch (_) {}
      }
      const publicCrash = path.join(
        os.homedir(),
        "Strawverse",
        "data",
        "crash.log",
      );
      if (fs.existsSync(publicCrash)) {
        try {
          fs.unlinkSync(publicCrash);
        } catch (_) {}
      }
      resolve();
    } catch (err) {
      reject(err);
    }
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
  if (isNaN(v)) return 5;
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
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
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
