/**
 * Electron API shim for the Android (nodejs-mobile) runtime.
 *
 * The desktop backend (src/backend) talks to a small, well-defined slice of
 * the Electron API. This module re-implements that slice on top of plain
 * Node.js + the Capacitor <-> Node channel bridge so the backend code can run
 * completely unchanged inside the app.
 *
 * Surface implemented:
 *   - app.getPath / app.on / app.getVersion / app.isPackaged / app.whenReady
 *   - ipcMain.handle / ipcMain.on  (registry consumed by bridge.js HTTP router)
 *   - net.fetch                    (Node >= 18 global fetch)
 *   - session.fromPartition        (stub, cookie jar in memory)
 *   - BrowserWindow                (stub - Cloudflare bypass degrades gracefully)
 *   - shell.openExternal           (forwarded to Capacitor Browser plugin)
 *   - dialog / Notification        (no-op stubs)
 */

const EventEmitter = require("events");
const path = require("path");
const fs = require("fs");

// ---------------------------------------------------------------------------
// Paths - provided by main.js via environment variables before backend load
// ---------------------------------------------------------------------------
const DATA_DIR =
  process.env.STRAWVERSE_DATA_DIR || path.join(process.cwd(), "data");
const DOWNLOADS_DIR =
  process.env.STRAWVERSE_DOWNLOADS_DIR || path.join(DATA_DIR, "Downloads");
const TEMP_DIR = process.env.STRAWVERSE_TEMP_DIR || path.join(DATA_DIR, "tmp");

for (const dir of [DATA_DIR, DOWNLOADS_DIR, TEMP_DIR]) {
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (_) {
    /* best effort */
  }
}

// ---------------------------------------------------------------------------
// app
// ---------------------------------------------------------------------------
const appEmitter = new EventEmitter();

const app = {
  getPath(name) {
    switch (name) {
      case "userData":
      case "appData":
      case "sessionData":
        return DATA_DIR;
      case "downloads":
        return DOWNLOADS_DIR;
      case "temp":
        return TEMP_DIR;
      case "home":
        return DATA_DIR;
      case "logs":
        return path.join(DATA_DIR, "logs");
      default:
        return path.join(DATA_DIR, name);
    }
  },
  getVersion() {
    return process.env.STRAWVERSE_APP_VERSION || "0.0.0";
  },
  getName() {
    return "StrawVerse";
  },
  get isPackaged() {
    return true;
  },
  whenReady() {
    return Promise.resolve();
  },
  on(event, listener) {
    appEmitter.on(event, listener);
    return app;
  },
  once(event, listener) {
    appEmitter.once(event, listener);
    return app;
  },
  emit(event, ...args) {
    return appEmitter.emit(event, ...args);
  },
  quit() {
    appEmitter.emit("before-quit");
  },
  setAppUserModelId() {},
  requestSingleInstanceLock() {
    return true;
  },
};

// ---------------------------------------------------------------------------
// ipcMain - handlers stored in a registry; bridge.js exposes them over HTTP
// ---------------------------------------------------------------------------
const ipcHandlers = new Map(); // channel -> async handler (invoke style)
const ipcListeners = new Map(); // channel -> [listeners] (send style)

const ipcMain = {
  handle(channel, handler) {
    ipcHandlers.set(channel, handler);
  },
  removeHandler(channel) {
    ipcHandlers.delete(channel);
  },
  on(channel, listener) {
    if (!ipcListeners.has(channel)) ipcListeners.set(channel, []);
    ipcListeners.get(channel).push(listener);
    return ipcMain;
  },
};

/** Invoke a registered ipcMain handler (used by the HTTP bridge). */
async function invokeIpcHandler(channel, args = []) {
  const fakeEvent = { sender: null };
  if (ipcHandlers.has(channel)) {
    return await ipcHandlers.get(channel)(fakeEvent, ...args);
  }
  if (ipcListeners.has(channel)) {
    for (const listener of ipcListeners.get(channel)) {
      listener(fakeEvent, ...args);
    }
    return null;
  }
  throw new Error(`No ipcMain handler registered for channel "${channel}"`);
}

// ---------------------------------------------------------------------------
// net - Electron's net.fetch maps cleanly onto Node's global fetch
// ---------------------------------------------------------------------------
const net = {
  fetch(url, options) {
    return globalThis.fetch(url, options);
  },
  request() {
    throw new Error("electron.net.request is not supported on Android");
  },
  isOnline() {
    return true;
  },
};

// ---------------------------------------------------------------------------
// session - minimal in-memory cookie jar so code paths don't crash
// ---------------------------------------------------------------------------
function createSessionStub() {
  const cookieStore = [];
  const sessionEmitter = new EventEmitter();
  return {
    cookies: {
      async get(filter = {}) {
        return cookieStore.filter((c) => {
          if (filter.name && c.name !== filter.name) return false;
          if (filter.domain && !String(c.domain).includes(filter.domain))
            return false;
          if (filter.url) {
            try {
              const host = new URL(filter.url).hostname;
              const domain = String(c.domain || "").replace(/^\./, "");
              if (host !== domain && !host.endsWith("." + domain)) return false;
            } catch (_) {
              return false;
            }
          }
          return true;
        });
      },
      async set(cookie) {
        const idx = cookieStore.findIndex(
          (c) => c.name === cookie.name && c.domain === cookie.domain,
        );
        if (idx >= 0) cookieStore[idx] = cookie;
        else cookieStore.push(cookie);
      },
      async remove(url, name) {
        const idx = cookieStore.findIndex((c) => c.name === name);
        if (idx >= 0) cookieStore.splice(idx, 1);
      },
    },
    webRequest: {
      onBeforeRequest() {},
      onBeforeSendHeaders() {},
      onHeadersReceived() {},
    },
    on(event, listener) {
      sessionEmitter.on(event, listener);
    },
    setUserAgent() {},
    clearStorageData() {
      cookieStore.length = 0;
      return Promise.resolve();
    },
  };
}

const defaultSession = createSessionStub();
const partitions = new Map();

const session = {
  get defaultSession() {
    return defaultSession;
  },
  fromPartition(name) {
    if (!partitions.has(name)) partitions.set(name, createSessionStub());
    return partitions.get(name);
  },
};

// ---------------------------------------------------------------------------
// BrowserWindow - stub. The desktop app uses a hidden window for Cloudflare
// bypass; on Android that path degrades gracefully (loadURL rejects, callers
// already catch errors). Most providers work without the CF bypass window.
// ---------------------------------------------------------------------------
class BrowserWindowStub extends EventEmitter {
  constructor(options = {}) {
    super();
    this._destroyed = false;
    const winSession =
      (options.webPreferences && options.webPreferences.session) ||
      defaultSession;
    this.webContents = Object.assign(new EventEmitter(), {
      session: winSession,
      send: () => {},
      setWindowOpenHandler: () => {},
      setUserAgent: () => {},
      getUserAgent: () =>
        process.env.STRAWVERSE_USER_AGENT ||
        "Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36",
      executeJavaScript: async () => {
        throw new Error("BrowserWindow is not available on Android");
      },
      on: EventEmitter.prototype.on,
      once: EventEmitter.prototype.once,
    });
  }
  loadURL() {
    return Promise.reject(
      new Error(
        "BrowserWindow.loadURL is not available on Android (CF bypass skipped)",
      ),
    );
  }
  show() {}
  hide() {}
  focus() {}
  close() {
    this._destroyed = true;
    this.emit("closed");
  }
  destroy() {
    this._destroyed = true;
  }
  isDestroyed() {
    return this._destroyed;
  }
  setMenu() {}
  static getAllWindows() {
    return [];
  }
}

// ---------------------------------------------------------------------------
// shell - openExternal forwards to native (Capacitor Browser plugin)
// ---------------------------------------------------------------------------
const shell = {
  async openExternal(url) {
    // sendToNative is attached by main.js once the capacitor channel is ready
    if (typeof global.__sendToNative === "function") {
      global.__sendToNative("open-external", { url });
    }
  },
  async openPath(target) {
    if (typeof global.__sendToNative === "function") {
      global.__sendToNative("open-path", { path: target });
    }
    return "";
  },
  showItemInFolder() {},
};

// ---------------------------------------------------------------------------
// dialog / Notification - no-op stubs
// ---------------------------------------------------------------------------
const dialog = {
  async showOpenDialog() {
    return { canceled: true, filePaths: [] };
  },
  async showSaveDialog() {
    return { canceled: true, filePath: undefined };
  },
  async showMessageBox() {
    return { response: 0 };
  },
  showErrorBox() {},
};

class NotificationStub {
  constructor(options = {}) {
    this.options = options;
  }
  show() {
    if (typeof global.__sendToNative === "function") {
      global.__sendToNative("notification", this.options);
    }
  }
  static isSupported() {
    return true;
  }
  on() {}
}

module.exports = {
  app,
  ipcMain,
  net,
  session,
  BrowserWindow: BrowserWindowStub,
  shell,
  dialog,
  Notification: NotificationStub,
  contextBridge: { exposeInMainWorld: () => {} },
  ipcRenderer: null,
  // Extras consumed by the mobile bridge:
  __invokeIpcHandler: invokeIpcHandler,
  __ipcHandlers: ipcHandlers,
};
