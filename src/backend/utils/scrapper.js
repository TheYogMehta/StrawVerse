const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

let isBusy = false;
const queue = [];
const COOKIE_FILE = path.join(app.getPath("userData"), "cookies.json");

// Loading helpers

// Create Scrapping Window
function createScrapperWindow() {
  global.ScrapperWindow = new BrowserWindow({
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      partition: "persist:scrapper",
      autoplayPolicy: "no-user-gesture-required",
    },
  });

  global.ScrapperWindow.webContents.session.webRequest.onBeforeRequest(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (details.url.includes(".m3u8") && !details.url.includes("ping.gif")) {
        global.LastM3u8 = details.url;
      }
      if (
        details.resourceType === "mainFrame" ||
        details.url.includes("ddos-guard") ||
        details.url.includes("apdoesnthavelogotheysaidapistooplaintheysaid") ||
        details.url.includes("api/fsearch") ||
        details.url.includes("megaplay") ||
        details.url.includes("jquery") ||
        details.url.includes("jsdelivr") ||
        details.url.includes(".m3u8") ||
        details.url.includes("megacloud") ||
        details.url.includes("rabbitstream") ||
        details.url.includes("jwpcdn")
      ) {
        callback({ cancel: false });
      } else {
        callback({ cancel: true });
      }
    },
  );

  global.ScrapperWindow.webContents.session.webRequest.onBeforeSendHeaders(
    { urls: ["*://*/*"] },
    (details, callback) => {
      if (details.url.includes("megaplay")) {
        details.requestHeaders["Referer"] = "https://anikototv.to/";
      }
      callback({ requestHeaders: details.requestHeaders });
    }
  );

  global.ScrapperWindow.webContents.on(
    "did-fail-load",
    (event, errorCode, errorDescription, validatedURL) => {
      console.error(
        `Failed to load ${validatedURL}: ${errorCode} - ${errorDescription}`,
      );
    },
  );

  global.ScrapperWindow.on("closed", () => {
    global.ScrapperWindow = null;
  });

  loadCookies();

  global.ScrapperWindow.webContents.session.cookies.on(
    "changed",
    (event, cookie, cause, removed) => {
      saveCookies();
    },
  );
}

// Save Cookies to disk
async function saveCookies() {
  if (!global.ScrapperWindow) return;
  try {
    const cookies = await global.ScrapperWindow.webContents.session.cookies.get(
      {},
    );
    fs.writeFileSync(COOKIE_FILE, JSON.stringify(cookies, null, 2));
  } catch (err) {
    // ignore errors
  }
}

// Load Cookies from disk
async function loadCookies() {
  if (!global.ScrapperWindow) return;
  if (!fs.existsSync(COOKIE_FILE)) return;

  try {
    const cookies = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
    for (const cookie of cookies) {
      await global.ScrapperWindow.webContents.session.cookies.set(cookie);
    }
  } catch (err) {
    // ignore
  }
}

// Public scrapeURL function, queues requests
global.scrapeURL = async (url, type = null) => {
  return new Promise((resolve, reject) => {
    queue.push({ url, type, resolve, reject });
    processQueue();
  });
};

async function processQueue() {
  if (isBusy || queue.length === 0 || !global.ScrapperWindow) return;

  const { url, resolve, reject } = queue.shift();
  isBusy = true;

  try {
    if (typeof url === "object") {
      await global.ScrapperWindow.loadURL(url.url);

      const result = await global.ScrapperWindow.webContents.executeJavaScript(`
          (async () => {
            try {
              const res = await fetch("${url.url}${url.path}", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(${JSON.stringify(url.body)})
              });
              return await res.text();
            } catch (err) {
              return "FETCH_ERROR: " + err.message;
            }
          })()
        `);

      if (result.startsWith("FETCH_ERROR:")) {
        throw result;
      } else {
        try {
          const json = JSON.parse(result);
          resolve(json);
        } catch {
          throw result;
        }
      }
    } else {
      await global.ScrapperWindow.loadURL(url);

      await new Promise((resolve) => {
        global.ScrapperWindow.webContents.once("did-stop-loading", resolve);
      });

      await new Promise((r) => setTimeout(r, 1500));
    }

    const bodyText = await global.ScrapperWindow.webContents.executeJavaScript(
      "document.body.innerText",
    );

    try {
      const json = JSON.parse(bodyText);
      resolve(json);
    } catch {
      const html = await global.ScrapperWindow.webContents.executeJavaScript(
        "document.documentElement.outerHTML",
      );
      resolve(html);
    }
  } catch (err) {
    if (err.message.includes("ERR_ABORTED")) {
      // INGORED
    } else {
      reject(err);
    }
  } finally {
    isBusy = false;
    processQueue();
  }
}

async function ExitScrapperWindow() {
  if (global.ScrapperWindow && !global.ScrapperWindow.isDestroyed()) {
    await saveCookies();
    global.ScrapperWindow.close();
    global.ScrapperWindow = null;
  }
}

module.exports = {
  createScrapperWindow,
  ExitScrapperWindow,
};
