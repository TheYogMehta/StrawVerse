#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const capacitorRoot = path.resolve(__dirname, "..");
const srcDir = path.join(capacitorRoot, "www");
const destDir = path.join(capacitorRoot, "android", "app", "src", "main", "assets", "public");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(src, dest);
    } else {
      fs.copyFileSync(src, dest);
    }
  }
}

console.log("[post-copy] Syncing bundled app assets to Android assets...");

try {
  // 1. Copy loader files
  for (const file of ["index.html", "loader.js"]) {
    const src = path.join(srcDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destDir, file));
    }
  }

  // 2. Copy bundled nodejs files
  const destNodejs = path.join(destDir, "nodejs");
  fs.mkdirSync(destNodejs, { recursive: true });

  for (const file of ["main.bundle.js", "package.json", "sql-wasm.wasm"]) {
    const src = path.join(srcDir, "nodejs", file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(destNodejs, file));
    }
  }

  // 3. Copy gui/dist
  const guiSrc = path.join(srcDir, "nodejs", "gui");
  if (fs.existsSync(guiSrc)) {
    copyDir(guiSrc, path.join(destNodejs, "gui"));
  }

  // 4. Clean up any residual unbundled files from native assets
  const obsolete = [
    path.join(destNodejs, "node_modules"),
    path.join(destNodejs, "backend"),
    path.join(destNodejs, "shims"),
  ];
  for (const p of obsolete) {
    if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
  }
  for (const f of ["main.js", "bridge.js", "CHANGELOG.md", "package-lock.json"]) {
    const fp = path.join(destNodejs, f);
    if (fs.existsSync(fp)) fs.rmSync(fp, { force: true });
  }

  console.log("[post-copy] Done!");
} catch (err) {
  console.error("[post-copy] Failed:", err.message);
  process.exit(1);
}
