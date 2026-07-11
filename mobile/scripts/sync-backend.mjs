#!/usr/bin/env node
/**
 * Syncs the shared desktop code into the mobile Node.js project.
 *
 *   src/backend/**       -> mobile/nodejs/backend/**       (verbatim copy)
 *   src/CHANGELOG.md     -> mobile/nodejs/CHANGELOG.md
 *   src/gui/dist/**      -> mobile/nodejs/gui/dist/**      (built GUI)
 *   src/package.json     -> version field of mobile/nodejs/package.json
 *
 * The backend is copied verbatim - platform differences are handled at
 * runtime by the module shims in mobile/nodejs/shims (electron, node:sqlite,
 * discord-rpc, ffmpeg-static). Desktop code stays the single source of truth.
 *
 * Run from anywhere: node mobile/scripts/sync-backend.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const srcDir = path.join(repoRoot, "src");
const nodejsDir = path.join(repoRoot, "mobile", "www", "nodejs");

function copyDir(from, to, { exclude = [] } = {}) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    if (exclude.includes(entry.name)) continue;
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

// 1. Backend
const backendSrc = path.join(srcDir, "backend");
const backendDest = path.join(nodejsDir, "backend");
copyDir(backendSrc, backendDest, { exclude: ["preload.js"] });
console.log(`[sync] Copied src/backend -> mobile/www/nodejs/backend`);

// 2. Changelog (routes.js and the whats-new handler read it relative to the
//    nodejs project root)
const changelogSrc = path.join(srcDir, "CHANGELOG.md");
if (fs.existsSync(changelogSrc)) {
  fs.copyFileSync(changelogSrc, path.join(nodejsDir, "CHANGELOG.md"));
  console.log(`[sync] Copied CHANGELOG.md`);
}

// 3. Built GUI (routes.js serves gui/dist/index.html relative to backend/..)
const guiDist = path.join(srcDir, "gui", "dist");
if (fs.existsSync(guiDist)) {
  copyDir(guiDist, path.join(nodejsDir, "gui", "dist"));
  console.log(`[sync] Copied src/gui/dist -> mobile/www/nodejs/gui/dist`);
} else {
  console.warn(
    `[sync] WARNING: src/gui/dist not found - run "npm run build" in src/ first`,
  );
}

// 4. Version sync
const srcPkg = JSON.parse(
  fs.readFileSync(path.join(srcDir, "package.json"), "utf-8"),
);
const mobilePkgPath = path.join(nodejsDir, "package.json");
const mobilePkg = JSON.parse(fs.readFileSync(mobilePkgPath, "utf-8"));
if (mobilePkg.version !== srcPkg.version) {
  mobilePkg.version = srcPkg.version;
  fs.writeFileSync(mobilePkgPath, JSON.stringify(mobilePkg, null, 2) + "\n");
  console.log(`[sync] Bumped mobile backend version to ${srcPkg.version}`);
}

console.log(`[sync] Installing dependencies in mobile/www/nodejs...`);
execSync("npm install --omit=dev", { cwd: nodejsDir, stdio: "inherit" });

console.log("[sync] Done.");
