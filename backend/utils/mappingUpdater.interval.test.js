const test = require("node:test");
const assert = require("node:assert");

const { parseSyncIntervalHours } = require("./mappingUpdater");

test("parseSyncIntervalHours: default, off, and hour values", () => {
  // Missing or unusable values fall back to the hourly default.
  assert.equal(parseSyncIntervalHours(undefined), 1);
  assert.equal(parseSyncIntervalHours(null), 1);
  assert.equal(parseSyncIntervalHours(""), 1);
  assert.equal(parseSyncIntervalHours("abc"), 1);
  assert.equal(parseSyncIntervalHours(-3), 1);
  // 0 is a valid setting: the scheduled timer is off.
  assert.equal(parseSyncIntervalHours(0), 0);
  assert.equal(parseSyncIntervalHours("0"), 0);
  // Hours pass through; fractional input floors.
  assert.equal(parseSyncIntervalHours(1), 1);
  assert.equal(parseSyncIntervalHours("3"), 3);
  assert.equal(parseSyncIntervalHours(2.7), 2);
});
