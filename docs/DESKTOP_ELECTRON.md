# Desktop & Electron Platform

## 1. Overview

StrawVerse for Desktop supports macOS (Apple Silicon arm64), Windows, and Linux through Electron. It pairs Chromium's modern web rendering capabilities with deep OS integration, including MPV media player embedding, Discord Rich Presence, and native download acceleration.

```mermaid
graph TD
    subgraph Electron_Main [Electron Main Process (gui.js)]
        Window[BrowserWindow (Chromium)]
        Menu[Native Application Menu & Tray]
        Discord[Discord RPC Client]
        Update[Auto Updater & Downloader]
        MPVProcess[MPV Player Subprocess]
    end

    subgraph Renderer [Renderer Process]
        Preload[preload.js (contextBridge)]
        AppUI[React 19 Application]
        Preload <--> AppUI
    end

    subgraph Backend_Process [Backend Server]
        Express[Express API Server]
    end

    Window --- Preload
    Electron_Main <-->|IPC / IPC Renderer| Preload
    Electron_Main -->|Spawn / IPC Socket| MPVProcess
    Electron_Main --> Express
```

---

## 2. Directory Structure

```text
electron/
├── gui.js               # Electron main process entry point
├── preload.js           # Context isolation bridge (window.electronAPI)
├── sharedState.js       # In-memory shared state between processes
├── package.json         # Electron scripts and builder configurations
├── scripts/
│   └── download-binaries.js # Downloads prebuilt ffmpeg, ffprobe, and MPV for target OS
├── assets/
│   ├── luffy.ico        # Windows application icon
│   └── luffy.png        # Linux application icon
└── mpv/                 # MPV player configuration, lua scripts, fonts
    └── config/
        ├── mpv.conf     # Base MPV rendering and hardware acceleration options
        ├── input.conf   # Keybindings and shortcut mappings
        ├── scripts/     # Custom Lua integration scripts (modernx.lua, etc.)
        └── fonts/       # High-clarity subtitle and OSD fonts
```

---

## 3. Key Subsystems

### 3.1 Main Process & Lifecycle ([`electron/gui.js`](../electron/gui.js))

- Handles single-instance lock (`app.requestSingleInstanceLock()`).
- Inits Discord Rich Presence via [`backend/utils/discord.js`](../backend/utils/discord.js).
- Manages native OS file dialogs (`showOpenDialog`) to select download directories without sandboxing limits.

### 3.2 IPC Bridge & Preload ([`electron/preload.js`](../electron/preload.js))

Exposes safe, explicit functions to the renderer under `window.electronAPI`:

- `openExternal(url)`: Opens links in the user's default desktop browser.
- `openFolder(path)`: Reveals downloaded anime/manga files directly in Windows Explorer or Linux File Manager.
- `selectDirectory()`: Prompts native folder picker dialog.
- `launchMPV(options)`: Spawns the embedded MPV player with custom HLS/stream headers.
- `onDownloadProgress(callback)`: Subscribes to real-time download push notifications.

### 3.3 Embedded MPV Integration ([`backend/utils/mpvPlayer.js`](../backend/utils/mpvPlayer.js) & `electron/mpv/`)

- On desktop platforms, users can toggle between the in-app HTML5 video player and high-performance **MPV**.
- Communicates via MPV's JSON IPC socket (named pipes on Windows, UNIX domain sockets on Linux and macOS).
- Controls playback position, reads watch timestamps, and updates watch history automatically upon exit.
- Includes pre-packaged Lua scripts (`modernx.lua`) for a modern, sleek on-screen controller (OSC).
