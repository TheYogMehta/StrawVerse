#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const capacitorRoot = path.resolve(__dirname, "..");
const nodejsDir = path.join(capacitorRoot, "www", "nodejs");

console.log("[bundle] Bundling Node.js backend using esbuild...");

try {
  const esbuildCmd = [
    "npx esbuild main.js",
    "--bundle",
    "--platform=node",
    "--target=node18",
    "--external:bridge",
    "--outfile=main.bundle.js",
  ].join(" ");

  execSync(esbuildCmd, { cwd: nodejsDir, stdio: "inherit" });
  console.log("[bundle] Successfully created main.bundle.js");

  const pkgPath = path.join(nodejsDir, "package.json");
  if (fs.existsSync(pkgPath)) {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    pkg.main = "main.bundle.js";
    try {
      const srcPkgPath = path.join(
        capacitorRoot,
        "..",
        "electron",
        "package.json",
      );
      if (fs.existsSync(srcPkgPath)) {
        const srcPkg = JSON.parse(fs.readFileSync(srcPkgPath, "utf8"));
        if (pkg.version !== srcPkg.version) {
          pkg.version = srcPkg.version;
          console.log(
            `[bundle] Bumped capacitor backend version to ${srcPkg.version}`,
          );
        }
      }
    } catch (e) {
      console.warn(
        "[bundle] Warning: Could not sync version from electron/package.json:",
        e.message,
      );
    }
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), "utf8");
    console.log(
      "[bundle] Updated package.json main to main.bundle.js and synced version",
    );
  }

  console.log("[bundle] Cleaning up workspace for fast Capacitor copy...");
  const foldersToDelete = [path.join(nodejsDir, "node_modules")];
  for (const folder of foldersToDelete) {
    if (fs.existsSync(folder)) {
      fs.rmSync(folder, { recursive: true, force: true });
    }
  }

  const filesToDelete = ["package-lock.json"];
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
