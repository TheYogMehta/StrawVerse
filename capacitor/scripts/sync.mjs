#!/usr/bin/env node
/**
 * Orchestrates all capacitor sync steps in one script:
 *   1. sync-backend  — copies backend source + installs deps
 *   2. bundle-backend — esbuild bundles into main.bundle.js, cleans source
 *   3. copy-missing-assets — ensures Android assets are up to date
 *   4. fetch-ffmpeg — downloads ffmpeg binary for Android
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import fs from "node:fs";

const guiDistSrc = path.resolve(__dirname, "..", "..", "gui", "dist");
const guiDistDest = path.resolve(
  __dirname,
  "..",
  "www",
  "nodejs",
  "gui",
  "dist",
);
if (fs.existsSync(guiDistSrc)) {
  if (fs.existsSync(guiDistDest)) {
    fs.rmSync(guiDistDest, { recursive: true, force: true });
  }
  fs.mkdirSync(guiDistDest, { recursive: true });
  fs.cpSync(guiDistSrc, guiDistDest, { recursive: true });
  console.log(
    "[sync] Cleaned & synced root gui/dist to capacitor nodejs gui/dist",
  );
}

// Patch @capacitor/cli for tar v7 compatibility when tar is overridden
try {
  const cliTemplatePath = path.resolve(
    __dirname,
    "..",
    "node_modules",
    "@capacitor",
    "cli",
    "dist",
    "util",
    "template.js",
  );
  if (fs.existsSync(cliTemplatePath)) {
    let content = fs.readFileSync(cliTemplatePath, "utf8");
    if (content.includes("await tar_1.default.extract")) {
      content = content.replace(
        "await tar_1.default.extract",
        "await (tar_1.default || tar_1).extract",
      );
      fs.writeFileSync(cliTemplatePath, content, "utf8");
      console.log("[sync] Patched @capacitor/cli for tar compatibility");
    }
  }
} catch (_) {}

const steps = [
  "bundle-backend.mjs",
  "copy-missing-assets.mjs",
  "fetch-ffmpeg.mjs",
];

const passArgs = process.argv.slice(2);

for (const script of steps) {
  const scriptPath = path.join(__dirname, script);
  console.log(`\n▶ Running ${script}...\n`);
  const extraArgs = script === "fetch-ffmpeg.mjs" ? passArgs : [];
  execFileSync("node", [scriptPath, ...extraArgs], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
  });
}

console.log("\n✅ All sync steps complete.\n");
