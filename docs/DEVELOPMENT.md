# Development & Deployment Guide

## 1. Prerequisites

Ensure the following tools are installed in your development environment:
- **Node.js**: v20.x or v22.x LTS
- **npm**: v9+ (or pnpm/yarn)
- **Java Development Kit (JDK)**: JDK 17 or 21 (required for Android builds)
- **Android Studio & SDK**: Android SDK Platform 34+, Android Build-Tools, and NDK (for native mobile compilation)
- **Git**: For version control and submodule resolution

---

## 2. Initial Setup

1. **Clone the Repository**:
   ```bash
   git clone https://github.com/TheYogMehta/StrawVerse.git
   cd StrawVerse
   ```

2. **Automated Setup Script**:
   StrawVerse provides a bootstrap installation script for all workspace subprojects:
   ```bash
   bash install.sh
   ```
   *Alternatively, install dependencies manually:*
   ```bash
   npm install --prefix gui
   npm install --prefix electron
   npm install --prefix capacitor
   ```

3. **Download Prebuilt Native Binaries** (FFmpeg, FFprobe, MPV):
   ```bash
   node electron/scripts/download-binaries.js
   ```

---

## 3. Running Locally

### 3.1 Desktop Development (Electron + React)

To launch the desktop app with live React development:
```bash
# In Terminal 1 (Start React Frontend dev server)
cd gui
npm run dev

# In Terminal 2 (Start Electron Main process)
cd electron
npm start
```

Or run the full desktop build pipeline:
```bash
npm run start:desktop
```

### 3.2 Android Development (Capacitor)

1. **Build GUI and Sync to Android Project**:
   ```bash
   npm run sync:android
   ```
   This automatically:
   - Builds the production React app (`gui/dist`).
   - Bundles the backend code into `capacitor/www/nodejs`.
   - Runs `npx cap sync android`.

2. **Run on Connected Device or Emulator**:
   ```bash
   cd capacitor
   npx cap run android
   ```
   *Or open in Android Studio:*
   ```bash
   npx cap open android
   ```

---

## 4. Production Packaging & Building

### 4.1 Packaging Desktop Apps (Windows & Linux)
```bash
npm run build:desktop
```
This triggers `electron-builder` to output:
- **Windows**: `electron/dist/StrawVerse.Setup.exe` (NSIS installer)
- **Linux**: `electron/dist/StrawVerse.AppImage` / `.snap`

### 4.2 Packaging Android Release APK
```bash
npm run build:android
```
The compiled unsigned or signed release APK will be located at:
`capacitor/android/app/build/outputs/apk/release/app-release.apk`

---

## 5. Release & Version Management

- **Update Version**:
  ```bash
  bash update-version.sh <new_version>
  ```
  Synchronizes `package.json` versions across root, `gui/`, `electron/`, and `capacitor/`, alongside updating Android `versionCode` and `versionName` in `build.gradle`.

- **Automated Release**:
  ```bash
  bash release.sh
  ```
  Runs testing suites, builds both desktop distribution packages and Android APKs, tags git commits, and generates release artifacts.
