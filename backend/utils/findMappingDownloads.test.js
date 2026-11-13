const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

test("FindMapping correctly scans video files and extracts episode numbers", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strawverse-test-dl-"));
  const animeDir = path.join(tmpDir, "Anime", "Test Show");
  fs.mkdirSync(animeDir, { recursive: true });

  // Create test video files and non-video files
  fs.writeFileSync(path.join(animeDir, "1Ep.mp4"), "fake-video-bytes");
  fs.writeFileSync(path.join(animeDir, "2Ep.mp4"), "fake-video-bytes");
  fs.writeFileSync(path.join(animeDir, "1Ep.srt"), "fake-sub-bytes");
  fs.writeFileSync(path.join(animeDir, ".DS_Store"), "fake-ds-store");

  const { FindMapping } = require("./Metadata");

  // Call FindMapping with the folder name and custom dir
  const result = await FindMapping("Anime", "Test Show", null, tmpDir);

  assert.ok(result, "FindMapping should return an object");
  assert.ok(Array.isArray(result.DownloadedEpisodes), "DownloadedEpisodes should be an array");
  assert.deepStrictEqual(result.DownloadedEpisodes, [1, 2], "Should detect episodes 1 and 2, filtering out srt and DS_Store");

  // Cleanup
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test("FindMapping extracts episode numbers when queried by sanitized folder name", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "strawverse-test-dl2-"));
  const animeDir = path.join(tmpDir, "Anime", "The Super Cube");
  fs.mkdirSync(animeDir, { recursive: true });

  fs.writeFileSync(path.join(animeDir, "1Ep.mp4"), "fake-video-bytes");

  const { FindMapping } = require("./Metadata");

  const result = await FindMapping("Anime", "The Super Cube", null, tmpDir);

  assert.ok(result, "FindMapping should return an object");
  assert.deepStrictEqual(result.DownloadedEpisodes, [1], "Should detect episode 1 for The Super Cube");

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
