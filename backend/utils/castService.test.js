const test = require("node:test");
const assert = require("node:assert");
const castService = require("./castService");

test("castService: getLocalIpAddress returns valid non-empty IPv4", () => {
  const ip = castService.getLocalIpAddress();
  assert.ok(typeof ip === "string");
  assert.match(ip, /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/);
});

test("castService: getStatus returns initial isCasting=false", () => {
  const status = castService.getStatus();
  assert.deepStrictEqual(status, { isCasting: false });
});

test("castService: discoverDevices returns an array", async () => {
  // Quick 1-second scan
  const devices = await castService.discoverDevices(1000);
  assert.ok(Array.isArray(devices));
});
