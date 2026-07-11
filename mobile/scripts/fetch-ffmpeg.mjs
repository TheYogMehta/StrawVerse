#!/usr/bin/env node
/**
 * Downloads static ffmpeg binaries and installs them as jniLibs so they ship
 * inside the APK as `libffmpeg.so`.
 *
 *   jniLibs/arm64-v8a/libffmpeg.so    <- ffmpeg-release-arm64-static
 *   jniLibs/armeabi-v7a/libffmpeg.so  <- ffmpeg-release-armhf-static
 *   jniLibs/x86_64/libffmpeg.so      <- ffmpeg-release-amd64-static (emulator)
 *
 * The John Van Sickle builds are fully static (no libc dependency), so they
 * run fine under Android's bionic runtime. Because the manifest sets
 * android:extractNativeLibs="true" (and gradle uses legacy jniLibs
 * packaging), the binaries land uncompressed in the app's nativeLibraryDir -
 * the only executable location on modern Android. The ffmpeg-static shim in
 * mobile/nodejs/shims resolves them from there at runtime.
 *
 * Requires `tar` with xz support on the build machine (standard on
 * Linux/macOS; on Windows use WSL or Git Bash with xz installed).
 *
 * Usage:
 *   node mobile/scripts/fetch-ffmpeg.mjs             # arm64 only (default)
 *   node mobile/scripts/fetch-ffmpeg.mjs --all       # all three ABIs
 *   node mobile/scripts/fetch-ffmpeg.mjs --force     # re-download
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const jniLibsDir = path.resolve(
  __dirname,
  "..",
  "android",
  "app",
  "src",
  "main",
  "jniLibs",
);

const BASE = "https://johnvansickle.com/ffmpeg/releases";

const TARGETS = [
  {
    abi: "arm64-v8a",
    archive: "ffmpeg-release-arm64-static.tar.xz",
    default: true,
  },
  {
    abi: "armeabi-v7a",
    archive: "ffmpeg-release-armhf-static.tar.xz",
    default: false,
  },
  {
    abi: "x86_64",
    archive: "ffmpeg-release-amd64-static.tar.xz",
    default: false,
  },
];

const args = process.argv.slice(2);
const all = args.includes("--all");
const force = args.includes("--force");

async function download(url, dest) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(dest, buf);
}

function extractFfmpeg(archivePath, workDir) {
  execFileSync("tar", ["-xJf", archivePath, "-C", workDir], {
    stdio: "inherit",
  });
  // Archive contains a single ffmpeg-<version>-<arch>-static/ directory
  for (const entry of fs.readdirSync(workDir)) {
    const candidate = path.join(workDir, entry, "ffmpeg");
    if (fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`ffmpeg binary not found inside ${archivePath}`);
}

async function main() {
  const targets = TARGETS.filter((t) => all || t.default);
  for (const target of targets) {
    const outDir = path.join(jniLibsDir, target.abi);
    const outFile = path.join(outDir, "libffmpeg.so");

    if (fs.existsSync(outFile) && !force) {
      console.log(`[ffmpeg] ${target.abi}: already present, skipping`);
      continue;
    }

    const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "sv-ffmpeg-"));
    try {
      const archivePath = path.join(workDir, target.archive);
      console.log(`[ffmpeg] ${target.abi}: downloading ${target.archive}...`);
      await download(`${BASE}/${target.archive}`, archivePath);

      console.log(`[ffmpeg] ${target.abi}: extracting...`);
      const bin = extractFfmpeg(archivePath, workDir);

      fs.mkdirSync(outDir, { recursive: true });
      fs.copyFileSync(bin, outFile);
      fs.chmodSync(outFile, 0o755);
      const sizeMb = (fs.statSync(outFile).size / 1024 / 1024).toFixed(1);
      console.log(
        `[ffmpeg] ${target.abi}: installed libffmpeg.so (${sizeMb} MB)`,
      );
    } finally {
      fs.rmSync(workDir, { recursive: true, force: true });
    }
  }
  console.log("[ffmpeg] Done.");
}

main().catch((err) => {
  console.error(`[ffmpeg] FAILED: ${err.message}`);
  process.exit(1);
});
