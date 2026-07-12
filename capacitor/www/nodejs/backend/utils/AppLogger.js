const winston = require("winston");
const path = require("path");
const fs = require("fs");

const userDataPath = process.env.NODEJS_MOBILE_DATA_DIR || process.cwd();
const LogFilePath = path.join(userDataPath, "data", "app.log");

const logDir = path.dirname(LogFilePath);
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

if (fs.existsSync(LogFilePath)) {
  fs.unlinkSync(LogFilePath);
}

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ timestamp, level, message }) => {
      return `${timestamp} [${level}]: ${message}`;
    }),
  ),
  transports: [
    new winston.transports.File({
      filename: LogFilePath,
    }),
    new winston.transports.Console({
      format: winston.format.printf(({ level, message }) => {
        return `[${level}]: ${message}`;
      }),
    }),
  ],
});

function getLogs() {
  return new Promise((resolve, reject) => {
    if (fs.existsSync(LogFilePath)) {
      fs.readFile(LogFilePath, "utf8", (err, data) => {
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
    fs.writeFile(LogFilePath, "", "utf8", (err) => {
      if (err) {
        reject("Error clearing log file");
      } else {
        resolve();
      }
    });
  });
}

module.exports = { logger, getLogs, clearLogs };
