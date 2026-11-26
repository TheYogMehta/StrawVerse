// Run: NODE_PATH=electron/node_modules node --test backend/utils/routesSmoke.test.js
const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

test("backend routes load cleanly without syntax or module errors", (t) => {
  const prevDataDir = process.env.STRAWVERSE_DATA_DIR;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-routes-"));
  process.env.STRAWVERSE_DATA_DIR = tmpDir;

  t.after(() => {
    if (prevDataDir === undefined) {
      delete process.env.STRAWVERSE_DATA_DIR;
    } else {
      process.env.STRAWVERSE_DATA_DIR = prevDataDir;
    }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch (_) {}
  });

  const router = require("../routes/index");
  assert.strictEqual(typeof router, "function");

  const hasInfoItemsRoute = router.stack.some(
    (layer) =>
      layer.name === "router" &&
      Array.isArray(layer.handle?.stack) &&
      layer.handle.stack.some((sub) => sub.route?.path === "/api/info/items"),
  );
  assert.strictEqual(hasInfoItemsRoute, true);
});
