// Run: node --test backend/utils/constants.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  getEpisodeNumberFromFilename,
  mediaServerFileBase,
  hasLocalMediaFiles,
} = require("./constants");

test("episode number from both naming schemes", () => {
  assert.strictEqual(getEpisodeNumberFromFilename("5Ep.mp4"), 5);
  assert.strictEqual(getEpisodeNumberFromFilename("Frieren - S01E05 [1080p].mp4"), 5);
  // Leading digits in the title must not win over SxxExx
  assert.strictEqual(getEpisodeNumberFromFilename("86 Eighty-Six - S02E11 [720p].mp4"), 11);
  assert.strictEqual(getEpisodeNumberFromFilename("Show - S01E12.5 [1080p].mp4"), 12.5);
  assert.strictEqual(getEpisodeNumberFromFilename("Show - S1EP05.mp4"), 5);
  assert.strictEqual(getEpisodeNumberFromFilename("One Piece - 1052.mp4"), 1052);
  assert.strictEqual(getEpisodeNumberFromFilename("Episode 04.mp4"), 4);
});

test("file name comes from the Show/Season NN folder", () => {
  const dir = path.join("dl", "Anime", "Kaguya-sama Love is War", "Season 03");
  assert.strictEqual(
    mediaServerFileBase(dir, "3", "1080p"),
    "Kaguya-sama Love is War - S03E03 [1080p]",
  );
  assert.strictEqual(
    mediaServerFileBase(dir, "12.5", "1080p"),
    "Kaguya-sama Love is War - S03E12.5 [1080p]",
  );
  assert.strictEqual(
    mediaServerFileBase(path.join("dl", "Show", "Season 00"), 1, null),
    "Show - S00E01",
  );
  assert.strictEqual(
    mediaServerFileBase(path.join("dl", "Show", "Season 01"), "0.5", null),
    "Show - S01E00.5",
  );
  // Not a season folder: show name is the folder, season 1
  assert.strictEqual(
    mediaServerFileBase(path.join("dl", "Overlord IV"), 120, "720p"),
    "Overlord IV - S01E120 [720p]",
  );
});

test("show folder holding only season folders is not empty", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "sv-"));
  try {
    const season = path.join(root, "Show", "Season 02");
    fs.mkdirSync(season, { recursive: true });
    fs.writeFileSync(path.join(season, "Show - S02E01 [1080p].mp4"), "x");
    const show = path.join(root, "Show");
    assert.strictEqual(hasLocalMediaFiles(show, "Anime"), false); // direct only
    assert.strictEqual(hasLocalMediaFiles(show, "Anime", true), true);
    assert.strictEqual(hasLocalMediaFiles(season, "Anime"), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
