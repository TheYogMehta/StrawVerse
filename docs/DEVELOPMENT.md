# Development, Build, Lint & Test Guide

This document describes the unified local developer workflow for **StrawVerse**, covering development servers, build pipelines, linting configurations, and automated testing across Desktop (Electron) and Mobile (Capacitor/Android).

---

## 1. Quick Command Matrix

All key workflows can be executed from the repository root:

| Category | Command | Description |
| :--- | :--- | :--- |
| **Development** | `npm run dev:gui` | Starts Vite React frontend development server (`localhost:5173`) |
| | `npm run start:desktop` | Builds GUI and launches Electron desktop app locally |
| | `npm run dev:desktop` | Launches Electron directly with the current build |
| **Building** | `npm run build` or `npm run build:gui` | Compiles production React frontend bundle to `gui/dist` |
| | `npm run build:desktop` | Packages desktop distributables for Windows (x64) and Linux |
| | `npm run build:desktop:mac` | Packages desktop DMG & ZIP for macOS (arm64 / Apple Silicon) |
| | `npm run build:desktop:all` | Packages desktop distributables for Windows, Linux, and macOS |
| | `npm run sync:android` | Builds GUI and syncs backend bundle + assets to Android |
| | `npm run build:android` | Builds signed/release Android APK (`app-release.apk`) |
| **Linting** | `npm run lint` | Runs ESLint across React components and frontend source |
| | `npm run lint:fix` | Runs ESLint and automatically applies fixable rules |
| **Testing** | `npm test` | Runs Node.js test runner suite (`node --test`) |
| | `npm run test:watch` | Runs test suite in watch mode during development |
| **Release** | `npm run release` | Runs full release script (`release.sh`) |

---

## 2. Prerequisites & Environment Setup

Ensure the following tools are installed:
- **Node.js**: v20.x, v22.x, or v24.x LTS
- **npm**: v9+ (or pnpm/yarn)
- **Git**: For version control
- **Java Development Kit (JDK)**: JDK 17 or 21 (required only for Android builds)
- **Android SDK & Build-Tools**: Platform 34+ (required only for Android builds)

### Initial Dependency Installation

Install dependencies across all workspaces:
```bash
npm install --prefix gui
npm install --prefix electron
npm install --prefix capacitor
```

Download prebuilt desktop binaries (FFmpeg, FFprobe, MPV):
```bash
node electron/scripts/download-binaries.js
```

---

## 3. Local Development Workflow

StrawVerse uses a decoupled architecture where the React frontend (`gui/`) interacts with the embedded Express backend (`backend/`):

### 3.1 Frontend-Only Live Development (Vite HMR)
For rapid UI and styling iteration:
```bash
npm run dev:gui
```
- Starts the Vite dev server at `http://localhost:5173`.
- Hot Module Replacement (HMR) allows instant UI updates.

### 3.2 Desktop Development (Electron + Express)
To test the complete desktop integration (including MPV playback, torrent/HLS downloading, and filesystem access):
```bash
npm run start:desktop
```
This runs `npm run build:gui` first to ensure the latest frontend bundle is compiled into `gui/dist`, and then starts the Electron main process (`electron/gui.js`).

For subsequent runs where `gui/` hasn't changed:
```bash
npm run dev:desktop
```

### 3.3 Mobile Development (Android / Capacitor)
1. **Sync frontend and backend to Android container:**
   ```bash
   npm run sync:android
   ```
   This compiles `gui/dist`, bundles the backend code into `capacitor/www/nodejs`, and executes `npx cap sync android`.

2. **Run on Android Emulator or physical device:**
   ```bash
   cd capacitor
   npx cap run android
   ```
   *Or open in Android Studio:*
   ```bash
   npx cap open android
   ```

---

## 4. Linting Workflow

StrawVerse uses ESLint 9+ flat configuration (`gui/eslint.config.js`) supporting React 19, Hooks, and modern JavaScript standards.

### Running Lint Checks
```bash
npm run lint
```

### Automatically Fixing Issues
```bash
npm run lint:fix
```

### Lint Configuration Notes
- Custom globals like `__APP_CHANGELOG__` (injected via Vite's `define`) and browser APIs are pre-configured.
- React compiler/experimental hooks rules (`immutability`, `purity`, `set-state-in-effect`, `refs`) are tuned as warnings so they do not block CI while highlighting potential re-render pitfalls.

---

## 5. Testing Workflow

Unit and regression tests use the Node.js native test runner (`node:test` and `node:assert`), requiring no heavy third-party runners.

### Running Tests Locally
```bash
npm test
```

### Running Tests in Watch Mode
Automatically re-runs tests whenever test or source files are modified:
```bash
npm run test:watch
```

### Test File Conventions
- Backend unit and utility tests are named `*.test.js` (e.g., `backend/utils/constants.test.js`).
- Tests cover naming conventions, season/episode extraction, directory validations, and download engine utilities.

---

## 6. Local Production Build Workflow

### 6.1 Desktop Packaging
- **macOS (Apple Silicon / arm64)**:
  ```bash
  npm run build:desktop:mac
  ```
  Outputs: `electron/dist/StrawVerse-*.dmg` and `.zip`.

- **Windows & Linux (x64)**:
  ```bash
  npm run build:desktop
  ```
  Outputs:
  - Windows: `electron/dist/StrawVerse.Setup.*.exe` (NSIS installer)
  - Linux: `electron/dist/StrawVerse-*.AppImage` / `.deb`

- **All Desktop Platforms**:
  ```bash
  npm run build:desktop:all
  ```

### 6.2 Android APK Packaging
```bash
npm run build:android
```
The compiled release APK will be generated at:
`capacitor/android/app/build/outputs/apk/release/app-release.apk`

---

## 7. Versioning & Release Automation

- **Version Bump Across Workspaces**:
  ```bash
  bash update-version.sh <new_version>
  ```
  Synchronizes `package.json` across root, `gui/`, `electron/`, and `capacitor/`, as well as Android `versionCode` and `versionName`.

- **Automated Release**:
  ```bash
  npm run release
  ```
  Builds desktop packages and Android APK, validates changelog notes, tags git commits, and generates release artifacts.
