#!/usr/bin/env node
/**
 * Orchestrates all mobile sync steps in one script:
 *   1. sync-backend  — copies backend source + installs deps
 *   2. bundle-backend — esbuild bundles into main.bundle.js, cleans source
 *   3. copy-missing-assets — ensures Android assets are up to date
 *   4. fetch-ffmpeg — downloads ffmpeg binary for Android
 */

import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const steps = [
  "sync-backend.mjs",
  "bundle-backend.mjs",
  "copy-missing-assets.mjs",
  "fetch-ffmpeg.mjs",
  "generate-icons.py",
];

for (const script of steps) {
  const scriptPath = path.join(__dirname, script);
  console.log(`\n▶ Running ${script}...\n`);
  const runner = script.endsWith(".py") ? "python3" : "node";
  execFileSync(runner, [scriptPath], {
    cwd: path.resolve(__dirname, ".."),
    stdio: "inherit",
  });
}

console.log("\n✅ All sync steps complete.\n");
