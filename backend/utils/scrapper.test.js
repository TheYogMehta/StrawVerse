// Run: NODE_PATH=electron/node_modules node --test backend/utils/scrapper.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-scrapper-"));
const prevDataDir = process.env.STRAWVERSE_DATA_DIR;
process.env.STRAWVERSE_DATA_DIR = tmpDir;

const {
  shouldRevealScrapperWindow,
  INTERACTIVE_CHALLENGE_GRACE_ITERATIONS,
} = require("./scrapper");

test.after(() => {
  if (prevDataDir === undefined) {
    delete process.env.STRAWVERSE_DATA_DIR;
  } else {
    process.env.STRAWVERSE_DATA_DIR = prevDataDir;
  }
  try {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  } catch (_) {}
});

function createStubScrapperWindow(steps) {
  let stepIndex = 0;
  let visible = false;
  let showCount = 0;
  let hideCount = 0;
  let currentUrl = "about:blank";
  let currentTitle = "StrawVerse - Verification";
  let cookies = [];

  const win = {
    isDestroyed: () => false,
    isVisible: () => visible,
    isMinimized: () => false,
    restore: () => {},
    setParentWindow: () => {},
    setTitle: (t) => {
      currentTitle = t;
    },
    getTitle: () => currentTitle,
    setAlwaysOnTop: () => {},
    show: () => {
      visible = true;
      showCount++;
    },
    focus: () => {},
    moveTop: () => {},
    hide: () => {
      visible = false;
      hideCount++;
    },
    loadURL: async (url) => {
      currentUrl = url;
      if (url === "about:blank") {
        currentTitle = "about:blank";
        global.LastScrapperResponseCode = 200;
        return;
      }
      const next = steps[Math.min(stepIndex, steps.length - 1)];
      global.LastScrapperResponseCode = next.status;
      currentTitle = next.title;
      cookies = next.cookies || [];
    },
    webContents: {
      getURL: () => currentUrl,
      getUserAgent: () => "Mozilla/5.0 Test",
      isLoading: () => false,
      executeJavaScript: async (expr) => {
        if (expr === "document.readyState") return "complete";
        const cur = steps[Math.min(stepIndex, steps.length - 1)];
        const html = cur.html || "";
        // Advance after polling outerHTML once per loop iteration
        if (expr.includes("outerHTML") && stepIndex < steps.length - 1) {
          stepIndex++;
          const next = steps[stepIndex];
          global.LastScrapperResponseCode = next.status;
          currentTitle = next.title;
          cookies = next.cookies || [];
        }
        return html;
      },
      session: {
        cookies: {
          get: async () => cookies,
          remove: async () => {},
        },
      },
    },
    get counts() {
      return { showCount, hideCount };
    },
  };

  return win;
}

test("shouldRevealScrapperWindow waits for grace period and only reveals on active challenges", () => {
  assert.strictEqual(
    shouldRevealScrapperWindow({ iteration: 0, isChallenge: false, isHttpBlocked: false }),
    false,
  );
  assert.strictEqual(
    shouldRevealScrapperWindow({ iteration: 0, isChallenge: true, isHttpBlocked: false }),
    false,
  );
  assert.strictEqual(
    shouldRevealScrapperWindow({
      iteration: INTERACTIVE_CHALLENGE_GRACE_ITERATIONS - 1,
      isChallenge: false,
      isHttpBlocked: true,
    }),
    false,
  );
  assert.strictEqual(
    shouldRevealScrapperWindow({
      iteration: INTERACTIVE_CHALLENGE_GRACE_ITERATIONS,
      isChallenge: true,
      isHttpBlocked: false,
    }),
    true,
  );
  assert.strictEqual(
    shouldRevealScrapperWindow({
      iteration: INTERACTIVE_CHALLENGE_GRACE_ITERATIONS,
      isChallenge: false,
      isHttpBlocked: true,
    }),
    true,
  );
});

test("cloudflarebypass(url, true) keeps ScrapperWindow hidden when destination loads cleanly", async (t) => {
  const prevWin = global.ScrapperWindow;
  const prevCode = global.LastScrapperResponseCode;
  const stub = createStubScrapperWindow([
    {
      status: 200,
      title: "Player",
      html: `<html><body><div id="player">${"x".repeat(600)}</div></body></html>`,
    },
  ]);
  global.ScrapperWindow = stub;
  t.after(() => {
    global.ScrapperWindow = prevWin;
    global.LastScrapperResponseCode = prevCode;
  });

  await global.cloudflarebypass("https://embed.example-test.invalid/embed/movie/123", true);

  assert.strictEqual(stub.counts.showCount, 0);
  assert.strictEqual(stub.counts.hideCount, 0);
});

test("cloudflarebypass(url, true) reveals ScrapperWindow once if challenge persists past grace period", async (t) => {
  const prevWin = global.ScrapperWindow;
  const prevCode = global.LastScrapperResponseCode;
  const challengeStep = {
    status: 403,
    title: "Just a moment...",
    html: "<html><body>Checking your browser before accessing</body></html>",
    cookies: [],
  };
  const solvedStep = {
    status: 200,
    title: "Player",
    html: `<html><body><div id="player">${"x".repeat(600)}</div></body></html>`,
    cookies: [{ name: "cf_clearance", domain: ".example-challenge.invalid", value: "ok", path: "/" }],
  };
  const stub = createStubScrapperWindow([
    challengeStep,
    challengeStep,
    challengeStep,
    challengeStep,
    challengeStep,
    solvedStep,
  ]);
  global.ScrapperWindow = stub;
  t.after(() => {
    global.ScrapperWindow = prevWin;
    global.LastScrapperResponseCode = prevCode;
  });

  await global.cloudflarebypass("https://embed.example-challenge.invalid/embed/movie/456", true);

  assert.strictEqual(stub.counts.showCount, 1);
  assert.strictEqual(stub.counts.hideCount, 1);
});
