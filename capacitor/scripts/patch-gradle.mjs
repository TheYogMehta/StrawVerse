#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const capacitorBuildGradle = path.resolve(
  __dirname,
  "..",
  "android",
  "app",
  "capacitor.build.gradle",
);

if (fs.existsSync(capacitorBuildGradle)) {
  let content = fs.readFileSync(capacitorBuildGradle, "utf8");
  if (content.includes("VERSION_21")) {
    content = content.replaceAll("VERSION_21", "VERSION_17");
    console.log(
      "[patch-gradle] Patched capacitor.build.gradle to use JavaVersion.VERSION_17",
    );
  }
  const cordovaPluginsDir = path.resolve(
    __dirname,
    "..",
    "android",
    "capacitor-cordova-android-plugins",
  );
  const cordovaVariablesGradle = path.join(
    cordovaPluginsDir,
    "cordova.variables.gradle",
  );
  if (!fs.existsSync(cordovaVariablesGradle)) {
    if (!fs.existsSync(cordovaPluginsDir)) {
      fs.mkdirSync(cordovaPluginsDir, { recursive: true });
    }
    fs.writeFileSync(
      cordovaVariablesGradle,
      "// Empty cordova variables\next {\n    cdvPluginPostBuildExtras = []\n}\n",
      "utf8",
    );
    console.log("[patch-gradle] Created placeholder cordova.variables.gradle");
  }
  fs.writeFileSync(capacitorBuildGradle, content, "utf8");
}
