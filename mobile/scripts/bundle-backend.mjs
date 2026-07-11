#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const mobileRoot = path.resolve(__dirname, "..");
const nodejsDir = path.join(mobileRoot, "www", "nodejs");

console.log("[bundle] Bundling Node.js backend using esbuild...");

try {
  // Define absolute paths for shims to ensure correct aliasing during bundling
  const electronShim = path.join(nodejsDir, "shims", "electron.js");
  const sqliteShim = path.join(nodejsDir, "shims", "node-sqlite.js");
  const discordShim = path.join(nodejsDir, "shims", "discord-rpc.js");
  const ffmpegShim = path.join(nodejsDir, "shims", "ffmpeg-static.js");

  // 1. Run esbuild bundle command
  //    - "bridge" (the capacitor-nodejs built-in) is external (resolved at runtime)
  //    - "better-sqlite3" is a native addon, must stay external
  //    - All shims are aliased to their absolute paths so they resolve from any depth
  const esbuildCmd = [
    "npx esbuild main.js",
    "--bundle",
    "--platform=node",
    "--target=node18",
    "--external:bridge",
    "--external:better-sqlite3",
    `--alias:electron=${electronShim}`,
    `--alias:node:sqlite=${sqliteShim}`,
    `--alias:discord-rpc=${discordShim}`,
    `--alias:ffmpeg-static=${ffmpegShim}`,
    "--outfile=main.bundle.js"
  ].join(" ");

  execSync(esbuildCmd, { cwd: nodejsDir, stdio: "inherit" });
  console.log("[bundle] Successfully created main.bundle.js");

  // 2. Copy sql-wasm.wasm to the root of www/nodejs/
  const wasmSrc = path.join(mobileRoot, "node_modules", "sql.js", "dist", "sql-wasm.wasm");
  const wasmDest = path.join(nodejsDir, "sql-wasm.wasm");
  if (fs.existsSync(wasmSrc)) {
    fs.copyFileSync(wasmSrc, wasmDest);
    console.log("[bundle] Copied sql-wasm.wasm to backend root");
  } else {
    console.warn("[bundle] Warning: sql-wasm.wasm not found in node_modules!");
  }

  // 3. Edit package.json main field to point to main.bundle.js and sync version
  const pkgPath = path.join(nodejsDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.main = "main.bundle.js";
    try {
      const srcPkgPath = path.join(mobileRoot, "..", "src", "package.json");
      if (fs.existsSync(srcPkgPath)) {
        const srcPkg = JSON.parse(fs.readFileSync(srcPkgPath, "utf8"));
        if (pkg.version !== srcPkg.version) {
          pkg.version = srcPkg.version;
          console.log(`[bundle] Bumped mobile backend version to ${srcPkg.version}`);
        }
      }
    } catch (e) {
      console.warn("[bundle] Warning: Could not sync version from src/package.json:", e.message);
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
    console.log("[bundle] Updated package.json main to main.bundle.js and synced version");
  }

  // 4. Clean up workspace: delete node_modules and backend/ (both restored
  //    by sync-backend.mjs on next run). Keep shims/, main.js, bridge.js —
  //    those are mobile-specific source files needed for the next bundle.
  console.log("[bundle] Cleaning up workspace for fast Capacitor copy...");
  const foldersToDelete = [
    path.join(nodejsDir, "node_modules"),
  ];
  for (const folder of foldersToDelete) {
    if (fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }

  const filesToDelete = [
    "package-lock.json",
  ];
  for (const file of filesToDelete) {
    const fp = path.join(nodejsDir, file);
    if (fs.existsSync(fp)) {
      fs.rmSync(fp, { force: true });
    }
  }

  console.log("[bundle] Cleanup done! Ready for Capacitor copy.");
} catch (err) {
  console.error("[bundle] Failed to bundle backend:", err.message);
  process.exit(1);
}
