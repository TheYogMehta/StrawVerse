# StrawVerse: Apple Silicon (macOS arm64) Architecture & Implementation Design

## 1. Overview & Understanding Summary

* **Objective:** Enable full, native Apple Silicon (`darwin-arm64`) support for StrawVerse across local development (`npm run start:desktop`) and packaged distributable releases (`.dmg` and `.zip` via `electron-builder`).
* **Context:** StrawVerse currently only bundles binaries and build configurations for Windows (`win32-x64`) and Linux (`linux-x64`). On macOS, application startup and downloads fail due to hardcoded `"linux"` path fallbacks and missing arm64 native executables for MPV and FFmpeg.
* **Target Users:** Developers running Apple Silicon Macs (M1/M2/M3/M4) and end-users running macOS.
* **Key Constraints:**
  * **Strict Bundled Binaries:** Standalone Apple Silicon (`arm64`) executables for MPV and FFmpeg must be automatically downloaded during setup/build so end-users never require external package managers like Homebrew.
  * **Ad-hoc Signing (`identity: null`):** Distributed without requiring a paid Apple Developer ID certificate, paired with clear Gatekeeper bypass instructions.
* **Explicit Non-Goals:**
  * Intel (`x64`) macOS builds or universal fat binaries (exclusive focus is native `arm64`).
  * Paid Apple Developer ID certificate signing and Apple notarization.
  * Core architecture modifications to the Express backend or React GUI beyond platform adapters.

---

## 2. Assumptions

1. Standalone, static macOS `arm64` binaries for MPV and FFmpeg are available from verified public release distributions and can be incorporated into `electron/scripts/download-binaries.js`.
2. macOS window management and custom URL scheme handling (`strawverse://` for MAL OAuth callbacks) will use Electron's native `app.on("open-url")` and platform lifecycle events.
3. Packaging can produce both `.dmg` and portable `.zip` archives under `electron/dist/`.

---

## 3. Decision Log

| Decision | Chosen Option | Alternatives Considered | Rationale |
| :--- | :--- | :--- | :--- |
| **Delivery Scope** | Full dual-support (Dev + Packaged) | Local dev only / Package only | Enables running `npm run start:desktop` locally and building `.dmg`/`.zip` releases. |
| **Binary Sourcing** | Strict bundled binaries | System-only / In-app WebPlayer fallback | Guarantees self-contained operation without forcing end-users to install Homebrew. |
| **Signing / Gatekeeper** | Ad-hoc signing (`identity: null`) | Paid Apple Developer ID notarization | Avoids requiring a $99/yr Apple Developer account; standard for open-source apps. |
| **Target Architecture** | Dedicated Apple Silicon (`arm64`) | Universal (`arm64` + `x64`) | Optimal native performance on M-series chips without doubling binary download size. |
| **Core Architecture** | Direct Binary Bundling (Option 1) | Embedded `.app` bundle | Mirrors existing Windows/Linux architecture; avoids nested bundle quarantine issues. |

---

## 4. Final Technical Design

### 4.1 Binary Acquisition Pipeline (`electron/scripts/download-binaries.js`)

Add a dedicated `setupMac()` function to the pre-build binary download script:
1. **MPV (`darwin-arm64`):**
   * Download a static, headless/IPC-compatible macOS `arm64` MPV build into `electron/mpv/darwin/mpv`.
   * Set executable permissions: `fs.chmodSync(destExe, 0o755)`.
   * Reuse shared ModernX OSC scripts and fonts in `electron/mpv/config/`.
2. **FFmpeg (`darwin-arm64`):**
   * Download `ffmpeg-darwin-arm64.gz` from `eugeneware/ffmpeg-static` releases into `electron/ffmpeg/darwin/ffmpeg`.
   * Decompress via `zlib.gunzipSync` and set executable permissions (`0o755`).
3. **Execution Condition:**
   * Invoke `setupMac()` automatically when `process.platform === "darwin"` or when invoked with multi-platform flags.

### 4.2 Runtime Path Resolution & Backend Services

#### `backend/utils/mpvPlayer.js`
* Map platform to `"darwin"` when `process.platform === "darwin"`:
  ```javascript
  const platformDir = process.platform === "win32" ? "win32" : (process.platform === "darwin" ? "darwin" : "linux");
  const exeName = process.platform === "win32" ? "mpv.exe" : "mpv";
  ```
* Candidate resolution hierarchy:
  1. `process.resourcesPath/app.asar.unpacked/mpv/darwin/mpv` (Packaged `.app`).
  2. Local development: `electron/mpv/darwin/mpv`.
  3. System fallback: `/opt/homebrew/bin/mpv` or `/usr/local/bin/mpv`.
* Retain Unix Domain Socket at `/tmp/mpvsocket-${rand}`.
* Fix binary existence checks so valid absolute paths or system commands do not falsely fail `fs.existsSync`.

#### `backend/utils/downloader.js`
* Update `platformDir` to resolve to `"darwin"` on macOS.
* Check candidate paths:
  1. `process.resourcesPath/app.asar.unpacked/ffmpeg/darwin/ffmpeg`.
  2. Local development: `electron/ffmpeg/darwin/ffmpeg`.
  3. Supplementary fallback: `/opt/homebrew/bin/ffmpeg` and `/usr/local/bin/ffmpeg`.
  4. Bundled `ffmpeg-static` module path.

### 4.3 Electron Application Lifecycle & Packaging

#### `electron/gui.js`
* **Deep Linking (`strawverse://`):**
  Handle protocol URLs via the macOS `open-url` event:
  ```javascript
  app.on("open-url", (event, url) => {
    event.preventDefault();
    handleCustomProtocolUrl(url);
  });
  ```
* **Window Lifecycle:**
  Retain background processes without quitting unless all windows are closed on non-macOS platforms:
  ```javascript
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  ```

#### `electron/package.json`
* Add the `mac` target to `electron-builder`:
  ```json
  "mac": {
    "target": [
      { "target": "dmg", "arch": ["arm64"] },
      { "target": "zip", "arch": ["arm64"] }
    ],
    "category": "public.app-category.entertainment",
    "icon": "assets/luffy.png",
    "identity": null,
    "artifactName": "StrawVerse-${version}-mac-arm64.${ext}"
  }
  ```
* Configure scripts:
  * `"package:mac": "electron-builder --mac --arm64"`

#### `release.sh`
* Conditionally trigger macOS packaging (`--mac --arm64`) when executed on macOS or cross-packaging.
* Include `*.dmg` and `*.zip` in release artifact collection for GitHub Releases.

---

## 5. Security & Gatekeeper Guidance

Because the build uses ad-hoc signing (`identity: null`), macOS Gatekeeper may flag downloaded artifacts with `com.apple.quarantine`.
* **Resolution for Users:** Right-click the application in `/Applications` and select **Open**, or run:
  ```bash
  xattr -cr /Applications/StrawVerse.app
  ```
* This instruction will be documented in `README.md` and release notes.

---

## 6. Verification Plan

1. **Binary Verification:** Execute `node electron/scripts/download-binaries.js` and verify with `file` that `mpv` and `ffmpeg` are valid Mach-O 64-bit `arm64` binaries.
2. **Local Run Verification:** Run `npm run start:desktop` on an Apple Silicon Mac; verify UI launch, database creation in `Application Support/strawverse/`, MPV stream playback, and episode downloads.
3. **Packaging Verification:** Run `npx electron-builder --mac --arm64`, mount the generated `.dmg`, copy to `/Applications`, and verify standalone execution.
