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

  const nodePaths = [
    path.join(capacitorRoot, "node_modules"),
    path.join(capacitorRoot, "..", "electron", "node_modules"),
    path.join(capacitorRoot, "..", "node_modules"),
  ].join(path.delimiter);

  execSync(esbuildCmd, {
    cwd: nodejsDir,
    stdio: "inherit",
    env: { ...process.env, NODE_PATH: nodePaths },
  });
  console.log("[bundle] Successfully created main.bundle.js");

  const bundlePath = path.join(nodejsDir, "main.bundle.js");
  if (fs.existsSync(bundlePath)) {
    let bundleContent = fs.readFileSync(bundlePath, "utf8");
    const originalLength = bundleContent.length;
    bundleContent = bundleContent
      .replaceAll("/^[$_\\p{ID_Start}]$/u", "/^[a-zA-Z_$]$/")
      .replaceAll(
        "/^[$\\u200c\\u200d\\p{ID_Continue}]$/u",
        "/^[a-zA-Z0-9_$\\u200c\\u200d]$/",
      )
      .replaceAll(
        "/^[$_\\p{ID_Start}][$\\u200c\\u200d\\p{ID_Continue}]*$/u",
        "/^[a-zA-Z_$][a-zA-Z0-9_$\\u200c\\u200d]*$/",
      )
      .replace(/new RegExp\(([^,\n]+),\s*["']v["']\)/g, 'new RegExp($1, "u")');

    const intlPolyfillHeader = `if (typeof globalThis.Intl === "undefined" || typeof Intl === "undefined") {
  const _LF = class { constructor() {} format(l = []) { return Array.isArray(l) ? l.join(", ") : String(l); } formatToParts(l = []) { return (Array.isArray(l) ? l : [l]).map((v) => ({ type: "element", value: String(v) })); } };
  const _DTF = class { constructor() {} format(d = new Date()) { return new Date(d).toISOString(); } };
  const _NF = class { constructor() {} format(n = 0) { return String(n); } };
  const _PR = class { constructor() {} select(n = 0) { return n === 1 ? "one" : "other"; } };
  const _RTF = class { constructor() {} format(v, u) { return v + " " + u; } };
  const _Col = class { constructor() {} compare(a, b) { return String(a).localeCompare(String(b)); } };
  const _Intl = { ListFormat: _LF, DateTimeFormat: _DTF, NumberFormat: _NF, PluralRules: _PR, RelativeTimeFormat: _RTF, Collator: _Col, getCanonicalLocales: (l) => (Array.isArray(l) ? l : [l].filter(Boolean)) };
  globalThis.Intl = _Intl;
  if (typeof global !== "undefined") global.Intl = _Intl;
}
`;
    if (!bundleContent.startsWith("if (typeof globalThis.Intl")) {
      bundleContent = intlPolyfillHeader + bundleContent;
    }

    bundleContent = bundleContent.replaceAll(
      "new Intl.ListFormat",
      "new (globalThis.Intl?.ListFormat || class { constructor() {} format(l = []) { return Array.isArray(l) ? l.join(', ') : String(l); } })",
    );

    const rootChangelog = path.resolve(capacitorRoot, "..", "changelog.md");
    if (fs.existsSync(rootChangelog)) {
      const changelogText = fs.readFileSync(rootChangelog, "utf8");
      bundleContent = bundleContent.replace(
        '"__EMBEDDED_CHANGELOG_PLACEHOLDER__"',
        JSON.stringify(changelogText),
      );
      console.log("[bundle] Injected root changelog into main.bundle.js");
    }

    if (
      bundleContent.length !== originalLength ||
      bundleContent.includes("/^[a-zA-Z_$]$/") ||
      bundleContent.includes(rootChangelog)
    ) {
      fs.writeFileSync(bundlePath, bundleContent, "utf8");
      console.log(
        "[bundle] Sanitized Unicode property escapes and updated main.bundle.js.",
      );
    }
  }

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
